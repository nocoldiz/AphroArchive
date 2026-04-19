'use strict';
// ═══════════════════════════════════════════════════════════════════
//  vault-server.js — Encrypted vault: setup, lock/unlock, streaming
// ═══════════════════════════════════════════════════════════════════

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { VAULT_DIR, VAULT_CONFIG_FILE, VAULT_META_FILE, MIME, HIDDEN_DIR } = require('./config-server');
const { json, readBody, formatBytes: _fmtBytes } = require('./helpers-server');
const { loadHidden, loadVaultConfig, saveVaultConfig, loadVaultMeta, saveVaultMeta, loadPrefs } = require('./db-server');
const VAULT_DROP_DIR = typeof HIDDEN_DIR !== 'undefined' ? HIDDEN_DIR : path.join(path.dirname(VAULT_DIR), 'hidden');
// ── Module state ─────────────────────────────────────────────────────

let vaultKey     = null;
let failedAttempts = 0;
let cooldownUntil  = 0;

const VAULT_TIMEOUT = 5 * 60 * 1000;
let vaultTimer  = null;

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
};

function resetVaultTimer() {
  if (!vaultKey) return;
  if (vaultTimer) clearTimeout(vaultTimer);
  vaultTimer = setTimeout(() => {
    vaultKey  = null;
    vaultTimer = null;
  }, VAULT_TIMEOUT);
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

// Overwrite a file with random bytes, then delete it
function _shredFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const size = stat.size;
    const fd   = fs.openSync(filePath, 'r+');
    let written = 0;
    while (written < size) {
      const chunk = Math.min(65536, size - written);
      fs.writeSync(fd, crypto.randomBytes(chunk), 0, chunk, written);
      written += chunk;
    }
    fs.closeSync(fd);
    fs.unlinkSync(filePath);
  } catch {}
}

// Silently shred the entire vault — called on silent wipe
function _silentWipe() {
  try {
    if (fs.existsSync(VAULT_DIR)) {
      for (const file of fs.readdirSync(VAULT_DIR)) {
        _shredFile(path.join(VAULT_DIR, file));
      }
    }
    _shredFile(VAULT_CONFIG_FILE);
    _shredFile(VAULT_META_FILE);
  } catch {}
  vaultKey       = null;
  failedAttempts = 0;
  cooldownUntil  = 0;
  clearVaultTimer();
}

// Stream-decrypt an .enc file directly to an HTTP response (no temp files)
// File format: [12 IV][encrypted data][16 auth tag]
function _streamDecrypt(req, res, id, meta, isDownload) {
  const encPath = path.join(VAULT_DIR, id + '.enc');
  const stat    = fs.statSync(encPath);
  const total   = stat.size;
  if (total < 28) { // 12 bytes IV + 16 bytes auth tag = 28 bytes minimum
  throw new Error('Encrypted file is too small or corrupted.');
}
  const ivLen   = 12, tagLen = 16;
  const contentSize = total - ivLen - tagLen;
  const ct      = MIME[meta[id].ext] || (isDownload ? 'application/octet-stream' : 'video/mp4');

  // Read IV and auth tag synchronously (tiny fixed-size reads)
  const fd  = fs.openSync(encPath, 'r');
  const iv  = Buffer.alloc(ivLen);
  fs.readSync(fd, iv, 0, ivLen, 0);
  const tag = Buffer.alloc(tagLen);
  fs.readSync(fd, tag, 0, tagLen, total - tagLen);
  fs.closeSync(fd);

  if (isDownload) {
    const filename = meta[id].originalName;
    const encoded  = encodeURIComponent(filename).replace(/'/g, '%27');
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
    dec.on('error', () => { try { res.end(); } catch {} });
    return;
  }

  const range = req.headers.range;
  if (range) {
    const [s, e2] = range.replace(/bytes=/, '').split('-');
    const start   = parseInt(s, 10);
    const end     = e2 ? parseInt(e2, 10) : contentSize - 1;
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
    dec.on('end', () => { try { res.end(); } catch {} });
    dec.on('error', () => { try { res.end(); } catch {} });
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
    dec.on('error', () => { try { res.end(); } catch {} });
  }
}

// Re-encrypt a single .enc file with a new key (streaming, no full-file buffer)
async function _reEncryptFile(filePath, oldKey, newKey) {
  const stat  = fs.statSync(filePath);
  const total = stat.size, ivLen = 12, tagLen = 16;

  const fd     = fs.openSync(filePath, 'r');
  const oldIv  = Buffer.alloc(ivLen);
  fs.readSync(fd, oldIv, 0, ivLen, 0);
  const oldTag = Buffer.alloc(tagLen);
  fs.readSync(fd, oldTag, 0, tagLen, total - tagLen);
  fs.closeSync(fd);

  const newIv  = crypto.randomBytes(12);
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
    src.pipe(dec);
  });

  fs.unlinkSync(filePath);
  fs.renameSync(tmpPath, filePath);
}
// ── Auto-import hidden files ─────────────────────────────────────────

let _isProcessingDrop = false;

// ── HTML page bundling helpers ───────────────────────────────────────

function _shredDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return;
    for (const entry of fs.readdirSync(dirPath)) {
      const full = path.join(dirPath, entry);
      if (fs.statSync(full).isDirectory()) _shredDir(full);
      else _shredFile(full);
    }
    fs.rmdirSync(dirPath);
  } catch {}
}

function _resolveLocalPath(src, baseDir, resDir) {
  if (!src || /^https?:\/\//.test(src) || src.startsWith('//') || src.startsWith('data:')) return null;
  const clean = decodeURIComponent(src.split('?')[0].split('#')[0]);
  for (const base of [resDir, baseDir].filter(Boolean)) {
    const full = path.resolve(base, clean);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  }
  return null;
}

const _IMG_MIME = {
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif',
  '.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.bmp':'image/bmp',
  '.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf',
};

function _bundleHtml(filePath) {
  const baseDir = path.dirname(filePath);
  const basename = path.basename(filePath, path.extname(filePath));

  let resDir = null;
  for (const c of [basename + '_files', basename + ' files', basename + '.files', basename]) {
    const full = path.join(baseDir, c);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) { resDir = full; break; }
  }

  let html = fs.readFileSync(filePath, 'utf-8');

  const inlineCssUrls = (css, cssPath) => css.replace(/url\(["']?([^"')]+)["']?\)/gi, (m, src) => {
    const p2 = _resolveLocalPath(src, cssPath ? path.dirname(cssPath) : baseDir, resDir);
    if (!p2) return m;
    try {
      const ext = path.extname(p2).toLowerCase();
      return 'url(data:' + (_IMG_MIME[ext] || 'application/octet-stream') + ';base64,' + fs.readFileSync(p2).toString('base64') + ')';
    } catch { return m; }
  });

  // Inline <link rel="stylesheet">
  html = html.replace(/<link([^>]+)>/gi, (m, attrs) => {
    if (!/rel=["']stylesheet["']/i.test(attrs)) return m;
    const hrefM = attrs.match(/href=["']([^"']+)["']/i);
    if (!hrefM) return m;
    const p2 = _resolveLocalPath(hrefM[1], baseDir, resDir);
    if (!p2) return m;
    try { return '<style>' + inlineCssUrls(fs.readFileSync(p2, 'utf-8'), p2) + '</style>'; } catch { return m; }
  });

  // Inline <script src="...">
  html = html.replace(/<script([^>]*)src=["']([^"']+)["']([^>]*)><\/script>/gi, (m, pre, src, post) => {
    const p2 = _resolveLocalPath(src, baseDir, resDir);
    if (!p2) return m;
    try { return '<script' + pre + post + '>' + fs.readFileSync(p2, 'utf-8') + '</script>'; } catch { return m; }
  });

  // Inline <img src="...">
  html = html.replace(/(<img[^>]+src=["'])([^"']+)(["'])/gi, (m, pre, src, q) => {
    const p2 = _resolveLocalPath(src, baseDir, resDir);
    if (!p2) return m;
    try {
      const ext = path.extname(p2).toLowerCase();
      return pre + 'data:' + (_IMG_MIME[ext] || 'image/png') + ';base64,' + fs.readFileSync(p2).toString('base64') + q;
    } catch { return m; }
  });

  return { html, resDir };
}

async function _encryptHtmlPageToVault(filePath, filename) {
  if (!vaultKey) return false;
  try { const fd = fs.openSync(filePath, 'r+'); fs.closeSync(fd); } catch { return false; }

  if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });

  const { html, resDir } = _bundleHtml(filePath);
  const buf = Buffer.from(html, 'utf-8');

  const id      = crypto.randomUUID();
  const outPath = path.join(VAULT_DIR, id + '.enc');
  const iv      = crypto.randomBytes(12);
  const cipher  = crypto.createCipheriv('aes-256-gcm', vaultKey, iv);
  const enc     = cipher.update(buf);
  const fin     = cipher.final();
  fs.writeFileSync(outPath, Buffer.concat([iv, enc, fin, cipher.getAuthTag()]));

  const ext  = path.extname(filename).toLowerCase();
  const meta = loadVaultMeta();
  meta[id]   = { originalName: filename, name: path.basename(filename, ext), ext, size: buf.length, sizeF: _fmtBytes(buf.length), mtime: Date.now(), folder: null, type: 'page' };
  saveVaultMeta(meta);

  _shredFile(filePath);
  if (resDir) _shredDir(resDir);
  return true;
}

// Encrypts a local file, updates vault metadata, and shreds the original
async function _encryptLocalFileToVault(filePath, filename) {
  if (!vaultKey) return false;
  
  // Check if file is still being written to (by attempting to open it)
  try {
    const fd = fs.openSync(filePath, 'r+');
    fs.closeSync(fd);
  } catch (e) {
    return false; // File is likely locked/in-use, skip for now
  }

  if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });

  const id       = crypto.randomUUID();
  const outPath  = path.join(VAULT_DIR, id + '.enc');
  const iv       = crypto.randomBytes(12);
  const cipher   = crypto.createCipheriv('aes-256-gcm', vaultKey, iv);
  const out      = fs.createWriteStream(outPath);
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
  const ext    = path.extname(filename).toLowerCase();
  const meta   = loadVaultMeta();
  meta[id]     = { 
    originalName: filename, 
    name: path.basename(filename, ext), 
    ext, 
    size, 
    sizeF: _fmtBytes(size), 
    mtime: Date.now(), 
    folder: null 
  };
  saveVaultMeta(meta);
  
  // Securely delete the original unencrypted file
  _shredFile(filePath);
  return true;
}

// Sweeps the drop directory
// Sweeps the drop directory
async function processHiddenFolder() {
  if (!vaultKey || _isProcessingDrop) return;
  _isProcessingDrop = true;

  try {
    if (!fs.existsSync(VAULT_DROP_DIR)) fs.mkdirSync(VAULT_DROP_DIR, { recursive: true });
    const files = fs.readdirSync(VAULT_DROP_DIR);
    
    // Define extensions that should be ignored by the auto-importer
    const ignoredExtensions = ['.zip', '.rar', '.7z'];
    
    for (const file of files) {
      if (!vaultKey) break; // Abort if vault gets locked midway
      
      // Check the file extension and skip if it's an ignored archive type
      const ext = path.extname(file).toLowerCase();
      if (ignoredExtensions.includes(ext)) {
        continue;
      }

      const filePath = path.join(VAULT_DROP_DIR, file);
      
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          await _encryptLocalFileToVault(filePath, file);
        }
      } catch (e) {
        // Ignore (file might have been moved/deleted during the sweep)
      }
    }
  } catch (e) {
    console.error('Error processing hidden folder:', e);
  } finally {
    _isProcessingDrop = false;
  }
}

// Poll the folder every 15 seconds
setInterval(() => {
  processHiddenFolder();
}, 15000);

// File Watcher
let _dropTimeout = null;
function watchHiddenFolder() {
  try {
    if (!fs.existsSync(VAULT_DROP_DIR)) fs.mkdirSync(VAULT_DROP_DIR, { recursive: true });
    
    // Listen for all files dropped in
    fs.watch(VAULT_DROP_DIR, (eventType, filename) => {
      if (!vaultKey) return;
      if (_dropTimeout) clearTimeout(_dropTimeout);
      // Wait 2 seconds to allow file copies/downloads to finish before grabbing the file
      _dropTimeout = setTimeout(() => processHiddenFolder(), 2000);
    });
  } catch (e) {
    console.error('Could not watch hidden folder', e);
  }
}

// Start watching immediately when the server boots
watchHiddenFolder();
// ── Vault API handlers ───────────────────────────────────────────────

function apiVaultStatus(req, res) {
  const hidden      = loadHidden();
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
  const pw   = (body.password || '').trim();
  if (pw.length < 6) return json(res, { error: 'Password must be at least 6 characters' }, 400);
  try {
    const salt              = crypto.randomBytes(32).toString('hex');
    const { encKey, verifyHash } = await deriveKeys(pw, salt);
    saveVaultConfig({ salt, verifyHash });
    vaultKey = encKey;
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
  const pw   = (body.password || '').trim();
  try {
    const { encKey, verifyHash } = await deriveKeys(pw, cfg.salt);
    if (verifyHash !== cfg.verifyHash) {
      failedAttempts++;

      if (failedAttempts >= 4 && !!loadPrefs().vaultSelfDestruct) {
        // Silent wipe — attacker must not know this happened
        setImmediate(_silentWipe);
        return json(res, { error: 'Wrong password' }, 401);
      }

      // Exponential backoff: 2nd fail → 5s, 3rd fail → 30s
      if (failedAttempts === 2) cooldownUntil = now + 5_000;
      else if (failedAttempts === 3) cooldownUntil = now + 30_000;

      return json(res, { error: 'Wrong password', attempts: failedAttempts }, 401);
    }

    // Correct password — reset counters
    failedAttempts = 0; cooldownUntil = 0;
    vaultKey = encKey;
    resetVaultTimer();
    json(res, { ok: true });
    processHiddenFolder();
  } catch (e) { json(res, { error: e.message }, 500); }
}

function apiVaultLock(req, res) {
  clearVaultTimer();
  vaultKey = null;
  json(res, { ok: true });
}

function apiVaultFiles(req, res) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  resetVaultTimer();
  const meta  = loadVaultMeta();
  const items = Object.entries(meta).map(([id, m]) => ({ id, ...m })).sort((a, b) => b.mtime - a.mtime);
  json(res, items);
}

async function apiVaultAdd(req, res) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  resetVaultTimer();
  if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });
  const filename = decodeURIComponent(req.headers['x-filename'] || 'video');
  const id       = crypto.randomUUID();
  const outPath  = path.join(VAULT_DIR, id + '.enc');
  const iv       = crypto.randomBytes(12);
  const cipher   = crypto.createCipheriv('aes-256-gcm', vaultKey, iv);
  const out      = fs.createWriteStream(outPath);
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
  const ext    = path.extname(filename).toLowerCase();
  const folder = req.headers['x-folder'] || null;
  const meta   = loadVaultMeta();
  meta[id]     = { originalName: filename, name: path.basename(filename, path.extname(filename)), ext, size, sizeF: _fmtBytes(size), mtime: Date.now(), folder: folder || null };
  saveVaultMeta(meta);
  json(res, { ok: true, id });
}

function apiVaultStream(req, res, id) {
  if (!vaultKey) { res.writeHead(401, NO_CACHE_HEADERS); res.end('Vault locked'); return; }
  resetVaultTimer();
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
  const meta    = loadVaultMeta();
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
  delete meta[id];
  saveVaultMeta(meta);
  json(res, { ok: true });
}

function apiVaultDownload(req, res, id) {
  if (!vaultKey) { res.writeHead(401, NO_CACHE_HEADERS); res.end('Vault locked'); return; }
  resetVaultTimer();
  const meta    = loadVaultMeta();
  const encPath = path.join(VAULT_DIR, id + '.enc');
  if (!meta[id] || !fs.existsSync(encPath)) { res.writeHead(404); res.end(); return; }
  try { _streamDecrypt(req, res, id, meta, true); }
  catch (e) { res.writeHead(500); res.end('Decryption failed'); }
}

async function apiVaultChangePassword(req, res) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  const cfg  = loadVaultConfig();
  if (!cfg) return json(res, { error: 'Not configured' }, 400);
  const body    = await readBody(req);
  const oldPw   = (body.oldPassword || '').trim();
  const newPw   = (body.newPassword || '').trim();
  if (newPw.length < 6) return json(res, { error: 'New password must be at least 6 characters' }, 400);

  try {
    // Verify old password matches current key
    const { encKey: oldKey, verifyHash: oldHash } = await deriveKeys(oldPw, cfg.salt);
    if (oldHash !== cfg.verifyHash) return json(res, { error: 'Old password is wrong' }, 401);

    // Derive new key
    const newSalt = crypto.randomBytes(32).toString('hex');
    const { encKey: newKey, verifyHash: newHash } = await deriveKeys(newPw, newSalt);

    // Re-encrypt all .enc files in VAULT_DIR
    if (fs.existsSync(VAULT_DIR)) {
      const files = fs.readdirSync(VAULT_DIR).filter(f => f.endsWith('.enc') && !f.startsWith('_'));
      for (const file of files) {
        await _reEncryptFile(path.join(VAULT_DIR, file), oldKey, newKey);
      }
    }

    // Re-encrypt the special encrypted-JSON files (_vault_favs.enc)
    if (fs.existsSync(VAULT_DIR)) {
      const specials = fs.readdirSync(VAULT_DIR).filter(f => f.startsWith('_') && f.endsWith('.enc'));
      for (const file of specials) {
        await _reEncryptFile(path.join(VAULT_DIR, file), oldKey, newKey);
      }
    }

    // Save new config
    saveVaultConfig({ salt: newSalt, verifyHash: newHash });
    vaultKey = newKey;
    resetVaultTimer();
    json(res, { ok: true });
  } catch (e) { json(res, { error: e.message }, 500); }
}

async function apiVaultDeleteVault(req, res) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  const body = await readBody(req);
  if (body.confirm !== 'DELETE_VAULT') return json(res, { error: 'Confirmation required' }, 400);
  _silentWipe();
  json(res, { ok: true });
}

async function apiVaultCreateFolder(req, res) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  resetVaultTimer();
  const body = await readBody(req);
  const name = (body.name || '').trim();
  if (!name) return json(res, { error: 'Name required' }, 400);
  const meta = loadVaultMeta();
  const existing = Object.values(meta).find(m => m.type === 'folder' && m.name.toLowerCase() === name.toLowerCase());
  if (existing) return json(res, { error: 'Folder already exists' }, 409);
  const id = crypto.randomUUID();
  meta[id] = { type: 'folder', name, mtime: Date.now() };
  saveVaultMeta(meta);
  json(res, { ok: true, id, name });
}

async function apiVaultDeleteFolder(req, res, id) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  const meta = loadVaultMeta();
  if (!meta[id] || meta[id].type !== 'folder') return json(res, { error: 'Not found' }, 404);
  delete meta[id];
  for (const [fid, m] of Object.entries(meta)) {
    if (m.folder === id) meta[fid] = { ...m, folder: null };
  }
  saveVaultMeta(meta);
  json(res, { ok: true });
}

async function apiVaultReadBook(req, res, id) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);

  const meta     = loadVaultMeta();
  const fileMeta = meta[id];
  if (!fileMeta) return json(res, { error: 'Not found' }, 404);

  const encPath = path.join(VAULT_DIR, id + '.enc');
  const raw     = fs.readFileSync(encPath);
  const ivLen   = 12, tagLen = 16;
  const iv      = raw.slice(0, ivLen);
  const tag     = raw.slice(raw.length - tagLen);
  const ct      = raw.slice(ivLen, raw.length - tagLen);

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
  const body   = await readBody(req);
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

  const folder  = body.folder || null;
  const content = body.content || '';
  const id      = crypto.randomUUID();
  const outPath = path.join(VAULT_DIR, id + '.enc');
  const iv      = crypto.randomBytes(12);
  const cipher  = crypto.createCipheriv('aes-256-gcm', vaultKey, iv);
  const out     = fs.createWriteStream(outPath);
  out.write(iv);

  let size = 0;
  try {
    const buf = Buffer.from(content, 'utf-8');
    size = buf.length;
    const enc = cipher.update(buf);
    if (enc.length) out.write(enc);
    const fin = cipher.final();
    if (fin.length) out.write(fin);
    out.write(cipher.getAuthTag());
    out.end();
  } catch (e) {
    return json(res, { error: 'Encryption failed' }, 500);
  }

  const ext  = path.extname(name).toLowerCase();
  const meta = loadVaultMeta();
  meta[id]   = { originalName: name, name: path.basename(name, ext), ext, size, sizeF: _fmtBytes(size), mtime: Date.now(), folder };
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

  const body    = await readBody(req);
  const content = typeof body.content === 'string' ? body.content : '';
  const buf     = Buffer.from(content, 'utf-8');
  const outPath = path.join(VAULT_DIR, id + '.enc');
  const iv      = crypto.randomBytes(12);
  const cipher  = crypto.createCipheriv('aes-256-gcm', vaultKey, iv);
  const enc     = cipher.update(buf);
  const fin     = cipher.final();
  const tag     = cipher.getAuthTag();
  fs.writeFileSync(outPath, Buffer.concat([iv, enc, fin, tag]));

  meta[id] = { ...meta[id], size: buf.length, sizeF: _fmtBytes(buf.length), mtime: Date.now() };
  saveVaultMeta(meta);
  json(res, { ok: true });
}

// ── Vault Encrypted JSON helpers (used by Favourites) ────────────────

function _encryptJson(data) {
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', vaultKey, iv);
  const plain  = Buffer.from(JSON.stringify(data), 'utf8');
  const enc    = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, enc, cipher.getAuthTag()]);
}

function _decryptJson(buf) {
  const iv  = buf.slice(0, 12);
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
  const meta = loadVaultMeta();
  const encPath = path.join(VAULT_DIR, id + '.enc');
  if (!meta[id] || !fs.existsSync(encPath)) { res.writeHead(404); res.end(); return; }
  try {
    const raw  = fs.readFileSync(encPath);
    const iv   = raw.slice(0, 12);
    const tag  = raw.slice(raw.length - 16);
    const ct   = raw.slice(12, raw.length - 16);
    const dec  = crypto.createDecipheriv('aes-256-gcm', vaultKey, iv);
    dec.setAuthTag(tag);
    const out  = Buffer.concat([dec.update(ct), dec.final()]);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': out.length, ...NO_CACHE_HEADERS });
    res.end(out);
  } catch (e) {
    if (!res.headersSent) res.writeHead(500);
    res.end('Decryption failed');
  }
}

module.exports = {
  apiVaultStatus, apiVaultSetup, apiVaultUnlock, apiVaultLock,
  apiVaultFiles, apiVaultAdd, apiVaultStream, apiVaultDelete, apiVaultDownload,
  apiVaultCreateFolder, apiVaultDeleteFolder, apiVaultMoveFile, apiVaultCreateTextFile,
  apiVaultUpdateTextFile,
  apiVaultChangePassword, apiVaultDeleteVault,
  apiVaultFavsGet, apiVaultFavsToggle,
  apiVaultReadBook, apiVaultStreamPage,
};
