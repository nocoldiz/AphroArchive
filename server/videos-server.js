'use strict';
// ═══════════════════════════════════════════════════════════════════
//  videos.js — Video scanning, listing, and all video API handlers
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { exec } = require('child_process');
const crypto = require('crypto');
const {
  VIDEOS_DIR, VAULT_DIR, IGNORED_DIR, VIDEO_EXT, MIME,
  AUDIO_DIR, AUDIO_EXT, BOOKS_DIR, BOOK_EXT,
  PHOTOS_DIR, IMAGE_EXT, THUMBS_DIR, CACHE_DIR, ROOT_DIR, FFMPEG_BIN
} = require('./config-server');
const { pipeline } = require('stream');
const { promisify } = require('util');
const pipe = promisify(pipeline);
const { toId, fromId, safePath, formatBytes, formatDuration, json, readBody, wordMatch, wordMatchAny, studioMatchAny, actorMatchesAny } = require('./helpers-server');
const {
  loadFavs, saveFavs,
  loadHistory, saveHistory,
  loadPrefs,
  loadVideoMeta, saveVideoMeta, setVideoMetaFields,
  loadThumbsCache, saveThumbsCache,
  loadHidden, saveHidden,
  loadActors, loadCategories, loadStudios,
  loadAudioMeta, saveAudioMeta,
  loadBooksMeta, saveBooksMeta,
  loadRatings,
  loadLinksCache,
  loadVideoIndex, saveVideoIndex, clearVideoIndex,
} = require('./db-server');

// ── Video scan cache ─────────────────────────────────────────────────
function getCatKey(p) {
  return (p || '').replace(/\\/g, '/').toLowerCase();
}

function isHiddenFolderName(name) {
  return String(name || '').toLowerCase() === 'hidden';
}

let _scanCache = null;
let _watchDebounce = null;
const unlockedCategories = new Map(); // catPath -> key (Buffer)
let masterPassword = null; // Session master password

function invalidateScanCache() {
  _scanCache = null;
  clearVideoIndex();
}

function _onVideoDirChange() {
  if (_watchDebounce) clearTimeout(_watchDebounce);
  _watchDebounce = setTimeout(invalidateScanCache, 300);
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
    // Prune entries whose directory no longer exists on disk
    let prefs;
    try { prefs = loadPrefs(); } catch (e) { prefs = {}; }
    const sourceFolders = (prefs.sourceFolders || []).filter(sf => fs.existsSync(sf));
    const dirExistsCache = new Map();
    const dirExists = dir => {
      if (!dirExistsCache.has(dir)) dirExistsCache.set(dir, fs.existsSync(dir));
      return dirExistsCache.get(dir);
    };
    const valid = indexed.filter(v => {
      const dir = v.isExternal
        ? path.dirname(v.rel)
        : (v.catPath ? path.join(VIDEOS_DIR, v.catPath) : VIDEOS_DIR);
      if (dirExists(dir)) return true;
      // For external files, also check against source folders by catPath
      if (v.isExternal && v.catPath) {
        return sourceFolders.some(sf => dirExists(path.join(sf, v.catPath)));
      }
      return false;
    });
    if (valid.length !== indexed.length) saveVideoIndex(valid);
    _scanCache = valid;
    return _scanCache;
  }

  // DB empty: scan filesystem, then persist to DB for next start
  let all = await scan(VIDEOS_DIR);

  try {
    const prefs = loadPrefs();
    if (prefs.sourceFolders) {
      for (const folder of prefs.sourceFolders) {
        if (fs.existsSync(folder)) {
          const extFiles = await scan(folder, folder, true);
          all.push(...extFiles);
        }
      }
    }
  } catch (e) {
    console.error('Failed to scan external folders:', e);
  }

  try {
    const cats = loadCategories();
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
  _scanCache = all;
  return _scanCache;
}

// ── Video scanning ───────────────────────────────────────────────────

async function scan(dir, base = dir, isExternal = false) {
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
          const sub = await scan(fp, base, isExternal);
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
        } else if (!VIDEO_EXT.has(ext)) return;

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

function isVideoHidden(v, hiddenTerms, tags = []) {
  return hiddenTerms.some(term => {
    if (wordMatch(v.name, term)) return true;
    const catLo = v.catPath.toLowerCase(), termLo = term.toLowerCase();
    if (catLo === termLo || catLo.startsWith(termLo + '/') || catLo.startsWith(termLo + '\\')) return true;
    if (tags.some(t => t.toLowerCase() === termLo)) return true;
    return false;
  });
}

async function allVideos() {
  const db = require('./db-server');
  if (db.getCurrentProfile() === 'Vault') {
    const { loadVaultMeta } = require('./db-server');
    const meta = loadVaultMeta();
    const list = [];
    for (const [id, item] of Object.entries(meta)) {
      if (item.type !== 'folder') {
        list.push({
          id,
          name: item.originalName || item.name,
          rel: id + '.enc',
          catPath: item.category || '',
          encrypted: true,
          mtime: item.mtime || Date.now(),
          size: item.size || 0
        });
      }
    }
    return list;
  }

  const all    = await cachedScan();
  const hidden = loadHidden();
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

  return list.filter(v => {
    if (hidden.length && isVideoHidden(v, hidden, v.tags)) return false;
    if (v.encrypted && !isUnlocked(v.catPath)) return false;
    return true;
  });
}

function isUnlocked(catPath) {
  let p = getCatKey(catPath);
  while (true) {
    if (unlockedCategories.has(p)) return true;
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
    if (unlockedCategories.has(p)) return unlockedCategories.get(p);
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
    const categories = loadCategories();
    const studios    = loadStudios();
    const actors     = loadActors();
    let oldRatings   = {};
    try { oldRatings = loadRatings(); } catch {}

    for (const v of videos) {
      if (!meta[v.id]) {
        const detectedTags   = categories.filter(e => wordMatchAny(v.name, e.terms)).map(e => e.displayName);
        const detectedStudio = studios.find(e => studioMatchAny(v.name, e.terms));
        const detectedActors = actors.filter(e => actorMatchesAny(v.name, e.terms)).map(e => e.name);
        meta[v.id] = {
          title: v.name,
          actors: detectedActors,
          tags: detectedTags,
          studio: detectedStudio ? detectedStudio.name : '',
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
  const videos      = await allVideos();
  const favs        = loadFavs();
  const meta        = loadVideoMeta();
  const thumbsCache = loadThumbsCache();
  let list = videos.map(v => {
    const cached   = thumbsCache[v.id];
    const duration = cached?.duration || null;
    const vMeta    = meta[v.id] || {};
    return { ...v, fav: favs.includes(v.id), rating: vMeta.rating ?? null, duration, durationF: formatDuration(duration), tags: vMeta.tags || v.tags || [], chapters: vMeta.chapters || [] };
  });
  const q    = params.get('q');
  const cat  = params.get('category');
  const sort = params.get('sort') || 'date';
  const fav  = params.get('fav') === '1' || params.get('fav') === 'true';
  
  const relevance = new Map();
  if (q) {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    list = list.filter(v => {
      const vName = v.name.toLowerCase();
      const vCat  = v.category.toLowerCase();
      const vTags = (meta[v.id]?.tags || v.tags || []).map(t => t.toLowerCase());
      
      const match = tokens.every(token =>
        vName.includes(token) ||
        vCat.includes(token) ||
        vTags.some(t => t.includes(token))
      );
      
      if (match) {
        let score = 0;
        tokens.forEach(token => {
          if (vName.includes(token)) score += 10;
          if (vName.startsWith(token)) score += 5;
          if (vCat.includes(token)) score += 3;
          if (vTags.some(t => t.includes(token))) score += 5;
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
      const defined = loadCategories();
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

async function apiCategories(req, res) {
  const videos = await cachedScan();
  const hidden = loadHidden();
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
  try {
    if (fs.existsSync(VIDEOS_DIR)) {
      const walkDir = (dir, rel) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
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
          walkDir(path.join(dir, ent.name), subRel);
        }
      };
      walkDir(VIDEOS_DIR, '');
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

  // Remove categories whose physical directory no longer exists
  {
    let sfPrefs;
    try { sfPrefs = loadPrefs(); } catch (e) { sfPrefs = {}; }
    const existingSF = (sfPrefs.sourceFolders || []).filter(sf => fs.existsSync(sf));
    const toRemove = [];
    for (const [key, entry] of catMap.entries()) {
      if (key === 'Links') continue;
      if (fs.existsSync(path.join(VIDEOS_DIR, entry.path))) continue;
      if (existingSF.some(sf => fs.existsSync(path.join(sf, entry.path)))) continue;
      toRemove.push(key);
    }
    toRemove.forEach(k => catMap.delete(k));
  }

  const cats = [];
  for (const [key, entry] of catMap.entries()) {
    const parts = key.split('/');
    const kLo = key.toLowerCase();
    const isHidden = hidden.some(t => {
      const tLo = t.toLowerCase();
      return kLo === tLo || kLo.startsWith(tLo + '/') || parts.some(part => part.toLowerCase() === tLo);
    });
    if (isHidden) continue;

    const isLinks = key === 'Links';
    const full = path.join(VIDEOS_DIR, entry.path);
    const isConfigured = !isLinks && fs.existsSync(path.join(full, '.cat-enc-config.json'));

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
  const uncatCount = videos.filter(v => v.catPath === '').length;
  cats.unshift({ name: 'Uncategorized', path: 'uncategorized', count: uncatCount });

  const db = require('./db-server');
  const enabledPaths = db.loadEnabledCategories();
  const filtered = enabledPaths.length > 0
    ? cats.filter(c => {
        if (c.path === 'uncategorized') return true;
        const pathLo = c.path.toLowerCase();
        // show if this path or any ancestor is explicitly enabled
        return enabledPaths.some(ep => {
          const epLo = ep.toLowerCase();
          return pathLo === epLo || pathLo.startsWith(epLo + '/');
        });
      })
    : cats;

  filtered.sort((a, b) => {
    if (a.path === 'uncategorized') return -1;
    if (b.path === 'uncategorized') return 1;
    return a.name.localeCompare(b.name);
  });

  json(res, filtered);
}

async function apiGetAllCategories(req, res) {
  const hidden = loadHidden();
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
        if (hidden.some(t => t.toLowerCase() === ent.name.toLowerCase())) continue;
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
        if (hidden.some(t => t.toLowerCase() === ent.name.toLowerCase())) continue;
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
  const enabled = db.loadEnabledCategories();

  json(res, { categories: list, enabled });
}

async function apiSetEnabledCategories(req, res) {
  const body = await readBody(req);
  const { paths } = body;
  if (!Array.isArray(paths)) return json(res, { error: 'Paths array required' }, 400);
  
  const db = require('./db-server');
  db.saveEnabledCategories(paths);
  json(res, { ok: true });
}

async function apiMainCategories(req, res) {
  const hidden = loadHidden();
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
        if (hidden.some(t => t.toLowerCase() === ent.name.toLowerCase())) continue;
        result.push({ name: subRel.replace(/[\\/]/g, ' / '), path: subRel.replace(/\\/g, '/') });
        await walk(full, subRel);
      }
    } catch (e) {}
  }

  await walk(VIDEOS_DIR);
  result.sort((a, b) => {
    if (a.path === '') return -1;
    if (b.path === '') return 1;
    return a.name.localeCompare(b.name);
  });
  json(res, result);
}

async function apiCreateCategory(req, res) {
  const body = await readBody(req);
  const name = (body.name || '').trim().replace(/[<>:"|?*]/g, '_');
  if (!name) return json(res, { error: 'Name required' }, 400);
  const dir = path.join(VIDEOS_DIR, name);
  if (fs.existsSync(dir)) return json(res, { error: 'Already exists' }, 409);
  try { fs.mkdirSync(dir, { recursive: true }); json(res, { ok: true, name }); }
  catch (e) { json(res, { error: e.message }, 500); }
}

async function apiVideoDetail(req, res, id) {
  const videos = await allVideos();
  const v      = videos.find(x => x.id === id);
  if (!v) return json(res, { error: 'Not found' }, 404);

  const favs  = loadFavs();
  const meta  = loadVideoMeta();
  const vMeta = meta[v.id] || {};
  const video = { ...v, fav: favs.includes(v.id), rating: vMeta.rating ?? null, chapters: vMeta.chapters || [] };

  const actors         = loadActors();
  const metaActors     = vMeta.actors || [];
  const filenameActors = actors.filter(e => actorMatchesAny(v.name, e.terms)).map(e => e.name);
  const combinedActors = [...new Set([...metaActors, ...filenameActors])];
  const metaTags       = vMeta.tags || [];

  const allTagSet = new Set();
  for (const entry of Object.values(meta)) {
    if (Array.isArray(entry.tags)) entry.tags.forEach(t => allTagSet.add(t));
  }
  loadCategories().forEach(e => allTagSet.add(e.displayName));

  const suggested = videos
    .filter(x => x.id !== v.id)
    .map(x => {
      let score      = 0;
      const xActors  = meta[x.id]?.actors || [];
      const shared   = combinedActors.filter(a => xActors.some(xa => xa.toLowerCase() === a.toLowerCase()));
      score += shared.length * 100;
      if (x.category === v.category) score += 50;
      return { video: x, score };
    })
    .sort((a, b) => b.score - a.score || Math.random() - 0.5)
    .slice(0, 12)
    .map(item => ({ ...item.video, fav: favs.includes(item.video.id), rating: meta[item.video.id]?.rating ?? null }));

  json(res, { video, suggested, actors: combinedActors, tags: metaTags, allCategories: [...allTagSet].sort(), studio: vMeta.studio || '' });
}

async function apiStream(req, res, id) {
  const fp = safePath(id);
  if (!fp) { res.writeHead(404); res.end('Not found'); return; }
  
  const v = (await allVideos()).find(v => v.id === id);
  const isEnc = v && v.encrypted;
  const key   = isEnc ? getUnlockKey(v.catPath) : null;
  
  if (isEnc && !key) {
    res.writeHead(401);
    return res.end('Category locked');
  }

  const stat = await fs.promises.stat(fp);
  const size = stat.size;
  const ext  = path.extname(fp).toLowerCase();
  const ct   = MIME[v?.ext || ext] || 'application/octet-stream';

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
      const start = parseInt(s, 10);
      const end = e2 ? parseInt(e2, 10) : contentSize - 1;
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
    const start = parseInt(startStr, 10);
    const end   = endStr ? parseInt(endStr, 10) : size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': ct,
    });
    fs.createReadStream(fp, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': size, 'Content-Type': ct, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(fp).pipe(res);
  }
}

function apiDelete(req, res, id) {
  const fp = safePath(id);
  if (!fp) return json(res, { error: 'Not found' }, 404);
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
  } catch (e) { json(res, { error: e.message }, 500); }
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

  const isExternal = !fp.startsWith(path.resolve(VIDEOS_DIR));

  if (isExternal) {
    const targetDir = targetCategory ? path.join(VIDEOS_DIR, targetCategory) : VIDEOS_DIR;
    const resolvedTarget = path.resolve(targetDir);
    if (!resolvedTarget.startsWith(path.resolve(VIDEOS_DIR))) return json(res, { error: 'Invalid category' }, 400);
    if (!fs.existsSync(resolvedTarget)) fs.mkdirSync(resolvedTarget, { recursive: true });

    const filename = path.basename(fp);
    const newPath = path.join(resolvedTarget, filename);
    if (fs.existsSync(newPath)) return json(res, { error: 'A file with that name already exists in the target category' }, 409);

    try {
      try {
        fs.renameSync(fp, newPath);
      } catch (renameErr) {
        if (renameErr.code === 'EXDEV') {
          // Cross-device: copy then delete
          fs.copyFileSync(fp, newPath);
          fs.unlinkSync(fp);
        } else {
          throw renameErr;
        }
      }
      invalidateScanCache();
      const newRel = path.relative(VIDEOS_DIR, newPath);
      const newId  = toId(newRel);
      const favs = loadFavs();
      const fi   = favs.indexOf(id);
      if (fi !== -1) { favs[fi] = newId; saveFavs(favs); }
      const meta = loadVideoMeta();
      if (meta[id]) { meta[newId] = { ...meta[id], category: targetCategory }; delete meta[id]; saveVideoMeta(meta); }
      return json(res, { ok: true, newId });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  const targetDir      = targetCategory ? path.join(VIDEOS_DIR, targetCategory) : VIDEOS_DIR;
  const resolvedTarget = path.resolve(targetDir);
  if (!resolvedTarget.startsWith(path.resolve(VIDEOS_DIR))) return json(res, { error: 'Invalid category' }, 400);
  if (!fs.existsSync(resolvedTarget)) fs.mkdirSync(resolvedTarget, { recursive: true });

  const filename = path.basename(fp);
  const newPath  = path.join(resolvedTarget, filename);
  if (path.resolve(newPath) === path.resolve(fp)) return json(res, { error: 'Already in this category' }, 400);
  if (fs.existsSync(newPath)) return json(res, { error: 'A file with that name already exists in the target category' }, 409);

  try {
    fs.renameSync(fp, newPath);
    invalidateScanCache();
    const newRel = path.relative(VIDEOS_DIR, newPath);
    const newId  = toId(newRel);
    const favs = loadFavs();
    const fi   = favs.indexOf(id);
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

async function apiSetRating(req, res, id) {
  const body  = await readBody(req);
  const stars = parseInt(body.stars, 10);
  if (!Number.isFinite(stars) || stars < 1 || stars > 5) return json(res, { error: 'stars must be 1–5' }, 400);
  setVideoMetaFields(id, { rating: stars });
  json(res, { ok: true, rating: stars });
}

function apiDeleteRating(req, res, id) {
  setVideoMetaFields(id, { rating: null });
  json(res, { ok: true });
}

async function apiUpdateVideoMeta(req, res, id) {
  const videos = await allVideos();
  if (!videos.find(v => v.id === id)) return json(res, { error: 'Not found' }, 404);
  const body    = await readBody(req);
  const allowed = ['title', 'actors', 'tags', 'studio', 'rating', 'category', 'note', 'date'];
  const fields  = {};
  for (const key of allowed) { if (key in body) fields[key] = body[key]; }
  setVideoMetaFields(id, fields);
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

async function apiOpenCategoryFolder(req, res) {
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
  const videos = await allVideos();
  const favs   = loadFavs();
  const bySize = new Map();
  for (const v of videos) {
    if (!bySize.has(v.size)) bySize.set(v.size, []);
    bySize.get(v.size).push({ ...v, fav: favs.includes(v.id) });
  }
  const groups = [...bySize.values()]
    .filter(g => g.length > 1)
    .sort((a, b) => b[0].size - a[0].size);
  json(res, groups);
}

// ── Tags ─────────────────────────────────────────────────────────────

async function apiCategoriesOverview(req, res) {
  const videos = await cachedScan();
  const meta   = loadVideoMeta();
  const hidden = loadHidden();

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

  const filteredCats = [...catMap.values()].filter(c => {
    const lo = c.path.toLowerCase();
    return !hidden.some(t => { const tl = t.toLowerCase(); return lo === tl || lo.startsWith(tl + '/') || lo.startsWith(tl + '\\'); });
  });

  // ── Tags ──
  const folderNames = new Set(
    videos.filter(v => v.catPath !== '').map(v => v.catPath.split(/[/\\]/)[0].toLowerCase())
  );
  const tagMap = new Map();
  for (const v of videos) {
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

  const result = [...filteredCats, ...tagMap.values()].map(e => {
    const isLinks = e.name === 'Links';
    const thumbId = e.thumbId || (e.ids.length ? e.ids[Math.floor(Math.random() * e.ids.length)] : null);
    let encrypted = false;
    let partial = false;
    if (e.type === 'cat' && !isLinks) {
      const full = path.join(VIDEOS_DIR, e.path);
      encrypted = fs.existsSync(path.join(full, '.cat-enc-config.json'));
      if (encrypted) {
        // Check if any videos in this specific folder are NOT encrypted
        const hasUnencrypted = unencryptedCats.has(getCatKey(e.path));
        partial = hasUnencrypted;
      }
    }
    const unlocked = isLinks ? true : isUnlocked(e.path || '');
    return { type: e.type, name: e.name, path: e.path || null, count: e.count, thumbId, encrypted, partial, unlocked, duration: e.duration };
  });
  json(res, result);
}

async function apiTags(req, res) {
  const meta    = loadVideoMeta();
  const videos  = await allVideos();
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
  const videos = await allVideos();
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
  const cats  = loadCategories();
  const nameLo = name.toLowerCase();
  return cats.find(c => c.displayName.toLowerCase() === nameLo)
      || cats.find(c => c.terms.some(t => t.toLowerCase() === nameLo));
}

async function apiDbTags(req, res) {
  const cats   = loadCategories();
  const meta   = loadVideoMeta();
  const videos = await allVideos();
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
  const videos  = await allVideos();
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
  const cats = loadCategories();
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

// ── Studios ──────────────────────────────────────────────────────────

async function apiStudios(req, res) {
  const studios = loadStudios();
  const videos  = await allVideos();
  const meta    = loadVideoMeta();
  const result  = studios
    .map(e => ({
      name: e.name,
      count: videos.filter(v => {
        const ms = (meta[v.id]?.studio || '').toLowerCase();
        return ms === e.name.toLowerCase() || wordMatchAny(v.name, e.terms);
      }).length,
      website: e.website,
      description: e.description,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  json(res, result);
}

async function apiStudioVideos(req, res, studioName) {
  const studios = loadStudios();
  const entry   = studios.find(e => e.name.toLowerCase() === studioName.toLowerCase());
  if (!entry) return json(res, { error: 'Not found' }, 404);
  const videos   = await allVideos();
  const meta     = loadVideoMeta();
  const favs     = loadFavs();
  const studioLo = entry.name.toLowerCase();

  const parsed = require('url').parse(req.url, true);
  const fav    = (parsed.query.fav === '1' || parsed.query.fav === 'true');

  let list = videos
    .filter(v => {
      const ms = (meta[v.id]?.studio || '').toLowerCase();
      return ms === studioLo || wordMatchAny(v.name, entry.terms);
    })
    .map(v => ({ ...v, fav: favs.includes(v.id), rating: meta[v.id]?.rating ?? null }));

  if (fav) list = list.filter(v => v.fav);

  list.sort((a, b) => b.mtime - a.mtime);

  json(res, { studio: entry.name, videos: list });
}

// ── Subtitles ────────────────────────────────────────────────────────

const SUBTITLE_EXT = new Set(['.srt', '.vtt']);

function apiSubtitles(req, res, id) {
  const fp = safePath(id);
  if (!fp) return json(res, []);
  const dir  = path.dirname(fp);
  const base = path.basename(fp, path.extname(fp));
  const found = [];
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
  const full = path.resolve(dir, path.basename(filename));
  if (!full.startsWith(path.resolve(VIDEOS_DIR))) { res.writeHead(403); res.end('Forbidden'); return; }
  if (!fs.existsSync(full)) { res.writeHead(404); res.end('Not found'); return; }
  const ct = ext === '.vtt' ? 'text/vtt' : 'text/plain';
  res.writeHead(200, { 'Content-Type': ct });
  fs.createReadStream(full).pipe(res);
}

// ── Global import (video / audio / book by extension) ─────────────────

async function apiImport(req, res) {
  const filename     = decodeURIComponent(req.headers['x-filename'] || 'file');
  const categoryHdr  = (req.headers['x-category'] || '').trim();
  const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9.\-_ ()]/g, '_');
  const ext          = path.extname(safeFilename).toLowerCase();

  let destDir, kind;
  if (VIDEO_EXT.has(ext)) {
    const safeCat = categoryHdr ? categoryHdr.replace(/[^a-zA-Z0-9 \-_]/g, '').trim() : '';
    destDir = safeCat ? path.join(VIDEOS_DIR, safeCat) : VIDEOS_DIR;
    kind = 'video';
  }
  else if (AUDIO_EXT.has(ext)) { destDir = AUDIO_DIR;  kind = 'audio'; }
  else if (BOOK_EXT.has(ext))  { destDir = BOOKS_DIR;  kind = 'book';  }
  else if (IMAGE_EXT.has(ext)) { destDir = PHOTOS_DIR; kind = 'photo'; }
  else return json(res, { error: 'Unsupported file type: ' + ext }, 400);

  if (kind === 'video' && !path.resolve(destDir).startsWith(path.resolve(VIDEOS_DIR)))
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
    videoId = toId(path.relative(VIDEOS_DIR, path.join(destDir, outName)));
  }

  if (kind === 'audio') {
    const meta = loadAudioMeta();
    meta[outName] = { title: path.basename(outName, ext), ext, size: data.length, sizeF: formatBytes(data.length), date: Date.now() };
    saveAudioMeta(meta);
  } else if (kind === 'book') {
    const meta = loadBooksMeta();
    meta[outName] = { title: path.basename(outName, ext), ext, size: data.length, sizeF: formatBytes(data.length), date: Date.now(), type: 'upload' };
    saveBooksMeta(meta);
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
  if (!meta[id]) meta[id] = { title: '', actors: [], tags: [], studio: '', rating: null, category: '', note: '', date: '' };
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

async function apiRenameCategory(req, res) {
  const body = await readBody(req);
  const oldPath = body.oldPath; // relative path from VIDEOS_DIR
  const newName = body.newName; // just the name
  
  if (!oldPath || !newName) return json(res, { error: 'oldPath and newName required' }, 400);
  
  const oldDir = path.join(VIDEOS_DIR, oldPath);
  if (!fs.existsSync(oldDir)) return json(res, { error: 'Category not found' }, 404);
  
  const parentDir = path.dirname(oldDir);
  const newDir = path.join(parentDir, newName.replace(/[<>:"/\\|?*]/g, '_'));
  
  if (fs.existsSync(newDir)) return json(res, { error: 'Target name already exists' }, 409);
  
  try {
    fs.renameSync(oldDir, newDir);
    invalidateScanCache();
    
    // Update metadata for all videos in this category
    const meta = loadVideoMeta();
    const oldPathFwd = oldPath.replace(/\\/g, '/');
    const newPathRel = path.relative(VIDEOS_DIR, newDir).replace(/\\/g, '/');
    
    let changed = false;
    for (const id of Object.keys(meta)) {
      const rel = fromId(id);
      if (rel.startsWith(oldPathFwd + '/') || rel === oldPathFwd) {
        const newRel = newPathRel + rel.substring(oldPathFwd.length);
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

async function apiDeleteCategory(req, res) {
  const body = await readBody(req);
  const catPath = body.path;
  if (!catPath) return json(res, { error: 'path required' }, 400);
  
  const dir = path.join(VIDEOS_DIR, catPath);
  if (!fs.existsSync(dir)) return json(res, { error: 'Category not found' }, 404);
  
  try {
    // 1. Move all videos in this folder to VIDEOS_DIR (main folder)
    function moveRecursive(currentDir) {
      if (!fs.existsSync(currentDir)) return;
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const ent of entries) {
        const fullPath = path.join(currentDir, ent.name);
        if (ent.isDirectory()) {
          moveRecursive(fullPath);
        } else if (ent.isFile() && VIDEO_EXT.has(path.extname(ent.name).toLowerCase())) {
          let dst = path.join(VIDEOS_DIR, ent.name);
          // If collision, rename with (1) etc.
          let counter = 1;
          const ext = path.extname(ent.name);
          const base = path.basename(ent.name, ext);
          while (fs.existsSync(dst)) {
            dst = path.join(VIDEOS_DIR, `${base} (${counter++})${ext}`);
          }
          fs.renameSync(fullPath, dst);
        }
      }
    }
    
    moveRecursive(dir);
    
    // 2. Delete the folder
    fs.rmSync(dir, { recursive: true, force: true });
    
    invalidateScanCache();
    json(res, { ok: true });
  } catch (e) { json(res, { error: e.message }, 500); }
}

async function apiHideCategory(req, res) {
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

async function apiEncryptAllCategories(req, res) {
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
      unlockedCategories.set(getCatKey(relCat), encKey);
      encryptedCount++;
    }

    invalidateScanCache();
    json(res, { ok: true, count: encryptedCount });
  } catch (e) { json(res, { error: e.message }, 500); }
}

async function apiEncryptCategory(req, res) {
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
  if (!fs.existsSync(dir)) return json(res, { error: 'Category not found' }, 404);
  
  try {
    const ck = getCatKey(catPath);
    const videos = (await cachedScan()).filter(v => {
      const vk = getCatKey(v.catPath);
      return vk === ck || vk.startsWith(ck + '/');
    });

    const total = videos.filter(v => !v.encrypted).length;
    let encryptedCount = 0;

    res.writeHead(200, { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' });
    const sendProgress = (obj) => res.write(JSON.stringify(obj) + '\n');

    const meta = loadVideoMeta();
    const vaultKey = getVaultKey();

    for (const v of videos) {
      if (v.encrypted) continue;
      
      const full = path.join(VIDEOS_DIR, v.rel);
      if (!fs.existsSync(full)) continue;

      const videoMeta = meta[v.id] || null;
      
      // Encrypt to vault and get new ID
      const vaultId = await encryptLocalFileToVault(full, v.name, v.catPath, videoMeta);
      
      if (!vaultId) {
        console.error(`[ENC] Failed to encrypt ${v.name}`);
        continue;
      }

      encryptedCount++;
      console.log(`[ENC] ${v.name} (${encryptedCount}/${total}, ${total - encryptedCount} left)`);
      const oldThumb = path.join(THUMBS_DIR, v.id);
      const newThumb = path.join(THUMBS_DIR, vaultId);
      
      if (fs.existsSync(oldThumb)) {
        if (fs.existsSync(newThumb)) fs.rmSync(newThumb, { recursive: true, force: true });
        fs.renameSync(oldThumb, newThumb);
        // Also encrypt the jpg files in thumbnails using the vault key!
        const tFiles = fs.readdirSync(newThumb);
        for (const tf of tFiles) {
          if (tf.endsWith('.jpg')) {
             await encryptFileInPlace(path.join(newThumb, tf), vaultKey);
          }
        }
      }
      sendProgress({ cur: encryptedCount, total, file: v.name });
    }
    
    invalidateScanCache();
    sendProgress({ ok: true, count: encryptedCount });
    res.end();
  } catch (e) { 
    if (!res.headersSent) json(res, { error: e.message }, 500);
    else {
      res.write(JSON.stringify({ error: e.message }) + '\n');
      res.end();
    }
  }
}

async function apiEncryptVideo(req, res, id) {
  const { isUnlocked, encryptLocalFileToVault, getVaultKey } = require('./vault-server');
  const { loadVaultConfig } = require('./db-server');
  
  if (!loadVaultConfig()) {
    return json(res, { error: 'Master vault password is not set' }, 400);
  }
  
  if (!isUnlocked()) {
    return json(res, { error: 'Vault is locked. Unlock it first' }, 401);
  }
  
  const vids = await allVideos();
  const v = vids.find(x => x.id === id);
  if (!v) return json(res, { error: 'Not found' }, 404);
  
  if (v.encrypted) return json(res, { error: 'Already encrypted' }, 400);
  
  const full = path.join(VIDEOS_DIR, v.rel);
  if (!fs.existsSync(full)) return json(res, { error: 'File not found on disk' }, 404);

  const meta = loadVideoMeta();
  const videoMeta = meta[v.id] || null;
  const vaultKey = getVaultKey();

  try {
    const vaultId = await encryptLocalFileToVault(full, v.name, v.catPath, videoMeta);
    
    if (!vaultId) {
      return json(res, { error: 'Encryption failed' }, 500);
    }

    const oldThumb = path.join(THUMBS_DIR, v.id);
    const newThumb = path.join(THUMBS_DIR, vaultId);
    
    if (fs.existsSync(oldThumb)) {
      if (fs.existsSync(newThumb)) fs.rmSync(newThumb, { recursive: true, force: true });
      fs.renameSync(oldThumb, newThumb);
      const tFiles = fs.readdirSync(newThumb);
      for (const tf of tFiles) {
        if (tf.endsWith('.jpg')) {
           await encryptFileInPlace(path.join(newThumb, tf), vaultKey);
        }
      }
    }

    if (meta[v.id]) {
      delete meta[v.id];
      saveVideoMeta(meta);
    }

    invalidateScanCache();
    json(res, { ok: true, vaultId });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
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

async function apiUnlockCategory(req, res) {
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
    
    unlockedCategories.set(getCatKey(catPath), encKey);

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
             unlockedCategories.set(getCatKey(sc), keyCache.get(sConf.salt));
          } else {
             const { encKey: sKey, verifyHash: sHash } = await deriveKeys(password, sConf.salt);
             if (sHash === sConf.verifyHash) {
                keyCache.set(sConf.salt, sKey);
                unlockedCategories.set(getCatKey(sc), sKey);
             }
          }
        } catch {}
      }
    }

    json(res, { ok: true });
  } catch (e) { json(res, { error: e.message }, 500); }
}

async function apiDecryptCategory(req, res) {
  const { isUnlocked, getVaultKey } = require('./vault-server');
  const { loadVaultMeta, saveVaultMeta, switchProfile, getCurrentProfile, setVideoMetaFields } = require('./db-server');
  
  const body = await readBody(req);
  const { path: catPath, targetProfile } = body;
  
  if (!catPath || !targetProfile) return json(res, { error: 'path and targetProfile required' }, 400);
  
  if (!isUnlocked()) {
    return json(res, { error: 'Vault is locked. Unlock it first' }, 401);
  }
  
  try {
    const meta = loadVaultMeta();
    const itemsToDecrypt = [];
    
    for (const [id, item] of Object.entries(meta)) {
      if (item.category === catPath && item.type !== 'folder') {
        itemsToDecrypt.push({ id, ...item });
      }
    }
    
    if (itemsToDecrypt.length === 0) {
      return json(res, { error: 'No files found in this category in the vault' }, 404);
    }
    
    res.writeHead(200, { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' });
    const sendProgress = (obj) => res.write(JSON.stringify(obj) + '\n');
    
    const total = itemsToDecrypt.length;
    let doneCount = 0;
    const vaultKey = getVaultKey();
    const originalProfile = getCurrentProfile();

    for (const item of itemsToDecrypt) {
      const encPath = path.join(VAULT_DIR, item.id + '.enc');
      if (!fs.existsSync(encPath)) continue;
      
      const targetDir = path.join(VIDEOS_DIR, item.category);
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      
      const targetFilePath = path.join(targetDir, item.originalName || item.name + (item.ext || '.mp4'));
      
      // Decrypt file
      await decryptFile(encPath, targetFilePath, vaultKey);
      
      doneCount++;
      console.log(`[DEC] ${item.originalName || item.name} (${doneCount}/${total}, ${total - doneCount} left)`);
      
      // Restore metadata to target profile
      const newRel = path.relative(VIDEOS_DIR, targetFilePath).replace(/\\/g, '/');
      const newId = toId(newRel);
      
      if (item.videoMeta) {
        switchProfile(targetProfile);
        setVideoMetaFields(newId, item.videoMeta);
        switchProfile(originalProfile); // Switch back
      }
      
      // Handle thumbnails
      const oldThumb = path.join(THUMBS_DIR, item.id);
      const newThumb = path.join(THUMBS_DIR, newId);
      
      if (fs.existsSync(oldThumb)) {
        if (fs.existsSync(newThumb)) fs.rmSync(newThumb, { recursive: true, force: true });
        fs.renameSync(oldThumb, newThumb);
        // Decrypt thumbnails
        const tFiles = fs.readdirSync(newThumb);
        for (const tf of tFiles) {
          if (tf.endsWith('.jpg')) {
             await decryptThumbnailInPlace(path.join(newThumb, tf), vaultKey);
          }
        }
      }
      
      // Remove from vault meta
      delete meta[item.id];
      
      sendProgress({ cur: doneCount, total, file: item.originalName || item.name });
    }
    
    saveVaultMeta(meta);
    invalidateScanCache();
    sendProgress({ ok: true });
    res.end();
  } catch (e) { 
    if (!res.headersSent) json(res, { error: e.message }, 500);
    else {
      res.write(JSON.stringify({ error: e.message }) + '\n');
      res.end();
    }
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

function getUnlockedCategoryKey(catPath) {
  return getUnlockKey(catPath);
}

function apiVideosUpload(req, res) {
  const { VIDEOS_DIR } = require('./config-server');
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
  const rawName = req.headers['x-filename'] || 'video.mp4';
  const safeName = path.basename(rawName).replace(/[^a-zA-Z0-9._\-\s]/g, '_');
  
  const dest = path.join(VIDEOS_DIR, safeName);
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
  invalidateScanCache();
  await cachedScan();
  json(res, { ok: true });
}

// Auto-categorize uncategorized videos (and links) by matching filename against category terms.
// Videos are moved within their own root (VIDEOS_DIR or external source folder).
async function apiAutoCategorizeUncategorized(req, res) {
  const cats = loadCategories();
  const prefs = loadPrefs();
  const sourceFolders = (prefs.sourceFolders || []).filter(sf => fs.existsSync(sf));
  const roots = [VIDEOS_DIR, ...sourceFolders];

  let movedVideos = 0;
  const errors = [];

  for (const root of roots) {
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }

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

      const src = path.join(root, ent.name);
      const destDir = path.join(root, matched.displayName || matched.name);
      try {
        fs.mkdirSync(destDir, { recursive: true });
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
    const { loadLinksCache, saveLinksCache } = require('./db-server');
    const cache = loadLinksCache();
    const items = cache.items || [];
    const VIRTUAL = new Set(['', 'links', 'uncategorized']);
    for (const item of items) {
      if (item.category && !VIRTUAL.has(item.category.toLowerCase())) continue;
      const text = (item.title || '') + ' ' + (item.url || '');
      for (const cat of cats) {
        if (wordMatchAny(text, cat.terms)) {
          item.category = cat.displayName || cat.name;
          categorizedLinks++;
          break;
        }
      }
    }
    saveLinksCache({ items });
  } catch (e) {
    errors.push('links: ' + e.message);
  }

  invalidateScanCache();
  json(res, { ok: true, movedVideos, categorizedLinks, errors });
}

async function apiRecategorizeAll(req, res) {
  const cats = loadCategories();
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

    for (const src of files) {
      const ext = path.extname(src).toLowerCase();
      const stem = path.basename(src, ext);
      let matched = null;
      for (const cat of cats) { if (wordMatchAny(stem, cat.terms)) { matched = cat; break; } }
      if (!matched) continue;
      const destDir = path.join(root, matched.displayName || matched.name);
      if (path.resolve(path.dirname(src)) === path.resolve(destDir)) continue;
      try {
        fs.mkdirSync(destDir, { recursive: true });
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
    const { loadLinksCache, saveLinksCache } = require('./db-server');
    const cache = loadLinksCache();
    const items = cache.items || [];
    for (const item of items) {
      const text = (item.title || '') + ' ' + (item.url || '');
      for (const cat of cats) {
        if (wordMatchAny(text, cat.terms)) {
          const newCat = cat.displayName || cat.name;
          if (item.category !== newCat) { item.category = newCat; categorizedLinks++; }
          break;
        }
      }
    }
    saveLinksCache({ items });
  } catch (e) { errors.push('links: ' + e.message); }

  invalidateScanCache();
  json(res, { ok: true, movedVideos, categorizedLinks, errors });
}

// ── Scoring / fuzzy matching ──────────────────────────────────────────
function computeScore(text, cat) {
  let best = 0;
  for (const term of cat.terms) {
    if (wordMatch(text, term)) return 100;
    const tl = term.toLowerCase(), xl = text.toLowerCase();
    if (xl.includes(tl)) { best = Math.max(best, 60); continue; }
    const words = xl.split(/\W+/).filter(w => w.length >= 3);
    for (const w of words) {
      if (tl.startsWith(w.slice(0, 3)) || w.startsWith(tl.slice(0, 3))) {
        best = Math.max(best, 30); break;
      }
    }
  }
  return best;
}

function bestCatMatch(text, cats) {
  let best = null, bs = 0;
  for (const c of cats) { const s = computeScore(text, c); if (s > bs) { bs = s; best = c; } }
  return { cat: best, score: bs };
}

function buildCategorizePlan(roots, cats, mode) {
  const changes = [];
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
      for (const e of ents) {
        if (e.isFile() && VIDEO_EXT.has(path.extname(e.name).toLowerCase()))
          files.push(path.join(root, e.name));
      }
    }

    for (const src of files) {
      const ext = path.extname(src).toLowerCase();
      const stem = path.basename(src, ext);
      let matched = null;
      for (const cat of cats) { if (wordMatchAny(stem, cat.terms)) { matched = cat; break; } }
      if (!matched) continue;
      const destFolder = matched.displayName || matched.name;
      if (path.resolve(path.dirname(src)) === path.resolve(path.join(root, destFolder))) continue;
      const currentFolder = path.relative(root, path.dirname(src)).replace(/\\/g, '/') || '';
      changes.push({ srcPath: src, name: path.basename(src), currentFolder, destFolder, root });
    }
  }
  return changes;
}

async function apiCategorizePlan(req, res) {
  const body = await readBody(req);
  const mode = body.mode === 'all' ? 'all' : 'uncategorized';
  const cats = loadCategories();
  const prefs = loadPrefs();
  const roots = [VIDEOS_DIR, ...(prefs.sourceFolders || []).filter(sf => fs.existsSync(sf))];

  // Map folder name → category for quick lookup
  const catByFolder = new Map();
  for (const c of cats) {
    catByFolder.set((c.displayName || c.name).toLowerCase(), c);
    catByFolder.set(c.name.toLowerCase(), c);
  }

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

    for (const src of files) {
      const ext = path.extname(src).toLowerCase();
      const stem = path.basename(src, ext);
      const currentFolder = path.relative(root, path.dirname(src)).replace(/\\/g, '/') || '';
      const topFolder = currentFolder.split('/')[0] || '';
      const folderCat = topFolder ? catByFolder.get(topFolder.toLowerCase()) : null;
      const id = Buffer.from(src).toString('base64url');

      if (folderCat && computeScore(stem, folderCat) > 0) {
        categorized.push({
          type: 'video', id, name: path.basename(src),
          currentFolder, matchedCategory: folderCat.displayName || folderCat.name,
          score: computeScore(stem, folderCat),
        });
      } else {
        const { cat: suggested, score } = bestCatMatch(stem, cats);
        uncategorized.push({
          type: 'video', id, name: path.basename(src),
          currentFolder, suggestedCategory: suggested ? (suggested.displayName || suggested.name) : '',
          score, srcPath: src, root,
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

  const categories = cats.map(c => c.displayName || c.name).sort();
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
    const destDir = path.join(root, destFolder);
    try {
      fs.mkdirSync(destDir, { recursive: true });
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
      const { loadLinksCache, saveLinksCache } = require('./db-server');
      const cache = loadLinksCache();
      const items = cache.items || [];
      const byUrl = new Map(items.map(i => [i.url, i]));
      for (const move of linkMoves) {
        const item = byUrl.get(move.url);
        if (item && move.newCategory) { item.category = move.newCategory; movedLinks++; }
      }
      saveLinksCache({ items });
    } catch (e) { errors.push('links: ' + e.message); }
  }

  invalidateScanCache();
  json(res, { ok: true, movedVideos, movedLinks, errors });
}

module.exports = {
  scan, cachedScan, allVideos, isVideoHidden, invalidateScanCache, initVideoMeta,
  apiVideosUpload, apiRescan,
  apiVideos, apiCategories, apiCategoriesOverview, apiMainCategories, apiCreateCategory,
  apiGetAllCategories, apiSetEnabledCategories,
  apiVideoDetail, apiStream, apiDelete, apiRename, apiMove, apiAutoSort,
  apiFavourites, apiToggleFav,
  apiAddHistory, apiGetHistory, apiClearHistory,
  apiSetRating, apiDeleteRating,
  apiUpdateVideoMeta, apiOpenFolder, apiOpenCategoryFolder, apiDuplicates,
  apiTags, apiTagVideos, apiVideoTags, apiTagSuggestions,
  apiDbTags, apiDbTagVideos,
  apiStudios, apiStudioVideos,
  apiSubtitles, apiSaveSubtitles, apiSubtitleFile,
  apiImport,
  apiAddChapter, apiDeleteChapter,
  apiRenameCategory, apiDeleteCategory, apiHideCategory,
  apiEncryptVideo, apiEncryptCategory, apiUnlockCategory, apiDecryptCategory, apiEncryptAllCategories, getUnlockedCategoryKey,
  apiAutoCategorizeUncategorized, apiRecategorizeAll,
  apiCategorizePlan, apiCategorizeExecute,
};
