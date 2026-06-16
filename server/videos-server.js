'use strict';
// ═══════════════════════════════════════════════════════════════════
//  videos.js — Video scanning, listing, and all video API handlers
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { exec, execFile, execFileSync, spawn } = require('child_process');
const crypto = require('crypto');
const {
  VIDEOS_DIR, VAULT_DIR, IGNORED_DIR, VIDEO_EXT, MIME,
  AUDIO_DIR, AUDIO_EXT, BOOKS_DIR, BOOK_EXT,
  PHOTOS_DIR, IMAGE_EXT, THUMBS_DIR, CACHE_DIR, ROOT_DIR, FFMPEG_BIN, FFPROBE_BIN, FILES_DIR
} = require('./config-server');
const { pipeline } = require('stream');
const { promisify } = require('util');
const pipe = promisify(pipeline);
const { toId, fromId, safePath, formatBytes, formatDuration, json, readBody, wordMatch, wordMatchAny, channelMatchAny, actorMatchesAny, LIMITS } = require('./helpers-server');
const {
  loadFavs, saveFavs,
  loadHistory, saveHistory,
  loadPrefs,
  getDefaultWriteRoot,
  resolveCategoryPhysicalPath,
  loadVideoMeta, saveVideoMeta, setVideoMetaFields,
  loadThumbsCache, saveThumbsCache,
  loadActors, loadFolderMappings, loadChannels,
  loadAudioMeta, saveAudioMeta,
  loadBooksMeta, saveBooksMeta,
  loadRatings,
  loadLinksCache,
  loadVideoIndex, saveVideoIndex, clearVideoIndex,
  loadMediaIndex, saveMediaIndex, clearMediaIndex,
  upsertFileMeta,
  loadEnabledFolders,
  getSingleVideoMeta,
} = require('./db-server');

// ── Video scan cache ─────────────────────────────────────────────────
function getCatKey(p) {
  return (p || '').replace(/\\/g, '/').toLowerCase();
}

function getVaultCategoryPaths() {
  try {
    const { loadVaultMeta } = require('./db-server');
    const meta = loadVaultMeta();
    const cats = new Set();
    for (const item of Object.values(meta)) {
      if (item.category && item.type !== 'folder') cats.add(item.category);
    }
    return cats;
  } catch { return new Set(); }
}

function isHiddenFolderName(name) {
  return String(name || '').toLowerCase() === 'hidden';
}

function isFolderEnabled(catPath, enabledPaths) {
  if (!catPath || catPath === 'uncategorized' || catPath === 'Links') return true;
  if (!enabledPaths || enabledPaths.length === 0) return true;
  const pathLo = String(catPath).toLowerCase().replace(/\\/g, '/');
  return enabledPaths.some(ep => {
    const epLo = String(ep).toLowerCase().replace(/\\/g, '/');
    return pathLo === epLo || pathLo.startsWith(epLo + '/');
  });
}

function getExistingTopLevelFolders(root) {
  try {
    return new Set(
      fs.readdirSync(root, { withFileTypes: true })
        .filter(e => e.isDirectory() && !isHiddenFolderName(e.name))
        .map(e => e.name)
    );
  } catch {
    return new Set();
  }
}

let _scanCache = null;
let _watchDebounce = null;
const unlockedFolders = new Map(); // catPath -> key (Buffer)
let masterPassword = null; // Session master password

// ── Encryption progress tracker (shared for polling) ──────────────────
let _encryptionProgress = {
  running: false,
  type: '',   // 'encrypt' | 'decrypt'
  category: '',
  total: 0,
  done: 0,
  current: '',
  error: '',
  ok: false,
};
let _encryptionCancel = false;

// ── Categorizer background job ─────────────────────────────────────────
let _categorizerJob = null;
let _categorizerCancel = false;

async function runCategorizerBg(moves) {
  _categorizerCancel = false;
  _categorizerJob = { running: true, done: 0, total: moves.length, current: '', failed: 0 };
  console.log(`[categorizer] Moving ${moves.length} video${moves.length !== 1 ? 's' : ''}`);
  const writeRoot = getDefaultWriteRoot();
  const resolvedWrite = path.resolve(writeRoot);

  for (const { id, category: targetCategory } of moves) {
    if (_categorizerCancel) break;
    _categorizerJob.current = id;
    try {
      const fp = safePath(id);
      if (!fp) { _categorizerJob.failed++; } else {
        const targetDir = targetCategory ? path.join(writeRoot, targetCategory) : writeRoot;
        const resolvedTarget = path.resolve(targetDir);
        if (!resolvedTarget.startsWith(resolvedWrite)) {
          _categorizerJob.failed++;
        } else {
          if (!fs.existsSync(resolvedTarget)) fs.mkdirSync(resolvedTarget, { recursive: true });
          const filename = path.basename(fp);
          const newPath = path.join(resolvedTarget, filename);
          if (path.resolve(newPath) !== path.resolve(fp) && !fs.existsSync(newPath)) {
            fs.renameSync(fp, newPath);
            try {
              const newRel = path.relative(VIDEOS_DIR, newPath).replace(/\\/g, '/');
              const newId = newRel.startsWith('..') ? toId(newPath) : toId(newRel);
              const favs = loadFavs(); const fi = favs.indexOf(id);
              if (fi !== -1) { favs[fi] = newId; saveFavs(favs); }
              const meta = loadVideoMeta();
              if (meta[id]) { meta[newId] = meta[id]; delete meta[id]; saveVideoMeta(meta); }
            } catch {}
          }
        }
      }
    } catch { _categorizerJob.failed++; }
    _categorizerJob.done++;
  }

  invalidateScanCache();
  _categorizerJob.running = false;
  _categorizerJob.current = '';
  console.log(`[categorizer] Done — ${_categorizerJob.done} moved, ${_categorizerJob.failed} failed`);
}

async function apiCategorizerBgExecute(req, res) {
  if (_categorizerJob?.running) return json(res, { ok: false, error: 'Already running' }, 409);
  const body = await readBody(req);
  const moves = Array.isArray(body.moves) ? body.moves : [];
  if (!moves.length) return json(res, { ok: true, started: false });
  json(res, { ok: true, started: true, total: moves.length });
  runCategorizerBg(moves).catch(e => {
    console.error('[categorizer-bg]', e.message);
    if (_categorizerJob) _categorizerJob.running = false;
  });
}

function apiCategorizerPoll(req, res) {
  if (_categorizerJob) {
    json(res, { running: _categorizerJob.running, done: _categorizerJob.done, total: _categorizerJob.total, failed: _categorizerJob.failed, current: _categorizerJob.current || '' });
  } else {
    json(res, { running: false });
  }
}

async function apiCategorizerStop(req, res) {
  if (_categorizerJob?.running) _categorizerCancel = true;
  json(res, { ok: true });
}

// Set when a scan_changed broadcast was suppressed during an encrypt/decrypt job.
// Flushed as a single notification when the job ends (see updateEncryptionProgress).
let _scanChangePending = false;
function updateEncryptionProgress(partial) {
  const wasRunning = _encryptionProgress.running;
  _encryptionProgress = { ..._encryptionProgress, ...partial };
  // Job just finished: emit the one coalesced scan refresh we held back while
  // the per-file deletions kept fs.watch firing.
  if (wasRunning && !_encryptionProgress.running && _scanChangePending) {
    _scanChangePending = false;
    broadcastScanChange();
  }
}
function getEncryptionProgress() {
  return { ..._encryptionProgress };
}

// Run encryption in background to avoid tying work to an HTTP response
async function runEncryptFolder(catPath) {
  if (_encryptionProgress.running) return false;
  _encryptionCancel = false;
  const { isUnlocked, suspendAutoLock, resumeAutoLock } = require('./vault-server');
  const { loadVaultConfig } = require('./db-server');

  if (!loadVaultConfig()) {
    updateEncryptionProgress({ error: 'Master vault password is not set', running: false });
    return false;
  }
  if (!isUnlocked()) {
    updateEncryptionProgress({ error: 'Vault is locked. Unlock it first', running: false });
    return false;
  }

  // Hold the auto-lock open for the whole batch: encrypting a large folder can
  // take far longer than the auto-lock window, and locking mid-job corrupts the
  // vault metadata.
  suspendAutoLock();
  try {
    const ck = getCatKey(catPath);
    const videos = (await cachedScan()).filter(v => {
      const vk = getCatKey(v.catPath);
      return vk === ck || vk.startsWith(ck + '/');
    });

    const total = videos.filter(v => !v.encrypted).length;
    let encryptedCount = 0;

    updateEncryptionProgress({ running: true, type: 'encrypt', category: catPath, total, done: 0, current: '', error: '', ok: false });
    console.log(`[ENC] Encrypting "${catPath}" — ${total} file${total !== 1 ? 's' : ''}`);

    for (const v of videos) {
      if (_encryptionCancel) {
        updateEncryptionProgress({ error: 'Cancelled', running: false });
        return false;
      }
      if (v.encrypted) continue;
      const full = path.join(VIDEOS_DIR, v.rel);
      if (!fs.existsSync(full)) continue;

      let vaultId;
      try {
        vaultId = await _encryptVideoEntry(v);
      } catch (e) {
        console.error(`[ENC] Failed to encrypt ${v.name}: ${e.message}`);
        continue;
      }

      encryptedCount++;
      console.log(`[ENC] ${v.name} (${encryptedCount}/${total}, ${total - encryptedCount} left)`);
      updateEncryptionProgress({ done: encryptedCount, current: v.name });
    }

    // Also vault-flag any links associated with this category
    try {
      const { loadLinksCache: llc, upsertLink: ul } = require('./db-server');
      const ck = getCatKey(catPath);
      const allLinks = llc().items || [];
      for (const lnk of allLinks) {
        const lcat = lnk.category || '';
        const lck = getCatKey(lcat);
        if (lck === ck || lck.startsWith(ck + '/')) {
          ul({ ...lnk, vault: 1 });
        }
      }
    } catch (linkErr) { console.error('[runEncryptFolder] link vault error:', linkErr.message); }

    invalidateScanCache();
    updateEncryptionProgress({ ok: true, running: false });
    console.log(`[ENC] Encryption complete — ${encryptedCount} file${encryptedCount !== 1 ? 's' : ''} encrypted`);
    return true;
  } catch (e) {
    console.error('[runEncryptFolder] error:', e);
    updateEncryptionProgress({ error: e.message || String(e), running: false });
    return false;
  } finally {
    resumeAutoLock();
  }
}

// Run decryption in background
async function runDecryptFolder(catPath, targetProfile) {
  if (_encryptionProgress.running) return false;
  _encryptionCancel = false;
  const { isUnlocked, getVaultKey, suspendAutoLock, resumeAutoLock } = require('./vault-server');
  const { loadVaultMeta, saveVaultMeta, switchProfile, getCurrentProfile, setVideoMetaFields } = require('./db-server');

  if (!isUnlocked()) {
    updateEncryptionProgress({ error: 'Vault is locked. Unlock it first', running: false });
    return false;
  }

  // Keep the vault unlocked for the duration — see runEncryptFolder.
  suspendAutoLock();
  try {
    const meta = loadVaultMeta();
    const itemsToDecrypt = [];
    for (const [id, item] of Object.entries(meta)) {
      if (item.category === catPath && item.type !== 'folder') itemsToDecrypt.push({ id, ...item });
    }

    if (itemsToDecrypt.length === 0) {
      updateEncryptionProgress({ error: 'No files found in this category in the vault', running: false });
      return false;
    }

    updateEncryptionProgress({ running: true, type: 'decrypt', category: catPath, total: itemsToDecrypt.length, done: 0, current: '', error: '', ok: false });
    console.log(`[DEC] Decrypting "${catPath}" — ${itemsToDecrypt.length} file${itemsToDecrypt.length !== 1 ? 's' : ''}`);

    const total = itemsToDecrypt.length;
    let doneCount = 0;
    const vaultKey = getVaultKey();
    const originalProfile = getCurrentProfile();

    for (const item of itemsToDecrypt) {
      if (_encryptionCancel) {
        updateEncryptionProgress({ error: 'Cancelled', running: false });
        return false;
      }
      const encPath = path.join(VAULT_DIR, item.id + '.enc');
      if (!fs.existsSync(encPath)) continue;
      const writeRoot = getDefaultWriteRoot();
      const targetDir = path.join(writeRoot, item.category);
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      const targetFilePath = path.join(targetDir, item.originalName || item.name + (item.ext || '.mp4'));
      await decryptFile(encPath, targetFilePath, vaultKey);
      doneCount++;
      console.log(`[DEC] ${item.originalName || item.name} (${doneCount}/${total}, ${total - doneCount} left)`);

      const newRel = path.resolve(targetFilePath).startsWith(path.resolve(VIDEOS_DIR))
        ? path.relative(VIDEOS_DIR, targetFilePath).replace(/\\/g, '/')
        : targetFilePath;
      const newId = toId(newRel);

      if (item.videoMeta) {
        switchProfile(targetProfile);
        setVideoMetaFields(newId, item.videoMeta);
        switchProfile(originalProfile);
      }

      const oldThumb = path.join(THUMBS_DIR, item.id);
      const newThumb = path.join(THUMBS_DIR, newId);
      if (fs.existsSync(oldThumb)) {
        if (fs.existsSync(newThumb)) fs.rmSync(newThumb, { recursive: true, force: true });
        fs.renameSync(oldThumb, newThumb);
        const tFiles = fs.readdirSync(newThumb);
        for (const tf of tFiles) {
          if (tf.endsWith('.jpg')) {
             await decryptThumbnailInPlace(path.join(newThumb, tf), vaultKey);
          }
        }
        const chaptersDir = path.join(newThumb, 'chapters');
        if (fs.existsSync(chaptersDir)) {
          for (const cf of fs.readdirSync(chaptersDir)) {
            if (cf.endsWith('.jpg')) await decryptThumbnailInPlace(path.join(chaptersDir, cf), vaultKey);
          }
        }
      }

      delete meta[item.id];
      updateEncryptionProgress({ done: doneCount, current: item.originalName || item.name });
    }

    saveVaultMeta(meta);
    invalidateScanCache();
    updateEncryptionProgress({ ok: true, running: false });
    console.log(`[DEC] Decryption complete — ${doneCount} file${doneCount !== 1 ? 's' : ''} decrypted`);
    return true;
  } catch (e) {
    console.error('[runDecryptFolder] error:', e);
    updateEncryptionProgress({ error: e.message || String(e), running: false });
    return false;
  } finally {
    resumeAutoLock();
  }
}

const _scanSseClients = new Set();

function broadcastScanChange() {
  // While an encrypt/decrypt batch runs, each file is shredded/created in turn,
  // so fs.watch fires repeatedly. Broadcasting every burst makes clients reload
  // the whole gallery (and re-fetch every thumbnail) over and over. Hold the
  // notification and let updateEncryptionProgress emit a single refresh at the end.
  if (_encryptionProgress.running) { _scanChangePending = true; return; }
  const msg = `data: ${JSON.stringify({ type: 'scan_changed' })}\n\n`;
  for (const res of _scanSseClients) {
    try { res.write(msg); } catch { _scanSseClients.delete(res); }
  }
}

function apiScanEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write(': connected\n\n');
  _scanSseClients.add(res);
  req.on('close', () => _scanSseClients.delete(res));
}

function invalidateScanCache() {
  _scanCache = null;
  clearVideoIndex();
  clearMediaIndex();
  try { require('./media-zip-mount-server').invalidate(); } catch {}
  broadcastScanChange();
}

function _onVideoDirChange() {
  if (_watchDebounce) clearTimeout(_watchDebounce);
  _watchDebounce = setTimeout(() => {
    console.log('[scan] Filesystem change detected in videos directory — refreshing index');
    invalidateScanCache();
  }, 300);
}

try {
  fs.watch(VIDEOS_DIR, { recursive: true }, _onVideoDirChange);
} catch (e) {
  // fs.watch unavailable in this environment; cache is invalidated by explicit calls only
}

async function cachedScan() {
  if (_scanCache) return _scanCache;

  // Fast path: load previously indexed list from DB
  const indexed = loadVideoIndex();
  if (indexed && indexed.length > 0) {
    // If media_index is empty but video_index has data, a full rescan is needed to
    // populate media_index (happens on first run after this feature was added).
    if (loadMediaIndex().length === 0) {
      clearVideoIndex();
      // Fall through to full scan below
    } else {
      // Serve the indexed list immediately — no blocking existsSync per file.
      // Validate file existence in the background; if anything was deleted the
      // cache is pruned and clients are notified via SSE to refresh.
      _scanCache = indexed;
      setImmediate(() => {
        try {
          let prefs;
          try { prefs = loadPrefs(); } catch { prefs = {}; }
          const sourceFolders = (prefs.sourceFolders || []).filter(sf => fs.existsSync(sf));
          const valid = indexed.filter(v => {
            const filePath = v.isExternal ? v.rel : path.join(VIDEOS_DIR, v.rel);
            if (fs.existsSync(filePath)) return true;
            if (v.isExternal && v.catPath && v.filename) {
              return sourceFolders.some(sf => fs.existsSync(path.join(sf, v.catPath, v.filename)));
            }
            return false;
          });
          if (valid.length !== indexed.length) {
            _scanCache = valid;
            saveVideoIndex(valid);
            if (_scanSseClients.size > 0) broadcastScanChange();
          }
        } catch (e) {
          console.error('[cachedScan] background validation error:', e.message);
        }
      });
      return _scanCache;
    }
  }

  // DB empty: scan filesystem, then persist to DB for next start
  console.log('[scan] Full filesystem scan starting…');
  const mediaAll = [];
  let all = await scan(VIDEOS_DIR, VIDEOS_DIR, false, mediaAll);

  try {
    const prefs = loadPrefs();
    if (prefs.sourceFolders) {
      for (const folder of prefs.sourceFolders) {
        if (fs.existsSync(folder)) {
          const extFiles = await scan(folder, folder, true, mediaAll);
          all.push(...extFiles);
        }
      }
    }
  } catch (e) {
    console.error('Failed to scan external folders:', e);
  }

  try {
    const cats = loadFolderMappings();
    all = all.map(v => {
      if (path.isAbsolute(v.rel) && v.category === 'Uncategorized') {
        for (const cat of cats) {
          if (wordMatchAny(v.name, cat.terms)) {
            // Only update category label — leave catPath empty so root-level
            // external files still appear as uncategorized in the sidebar.
            return { ...v, category: cat.displayName };
          }
        }
      }
      return v;
    });
  } catch (e) {
    console.error('Failed to auto-categorize external files:', e);
  }

  saveVideoIndex(all);
  saveMediaIndex(mediaAll);
  _scanCache = all;
  console.log(`[scan] Full scan complete — ${all.length} video${all.length !== 1 ? 's' : ''} indexed`);
  return _scanCache;
}

// ── Video scanning ───────────────────────────────────────────────────

async function scan(dir, base = dir, isExternal = false, mediaOut = null) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const isDirEncrypted = fs.existsSync(path.join(dir, '.cat-enc-config.json'));

  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    // Process in sequential chunks to avoid overwhelming the file system
    const chunkSize = 32;
    for (let i = 0; i < entries.length; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize);
      await Promise.all(chunk.map(async (ent) => {
        const fp = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (path.resolve(fp) === path.resolve(VAULT_DIR) || path.resolve(fp) === path.resolve(IGNORED_DIR) || isHiddenFolderName(ent.name)) return;
          const sub = await scan(fp, base, isExternal, mediaOut);
          out.push(...sub);
          return;
        }
        if (!ent.isFile()) return;

        const ext = path.extname(ent.name).toLowerCase();
        let originalName = ent.name;
        let realExt = ext;
        let encrypted = false;

        if (ext === '.enc' && isDirEncrypted) {
          const parts = ent.name.split('.');
          if (parts.length >= 3) {
            realExt = '.' + parts[parts.length - 2];
            originalName = parts.slice(0, parts.length - 1).join('.');
            encrypted = true;
          } else {
            realExt = '.mp4';
            encrypted = true;
          }
        } else if (!VIDEO_EXT.has(ext)) {
          // Collect non-video media files into the unified media index
          if (mediaOut) {
            let mediaType = null;
            if (AUDIO_EXT.has(ext)) mediaType = 'audio';
            else if (BOOK_EXT.has(ext)) mediaType = 'book';
            // Photos from sourceFolders only — VIDEOS_DIR photos are already handled by the photos dynamic scan
            else if (IMAGE_EXT.has(ext) && isExternal) mediaType = 'photo';
            else if (ext !== '.enc' && ext !== '.db' && ext !== '.log' && ext !== '.tmp') mediaType = 'file';
            if (mediaType) {
              try {
                const st = await fs.promises.stat(fp);
                mediaOut.push({
                  id: toId(fp),
                  name: path.basename(ent.name, ext),
                  filename: ent.name,
                  absPath: fp,
                  sourcePath: base,
                  ext,
                  mediaType,
                  size: st.size,
                  sizeF: formatBytes(st.size),
                  mtime: st.mtimeMs,
                });
              } catch {}
            }
          }
          return;
        }

        const rel = path.relative(base, fp);
        const cat = path.dirname(rel);
        const st  = await fs.promises.stat(fp);
        const catPath = cat === '.' ? '' : cat.replace(/\\/g, '/');
        out.push({
          id: toId(isExternal ? fp : rel),
          name: path.basename(originalName, realExt),
          filename: ent.name,
          ext: realExt,
          encrypted,
          rel: isExternal ? fp : rel,
          category: catPath ? catPath.replace(/\//g, ' / ') : 'Uncategorized',
          catPath,
          size: st.size, sizeF: formatBytes(st.size),
          modified: st.mtime.toISOString(), mtime: st.mtimeMs,
          ...(isExternal ? { isExternal: true } : {}),
        });
      }));
    }
  } catch (e) {}
  return out;
}

async function allVideos(forceAll = false) {
  const db = require('./db-server');
  if (db.getCurrentProfile() === 'Vault' && !forceAll) {
    const { loadVaultMeta } = require('./db-server');
    const meta = loadVaultMeta();
    const list = [];
    for (const [id, item] of Object.entries(meta)) {
      if (item.type !== 'folder') {
        list.push({
          id,
          name: item.originalName || item.name,
          rel: id + '.enc',
          ext: item.ext || '',
          catPath: item.category || '',
          encrypted: true,
          // Mark as a vault item so the player streams via /api/vault/stream/:id
          // (decrypting on the fly) instead of /api/stream/:id, which 404s.
          isVault: true,
          mtime: item.mtime || Date.now(),
          size: item.size || 0
        });
      }
    }
    return list;
  }

  const all    = await cachedScan();
  const meta   = loadVideoMeta();
  
  let list = all.map(v => {
    const vMeta = meta[v.id] || {};
    const tags = vMeta.tags || [];
    return { ...v, tags };
  });

  // Load Links as remote videos
  let links = [];
  try {
    links = loadLinksCache().items || [];
  } catch (e) {
    console.error('Failed to load links cache in allVideos:', e);
  }

  const bmVideos = links.map(item => {
    const titleWords = item.title.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3);
    const tags = [...new Set(titleWords)];
    
    return {
      id: item.url,
      name: item.title,
      filename: item.title,
      ext: '.mp4',
      rel: item.url,
      path: item.scrapedVideoUrl || item.url,
      category: item.category || 'Uncategorized',
      catPath: item.category || '',
      tags: tags,
      isLink: true,
      scrapedVideoUrl: item.scrapedVideoUrl,
      img: item.img,
      size: 0,
      sizeF: '0 MB',
      mtime: Date.now(),
      modified: new Date().toISOString()
    };
  });

  list.push(...bmVideos);

  list = list.filter(v => {
    if (v.encrypted && !isUnlocked(v.catPath)) return false;
    return true;
  });

  // Append files from temporarily opened folders (not persisted to the DB).
  try {
    const { getOpenedItems } = require('./opened-folders-server');
    list.push(...getOpenedItems());
  } catch (e) {}

  return list;
}

function isUnlocked(catPath) {
  let p = getCatKey(catPath);
  while (true) {
    if (unlockedFolders.has(p)) return true;
    const idx = p.lastIndexOf('/');
    if (idx === -1) break;
    p = p.substring(0, idx);
  }
  return false;
}

function getUnlockKey(catPath) {
  const db = require('./db-server');
  const { isUnlocked, getVaultKey } = require('./vault-server');
  
  if (db.getCurrentProfile() === 'Vault' && isUnlocked()) {
    return getVaultKey();
  }

  let p = getCatKey(catPath);
  while (true) {
    if (unlockedFolders.has(p)) return unlockedFolders.get(p);
    const idx = p.lastIndexOf('/');
    if (idx === -1) break;
    p = p.substring(0, idx);
  }
  return null;
}

// ── Video meta init (runs on startup) ───────────────────────────────

async function initVideoMeta() {
  try {
    const meta       = loadVideoMeta();
    const videos     = await cachedScan();
    let changed      = false;
    const categories = loadFolderMappings();
    const channels    = loadChannels();
    const actors     = loadActors();
    let oldRatings   = {};
    try { oldRatings = loadRatings(); } catch {}

    for (const v of videos) {
      if (!meta[v.id]) {
        const detectedTags   = [...new Set(categories.filter(e => wordMatchAny(v.name, e.terms)).map(e => e.displayName))];
        const detectedChannel = channels.find(e => channelMatchAny(v.name, e.terms));
        const detectedActors = [...new Set(actors.filter(e => actorMatchesAny(v.name, e.terms)).map(e => e.name))];
        meta[v.id] = {
          title: v.name,
          actors: detectedActors,
          tags: detectedTags,
          channel: detectedChannel ? detectedChannel.name : '',
          rating: oldRatings[v.id] || null,
          category: v.catPath,
          note: '', date: v.modified,
        };
        changed = true;
      } else if (oldRatings[v.id] && !meta[v.id].rating) {
        meta[v.id].rating = oldRatings[v.id];
        changed = true;
      }
    }
    for (const id of Object.keys(meta)) {
      if (!videos.find(v => v.id === id)) { delete meta[id]; changed = true; }
    }
    if (changed) saveVideoMeta(meta);
  } catch (e) { console.error('initVideoMeta error:', e.message); }
}

// ── Video API handlers ───────────────────────────────────────────────

async function apiVideos(req, res, params) {
  const favs        = loadFavs();
  const meta        = loadVideoMeta();
  const thumbsCache = loadThumbsCache();
  const enabledPaths = loadEnabledFolders();
  const prefs       = loadPrefs();
  const historyEnabled = prefs.chronologyMode !== 'dont-save';
  const historySet  = historyEnabled ? new Set(loadHistory()) : null;
  // all=1 (vault unlocked only): bypass the per-profile enabled-categories
  // filter so the Vault's Global view can import files from any profile
  const showAll = params.get('all') === '1' && require('./vault-server').isUnlocked();
  const videos      = await allVideos(showAll);
  let list = videos
    .filter(v => showAll || v.isOpened || isFolderEnabled(v.catPath, enabledPaths))
    .map(v => {
      const cached   = thumbsCache[v.id];
      const duration = cached?.duration || null;
      const vMeta    = meta[v.id] || {};
      return {
        ...v,
        fav: favs.includes(v.id),
        rating: vMeta.rating ?? null,
        reencoded: !!vMeta.reencoded,
        duration,
        durationF: formatDuration(duration),
        tags: vMeta.tags || v.tags || [],
        actors: vMeta.actors || [],
        note: vMeta.note || '',
        chapters: vMeta.chapters || [],
        width: cached?.width || null,
        height: cached?.height || null,
        ...(historySet ? { watched: historySet.has(v.id) } : {}),
      };
    });
  const q    = params.get('q');
  const cat  = params.get('category');
  const sort = params.get('sort') || 'date';
  const fav  = params.get('fav') === '1' || params.get('fav') === 'true';

  const relevance = new Map();
  if (q) {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    list = list.filter(v => {
      const vName    = v.name.toLowerCase();
      const vCat     = v.category.toLowerCase();
      const vTags    = (v.tags || []).map(t => t.toLowerCase());
      const vActors  = (v.actors || []).map(a => a.toLowerCase());
      const vNote    = (v.note || '').toLowerCase();

      const match = tokens.every(token =>
        vName.includes(token) ||
        vCat.includes(token) ||
        vTags.some(t => t.includes(token)) ||
        vActors.some(a => a.includes(token)) ||
        vNote.includes(token)
      );

      if (match) {
        let score = 0;
        tokens.forEach(token => {
          if (vName.includes(token)) score += 10;
          if (vName.startsWith(token)) score += 5;
          if (vCat.includes(token)) score += 3;
          if (vTags.some(t => t.includes(token))) score += 5;
          if (vActors.some(a => a.includes(token))) score += 8;
          if (vNote.includes(token)) score += 2;
        });
        if (vName.includes(q.toLowerCase())) score += 20;
        relevance.set(v.id, score);
      }
      return match;
    });
  }

  if (fav) {
    list = list.filter(v => v.fav);
  }
  
  // 1. Check for strict null instead of truthiness
  if (cat !== null) {
    if (cat === 'uncategorized' || cat === '__uncategorized__' || cat === '') {
      list = list.filter(v => v.catPath === '');
    } else {
      const defined = loadFolderMappings();
      const catLo = cat.toLowerCase();
      const matchingEntry = defined.find(e => e.name.toLowerCase() === catLo);
      const cl = cat.toLowerCase().replace(/\\/g, '/');
      list = list.filter(v => {
        const vp = v.catPath.toLowerCase().replace(/\\/g, '/');
        const isChild = vp === cl || vp.startsWith(cl + '/');
        return isChild || v.category === cat || (matchingEntry && v.catPath === '' && wordMatchAny(v.name, matchingEntry.terms));
      });
    }
  }
  // Append virtual ZIP-based video entries (unencrypted ZIPs in all media roots).
  if (!showAll) {
    try {
      const mediaZip = require('./media-zip-mount-server');
      let zipVideos = mediaZip.getVirtualVideos(cat || null);
      if (q) {
        const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
        zipVideos = zipVideos.filter(v => tokens.every(t => v.name.toLowerCase().includes(t) || v.catPath.toLowerCase().includes(t)));
      }
      for (const zv of zipVideos) {
        list.push({ ...zv, fav: false, rating: null, reencoded: false, duration: null, durationF: null, actors: [], note: '', chapters: [], width: null, height: null });
      }
    } catch (e) { console.error('[apiVideos] zip videos error:', e.message); }
  }

  if (sort === 'name')     list.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'size')     list.sort((a, b) => b.size - a.size);
  else if (sort === 'duration') list.sort((a, b) => (b.duration || 0) - (a.duration || 0));
  else if (q && relevance.size) {
    list.sort((a, b) => {
      const sA = relevance.get(a.id) || 0;
      const sB = relevance.get(b.id) || 0;
      if (sA !== sB) return sB - sA;
      return b.mtime - a.mtime;
    });
  }
  else list.sort((a, b) => b.mtime - a.mtime);
  json(res, list);
}

async function apiFolders(req, res, params) {
  const db = require('./db-server');
  // all=1 (vault unlocked only): mirrors apiVideos' Global view — use the
  // disk-scan set bypassing the per-profile enabled-categories filter.
  const showAll = !!params && params.get('all') === '1' && require('./vault-server').isUnlocked();
  // Vault Only: build categories from the Vault's own item list (catPath = item.category)
  const isVaultOnly = db.getCurrentProfile() === 'Vault' && !showAll;
  const videos = isVaultOnly ? await allVideos(false) : await cachedScan();
  const meta = loadVideoMeta();
  const catMap = new Map();

  let links = [];
  try {
    links = loadLinksCache().items || [];
  } catch (e) {
    console.error('Failed to load links cache:', e);
  }

  for (const v of videos) {
    const cp = v.catPath;
    if (!cp) continue;
    
    const parts = cp.split('/');
    let currentPath = '';
    
    for (let i = 0; i < parts.length; i++) {
      currentPath = currentPath ? currentPath + '/' + parts[i] : parts[i];
      const subRelFwd = currentPath;
      
      if (!catMap.has(subRelFwd)) {
        catMap.set(subRelFwd, {
          name: subRelFwd.replace(/\//g, ' / '),
          path: subRelFwd,
          count: 0,
          hasUnencrypted: false
        });
      }
      
      const entry = catMap.get(subRelFwd);
      entry.count++;
      if (!v.encrypted) {
        entry.hasUnencrypted = true;
      }
    }
  }

  // Include empty directories from the filesystem so newly created folders appear
  // (skipped in Vault Only mode — vault categories come purely from vault meta)
  try {
    if (!isVaultOnly && fs.existsSync(VIDEOS_DIR)) {
      // Async (non-blocking) walk: a sync recursive readdir here stalls the
      // single-threaded event loop, delaying the concurrent /api/videos
      // response from flushing even when it's already built.
      const walkDir = async (dir, rel) => {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const ent of entries) {
          if (!ent.isDirectory()) continue;
          if (isHiddenFolderName(ent.name)) continue;
          const subRel = rel ? rel + '/' + ent.name : ent.name;
          const key = subRel.replace(/\\/g, '/');
          if (!catMap.has(key)) {
            catMap.set(key, {
              name: key.replace(/\//g, ' / '),
              path: key,
              count: 0,
              hasUnencrypted: false
            });
          }
          await walkDir(path.join(dir, ent.name), subRel);
        }
      };
      await walkDir(VIDEOS_DIR, '');
    }
  } catch (e) {
    console.error('[apiCategories] filesystem walk error:', e.message);
  }

  // Add playable links to category counts — first match only (mirrors client matchLinkCat)
  const catEntries = [...catMap.entries()];
  const playableLinks = links.filter(b => b.scrapedVideoUrl || b.embedUrl);
  let unmatched = 0;
  for (const bm of playableLinks) {
    let matched = false;

    // Check explicit category first
    if (bm.category) {
      for (const [key, entry] of catEntries) {
        if (key === 'Links') continue;
        if (entry.path === bm.category || entry.name === bm.category || bm.category.replace(/\\/g, '/') === entry.path) {
          entry.count++;
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      const norm = (bm.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      for (const [key, entry] of catEntries) {
        if (key === 'Links') continue;
        const kn = entry.path.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (kn && norm.includes(kn)) {
          entry.count++;
          matched = true;
          break;
        }
      }
    }

    if (!matched) unmatched++;
  }

  // Virtual "Links" category for unmatched playable links
  if (unmatched > 0) {
    catMap.set('Links', {
      name: 'Links',
      path: 'Links',
      count: unmatched,
      hasUnencrypted: false
    });
  }

  const vaultCats = getVaultCategoryPaths();

  // Remove categories whose physical directory no longer exists — vault-only
  // categories live purely in the Vault's item list, so skip this for them.
  if (!isVaultOnly) {
    let sfPrefs;
    try { sfPrefs = loadPrefs(); } catch (e) { sfPrefs = {}; }
    const existingSF = (sfPrefs.sourceFolders || []).filter(sf => fs.existsSync(sf));
    const toRemove = [];
    for (const [key, entry] of catMap.entries()) {
      if (key === 'Links') continue;
      if (vaultCats.has(entry.path)) continue;
      if (fs.existsSync(path.join(VIDEOS_DIR, entry.path))) continue;
      if (existingSF.some(sf => fs.existsSync(path.join(sf, entry.path)))) continue;
      toRemove.push(key);
    }
    toRemove.forEach(k => catMap.delete(k));
  }

  const cats = [];
  for (const [key, entry] of catMap.entries()) {
    const isLinks = key === 'Links';
    const full = path.join(VIDEOS_DIR, entry.path);
    const hasCatConfig = !isLinks && fs.existsSync(path.join(full, '.cat-enc-config.json'));
    const isConfigured = hasCatConfig || (!isLinks && vaultCats.has(entry.path));

    cats.push({
      name: entry.name,
      path: entry.path,
      count: entry.count,
      encrypted: isConfigured,
      partial: isConfigured && entry.hasUnencrypted,
      unlocked: isLinks ? true : isUnlocked(entry.path)
    });
  }

  // Uncategorized count — all videos sitting at root (no subfolder)
  const uncatCount = videos.filter(v => {
    if (v.catPath !== '') return false;
    return true;
  }).length;
  cats.unshift({ name: 'Uncategorized', path: 'uncategorized', count: uncatCount });

  const enabledPaths = db.loadEnabledFolders();
  const filtered = showAll ? cats : cats.filter(c => isFolderEnabled(c.path, enabledPaths));

  // Append temporarily opened folders (always visible, regardless of enabled set).
  try {
    const { getOpenedFolderEntries } = require('./opened-folders-server');
    for (const entry of getOpenedFolderEntries()) {
      filtered.push({ ...entry, encrypted: false, partial: false, unlocked: true });
    }
  } catch (e) {}

  // Inject ZIP-based virtual categories (always visible — bypass enabled-folder filter).
  try {
    const existingPaths = new Set(filtered.map(c => c.path));
    const mediaZip = require('./media-zip-mount-server');
    for (const vc of mediaZip.getVirtualCategories()) {
      if (!existingPaths.has(vc.path)) {
        filtered.push({ name: vc.name, path: vc.path, count: vc.count, encrypted: false, partial: false, unlocked: true, isZipMount: true });
        existingPaths.add(vc.path);
      }
    }
  } catch (e) { console.error('[apiFolders] zip categories error:', e.message); }

  filtered.sort((a, b) => {
    if (a.path === 'uncategorized') return -1;
    if (b.path === 'uncategorized') return 1;
    return a.name.localeCompare(b.name);
  });

  json(res, filtered);
}

async function apiGetAllFolders(req, res) {
  // path -> { name, path, isExternal }
  const catMap = new Map();

  async function walkMain(dir, rel) {
    if (!fs.existsSync(dir)) return;
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        if (isHiddenFolderName(ent.name)) continue;
        const subRel = rel ? rel + '/' + ent.name : ent.name;
        const full = path.join(VIDEOS_DIR, subRel);
        if (path.resolve(full) === path.resolve(VAULT_DIR)) continue;
        if (path.resolve(full) === path.resolve(IGNORED_DIR)) continue;
        const key = getCatKey(subRel);
        if (!catMap.has(key)) catMap.set(key, { name: subRel.replace(/\//g, ' / '), path: subRel, isExternal: false });
        await walkMain(full, subRel);
      }
    } catch (e) {
      console.error('[folders walk main]', dir, e.message);
    }
  }

  async function walkExternal(dir, rel) {
    if (!fs.existsSync(dir)) return;
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        if (isHiddenFolderName(ent.name)) continue;
        const subRel = rel ? rel + '/' + ent.name : ent.name;
        const key = getCatKey(subRel);
        if (!catMap.has(key)) catMap.set(key, { name: subRel.replace(/\//g, ' / '), path: subRel, isExternal: true });
        await walkExternal(path.join(dir, ent.name), subRel);
      }
    } catch (e) {
      console.error('[folders walk external]', dir, e.message);
    }
  }

  await walkMain(VIDEOS_DIR, '');

  try {
    const prefs = loadPrefs();
    if (prefs.sourceFolders) {
      for (const folder of prefs.sourceFolders) {
        if (fs.existsSync(folder)) await walkExternal(folder, '');
      }
    }
  } catch (e) {
    console.error('[folders walk source]', e.message);
  }

  const list = [...catMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  console.log('[folders] found', list.length, 'folders total');

  const db = require('./db-server');
  const enabled = db.loadEnabledFolders();

  json(res, { categories: list, enabled });
}

async function apiSetEnabledFolders(req, res) {
  const body = await readBody(req);
  const { paths } = body;
  if (!Array.isArray(paths)) return json(res, { error: 'Paths array required' }, 400);
  
  const db = require('./db-server');
  db.saveEnabledFolders(paths);
  json(res, { ok: true });
}

async function apiMainFolders(req, res) {
  const result = [{ name: 'Uncategorized', path: '' }];

  async function walk(dir, rel = '') {
    if (!fs.existsSync(dir)) return;
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        if (isHiddenFolderName(ent.name)) continue;
        const subRel = rel ? path.join(rel, ent.name) : ent.name;
        const full = path.join(VIDEOS_DIR, subRel);
        if (path.resolve(full) === path.resolve(VAULT_DIR) || path.resolve(full) === path.resolve(IGNORED_DIR)) continue;
        result.push({ name: subRel.replace(/[\\/]/g, ' / '), path: subRel.replace(/\\/g, '/') });
        await walk(full, subRel);
      }
    } catch (e) {}
  }

  await walk(VIDEOS_DIR);

  // Filter to only enabled folders for current user (consistent with browser folder lists)
  try {
    const dbmod = require('./db-server');
    const enabledPaths = dbmod.loadEnabledFolders();
    // keep uncat + enabled ones; note main-cats only covers VIDEOS_DIR not sources
    const before = result.length;
    // re-filter in place
    for (let i = result.length - 1; i >= 0; i--) {
      if (!isFolderEnabled(result[i].path, enabledPaths)) {
        result.splice(i, 1);
      }
    }
  } catch (e) {
    console.error('[main-categories] enabled filter error:', e.message);
  }

  // Inject ZIP-based virtual categories so they appear in folder lists.
  try {
    const mediaZip = require('./media-zip-mount-server');
    const existingPaths = new Set(result.map(c => c.path));
    for (const vc of mediaZip.getVirtualCategories()) {
      if (!existingPaths.has(vc.path)) {
        result.push({ name: vc.name, path: vc.path, isZipMount: true });
        existingPaths.add(vc.path);
      }
    }
  } catch (e) { console.error('[main-folders] zip categories error:', e.message); }

  result.sort((a, b) => {
    if (a.path === '') return -1;
    if (b.path === '') return 1;
    return a.name.localeCompare(b.name);
  });
  json(res, result);
}

async function apiCreateFolder(req, res) {
  const body = await readBody(req);
  const name = (body.name || '').trim().replace(/[<>:"|?*]/g, '_');
  if (!name) return json(res, { error: 'Name required' }, 400);
  if (name.length > LIMITS.name) return json(res, { error: `Name is too long (max ${LIMITS.name} characters)` }, 400);
  const writeRoot = getDefaultWriteRoot();
  const dir = path.join(writeRoot, name);
  if (fs.existsSync(dir)) return json(res, { error: 'Already exists' }, 409);
  try { fs.mkdirSync(dir, { recursive: true }); json(res, { ok: true, name }); }
  catch (e) { json(res, { error: e.message }, 500); }
}

// ── Physical folder management (non-Vault profiles only) ──────────────

async function apiFolderCreate(req, res) {
  const { getCurrentProfile } = require('./db-server');
  if (getCurrentProfile() === 'Vault') return json(res, { error: 'Use vault folder API in Vault mode' }, 409);
  const body = await readBody(req);
  const parentPath = (body.parentPath || '').replace(/[<>:"|?*]/g, '_');
  const name = (body.name || '').trim().replace(/[<>:"|?*]/g, '_');
  if (!name) return json(res, { error: 'Name required' }, 400);
  if (name.length > LIMITS.name) return json(res, { error: `Name is too long (max ${LIMITS.name} characters)` }, 400);
  const base = getDefaultWriteRoot();
  const dir = parentPath ? path.join(base, parentPath, name) : path.join(base, name);
  if (!dir.startsWith(path.resolve(base))) return json(res, { error: 'Invalid path' }, 400);
  if (fs.existsSync(dir)) return json(res, { error: 'Already exists' }, 409);
  try { fs.mkdirSync(dir, { recursive: true }); invalidateScanCache(); json(res, { ok: true }); }
  catch (e) { json(res, { error: e.message }, 500); }
}

async function apiFolderRename(req, res) {
  const { getCurrentProfile } = require('./db-server');
  if (getCurrentProfile() === 'Vault') return json(res, { error: 'Use vault folder API in Vault mode' }, 409);
  const body = await readBody(req);
  const oldPath = body.path;
  const newName = (body.newName || '').trim().replace(/[<>:"|?*]/g, '_');
  if (!oldPath || !newName) return json(res, { error: 'path and newName required' }, 400);
  const oldDir = resolveCategoryPhysicalPath(oldPath);
  if (!fs.existsSync(oldDir)) return json(res, { error: 'Folder not found' }, 404);
  const newDir = path.join(path.dirname(oldDir), newName);
  if (fs.existsSync(newDir)) return json(res, { error: 'Target name already exists' }, 409);
  try {
    fs.renameSync(oldDir, newDir);
    invalidateScanCache();
    json(res, { ok: true });
  } catch (e) { json(res, { error: e.message }, 500); }
}

async function apiFolderDelete(req, res) {
  const { getCurrentProfile } = require('./db-server');
  if (getCurrentProfile() === 'Vault') return json(res, { error: 'Use vault folder API in Vault mode' }, 409);
  const body = await readBody(req);
  const folderPath = body.path;
  if (!folderPath) return json(res, { error: 'path required' }, 400);
  const dir = resolveCategoryPhysicalPath(folderPath);
  if (!fs.existsSync(dir)) return json(res, { error: 'Folder not found' }, 404);
  const parentDir = path.dirname(dir);
  const base = getDefaultWriteRoot();
  if (!dir.startsWith(path.resolve(base))) return json(res, { error: 'Invalid path' }, 400);
  try {
    const moveContents = (src, dst) => {
      for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
        const srcFull = path.join(src, ent.name);
        let dstFull = path.join(dst, ent.name);
        if (fs.existsSync(dstFull)) {
          const ext = path.extname(ent.name), base = path.basename(ent.name, ext);
          let n = 1;
          while (fs.existsSync(dstFull)) dstFull = path.join(dst, `${base}(${n++})${ext}`);
        }
        fs.renameSync(srcFull, dstFull);
      }
    };
    moveContents(dir, parentDir);
    fs.rmdirSync(dir);
    invalidateScanCache();
    json(res, { ok: true });
  } catch (e) { json(res, { error: e.message }, 500); }
}

async function apiFolderMove(req, res) {
  const { getCurrentProfile } = require('./db-server');
  if (getCurrentProfile() === 'Vault') return json(res, { error: 'Use vault folder API in Vault mode' }, 409);
  const body = await readBody(req);
  const fromPath = body.fromPath;
  const toParentPath = body.toParentPath || '';
  if (!fromPath) return json(res, { error: 'fromPath required' }, 400);
  const base = getDefaultWriteRoot();
  const fromDir = resolveCategoryPhysicalPath(fromPath);
  if (!fs.existsSync(fromDir)) return json(res, { error: 'Source folder not found' }, 404);
  const folderName = path.basename(fromDir);
  const toDir = toParentPath ? path.join(base, toParentPath, folderName) : path.join(base, folderName);
  if (!toDir.startsWith(path.resolve(base))) return json(res, { error: 'Invalid target path' }, 400);
  if (toDir === fromDir) return json(res, { error: 'Source and destination are the same' }, 400);
  if (toDir.startsWith(fromDir + path.sep)) return json(res, { error: 'Cannot move folder into itself' }, 400);
  if (fs.existsSync(toDir)) return json(res, { error: 'Target already exists' }, 409);
  try {
    fs.renameSync(fromDir, toDir);
    invalidateScanCache();
    json(res, { ok: true });
  } catch (e) { json(res, { error: e.message }, 500); }
}

async function apiVideoDetail(req, res, id) {
  const videos = await allVideos();
  const v      = videos.find(x => x.id === id);
  if (!v) return json(res, { error: 'Not found' }, 404);

  const favs  = loadFavs();
  const meta  = loadVideoMeta();
  const vMeta = meta[v.id] || {};
  const video = { ...v, fav: favs.includes(v.id), rating: vMeta.rating ?? null, language: vMeta.language || '', chapters: vMeta.chapters || [] };

  const actors         = loadActors();
  const metaActors     = vMeta.actors || [];
  const filenameActors = actors.filter(e => actorMatchesAny(v.name, e.terms)).map(e => e.name);
  const combinedActors = [...new Set([...metaActors, ...filenameActors])];
  const metaTags       = vMeta.tags || [];

  const allTagSet = new Set();
  for (const entry of Object.values(meta)) {
    if (Array.isArray(entry.tags)) entry.tags.forEach(t => allTagSet.add(t));
  }
  loadFolderMappings().forEach(e => allTagSet.add(e.displayName));

  const enabledPaths = loadEnabledFolders();
  const visibleVideos = enabledPaths.length ? videos.filter(x => isFolderEnabled(x.catPath, enabledPaths)) : videos;

  // Build actor → [videoId] inverted index from the already-loaded meta map.
  const actorIndex = new Map(); // actorLower → Set<videoId>
  for (const [vid, m] of Object.entries(meta)) {
    for (const a of (m.actors || [])) {
      const k = a.toLowerCase();
      let s = actorIndex.get(k);
      if (!s) { s = new Set(); actorIndex.set(k, s); }
      s.add(vid);
    }
  }

  // Collect candidate video IDs that share at least one actor with this video.
  const candidateIds = new Set();
  for (const a of combinedActors) {
    const s = actorIndex.get(a.toLowerCase());
    if (s) s.forEach(id => candidateIds.add(id));
  }
  candidateIds.delete(v.id);

  // Score only candidates (shared actors) plus same-category videos.
  const sameCat = visibleVideos.filter(x => x.id !== v.id && x.category === v.category && !candidateIds.has(x.id));
  const candidates = visibleVideos.filter(x => candidateIds.has(x.id));

  const scored = [
    ...candidates.map(x => {
      const xActors = meta[x.id]?.actors || [];
      const shared = combinedActors.filter(a => xActors.some(xa => xa.toLowerCase() === a.toLowerCase()));
      return { video: x, score: shared.length * 100 + (x.category === v.category ? 50 : 0) };
    }),
    ...sameCat.map(x => ({ video: x, score: 50 })),
  ];

  const suggested = scored
    .sort((a, b) => b.score - a.score || Math.random() - 0.5)
    .slice(0, 12)
    .map(item => ({ ...item.video, fav: favs.includes(item.video.id), rating: meta[item.video.id]?.rating ?? null }));

  json(res, { video, suggested, actors: combinedActors, tags: metaTags, allCategories: [...allTagSet].sort(), channel: vMeta.channel || '' });
}

// ── Lightweight video detail (fast single-lookup) ──────────────────
async function apiVideoDetailFast(req, res, id) {
  // Load video from the DB index directly
  const db = require('./db-server');
  const v = db.getVideoIndexEntry(id);
  if (!v) {
    // Fallback to old method
    return apiVideoDetail(req, res, id);
  }

  // Enrich with metadata, favs, duration
  const meta = db.getSingleVideoMeta(id);
  const favs = db.loadFavs();
  const thumbsCache = db.loadThumbsCache();
  const actors = db.loadActors();
  const cats = db.loadFolderMappings();

  const fav = favs.includes(id);
  const cached = thumbsCache[id];
  const duration = cached?.duration || null;
  const vMeta = meta || {};
  const metaTags = vMeta.tags || [];
  const metaActors = vMeta.actors || [];
  const filenameActors = actors.filter(e => actorMatchesAny(v.name, e.terms)).map(e => e.name);
  const combinedActors = [...new Set([...metaActors, ...filenameActors])];

  // Build allCategories set
  const allTagSet = new Set();
  allTagSet.add(...metaTags);
  cats.forEach(e => allTagSet.add(e.displayName));

  // Build suggested using inverted actor index over bulk-loaded meta (avoids N SQLite reads).
  const enabledPaths = db.loadEnabledFolders();
  const allVisible = await allVideos();
  const visibleVideos = enabledPaths.length ? allVisible.filter(x => isFolderEnabled(x.catPath, enabledPaths)) : allVisible;
  const allMeta = db.loadVideoMeta();

  const actorIndex = new Map();
  for (const [vid, m] of Object.entries(allMeta)) {
    for (const a of (m.actors || [])) {
      const k = a.toLowerCase();
      let s = actorIndex.get(k);
      if (!s) { s = new Set(); actorIndex.set(k, s); }
      s.add(vid);
    }
  }

  const candidateIds = new Set();
  for (const a of combinedActors) {
    const s = actorIndex.get(a.toLowerCase());
    if (s) s.forEach(xid => candidateIds.add(xid));
  }
  candidateIds.delete(v.id);

  const sameCat = visibleVideos.filter(x => x.id !== v.id && x.category === v.category && !candidateIds.has(x.id));
  const candidateVids = visibleVideos.filter(x => candidateIds.has(x.id));

  const scored = [
    ...candidateVids.map(x => {
      const xActors = allMeta[x.id]?.actors || [];
      const shared = combinedActors.filter(a => xActors.some(xa => xa.toLowerCase() === a.toLowerCase()));
      const score = shared.length * 100 + (x.category === v.category ? 50 : 0);
      return { video: { ...x, fav: favs.includes(x.id), rating: allMeta[x.id]?.rating ?? null }, score };
    }),
    ...sameCat.map(x => ({ video: { ...x, fav: favs.includes(x.id), rating: allMeta[x.id]?.rating ?? null }, score: 50 })),
  ];

  const suggested = scored
    .sort((a, b) => b.score - a.score || Math.random() - 0.5)
    .slice(0, 12)
    .map(item => item.video);

  const video = { ...v, fav, rating: vMeta.rating ?? null, language: vMeta.language || '', reencoded: !!vMeta.reencoded, duration, durationF: formatDuration(duration), tags: metaTags, chapters: vMeta.chapters || [] };

  json(res, { video, suggested, actors: combinedActors, tags: metaTags, allCategories: [...allTagSet].sort(), channel: vMeta.channel || '' });
}

// ── Preload endpoint (fast startup data) ──────────────────────────
async function apiPreload(req, res) {
  const db = require('./db-server');
  // Load categories from server (this calls cachedScan which loads index from DB)
  // But we can do it faster: just count videos from the index
  let totalVideos = 0;
  let catCounts = {};
  try {
    const index = db.loadVideoIndex();
    if (index && index.length > 0) {
      totalVideos = index.length;
      // Count per category
      for (const v of index) {
        const cp = v.catPath || '';
        if (!cp) continue;
        catCounts[cp] = (catCounts[cp] || 0) + 1;
      }
    }
  } catch (e) {
    // Fallback: just return existing API data
    console.error('[preload] index load error:', e.message);
  }

  const enabledPaths = db.loadEnabledFolders();

  json(res, {
    totalVideos,
    catCounts,
    enabledPaths,
    ok: true
  });
}

async function apiStream(req, res, id) {
  const fp = safePath(id);
  if (!fp) { res.writeHead(404); res.end('Not found'); return; }
  
  // Optimize: Just check if encrypted without loading all videos
  let isEnc = false;
  let key = null;
  try {
    const meta = loadVideoMeta();
    if (meta[id]?.encrypted) {
      isEnc = true;
      // Get category path for this specific video
      const all = await cachedScan();
      const v = all.find(v => v.id === id);
      if (v) {
        key = isEnc ? getUnlockKey(v.catPath) : null;
      }
    }
  } catch {}
  
  if (isEnc && !key) {
    res.writeHead(401);
    return res.end('Category locked');
  }

  const stat = await fs.promises.stat(fp);
  const size = stat.size;
  const ext  = path.extname(fp).toLowerCase();
  const ct   = MIME[ext] || 'application/octet-stream';

  if (isEnc) {
    // Stream decrypt from file
    const ivLen = 12, tagLen = 16;
    const contentSize = size - ivLen - tagLen;

    const fd = fs.openSync(fp, 'r');
    const iv = Buffer.alloc(ivLen);
    fs.readSync(fd, iv, 0, ivLen, 0);
    const tag = Buffer.alloc(tagLen);
    fs.readSync(fd, tag, 0, tagLen, size - tagLen);
    fs.closeSync(fd);

    const range = req.headers.range;
    if (range) {
      const [s, e2] = range.replace(/bytes=/, '').split('-');
      let start = parseInt(s, 10);
      let end = e2 ? parseInt(e2, 10) : contentSize - 1;
      if (Number.isNaN(start)) start = 0;
      if (Number.isNaN(end)) end = contentSize - 1;
      if (start < 0 || end >= contentSize || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${contentSize}` });
        return res.end();
      }
      const chunkSz = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${contentSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSz,
        'Content-Type': ct,
        'Cache-Control': 'no-store'
      });

      const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
      dec.setAuthTag(tag);
      const src = fs.createReadStream(fp, { start: ivLen, end: size - tagLen - 1 });

      let pos = 0;
      let ended = false;
      
      const writeRange = (chunk) => {
        const chunkEnd = pos + chunk.length - 1;
        if (chunkEnd >= start && pos <= end) {
          const sl = Math.max(0, start - pos);
          const se = Math.min(chunk.length, end - pos + 1);
          res.write(chunk.slice(sl, se));
        }
        pos += chunk.length;
      };

      dec.on('data', writeRange);
      dec.on('end', () => {
        if (!ended) { ended = true; res.end(); }
      });
      dec.on('error', () => {
        if (!ended) { ended = true; res.end(); }
      });
      src.on('error', () => {
        if (!ended) { ended = true; try { res.end(); } catch {} }
      });
      src.pipe(dec);
    } else {
      res.writeHead(200, {
        'Content-Length': contentSize,
        'Content-Type': ct,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store'
      });
      const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
      dec.setAuthTag(tag);
      const src = fs.createReadStream(fp, { start: ivLen, end: size - tagLen - 1 });
      pipeline(src, dec, res, (err) => { if (err) try { res.end(); } catch {} });
    }
    return;
  }

  const range = req.headers.range;
  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    let start = parseInt(startStr, 10);
    let end   = endStr ? parseInt(endStr, 10) : size - 1;
    if (Number.isNaN(start)) start = 0;
    if (Number.isNaN(end)) end = size - 1;
    if (start < 0 || end >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': ct,
    });
    const rs = fs.createReadStream(fp, { start, end });
    rs.on('error', () => { try { res.destroy(); } catch {} });
    rs.pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': size, 'Content-Type': ct, 'Accept-Ranges': 'bytes' });
    const rs = fs.createReadStream(fp);
    rs.on('error', () => { try { res.destroy(); } catch {} });
    rs.pipe(res);
  }
}

function apiDelete(req, res, id) {
  const fp = safePath(id);

  // Stale entry: the file is gone from disk (safePath returns null) but it is
  // still referenced — in the index/DB, or only in a client-side cache that has
  // outlived a prune. Either way a normal delete 404s and the ghost looks
  // undeletable, so purge whatever records remain so it disappears for good.
  if (!fp) {
    const { deleteVideoMetaEverywhere } = require('./db-server');
    deleteVideoMetaEverywhere(id);
    const { THUMBS_DIR } = require('./config-server');
    const thumbDir = path.join(THUMBS_DIR, id);
    if (fs.existsSync(thumbDir)) try { fs.rmSync(thumbDir, { recursive: true, force: true }); } catch {}
    invalidateScanCache();
    return json(res, { ok: true, stale: true });
  }

  try {
    fs.unlinkSync(fp);
    invalidateScanCache();
    const favs = loadFavs();
    const fi   = favs.indexOf(id);
    if (fi !== -1) { favs.splice(fi, 1); saveFavs(favs); }
    const cache = loadThumbsCache();
    if (cache[id]) { delete cache[id]; saveThumbsCache(cache); }
    const { THUMBS_DIR } = require('./config-server');
    const thumbDir = path.join(THUMBS_DIR, id);
    if (fs.existsSync(thumbDir)) fs.rmSync(thumbDir, { recursive: true, force: true });
    const meta = loadVideoMeta();
    if (meta[id]) { delete meta[id]; saveVideoMeta(meta); }
    json(res, { ok: true });
  } catch (e) {
    // The file vanished between the existence check and unlink — treat it as a
    // stale entry and clean the DB rather than leaving an undeletable ghost.
    if (e.code === 'ENOENT') {
      const { deleteVideoMetaEverywhere } = require('./db-server');
      deleteVideoMetaEverywhere(id);
      invalidateScanCache();
      return json(res, { ok: true, stale: true });
    }
    json(res, { error: e.message }, 500);
  }
}

async function apiRename(req, res, id) {
  const body    = await readBody(req);
  const newName = (body.newName || '').trim();
  if (!newName) return json(res, { error: 'Name required' }, 400);
  const fp  = safePath(id);
  if (!fp) return json(res, { error: 'Not found' }, 404);
  const dir  = path.dirname(fp);
  const ext  = path.extname(fp);
  const safe = newName.replace(/[<>:"/\\|?*]/g, '_');
  const np   = path.join(dir, safe + ext);
  if (fs.existsSync(np) && np !== fp) return json(res, { error: 'Name already exists' }, 409);
  try {
    fs.renameSync(fp, np);

    // Rename subtitle sidecars to match the new video filename
    const oldBase = path.basename(fp, ext);
    const newBase = safe;
    try {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!ent.isFile()) continue;
        const subExt = path.extname(ent.name).toLowerCase();
        if (!SUBTITLE_EXT.has(subExt)) continue;
        const nameNoExt = ent.name.slice(0, -subExt.length);
        if (nameNoExt !== oldBase && !nameNoExt.startsWith(oldBase + '.')) continue;
        const suffix = nameNoExt.slice(oldBase.length);
        try { fs.renameSync(path.join(dir, ent.name), path.join(dir, newBase + suffix + subExt)); } catch {}
      }
    } catch {}

    invalidateScanCache();
    const newRel = path.relative(VIDEOS_DIR, np);
    const newId  = toId(newRel);
    const favs = loadFavs();
    const fi   = favs.indexOf(id);
    if (fi !== -1) { favs[fi] = newId; saveFavs(favs); }
    const meta = loadVideoMeta();
    if (meta[id]) { meta[newId] = { ...meta[id], title: safe }; delete meta[id]; saveVideoMeta(meta); }
    json(res, { ok: true, newId });
  } catch (e) { json(res, { error: e.message }, 500); }
}

async function apiMove(req, res, id) {
  const body           = await readBody(req);
  const targetCategory = (body.category ?? '').trim();
  const fp             = safePath(id);
  if (!fp) return json(res, { error: 'Not found' }, 404);

  const writeRoot = getDefaultWriteRoot();
  const resolvedWrite = path.resolve(writeRoot);

  const targetDir = targetCategory ? path.join(writeRoot, targetCategory) : writeRoot;
  const resolvedTarget = path.resolve(targetDir);
  if (!resolvedTarget.startsWith(resolvedWrite)) return json(res, { error: 'Invalid category' }, 400);
  if (!fs.existsSync(resolvedTarget)) fs.mkdirSync(resolvedTarget, { recursive: true });

  const filename = path.basename(fp);
  const newPath = path.join(resolvedTarget, filename);
  if (path.resolve(newPath) === path.resolve(fp)) return json(res, { error: 'Already in this category' }, 400);
  if (fs.existsSync(newPath)) return json(res, { error: 'A file with that name already exists in the target category' }, 409);

  // Files from a temporarily opened folder are *copied* into the library
  // (the original is left in place), not moved.
  let isOpened = false;
  try { isOpened = require('./opened-folders-server').isOpenedPath(fp); } catch {}
  if (isOpened) {
    try {
      fs.copyFileSync(fp, newPath);
      invalidateScanCache();
      const newResolved = path.resolve(newPath);
      const newId = newResolved.startsWith(path.resolve(VIDEOS_DIR))
        ? toId(path.relative(VIDEOS_DIR, newPath).replace(/\\/g, '/'))
        : toId(newPath);
      return json(res, { ok: true, newId, copied: true });
    } catch (e) { return json(res, { error: e.message }, 500); }
  }

  try {
    try {
      fs.renameSync(fp, newPath);
    } catch (renameErr) {
      if (renameErr.code === 'EXDEV') {
        // Cross-device (e.g. main <-> source root): copy then delete
        fs.copyFileSync(fp, newPath);
        fs.unlinkSync(fp);
      } else {
        throw renameErr;
      }
    }

    // Move subtitle sidecars alongside the video
    const oldDir  = path.dirname(fp);
    const oldBase = path.basename(fp, path.extname(fp));
    try {
      for (const ent of fs.readdirSync(oldDir, { withFileTypes: true })) {
        if (!ent.isFile()) continue;
        const subExt = path.extname(ent.name).toLowerCase();
        if (!SUBTITLE_EXT.has(subExt)) continue;
        const nameNoExt = ent.name.slice(0, -subExt.length);
        if (nameNoExt !== oldBase && !nameNoExt.startsWith(oldBase + '.')) continue;
        const oldSub = path.join(oldDir, ent.name);
        const newSub = path.join(resolvedTarget, ent.name);
        if (!fs.existsSync(newSub)) {
          try {
            fs.renameSync(oldSub, newSub);
          } catch (e) {
            if (e.code === 'EXDEV') { fs.copyFileSync(oldSub, newSub); fs.unlinkSync(oldSub); }
          }
        }
      }
    } catch {}

    invalidateScanCache();

    // Compute rel/id based on the scan root the *new* file lives under (main uses relative; sources use abs)
    const newResolved = path.resolve(newPath);
    let newRel, newId;
    if (newResolved.startsWith(path.resolve(VIDEOS_DIR))) {
      newRel = path.relative(VIDEOS_DIR, newPath).replace(/\\/g, '/');
      newId = toId(newRel);
    } else {
      newRel = newPath;
      newId = toId(newPath);
    }

    const favs = loadFavs();
    const fi = favs.indexOf(id);
    if (fi !== -1) { favs[fi] = newId; saveFavs(favs); }
    const meta = loadVideoMeta();
    if (meta[id]) { meta[newId] = { ...meta[id], category: targetCategory }; delete meta[id]; saveVideoMeta(meta); }
    json(res, { ok: true, newId });
  } catch (e) { json(res, { error: e.message }, 500); }
}

async function apiAutoSort(req, res) {
  const systemDirs = new Set([path.basename(VAULT_DIR), path.basename(IGNORED_DIR)]);
  let folders;
  try {
    folders = (await fs.promises.readdir(VIDEOS_DIR, { withFileTypes: true }))
      .filter(e => e.isDirectory() && !systemDirs.has(e.name))
      .map(e => e.name);
  } catch { return json(res, { moved: 0 }); }
  if (!folders.length) return json(res, { moved: 0 });

  let loose;
  try {
    loose = (await fs.promises.readdir(VIDEOS_DIR, { withFileTypes: true }))
      .filter(e => e.isFile() && VIDEO_EXT.has(path.extname(e.name).toLowerCase()))
      .map(e => e.name);
  } catch { return json(res, { moved: 0 }); }
  if (!loose.length) return json(res, { moved: 0 });

  const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  let moved = 0;
  const favs = loadFavs();
  let favsChanged = false;

  for (const filename of loose) {
    const nameNoExt = norm(path.basename(filename, path.extname(filename)));
    const match     = folders.find(folder => nameNoExt.includes(norm(folder)));
    if (!match) continue;
    const src = path.join(VIDEOS_DIR, filename);
    const dst = path.join(VIDEOS_DIR, match, filename);
    if (fs.existsSync(dst)) continue;
    try {
      await fs.promises.rename(src, dst);
      moved++;
      const oldId = toId(filename);
      const newId = toId(path.join(match, filename));
      const fi    = favs.indexOf(oldId);
      if (fi !== -1) { favs[fi] = newId; favsChanged = true; }
    } catch {}
  }
  if (favsChanged) saveFavs(favs);
  if (moved > 0) invalidateScanCache();
  json(res, { moved });
}

// ── Favourites / History / Ratings ───────────────────────────────────

async function apiFavourites(req, res) {
  const favs   = loadFavs();
  const videos = await allVideos();
  json(res, videos.filter(v => favs.includes(v.id)).map(v => ({ ...v, fav: true })));
}

function apiToggleFav(req, res, id) {
  const favs = loadFavs();
  const i    = favs.indexOf(id);
  if (i === -1) favs.push(id); else favs.splice(i, 1);
  saveFavs(favs);
  json(res, { fav: i === -1 });
}

async function apiAddHistory(req, res, id) {
  if (loadPrefs().chronologyMode === 'dont-save') return json(res, { ok: true });
  const videos = await allVideos();
  if (!videos.find(v => v.id === id)) return json(res, { ok: false });
  let h = loadHistory().filter(x => x !== id);
  h.unshift(id);
  if (h.length > 100) h = h.slice(0, 100);
  saveHistory(h);
  json(res, { ok: true });
}

async function apiGetHistory(req, res) {
  const h      = loadHistory();
  const videos = await allVideos();
  const map    = Object.fromEntries(videos.map(v => [v.id, v]));
  json(res, h.map(id => map[id]).filter(Boolean));
}

function apiClearHistory(req, res) {
  saveHistory([]);
  json(res, { ok: true });
}

function apiClearFavourites(req, res) {
  saveFavs([]);
  json(res, { ok: true });
}

function apiClearThumbs(req, res) {
  saveThumbsCache({});
  try {
    if (fs.existsSync(THUMBS_DIR)) {
      for (const f of fs.readdirSync(THUMBS_DIR)) {
        try { fs.unlinkSync(path.join(THUMBS_DIR, f)); } catch {}
      }
    }
  } catch {}
  json(res, { ok: true });
}

async function apiSetRating(req, res, id) {
  const body  = await readBody(req);
  const stars = parseInt(body.stars, 10);
  if (!Number.isFinite(stars) || stars < 1 || stars > 5) return json(res, { error: 'stars must be 1–5' }, 400);
  setVideoMetaFields(id, { rating: stars });
  broadcastScanChange();
  json(res, { ok: true, rating: stars });
}

function apiDeleteRating(req, res, id) {
  setVideoMetaFields(id, { rating: null });
  broadcastScanChange();
  json(res, { ok: true });
}

async function apiUpdateVideoMeta(req, res, id) {
  const videos = await allVideos();
  if (!videos.find(v => v.id === id)) return json(res, { error: 'Not found' }, 404);
  const body    = await readBody(req);
  const allowed = ['title', 'actors', 'tags', 'channel', 'rating', 'category', 'note', 'date', 'language', 'reencoded'];
  const fields  = {};
  for (const key of allowed) { if (key in body) fields[key] = body[key]; }
  setVideoMetaFields(id, fields);
  // Notify connected clients so the new tags/actors/channel/etc. appear on the
  // card right away instead of only after a manual reload. The frontend SSE
  // handler debounces, so rapid edits (e.g. adding several tags) coalesce.
  broadcastScanChange();
  json(res, { ok: true });
}

async function apiOpenFolder(req, res) {
  const body = await readBody(req);
  const id   = body.id || '';
  let folder;
  if (id) {
    const fp = safePath(id);
    if (!fp) return json(res, { error: 'Not found' }, 404);
    folder = path.dirname(fp);
  } else {
    folder = VIDEOS_DIR;
  }
  const cmd = process.platform === 'win32' ? `explorer "${folder}"`
    : process.platform === 'darwin' ? `open "${folder}"`
    : `xdg-open "${folder}"`;
  exec(cmd, () => {});
  json(res, { ok: true });
}

async function apiOpenFolderInExplorer(req, res) {
  const body = await readBody(req);
  const { path: catPath } = body;
  const full = path.join(VIDEOS_DIR, catPath || '');
  if (!fs.existsSync(full)) return json(res, { error: 'Not found' }, 404);

  const cmd = process.platform === 'win32' ? `explorer "${full}"`
    : process.platform === 'darwin' ? `open "${full}"`
    : `xdg-open "${full}"`;
  exec(cmd, () => {});
  json(res, { ok: true });
}

async function apiDuplicates(req, res) {
  const db = require('./db-server');
  // Real files only — exclude bookmark links (size 0, not on disk).
  const videos = (await allVideos()).filter(v => !v.isLink && v.size > 0);
  // Include all other media categories (audio, books, photos, files), not just videos.
  const media = loadMediaIndex().map(m => ({
    ...m,
    category: m.category || m.mediaType || 'Uncategorized',
  }));
  const all = [...videos, ...media];
  const favs   = loadFavs();
  const thumbs = db.loadThumbsCache();
  const bySize = new Map();
  for (const v of all) {
    if (!v.size || v.size <= 0) continue;
    if (!bySize.has(v.size)) bySize.set(v.size, []);
    const th = thumbs[v.id] || {};
    bySize.get(v.size).push({ ...v, fav: favs.includes(v.id), width: th.width || null, height: th.height || null });
  }
  const groups = [...bySize.values()]
    .filter(g => g.length > 1)
    .sort((a, b) => b[0].size - a[0].size);
  json(res, groups);
}

// ── Tags ─────────────────────────────────────────────────────────────

async function apiFoldersOverview(req, res) {
  const videos = await cachedScan();
  const meta   = loadVideoMeta();

  // ── Categories (from folder structure) ──
  const catMap = new Map();
  for (const v of videos) {
    if (v.catPath === '') continue;
    
    const parts = v.catPath.split('/');
    let currentPath = '';
    
    for (let i = 0; i < parts.length; i++) {
      currentPath = currentPath ? currentPath + '/' + parts[i] : parts[i];
      if (!catMap.has(currentPath)) {
        catMap.set(currentPath, { type: 'cat', name: currentPath.replace(/\//g, ' / '), path: currentPath, count: 0, ids: [], duration: 0 });
      }
      const e = catMap.get(currentPath);
      e.count++;
      e.ids.push(v.id);
      e.duration += (v.duration || 0);
    }
  }

  let links = [];
  try {
    links = loadLinksCache().items || [];
  } catch (e) {
    // Ignore
  }

  // Add links (remote videos) count
  for (const [key, e] of catMap.entries()) {
    if (key === 'Links') continue;
    const kn = e.path.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const bmCount = links.filter(it => it.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().includes(kn)).length;
    e.count += bmCount;
  }

  // Add virtual category "Links" if there are any playable links
  const playableLinks = links.filter(b => b.scrapedVideoUrl);
  if (playableLinks.length > 0) {
    const randomBm = playableLinks[Math.floor(Math.random() * playableLinks.length)];
    const thumbId = randomBm.img || '';
    catMap.set('Links', {
      type: 'cat',
      name: 'Links',
      path: 'Links',
      count: playableLinks.length,
      ids: [],
      thumbId: thumbId,
      duration: 0
    });
  }

  const filteredCats = [...catMap.values()];

  // Respect enabled folders for current profile/user (so browser does not show disabled folders)
  let catsForOverview = filteredCats;
  let _enabledPathsOv = [];
  try {
    const dbmod = require('./db-server');
    _enabledPathsOv = dbmod.loadEnabledFolders();
    catsForOverview = filteredCats.filter(c => isFolderEnabled(c.path, _enabledPathsOv));
  } catch (e) {
    console.error('[categories-overview] enabled filter error:', e.message);
  }

  // ── Tags ──
  const videosForTags = videos.filter(v => {
    return isFolderEnabled(v.catPath, _enabledPathsOv);
  });
  const folderNames = new Set(
    videosForTags.filter(v => v.catPath !== '').map(v => v.catPath.split(/[/\\]/)[0].toLowerCase())
  );
  const tagMap = new Map();
  for (const v of videosForTags) {
    for (const tag of (meta[v.id]?.tags || [])) {
      const lo = tag.toLowerCase();
      if (folderNames.has(lo)) continue;
      if (!tagMap.has(lo)) tagMap.set(lo, { type: 'tag', name: tag, count: 0, ids: [], duration: 0 });
      tagMap.get(lo).count++;
      tagMap.get(lo).ids.push(v.id);
      tagMap.get(lo).duration += (v.duration || 0);
    }
  }
  const unencryptedCats = new Set();
  for (const v of videos) {
    if (!v.encrypted && v.catPath) {
      unencryptedCats.add(getCatKey(v.catPath));
    }
  }

  // Add ghost entries for vault-encrypted categories (all videos moved to vault, none in scan)
  const vaultCatsOv = getVaultCategoryPaths();
  for (const catPath of vaultCatsOv) {
    if (!catMap.has(catPath)) {
      catMap.set(catPath, {
        type: 'cat',
        name: catPath.replace(/\//g, ' / '),
        path: catPath,
        count: 0,
        ids: [],
        duration: 0,
        _vaultEncrypted: true
      });
    } else {
      catMap.get(catPath)._hasVaultItems = true;
    }
  }

  // Re-derive catsForOverview to include vault ghosts (they passed filtering already since they're new)
  const allCatsForOverview = [...catsForOverview];
  for (const [key, e] of catMap.entries()) {
    if (e._vaultEncrypted && !catsForOverview.some(c => c.path === key)) {
      if (isFolderEnabled(key, _enabledPathsOv)) allCatsForOverview.push(e);
    }
  }

  const result = [...allCatsForOverview, ...tagMap.values()].map(e => {
    const isLinks = e.name === 'Links';
    const thumbId = e.thumbId || (e.ids && e.ids.length ? e.ids[Math.floor(Math.random() * e.ids.length)] : null);
    let encrypted = false;
    let partial = false;
    if (e.type === 'cat' && !isLinks) {
      const full = path.join(VIDEOS_DIR, e.path);
      const hasCatConfig = fs.existsSync(path.join(full, '.cat-enc-config.json'));
      encrypted = hasCatConfig || !!e._vaultEncrypted || !!e._hasVaultItems;
      if (encrypted) {
        partial = unencryptedCats.has(getCatKey(e.path));
      }
    }
    const unlocked = isLinks ? true : isUnlocked(e.path || '');
    return { type: e.type, name: e.name, path: e.path || null, count: e.count, thumbId, encrypted, partial, unlocked, duration: e.duration };
  });
  json(res, result);
}

async function apiTags(req, res) {
  const meta    = loadVideoMeta();
  const enabledPaths = loadEnabledFolders();
  const allVids = await allVideos();
  const videos  = enabledPaths.length ? allVids.filter(v => isFolderEnabled(v.catPath, enabledPaths)) : allVids;
  const folderNames = new Set(
    videos.filter(v => v.catPath !== '').map(v => v.catPath.split(/[/\\]/)[0].toLowerCase())
  );
  const tagMap = new Map();
  for (const v of videos) {
    const vMeta = meta[v.id] || {};
    for (const tag of (vMeta.tags || [])) {
      const lo = tag.toLowerCase();
      if (folderNames.has(lo)) continue;
      if (!tagMap.has(lo)) tagMap.set(lo, { name: tag, count: 0 });
      tagMap.get(lo).count++;
    }
  }
  json(res, [...tagMap.values()].sort((a, b) => a.name.localeCompare(b.name)));
}

async function apiTagVideos(req, res, tagName) {
  const meta   = loadVideoMeta();
  const enabledPaths = loadEnabledFolders();
  const allVids = await allVideos();
  const videos = enabledPaths.length ? allVids.filter(v => isFolderEnabled(v.catPath, enabledPaths)) : allVids;
  const favs   = loadFavs();
  const tagLo  = tagName.toLowerCase();

  const parsed = require('url').parse(req.url, true);
  const fav    = (parsed.query.fav === '1' || parsed.query.fav === 'true');

  let list = videos
    .filter(v => (meta[v.id]?.tags || []).some(t => t.toLowerCase() === tagLo))
    .map(v => ({ ...v, fav: favs.includes(v.id), rating: meta[v.id]?.rating ?? null }));
  
  if (fav) list = list.filter(v => v.fav);
  
  list.sort((a, b) => b.mtime - a.mtime);
  
  if (!list.length && !fav) return json(res, { error: 'Not found' }, 404);
  json(res, { tag: tagName, videos: list });
}

// ── DB-backed tag listing (grouped by displayName, matched on meta + filename) ──

function _catForName(name) {
  const cats  = loadFolderMappings();
  const nameLo = name.toLowerCase();
  return cats.find(c => c.displayName.toLowerCase() === nameLo)
      || cats.find(c => c.terms.some(t => t.toLowerCase() === nameLo));
}

async function apiDbTags(req, res) {
  const cats   = loadFolderMappings();
  const meta   = loadVideoMeta();
  const enabledPaths = loadEnabledFolders();
  const allVids = await allVideos();
  const videos = enabledPaths.length ? allVids.filter(v => isFolderEnabled(v.catPath, enabledPaths)) : allVids;
  const result = cats
    .map(cat => {
      const termsLo = cat.terms.map(t => t.toLowerCase());
      const count   = videos.filter(v => {
        const vTagsLo = (meta[v.id]?.tags || []).map(t => t.toLowerCase());
        return vTagsLo.some(t => termsLo.includes(t)) || wordMatchAny(v.name, cat.terms);
      }).length;
      return { displayName: cat.displayName, count, terms: cat.terms };
    })
    .filter(e => e.count > 0)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  json(res, result);
}

async function apiDbTagVideos(req, res, name) {
  const cat = _catForName(name);
  if (!cat) return json(res, { error: 'Not found' }, 404);
  const meta    = loadVideoMeta();
  const enabledPaths = loadEnabledFolders();
  const allVids = await allVideos();
  const videos  = enabledPaths.length ? allVids.filter(v => isFolderEnabled(v.catPath, enabledPaths)) : allVids;
  const favs    = loadFavs();
  const termsLo = cat.terms.map(t => t.toLowerCase());

  const parsed = require('url').parse(req.url, true);
  const fav    = (parsed.query.fav === '1' || parsed.query.fav === 'true');

  let list = videos
    .filter(v => {
      const vTagsLo = (meta[v.id]?.tags || []).map(t => t.toLowerCase());
      return vTagsLo.some(t => termsLo.includes(t)) || wordMatchAny(v.name, cat.terms);
    })
    .map(v => ({ ...v, fav: favs.includes(v.id), rating: meta[v.id]?.rating ?? null }));

  if (fav) list = list.filter(v => v.fav);

  list.sort((a, b) => b.mtime - a.mtime);

  if (!list.length && !fav) return json(res, { error: 'Not found' }, 404);
  json(res, { tag: cat.displayName, videos: list });
}

function apiVideoTags(req, res, id) {
  const meta = loadVideoMeta();
  json(res, { tags: meta[id]?.tags || [] });
}

function apiTagSuggestions(req, res) {
  const cats = loadFolderMappings();
  const seen = new Set();
  const result = [];
  for (const c of cats) {
    if (c.displayName && !seen.has(c.displayName.toLowerCase())) {
      seen.add(c.displayName.toLowerCase());
      result.push(c.displayName);
    }
    // c.terms = [name, ...tags]; skip index 0 (name) if displayName already covers it
    for (let i = 0; i < c.terms.length; i++) {
      const t = c.terms[i];
      if (!seen.has(t.toLowerCase())) {
        seen.add(t.toLowerCase());
        result.push(t);
      }
    }
  }
  json(res, result.sort((a, b) => a.localeCompare(b)));
}

function apiDeleteTag(req, res, tagName) {
  const { deleteTagFromAllVideos } = require('./db-server');
  deleteTagFromAllVideos(tagName);
  json(res, { ok: true });
}

async function apiRenameTag(req, res, tagName) {
  const body = await readBody(req);
  const newName = (body.newName || '').trim();
  if (!newName) return json(res, { error: 'newName required' }, 400);
  const { renameTagInAllVideos } = require('./db-server');
  renameTagInAllVideos(tagName, newName);
  json(res, { ok: true });
}

// ── Channels ──────────────────────────────────────────────────────────

async function apiChannels(req, res) {
  const channels = loadChannels();
  const allVids = await allVideos();
  const enabledPaths = loadEnabledFolders();
  const videos = enabledPaths.length ? allVids.filter(v => isFolderEnabled(v.catPath, enabledPaths)) : allVids;
  const meta    = loadVideoMeta();
  const result  = channels
    .map(e => ({
      name: e.name,
      count: videos.filter(v => {
        const ms = (meta[v.id]?.channel || '').toLowerCase();
        return ms === e.name.toLowerCase() || wordMatchAny(v.name, e.terms);
      }).length,
      website: e.website,
      description: e.description,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  json(res, result);
}

async function apiChannelVideos(req, res, channelName) {
  const channels = loadChannels();
  const entry   = channels.find(e => e.name.toLowerCase() === channelName.toLowerCase());
  if (!entry) return json(res, { error: 'Not found' }, 404);
  const allVids   = await allVideos();
  const enabledPaths = loadEnabledFolders();
  const videos = enabledPaths.length ? allVids.filter(v => isFolderEnabled(v.catPath, enabledPaths)) : allVids;
  const meta     = loadVideoMeta();
  const favs     = loadFavs();
  const channelLo = entry.name.toLowerCase();

  const parsed = require('url').parse(req.url, true);
  const fav    = (parsed.query.fav === '1' || parsed.query.fav === 'true');

  let list = videos
    .filter(v => {
      const ms = (meta[v.id]?.channel || '').toLowerCase();
      return ms === channelLo || wordMatchAny(v.name, entry.terms);
    })
    .map(v => ({ ...v, fav: favs.includes(v.id), rating: meta[v.id]?.rating ?? null }));

  if (fav) list = list.filter(v => v.fav);

  list.sort((a, b) => b.mtime - a.mtime);

  json(res, { channel: entry.name, videos: list });
}

// ── Subtitles ────────────────────────────────────────────────────────

const SUBTITLE_EXT = new Set(['.vtt', '.srt', '.ass', '.ssa', '.sub', '.smi']);

function apiAudioTracks(req, res, id) {
  const fp = safePath(id);
  if (!fp) return json(res, { error: 'Not found' }, 404);
  execFile(FFPROBE_BIN,
    ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-select_streams', 'a', fp],
    { timeout: 8000 },
    (err, out) => {
      if (err) return json(res, { tracks: [] });
      try {
        const streams = JSON.parse(out).streams || [];
        const tracks = streams.map((s, i) => ({
          index: i,
          language: (s.tags && s.tags.language) || '',
          title: (s.tags && s.tags.title) || '',
          codec: s.codec_name || '',
          channels: s.channels || 0,
        }));
        json(res, { tracks });
      } catch { json(res, { tracks: [] }); }
    }
  );
}

function apiSubtitles(req, res, id) {
  const fp = safePath(id);
  if (!fp) return json(res, []);
  const dir  = path.dirname(fp);
  const base = path.basename(fp, path.extname(fp));
  const found = [];

  // File-based subtitles
  try {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isFile()) continue;
      const ext = path.extname(ent.name).toLowerCase();
      if (!SUBTITLE_EXT.has(ext)) continue;
      const nameNoExt = ent.name.slice(0, -ext.length);
      // Accept exact match or "video.en.srt", "video.fr.vtt", etc.
      if (nameNoExt === base || nameNoExt.startsWith(base + '.')) {
        const label = nameNoExt.slice(base.length).replace(/^\./, '') || 'Default';
        found.push({ filename: ent.name, label, ext });
      }
    }
  } catch {}

  // Embedded subtitle streams (detected via ffprobe)
  try {
    const out = execFileSync(FFPROBE_BIN,
      ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-select_streams', 's', fp],
      { timeout: 5000 }
    ).toString();
    const streams = JSON.parse(out).streams || [];
    for (let i = 0; i < streams.length; i++) {
      const s = streams[i];
      const lang = (s.tags && s.tags.language) || '';
      const title = (s.tags && s.tags.title) || '';
      const label = title
        ? `${title}${lang ? ` (${lang})` : ''}`
        : (lang || `Embedded ${i + 1}`);
      found.unshift({ filename: null, label, type: 'embedded', streamIndex: i });
    }
  } catch {}

  json(res, found);
}

async function apiSaveSubtitles(req, res, id) {
  const fp = safePath(id);
  if (!fp) return json(res, { error: 'Not found' }, 404);
  const body = await readBody(req);
  const { vtt } = body;
  if (!vtt) return json(res, { error: 'VTT content required' }, 400);

  const dir  = path.dirname(fp);
  const base = path.basename(fp, path.extname(fp));
  const filename = `${base}.en.vtt`;
  const full = path.join(dir, filename);

  try {
    fs.writeFileSync(full, vtt);
    json(res, { ok: true, filename });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

async function apiUploadSubtitle(req, res, id) {
  const fp = safePath(id);
  if (!fp) return json(res, { error: 'Not found' }, 404);

  const xFilename = (req.headers['x-filename'] || '').replace(/[/\\]/g, '');
  const ext = path.extname(xFilename).toLowerCase();
  if (!SUBTITLE_EXT.has(ext)) return json(res, { error: 'Unsupported subtitle format' }, 400);

  const dir = path.dirname(fp);
  const base = path.basename(fp, path.extname(fp));
  // Derive label from uploaded filename (strip video base prefix if present)
  const uploaded = path.basename(xFilename, ext);
  const label = (uploaded.startsWith(base + '.') ? uploaded.slice(base.length + 1) : uploaded)
    .replace(/[^a-zA-Z0-9._-]/g, '') || 'sub';
  const saveName = `${base}.${label}${ext}`;
  const savePath = path.join(dir, saveName);

  const chunks = [];
  req.on('data', c => chunks.push(c));
  await new Promise(resolve => req.on('end', resolve));
  try {
    fs.writeFileSync(savePath, Buffer.concat(chunks));
    json(res, { ok: true, filename: saveName });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

function apiDeleteSubtitleFile(req, res, id, filename) {
  const fp = safePath(id);
  if (!fp) return json(res, { error: 'Not found' }, 404);
  const dir = path.dirname(fp);
  const base = path.basename(fp, path.extname(fp));
  const safeName = path.basename(filename);
  const ext = path.extname(safeName).toLowerCase();
  if (!SUBTITLE_EXT.has(ext)) return json(res, { error: 'Not a subtitle file' }, 400);
  const nameNoExt = safeName.slice(0, -ext.length);
  if (nameNoExt !== base && !nameNoExt.startsWith(base + '.')) {
    return json(res, { error: 'Filename mismatch' }, 400);
  }
  try {
    fs.unlinkSync(path.join(dir, safeName));
    json(res, { ok: true });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

function apiSubtitleFile(req, res, id, filename) {
  const fp = safePath(id);
  if (!fp) { res.writeHead(404); res.end('Not found'); return; }
  const dir      = path.dirname(fp);
  const base     = path.basename(fp, path.extname(fp));
  const ext      = path.extname(filename).toLowerCase();
  if (!SUBTITLE_EXT.has(ext)) { res.writeHead(400); res.end('Bad extension'); return; }
  const nameNoExt = filename.slice(0, -ext.length);
  if (nameNoExt !== base && !nameNoExt.startsWith(base + '.')) {
    res.writeHead(400); res.end('Filename mismatch'); return;
  }
  // Subtitle must reside in the same directory as the video (dir already validated by safePath)
  const full = path.resolve(dir, path.basename(filename));
  if (path.dirname(full) !== path.resolve(dir)) { res.writeHead(403); res.end('Forbidden'); return; }
  if (!fs.existsSync(full)) { res.writeHead(404); res.end('Not found'); return; }

  res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8' });

  if (ext === '.vtt') {
    fs.createReadStream(full).pipe(res);
  } else if (ext === '.srt') {
    // Fast in-memory SRT → VTT conversion
    try {
      const srt = fs.readFileSync(full, 'utf8');
      const vtt = 'WEBVTT\n\n' + srt
        .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
      res.end(vtt);
    } catch { res.end('WEBVTT\n'); }
  } else {
    // ASS / SSA / SUB / SMI — convert via ffmpeg
    const child = spawn(FFMPEG_BIN, ['-i', full, '-f', 'webvtt', '-'], { stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.pipe(res);
    child.on('error', () => { try { res.end('WEBVTT\n'); } catch {} });
  }
}

function apiSubtitleEmbedded(req, res, id, streamIndexStr) {
  const fp = safePath(id);
  if (!fp) { res.writeHead(404); res.end('Not found'); return; }
  const si = parseInt(streamIndexStr, 10);
  if (!Number.isFinite(si) || si < 0) { res.writeHead(400); res.end('Bad stream index'); return; }
  res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8' });
  const child = spawn(FFMPEG_BIN,
    ['-i', fp, '-map', `0:s:${si}`, '-f', 'webvtt', '-'],
    { stdio: ['ignore', 'pipe', 'ignore'] }
  );
  child.stdout.pipe(res);
  child.on('error', () => { try { res.end('WEBVTT\n'); } catch {} });
}

// ── Global import (video / audio / book by extension) ─────────────────

async function apiImport(req, res) {
  const filename     = decodeURIComponent(req.headers['x-filename'] || 'file');
  const categoryHdr  = (req.headers['x-category'] || '').trim();
  const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9.\-_ ()]/g, '_');
  const ext          = path.extname(safeFilename).toLowerCase();

  let destDir, kind;
  const writeRoot = getDefaultWriteRoot();
  if (VIDEO_EXT.has(ext)) {
    // Preserve nested folder paths ("Parent/Child") by sanitising each segment
    // independently and re-joining with "/" so subfolders can be created.
    const safeCat = categoryHdr
      ? categoryHdr.split('/').map(s => s.replace(/[^a-zA-Z0-9 \-_]/g, '').trim()).filter(Boolean).join('/')
      : '';
    destDir = safeCat ? path.join(writeRoot, safeCat) : writeRoot;
    kind = 'video';
  }
  else if (AUDIO_EXT.has(ext)) { destDir = AUDIO_DIR;  kind = 'audio'; }
  else if (BOOK_EXT.has(ext))  { destDir = BOOKS_DIR;  kind = 'book';  }
  else if (IMAGE_EXT.has(ext)) { destDir = PHOTOS_DIR; kind = 'photo'; }
  else { destDir = FILES_DIR; kind = 'file'; }

  if (kind === 'video' && !path.resolve(destDir).startsWith(path.resolve(writeRoot)))
    return json(res, { error: 'Invalid category' }, 400);

  fs.mkdirSync(destDir, { recursive: true });

  let outName = safeFilename, counter = 1;
  while (fs.existsSync(path.join(destDir, outName))) {
    outName = path.basename(safeFilename, ext) + ` (${counter++})` + ext;
  }

  const chunks = [];
  await new Promise((resolve, reject) => {
    req.on('data', c => chunks.push(c));
    req.on('end', resolve);
    req.on('error', reject);
  });
  const data = Buffer.concat(chunks);
  fs.writeFileSync(path.join(destDir, outName), data);

  let videoId = null;
  if (kind === 'video') {
    invalidateScanCache();
    const outFile = path.join(destDir, outName);
    const oRes = path.resolve(outFile);
    videoId = oRes.startsWith(path.resolve(VIDEOS_DIR))
      ? toId( path.relative(VIDEOS_DIR, outFile).replace(/\\/g, '/') )
      : toId(outFile);
  }

  if (kind === 'audio') {
    const meta = loadAudioMeta();
    meta[outName] = { title: path.basename(outName, ext), ext, size: data.length, sizeF: formatBytes(data.length), date: Date.now() };
    saveAudioMeta(meta);
  } else if (kind === 'book') {
    const meta = loadBooksMeta();
    meta[outName] = { title: path.basename(outName, ext), ext, size: data.length, sizeF: formatBytes(data.length), date: Date.now(), type: 'upload' };
    saveBooksMeta(meta);
  } else if (kind === 'file') {
    const absPath = path.join(FILES_DIR, outName);
    upsertFileMeta({ id: toId(absPath), filename: outName, title: path.basename(outName, ext), ext, size: data.length, sizeF: formatBytes(data.length), date: Date.now(), absPath });
  }
  json(res, { ok: true, kind, name: outName, id: videoId });
}

async function apiAddChapter(req, res, id) {
  const fp = safePath(id);
  if (!fp) return json(res, { error: 'Not found' }, 404);
  const body = await readBody(req);
  const { time, title } = body;
  if (time === undefined) return json(res, { error: 'Time required' }, 400);

  const meta = loadVideoMeta();
  if (!meta[id]) meta[id] = { title: '', actors: [], tags: [], channel: '', rating: null, category: '', note: '', date: '' };
  if (!meta[id].chapters) meta[id].chapters = [];
  
  const chapterId = Date.now().toString();
  meta[id].chapters.push({ id: chapterId, time, title: title || `Chapter ${meta[id].chapters.length + 1}` });
  meta[id].chapters.sort((a, b) => a.time - b.time);
  
  saveVideoMeta(meta);
  
  const thumbnails = require('./thumbnails-server');
  await thumbnails.genChapterThumb(id, fp, time, chapterId);
  
  json(res, { ok: true, chapterId });
}

async function apiDeleteChapter(req, res, id, chapterId) {
  const meta = loadVideoMeta();
  if (!meta[id] || !meta[id].chapters) return json(res, { error: 'Not found' }, 404);
  
  const idx = meta[id].chapters.findIndex(c => c.id === chapterId);
  if (idx === -1) return json(res, { error: 'Chapter not found' }, 404);
  
  meta[id].chapters.splice(idx, 1);
  saveVideoMeta(meta);
  
  const { THUMBS_DIR } = require('./config-server');
  const thumbPath = path.join(THUMBS_DIR, id, 'chapters', `${chapterId}.jpg`);
  if (fs.existsSync(thumbPath)) try { fs.unlinkSync(thumbPath); } catch {}
  
  json(res, { ok: true });
}

async function apiRenameFolder(req, res) {
  const body = await readBody(req);
  const oldPath = body.oldPath; // relative category path
  const newName = body.newName; // just the name
  
  if (!oldPath || !newName) return json(res, { error: 'oldPath and newName required' }, 400);
  
  const oldDir = resolveCategoryPhysicalPath(oldPath);
  if (!fs.existsSync(oldDir)) return json(res, { error: 'Category not found' }, 404);
  
  const parentDir = path.dirname(oldDir);
  const newDir = path.join(parentDir, newName.replace(/[<>:"/\\|?*]/g, '_'));
  
  if (fs.existsSync(newDir)) return json(res, { error: 'Target name already exists' }, 409);
  
  try {
    fs.renameSync(oldDir, newDir);
    invalidateScanCache();
    
    // Update metadata for all videos in this category (best-effort; id migration works reliably for videos under main VIDEOS_DIR root)
    const meta = loadVideoMeta();
    const oldPathFwd = oldPath.replace(/\\/g, '/');
    const wroot = getDefaultWriteRoot();
    const newBase = path.resolve(newDir).startsWith(path.resolve(wroot)) ? wroot : VIDEOS_DIR;
    const newPathRel = path.relative(newBase, newDir).replace(/\\/g, '/');
    
    let changed = false;
    for (const id of Object.keys(meta)) {
      const rel = fromId(id).replace(/\\/g, '/');
      if (rel.startsWith(oldPathFwd + '/') || rel === oldPathFwd) {
        const suffix = rel.substring(oldPathFwd.length);
        const newRel = newPathRel + suffix;
        const newId = toId(newRel);
        const newCatPath = path.dirname(newRel).replace(/\\/g, '/');
        meta[newId] = { ...meta[id], category: newCatPath === '.' ? '' : newCatPath };
        delete meta[id];
        changed = true;
      }
    }
    if (changed) saveVideoMeta(meta);
    
    json(res, { ok: true });
  } catch (e) { json(res, { error: e.message }, 500); }
}

async function apiDeleteFolder(req, res) {
  const body = await readBody(req);
  const catPath = body.path;
  if (!catPath) return json(res, { error: 'path required' }, 400);
  
  const dir = resolveCategoryPhysicalPath(catPath);
  if (!fs.existsSync(dir)) return json(res, { error: 'Category not found' }, 404);
  
  try {
    const writeRoot = getDefaultWriteRoot();
    const resolvedVidDir = path.resolve(VIDEOS_DIR);
    const moves = [];

    // 1. Move all videos in this folder to the root of the current default write path (making them uncategorized there)
    function moveRecursive(currentDir) {
      if (!fs.existsSync(currentDir)) return;
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const ent of entries) {
        const fullPath = path.join(currentDir, ent.name);
        if (ent.isDirectory()) {
          moveRecursive(fullPath);
        } else if (ent.isFile() && VIDEO_EXT.has(path.extname(ent.name).toLowerCase())) {
          let dst = path.join(writeRoot, ent.name);
          // If collision, rename with (1) etc.
          let counter = 1;
          const ext = path.extname(ent.name);
          const base = path.basename(ent.name, ext);
          while (fs.existsSync(dst)) {
            dst = path.join(writeRoot, `${base} (${counter++})${ext}`);
          }
          const resolvedSrc = path.resolve(fullPath);
          const oldRel = resolvedSrc.startsWith(resolvedVidDir)
            ? path.relative(VIDEOS_DIR, fullPath).replace(/\\/g, '/')
            : fullPath;
          fs.renameSync(fullPath, dst);
          const resolvedDst = path.resolve(dst);
          const newRel = resolvedDst.startsWith(resolvedVidDir)
            ? path.relative(VIDEOS_DIR, dst).replace(/\\/g, '/')
            : dst;
          const oldId = toId(oldRel);
          const newId = toId(newRel);
          if (oldId !== newId) moves.push({ oldId, newId });
        }
      }
    }

    moveRecursive(dir);

    // Migrate metadata and favourites for all moved videos
    if (moves.length > 0) {
      const meta = loadVideoMeta();
      const favs = loadFavs();
      let metaChanged = false;
      let favsChanged = false;
      for (const { oldId, newId } of moves) {
        if (meta[oldId]) { meta[newId] = { ...meta[oldId], category: '' }; delete meta[oldId]; metaChanged = true; }
        const fi = favs.indexOf(oldId);
        if (fi !== -1) { favs[fi] = newId; favsChanged = true; }
      }
      if (metaChanged) saveVideoMeta(meta);
      if (favsChanged) saveFavs(favs);
    }

    // 2. Delete the folder
    fs.rmSync(dir, { recursive: true, force: true });

    invalidateScanCache();
    json(res, { ok: true });
  } catch (e) { json(res, { error: e.message }, 500); }
}

async function apiHideFolder(req, res) {
  const body = await readBody(req);
  const name = body.name;
  if (!name) return json(res, { error: 'name required' }, 400);
  
  const hidden = loadHidden();
  if (!hidden.includes(name)) {
    hidden.push(name);
    saveHidden(hidden);
    invalidateScanCache();
  }
  json(res, { ok: true });
}

async function apiEncryptAllFolders(req, res) {
  const { deriveKeys } = require('./vault-server');
  const body = await readBody(req);
  const { password } = body;
  if (!password) return json(res, { error: 'password required' }, 400);
  
  if (masterPassword && password !== masterPassword) {
    return json(res, { error: 'Does not match master password' }, 401);
  }

  const allCategoryDirs = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        const full = path.join(dir, ent.name);
        if (path.resolve(full) === path.resolve(VAULT_DIR) || path.resolve(full) === path.resolve(IGNORED_DIR)) continue;
        allCategoryDirs.push(full);
        walk(full);
      }
    }
  }
  walk(VIDEOS_DIR);

  try {
    const salt = crypto.randomBytes(32).toString('hex');
    const { encKey, verifyHash } = await deriveKeys(password, salt);
    let encryptedCount = 0;

    for (const dir of allCategoryDirs) {
      const configPath = path.join(dir, '.cat-enc-config.json');
      if (fs.existsSync(configPath)) continue;

      fs.writeFileSync(configPath, JSON.stringify({ salt, verifyHash }));
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file.startsWith('.')) continue;
        if (VIDEO_EXT.has(path.extname(file).toLowerCase())) {
          await encryptFileInPlace(path.join(dir, file), encKey);
          console.log(`[ENC-ALL] ${file} (Category: ${path.basename(dir)})`);
        }
      }

      const relCat = path.relative(VIDEOS_DIR, dir).replace(/\\/g, '/');
      const videos = (await cachedScan()).filter(v => getCatKey(v.catPath) === getCatKey(relCat));
      for (const v of videos) {
        const thumbDir = path.join(THUMBS_DIR, v.id);
        if (fs.existsSync(thumbDir)) {
          for (const tf of fs.readdirSync(thumbDir)) {
            if (tf.endsWith('.jpg')) await encryptFileInPlace(path.join(thumbDir, tf), encKey);
          }
        }
      }
      unlockedFolders.set(getCatKey(relCat), encKey);
      encryptedCount++;
    }

    invalidateScanCache();
    json(res, { ok: true, count: encryptedCount });
  } catch (e) { json(res, { error: e.message }, 500); }
}

async function apiEncryptFolder(req, res) {
  const { isUnlocked, encryptLocalFileToVault, getVaultKey } = require('./vault-server');
  const { loadVaultConfig } = require('./db-server');
  
  const body = await readBody(req);
  const { path: catPath } = body;
  
  if (!catPath) return json(res, { error: 'path required' }, 400);
  
  if (!loadVaultConfig()) {
    return json(res, { error: 'Master vault password is not set' }, 400);
  }
  
  if (!isUnlocked()) {
    return json(res, { error: 'Vault is locked. Unlock it first' }, 401);
  }
  
  const dir = path.join(VIDEOS_DIR, catPath);
  if (!fs.existsSync(dir)) {
    // Directory may not exist for virtual/root categories — check if any videos match
    const ck = getCatKey(catPath);
    const scanned = await cachedScan();
    const hasVideos = scanned.some(v => {
      const vk = getCatKey(v.catPath);
      return vk === ck || vk.startsWith(ck + '/');
    });
    if (!hasVideos) return json(res, { error: 'Category not found' }, 404);
  }

  // Start background encryption task and return immediately. Progress is available via /api/encryption/status
  try {
    if (_encryptionProgress.running) return json(res, { error: 'Another encryption/decryption is already running' }, 409);
    // Kick off background job
    runEncryptFolder(catPath).catch(err => console.error('[apiEncryptCategory] background error:', err));
    json(res, { ok: true });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

// Walk a category path (e.g. "Movies/Action/2020s") and ensure a matching chain
// of vault folder entries exists, creating missing ones with proper parent links.
// Returns the leaf folder id. Mutates vaultMeta in place; caller must saveVaultMeta.
function _ensureVaultFolderPath(catPath, vaultMeta) {
  const parts = catPath.replace(/\\/g, '/').split('/').filter(Boolean);
  let parentId = null;
  for (const name of parts) {
    const entry = Object.entries(vaultMeta).find(
      ([, m]) => m.type === 'folder' && m.name === name && (m.parent || null) === parentId
    );
    if (entry) {
      parentId = entry[0];
    } else {
      const fid = require('crypto').randomUUID();
      vaultMeta[fid] = { type: 'folder', name, parent: parentId, mtime: Date.now() };
      parentId = fid;
    }
  }
  return parentId;
}

// Encrypt a single scanned video entry into the Vault: shred the original,
// move + encrypt its thumbnail, drop the public DB entry. Returns the new
// vault id. Throws on failure. Shared by the single-file endpoint and the
// generic batch encryptor so both behave identically.
async function _encryptVideoEntry(v) {
  const { encryptLocalFileToVault, getVaultKey } = require('./vault-server');

  // External files store their absolute path in `rel`; local ones are relative to VIDEOS_DIR.
  const full = v.isExternal ? v.rel : path.join(VIDEOS_DIR, v.rel);
  if (!fs.existsSync(full)) throw new Error('File not found on disk');

  const meta = loadVideoMeta();
  const videoMeta = meta[v.id] || null;
  const vaultKey = getVaultKey();

  // Pass the real filename (with extension) — v.name has the extension stripped
  const vaultId = await encryptLocalFileToVault(full, path.basename(v.rel), v.catPath, videoMeta);
  if (!vaultId) throw new Error('Encryption failed');

  // Replicate the full category path as nested vault folders and assign the file to the leaf
  if (v.catPath) {
    const { loadVaultMeta: lvm, saveVaultMeta: svm } = require('./db-server');
    const vaultMeta = lvm();
    const folderId = _ensureVaultFolderPath(v.catPath, vaultMeta);
    if (vaultMeta[vaultId]) vaultMeta[vaultId].folder = folderId;
    svm(vaultMeta);
  }

  // Wipe the public thumbnail: move it under the vault id and encrypt it in
  // place so no plaintext preview of the encrypted file is left on disk.
  const oldThumb = path.join(THUMBS_DIR, v.id);
  const newThumb = path.join(THUMBS_DIR, vaultId);
  if (fs.existsSync(oldThumb)) {
    if (fs.existsSync(newThumb)) fs.rmSync(newThumb, { recursive: true, force: true });
    fs.renameSync(oldThumb, newThumb);
    const tFiles = fs.readdirSync(newThumb);
    for (const tf of tFiles) {
      if (tf.endsWith('.jpg')) await encryptFileInPlace(path.join(newThumb, tf), vaultKey);
    }
    const chaptersDir = path.join(newThumb, 'chapters');
    if (fs.existsSync(chaptersDir)) {
      for (const cf of fs.readdirSync(chaptersDir)) {
        if (cf.endsWith('.jpg')) await encryptFileInPlace(path.join(chaptersDir, cf), vaultKey);
      }
    }
  }

  // Delete subtitle sidecars — they cannot follow the video into the encrypted vault
  const subDir  = path.dirname(full);
  const subBase = path.basename(full, path.extname(full));
  try {
    for (const ent of fs.readdirSync(subDir, { withFileTypes: true })) {
      if (!ent.isFile()) continue;
      const subExt = path.extname(ent.name).toLowerCase();
      if (!SUBTITLE_EXT.has(subExt)) continue;
      const nameNoExt = ent.name.slice(0, -subExt.length);
      if (nameNoExt !== subBase && !nameNoExt.startsWith(subBase + '.')) continue;
      try { fs.unlinkSync(path.join(subDir, ent.name)); } catch {}
    }
  } catch {}

  // Remove the original entry from the public database(s)
  const { deleteVideoMetaEverywhere } = require('./db-server');
  deleteVideoMetaEverywhere(v.id);
  return vaultId;
}

// Encrypt a photo/book that lives as a plain file on disk. Resolves the
// file path per media kind, encrypts it into the Vault and wipes any
// generated thumbnail. Returns the new vault id or null when unresolved.
async function _encryptDiskMediaItem(item) {
  const { encryptLocalFileToVault } = require('./vault-server');
  let fp = null;

  if (item.kind === 'photo') {
    try { fp = require('./photos-server').getPhotoPath(item.id); } catch { fp = null; }
  } else if (item.kind === 'book') {
    const { BOOKS_DIR } = require('./config-server');
    let filename = '';
    try { filename = Buffer.from(item.id, 'base64url').toString('utf-8'); } catch { filename = ''; }
    const cand = path.join(BOOKS_DIR, path.basename(filename));
    if ((cand.startsWith(BOOKS_DIR + path.sep) || cand === BOOKS_DIR) && fs.existsSync(cand)) fp = cand;
  }

  if (!fp || !fs.existsSync(fp)) throw new Error('File not found on disk');

  const vaultId = await encryptLocalFileToVault(fp, path.basename(fp), null, null);
  if (!vaultId) throw new Error('Encryption failed');

  // Wipe any generated thumbnail keyed by the original id
  try {
    const oldThumb = path.join(THUMBS_DIR, item.id);
    if (fs.existsSync(oldThumb)) fs.rmSync(oldThumb, { recursive: true, force: true });
  } catch { }
  return vaultId;
}

// Background batch encryptor used by the Vault's Global view. Encrypts a
// mixed list of [{ id, kind, name }] into the Vault, reporting progress
// through the shared tracker so it shows in Sync & Background Tasks.
async function runEncryptBatch(items) {
  if (_encryptionProgress.running) return false;
  _encryptionCancel = false;
  const { isUnlocked, suspendAutoLock, resumeAutoLock } = require('./vault-server');
  const { loadVaultConfig } = require('./db-server');

  if (!loadVaultConfig()) { updateEncryptionProgress({ error: 'Master vault password is not set', running: false }); return false; }
  if (!isUnlocked()) { updateEncryptionProgress({ error: 'Vault is locked. Unlock it first', running: false }); return false; }

  updateEncryptionProgress({ running: true, type: 'encrypt', category: 'Vault import', total: items.length, done: 0, current: '', error: '', ok: false });
  let done = 0;
  // Keep the vault unlocked for the duration — see runEncryptFolder.
  suspendAutoLock();
  try {
    const vids = await allVideos(true);
    const vidMap = new Map(vids.map(v => [v.id, v]));
    for (const it of items) {
      if (_encryptionCancel) { updateEncryptionProgress({ error: 'Cancelled', running: false }); return false; }
      try {
        if (it.kind === 'photo' || it.kind === 'book') {
          await _encryptDiskMediaItem(it);
        } else {
          const v = vidMap.get(it.id);
          if (v && !v.encrypted) await _encryptVideoEntry(v);
        }
      } catch (e) {
        console.error('[encrypt-batch] failed for', it.id, e.message);
      }
      done++;
      updateEncryptionProgress({ done, current: it.name || it.id });
    }
    invalidateScanCache();
    updateEncryptionProgress({ ok: true, running: false });
    return true;
  } catch (e) {
    console.error('[runEncryptBatch] error:', e);
    updateEncryptionProgress({ error: e.message || String(e), running: false });
    return false;
  } finally {
    resumeAutoLock();
  }
}

async function apiEncryptVideo(req, res, id) {
  const { isUnlocked, suspendAutoLock, resumeAutoLock } = require('./vault-server');
  const { loadVaultConfig } = require('./db-server');

  if (!loadVaultConfig()) return json(res, { error: 'Master vault password is not set' }, 400);
  if (!isUnlocked()) return json(res, { error: 'Vault is locked. Unlock it first' }, 401);
  if (_encryptionProgress.running) return json(res, { error: 'Another encryption/decryption is already running' }, 409);

  // forceAll=true so the file is found regardless of the active profile —
  // when the Vault profile is active, allVideos() would otherwise return only
  // already-encrypted files and this would 404 every public file.
  const vids = await allVideos(true);
  const v = vids.find(x => x.id === id);
  if (!v) return json(res, { error: 'Not found' }, 404);
  if (v.encrypted) return json(res, { error: 'Already encrypted' }, 400);

  updateEncryptionProgress({ running: true, type: 'encrypt', category: v.name, total: 1, done: 0, current: v.name, error: '', ok: false });
  suspendAutoLock();
  try {
    const vaultId = await _encryptVideoEntry(v);
    invalidateScanCache();
    updateEncryptionProgress({ done: 1, ok: true, running: false });
    json(res, { ok: true, vaultId });
  } catch (e) {
    updateEncryptionProgress({ error: e.message, running: false });
    json(res, { error: e.message }, 500);
  } finally {
    resumeAutoLock();
  }
}

// Start a background batch encryption of mixed media into the Vault.
async function apiEncryptBatch(req, res) {
  const { isUnlocked } = require('./vault-server');
  const { loadVaultConfig } = require('./db-server');

  if (!loadVaultConfig()) return json(res, { error: 'Master vault password is not set' }, 400);
  if (!isUnlocked()) return json(res, { error: 'Vault is locked. Unlock it first' }, 401);

  const body = await readBody(req);
  const items = Array.isArray(body.items) ? body.items.filter(it => it && it.id) : [];
  if (!items.length) return json(res, { error: 'No items provided' }, 400);
  if (_encryptionProgress.running) return json(res, { error: 'Another encryption/decryption is already running' }, 409);

  runEncryptBatch(items).catch(err => console.error('[apiEncryptBatch] background error:', err));
  json(res, { ok: true, total: items.length });
}

async function encryptFileInPlace(filePath, key) {
  const outPath = filePath + '.enc';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  const out = fs.createWriteStream(outPath);
  out.write(iv);
  
  const src = fs.createReadStream(filePath);
  await pipe(src, cipher, out);
  
  // Write tag
  fs.appendFileSync(outPath, cipher.getAuthTag());
  fs.unlinkSync(filePath);
}

async function apiUnlockFolder(req, res) {
  const { deriveKeys } = require('./vault-server');
  const body = await readBody(req);
  const { path: catPath, password: rawPw } = body;
  const password = (rawPw || '').trim();
  
  if (!catPath || !password) return json(res, { error: 'path and password required' }, 400);
  
  if (masterPassword && password !== masterPassword) {
    return json(res, { error: 'Does not match master password' }, 401);
  }
  
  const dir = path.join(VIDEOS_DIR, catPath);
  const configPath = path.join(dir, '.cat-enc-config.json');
  if (!fs.existsSync(configPath)) return json(res, { error: 'Category not encrypted' }, 404);
  
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const { encKey, verifyHash } = await deriveKeys(password, config.salt);
    
    if (verifyHash !== config.verifyHash) return json(res, { error: 'Wrong password' }, 401);
    
    if (!masterPassword) {
      masterPassword = password;
    }
    
    unlockedFolders.set(getCatKey(catPath), encKey);

    // Try to unlock subfolders recursively if they use the same password
    const ck = getCatKey(catPath);
    const subCats = [...new Set((await cachedScan()).filter(v => {
      const vk = getCatKey(v.catPath);
      return vk.startsWith(ck + '/');
    }).map(v => v.catPath))];

    const keyCache = new Map();
    keyCache.set(config.salt, encKey);

    for (const sc of subCats) {
      const sDir = path.join(VIDEOS_DIR, sc);
      const sConfPath = path.join(sDir, '.cat-enc-config.json');
      if (fs.existsSync(sConfPath)) {
        try {
          const sConf = JSON.parse(fs.readFileSync(sConfPath, 'utf-8'));
          if (keyCache.has(sConf.salt)) {
             unlockedFolders.set(getCatKey(sc), keyCache.get(sConf.salt));
          } else {
             const { encKey: sKey, verifyHash: sHash } = await deriveKeys(password, sConf.salt);
             if (sHash === sConf.verifyHash) {
                keyCache.set(sConf.salt, sKey);
                unlockedFolders.set(getCatKey(sc), sKey);
             }
          }
        } catch {}
      }
    }

    json(res, { ok: true });
  } catch (e) { json(res, { error: e.message }, 500); }
}

async function apiDecryptFolder(req, res) {
  const { isUnlocked, getVaultKey } = require('./vault-server');
  const { loadVaultMeta, saveVaultMeta, switchProfile, getCurrentProfile, setVideoMetaFields } = require('./db-server');
  
  const body = await readBody(req);
  const { path: catPath, targetProfile } = body;
  
  if (!catPath || !targetProfile) return json(res, { error: 'path and targetProfile required' }, 400);
  
  if (!isUnlocked()) {
    return json(res, { error: 'Vault is locked. Unlock it first' }, 401);
  }
  
  // Start background decryption task and return immediately
  try {
    if (_encryptionProgress.running) return json(res, { error: 'Another encryption/decryption is already running' }, 409);
    runDecryptFolder(catPath, targetProfile).catch(err => console.error('[apiDecryptCategory] background error:', err));
    json(res, { ok: true });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

async function decryptFile(encPath, outPath, key) {
  const stat = fs.statSync(encPath);
  const size = stat.size;
  const ivLen = 12, tagLen = 16;
  
  const fd = fs.openSync(encPath, 'r');
  const iv = Buffer.alloc(ivLen);
  fs.readSync(fd, iv, 0, ivLen, 0);
  const tag = Buffer.alloc(tagLen);
  fs.readSync(fd, tag, 0, tagLen, size - tagLen);
  fs.closeSync(fd);
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  
  const out = fs.createWriteStream(outPath);
  const src = fs.createReadStream(encPath, { start: ivLen, end: size - tagLen - 1 });
  await pipe(src, decipher, out);
  
  fs.unlinkSync(encPath);
}

async function decryptThumbnailInPlace(filePath, key) {
  const stat = fs.statSync(filePath);
  const size = stat.size;
  const ivLen = 12, tagLen = 16;
  
  if (size < ivLen + tagLen) return; // Invalid file
  
  const fd = fs.openSync(filePath, 'r');
  const iv = Buffer.alloc(ivLen);
  fs.readSync(fd, iv, 0, ivLen, 0);
  const tag = Buffer.alloc(tagLen);
  fs.readSync(fd, tag, 0, tagLen, size - tagLen);
  fs.closeSync(fd);
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  
  const tmpPath = filePath + '.tmp';
  const out = fs.createWriteStream(tmpPath);
  const src = fs.createReadStream(filePath, { start: ivLen, end: size - tagLen - 1 });
  await pipe(src, decipher, out);
  
  fs.unlinkSync(filePath);
  fs.renameSync(tmpPath, filePath);
}

async function decryptFileInPlace(filePath, key) {
  const outPath = filePath.replace(/\.enc$/, '');
  const stat = fs.statSync(filePath);
  const size = stat.size;
  const ivLen = 12, tagLen = 16;
  
  const fd = fs.openSync(filePath, 'r');
  const iv = Buffer.alloc(ivLen);
  fs.readSync(fd, iv, 0, ivLen, 0);
  const tag = Buffer.alloc(tagLen);
  fs.readSync(fd, tag, 0, tagLen, size - tagLen);
  fs.closeSync(fd);
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  
  const out = fs.createWriteStream(outPath);
  const src = fs.createReadStream(filePath, { start: ivLen, end: size - tagLen - 1 });
  await pipe(src, decipher, out);
  
  fs.unlinkSync(filePath);
}

function toastServer(msg) {
  // Mock or console log for now
  console.log('[cat-enc]', msg);
}

function getUnlockedFolderKey(catPath) {
  return getUnlockKey(catPath);
}

function apiVideosUpload(req, res) {
  const writeRoot = getDefaultWriteRoot();
  fs.mkdirSync(writeRoot, { recursive: true });
  const rawName = req.headers['x-filename'] || 'video.mp4';
  const safeName = path.basename(rawName).replace(/[^a-zA-Z0-9._\-\s]/g, '_');
  
  const dest = path.join(writeRoot, safeName);
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    try {
      fs.writeFileSync(dest, Buffer.concat(chunks));
      invalidateScanCache();
      json(res, { ok: true, file: safeName });
    } catch (e) { json(res, { error: e.message }, 500); }
  });
}

async function apiRescan(req, res) {
  console.log('[scan] Manual rescan triggered');
  invalidateScanCache();
  const videos = await cachedScan();
  console.log(`[scan] Rescan complete — ${videos.length} video${videos.length !== 1 ? 's' : ''} indexed`);
  json(res, { ok: true });
}

// Auto-categorize uncategorized videos (and links) by matching filename against category terms.
// Videos are moved within their own root (VIDEOS_DIR or external source folder).
async function apiAutoCategorizeUncategorized(req, res) {
  const cats = loadFolderMappings();
  const prefs = loadPrefs();
  const sourceFolders = (prefs.sourceFolders || []).filter(sf => fs.existsSync(sf));
  const roots = [VIDEOS_DIR, ...sourceFolders];

  let movedVideos = 0;
  const errors = [];

  for (const root of roots) {
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    const existing = getExistingTopLevelFolders(root);

    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const ext = path.extname(ent.name).toLowerCase();
      if (!VIDEO_EXT.has(ext)) continue;

      const stem = path.basename(ent.name, ext);
      let matched = null;
      for (const cat of cats) {
        if (wordMatchAny(stem, cat.terms)) { matched = cat; break; }
      }
      if (!matched) continue;

      const destFolder = matched.displayName || matched.name;
      if (!existing.has(destFolder)) continue;

      const src = path.join(root, ent.name);
      const destDir = path.join(root, destFolder);
      try {
        // never create new folders for auto-tagging; only move into existing ones
        if (!fs.existsSync(destDir)) continue;
        // Generate unique dest name
        let dest = path.join(destDir, ent.name);
        if (fs.existsSync(dest)) {
          let n = 1;
          do { dest = path.join(destDir, `${stem}_${n}${ext}`); n++; } while (fs.existsSync(dest));
        }
        fs.renameSync(src, dest);
        movedVideos++;
      } catch (e) {
        errors.push(`${ent.name}: ${e.message}`);
      }
    }
  }

  // Also auto-categorize uncategorized links
  let categorizedLinks = 0;
  try {
    const { loadLinksCache, upsertLink } = require('./db-server');
    const items = loadLinksCache().items || [];
    const VIRTUAL = new Set(['', 'links', 'uncategorized']);
    for (const item of items) {
      if (item.category && !VIRTUAL.has(item.category.toLowerCase())) continue;
      const text = (item.title || '') + ' ' + (item.url || '');
      for (const cat of cats) {
        if (wordMatchAny(text, cat.terms)) {
          item.category = cat.displayName || cat.name;
          upsertLink(item);
          categorizedLinks++;
          break;
        }
      }
    }
  } catch (e) {
    errors.push('links: ' + e.message);
  }

  invalidateScanCache();
  json(res, { ok: true, movedVideos, categorizedLinks, errors });
}

async function apiRecategorizeAll(req, res) {
  const cats = loadFolderMappings();
  const prefs = loadPrefs();
  const roots = [VIDEOS_DIR, ...(prefs.sourceFolders || []).filter(sf => fs.existsSync(sf))];
  let movedVideos = 0;
  const errors = [];

  for (const root of roots) {
    const files = [];
    const collect = (dir) => {
      let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (e.isDirectory() && !isHiddenFolderName(e.name)) collect(path.join(dir, e.name));
        else if (e.isFile() && VIDEO_EXT.has(path.extname(e.name).toLowerCase()))
          files.push(path.join(dir, e.name));
      }
    };
    collect(root);
    const existing = getExistingTopLevelFolders(root);

    for (const src of files) {
      const ext = path.extname(src).toLowerCase();
      const stem = path.basename(src, ext);
      let matched = null;
      for (const cat of cats) { if (wordMatchAny(stem, cat.terms)) { matched = cat; break; } }
      if (!matched) continue;
      const destFolder = matched.displayName || matched.name;
      const destDir = path.join(root, destFolder);
      if (path.resolve(path.dirname(src)) === path.resolve(destDir)) continue;
      if (!existing.has(destFolder)) continue;
      try {
        // never create new folders for auto-tagging; only move into existing ones
        if (!fs.existsSync(destDir)) continue;
        let dest = path.join(destDir, path.basename(src));
        if (fs.existsSync(dest)) {
          let n = 1;
          do { dest = path.join(destDir, `${stem}_${n}${ext}`); n++; } while (fs.existsSync(dest));
        }
        fs.renameSync(src, dest);
        movedVideos++;
      } catch (e) { errors.push(`${path.basename(src)}: ${e.message}`); }
    }
  }

  let categorizedLinks = 0;
  try {
    const { loadLinksCache, upsertLink } = require('./db-server');
    const items = loadLinksCache().items || [];
    for (const item of items) {
      const text = (item.title || '') + ' ' + (item.url || '');
      for (const cat of cats) {
        if (wordMatchAny(text, cat.terms)) {
          const newCat = cat.displayName || cat.name;
          if (item.category !== newCat) { item.category = newCat; upsertLink(item); categorizedLinks++; }
          break;
        }
      }
    }
  } catch (e) { errors.push('links: ' + e.message); }

  invalidateScanCache();
  json(res, { ok: true, movedVideos, categorizedLinks, errors });
}

// ── Scoring / fuzzy matching ──────────────────────────────────────────
// Normalize separators (_, -, .) to space for cross-format matching
function normSeps(s) {
  return s.toLowerCase().replace(/[\s\-_.]+/g, ' ').trim();
}

function computeScore(text, cat) {
  let best = 0;
  const normText = normSeps(text);

  // Folder display name in filename → highest-confidence match
  const dn = cat.displayName || cat.name;
  if (wordMatch(text, dn)) return 100;
  const normDn = normSeps(dn);
  if (normDn.length >= 3 && normText.includes(normDn)) best = 90;

  for (const term of cat.terms) {
    if (best >= 100) break;
    if (wordMatch(text, term)) return 100;
    const tl = term.toLowerCase(), xl = text.toLowerCase();
    if (xl.includes(tl)) { best = Math.max(best, 60); continue; }
    // Normalized separator match: "My_Category" matches "My Category"
    const normTerm = normSeps(term);
    if (normTerm.length >= 3 && normText.includes(normTerm)) { best = Math.max(best, 60); continue; }
    // Loose prefix-overlap fuzzy match: only for top-level categories (depth 0),
    // where terms come from user-configured tags. Nested folder names (e.g. actor
    // or series subfolders) require an exact/substring match to avoid noisy moves.
    if ((cat.depth || 0) === 0) {
      const words = xl.split(/\W+/).filter(w => w.length >= 3);
      for (const w of words) {
        if (tl.startsWith(w.slice(0, 3)) || w.startsWith(tl.slice(0, 3))) {
          best = Math.max(best, 30); break;
        }
      }
    }
  }
  return best;
}

function bestCatMatch(text, cats) {
  let best = null, bs = 0;
  for (const c of cats) {
    const s = computeScore(text, c);
    if (s <= 0) continue;
    // Prefer deeper (more specific) folders on a tie, e.g. an existing
    // "Performers/Jane Doe" subfolder beats the top-level "Performers" category.
    if (s > bs || (s === bs && (!best || (c.depth || 0) > (best.depth || 0)))) { bs = s; best = c; }
  }
  return { cat: best, score: bs };
}

// Recursively collect all existing subfolders under `root` as destination candidates
// for categorization, including nested subfolders (e.g. "Performers/Jane Doe").
// Top-level folders that correspond to a configured category inherit its tag terms;
// nested folders are matched on their own name only.
function collectDestinationCandidates(root, cats) {
  const catByName = new Map();
  for (const c of cats) {
    catByName.set((c.displayName || c.name).toLowerCase(), c);
    catByName.set(c.name.toLowerCase(), c);
  }
  const candidates = [];
  const walk = (dir, rel) => {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (!e.isDirectory() || isHiddenFolderName(e.name)) continue;
      const full = path.join(dir, e.name);
      if (path.resolve(full) === path.resolve(VAULT_DIR) || path.resolve(full) === path.resolve(IGNORED_DIR)) continue;
      const relPath = rel ? rel + '/' + e.name : e.name;
      const depth = rel ? rel.split('/').length : 0;
      const dbCat = depth === 0 ? catByName.get(e.name.toLowerCase()) : null;
      candidates.push({ relPath, name: e.name, displayName: e.name, terms: dbCat ? dbCat.terms : [e.name], depth });
      walk(full, relPath);
    }
  };
  walk(root, '');
  return candidates;
}

// Pick the best matching category folder for a given filename using the same
// scoring algorithm as the categorizer modal. Returns the relative folder path
// (e.g. "Performers/Jane Doe") or null if nothing scores above zero.
function autoCategorize(filename) {
  try {
    const prefs = loadPrefs();
    const roots = [VIDEOS_DIR, ...(prefs.sourceFolders || []).filter(sf => fs.existsSync(sf))];
    const cats = loadFolderMappings();
    const ext = path.extname(filename).toLowerCase();
    const stem = path.basename(filename, ext);
    for (const root of roots) {
      const candidates = collectDestinationCandidates(root, cats);
      const { cat, score } = bestCatMatch(stem, candidates);
      if (cat && score > 0) return cat.relPath;
    }
  } catch (err) {
    console.error('[autoCategorize] error:', err.message);
  }
  return null;
}

async function apiCategorizePlan(req, res) {
  const body = await readBody(req);
  const mode = body.mode === 'all' ? 'all' : 'uncategorized';
  const cats = loadFolderMappings();
  const prefs = loadPrefs();
  const roots = [VIDEOS_DIR, ...(prefs.sourceFolders || []).filter(sf => fs.existsSync(sf))];

  // Map folder name → category for quick lookup (used for link matching below)
  const catByFolder = new Map();
  for (const c of cats) {
    catByFolder.set((c.displayName || c.name).toLowerCase(), c);
    catByFolder.set(c.name.toLowerCase(), c);
  }

  // Per-root list of every existing folder (any depth) as a possible move target,
  // so videos can be suggested into existing subfolders, not just top-level categories.
  const candidatesByRoot = new Map();
  for (const root of roots) candidatesByRoot.set(path.resolve(root), collectDestinationCandidates(root, cats));

  const uncategorized = [];
  const categorized = [];

  // ── Videos ───────────────────────────────────────────────────────────
  for (const root of roots) {
    const files = [];
    if (mode === 'all') {
      const collect = (dir) => {
        let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of ents) {
          if (e.isDirectory() && !isHiddenFolderName(e.name)) collect(path.join(dir, e.name));
          else if (e.isFile() && VIDEO_EXT.has(path.extname(e.name).toLowerCase()))
            files.push(path.join(dir, e.name));
        }
      };
      collect(root);
    } else {
      let ents; try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
      for (const e of ents)
        if (e.isFile() && VIDEO_EXT.has(path.extname(e.name).toLowerCase()))
          files.push(path.join(root, e.name));
    }

    const candidates = candidatesByRoot.get(path.resolve(root)) || [];

    for (const src of files) {
      const ext = path.extname(src).toLowerCase();
      const stem = path.basename(src, ext);
      const currentFolder = path.relative(root, path.dirname(src)).replace(/\\/g, '/') || '';
      const id = Buffer.from(src).toString('base64url');

      const { cat: suggested, score } = bestCatMatch(stem, candidates);

      if (suggested && suggested.relPath !== currentFolder) {
        // Either uncategorized (no current folder) or a better-matching existing
        // folder/subfolder exists than where this file currently lives — propose a move.
        uncategorized.push({
          type: 'video', id, name: path.basename(src),
          currentFolder, suggestedCategory: suggested.relPath,
          score, srcPath: src, root,
        });
      } else if (suggested) {
        // Already filed in its best-matching existing folder.
        categorized.push({
          type: 'video', id, name: path.basename(src),
          currentFolder, matchedCategory: currentFolder.replace(/\//g, ' / '),
          score,
        });
      } else {
        uncategorized.push({
          type: 'video', id, name: path.basename(src),
          currentFolder, suggestedCategory: '',
          score: 0, srcPath: src, root,
        });
      }
    }
  }

  // ── Links ─────────────────────────────────────────────────────────────
  try {
    const { loadLinksCache } = require('./db-server');
    const VIRTUAL = new Set(['', 'links', 'uncategorized']);
    const items = loadLinksCache().items || [];
    for (const item of items) {
      const text = (item.title || '') + ' ' + (item.url || '');
      const curCat = item.category || '';
      const catObj = !VIRTUAL.has(curCat.toLowerCase()) ? catByFolder.get(curCat.toLowerCase()) : null;
      const id = Buffer.from(item.url).toString('base64url');
      const name = item.title || item.url;

      if (catObj && computeScore(text, catObj) > 0) {
        categorized.push({
          type: 'link', id, name, url: item.url,
          currentFolder: curCat, matchedCategory: curCat,
          score: computeScore(text, catObj),
        });
      } else {
        const { cat: suggested, score } = bestCatMatch(text, cats);
        uncategorized.push({
          type: 'link', id, name, url: item.url,
          currentFolder: VIRTUAL.has(curCat.toLowerCase()) ? '' : curCat,
          suggestedCategory: suggested ? (suggested.displayName || suggested.name) : '',
          score,
        });
      }
    }
  } catch (e) { console.error('[apiCategorizePlan] links error:', e.message); }

  const allDestPaths = new Set();
  for (const list of candidatesByRoot.values()) for (const c of list) allDestPaths.add(c.relPath);
  const categories = Array.from(allDestPaths).sort();
  uncategorized.sort((a, b) => b.score - a.score);
  categorized.sort((a, b) => b.score - a.score);
  json(res, { uncategorized, categorized, categories });
}

async function apiCategorizeExecute(req, res) {
  const body = await readBody(req);
  const moves = Array.isArray(body.moves) ? body.moves : [];
  const prefs = loadPrefs();
  const allowedRoots = new Set(
    [VIDEOS_DIR, ...(prefs.sourceFolders || []).filter(sf => fs.existsSync(sf))].map(r => path.resolve(r))
  );
  let movedVideos = 0, movedLinks = 0;
  const errors = [];

  const videoMoves = moves.filter(m => m.type === 'video' || (!m.type && m.srcPath));
  const linkMoves  = moves.filter(m => m.type === 'link'  || (!m.type && m.url));

  for (const move of videoMoves) {
    const { srcPath, destFolder, root } = move;
    if (!srcPath || !destFolder || !root) continue;
    if (!allowedRoots.has(path.resolve(root))) { errors.push(`${path.basename(srcPath)}: root not allowed`); continue; }
    const ext = path.extname(srcPath).toLowerCase();
    const stem = path.basename(srcPath, ext);
    // destFolder may be a nested path like "Performers/Jane Doe"
    const destDir = path.join(root, ...destFolder.split('/'));
    try {
      // never create new folders for auto-categorize; only move into existing ones
      if (!fs.existsSync(destDir)) {
        errors.push(`${path.basename(srcPath)}: target folder does not exist`);
        continue;
      }
      let dest = path.join(destDir, path.basename(srcPath));
      if (fs.existsSync(dest)) {
        let n = 1;
        do { dest = path.join(destDir, `${stem}_${n}${ext}`); n++; } while (fs.existsSync(dest));
      }
      fs.renameSync(srcPath, dest);
      movedVideos++;
    } catch (e) { errors.push(`${path.basename(srcPath)}: ${e.message}`); }
  }

  if (linkMoves.length > 0) {
    try {
      const { loadLinksCache, upsertLink } = require('./db-server');
      const byUrl = new Map(loadLinksCache().items.map(i => [i.url, i]));
      for (const move of linkMoves) {
        const item = byUrl.get(move.url);
        if (item && move.newCategory) { item.category = move.newCategory; upsertLink(item); movedLinks++; }
      }
    } catch (e) { errors.push('links: ' + e.message); }
  }

  invalidateScanCache();
  json(res, { ok: true, movedVideos, movedLinks, errors });
}

function apiEncryptionStatus(req, res) {
  json(res, getEncryptionProgress());
}

// Client-driven progress for streamed Vault imports (ImportModal uploads files
// one at a time via /api/vault/add, so the server can't know the batch size on
// its own). Lets the upload loop surface in Sync & Background Tasks alongside
// the server-run encryption jobs. Phases: start | update | done.
async function apiVaultImportProgress(req, res) {
  const body = await readBody(req);
  const phase = body.phase;
  if (phase === 'start') {
    // Don't stomp a server-run encryption/decryption that's already in flight.
    if (_encryptionProgress.running && _encryptionProgress.category !== 'Vault import') {
      return json(res, { ok: false, busy: true });
    }
    updateEncryptionProgress({
      running: true, type: 'encrypt', category: 'Vault import',
      total: Number(body.total) || 0, done: 0, current: '', error: '', ok: false,
    });
  } else if (phase === 'update') {
    if (_encryptionProgress.category === 'Vault import') {
      updateEncryptionProgress({ done: Number(body.done) || 0, current: body.current || '' });
    }
  } else if (phase === 'done') {
    if (_encryptionProgress.category === 'Vault import') {
      updateEncryptionProgress({
        running: false, ok: !body.error, error: body.error || '',
        done: body.done != null ? Number(body.done) : _encryptionProgress.done,
      });
    }
  }
  json(res, { ok: true });
}

async function apiEncryptionStop(req, res) {
  if (!_encryptionProgress.running) return json(res, { ok: true, message: 'No job running' });
  _encryptionCancel = true;
  updateEncryptionProgress({ current: 'Stopping...', error: '', });
  console.log('[ENC] stop requested');
  json(res, { ok: true });
}

module.exports = {
  scan, cachedScan, allVideos, invalidateScanCache, initVideoMeta,
  apiVideosUpload, apiRescan,
  apiVideos, apiFolders, apiFoldersOverview, apiMainFolders, apiCreateFolder,
  apiFolderCreate, apiFolderRename, apiFolderDelete, apiFolderMove,
  apiGetAllFolders, apiSetEnabledFolders,
  apiVideoDetail, apiVideoDetailFast, apiPreload, apiStream, apiDelete, apiRename, apiMove, apiAutoSort,
  apiFavourites, apiToggleFav,
  apiAddHistory, apiGetHistory, apiClearHistory, apiClearFavourites, apiClearThumbs,
  apiSetRating, apiDeleteRating,
  apiUpdateVideoMeta, apiOpenFolder, apiOpenFolderInExplorer, apiDuplicates,
  apiTags, apiTagVideos, apiVideoTags, apiTagSuggestions,
  apiDeleteTag, apiRenameTag,
  apiDbTags, apiDbTagVideos,
  apiChannels, apiChannelVideos,
  apiAudioTracks,
  apiSubtitles, apiSaveSubtitles, apiSubtitleFile, apiSubtitleEmbedded, apiUploadSubtitle, apiDeleteSubtitleFile,
  apiImport,
  apiAddChapter, apiDeleteChapter,
  apiRenameFolder, apiDeleteFolder, apiHideFolder,
  apiEncryptVideo, apiEncryptBatch, apiEncryptFolder, apiUnlockFolder, apiDecryptFolder, apiEncryptAllFolders, getUnlockedFolderKey,
  apiAutoCategorizeUncategorized, apiRecategorizeAll,
  autoCategorize,
  apiCategorizePlan, apiCategorizeExecute,
  apiCategorizerBgExecute, apiCategorizerPoll, apiCategorizerStop,
  apiEncryptionStatus, apiEncryptionStop, getEncryptionProgress, apiVaultImportProgress,
  apiScanEvents, broadcastScanChange,
};
