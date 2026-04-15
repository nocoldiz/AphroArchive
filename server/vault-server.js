'use strict';
// ═══════════════════════════════════════════════════════════════════
//  vault-server.js — Encrypted vault: setup, lock/unlock, streaming
// ═══════════════════════════════════════════════════════════════════

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const os     = require('os');
const { VAULT_DIR, MIME } = require('./config');
const { json, readBody, formatBytes: _fmtBytes } = require('./helpers');
const { loadHidden, loadVaultConfig, saveVaultConfig, loadVaultMeta, saveVaultMeta } = require('./db');

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

module.exports = {
  apiVaultStatus, apiVaultSetup, apiVaultUnlock, apiVaultLock,
  apiVaultFiles, apiVaultAdd, apiVaultStream, apiVaultDelete, apiVaultDownload,
  apiVaultCreateFolder, apiVaultDeleteFolder, apiVaultMoveFile,
};
