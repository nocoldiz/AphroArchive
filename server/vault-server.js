'use strict';
// ═══════════════════════════════════════════════════════════════════
//  vault-server.js — Encrypted vault: setup, lock/unlock, streaming
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { VAULT_DIR, VAULT_CONFIG_FILE, VAULT_META_FILE, MIME, PROCESS_DIR, FFMPEG_BIN, FFPROBE_BIN } = require('./config-server');
const { json, readBody, formatBytes: _fmtBytes } = require('./helpers-server');
const { loadHidden, loadVaultConfig, saveVaultConfig, loadVaultMeta, saveVaultMeta, loadPrefs, setVaultKey } = require('./db-server');
const VAULT_DROP_DIR = typeof PROCESS_DIR !== 'undefined' ? PROCESS_DIR : path.join(path.dirname(VAULT_DIR), 'hidden');

// Static salt used by default — any installation with the same password derives the same key.
// Using a custom random salt improves security against rainbow tables but breaks portability.
const STATIC_SALT = 'AphroArchive';
// AES-256-GCM blob layout: [12-byte IV][ciphertext][16-byte auth tag]
const IV_PREFIX_LEN = 12;
const TAG_LEN = 16;
// ── Module state ─────────────────────────────────────────────────────

let vaultKey      = null;
let vaultPassword = null; // raw password string — needed for WinZip AES zip mounts
let failedAttempts = 0;
let cooldownUntil = 0;

// Default auto-lock period; overridden per-install by prefs (see getVaultTimeoutMs).
const DEFAULT_VAULT_TIMEOUT_MS = 5 * 60 * 1000;
let vaultTimer = null;

// Auto-lock suspension counter. Long-running background jobs (folder
// encryption/decryption of multi-GB libraries) routinely outlast the 5-minute
// auto-lock window. If the vault locks mid-operation, in-flight metadata writes
// fall back to plaintext and clobber the encrypted vault meta — silently
// orphaning every already-encrypted file. While this counter is > 0 the
// auto-lock timer is held off; resumeAutoLock() re-arms it once the job ends.
let _autoLockHold = 0;
// Set by scheduleDeferredLock() when a profile switch away from Vault happens
// while an encryption/decryption job is running. Cleared in lockVault() and
// when the vault is unlocked again. The lock fires when _autoLockHold returns
// to 0 inside resumeAutoLock().
let _deferredLock = false;
function suspendAutoLock() { _autoLockHold++; if (vaultTimer) { clearTimeout(vaultTimer); vaultTimer = null; } }
function resumeAutoLock() {
  if (_autoLockHold > 0) _autoLockHold--;
  if (_autoLockHold === 0) {
    if (_deferredLock) { _deferredLock = false; lockVault(); return; }
    resetVaultTimer();
  }
}
// Called by the profile-switch handler instead of lockVault() so that an
// in-progress batch job can finish before the session key is cleared.
function scheduleDeferredLock() {
  if (_autoLockHold > 0) { _deferredLock = true; }
  else { lockVault(); }
}

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
};

// Auto-lock timeout is configurable via prefs. Accepts either an explicit
// `vaultTimeoutMs` or a friendlier `vaultTimeoutMinutes`. A value of 0
// disables auto-lock entirely (vault stays unlocked until manually locked).
function getVaultTimeoutMs() {
  try {
    const prefs = loadPrefs() || {};
    if (typeof prefs.vaultTimeoutMs === 'number' && prefs.vaultTimeoutMs >= 0) return prefs.vaultTimeoutMs;
    if (typeof prefs.vaultTimeoutMinutes === 'number' && prefs.vaultTimeoutMinutes >= 0) {
      return Math.round(prefs.vaultTimeoutMinutes * 60 * 1000);
    }
  } catch { }
  return DEFAULT_VAULT_TIMEOUT_MS;
}

function resetVaultTimer() {
  // Always clear any stale timer first — prevents orphaned timers if called
  // concurrently after an auto-lock fires (vaultKey = null) mid-async.
  if (vaultTimer) { clearTimeout(vaultTimer); vaultTimer = null; }
  if (!vaultKey) return;
  // A background job holds the lock open; don't re-arm until it finishes. This
  // also stops unrelated HTTP handlers (which call resetVaultTimer) from
  // re-arming the timer underneath a running encryption job.
  if (_autoLockHold > 0) return;
  const ms = getVaultTimeoutMs();
  if (!ms || ms <= 0) return; // 0 → auto-lock disabled
  vaultTimer = setTimeout(() => {
    vaultKey = null;
    vaultPassword = null;
    vaultTimer = null;
    try { setVaultKey(null); } catch { }
    try { require('./vault-zip-mount-server').unmountAll(); } catch {}
  }, ms);
}

function clearVaultTimer() {
  if (vaultTimer) { clearTimeout(vaultTimer); vaultTimer = null; }
}

// ── Crypto helpers ───────────────────────────────────────────────────

const PBKDF2_ITERATIONS_LEGACY = 100000;
const PBKDF2_ITERATIONS_CURRENT = 600000;

function deriveKeys(password, salt, iterations = PBKDF2_ITERATIONS_CURRENT) {
  const pbkdf2 = (pw, s) => new Promise((res, rej) =>
    crypto.pbkdf2(pw, s, iterations, 32, 'sha512', (err, k) => err ? rej(err) : res(k)));
  return Promise.all([pbkdf2(password, salt), pbkdf2(password, salt + ':verify')])
    .then(([encKey, vKey]) => ({ encKey, verifyHash: vKey.toString('hex') }));
}

// Constant-time comparison of two hex strings to avoid leaking match
// progress through response timing.
function _timingEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || a.length === 0) return false;
  let bufA, bufB;
  try { bufA = Buffer.from(a, 'hex'); bufB = Buffer.from(b, 'hex'); } catch { return false; }
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Reject ids that could escape VAULT_DIR via path traversal. All legitimate
// ids are UUIDs / random hex, so separators and dot-segments are never valid.
function _safeId(id) {
  return typeof id === 'string' && id.length > 0 && id.length < 256
    && !id.includes('/') && !id.includes('\\') && !id.includes('..')
    && !path.isAbsolute(id);
}

// Overwrite a file with random bytes, then delete it
function _shredFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const size = stat.size;
    const fd = fs.openSync(filePath, 'r+');
    let written = 0;
    while (written < size) {
      const chunk = Math.min(65536, size - written);
      fs.writeSync(fd, crypto.randomBytes(chunk), 0, chunk, written);
      written += chunk;
    }
    fs.closeSync(fd);
    fs.unlinkSync(filePath);
  } catch { }
}



// Stream-decrypt an .enc blob to a destination file (no full-RAM buffer).
// Reads IV + auth tag synchronously (28 bytes), then pipes ciphertext through
// AES-256-GCM. GCM auth-tag verification happens at dec.final(); if it fails
// dec emits 'error' before out emits 'finish', so the Promise always rejects
// cleanly and callers can unlink the partial temp file.
async function _streamDecryptToFile(encPath, destPath) {
  const stat = fs.statSync(encPath);
  const total = stat.size;
  if (total < IV_PREFIX_LEN + TAG_LEN) throw new Error('Encrypted file is too small or corrupted');
  const fd = fs.openSync(encPath, 'r');
  const iv = Buffer.alloc(IV_PREFIX_LEN);
  fs.readSync(fd, iv, 0, IV_PREFIX_LEN, 0);
  const tag = Buffer.alloc(TAG_LEN);
  fs.readSync(fd, tag, 0, TAG_LEN, total - TAG_LEN);
  fs.closeSync(fd);
  const dec = crypto.createDecipheriv('aes-256-gcm', vaultKey, iv);
  dec.setAuthTag(tag);
  const src = fs.createReadStream(encPath, { start: IV_PREFIX_LEN, end: total - TAG_LEN - 1 });
  const out = fs.createWriteStream(destPath);
  await new Promise((resolve, reject) => {
    src.on('error', reject);
    out.on('error', reject);
    dec.on('error', reject);
    out.on('finish', resolve);
    src.pipe(dec).pipe(out);
  });
}

// Stream-decrypt an .enc file directly to an HTTP response (no temp files)
// File format: [12 IV][encrypted data][16 auth tag]
function _streamDecrypt(req, res, id, meta, isDownload) {
  const encPath = path.join(VAULT_DIR, id + '.enc');
  const stat = fs.statSync(encPath);
  const total = stat.size;
  if (total < 28) { // 12 bytes IV + 16 bytes auth tag = 28 bytes minimum
    throw new Error('Encrypted file is too small or corrupted.');
  }
  const ivLen = 12, tagLen = 16;
  const contentSize = total - ivLen - tagLen;
  const ct = MIME[meta[id].ext] || (isDownload ? 'application/octet-stream' : 'video/mp4');

  // Read IV and auth tag synchronously (tiny fixed-size reads)
  const fd = fs.openSync(encPath, 'r');
  const iv = Buffer.alloc(ivLen);
  fs.readSync(fd, iv, 0, ivLen, 0);
  const tag = Buffer.alloc(tagLen);
  fs.readSync(fd, tag, 0, tagLen, total - tagLen);
  fs.closeSync(fd);

  if (isDownload) {
    const filename = meta[id].originalName;
    const encoded = encodeURIComponent(filename).replace(/'/g, '%27');
    res.writeHead(200, {
      'Content-Type': ct,
      'Content-Length': contentSize,
      'Content-Disposition': `attachment; filename*=UTF-8''${encoded}`,
      ...NO_CACHE_HEADERS,
    });
    const dec = crypto.createDecipheriv('aes-256-gcm', vaultKey, iv);
    dec.setAuthTag(tag);
    const src = fs.createReadStream(encPath, { start: ivLen, end: total - tagLen - 1 });
    src.on('error', () => { try { res.end(); } catch { } });
    src.pipe(dec).pipe(res);
    dec.on('error', () => { try { res.end(); } catch { } });
    return;
  }

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
      ...NO_CACHE_HEADERS,
    });

    const dec = crypto.createDecipheriv('aes-256-gcm', vaultKey, iv);
    dec.setAuthTag(tag);
    const src = fs.createReadStream(encPath, { start: ivLen, end: total - tagLen - 1 });

    // Decrypt full stream but only pipe the requested byte range to response
    let pos = 0;
    dec.on('data', chunk => {
      const chunkEnd = pos + chunk.length - 1;
      if (chunkEnd < start || pos > end) { pos += chunk.length; return; }
      const sl = Math.max(0, start - pos);
      const se = Math.min(chunk.length, end - pos + 1);
      res.write(chunk.slice(sl, se));
      pos += chunk.length;
    });
    dec.on('end', () => { try { res.end(); } catch { } });
    dec.on('error', () => { try { res.end(); } catch { } });
    src.on('error', () => { try { res.end(); } catch { } });
    src.pipe(dec);
  } else {
    res.writeHead(200, {
      'Content-Length': contentSize,
      'Content-Type': ct,
      'Accept-Ranges': 'bytes',
      ...NO_CACHE_HEADERS,
    });
    const dec = crypto.createDecipheriv('aes-256-gcm', vaultKey, iv);
    dec.setAuthTag(tag);
    const src = fs.createReadStream(encPath, { start: ivLen, end: total - tagLen - 1 });
    src.on('error', () => { try { res.end(); } catch { } });
    src.pipe(dec).pipe(res);
    dec.on('error', () => { try { res.end(); } catch { } });
  }
}

// Re-encrypt one .enc file from oldKey to newKey, writing the result to a
// separate destination (streaming, no full-file buffer, source left intact).
// Throws on a bad auth tag / truncated file so callers can abort before any
// destructive change.
async function _reEncryptFileTo(srcPath, dstPath, oldKey, newKey) {
  const stat = fs.statSync(srcPath);
  const total = stat.size, ivLen = 12, tagLen = 16;
  if (total < ivLen + tagLen) throw new Error('File too small to re-encrypt: ' + path.basename(srcPath));

  const fd = fs.openSync(srcPath, 'r');
  const oldIv = Buffer.alloc(ivLen);
  fs.readSync(fd, oldIv, 0, ivLen, 0);
  const oldTag = Buffer.alloc(tagLen);
  fs.readSync(fd, oldTag, 0, tagLen, total - tagLen);
  fs.closeSync(fd);

  const newIv = crypto.randomBytes(12);
  const dec = crypto.createDecipheriv('aes-256-gcm', oldKey, oldIv);
  dec.setAuthTag(oldTag);
  const enc = crypto.createCipheriv('aes-256-gcm', newKey, newIv);
  const src = fs.createReadStream(srcPath, { start: ivLen, end: total - tagLen - 1 });
  const dst = fs.createWriteStream(dstPath);
  dst.write(newIv);

  await new Promise((resolve, reject) => {
    dec.on('data', chunk => {
      const re = enc.update(chunk);
      if (re.length && !dst.write(re)) { dec.pause(); dst.once('drain', () => dec.resume()); }
    });
    dec.on('end', () => {
      try {
        const fin = enc.final();
        if (fin.length) dst.write(fin);
        dst.write(enc.getAuthTag());
        dst.end(resolve);
      } catch (e) { reject(e); }
    });
    dec.on('error', reject);
    src.on('error', reject);
    dst.on('error', reject);
    src.pipe(dec);
  });
}

// Collect every encrypted blob under VAULT_DIR — top-level video/text/special
// `*.enc` files AND the per-page resource blobs nested in `<pageId>/<id>.enc`
// subfolders. Used by the password-change re-encryption so nothing is missed.
function _collectVaultEncFiles() {
  const out = [];
  if (!fs.existsSync(VAULT_DIR)) return out;
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && ent.name.endsWith('.enc')) out.push(full);
    }
  };
  walk(VAULT_DIR);
  return out;
}
// ── Auto-import hidden files ─────────────────────────────────────────

let _isProcessingDrop = false;

// ── HTML page helpers ────────────────────────────────────────────────

function _shredDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return;
    for (const entry of fs.readdirSync(dirPath)) {
      const full = path.join(dirPath, entry);
      if (fs.statSync(full).isDirectory()) _shredDir(full);
      else _shredFile(full);
    }
    fs.rmdirSync(dirPath);
  } catch { }
}

const _PAGE_MIME = {
  '.css': 'text/css', '.js': 'application/javascript', '.html': 'text/html',
  '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.bmp': 'image/bmp', '.json': 'application/json',
};

function _listDirFiles(dir, relBase) {
  const out = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const rel = relBase ? relBase + '/' + entry : entry;
    if (fs.statSync(full).isDirectory()) out.push(..._listDirFiles(full, rel));
    else out.push({ full, rel });
  }
  return out;
}

function _encryptBuf(buf) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', vaultKey, iv);
  const enc = cipher.update(buf);
  const fin = cipher.final();
  return Buffer.concat([iv, enc, fin, cipher.getAuthTag()]);
}

// Encrypt an in-memory buffer straight into the vault (no temp file on disk).
// Returns the new file id, or null if the vault is locked. Used by the archive
// importer to drop extracted ZIP entries directly into the vault.
function encryptBufferToVault(buf, filename, folder = null) {
  if (!vaultKey) return null;
  if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });
  const id = crypto.randomUUID();
  fs.writeFileSync(path.join(VAULT_DIR, id + '.enc'), _encryptBuf(buf));
  const ext = path.extname(filename).toLowerCase();
  const meta = loadVaultMeta();
  meta[id] = {
    originalName: filename, name: path.basename(filename, ext), ext,
    size: buf.length, sizeF: _fmtBytes(buf.length), mtime: Date.now(),
    folder: folder || null,
  };
  saveVaultMeta(meta);
  return id;
}

async function _encryptHtmlPageToVault(filePath, filename) {
  if (!vaultKey) return false;
  try { const fd = fs.openSync(filePath, 'r+'); fs.closeSync(fd); } catch { return false; }

  if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });

  // ── Dedup: skip if already imported under this filename ─────────────
  const existingMeta = loadVaultMeta();
  const duplicate = Object.values(existingMeta).find(m => m.type === 'page' && m.originalName === filename);
  if (duplicate) {
    // Already in vault — just clean up originals if still around
    console.log('[vault] page already imported, cleaning up:', filename);
    _shredFile(filePath);
    const baseDir0 = path.dirname(filePath);
    const bn0 = path.basename(filePath, path.extname(filePath));
    for (const c of [bn0 + '_files', bn0 + ' files', bn0 + '.files', bn0]) {
      const d = path.join(baseDir0, c);
      if (fs.existsSync(d) && fs.statSync(d).isDirectory()) { _shredDir(d); break; }
    }
    return false;
  }

  const pageId = crypto.randomUUID();
  const baseDir = path.dirname(filePath);
  const basename = path.basename(filename, path.extname(filename));

  // ── Locate resource folder ───────────────────────────────────────────
  let resDir = null;
  for (const c of [basename + '_files', basename + ' files', basename + '.files', basename]) {
    const full = path.join(baseDir, c);
    try {
      if (fs.existsSync(full) && fs.statSync(full).isDirectory()) { resDir = full; break; }
    } catch { }
  }
  console.log('[vault] html import:', filename, '| resDir:', resDir || '(none)');

  // ── Encrypt each resource file → VAULT_DIR/<pageId>/<fileId>.enc ────
  const resources = {};
  const pathMap = {};

  if (resDir) {
    const pageResDir = path.join(VAULT_DIR, pageId);
    fs.mkdirSync(pageResDir, { recursive: true });
    const resDirName = path.basename(resDir);

    let resFiles;
    try { resFiles = _listDirFiles(resDir, resDirName); } catch (e) {
      console.error('[vault] failed to list resource dir:', e.message);
      resFiles = [];
    }

    for (const { full, rel } of resFiles) {
      try {
        const fileId = crypto.randomUUID();
        const ext = path.extname(rel).toLowerCase();
        const data = fs.readFileSync(full);
        fs.writeFileSync(path.join(pageResDir, fileId + '.enc'), _encryptBuf(data));
        resources[fileId] = { name: path.basename(rel), ext, size: data.length };
        const newUrl = '/api/vault/page-resource/' + pageId + '/' + fileId;
        // Map by full relative path, by basename, and by URL-encoded variants
        pathMap[rel] = newUrl;
        pathMap[path.basename(rel)] = newUrl;
        // Also map the encoded version (browser may encode spaces etc.)
        const encodedRel = rel.split('/').map(encodeURIComponent).join('/');
        if (encodedRel !== rel) pathMap[encodedRel] = newUrl;
      } catch (e) {
        console.error('[vault] failed to encrypt resource:', rel, e.message);
      }
    }
    console.log('[vault] encrypted', Object.keys(resources).length, 'resources');
  }

  // ── Rewrite resource URLs in HTML and encrypt ────────────────────────
  let html = fs.readFileSync(filePath, 'utf-8');
  for (const [orig, newUrl] of Object.entries(pathMap)) {
    const esc = orig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp('(href|src)=(["\'])' + esc + '\\2', 'gi'),
      (_, attr, q) => attr + '=' + q + newUrl + q);
    html = html.replace(new RegExp('url\\((["\']?)' + esc + '\\1\\)', 'gi'),
      () => 'url(' + newUrl + ')');
  }

  const buf = Buffer.from(html, 'utf-8');
  fs.writeFileSync(path.join(VAULT_DIR, pageId + '.enc'), _encryptBuf(buf));

  const ext = path.extname(filename).toLowerCase();
  const meta = loadVaultMeta();
  meta[pageId] = {
    originalName: filename, name: path.basename(filename, ext), ext,
    size: buf.length, sizeF: _fmtBytes(buf.length), mtime: Date.now(),
    folder: null, type: 'page', resources,
  };
  saveVaultMeta(meta);

  _shredFile(filePath);
  if (resDir) _shredDir(resDir);
  return true;
}

// Encrypts a local file, updates vault metadata, and shreds the original
async function _encryptLocalFileToVault(filePath, filename, category = null, videoMeta = null) {
  if (!vaultKey) return false;

  // Check if file is still being written to (by attempting to open it)
  try {
    const fd = fs.openSync(filePath, 'r+');
    fs.closeSync(fd);
  } catch (e) {
    return false; // File is likely locked/in-use, skip for now
  }

  if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });

  const id = crypto.randomUUID();
  const outPath = path.join(VAULT_DIR, id + '.enc');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', vaultKey, iv);
  const out = fs.createWriteStream(outPath);
  out.write(iv);

  const stat = fs.statSync(filePath);
  const size = stat.size;
  const src = fs.createReadStream(filePath);

  // Stream the encryption
  await new Promise((resolve, reject) => {
    src.on('data', chunk => {
      const enc = cipher.update(chunk);
      if (enc.length && !out.write(enc)) { src.pause(); out.once('drain', () => src.resume()); }
    });
    src.on('end', () => {
      try {
        const fin = cipher.final();
        if (fin.length) out.write(fin);
        out.write(cipher.getAuthTag());
        out.end(resolve);
      } catch (e) { reject(e); }
    });
    src.on('error', reject);
    out.on('error', reject);
  });

  // The stream above can take minutes for a large file. If the vault locked
  // in that window (auto-lock, manual lock), vaultKey/_vaultKey are now gone:
  // persisting metadata would write the vault meta back as plaintext and wipe
  // every existing entry, and shredding the source would destroy the original
  // for a file we can no longer index. Bail out, leaving the source intact and
  // removing the half-orphaned ciphertext.
  if (!vaultKey) {
    try { fs.unlinkSync(outPath); } catch { }
    return false;
  }

  // Update Vault Metadata
  const ext = path.extname(filename).toLowerCase();
  const meta = loadVaultMeta();
  meta[id] = {
    originalName: filename,
    name: path.basename(filename, ext),
    ext,
    size,
    sizeF: _fmtBytes(size),
    mtime: Date.now(),
    folder: null,
    category,
    videoMeta
  };
  saveVaultMeta(meta);

  // Securely delete the original unencrypted file
  _shredFile(filePath);
  return id;
}

// Sweeps the drop directory
// Sweeps the drop directory
// Sweeps the drop directory and recursively processes nested folders
async function processHiddenFolder() {
  if (!vaultKey || _isProcessingDrop) return;
  _isProcessingDrop = true;

  try {
    if (!fs.existsSync(VAULT_DROP_DIR)) fs.mkdirSync(VAULT_DROP_DIR, { recursive: true });

    // Define extensions that should be ignored by the auto-importer
    const ignoredExtensions = ['.zip', '.rar', '.7z'];

    // Recursive helper function to scan inside directories
    async function scanDirectory(currentDir) {
      let files;
      try {
        files = fs.readdirSync(currentDir);
      } catch (e) {
        return; // Skip if directory cannot be read
      }

      for (const file of files) {
        if (!vaultKey) break; // Abort if vault gets locked midway

        const filePath = path.join(currentDir, file);

        try {
          const stat = fs.statSync(filePath);

          if (stat.isDirectory()) {
            // 1. Recursively process the nested folder
            await scanDirectory(filePath);

            // 2. Safely remove the folder if it is now empty
            try {
              if (fs.readdirSync(filePath).length === 0) {
                fs.rmdirSync(filePath);
              }
            } catch (err) { }

          } else if (stat.isFile()) {
            // Check the file extension and skip if it's an ignored archive type
            const ext = path.extname(file).toLowerCase();
            if (!ignoredExtensions.includes(ext)) {
              // Note: Passing 'file' keeps the original base filename for metadata
              await _encryptLocalFileToVault(filePath, file);
            }
          }
        } catch (e) {
          // Ignore (file might have been moved/deleted during the sweep)
        }
      }
    }

    // Start the recursive scan from the root drop directory
    await scanDirectory(VAULT_DROP_DIR);

  } catch (e) {
    console.error('Error processing hidden folder:', e);
  } finally {
    _isProcessingDrop = false;
  }
}

// Magic-byte sniff for orphaned blobs whose metadata was lost — picks a
// sensible extension so the recovered file plays/opens correctly. Defaults to
// .mp4 since the vault is overwhelmingly video.
function _sniffExt(head) {
  if (!head || head.length < 4) return '.mp4';
  const at = (i, j) => head.slice(i, j).toString('latin1');
  if (head.length >= 8 && at(4, 8) === 'ftyp') return '.mp4';
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3)
    return at(0, 64).includes('webm') ? '.webm' : '.mkv';
  if (at(0, 4) === 'RIFF' && at(8, 12) === 'AVI ') return '.avi';
  if (at(0, 4) === 'RIFF' && at(8, 12) === 'WEBP') return '.webp';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return '.jpg';
  if (head.length >= 8 && head.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (at(0, 4) === '%PDF') return '.pdf';
  if (at(0, 3) === 'ID3') return '.mp3';
  return '.mp4';
}

// Decrypt just the leading bytes of an .enc blob (no auth-tag verification —
// GCM is a stream cipher so a prefix decrypts correctly with the right key,
// which unlock already verified). Used only to sniff the file type cheaply.
function _decryptHead(encPath, nBytes = 64) {
  const fd = fs.openSync(encPath, 'r');
  try {
    const iv = Buffer.alloc(IV_PREFIX_LEN);
    fs.readSync(fd, iv, 0, IV_PREFIX_LEN, 0);
    const buf = Buffer.alloc(nBytes);
    const read = fs.readSync(fd, buf, 0, nBytes, IV_PREFIX_LEN);
    const dec = crypto.createDecipheriv('aes-256-gcm', vaultKey, iv);
    return dec.update(buf.slice(0, read));
  } finally { fs.closeSync(fd); }
}

// Rescan the vault folder and fold any orphaned .enc files — present on disk
// but missing from the metadata map — back into the listing under a "Recovered"
// folder. This makes every blob viewable whenever the password matches, even
// after a metadata loss. Runs on each unlock. It is strictly additive: existing
// entries are never modified and files are never deleted.
function reconcileVaultOrphans() {
  if (!vaultKey) return 0;
  let metaMap;
  try { metaMap = loadVaultMeta(); } catch { return 0; }
  if (!metaMap || typeof metaMap !== 'object') return 0;
  let files;
  // Only the video/file blobs — never the cached `.thumb.enc` posters.
  try { files = fs.readdirSync(VAULT_DIR).filter(f => f.endsWith('.enc') && !f.endsWith('.thumb.enc')); } catch { return 0; }

  const known = new Set(Object.keys(metaMap));
  let recoveredFolderId = null;
  let added = 0;

  for (const f of files) {
    const id = f.slice(0, -4);
    if (known.has(id)) continue;
    const encPath = path.join(VAULT_DIR, f);
    let stat;
    try { stat = fs.statSync(encPath); } catch { continue; }
    if (stat.size < IV_PREFIX_LEN + TAG_LEN) continue; // too small to be a real blob

    let ext = '.mp4';
    try { ext = _sniffExt(_decryptHead(encPath)); } catch { /* keep default */ }

    if (recoveredFolderId === null) {
      const existing = Object.entries(metaMap).find(
        ([, m]) => m && m.type === 'folder' && m.name === 'Recovered' && !m.parent);
      if (existing) recoveredFolderId = existing[0];
      else {
        recoveredFolderId = crypto.randomUUID();
        metaMap[recoveredFolderId] = { type: 'folder', name: 'Recovered', parent: null, mtime: Date.now() };
      }
    }

    const size = Math.max(0, stat.size - IV_PREFIX_LEN - TAG_LEN);
    metaMap[id] = {
      originalName: id + ext,
      name: id,
      ext,
      size,
      sizeF: _fmtBytes(size),
      mtime: stat.mtimeMs || Date.now(),
      folder: recoveredFolderId,
      category: 'Recovered',
      videoMeta: null,
      recovered: true,
    };
    added++;
  }

  if (added > 0) {
    try {
      saveVaultMeta(metaMap);
      console.log(`[vault] recovered ${added} orphaned file(s) into the "Recovered" folder`);
    } catch (e) {
      console.error('[vault] orphan reconcile save failed:', e.message);
      return 0;
    }
  }
  return added;
}

// ── Vault thumbnails ─────────────────────────────────────────────────
// Encrypted poster frames stored next to the video blobs in the hidden folder
// as `<id>.thumb.enc`. Generating one means briefly decrypting the video to a
// temp file (ffmpeg needs a seekable input), grabbing a frame, then encrypting
// the JPEG back into the vault. The plaintext temp is shredded immediately.
const VAULT_VIDEO_THUMB_EXTS = new Set([
  '.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v', '.wmv', '.flv', '.ts', '.mpg', '.mpeg', '.m2ts',
]);

function _ffprobeDuration(fp) {
  return new Promise(resolve => {
    try {
      execFile(FFPROBE_BIN, ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', fp],
        { timeout: 15000 }, (err, out) => {
          if (err) return resolve(0);
          const d = parseFloat(String(out).trim());
          resolve(Number.isFinite(d) && d > 0 ? d : 0);
        });
    } catch { resolve(0); }
  });
}

// Stream-decrypt a vault blob to a plaintext temp file (ffmpeg can't seek an
// encrypted/piped mp4 whose moov atom may sit at the end). Caller must shred it.
function _decryptVaultToTemp(id) {
  const encPath = path.join(VAULT_DIR, id + '.enc');
  const total = fs.statSync(encPath).size;
  const fd = fs.openSync(encPath, 'r');
  const iv = Buffer.alloc(IV_PREFIX_LEN); fs.readSync(fd, iv, 0, IV_PREFIX_LEN, 0);
  const tag = Buffer.alloc(TAG_LEN); fs.readSync(fd, tag, 0, TAG_LEN, total - TAG_LEN);
  fs.closeSync(fd);
  const tmp = path.join(os.tmpdir(), `aa-vthumb-${id}-${Date.now()}.tmp`);
  return new Promise((resolve, reject) => {
    const dec = crypto.createDecipheriv('aes-256-gcm', vaultKey, iv);
    dec.setAuthTag(tag);
    const src = fs.createReadStream(encPath, { start: IV_PREFIX_LEN, end: total - TAG_LEN - 1 });
    const out = fs.createWriteStream(tmp);
    src.on('error', reject); out.on('error', reject);
    out.on('finish', () => resolve(tmp));
    src.pipe(dec).pipe(out);
  });
}

// Generate (and cache, encrypted) a poster frame for a vault video. Returns the
// plaintext JPEG buffer, or null if the entry isn't a generatable video.
async function generateVaultThumb(id) {
  if (!vaultKey) return null;
  const entry = loadVaultMeta()[id];
  if (!entry || entry.type === 'folder') return null;
  if (!VAULT_VIDEO_THUMB_EXTS.has((entry.ext || '').toLowerCase())) return null;
  if (!fs.existsSync(path.join(VAULT_DIR, id + '.enc'))) return null;

  let tmpVid = null, tmpJpg = null;
  try {
    tmpVid = await _decryptVaultToTemp(id);
    const dur = await _ffprobeDuration(tmpVid);
    const t = dur > 6 ? Math.min(dur / 2, dur - 1) : (dur > 0 ? dur / 2 : 1);
    tmpJpg = tmpVid + '.jpg';
    await new Promise((resolve, reject) => {
      execFile(FFMPEG_BIN,
        ['-ss', String(t), '-i', tmpVid, '-frames:v', '1', '-vf', 'scale=480:-1', '-q:v', '3', '-y', tmpJpg],
        { timeout: 60000 }, err => err ? reject(err) : resolve());
    });
    if (!fs.existsSync(tmpJpg)) return null;
    const jpg = fs.readFileSync(tmpJpg);
    const iv = crypto.randomBytes(IV_PREFIX_LEN);
    const cipher = crypto.createCipheriv('aes-256-gcm', vaultKey, iv);
    const blob = Buffer.concat([iv, cipher.update(jpg), cipher.final(), cipher.getAuthTag()]);
    fs.writeFileSync(path.join(VAULT_DIR, id + '.thumb.enc'), blob);
    return jpg;
  } catch (e) {
    console.error('[vault] thumb gen failed for', id, '—', e.message);
    return null;
  } finally {
    if (tmpVid) { _shredFile(tmpVid); }            // wipe the plaintext temp video
    if (tmpJpg) { try { fs.unlinkSync(tmpJpg); } catch { } }
  }
}

function _readVaultThumb(id) {
  const p = path.join(VAULT_DIR, id + '.thumb.enc');
  if (!vaultKey || !fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p);
    if (raw.length < IV_PREFIX_LEN + TAG_LEN) return null;
    const iv = raw.subarray(0, IV_PREFIX_LEN);
    const tag = raw.subarray(raw.length - TAG_LEN);
    const ct = raw.subarray(IV_PREFIX_LEN, raw.length - TAG_LEN);
    const dec = crypto.createDecipheriv('aes-256-gcm', vaultKey, iv);
    dec.setAuthTag(tag);
    return Buffer.concat([dec.update(ct), dec.final()]);
  } catch { return null; }
}

// GET /api/vault/thumb/:id — serve the cached encrypted poster; with ?gen=1,
// generate it on the fly if missing (used by the batch generator's UI).
async function apiVaultThumb(req, res, id) {
  if (!vaultKey) { res.writeHead(401, NO_CACHE_HEADERS); res.end(); return; }
  resetVaultTimer();
  if (!_safeId(id)) { res.writeHead(400); res.end(); return; }
  let jpg = _readVaultThumb(id);
  if (!jpg && /[?&]gen=1(&|$)/.test(req.url || '')) jpg = await generateVaultThumb(id);
  if (!jpg) { res.writeHead(404, NO_CACHE_HEADERS); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'image/jpeg', ...NO_CACHE_HEADERS });
  res.end(jpg);
}

// Background batch generator for every vault video still missing a poster.
let _vaultThumbJob = { running: false, done: 0, total: 0, current: '' };
async function runVaultThumbGen() {
  if (_vaultThumbJob.running || !vaultKey) return;
  const meta = loadVaultMeta();
  const todo = Object.entries(meta).filter(([id, m]) =>
    m && m.type !== 'folder' &&
    VAULT_VIDEO_THUMB_EXTS.has((m.ext || '').toLowerCase()) &&
    !fs.existsSync(path.join(VAULT_DIR, id + '.thumb.enc')));
  _vaultThumbJob = { running: true, done: 0, total: todo.length, current: '' };
  suspendAutoLock();
  try {
    for (const [id, m] of todo) {
      if (!vaultKey) break;
      _vaultThumbJob.current = m.originalName || m.name || id;
      await generateVaultThumb(id);
      _vaultThumbJob.done++;
    }
  } finally {
    _vaultThumbJob.running = false;
    resumeAutoLock();
  }
}

function apiVaultGenThumbs(req, res) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  if (_vaultThumbJob.running) return json(res, { ok: true, already: true });
  runVaultThumbGen().catch(e => console.error('[vault] thumb batch error —', e.message));
  json(res, { ok: true });
}

function apiVaultGenThumbsStatus(req, res) {
  json(res, _vaultThumbJob);
}

// Poll the drop folder periodically. unref() so the timer never keeps the
// process (or a test runner) alive on its own.
const _sweepInterval = setInterval(() => {
  processHiddenFolder();
}, 30000);
if (_sweepInterval.unref) _sweepInterval.unref();

// File Watcher

// ── Vault API handlers ───────────────────────────────────────────────

function apiVaultStatus(req, res) {
  const hidden = loadHidden();
  const vaultHidden = hidden.some(t => t.toLowerCase() === 'vault');
  const now = Date.now();
  const cooldownRemaining = cooldownUntil > now ? Math.ceil((cooldownUntil - now) / 1000) : 0;
  json(res, {
    configured: !!loadVaultConfig(),
    unlocked: !!vaultKey,
    hidden: vaultHidden,
    failedAttempts,
    cooldownRemaining,
  });
}

async function apiVaultSetup(req, res) {
  if (loadVaultConfig()) return json(res, { error: 'Already configured' }, 400);
  const body = await readBody(req);
  const pw = (body.password || '').trim();
  if (pw.length < 6) return json(res, { error: 'Password must be at least 6 characters' }, 400);
  try {
    // Use static salt by default for portability across installations.
    // If body.useRandomSalt is true, generate a random salt (slightly more secure,
    // but the vault cannot be opened on another installation without migrating the salt).
    const salt = body.useRandomSalt
      ? crypto.randomBytes(32).toString('hex')
      : STATIC_SALT;
    const { encKey, verifyHash } = await deriveKeys(pw, salt, PBKDF2_ITERATIONS_CURRENT);

    // Optional duress / self-destruct password. Entering it at unlock time
    // silently wipes the vault while presenting a normal "wrong password"
    // response. Stored as an independent salt+hash; never reveals the real key.
    const cfg = { salt, verifyHash, useRandomSalt: !!body.useRandomSalt, iterations: PBKDF2_ITERATIONS_CURRENT };
    const duressPw = (body.selfDestructPassword || body.duressPassword || '').trim();
    if (duressPw && duressPw !== pw && duressPw.length >= 6) {
      const duressSalt = body.useRandomSalt ? crypto.randomBytes(32).toString('hex') : salt + ':duress';
      const { verifyHash: duressHash } = await deriveKeys(duressPw, duressSalt, PBKDF2_ITERATIONS_CURRENT);
      cfg.duressSalt = duressSalt;
      cfg.duressHash = duressHash;
    }
    saveVaultConfig(cfg);
    vaultKey = encKey;
    vaultPassword = pw;
    _deferredLock = false;
    setVaultKey(encKey);
    failedAttempts = 0; cooldownUntil = 0;
    resetVaultTimer();
    if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });
    json(res, { ok: true });
    try { reconcileVaultOrphans(); } catch (e) { console.error('[vault] reconcile on setup failed:', e.message); }
    processHiddenFolder();
    try { require('./vault-zip-mount-server').scanAndMountZips(pw, decryptToBuffer, loadVaultMeta()); } catch (e) { console.error('[vault] zip mount scan failed:', e.message); }
  } catch (e) { json(res, { error: e.message }, 500); }
}

async function apiVaultUnlock(req, res) {
  const cfg = loadVaultConfig();
  if (!cfg) return json(res, { error: 'Not configured' }, 400);

  const now = Date.now();
  if (cooldownUntil > now) {
    const remaining = Math.ceil((cooldownUntil - now) / 1000);
    return json(res, { error: `Too many attempts. Try again in ${remaining}s`, cooldown: remaining }, 429);
  }

  const body = await readBody(req);
  const pw = (body.password || '').trim();
  try {
    const iters = cfg.iterations || PBKDF2_ITERATIONS_LEGACY;
    const { encKey, verifyHash } = await deriveKeys(pw, cfg.salt, iters);
    if (!_timingEqualHex(verifyHash, cfg.verifyHash)) {
      // Duress / self-destruct: a matching duress password wipes the vault
      // and returns a generic wrong-password error so the wipe is invisible.
      if (cfg.duressHash && cfg.duressSalt) {
        const { verifyHash: duressHash } = await deriveKeys(pw, cfg.duressSalt, iters);
        if (_timingEqualHex(duressHash, cfg.duressHash)) {
          _silentWipe();
          return json(res, { error: 'Wrong password', attempts: failedAttempts + 1 }, 401);
        }
      }

      failedAttempts++;

      // Escalating backoff: 2→5s, 3→30s, 4→2min, 5+→5min
      if      (failedAttempts === 2) cooldownUntil = now + 5_000;
      else if (failedAttempts === 3) cooldownUntil = now + 30_000;
      else if (failedAttempts === 4) cooldownUntil = now + 120_000;
      else if (failedAttempts >= 5)  cooldownUntil = now + 300_000;

      return json(res, { error: 'Wrong password', attempts: failedAttempts }, 401);
    }

    // Correct password — reset counters
    failedAttempts = 0; cooldownUntil = 0;
    vaultKey = encKey;
    vaultPassword = pw;
    _deferredLock = false;
    setVaultKey(encKey);
    resetVaultTimer();
    json(res, { ok: true });
    try { reconcileVaultOrphans(); } catch (e) { console.error('[vault] reconcile on unlock failed:', e.message); }
    try { require('./vault-zip-mount-server').scanAndMountZips(pw, decryptToBuffer, loadVaultMeta()); } catch (e) { console.error('[vault] zip mount scan failed:', e.message); }
    processHiddenFolder();
    try { require('./feed-watcher-server').processVaultFeed(); } catch {}
  } catch (e) { json(res, { error: e.message }, 500); }
}

function apiVaultLock(req, res) {
  clearVaultTimer();
  vaultKey = null;
  vaultPassword = null;
  setVaultKey(null);
  try { require('./vault-zip-mount-server').unmountAll(); } catch {}
  json(res, { ok: true });
}

function apiVaultFiles(req, res) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  resetVaultTimer();
  const meta  = loadVaultMeta();
  const items = Object.entries(meta).map(([id, m]) => ({ id, ...m }));
  let mounted = [];
  try { mounted = require('./vault-zip-mount-server').getMountedItems(); } catch {}
  items.push(...mounted);
  items.sort((a, b) => b.mtime - a.mtime);
  json(res, items);
}

async function apiVaultAdd(req, res) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  resetVaultTimer();
  if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });
  const filename = decodeURIComponent(req.headers['x-filename'] || 'video');
  const id = crypto.randomUUID();
  const outPath = path.join(VAULT_DIR, id + '.enc');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', vaultKey, iv);
  const out = fs.createWriteStream(outPath);
  out.write(iv);
  let size = 0;
  await new Promise((resolve, reject) => {
    req.on('data', chunk => {
      size += chunk.length;
      const enc = cipher.update(chunk);
      if (enc.length && !out.write(enc)) { req.pause(); out.once('drain', () => req.resume()); }
    });
    req.on('end', () => {
      try {
        const fin = cipher.final();
        if (fin.length) out.write(fin);
        out.write(cipher.getAuthTag());
        out.end(resolve);
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
    out.on('error', reject);
  });
  const ext = path.extname(filename).toLowerCase();
  const folder = req.headers['x-folder'] || null;
  const meta = loadVaultMeta();
  meta[id] = { originalName: filename, name: path.basename(filename, path.extname(filename)), ext, size, sizeF: _fmtBytes(size), mtime: Date.now(), folder: folder || null };
  saveVaultMeta(meta);
  json(res, { ok: true, id });
}

function apiVaultStream(req, res, id) {
  if (!vaultKey) { res.writeHead(401, NO_CACHE_HEADERS); res.end('Vault locked'); return; }
  resetVaultTimer();
  if (!_safeId(id)) { res.writeHead(400); res.end(); return; }
  const meta = loadVaultMeta();
  if (!meta[id] || !fs.existsSync(path.join(VAULT_DIR, id + '.enc'))) { res.writeHead(404); res.end(); return; }

  try {
    _streamDecrypt(req, res, id, meta, false);
  } catch (e) {
    // Only write the 500 header if headers haven't been sent yet
    if (!res.headersSent) {
      res.writeHead(500);
    }
    res.end('Decryption failed');
  }
}

function apiVaultDownload(req, res, id) {
  if (!vaultKey) { res.writeHead(401, NO_CACHE_HEADERS); res.end('Vault locked'); return; }
  resetVaultTimer();
  if (!_safeId(id)) { res.writeHead(400); res.end(); return; }
  const meta = loadVaultMeta();
  const encPath = path.join(VAULT_DIR, id + '.enc');
  if (!meta[id] || !fs.existsSync(encPath)) { res.writeHead(404); res.end(); return; }

  try {
    _streamDecrypt(req, res, id, meta, true);
  } catch (e) {
    // Only write the 500 header if headers haven't been sent yet
    if (!res.headersSent) {
      res.writeHead(500);
    }
    res.end('Decryption failed');
  }
}

function apiVaultDelete(req, res, id) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);

  // Virtual ids from a mounted ZIP aren't in meta. A read-only archive can't
  // have a single entry removed without rewriting it, so reject individual
  // files/sub-folders with a clear message and let the user delete the whole
  // archive (its root folder) instead — see apiVaultDeleteFolder.
  let mount = null;
  try { mount = require('./vault-zip-mount-server').resolveMount(id); } catch {}
  if (mount) {
    return json(res, { error: "Items inside a mounted ZIP can't be deleted individually. Delete the archive instead." }, 400);
  }

  const meta = loadVaultMeta();
  if (!meta[id]) return json(res, { error: 'Not found' }, 404);
  _shredFile(path.join(VAULT_DIR, id + '.enc'));
  // Shred the cached encrypted poster, if one was generated
  const thumbPath = path.join(VAULT_DIR, id + '.thumb.enc');
  if (fs.existsSync(thumbPath)) _shredFile(thumbPath);
  // Shred per-page resource subdirectory if present
  const pageDir = path.join(VAULT_DIR, id);
  if (fs.existsSync(pageDir)) _shredDir(pageDir);
  delete meta[id];
  saveVaultMeta(meta);
  // If this file was mounted as a ZIP, drop the stale in-memory mount so its
  // virtual folder/files disappear from the listing right away.
  try { require('./vault-zip-mount-server').unmountByVaultId(id); } catch {}
  json(res, { ok: true });
}

function apiVaultPageResource(req, res, pageId, fileId) {
  if (!vaultKey) { res.writeHead(401, NO_CACHE_HEADERS); res.end('Vault locked'); return; }
  resetVaultTimer();
  if (!_safeId(pageId) || !_safeId(fileId)) { res.writeHead(400); res.end(); return; }
  const meta = loadVaultMeta();
  const page = meta[pageId];
  if (!page || !page.resources || !page.resources[fileId]) { res.writeHead(404); res.end(); return; }
  const encPath = path.join(VAULT_DIR, pageId, fileId + '.enc');
  if (!fs.existsSync(encPath)) { res.writeHead(404); res.end(); return; }
  try {
    const raw = fs.readFileSync(encPath);
    const iv = raw.slice(0, 12);
    const tag = raw.slice(raw.length - 16);
    const ct = raw.slice(12, raw.length - 16);
    const dec = crypto.createDecipheriv('aes-256-gcm', vaultKey, iv);
    dec.setAuthTag(tag);
    const out = Buffer.concat([dec.update(ct), dec.final()]);
    const ext = page.resources[fileId].ext || '';
    const ct2 = MIME[ext] || _PAGE_MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct2, 'Content-Length': out.length, ...NO_CACHE_HEADERS });
    res.end(out);
  } catch (e) {
    if (!res.headersSent) res.writeHead(500);
    res.end('Decryption failed');
  }
}

async function apiVaultChangePassword(req, res) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  const cfg = loadVaultConfig();
  if (!cfg) return json(res, { error: 'Not configured' }, 400);
  const body = await readBody(req);
  // Support both camelCase variants from the frontend
  const oldPw = (body.oldPassword || body.oldPw || '').trim();
  const newPw = (body.newPassword || body.newPw || '').trim();

  // Re-encrypting a large library can far outlast the auto-lock window; hold it
  // off so the vault key isn't pulled out from under the migration.
  suspendAutoLock();
  const tmpPairs = []; // [originalPath, rekeyTmpPath] produced in phase 1
  const cleanupTmps = () => {
    for (const [, tmp] of tmpPairs) { try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {} }
  };
  try {
    // Authenticate with the old password before validating the new one.
    const oldIters = cfg.iterations || PBKDF2_ITERATIONS_LEGACY;
    const { encKey: oldKey, verifyHash: oldHash } = await deriveKeys(oldPw, cfg.salt, oldIters);
    if (!_timingEqualHex(oldHash, cfg.verifyHash)) { resumeAutoLock(); return json(res, { error: 'Old password is wrong' }, 401); }
    if (newPw.length < 6) { resumeAutoLock(); return json(res, { error: 'New password must be at least 6 characters' }, 400); }

    // Keep the same salt type as the original setup (static or random).
    // If useRandomSalt is explicitly set in body, honour it; otherwise preserve the original choice.
    const keepStatic = body.useRandomSalt === undefined
      ? !cfg.useRandomSalt
      : !body.useRandomSalt;
    const newSalt = keepStatic ? STATIC_SALT : crypto.randomBytes(32).toString('hex');
    const { encKey: newKey, verifyHash: newHash } = await deriveKeys(newPw, newSalt, PBKDF2_ITERATIONS_CURRENT);

    // ── Phase 1: re-encrypt EVERY blob (videos, text, posters, the special
    // _vault_*.enc files, and nested page resources) to a sibling `.rekey`
    // temp WITHOUT touching the originals. If any file fails (bad auth tag,
    // locked file, disk full) we abort here — no destructive change has
    // happened, so the vault still opens with the old password. ────────────
    for (const full of _collectVaultEncFiles()) {
      const tmp = full + '.rekey';
      await _reEncryptFileTo(full, tmp, oldKey, newKey);
      tmpPairs.push([full, tmp]);
    }

    // ── Phase 2: every blob re-encrypted successfully — now swap each temp
    // over its original. These are quick rename ops with a low failure risk. ─
    for (const [full, tmp] of tmpPairs) {
      fs.unlinkSync(full);
      fs.renameSync(tmp, full);
    }

    // Re-encrypt prompts and comments stored in the Vault SQLite database.
    const { reEncryptVaultSqlite } = require('./db-server');
    reEncryptVaultSqlite(oldKey, newKey);

    // The vault metadata file is itself encrypted with the vault key. Snapshot
    // it while the OLD key is still active, then re-save it after the key
    // switch so it re-encrypts under the new key. Without this every entry
    // (names, folders, favourites) is orphaned on the next read.
    const metaSnapshot = loadVaultMeta();

    // Save new config. The duress password is independent of the main
    // password (own salt+hash), so carry it across a password change unless
    // the caller supplies a new one.
    const newCfg = { salt: newSalt, verifyHash: newHash, useRandomSalt: !keepStatic, iterations: PBKDF2_ITERATIONS_CURRENT };
    const newDuressPw = (body.selfDestructPassword || body.duressPassword || '').trim();
    if (newDuressPw && newDuressPw !== newPw && newDuressPw.length >= 6) {
      const duressSalt = keepStatic ? newSalt + ':duress' : crypto.randomBytes(32).toString('hex');
      const { verifyHash: duressHash } = await deriveKeys(newDuressPw, duressSalt, PBKDF2_ITERATIONS_CURRENT);
      newCfg.duressSalt = duressSalt;
      newCfg.duressHash = duressHash;
    } else if (cfg.duressHash && cfg.duressSalt) {
      newCfg.duressSalt = cfg.duressSalt;
      newCfg.duressHash = cfg.duressHash;
    }
    saveVaultConfig(newCfg);
    vaultKey = newKey;
    vaultPassword = newPw; // keep in sync — zip mounts decrypt with this
    setVaultKey(newKey);
    saveVaultMeta(metaSnapshot); // re-encrypts the meta under the new key
    resetVaultTimer();
    json(res, { ok: true });
  } catch (e) {
    cleanupTmps();
    json(res, { error: 'Password change failed (vault unchanged): ' + e.message }, 500);
  } finally {
    resumeAutoLock();
  }
}

// Decrypt a vault file and restore it to a normal directory.
// The .enc file is deleted ONLY after the destination file has been
// fully and successfully written, so a crash mid-transfer never loses data.
async function apiVaultRestoreFile(req, res, id) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  resetVaultTimer();

  const meta = loadVaultMeta();
  if (!meta[id]) return json(res, { error: 'Not found' }, 404);
  if (meta[id].type === 'folder') return json(res, { error: 'Cannot restore a folder entry' }, 400);

  const encPath = path.join(VAULT_DIR, id + '.enc');
  if (!fs.existsSync(encPath)) return json(res, { error: 'Encrypted file not found' }, 404);

  const body = await readBody(req);
  // destDir defaults to the parent VIDEOS_DIR if not provided
  const { VIDEOS_DIR } = require('./config-server');
  const destDir = (body.destDir || VIDEOS_DIR).toString();

  if (!fs.existsSync(destDir)) {
    try { fs.mkdirSync(destDir, { recursive: true }); } catch (e) {
      return json(res, { error: 'Cannot create destination directory: ' + e.message }, 500);
    }
  }

  const originalName = meta[id].originalName || (id + (meta[id].ext || ''));
  const destPath = path.join(destDir, originalName);

  // Resolve collisions by appending a counter
  let finalDest = destPath;
  if (fs.existsSync(finalDest)) {
    const ext  = path.extname(originalName);
    const base = path.basename(originalName, ext);
    let n = 1;
    while (fs.existsSync(finalDest)) {
      finalDest = path.join(destDir, `${base}_${n++}${ext}`);
    }
  }

  const tmpDest = finalDest + '.restoring';
  try {
    await _streamDecryptToFile(encPath, tmpDest);
    fs.renameSync(tmpDest, finalDest);
    _shredFile(encPath);
    delete meta[id];
    saveVaultMeta(meta);
    try { require('./videos-server').invalidateScanCache(); } catch {}
    json(res, { ok: true, path: finalDest, name: path.basename(finalDest) });
  } catch (e) {
    try { fs.unlinkSync(tmpDest); } catch {}
    json(res, { error: 'Restore failed: ' + e.message }, 500);
  }
}

function _silentWipe() {
  clearVaultTimer();
  vaultKey = null;
  setVaultKey(null);
  failedAttempts = 0;
  cooldownUntil = 0;

  if (fs.existsSync(VAULT_DIR)) {
    _shredDir(VAULT_DIR);
  }

  let error = null;
  for (const f of [VAULT_CONFIG_FILE, VAULT_META_FILE]) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); }
    catch (e) { error = e; }
  }
  // The vault counts as "configured" iff the config file still exists. If the
  // unlink failed (drive offline/read-only, file locked, permission denied) the
  // wipe silently did nothing — report that so callers don't claim success while
  // the vault remains. Never throws: the duress self-destruct path relies on
  // _silentWipe() staying silent.
  return { ok: !fs.existsSync(VAULT_CONFIG_FILE), error };
}

async function apiVaultDeleteVault(req, res) {
  let confirmVal = '';
  try {
    const body = await readBody(req);
    confirmVal = body.confirm;
  } catch (e) {}

  const isPostEndpoint = req.url === '/api/vault/delete-vault' || (req.url && req.url.startsWith('/api/vault/delete-vault?'));
  if (!isPostEndpoint && confirmVal !== 'DELETE_VAULT') {
    return json(res, { error: 'Confirmation required' }, 400);
  }

  const { ok, error } = _silentWipe();
  if (!ok) {
    return json(res, { error: 'Failed to delete vault: ' + (error ? error.message : 'the vault config could not be removed') }, 500);
  }
  json(res, { ok: true });
}

async function apiVaultCreateFolder(req, res) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  resetVaultTimer();
  const body = await readBody(req);
  const name = (body.name || '').trim();
  if (!name) return json(res, { error: 'Name required' }, 400);
  const parent = body.parent || null;
  const meta = loadVaultMeta();
  if (parent && !meta[parent]) return json(res, { error: 'Parent folder not found' }, 404);
  const existing = Object.values(meta).find(m => m.type === 'folder' && m.name.toLowerCase() === name.toLowerCase() && (m.parent || null) === parent);
  if (existing) return json(res, { error: 'Folder already exists' }, 409);
  const id = crypto.randomUUID();
  meta[id] = { type: 'folder', name, parent, mtime: Date.now() };
  saveVaultMeta(meta);
  json(res, { ok: true, id, name, parent });
}

// Internal version — no req/res. Returns the folder id (new or existing), or null if vault is locked.
function createVaultFolder(name, parent = null) {
  if (!vaultKey) return null;
  const meta = loadVaultMeta();
  const existing = Object.entries(meta).find(
    ([, m]) => m.type === 'folder' && m.name.toLowerCase() === name.toLowerCase() && (m.parent || null) === (parent || null)
  );
  if (existing) return existing[0];
  const id = crypto.randomUUID();
  meta[id] = { type: 'folder', name, parent: parent || null, mtime: Date.now() };
  saveVaultMeta(meta);
  return id;
}

async function apiVaultDeleteFolder(req, res, id) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);

  // A mounted ZIP surfaces as a virtual folder (not in meta). Deleting that
  // folder means "remove the archive": delete the backing .enc and unmount.
  // Virtual sub-folders can't be deleted on their own (read-only archive).
  let mount = null;
  try { mount = require('./vault-zip-mount-server').resolveMount(id); } catch {}
  if (mount) {
    if (!mount.isRoot) return json(res, { error: "Sub-folders inside a mounted ZIP can't be deleted. Delete the archive instead." }, 400);
    if (!mount.vaultId) return json(res, { error: 'This archive cannot be deleted from here.' }, 400);
    return apiVaultDelete(req, res, mount.vaultId);
  }

  const meta = loadVaultMeta();
  if (!meta[id] || meta[id].type !== 'folder') return json(res, { error: 'Not found' }, 404);
  const parentId = meta[id].parent || null;
  delete meta[id];
  for (const [fid, m] of Object.entries(meta)) {
    if (m.folder === id) meta[fid] = { ...m, folder: parentId };
    if (m.type === 'folder' && (m.parent || null) === id) meta[fid] = { ...m, parent: parentId };
  }
  saveVaultMeta(meta);
  json(res, { ok: true });
}

async function apiVaultRenameFolder(req, res, id) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  const meta = loadVaultMeta();
  if (!meta[id] || meta[id].type !== 'folder') return json(res, { error: 'Not found' }, 404);
  const body = await readBody(req);
  const name = (body.name || '').trim();
  if (!name) return json(res, { error: 'Name required' }, 400);
  const parent = meta[id].parent || null;
  const clash = Object.entries(meta).find(([fid, m]) => fid !== id && m.type === 'folder' && m.name.toLowerCase() === name.toLowerCase() && (m.parent || null) === parent);
  if (clash) return json(res, { error: 'A folder with that name already exists here' }, 409);
  meta[id] = { ...meta[id], name, mtime: Date.now() };
  saveVaultMeta(meta);
  json(res, { ok: true });
}

async function apiVaultMoveFolder(req, res, id) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  const meta = loadVaultMeta();
  if (!meta[id] || meta[id].type !== 'folder') return json(res, { error: 'Not found' }, 404);
  const body = await readBody(req);
  const newParent = body.parent || null;
  if (newParent && !meta[newParent]) return json(res, { error: 'Target parent not found' }, 404);
  // Guard against moving a folder into one of its own descendants
  if (newParent) {
    let cur = newParent;
    while (cur) {
      if (cur === id) return json(res, { error: 'Cannot move a folder into its own subfolder' }, 400);
      cur = meta[cur]?.parent || null;
    }
  }
  meta[id] = { ...meta[id], parent: newParent, mtime: Date.now() };
  saveVaultMeta(meta);
  json(res, { ok: true });
}

async function apiVaultReadBook(req, res, id) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  if (!_safeId(id)) return json(res, { error: 'Bad id' }, 400);

  const meta = loadVaultMeta();
  const fileMeta = meta[id];
  if (!fileMeta) return json(res, { error: 'Not found' }, 404);

  const encPath = path.join(VAULT_DIR, id + '.enc');
  if (!fs.existsSync(encPath)) return json(res, { error: 'Encrypted file not found' }, 404);

  try {
    const raw = fs.readFileSync(encPath);
    const ivLen = 12, tagLen = 16;
    if (raw.length < ivLen + tagLen) return json(res, { error: 'File corrupted' }, 500);
    const iv = raw.slice(0, ivLen);
    const tag = raw.slice(raw.length - tagLen);
    const ct = raw.slice(ivLen, raw.length - tagLen);

    const dec = crypto.createDecipheriv('aes-256-gcm', vaultKey, iv);
    dec.setAuthTag(tag);
    const decrypted = Buffer.concat([dec.update(ct), dec.final()]);

    const ext = (fileMeta.ext || path.extname(fileMeta.originalName || '')).toLowerCase();

    if (ext === '.pdf' || ext === '.epub') {
      const mime = ext === '.pdf' ? 'application/pdf' : 'application/epub+zip';
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': decrypted.length, ...NO_CACHE_HEADERS });
      res.end(decrypted);
    } else {
      json(res, { title: fileMeta.originalName, content: decrypted.toString('utf-8'), ext, type: 'vault' });
    }
  } catch (e) {
    json(res, { error: 'Decryption failed: ' + e.message }, 500);
  }
}

async function apiVaultMoveFile(req, res, id) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  const meta = loadVaultMeta();
  if (!meta[id] || meta[id].type === 'folder') return json(res, { error: 'Not found' }, 404);
  const body = await readBody(req);
  const folder = body.folder || null;
  if (folder && !meta[folder]) return json(res, { error: 'Folder not found' }, 404);
  meta[id] = { ...meta[id], folder };
  saveVaultMeta(meta);
  json(res, { ok: true });
}

async function apiVaultCreateTextFile(req, res) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  resetVaultTimer();
  if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });

  const body = await readBody(req);
  let name = (body.name || 'Untitled.txt').trim();
  if (!name.includes('.')) name += '.txt';

  const folder = body.folder || null;
  const content = body.content || '';
  const id = crypto.randomUUID();
  const outPath = path.join(VAULT_DIR, id + '.enc');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', vaultKey, iv);

  let size = 0;
  try {
    const buf = Buffer.from(content, 'utf-8');
    size = buf.length;
    const enc = cipher.update(buf);
    const fin = cipher.final();
    fs.writeFileSync(outPath, Buffer.concat([iv, enc, fin, cipher.getAuthTag()]));
  } catch (e) {
    return json(res, { error: 'Encryption failed' }, 500);
  }

  const ext = path.extname(name).toLowerCase();
  const meta = loadVaultMeta();
  meta[id] = { originalName: name, name: path.basename(name, ext), ext, size, sizeF: _fmtBytes(size), mtime: Date.now(), folder };
  saveVaultMeta(meta);
  json(res, { ok: true, id });
}

async function apiVaultUpdateTextFile(req, res, id) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  resetVaultTimer();
  const meta = loadVaultMeta();
  if (!meta[id]) return json(res, { error: 'Not found' }, 404);
  const ext = (meta[id].ext || '').toLowerCase();
  if (ext !== '.txt' && ext !== '.md') return json(res, { error: 'Only txt/md files are editable' }, 400);

  const body = await readBody(req);
  const content = typeof body.content === 'string' ? body.content : '';
  const buf = Buffer.from(content, 'utf-8');
  const outPath = path.join(VAULT_DIR, id + '.enc');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', vaultKey, iv);
  const enc = cipher.update(buf);
  const fin = cipher.final();
  const tag = cipher.getAuthTag();
  fs.writeFileSync(outPath, Buffer.concat([iv, enc, fin, tag]));

  meta[id] = { ...meta[id], size: buf.length, sizeF: _fmtBytes(buf.length), mtime: Date.now() };
  saveVaultMeta(meta);
  json(res, { ok: true });
}

// ── Vault Encrypted JSON helpers (used by Favourites) ────────────────

function _encryptJson(data) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', vaultKey, iv);
  const plain = Buffer.from(JSON.stringify(data), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, enc, cipher.getAuthTag()]);
}

function _decryptJson(buf) {
  const iv = buf.slice(0, 12);
  const tag = buf.slice(buf.length - 16);
  const enc = buf.slice(12, buf.length - 16);
  const dec = crypto.createDecipheriv('aes-256-gcm', vaultKey, iv);
  dec.setAuthTag(tag);
  return JSON.parse(Buffer.concat([dec.update(enc), dec.final()]).toString('utf8'));
}

// ── Vault Favourites (encrypted JSON array of IDs) ────────────────────

const VAULT_FAVS_FILE = path.join(VAULT_DIR, '_vault_favs.enc');

function _loadVaultFavs() {
  if (!fs.existsSync(VAULT_FAVS_FILE)) return [];
  try { return _decryptJson(fs.readFileSync(VAULT_FAVS_FILE)); } catch { return []; }
}

function _saveVaultFavs(arr) {
  if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });
  fs.writeFileSync(VAULT_FAVS_FILE, _encryptJson(arr));
}

function apiVaultFavsGet(req, res) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  resetVaultTimer();
  json(res, _loadVaultFavs());
}

function apiVaultFavsToggle(req, res, id) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  resetVaultTimer();
  const arr = _loadVaultFavs();
  const idx = arr.indexOf(id);
  if (idx >= 0) arr.splice(idx, 1); else arr.push(id);
  _saveVaultFavs(arr);
  json(res, { ok: true, fav: idx < 0 });
}

function apiVaultStreamPage(req, res, id) {
  if (!vaultKey) { res.writeHead(401, NO_CACHE_HEADERS); res.end('Vault locked'); return; }
  resetVaultTimer();
  if (!_safeId(id)) { res.writeHead(400); res.end(); return; }
  const meta = loadVaultMeta();
  const encPath = path.join(VAULT_DIR, id + '.enc');
  if (!meta[id] || !fs.existsSync(encPath)) { res.writeHead(404); res.end(); return; }
  try {
    const raw = fs.readFileSync(encPath);
    const iv = raw.slice(0, 12);
    const tag = raw.slice(raw.length - 16);
    const ct = raw.slice(12, raw.length - 16);
    const dec = crypto.createDecipheriv('aes-256-gcm', vaultKey, iv);
    dec.setAuthTag(tag);
    const out = Buffer.concat([dec.update(ct), dec.final()]);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': out.length, ...NO_CACHE_HEADERS });
    res.end(out);
  } catch (e) {
    if (!res.headersSent) res.writeHead(500);
    res.end('Decryption failed');
  }
}

async function apiVaultImportDrop(req, res) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  if (_isProcessingDrop) return json(res, { ok: true, message: 'Already importing' });
  processHiddenFolder().catch(() => { });
  json(res, { ok: true });
}

function getFileMeta(id) {
  const meta = loadVaultMeta();
  return meta[id] || null;
}

async function apiVaultRename(req, res, id) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  const meta = loadVaultMeta();
  if (!meta[id] || meta[id].type === 'folder') return json(res, { error: 'Not found' }, 404);
  const body = await readBody(req);
  const name = (body.name || '').trim();
  if (!name) return json(res, { error: 'Name required' }, 400);
  meta[id] = { ...meta[id], name };
  saveVaultMeta(meta);
  json(res, { ok: true });
}

function apiVaultAiTag(req, res, id) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  const meta = loadVaultMeta();
  if (!meta[id]) return json(res, { error: 'not found' }, 404);
  meta[id].aiTagged = true;
  saveVaultMeta(meta);
  json(res, { ok: true });
}

function decryptToBuffer(id) {
  if (!vaultKey) return null;
  const encPath = path.join(VAULT_DIR, id + '.enc');
  if (!fs.existsSync(encPath)) return null;
  const meta = loadVaultMeta();
  if (!meta[id]) return null;
  try {
    const raw = fs.readFileSync(encPath);
    const iv = raw.slice(0, 12);
    const tag = raw.slice(raw.length - 16);
    const ct = raw.slice(12, raw.length - 16);
    const dec = crypto.createDecipheriv('aes-256-gcm', vaultKey, iv);
    dec.setAuthTag(tag);
    const buffer = Buffer.concat([dec.update(ct), dec.final()]);
    const ext = (meta[id].ext || '.jpg').toLowerCase();
    const mimeType = MIME[ext] || 'image/jpeg';
    return { buffer, mimeType };
  } catch { return null; }
}

function isUnlocked() {
  return !!vaultKey;
}

// Programmatic lock — used when switching away from the Vault profile so the
// session key doesn't outlive the profile context.
function lockVault() {
  clearVaultTimer();
  vaultKey = null;
  _autoLockHold = 0;
  _deferredLock = false;
  try { setVaultKey(null); } catch {}
  failedAttempts = 0;
  cooldownUntil = 0;
}

function getVaultKey() {
  return vaultKey;
}

// ── Test-only seams ──────────────────────────────────────────────────
// Fully reset module-internal state between tests (key + lockout counters).
function __resetForTest() {
  clearVaultTimer();
  vaultKey = null;
  try { setVaultKey(null); } catch { }
  failedAttempts = 0;
  cooldownUntil = 0;
}

// Stop background timers so a test runner can exit cleanly.
function __stopTimers() {
  clearVaultTimer();
  if (_sweepInterval) clearInterval(_sweepInterval);
}

// ── Restore a vault file to its original category folder ─────────────

async function apiVaultRestoreToOrigin(req, res, id) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  resetVaultTimer();

  const meta = loadVaultMeta();
  const entry = meta[id];
  if (!entry) return json(res, { error: 'Not found' }, 404);
  if (entry.type === 'folder') return json(res, { error: 'Cannot restore a folder entry' }, 400);

  const { VIDEOS_DIR } = require('./config-server');
  const catPath = entry.category || '';
  const destDir = catPath ? path.join(VIDEOS_DIR, catPath) : VIDEOS_DIR;

  const encPath = path.join(VAULT_DIR, id + '.enc');
  if (!fs.existsSync(encPath)) return json(res, { error: 'Encrypted file not found' }, 404);
  if (!fs.existsSync(destDir)) {
    try { fs.mkdirSync(destDir, { recursive: true }); } catch (e) {
      return json(res, { error: 'Cannot create destination directory: ' + e.message }, 500);
    }
  }

  const originalName = entry.originalName || (id + (entry.ext || ''));
  let finalDest = path.join(destDir, originalName);
  if (fs.existsSync(finalDest)) {
    const ext = path.extname(originalName);
    const base = path.basename(originalName, ext);
    let n = 1;
    while (fs.existsSync(finalDest)) finalDest = path.join(destDir, `${base}_${n++}${ext}`);
  }

  const tmpDest = finalDest + '.restoring';
  try {
    await _streamDecryptToFile(encPath, tmpDest);
    fs.renameSync(tmpDest, finalDest);
    _shredFile(encPath);
    delete meta[id];
    saveVaultMeta(meta);
    try { require('./videos-server').invalidateScanCache(); } catch {}
    json(res, { ok: true, path: finalDest, name: path.basename(finalDest) });
  } catch (e) {
    try { fs.unlinkSync(tmpDest); } catch {}
    json(res, { error: 'Restore failed: ' + e.message }, 500);
  }
}

// ── Vault links (encrypted file) ──────────────────────────────────────
// Links are stored in _vault_links.enc so URLs and titles are encrypted
// at rest. On password change, this file is re-encrypted automatically
// by apiVaultChangePassword (it matches the _*.enc pattern).

const VAULT_LINKS_FILE = path.join(VAULT_DIR, '_vault_links.enc');

function _loadVaultLinksEnc() {
  if (!fs.existsSync(VAULT_LINKS_FILE)) return [];
  try {
    const raw = fs.readFileSync(VAULT_LINKS_FILE);
    const iv  = raw.slice(0, 12);
    const tag = raw.slice(raw.length - 16);
    const enc = raw.slice(12, raw.length - 16);
    const dec = crypto.createDecipheriv('aes-256-gcm', vaultKey, iv);
    dec.setAuthTag(tag);
    return JSON.parse(Buffer.concat([dec.update(enc), dec.final()]).toString('utf8'));
  } catch { return []; }
}

function _saveVaultLinksEnc(links) {
  if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', vaultKey, iv);
  const plain  = Buffer.from(JSON.stringify(links), 'utf8');
  const enc    = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag    = cipher.getAuthTag();
  fs.writeFileSync(VAULT_LINKS_FILE, Buffer.concat([iv, enc, tag]));
}

async function apiVaultGetLinks(req, res) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  resetVaultTimer();
  json(res, _loadVaultLinksEnc());
}

async function apiVaultImportLinks(req, res) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  resetVaultTimer();
  const body = await readBody(req);
  const urls = Array.isArray(body.urls) ? body.urls.filter(u => u && typeof u === 'string') : [];
  if (!urls.length) return json(res, { error: 'No URLs provided' }, 400);
  const links = _loadVaultLinksEnc();
  const seen  = new Set(links.map(l => l.url));
  let added = 0;
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    links.push({ url, title: url, addedAt: Date.now() });
    added++;
  }
  _saveVaultLinksEnc(links);
  json(res, { ok: true, added, skipped: urls.length - added });
}

async function apiVaultMoveLinks(req, res) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  resetVaultTimer();
  const body = await readBody(req);
  const urls = Array.isArray(body.urls) ? body.urls : [];
  if (!urls.length) return json(res, { error: 'No URLs provided' }, 400);
  const { loadLinksCache, deleteLink } = require('./db-server');
  const all   = loadLinksCache().items || [];
  const links = _loadVaultLinksEnc();
  const seen  = new Set(links.map(l => l.url));
  let moved = 0;
  for (const url of urls) {
    const existing = all.find(l => l.url === url);
    if (!seen.has(url)) {
      seen.add(url);
      links.push(existing ? { ...existing, vault: undefined } : { url, title: url, addedAt: Date.now() });
    }
    deleteLink(url);
    moved++;
  }
  _saveVaultLinksEnc(links);
  json(res, { ok: true, moved });
}

// Toggle the private favourite flag on a vault link. Favourites are stored
// inside _vault_links.enc, so they stay encrypted at rest like the links.
async function apiVaultLinkFav(req, res) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  resetVaultTimer();
  const body = await readBody(req);
  const { url } = body;
  if (!url) return json(res, { error: 'URL required' }, 400);
  const links = _loadVaultLinksEnc();
  const link = links.find(l => l.url === url);
  if (!link) return json(res, { error: 'Not found in vault links' }, 404);
  link.fav = !link.fav;
  _saveVaultLinksEnc(links);
  json(res, { ok: true, fav: !!link.fav });
}

async function apiVaultRestoreLink(req, res) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  resetVaultTimer();
  const body = await readBody(req);
  const { url } = body;
  if (!url) return json(res, { error: 'URL required' }, 400);
  const links    = _loadVaultLinksEnc();
  const idx      = links.findIndex(l => l.url === url);
  if (idx < 0) return json(res, { error: 'Not found in vault links' }, 404);
  const [link]   = links.splice(idx, 1);
  _saveVaultLinksEnc(links);
  const { upsertLink } = require('./db-server');
  upsertLink({ ...link, vault: 0 });
  json(res, { ok: true });
}

async function apiVaultRestoreLinks(req, res) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  resetVaultTimer();
  const body = await readBody(req);
  const urls = Array.isArray(body.urls) ? body.urls : [];
  if (!urls.length) return json(res, { error: 'No URLs provided' }, 400);
  const urlSet = new Set(urls);
  const links = _loadVaultLinksEnc();
  const restored = [];
  const remaining = [];
  for (const link of links) {
    if (urlSet.has(link.url)) { restored.push(link); }
    else { remaining.push(link); }
  }
  _saveVaultLinksEnc(remaining);
  const { upsertLink } = require('./db-server');
  for (const link of restored) upsertLink({ ...link, vault: 0 });
  json(res, { ok: true, restored: restored.length });
}

module.exports = {
  apiVaultStatus, apiVaultSetup, apiVaultUnlock, apiVaultLock,
  apiVaultFiles, apiVaultAdd, apiVaultStream, apiVaultDelete, apiVaultDownload,
  apiVaultCreateFolder, apiVaultDeleteFolder, apiVaultRenameFolder, apiVaultMoveFolder,
  apiVaultMoveFile, apiVaultCreateTextFile,
  apiVaultUpdateTextFile,
  apiVaultChangePassword, apiVaultDeleteVault,
  apiVaultFavsGet, apiVaultFavsToggle,
  apiVaultReadBook, apiVaultStreamPage, apiVaultPageResource,
  apiVaultImportDrop, decryptToBuffer, getFileMeta, apiVaultAiTag, apiVaultRename,
  apiVaultRestoreFile, apiVaultRestoreToOrigin,
  apiVaultGetLinks, apiVaultImportLinks, apiVaultMoveLinks, apiVaultRestoreLink, apiVaultRestoreLinks, apiVaultLinkFav,
  deriveKeys, NO_CACHE_HEADERS, isUnlocked, lockVault, scheduleDeferredLock, getVaultKey, encryptLocalFileToVault: _encryptLocalFileToVault,
  encryptBufferToVault, createVaultFolder, suspendAutoLock, resumeAutoLock, reconcileVaultOrphans,
  apiVaultThumb, apiVaultGenThumbs, apiVaultGenThumbsStatus, generateVaultThumb,
  shredFile: _shredFile,
  __resetForTest, __stopTimers,
};
