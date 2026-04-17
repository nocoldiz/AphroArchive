'use strict';
// ═══════════════════════════════════════════════════════════════════
//  vault-server.js — Encrypted vault: setup, lock/unlock, streaming
// ═══════════════════════════════════════════════════════════════════

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const os     = require('os');
const { VAULT_DIR, MIME } = require('./config-server');
const { json, readBody, formatBytes: _fmtBytes } = require('./helpers-server');
const { loadHidden, loadVaultConfig, saveVaultConfig, loadVaultMeta, saveVaultMeta } = require('./db-server');

// ── Module state ─────────────────────────────────────────────────────

let vaultKey    = null;
const tempDecrypted = new Map();   // id → { path, size }
const VAULT_TIMEOUT = 5 * 60 * 1000;
let vaultTimer  = null;

function resetVaultTimer() {
  if (!vaultKey) return;
  if (vaultTimer) clearTimeout(vaultTimer);
  vaultTimer = setTimeout(() => {
    for (const t of tempDecrypted.values()) { try { fs.unlinkSync(t.path); } catch {} }
    tempDecrypted.clear();
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

async function decryptToTemp(id) {
  const meta  = loadVaultMeta();
  const encPath = path.join(VAULT_DIR, id + '.enc');
  const stat  = fs.statSync(encPath);
  const total = stat.size, ivLen = 12, tagLen = 16;
  const tmpPath = path.join(os.tmpdir(), 'cmt_' + id + (meta[id]?.ext || '.mp4'));
  const fd  = fs.openSync(encPath, 'r');
  const iv  = Buffer.alloc(ivLen);
  fs.readSync(fd, iv, 0, ivLen, 0);
  const tag = Buffer.alloc(tagLen);
  fs.readSync(fd, tag, 0, tagLen, total - tagLen);
  fs.closeSync(fd);
  const dec = crypto.createDecipheriv('aes-256-gcm', vaultKey, iv);
  dec.setAuthTag(tag);
  const src = fs.createReadStream(encPath, { start: ivLen, end: total - tagLen - 1 });
  const dst = fs.createWriteStream(tmpPath);
  await new Promise((res, rej) => { src.pipe(dec).pipe(dst); dst.on('finish', res); dec.on('error', rej); dst.on('error', rej); });
  return { path: tmpPath, size: total - ivLen - tagLen };
}

// ── Vault API handlers ───────────────────────────────────────────────

function apiVaultStatus(req, res) {
  const hidden      = loadHidden();
  const vaultHidden = hidden.some(t => t.toLowerCase() === 'vault');
  json(res, { configured: !!loadVaultConfig(), unlocked: !!vaultKey, hidden: vaultHidden });
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
    resetVaultTimer();
    if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });
    json(res, { ok: true });
  } catch (e) { json(res, { error: e.message }, 500); }
}

async function apiVaultUnlock(req, res) {
  const cfg = loadVaultConfig();
  if (!cfg) return json(res, { error: 'Not configured' }, 400);
  const body = await readBody(req);
  const pw   = (body.password || '').trim();
  try {
    const { encKey, verifyHash } = await deriveKeys(pw, cfg.salt);
    if (verifyHash !== cfg.verifyHash) return json(res, { error: 'Wrong password' }, 401);
    vaultKey = encKey;
    resetVaultTimer();
    json(res, { ok: true });
  } catch (e) { json(res, { error: e.message }, 500); }
}

function apiVaultLock(req, res) {
  clearVaultTimer();
  for (const t of tempDecrypted.values()) { try { fs.unlinkSync(t.path); } catch {} }
  tempDecrypted.clear();
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

async function apiVaultStream(req, res, id) {
  if (!vaultKey) { res.writeHead(401); res.end('Vault locked'); return; }
  resetVaultTimer();
  const meta = loadVaultMeta();
  if (!meta[id] || !fs.existsSync(path.join(VAULT_DIR, id + '.enc'))) { res.writeHead(404); res.end(); return; }
  if (!tempDecrypted.has(id)) {
    try { tempDecrypted.set(id, await decryptToTemp(id)); }
    catch (e) { res.writeHead(500); res.end('Decryption failed'); return; }
  }
  const { path: tp, size } = tempDecrypted.get(id);
  const ct    = MIME[meta[id].ext] || 'video/mp4';
  const range = req.headers.range;
  if (range) {
    const [s, e2] = range.replace(/bytes=/, '').split('-');
    const start   = parseInt(s, 10);
    const end     = e2 ? parseInt(e2, 10) : size - 1;
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': ct });
    fs.createReadStream(tp, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': size, 'Content-Type': ct, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(tp).pipe(res);
  }
}

function apiVaultDelete(req, res, id) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  const meta = loadVaultMeta();
  if (!meta[id]) return json(res, { error: 'Not found' }, 404);
  try { fs.unlinkSync(path.join(VAULT_DIR, id + '.enc')); } catch {}
  if (tempDecrypted.has(id)) { try { fs.unlinkSync(tempDecrypted.get(id).path); } catch {}; tempDecrypted.delete(id); }
  delete meta[id];
  saveVaultMeta(meta);
  json(res, { ok: true });
}

async function apiVaultDownload(req, res, id) {
  if (!vaultKey) { res.writeHead(401); res.end('Vault locked'); return; }
  resetVaultTimer();
  const meta    = loadVaultMeta();
  const encPath = path.join(VAULT_DIR, id + '.enc');
  if (!meta[id] || !fs.existsSync(encPath)) { res.writeHead(404); res.end(); return; }
  if (!tempDecrypted.has(id)) {
    try { tempDecrypted.set(id, await decryptToTemp(id)); }
    catch (e) { res.writeHead(500); res.end('Decryption failed'); return; }
  }
  const { path: tp, size } = tempDecrypted.get(id);
  const filename = meta[id].originalName;
  const ct       = MIME[meta[id].ext] || 'application/octet-stream';
  const encoded  = encodeURIComponent(filename).replace(/'/g, '%27');
  res.writeHead(200, {
    'Content-Type': ct,
    'Content-Length': size,
    'Content-Disposition': `attachment; filename*=UTF-8''${encoded}`,
  });
  fs.createReadStream(tp).pipe(res);
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
  // move all files in this folder to root
  for (const [fid, m] of Object.entries(meta)) {
    if (m.folder === id) meta[fid] = { ...m, folder: null };
  }
  saveVaultMeta(meta);
  json(res, { ok: true });
}

// Add to vault-server.js

async function apiVaultReadBook(req, res, id) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  
  const meta = loadVaultMeta();
  const fileMeta = meta[id];
  if (!fileMeta) return json(res, { error: 'Not found' }, 404);

  // 1. Decrypt the file to a buffer
  const filePath = path.join(VAULT_DIR, id);
  const encrypted = fs.readFileSync(filePath);
  const iv = encrypted.slice(0, 16);
  const authTag = encrypted.slice(16, 32);
  const ciphertext = encrypted.slice(32);
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', vaultKey, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  const ext = path.extname(fileMeta.originalName).toLowerCase();
  
  if (ext === '.pdf' || ext === '.epub') {
    // For binary books, we serve the decrypted buffer as a blob
    const mime = ext === '.pdf' ? 'application/pdf' : 'application/epub+zip';
    res.writeHead(200, { 
      'Content-Type': mime, 
      'Content-Length': decrypted.length 
    });
    res.end(decrypted);
  } else {
    // For text files, return the JSON structure the reader expects
    const content = decrypted.toString('utf-8');
    json(res, {
      title: fileMeta.originalName,
      content: content,
      ext: ext,
      type: 'vault'
    });
  }
}

// Ensure you export/route this in your server's main entry point:
// if (url === '/api/vault/read-book') return apiVaultReadBook(req, res, query.id);
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
  // Ensure it has an extension
  if (!name.includes('.')) name += '.txt';
  
  const folder = body.folder || null;
  const content = body.content || ''; // Support starting with content or just empty

  const id = crypto.randomUUID();
  const outPath = path.join(VAULT_DIR, id + '.enc');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', vaultKey, iv);
  
  const out = fs.createWriteStream(outPath);
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

  const ext = path.extname(name).toLowerCase();
  
  const meta = loadVaultMeta();
  meta[id] = { 
    originalName: name, 
    name: path.basename(name, ext), 
    ext, 
    size, 
    sizeF: _fmtBytes(size), 
    mtime: Date.now(), 
    folder: folder 
  };
  saveVaultMeta(meta);
  
  json(res, { ok: true, id });
}
// ── Vault Prompts (encrypted JSON) ───────────────────────────────────

const VAULT_PROMPTS_FILE = path.join(VAULT_DIR, '_vault_prompts.enc');

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

function _loadVaultPrompts() {
  if (!fs.existsSync(VAULT_PROMPTS_FILE)) return [];
  try { return _decryptJson(fs.readFileSync(VAULT_PROMPTS_FILE)); } catch { return []; }
}

function _saveVaultPrompts(arr) {
  if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });
  fs.writeFileSync(VAULT_PROMPTS_FILE, _encryptJson(arr));
}

function apiVaultPromptsGet(req, res) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  resetVaultTimer();
  json(res, _loadVaultPrompts());
}

async function apiVaultPromptsAdd(req, res) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  resetVaultTimer();
  const body  = await readBody(req);
  const text  = (body.text || '').trim();
  const title = (body.title || '').trim();
  if (!text) return json(res, { error: 'text required' }, 400);
  const arr = _loadVaultPrompts();
  const p   = { id: crypto.randomUUID(), title, text, tags: Array.isArray(body.tags) ? body.tags : [], createdAt: Date.now() };
  arr.unshift(p);
  _saveVaultPrompts(arr);
  json(res, p);
}

async function apiVaultPromptsUpdate(req, res, id) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  resetVaultTimer();
  const body = await readBody(req);
  const arr  = _loadVaultPrompts();
  const idx  = arr.findIndex(p => p.id === id);
  if (idx < 0) return json(res, { error: 'not found' }, 404);
  if (body.title !== undefined) arr[idx].title = body.title;
  if (body.text  !== undefined) arr[idx].text  = body.text.trim();
  if (Array.isArray(body.tags)) arr[idx].tags  = body.tags;
  _saveVaultPrompts(arr);
  json(res, arr[idx]);
}

function apiVaultPromptsDelete(req, res, id) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  resetVaultTimer();
  _saveVaultPrompts(_loadVaultPrompts().filter(p => p.id !== id));
  json(res, { ok: true });
}

function apiVaultPromptsDeleteAll(req, res) {
  if (!vaultKey) return json(res, { error: 'locked' }, 401);
  resetVaultTimer();
  _saveVaultPrompts([]);
  json(res, { ok: true });
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

module.exports = {
  apiVaultStatus, apiVaultSetup, apiVaultUnlock, apiVaultLock,
  apiVaultFiles, apiVaultAdd, apiVaultStream, apiVaultDelete, apiVaultDownload,
  apiVaultCreateFolder, apiVaultDeleteFolder, apiVaultMoveFile, apiVaultCreateTextFile,
  apiVaultPromptsGet, apiVaultPromptsAdd, apiVaultPromptsUpdate,
  apiVaultPromptsDelete, apiVaultPromptsDeleteAll,
  apiVaultFavsGet, apiVaultFavsToggle,
};
