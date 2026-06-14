'use strict';
// ═══════════════════════════════════════════════════════════════════
//  vault-server.js — Encrypted vault: setup, lock/unlock, streaming
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { VAULT_DIR, VAULT_CONFIG_FILE, VAULT_META_FILE, MIME, PROCESS_DIR } = require('./config-server');
const { json, readBody, formatBytes: _fmtBytes } = require('./helpers-server');
const { loadHidden, loadVaultConfig, saveVaultConfig, loadVaultMeta, saveVaultMeta, loadPrefs, setVaultKey } = require('./db-server');
const VAULT_DROP_DIR = typeof PROCESS_DIR !== 'undefined' ? PROCESS_DIR : path.join(path.dirname(VAULT_DIR), 'hidden');

// Static salt used by default — any installation with the same password derives the same key.
// Using a custom random salt improves security against rainbow tables but breaks portability.
const STATIC_SALT = 'AphroArchive';
// ── Module state ─────────────────────────────────────────────────────

let vaultKey = null;
let failedAttempts = 0;
let cooldownUntil = 0;

// Default auto-lock period; overridden per-install by prefs (see getVaultTimeoutMs).
const DEFAULT_VAULT_TIMEOUT_MS = 5 * 60 * 1000;
let vaultTimer = null;

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
  if (!vaultKey) return;
  if (vaultTimer) { clearTimeout(vaultTimer); vaultTimer = null; }
  const ms = getVaultTimeoutMs();
  if (!ms || ms <= 0) return; // 0 → auto-lock disabled
  vaultTimer = setTimeout(() => {
    vaultKey = null;
    vaultTimer = null;
    try { setVaultKey(null); } catch { }
  }, ms);
}

function clearVaultTimer() {
  if (vaultTimer) { clearTimeout(vaultTimer); vaultTimer = null; }
}

// ── Crypto helpers ───────────────────────────────────────────────────

function deriveKeys(password, salt) {
  const pbkdf2 = (pw, s) => new Promise((res, rej) =>
    crypto.pbkdf2(pw, s, 100000, 32, 'sha512', (err, k) => err ? rej(err) : res(k)));
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
    src.pipe(dec).pipe(res);
    dec.on('error', () => { try { res.end(); } catch { } });
    return;
  }

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
    src.pipe(dec).pipe(res);
    dec.on('error', () => { try { res.end(); } catch { } });
  }
}

// Re-encrypt a single .enc file with a new key (streaming, no full-file buffer)
async function _reEncryptFile(filePath, oldKey, newKey) {
  const stat = fs.statSync(filePath);
  const total = stat.size, ivLen = 12, tagLen = 16;

  const fd = fs.openSync(filePath, 'r');
  const oldIv = Buffer.alloc(ivLen);
  fs.readSync(fd, oldIv, 0, ivLen, 0);
  const oldTag = Buffer.alloc(tagLen);
  fs.readSync(fd, oldTag, 0, tagLen, total - tagLen);
  fs.closeSync(fd);

  const newIv = crypto.randomBytes(12);
  const tmpPath = filePath + '.tmp';

  const dec = crypto.createDecipheriv('aes-256-gcm', oldKey, oldIv);
  dec.setAuthTag(oldTag);
  const enc = crypto.createCipheriv('aes-256-gcm', newKey, newIv);
  const src = fs.createReadStream(filePath, { start: ivLen, end: total - tagLen - 1 });
  const dst = fs.createWriteStream(tmpPath);
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

  fs.unlinkSync(filePath);
  fs.renameSync(tmpPath, filePath);
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
    const { encKey, verifyHash } = await deriveKeys(pw, salt);

    // Optional duress / self-destruct password. Entering it at unlock time
    // silently wipes the vault while presenting a normal "wrong password"
    // response. Stored as an independent salt+hash; never reveals the real key.
    const cfg = { salt, verifyHash, useRandomSalt: !!body.useRandomSalt };
    const duressPw = (body.duressPassword || '').trim();
    if (duressPw && duressPw !== pw && duressPw.length >= 6) {
      const duressSalt = body.useRandomSalt ? crypto.randomBytes(32).toString('hex') : salt + ':duress';
      const { verifyHash: duressHash } = await deriveKeys(duressPw, duressSalt);
      cfg.duressSalt = duressSalt;
      cfg.duressHash = duressHash;
    }
    saveVaultConfig(cfg);
    vaultKey = encKey;
    setVaultKey(encKey);
    failedAttempts = 0; cooldownUntil = 0;
    resetVaultTimer();
    if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });
    json(res, { ok: true });
    processHiddenFolder();
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
    const { encKey, verifyHash } = await deriveKeys(pw, cfg.salt);
    if (!_timingEqualHex(verifyHash, cfg.verifyHash)) {
      // Duress / self-destruct: a matching duress password wipes the vault
      // and returns a generic wrong-password error so the wipe is invisible.
      if (cfg.duressHash && cfg.duressSalt) {
        const { verifyHash: duressHash } = await deriveKeys(pw, cfg.duressSalt);
        if (_timingEqualHex(duressHash, cfg.duressHash)) {
          _silentWipe();
          return json(res, { error: 'Wrong password', attempts: failedAttempts + 1 }, 401);
        }
      }

      failedAttempts++;

      // Exponential backoff: 2nd fail → 5s, 3rd fail → 30s
      if (failedAttempts === 2) cooldownUntil = now + 5_000;
      else if (failedAttempts === 3) cooldownUntil = now + 30_000;

      return json(res, { error: 'Wrong password', attempts: failedAttempts }, 401);
    }

    // Correct password — reset counters
    failedAttempts = 0; cooldownUntil = 0;
    vaultKey = encKey;
    setVaultKey(encKey);
    resetVaultTimer();
    json(res, { ok: true });
    processHiddenFolder();
    try { require('./feed-watcher-server').processPendingPrivateFeed(); } catch {}
  } catch (e) { json(res, { error: e.message }, 500); }
}

function apiVaultLock(req, res) {
  clearVaultTimer();
  vaultKey = null;
  setVaultKey(null);
  json(res, { ok: true });
}

function apiVaultFiles(req, res) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  resetVaultTimer();
  const meta = loadVaultMeta();
  const items = Object.entries(meta).map(([id, m]) => ({ id, ...m })).sort((a, b) => b.mtime - a.mtime);
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
  const meta = loadVaultMeta();
  if (!meta[id]) return json(res, { error: 'Not found' }, 404);
  _shredFile(path.join(VAULT_DIR, id + '.enc'));
  // Shred per-page resource subdirectory if present
  const pageDir = path.join(VAULT_DIR, id);
  if (fs.existsSync(pageDir)) _shredDir(pageDir);
  delete meta[id];
  saveVaultMeta(meta);
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

  try {
    // Authenticate with the old password before validating the new one.
    const { encKey: oldKey, verifyHash: oldHash } = await deriveKeys(oldPw, cfg.salt);
    if (!_timingEqualHex(oldHash, cfg.verifyHash)) return json(res, { error: 'Old password is wrong' }, 401);
    if (newPw.length < 6) return json(res, { error: 'New password must be at least 6 characters' }, 400);

    // Keep the same salt type as the original setup (static or random).
    // If useRandomSalt is explicitly set in body, honour it; otherwise preserve the original choice.
    const keepStatic = body.useRandomSalt === undefined
      ? !cfg.useRandomSalt
      : !body.useRandomSalt;
    const newSalt = keepStatic ? STATIC_SALT : crypto.randomBytes(32).toString('hex');
    const { encKey: newKey, verifyHash: newHash } = await deriveKeys(newPw, newSalt);

    // Re-encrypt all .enc files in VAULT_DIR
    if (fs.existsSync(VAULT_DIR)) {
      const files = fs.readdirSync(VAULT_DIR).filter(f => f.endsWith('.enc') && !f.startsWith('_'));
      for (const file of files) {
        await _reEncryptFile(path.join(VAULT_DIR, file), oldKey, newKey);
      }
    }

    // Re-encrypt the special encrypted-JSON files (_vault_favs.enc, _vault_links.enc)
    if (fs.existsSync(VAULT_DIR)) {
      const specials = fs.readdirSync(VAULT_DIR).filter(f => f.startsWith('_') && f.endsWith('.enc'));
      for (const file of specials) {
        await _reEncryptFile(path.join(VAULT_DIR, file), oldKey, newKey);
      }
    }

    // Re-encrypt prompts and comments stored in the Vault SQLite database
    const { reEncryptVaultSqlite } = require('./db-server');
    reEncryptVaultSqlite(oldKey, newKey);

    // Save new config. The duress password is independent of the main
    // password (own salt+hash), so carry it across a password change unless
    // the caller supplies a new one.
    const newCfg = { salt: newSalt, verifyHash: newHash, useRandomSalt: !keepStatic };
    const newDuressPw = (body.duressPassword || '').trim();
    if (newDuressPw && newDuressPw !== newPw && newDuressPw.length >= 6) {
      const duressSalt = keepStatic ? newSalt + ':duress' : crypto.randomBytes(32).toString('hex');
      const { verifyHash: duressHash } = await deriveKeys(newDuressPw, duressSalt);
      newCfg.duressSalt = duressSalt;
      newCfg.duressHash = duressHash;
    } else if (cfg.duressHash && cfg.duressSalt) {
      newCfg.duressSalt = cfg.duressSalt;
      newCfg.duressHash = cfg.duressHash;
    }
    saveVaultConfig(newCfg);
    vaultKey = newKey;
    setVaultKey(newKey);
    resetVaultTimer();
    json(res, { ok: true });
  } catch (e) { json(res, { error: e.message }, 500); }
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

  try {
    // Read the encrypted file
    const raw = fs.readFileSync(encPath);
    const ivLen = 12, tagLen = 16;
    if (raw.length < ivLen + tagLen) return json(res, { error: 'Encrypted file is too small or corrupted' }, 500);

    const iv  = raw.slice(0, ivLen);
    const tag = raw.slice(raw.length - tagLen);
    const ct  = raw.slice(ivLen, raw.length - tagLen);

    const dec = crypto.createDecipheriv('aes-256-gcm', vaultKey, iv);
    dec.setAuthTag(tag);
    const plaintext = Buffer.concat([dec.update(ct), dec.final()]);

    // Write decrypted data to destination atomically via a temp file
    const tmpDest = finalDest + '.restoring';
    fs.writeFileSync(tmpDest, plaintext);
    fs.renameSync(tmpDest, finalDest);

    // SUCCESS — now it is safe to remove the encrypted copy
    _shredFile(encPath);

    // Remove from vault metadata
    delete meta[id];
    saveVaultMeta(meta);

    json(res, { ok: true, path: finalDest, name: path.basename(finalDest) });
  } catch (e) {
    // Clean up any partial temp file
    try { fs.unlinkSync(finalDest + '.restoring'); } catch { }
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

  try { if (fs.existsSync(VAULT_CONFIG_FILE)) fs.unlinkSync(VAULT_CONFIG_FILE); } catch {}
  try { if (fs.existsSync(VAULT_META_FILE)) fs.unlinkSync(VAULT_META_FILE); } catch {}
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

  _silentWipe();
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

async function apiVaultDeleteFolder(req, res, id) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
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

  const meta = loadVaultMeta();
  const fileMeta = meta[id];
  if (!fileMeta) return json(res, { error: 'Not found' }, 404);

  const encPath = path.join(VAULT_DIR, id + '.enc');
  const raw = fs.readFileSync(encPath);
  const ivLen = 12, tagLen = 16;
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

  try {
    const raw = fs.readFileSync(encPath);
    const ivLen = 12, tagLen = 16;
    if (raw.length < ivLen + tagLen) return json(res, { error: 'File corrupted' }, 500);
    const iv = raw.slice(0, ivLen);
    const tag = raw.slice(raw.length - tagLen);
    const ct = raw.slice(ivLen, raw.length - tagLen);
    const dec = crypto.createDecipheriv('aes-256-gcm', vaultKey, iv);
    dec.setAuthTag(tag);
    const plaintext = Buffer.concat([dec.update(ct), dec.final()]);
    const tmpDest = finalDest + '.restoring';
    fs.writeFileSync(tmpDest, plaintext);
    fs.renameSync(tmpDest, finalDest);
    _shredFile(encPath);
    delete meta[id];
    saveVaultMeta(meta);
    json(res, { ok: true, path: finalDest, name: path.basename(finalDest) });
  } catch (e) {
    try { fs.unlinkSync(finalDest + '.restoring'); } catch {}
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
  apiVaultGetLinks, apiVaultImportLinks, apiVaultMoveLinks, apiVaultRestoreLink, apiVaultLinkFav,
  deriveKeys, NO_CACHE_HEADERS, isUnlocked, getVaultKey, encryptLocalFileToVault: _encryptLocalFileToVault,
  encryptBufferToVault,
  shredFile: _shredFile,
  __resetForTest, __stopTimers,
};
