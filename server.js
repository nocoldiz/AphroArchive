#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
//  AphroArchive — Zero-dependency local video site
//  Usage:  node server.js [videos_folder] [port]
//  Example: node server.js ~/Movies 8080
//  Default: ./videos on port 3000
// ═══════════════════════════════════════════════════════════════════

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { execFile, exec, spawn } = require('child_process');
const crypto = require('crypto');
const os = require('os');

// ── Packaging detection ──────────────────────────────────────────────────────
// When bundled with pkg, process.pkg is defined and __dirname points to the
// read-only snapshot. Mutable data (settings, thumbs, …) must live next to
// the real executable on disk.
const IS_PKG = typeof process.pkg !== 'undefined';
// Directory for read-only bundled assets (public/): always use __dirname
// Directory for mutable runtime data: real exe dir when packaged, __dirname otherwise
const DATA_DIR = IS_PKG ? path.dirname(process.execPath) : __dirname;

function getLocalIPs() {
  const ifaces = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if ((iface.family === 'IPv4' || iface.family === 4) && !iface.internal) {
        // Score: prefer typical LAN ranges over VPN/tunnel ranges
        const ip = iface.address;
        let score = 0;
        if (ip.startsWith('192.168.')) score = 3;
        else if (ip.match(/^172\.(1[6-9]|2\d|3[01])\./)) score = 2;
        else if (ip.startsWith('10.')) score = 1;
        results.push({ ip, name, score });
      }
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}
function getLocalIP() {
  const ips = getLocalIPs();
  return ips.length ? ips[0].ip : null;
}

const BM_DIR = path.join(DATA_DIR, 'bookmark_downloader');
const BM_CACHE_FILE = path.join(__dirname, 'db', 'bookmarks_cache.json');
const OG_THUMB_CACHE_FILE = path.join(BM_DIR, 'og_thumb_cache.json');

// Migrate bookmarks_cache.json from old location to db/ if needed
(function migrateBookmarksCache() {
  const oldPath = path.join(BM_DIR, 'bookmarks_cache.json');
  if (fs.existsSync(oldPath) && !fs.existsSync(BM_CACHE_FILE)) {
    try {
      fs.mkdirSync(path.dirname(BM_CACHE_FILE), { recursive: true });
      fs.copyFileSync(oldPath, BM_CACHE_FILE);
      fs.unlinkSync(oldPath);
    } catch {}
  }
})();

// Resolve ffmpeg/ffprobe: prefer a copy next to the exe, fall back to PATH
function resolveBin(name) {
  const winName = process.platform === 'win32' ? name + '.exe' : name;
  const local = path.join(DATA_DIR, winName);
  return fs.existsSync(local) ? local : name;
}
const FFMPEG_BIN  = resolveBin('ffmpeg');
const FFPROBE_BIN = resolveBin('ffprobe');
const YT_DLP_BIN  = (() => {
  const winName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const inBmDir = path.join(BM_DIR, winName);
  return fs.existsSync(inBmDir) ? inBmDir : resolveBin('yt-dlp');
})();

const VIDEOS_DIR = path.resolve(process.argv[2] || process.env.VIDEOS_DIR || path.join(DATA_DIR, 'videos'));
const AUDIO_DIR  = path.join(DATA_DIR, 'audio');
const PORT = parseInt(process.argv[3] || process.env.PORT || '3000', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');         // bundled (read-only)
const THUMBS_DIR = path.join(DATA_DIR, '.AphroArchive-thumbs');
const ACTOR_PHOTOS_DIR = path.join(DATA_DIR, '.AphroArchive-actor-photos');
const VAULT_DIR = path.join(VIDEOS_DIR, 'hidden');
const IGNORED_DIR = path.join(VIDEOS_DIR, 'Z');
const SETTINGS_DIR = path.join(DATA_DIR, 'settings');
const FAVOURITES_FILE = path.join(SETTINGS_DIR, '.AphroArchive-favourites.json');
const HISTORY_FILE    = path.join(SETTINGS_DIR, '.AphroArchive-history.json');
const THUMBS_CACHE_FILE = path.join(SETTINGS_DIR, '.AphroArchive-thumbcache.json');
const VAULT_CONFIG_FILE = path.join(SETTINGS_DIR, '.vault-config.json');
const VAULT_META_FILE = path.join(SETTINGS_DIR, '.vault-meta.json');
const EXTRA_FOLDERS_FILE = path.join(SETTINGS_DIR, '.AphroArchive-folders.json');
const BROWSER_WHITELIST_FILE = path.join(SETTINGS_DIR, 'whitelist.txt');
const COLLECTIONS_FILE = path.join(SETTINGS_DIR, '.AphroArchive-collections.json');
const RATINGS_FILE = path.join(SETTINGS_DIR, '.AphroArchive-ratings.json');
const HIDDEN_FILE  = path.join(SETTINGS_DIR, 'hidden.txt');
const PREFS_FILE   = path.join(SETTINGS_DIR, '.AphroArchive-prefs.json');
const DB_DIR = path.join(__dirname, 'db');
const ACTORS_JSON     = path.join(DB_DIR, 'actors.json');
const CATEGORIES_JSON = path.join(DB_DIR, 'categories.json');
const STUDIOS_JSON    = path.join(DB_DIR, 'studios.json');
const WEBSITES_JSON = path.join(DB_DIR, 'websites.json');

fs.mkdirSync(SETTINGS_DIR,  { recursive: true });
fs.mkdirSync(VIDEOS_DIR,   { recursive: true });
fs.mkdirSync(AUDIO_DIR,    { recursive: true });

// ── Migrate whitelist.txt → websites.json (runs once on first start) ─────
(function migrateWhitelist() {
  if (fs.existsSync(WEBSITES_JSON)) return;
  let entries = [];
  if (fs.existsSync(BROWSER_WHITELIST_FILE)) {
    const lines = fs.readFileSync(BROWSER_WHITELIST_FILE, 'utf-8')
      .split('\n').map(l => l.trim()).filter(Boolean);
    entries = lines.map(line => ({
      name: line, url: line.startsWith('http') ? line : 'https://' + line,
      searchURL: '', scrapeMethod: '', tags: [], description: ''
    }));
  }
  fs.writeFileSync(WEBSITES_JSON, JSON.stringify(entries, null, 2));
})();

function loadWebsites() {
  try { return JSON.parse(fs.readFileSync(WEBSITES_JSON, 'utf-8')); }
  catch { return []; }
}
function saveWebsites(sites) {
  fs.writeFileSync(WEBSITES_JSON, JSON.stringify(sites, null, 2));
}

const VIDEO_EXT = new Set(['.mp4','.mkv','.avi','.mov','.wmv','.flv','.webm','.m4v','.mpg','.mpeg','.3gp','.ogv','.ts']);
const MIME = {
  '.mp4':'video/mp4','.mkv':'video/x-matroska','.avi':'video/x-msvideo',
  '.mov':'video/quicktime','.wmv':'video/x-ms-wmv','.flv':'video/x-flv',
  '.webm':'video/webm','.m4v':'video/x-m4v','.mpg':'video/mpeg',
  '.mpeg':'video/mpeg','.3gp':'video/3gpp','.ogv':'video/ogg','.ts':'video/mp2t',
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png',
  '.gif':'image/gif','.webp':'image/webp','.avif':'image/avif',
  '.bmp':'image/bmp','.heic':'image/heic',
  '.mp3':'audio/mpeg','.flac':'audio/flac','.wav':'audio/wav',
  '.ogg':'audio/ogg','.aac':'audio/aac','.m4a':'audio/mp4',
  '.wma':'audio/x-ms-wma','.opus':'audio/opus','.aiff':'audio/aiff'
};
const IMAGE_EXT = new Set(['.jpg','.jpeg','.png','.gif','.webp','.avif','.bmp','.heic']);
const STATIC_MIME = {
  '.html':'text/html; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.js':'application/javascript; charset=utf-8',
  '.json':'application/json',
  '.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml',
  '.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff'
};

// ─── Helpers ───────────────────────────────────────────────────────

function formatBytes(b) {
  if (b === 0) return '0 B';
  const k = 1024, s = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(1) + ' ' + s[i];
}

function formatDuration(secs) {
  if (!secs || secs <= 0) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  return m + ':' + String(s).padStart(2, '0');
}

function toId(rel) { return Buffer.from(rel).toString('base64url'); }
function fromId(id) { return Buffer.from(id, 'base64url').toString('utf-8'); }

function safePath(id) {
  const rel = fromId(id);
  const full = path.resolve(VIDEOS_DIR, rel);
  if (!full.startsWith(path.resolve(VIDEOS_DIR))) return null;
  if (!fs.existsSync(full)) return null;
  return full;
}

// ─── External folder helpers ───────────────────────────────────────
function loadExtraFolders() { try { return JSON.parse(fs.readFileSync(EXTRA_FOLDERS_FILE, 'utf-8')); } catch { return []; } }
function saveExtraFolders(f) { fs.writeFileSync(EXTRA_FOLDERS_FILE, JSON.stringify(f)); }

function toExtId(absPath) { return 'x_' + Buffer.from(absPath).toString('base64url'); }
function isExtId(id) { return id.startsWith('x_'); }
function fromExtId(id) { return Buffer.from(id.slice(2), 'base64url').toString('utf-8'); }

function safeExtPath(id) {
  if (!isExtId(id)) return null;
  const absPath = fromExtId(id);
  const folders = loadExtraFolders();
  const ok = folders.some(f => {
    const rf = path.resolve(f);
    return absPath.startsWith(rf + path.sep) || absPath.startsWith(rf + '/') || absPath === rf;
  });
  if (!ok || !fs.existsSync(absPath)) return null;
  return absPath;
}

function scanExternal(rootDir) {
  const abs = path.resolve(rootDir);
  if (!fs.existsSync(abs)) return [];
  const folderName = path.basename(abs);
  function recurse(dir) {
    const out = [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, ent.name);
      if (ent.isDirectory()) { out.push(...recurse(fp)); continue; }
      if (!ent.isFile() || !VIDEO_EXT.has(path.extname(ent.name).toLowerCase())) continue;
      const relInFolder = path.relative(abs, path.dirname(fp));
      const subCat = relInFolder && relInFolder !== '.' ? relInFolder.replace(/[\\/]/g, ' / ') : '';
      const st = fs.statSync(fp);
      out.push({
        id: toExtId(fp),
        name: path.basename(ent.name, path.extname(ent.name)),
        filename: ent.name,
        ext: path.extname(ent.name).toLowerCase(),
        rel: fp,
        category: subCat ? folderName + ' / ' + subCat : folderName,
        catPath: '',
        size: st.size, sizeF: formatBytes(st.size),
        modified: st.mtime.toISOString(), mtime: st.mtimeMs,
        external: true, sourceFolder: abs
      });
    }
    return out;
  }
  return recurse(abs);
}

function loadHidden() {
  try {
    return fs.readFileSync(HIDDEN_FILE, 'utf-8')
      .split('\n').map(l => l.trim()).filter(l => l.length > 0);
  } catch { return []; }
}

function isVideoHidden(v, hiddenTerms) {
  return hiddenTerms.some(term => {
    if (wordMatch(v.name, term)) return true;
    const catLo = v.catPath.toLowerCase(), termLo = term.toLowerCase();
    return catLo === termLo || catLo.startsWith(termLo + '/') || catLo.startsWith(termLo + '\\');
  });
}

function allVideos() {
  const all = [...scan(VIDEOS_DIR), ...loadExtraFolders().flatMap(f => scanExternal(f))];
  const hidden = loadHidden();
  return hidden.length ? all.filter(v => !isVideoHidden(v, hidden)) : all;
}

function scan(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (path.resolve(fp) === path.resolve(VAULT_DIR) || path.resolve(fp) === path.resolve(IGNORED_DIR)) continue; out.push(...scan(fp, base)); continue; }
    if (!ent.isFile() || !VIDEO_EXT.has(path.extname(ent.name).toLowerCase())) continue;
    const rel = path.relative(base, fp);
    const cat = path.dirname(rel);
    const st = fs.statSync(fp);
    out.push({
      id: toId(rel), name: path.basename(ent.name, path.extname(ent.name)),
      filename: ent.name, ext: path.extname(ent.name).toLowerCase(),
      rel, category: cat === '.' ? 'Uncategorized' : cat.replace(/[\\/]/g, ' / '),
      catPath: cat === '.' ? '' : cat,
      size: st.size, sizeF: formatBytes(st.size),
      modified: st.mtime.toISOString(), mtime: st.mtimeMs
    });
  }
  return out;
}

function loadFavs() {
  try { return JSON.parse(fs.readFileSync(FAVOURITES_FILE, 'utf-8')); } catch { return []; }
}
function saveFavs(f) { fs.writeFileSync(FAVOURITES_FILE, JSON.stringify(f)); }

function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')); } catch { return []; }
}
function saveHistory(h) { fs.writeFileSync(HISTORY_FILE, JSON.stringify(h)); }

function loadPrefs() { try { return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf-8')); } catch { return {}; } }
function savePrefs(p) { fs.writeFileSync(PREFS_FILE, JSON.stringify(p)); }

function apiAddHistory(req, res, id) {
  if (loadPrefs().chronologyMode === 'dont-save') return json(res, { ok: true });
  const videos = allVideos();
  if (!videos.find(v => v.id === id)) return json(res, { ok: false });
  let h = loadHistory().filter(x => x !== id);
  h.unshift(id);
  if (h.length > 100) h = h.slice(0, 100);
  saveHistory(h);
  json(res, { ok: true });
}

function apiGetHistory(req, res) {
  const h = loadHistory();
  const videos = allVideos();
  const map = Object.fromEntries(videos.map(v => [v.id, v]));
  json(res, h.map(id => map[id]).filter(Boolean));
}

function apiClearHistory(req, res) {
  saveHistory([]);
  json(res, { ok: true });
}

function loadRatings() {
  try { return JSON.parse(fs.readFileSync(RATINGS_FILE, 'utf-8')); } catch { return {}; }
}
function saveRatings(r) { fs.writeFileSync(RATINGS_FILE, JSON.stringify(r)); }

// Parse "Primary Name, alias1, alias2" → { name, terms }
function parseListLine(line) {
  const parts = line.split(',').map(p => p.trim()).filter(p => p.length > 0);
  return { name: parts[0], terms: parts };
}

function loadCategories() {
  try {
    const raw = JSON.parse(fs.readFileSync(CATEGORIES_JSON, 'utf-8'));
    return Object.keys(raw).map(name => {
      const entry = raw[name];
      const tags = Array.isArray(entry.tags) ? entry.tags : [];
      const displayName = entry.displayName || name;
      return { name, displayName, terms: [name, ...tags] };
    });
  } catch { return []; }
}

function loadStudios() {
  try {
    const raw = JSON.parse(fs.readFileSync(STUDIOS_JSON, 'utf-8'));
    return Object.keys(raw).map(name => {
      const entry = raw[name];
      return { name, terms: [name], website: entry.website || null, description: entry.short_description || null };
    });
  } catch { return []; }
}

// ─── Vault ────────────────────────────────────────────────────────
let vaultKey = null;
const tempDecrypted = new Map(); // id → { path, size }
const VAULT_TIMEOUT = 5 * 60 * 1000; // 5 minutes
let vaultTimer = null;

function resetVaultTimer() {
  if (!vaultKey) return;
  if (vaultTimer) clearTimeout(vaultTimer);
  vaultTimer = setTimeout(() => {
    for (const t of tempDecrypted.values()) { try { fs.unlinkSync(t.path); } catch {} }
    tempDecrypted.clear();
    vaultKey = null;
    vaultTimer = null;
  }, VAULT_TIMEOUT);
}

function clearVaultTimer() {
  if (vaultTimer) { clearTimeout(vaultTimer); vaultTimer = null; }
}

function loadVaultConfig() { try { return JSON.parse(fs.readFileSync(VAULT_CONFIG_FILE, 'utf-8')); } catch { return null; } }
function saveVaultConfig(c) { fs.writeFileSync(VAULT_CONFIG_FILE, JSON.stringify(c)); }
function loadVaultMeta() { try { return JSON.parse(fs.readFileSync(VAULT_META_FILE, 'utf-8')); } catch { return {}; } }
function saveVaultMeta(m) { fs.writeFileSync(VAULT_META_FILE, JSON.stringify(m)); }

function deriveKeys(password, salt) {
  const pbkdf2 = (pw, s) => new Promise((res, rej) =>
    crypto.pbkdf2(pw, s, 100000, 32, 'sha512', (err, k) => err ? rej(err) : res(k)));
  return Promise.all([pbkdf2(password, salt), pbkdf2(password, salt + ':verify')])
    .then(([encKey, vKey]) => ({ encKey, verifyHash: vKey.toString('hex') }));
}

function encryptBuffer(data, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([iv, enc, cipher.getAuthTag()]);
}

function decryptBuffer(data, key) {
  const iv = data.slice(0, 12);
  const tag = data.slice(data.length - 16);
  const enc = data.slice(12, data.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]);
}

async function decryptToTemp(id) {
  const meta = loadVaultMeta();
  const encPath = path.join(VAULT_DIR, id + '.enc');
  const stat = fs.statSync(encPath);
  const total = stat.size, ivLen = 12, tagLen = 16;
  const tmpPath = path.join(os.tmpdir(), 'cmt_' + id + (meta[id]?.ext || '.mp4'));
  const fd = fs.openSync(encPath, 'r');
  const iv = Buffer.alloc(ivLen);
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

function apiVaultStatus(req, res) {
  const hidden = loadHidden();
  const vaultHidden = hidden.some(t => t.toLowerCase() === 'vault');
  json(res, { configured: !!loadVaultConfig(), unlocked: !!vaultKey, hidden: vaultHidden });
}

async function apiVaultSetup(req, res) {
  if (loadVaultConfig()) return json(res, { error: 'Already configured' }, 400);
  const body = await readBody(req);
  const pw = (body.password || '').trim();
  if (pw.length < 6) return json(res, { error: 'Password must be at least 6 characters' }, 400);
  try {
    const salt = crypto.randomBytes(32).toString('hex');
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
  const pw = (body.password || '').trim();
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
  const meta = loadVaultMeta();
  const files = Object.entries(meta).map(([id, m]) => ({ id, ...m })).sort((a, b) => b.mtime - a.mtime);
  json(res, files);
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
  const meta = loadVaultMeta();
  meta[id] = { originalName: filename, name: path.basename(filename, path.extname(filename)), ext, size, sizeF: formatBytes(size), mtime: Date.now() };
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
  const ct = MIME[meta[id].ext] || 'video/mp4';
  const range = req.headers.range;
  if (range) {
    const [s, e2] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(s, 10), end = e2 ? parseInt(e2, 10) : size - 1;
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
  const meta = loadVaultMeta();
  const encPath = path.join(VAULT_DIR, id + '.enc');
  if (!meta[id] || !fs.existsSync(encPath)) { res.writeHead(404); res.end(); return; }
  if (!tempDecrypted.has(id)) {
    try { tempDecrypted.set(id, await decryptToTemp(id)); }
    catch (e) { res.writeHead(500); res.end('Decryption failed'); return; }
  }
  const { path: tp, size } = tempDecrypted.get(id);
  const filename = meta[id].originalName;
  const ct = MIME[meta[id].ext] || 'application/octet-stream';
  const encoded = encodeURIComponent(filename).replace(/'/g, '%27');
  res.writeHead(200, {
    'Content-Type': ct,
    'Content-Length': size,
    'Content-Disposition': `attachment; filename*=UTF-8''${encoded}`
  });
  fs.createReadStream(tp).pipe(res);
}

function parseActorAge(dob) {
  if (!dob || /not listed/i.test(dob)) return null;
  const diedMatch = dob.match(/died[^)]*?(\d{4})/i);
  const bornMatch = dob.match(/(\d{4})/);
  if (!bornMatch) return null;
  const birthYear = parseInt(bornMatch[1]);
  if (diedMatch) return { age: parseInt(diedMatch[1]) - birthYear, deceased: true };
  return { age: new Date().getFullYear() - birthYear, deceased: false };
}

function loadActors() {
  try {
    const raw = JSON.parse(fs.readFileSync(ACTORS_JSON, 'utf-8'));
    return Object.keys(raw).map(name => {
      const entry = raw[name];
      const ageInfo = parseActorAge(entry.date_of_birth);
      return {
        name, terms: [name],
        nationality: entry.nationality || null,
        age: ageInfo ? ageInfo.age : null,
        deceased: ageInfo ? ageInfo.deceased : false,
        imdb_page: entry.imdb_page || null,
      };
    });
  } catch { return []; }
}

// ─── Settings (list files) ────────────────────────────────────────

function readJsonKeys(file) {
  try { return Object.keys(JSON.parse(fs.readFileSync(file, 'utf-8'))).join('\n'); }
  catch { return ''; }
}

function apiSettingsLists(req, res) {
  const read = f => { try { return fs.readFileSync(f, 'utf-8'); } catch { return ''; } };
  const sites = loadWebsites();
  json(res, {
    hidden:     read(HIDDEN_FILE),
    whitelist:  sites.map(s => s.url).join('\n'),
    categories: readJsonKeys(CATEGORIES_JSON),
    actors:     readJsonKeys(ACTORS_JSON),
    studios:    readJsonKeys(STUDIOS_JSON),
  });
}

async function apiSettingsSave(req, res, file) {
  if (file === 'whitelist') {
    const data = await readBody(req);
    const lines = (data.content || '').split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const existing = loadWebsites();
    const newSites = lines.map(url => {
      const found = existing.find(s => s.url === url || s.url === (url.startsWith('http') ? url : 'https://' + url));
      return found || { name: url, url: url.startsWith('http') ? url : 'https://' + url, searchURL: '', scrapeMethod: '', tags: [], description: '' };
    });
    saveWebsites(newSites);
    json(res, { ok: true, count: newSites.length });
    return;
  }
  const map = { hidden: HIDDEN_FILE };
  if (!map[file]) return json(res, { error: 'Unknown file' }, 400);
  const data = await readBody(req);
  const lines = (data.content || '')
    .split('\n').map(l => l.trim()).filter(l => l.length > 0);
  fs.writeFileSync(map[file], lines.join('\n') + (lines.length ? '\n' : ''));
  json(res, { ok: true, count: lines.length });
}

function apiGetPrefs(req, res) {
  json(res, loadPrefs());
}

async function apiSavePrefs(req, res) {
  const body = await readBody(req);
  const prefs = loadPrefs();
  const CHRON_MODES = new Set(['keep', 'delete-on-startup', 'dont-save']);
  if ('chronologyMode' in body) {
    if (!CHRON_MODES.has(body.chronologyMode)) return json(res, { error: 'Invalid value' }, 400);
    prefs.chronologyMode = body.chronologyMode;
  }
  savePrefs(prefs);
  json(res, { ok: true });
}

// ─── Websites API ─────────────────────────────────────────────────

async function apiWebsiteAdd(req, res) {
  const body = await readBody(req);
  if (!body.url) return json(res, { error: 'url required' }, 400);
  const sites = loadWebsites();
  const entry = {
    name: body.name || body.url,
    url: body.url,
    searchURL: body.searchURL || '',
    scrapeMethod: body.scrapeMethod || '',
    tags: body.tags || [],
    description: body.description || ''
  };
  sites.push(entry);
  saveWebsites(sites);
  json(res, { ok: true, index: sites.length - 1 });
}

async function apiWebsiteDelete(req, res, index) {
  const sites = loadWebsites();
  if (index < 0 || index >= sites.length) return json(res, { error: 'Not found' }, 404);
  sites.splice(index, 1);
  saveWebsites(sites);
  json(res, { ok: true });
}

async function apiWebsiteUpdate(req, res, index) {
  const body = await readBody(req);
  const sites = loadWebsites();
  if (index < 0 || index >= sites.length) return json(res, { error: 'Not found' }, 404);
  sites[index] = { ...sites[index], ...body };
  saveWebsites(sites);
  json(res, { ok: true });
}

// ─── Browser Favourites Import ─────────────────────────────────────

function loadWhitelist() {
  const sites = loadWebsites();
  if (sites.length) return sites.map(s => { try { return new URL(s.url).hostname; } catch { return s.url; } });
  // fallback to legacy whitelist.txt
  try {
    return fs.readFileSync(BROWSER_WHITELIST_FILE, 'utf-8')
      .split('\n').map(l => l.trim()).filter(l => l.length > 0);
  } catch { return []; }
}

function matchesWhitelist(urlStr, whitelist) {
  try {
    const hostname = new URL(urlStr).hostname;
    return whitelist.some(entry => hostname.includes(entry));
  } catch { return false; }
}

// LZ4 block decompressor for Firefox mozlz4 bookmark backups
function decompressLz4Block(src, uncompressedSize) {
  const dst = Buffer.allocUnsafe(uncompressedSize);
  let si = 0, di = 0;
  while (si < src.length) {
    const token = src[si++];
    let litLen = (token >> 4) & 0xF;
    if (litLen === 15) { let x; do { x = src[si++]; litLen += x; } while (x === 255); }
    src.copy(dst, di, si, si + litLen);
    si += litLen; di += litLen;
    if (si >= src.length) break;
    const offset = src.readUInt16LE(si); si += 2;
    let matchLen = (token & 0xF);
    if (matchLen === 15) { let x; do { x = src[si++]; matchLen += x; } while (x === 255); }
    matchLen += 4;
    let mp = di - offset;
    for (let i = 0; i < matchLen; i++) dst[di++] = dst[mp++];
  }
  return dst.slice(0, di);
}

function readMozlz4(filePath) {
  const raw = fs.readFileSync(filePath);
  const MAGIC = Buffer.from('mozLz40\0');
  if (!raw.slice(0, 8).equals(MAGIC)) throw new Error('Not a mozlz4 file');
  const uncompressedSize = raw.readUInt32LE(8);
  return JSON.parse(decompressLz4Block(raw.slice(12), uncompressedSize).toString('utf-8'));
}

function extractChromeBookmarks(node, results) {
  if (node.type === 'url' && node.url) results.push({ title: node.name || node.url, url: node.url });
  if (node.children) for (const c of node.children) extractChromeBookmarks(c, results);
}

function extractFirefoxBookmarks(node, results) {
  if (node.type === 'text/x-moz-place' && node.uri) results.push({ title: node.title || node.uri, url: node.uri });
  if (node.children) for (const c of node.children) extractFirefoxBookmarks(c, results);
}

function getChromeBookmarkPaths() {
  const home = os.homedir();
  const candidates = [];
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    candidates.push(
      path.join(local, 'Google', 'Chrome', 'User Data', 'Default', 'Bookmarks'),
      path.join(local, 'Microsoft', 'Edge', 'User Data', 'Default', 'Bookmarks'),
      path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data', 'Default', 'Bookmarks'),
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Bookmarks'),
      path.join(home, 'Library', 'Application Support', 'Microsoft Edge', 'Default', 'Bookmarks'),
    );
  } else {
    candidates.push(
      path.join(home, '.config', 'google-chrome', 'Default', 'Bookmarks'),
      path.join(home, '.config', 'chromium', 'Default', 'Bookmarks'),
    );
  }
  return candidates.filter(p => fs.existsSync(p));
}

function getFirefoxBookmarkPaths() {
  const home = os.homedir();
  let profilesRoot;
  if (process.platform === 'win32') {
    profilesRoot = path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Mozilla', 'Firefox', 'Profiles');
  } else if (process.platform === 'darwin') {
    profilesRoot = path.join(home, 'Library', 'Application Support', 'Firefox', 'Profiles');
  } else {
    profilesRoot = path.join(home, '.mozilla', 'firefox');
  }
  if (!fs.existsSync(profilesRoot)) return [];
  const results = [];
  for (const profileDir of fs.readdirSync(profilesRoot)) {
    const backupsDir = path.join(profilesRoot, profileDir, 'bookmarkbackups');
    if (!fs.existsSync(backupsDir)) continue;
    const files = fs.readdirSync(backupsDir)
      .filter(f => f.endsWith('.jsonlz4') || f.endsWith('.json'))
      .map(f => ({ p: path.join(backupsDir, f), m: fs.statSync(path.join(backupsDir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    if (files.length) results.push(files[0].p);
  }
  return results;
}

function apiBrowserFavs(req, res) {
  try {
    const qs = new URLSearchParams((url.parse(req.url).query) || '');
    const browser = qs.get('browser') || 'chrome';
    const whitelist = loadWhitelist();
    if (!whitelist.length) return json(res, { whitelist_empty: true, items: [] });

    const all = [];
    if (browser === 'chrome') {
      const paths = getChromeBookmarkPaths();
      if (!paths.length) return json(res, { error: 'Chrome/Edge bookmarks file not found. Make sure Chrome or Edge is installed and has been opened at least once.', items: [] }, 404);
      for (const p of paths) {
        try {
          const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
          for (const root of Object.values(data.roots || {})) {
            if (root && typeof root === 'object') extractChromeBookmarks(root, all);
          }
        } catch (e) { console.error('Bookmarks read error:', p, e.message); }
      }
    } else if (browser === 'firefox') {
      const paths = getFirefoxBookmarkPaths();
      if (!paths.length) return json(res, { error: 'Firefox bookmark backups not found. Make sure Firefox is installed and has been opened at least once.', items: [] }, 404);
      for (const p of paths) {
        try {
          const data = p.endsWith('.jsonlz4') ? readMozlz4(p) : JSON.parse(fs.readFileSync(p, 'utf-8'));
          extractFirefoxBookmarks(data, all);
        } catch (e) { console.error('Firefox bookmarks read error:', p, e.message); }
      }
    } else {
      return json(res, { error: 'Unknown browser' }, 400);
    }

    const items = all.filter(b => matchesWhitelist(b.url, whitelist));
    json(res, { items });
  } catch (e) {
    console.error('apiBrowserFavs error:', e);
    json(res, { error: e.message, items: [] }, 500);
  }
}

async function apiBrowserFavsFile(req, res) {
  try {
    const body = await readBody(req);
    const { data, filename, browser } = body;
    if (!data) return json(res, { error: 'No file data' }, 400);
    const whitelist = loadWhitelist();
    if (!whitelist.length) return json(res, { whitelist_empty: true, items: [] });

    const buf = Buffer.from(data, 'base64');
    const MOZILLA_MAGIC = Buffer.from('mozLz40\0');
    const all = [];

    if (browser === 'firefox' || buf.slice(0, 8).equals(MOZILLA_MAGIC)) {
      // mozlz4 compressed or plain JSON firefox backup
      let parsed;
      if (buf.slice(0, 8).equals(MOZILLA_MAGIC)) {
        const uncompressedSize = buf.readUInt32LE(8);
        parsed = JSON.parse(decompressLz4Block(buf.slice(12), uncompressedSize).toString('utf-8'));
      } else {
        parsed = JSON.parse(buf.toString('utf-8'));
      }
      extractFirefoxBookmarks(parsed, all);
    } else {
      // Chrome/Edge Bookmarks JSON
      const parsed = JSON.parse(buf.toString('utf-8'));
      for (const root of Object.values(parsed.roots || {})) {
        if (root && typeof root === 'object') extractChromeBookmarks(root, all);
      }
    }

    const items = all.filter(b => matchesWhitelist(b.url, whitelist));
    json(res, { items });
  } catch (e) {
    console.error('apiBrowserFavsFile error:', e);
    json(res, { error: e.message, items: [] }, 500);
  }
}

// ─── Download Queue ───────────────────────────────────────────────

const downloadJobs = new Map();   // id → job object
let dlRunning = false;

function nextDlId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function enqueueDownload(dlUrl, category) {
  const id = nextDlId();
  downloadJobs.set(id, {
    id, url: dlUrl, title: dlUrl, category: category || '',
    status: 'queued', progress: 0, speed: '', eta: '', error: null,
    addedAt: Date.now(), _kill: null
  });
  processDownloadQueue();
  return id;
}

async function processDownloadQueue() {
  if (dlRunning) return;
  const next = [...downloadJobs.values()].find(j => j.status === 'queued');
  if (!next) return;
  dlRunning = true;
  next.status = 'running';
  try {
    await runYtDlp(next);
    next.status = 'done';
    next.progress = 100;
  } catch (e) {
    if (downloadJobs.has(next.id)) { next.status = 'error'; next.error = e.message; }
  } finally {
    dlRunning = false;
    processDownloadQueue();
  }
}

function runYtDlp(job) {
  return new Promise((resolve, reject) => {
    const outDir = job.category ? path.join(VIDEOS_DIR, job.category) : VIDEOS_DIR;
    try { fs.mkdirSync(outDir, { recursive: true }); } catch {}

    const proc = spawn(YT_DLP_BIN, [
      '--no-playlist', '--progress', '--newline',
      '--merge-output-format', 'mp4',
      '-o', path.join(outDir, '%(title)s.%(ext)s'),
      job.url
    ]);
    job._kill = () => proc.kill('SIGKILL');

    const parseLine = line => {
      const dst = line.match(/\[download\] Destination:\s*(.+)/);
      if (dst) job.title = path.basename(dst[1].trim()).replace(/\.[^.]+$/, '');
      const already = line.match(/\[download\] (.+) has already been downloaded/);
      if (already) { job.title = path.basename(already[1].trim()).replace(/\.[^.]+$/, ''); job.progress = 100; }
      const prog = line.match(/\[download\]\s+([\d.]+)%.*?at\s+(\S+)\s+ETA\s+(\S+)/);
      if (prog) { job.progress = parseFloat(prog[1]); job.speed = prog[2]; job.eta = prog[3]; }
    };

    let oBuf = '', eBuf = '';
    const feed = (buf, data) => {
      buf += data.toString();
      const lines = buf.split('\n'); buf = lines.pop();
      lines.forEach(parseLine); return buf;
    };
    proc.stdout.on('data', d => { oBuf = feed(oBuf, d); });
    proc.stderr.on('data', d => { eBuf = feed(eBuf, d); });

    proc.on('close', code => {
      if (oBuf) parseLine(oBuf);
      if (eBuf) parseLine(eBuf);
      code === 0 ? resolve() : reject(new Error('yt-dlp exited with code ' + code));
    });
    proc.on('error', err => reject(new Error(
      err.code === 'ENOENT'
        ? 'yt-dlp not found — place yt-dlp.exe next to AphroArchive.exe or add it to PATH'
        : err.message
    )));
  });
}

async function apiDownloadAdd(req, res) {
  const body = await readBody(req);
  const urls = Array.isArray(body.urls) ? body.urls : (body.url ? [body.url] : []);
  if (!urls.length) return json(res, { error: 'URL required' }, 400);
  const category = (body.category || '').trim();
  const ids = urls.map(u => enqueueDownload(u, category));
  json(res, { ok: true, ids });
}

function apiDownloadJobs(req, res) {
  const jobs = [...downloadJobs.values()]
    .sort((a, b) => a.addedAt - b.addedAt)
    .map(({ _kill, ...rest }) => rest);  // strip internal _kill fn
  json(res, jobs);
}

function apiDownloadRemove(req, res, id) {
  const job = downloadJobs.get(id);
  if (!job) return json(res, { error: 'Not found' }, 404);
  if (job.status === 'running' && job._kill) job._kill();
  downloadJobs.delete(id);
  json(res, { ok: true });
}

function apiDownloadCheck(req, res) {
  execFile(YT_DLP_BIN, ['--version'], { timeout: 5000 }, (err, stdout) => {
    if (err) return json(res, { available: false, bin: YT_DLP_BIN });
    json(res, { available: true, version: stdout.trim(), bin: YT_DLP_BIN });
  });
}

function apiReadDownloadQueue(req, res) {
  try {
    const queuePath = path.join(BM_DIR, 'download_queue.txt');
    const content = fs.existsSync(queuePath) ? fs.readFileSync(queuePath, 'utf-8') : '';
    const urls = content.split('\n').map(l => l.trim()).filter(Boolean);
    json(res, { urls });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

async function apiWriteDownloadQueue(req, res) {
  const body = await readBody(req);
  const urls = Array.isArray(body.urls) ? body.urls.filter(u => typeof u === 'string' && u) : [];
  try {
    fs.mkdirSync(BM_DIR, { recursive: true });
    fs.writeFileSync(path.join(BM_DIR, 'download_queue.txt'), urls.join('\n') + (urls.length ? '\n' : ''), 'utf-8');
    json(res, { ok: true, count: urls.length });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

async function apiDownloadQueueAdd(req, res) {
  const body = await readBody(req);
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url) return json(res, { error: 'No URL provided' }, 400);
  try {
    fs.mkdirSync(BM_DIR, { recursive: true });
    const queuePath = path.join(BM_DIR, 'download_queue.txt');
    const existing = fs.existsSync(queuePath) ? fs.readFileSync(queuePath, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean) : [];
    if (!existing.includes(url)) {
      fs.appendFileSync(queuePath, url + '\n', 'utf-8');
    }
    json(res, { ok: true });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

async function apiDownloadQueueRemove(req, res) {
  const body = await readBody(req);
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url) return json(res, { error: 'No URL provided' }, 400);
  try {
    const queuePath = path.join(BM_DIR, 'download_queue.txt');
    if (!fs.existsSync(queuePath)) return json(res, { ok: true });
    const lines = fs.readFileSync(queuePath, 'utf-8').split('\n').map(l => l.trim()).filter(l => l && l !== url);
    fs.writeFileSync(queuePath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf-8');
    json(res, { ok: true });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

// ─── OG Thumbnail Proxy ──────────────────────────────────────────
function loadOgThumbCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(OG_THUMB_CACHE_FILE, 'utf-8'));
    return new Map(Object.entries(raw));
  } catch { return new Map(); }
}
function saveOgThumbCache(map) {
  try {
    fs.mkdirSync(BM_DIR, { recursive: true });
    const obj = {};
    map.forEach((v, k) => { obj[k] = v; });
    fs.writeFileSync(OG_THUMB_CACHE_FILE, JSON.stringify(obj));
  } catch {}
}
const _ogCache = loadOgThumbCache(); // url -> { img, ts }
const OG_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days

function fetchOgImage(targetUrl) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(targetUrl);
      const lib = parsed.protocol === 'https:' ? https : http;
      const opts = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AphroArchive/1.0)',
          'Accept': 'text/html',
        },
        timeout: 8000,
      };
      const req = lib.request(opts, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // follow one redirect
          return fetchOgImage(res.headers.location).then(resolve).catch(() => resolve(null));
        }
        let data = '';
        res.on('data', chunk => {
          data += chunk;
          if (data.length > 200000) req.destroy(); // stop after ~200KB
        });
        res.on('end', () => {
          const m = data.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
                 || data.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
          resolve(m ? m[1] : null);
        });
        res.on('error', () => resolve(null));
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end();
    } catch { resolve(null); }
  });
}

async function apiOgThumb(req, res) {
  const qs = new URL('http://x' + req.url).searchParams;
  const targetUrl = qs.get('url');
  if (!targetUrl) return json(res, { error: 'No URL' }, 400);
  const now = Date.now();
  const cached = _ogCache.get(targetUrl);
  if (cached && now - cached.ts < OG_TTL) {
    return json(res, { img: cached.img });
  }
  const img = await fetchOgImage(targetUrl);
  _ogCache.set(targetUrl, { img, ts: now });
  saveOgThumbCache(_ogCache);
  json(res, { img });
}

// ─── Bookmarks Cache ─────────────────────────────────────────────
function apiGetBookmarksCache(req, res) {
  try {
    const raw = fs.existsSync(BM_CACHE_FILE) ? JSON.parse(fs.readFileSync(BM_CACHE_FILE, 'utf-8')) : { items: [] };
    json(res, raw);
  } catch { json(res, { items: [] }); }
}

async function apiSaveBookmarksCache(req, res) {
  const body = await readBody(req);
  const items = Array.isArray(body.items) ? body.items : [];
  try {
    fs.mkdirSync(path.dirname(BM_CACHE_FILE), { recursive: true });
    fs.writeFileSync(BM_CACHE_FILE, JSON.stringify({ items }));
    json(res, { ok: true, count: items.length });
  } catch (e) { json(res, { error: e.message }, 500); }
}

// ─── Thumbnails ───────────────────────────────────────────────────

function loadThumbsCache() {
  try { return JSON.parse(fs.readFileSync(THUMBS_CACHE_FILE, 'utf-8')); } catch { return {}; }
}
function saveThumbsCache(c) { try { fs.writeFileSync(THUMBS_CACHE_FILE, JSON.stringify(c)); } catch {} }

function ffprobeDuration(fp) {
  return new Promise(resolve => {
    execFile(FFPROBE_BIN, ['-v','quiet','-print_format','json','-show_format',fp],
      { timeout: 15000 },
      (err, out) => {
        if (err) return resolve(null);
        try { resolve(parseFloat(JSON.parse(out).format.duration) || null); } catch { resolve(null); }
      });
  });
}

const genLock = new Set();

async function genThumbs(id, fp) {
  const dir = path.join(THUMBS_DIR, id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const dur = await ffprobeDuration(fp);
  if (!dur) return { count: 0, duration: null };
  const times = [0.1, 0.25, 0.5, 0.75, 0.9].map(p => (dur * p).toFixed(2));
  let n = 0;
  await Promise.all(times.map((t, i) => new Promise(resolve => {
    execFile(FFMPEG_BIN, ['-ss', t, '-i', fp, '-vframes', '1', '-vf', 'scale=480:-1', '-q:v', '3', '-y', path.join(dir, `${i}.jpg`)],
      { timeout: 30000 },
      err => { if (!err) n++; resolve(); });
  })));
  return { count: n, duration: dur };
}

async function apiThumbGen(req, res, id) {
  const fp = isExtId(id) ? safeExtPath(id) : safePath(id);
  if (!fp) return json(res, { error: 'Not found' }, 404);
  const cache = loadThumbsCache();
  const stat = fs.statSync(fp);
  if (cache[id] && cache[id].mtime === stat.mtimeMs && cache[id].count > 0)
    return json(res, { count: cache[id].count, duration: cache[id].duration || null });
  if (genLock.has(id)) return json(res, { count: 0, busy: true });
  genLock.add(id);
  try {
    const { count, duration } = await genThumbs(id, fp);
    const c = loadThumbsCache();
    c[id] = { mtime: stat.mtimeMs, count, duration };
    saveThumbsCache(c);
    json(res, { count, duration });
  } catch { json(res, { count: 0 }); } finally { genLock.delete(id); }
}

function apiThumbImg(req, res, id, idx) {
  const fp = path.resolve(path.join(THUMBS_DIR, id, `${idx}.jpg`));
  if (!fp.startsWith(path.resolve(THUMBS_DIR))) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(fp)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=604800' });
  fs.createReadStream(fp).pipe(res);
}

function apiDuplicates(req, res) {
  const videos = allVideos();
  const favs = loadFavs();
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

function apiTags(req, res) {
  const categories = loadCategories();
  const videos = allVideos();
  // Don't show tags that already correspond to a folder category
  const folderNames = new Set(
    videos.filter(v => v.catPath !== '').map(v => v.catPath.split(/[/\\]/)[0].toLowerCase())
  );
  const result = categories
    .filter(e => !folderNames.has(e.name.toLowerCase()))
    .map(e => ({
      name: e.displayName,
      count: videos.filter(v => wordMatchAny(v.name, e.terms)).length
    }))
    .filter(t => t.count > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  json(res, result);
}

function apiTagVideos(req, res, tagName) {
  const categories = loadCategories();
  const entry = categories.find(e => e.displayName.toLowerCase() === tagName.toLowerCase() || e.name.toLowerCase() === tagName.toLowerCase());
  if (!entry) return json(res, { error: 'Not found' }, 404);
  const videos = allVideos();
  const favs = loadFavs();
  const list = videos
    .filter(v => wordMatchAny(v.name, entry.terms))
    .map(v => ({ ...v, fav: favs.includes(v.id) }))
    .sort((a, b) => b.mtime - a.mtime);
  json(res, { tag: entry.displayName, videos: list });
}

function apiStudios(req, res) {
  const studios = loadStudios();
  const videos = allVideos();
  const result = studios
    .map(e => ({
      name: e.name,
      count: videos.filter(v => wordMatchAny(v.name, e.terms)).length,
      website: e.website,
      description: e.description,
    }))
    .filter(s => s.count > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  json(res, result);
}

function apiStudioVideos(req, res, studioName) {
  const studios = loadStudios();
  const entry = studios.find(e => e.name.toLowerCase() === studioName.toLowerCase());
  if (!entry) return json(res, { error: 'Not found' }, 404);
  const videos = allVideos();
  const favs = loadFavs();
  const list = videos
    .filter(v => wordMatchAny(v.name, entry.terms))
    .map(v => ({ ...v, fav: favs.includes(v.id) }))
    .sort((a, b) => b.mtime - a.mtime);
  json(res, { studio: entry.name, videos: list });
}

function wordMatch(name, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('\\b' + escaped + '\\b', 'i').test(name);
}
function wordMatchAny(name, terms) {
  return terms.some(t => wordMatch(name, t));
}

function actorMatches(videoName, actor) {
  const vn = videoName.toLowerCase();
  const an = actor.toLowerCase();
  if (vn.includes(an)) return true;
  const parts = an.split(/\s+/).filter(p => p.length > 1);
  return parts.length > 1 && parts.every(p => vn.includes(p));
}
function actorMatchesAny(videoName, terms) {
  return terms.some(t => actorMatches(videoName, t));
}

function apiActors(req, res) {
  const actors = loadActors();
  const videos = allVideos();
  const result = actors
    .map(e => ({
      name: e.name,
      count: videos.filter(v => actorMatchesAny(v.name, e.terms)).length,
      nationality: e.nationality,
      age: e.age,
      deceased: e.deceased,
      imdb_page: e.imdb_page,
    }))
    .filter(a => a.count > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  json(res, result);
}

function apiActorVideos(req, res, actorName) {
  const actors = loadActors();
  const entry = actors.find(e => e.name.toLowerCase() === actorName.toLowerCase());
  if (!entry) return json(res, { error: 'Not found' }, 404);
  const videos = allVideos();
  const favs = loadFavs();
  const list = videos
    .filter(v => actorMatchesAny(v.name, entry.terms))
    .map(v => ({ ...v, fav: favs.includes(v.id) }))
    .sort((a, b) => b.mtime - a.mtime);
  json(res, { actor: entry.name, videos: list });
}

function apiDelete(req, res, id) {
  if (isExtId(id)) return json(res, { error: 'Cannot delete videos from external folders' }, 403);
  const fp = safePath(id);
  if (!fp) return json(res, { error: 'Not found' }, 404);
  try {
    fs.unlinkSync(fp);
    const favs = loadFavs();
    const fi = favs.indexOf(id);
    if (fi !== -1) { favs.splice(fi, 1); saveFavs(favs); }
    const cache = loadThumbsCache();
    if (cache[id]) { delete cache[id]; saveThumbsCache(cache); }
    const thumbDir = path.join(THUMBS_DIR, id);
    if (fs.existsSync(thumbDir)) fs.rmSync(thumbDir, { recursive: true, force: true });
    json(res, { ok: true });
  } catch (e) { json(res, { error: e.message }, 500); }
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', c => d += c);
    req.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
  });
}

// ─── Static File Server ──────────────────────────────────────────

function serveStatic(req, res, filePath) {
  const resolved = path.resolve(PUBLIC_DIR, filePath);
  if (!resolved.startsWith(path.resolve(PUBLIC_DIR))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  let isFile = false;
  try { isFile = fs.statSync(resolved).isFile(); } catch {}
  if (!isFile) {
    // SPA fallback — serve index.html for any unknown route
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    try {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(indexPath));
    } catch { res.writeHead(404); res.end('Not found'); }
    return;
  }
  const ext = path.extname(resolved).toLowerCase();
  const ct = STATIC_MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': ct });
  // pkg snapshot files don't support createReadStream — use readFileSync for all static assets
  if (IS_PKG) {
    res.end(fs.readFileSync(resolved));
  } else {
    fs.createReadStream(resolved).pipe(res);
  }
}

// ─── API Handlers ─────────────────────────────────────────────────

function apiVideos(req, res, params) {
  const videos = allVideos();
  const favs = loadFavs();
  const ratings = loadRatings();
  const thumbsCache = loadThumbsCache();
  let list = videos.map(v => {
    const cached = thumbsCache[v.id];
    const duration = cached?.duration || null;
    return { ...v, fav: favs.includes(v.id), rating: ratings[v.id] || null, duration, durationF: formatDuration(duration) };
  });
  const q = params.get('q');
  const cat = params.get('category');
  const sort = params.get('sort') || 'date';
  if (q) { const l = q.toLowerCase(); list = list.filter(v => v.name.toLowerCase().includes(l) || v.category.toLowerCase().includes(l)); }
  if (cat) {
    if (cat === '__uncategorized__') {
      const defined = loadCategories();
      list = list.filter(v => v.catPath === '' && !defined.some(e => wordMatchAny(v.name, e.terms)));
    } else if (cat.startsWith('__tag__:')) {
      const tagName = cat.slice(8);
      const defined = loadCategories();
      const entry = defined.find(e => e.displayName === tagName || e.name === tagName);
      list = list.filter(v => entry ? wordMatchAny(v.name, entry.terms) : wordMatch(v.name, tagName));
    } else {
      // Folder category — also include root-level videos matching the folder name as a defined tag
      const defined = loadCategories();
      const catLo = cat.toLowerCase();
      const matchingEntry = defined.find(e => e.name.toLowerCase() === catLo);
      list = list.filter(v =>
        v.catPath === cat || v.category === cat ||
        (matchingEntry && v.catPath === '' && wordMatchAny(v.name, matchingEntry.terms))
      );
    }
  }
  if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'size') list.sort((a, b) => b.size - a.size);
  else if (sort === 'duration') list.sort((a, b) => (b.duration || 0) - (a.duration || 0));
  else list.sort((a, b) => b.mtime - a.mtime);
  json(res, list);
}

const TAG_PROMOTE_THRESHOLD = 5;

function apiCategories(req, res) {
  const videos = scan(VIDEOS_DIR);
  const defined = loadCategories();
  const m = new Map();
  for (const v of videos) {
    // Root-level videos that match a defined keyword are not "Uncategorized"
    if (v.catPath === '' && defined.some(e => wordMatchAny(v.name, e.terms))) continue;
    const displayPath = v.catPath === '' ? '__uncategorized__' : v.catPath;
    if (!m.has(v.category)) m.set(v.category, { name: v.category, path: displayPath, count: 0 });
    m.get(v.category).count++;
  }
  const result = [...m.values()];
  for (const entry of defined) {
    const lo = entry.name.toLowerCase();
    const folderEntry = result.find(c => c.path !== '__uncategorized__' && c.path.toLowerCase() === lo);
    if (folderEntry) {
      // Merge: add root-level videos matching this tag into the folder's count
      folderEntry.count += videos.filter(v => v.catPath === '' && wordMatchAny(v.name, entry.terms)).length;
    } else {
      const count = videos.filter(v => wordMatchAny(v.name, entry.terms)).length;
      if (count > TAG_PROMOTE_THRESHOLD)
        result.push({ name: entry.displayName, path: '__tag__:' + entry.displayName, count, isTag: true });
    }
  }
  const hidden = loadHidden();
  const filtered = hidden.length ? result.filter(c => {
    if (c.path === '__uncategorized__') return true;
    if (c.isTag) return !hidden.some(t => t.toLowerCase() === c.name.toLowerCase());
    const pathLo = c.path.toLowerCase();
    return !hidden.some(t => {
      const tLo = t.toLowerCase();
      return pathLo === tLo || pathLo.startsWith(tLo + '/') || pathLo.startsWith(tLo + '\\');
    });
  }) : result;
  const sorted = filtered.sort((a, b) => {
    if (a.path === '__uncategorized__') return -1;
    if (b.path === '__uncategorized__') return 1;
    return a.name.localeCompare(b.name);
  });
  // Always include Uncategorized even when no uncategorized videos exist
  if (!sorted.find(c => c.path === '__uncategorized__')) {
    sorted.unshift({ name: 'Uncategorized', path: '__uncategorized__', count: 0 });
  }
  json(res, sorted);
}

function apiMainCategories(req, res) {
  const hidden = loadHidden();
  const result = [{ name: 'Uncategorized', path: '' }];
  if (fs.existsSync(VIDEOS_DIR)) {
    for (const ent of fs.readdirSync(VIDEOS_DIR, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        const fp = path.join(VIDEOS_DIR, ent.name);
        if (path.resolve(fp) === path.resolve(VAULT_DIR) || path.resolve(fp) === path.resolve(IGNORED_DIR)) continue;
        if (hidden.some(t => t.toLowerCase() === ent.name.toLowerCase())) continue;
        result.push({ name: ent.name, path: ent.name });
      }
    }
  }
  result.sort((a, b) => {
    if (a.path === '') return -1;
    if (b.path === '') return 1;
    return a.name.localeCompare(b.name);
  });
  json(res, result);
}

async function apiCreateCategory(req, res) {
  const body = await readBody(req);
  const name = (body.name || '').trim().replace(/[<>:"/\\|?*]/g, '_');
  if (!name) return json(res, { error: 'Name required' }, 400);
  const dir = path.join(VIDEOS_DIR, name);
  if (fs.existsSync(dir)) return json(res, { error: 'Already exists' }, 409);
  try { fs.mkdirSync(dir, { recursive: true }); json(res, { ok: true, name }); }
  catch (e) { json(res, { error: e.message }, 500); }
}

async function apiOpenFolder(req, res) {
  const body = await readBody(req);
  const id = body.id || '';
  let folder;
  if (id) {
    const fp = isExtId(id) ? safeExtPath(id) : safePath(id);
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

function apiVideoDetail(req, res, id) {
  const videos = allVideos();
  const v = videos.find(x => x.id === id);
  if (!v) return json(res, { error: 'Not found' }, 404);

  const favs = loadFavs();
  const ratings = loadRatings();
  v.fav = favs.includes(v.id);
  v.rating = ratings[v.id] || null;

  // Load actors to identify who is in the current video
  const actors = loadActors();
  const vActors = actors.filter(e => actorMatchesAny(v.name, e.terms));

  // Score all other videos based on similarity
  const suggested = videos
    .filter(x => x.id !== v.id)
    .map(x => {
      let score = 0;

      // Check for shared actors
      const xActors = actors.filter(e => actorMatchesAny(x.name, e.terms));
      const sharedActors = xActors.filter(e => vActors.includes(e));
      score += sharedActors.length * 100; // High priority for shared actors

      // Check for same category
      if (x.category === v.category) {
        score += 50; // Priority for same category
      }

      return { video: x, score };
    })
    // Sort by score (highest first), then randomize videos with the same score
    .sort((a, b) => b.score - a.score || Math.random() - 0.5)
    .slice(0, 12)
    .map(item => ({ ...item.video, fav: favs.includes(item.video.id), rating: ratings[item.video.id] || null }));

  const categories = loadCategories();
  const vTags = categories.filter(e => wordMatchAny(v.name, e.terms));
  json(res, { video: v, suggested, actors: vActors.map(e => e.name), tags: vTags.map(e => e.displayName), allCategories: categories.map(e => e.displayName) });
}

function apiStream(req, res, id) {
  const fp = isExtId(id) ? safeExtPath(id) : safePath(id);
  if (!fp) { res.writeHead(404); res.end('Not found'); return; }
  const stat = fs.statSync(fp);
  const size = stat.size;
  const ext = path.extname(fp).toLowerCase();
  const ct = MIME[ext] || 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': ct
    });
    fs.createReadStream(fp, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': size, 'Content-Type': ct, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(fp).pipe(res);
  }
}

async function apiSetRating(req, res, id) {
  const body = await readBody(req);
  let data; try { data = JSON.parse(body); } catch { return json(res, { error: 'Bad JSON' }, 400); }
  const stars = parseInt(data.stars, 10);
  if (!Number.isFinite(stars) || stars < 1 || stars > 5) return json(res, { error: 'stars must be 1–5' }, 400);
  const r = loadRatings();
  r[id] = stars;
  saveRatings(r);
  json(res, { ok: true, rating: stars });
}

function apiDeleteRating(req, res, id) {
  const r = loadRatings();
  delete r[id];
  saveRatings(r);
  json(res, { ok: true });
}

function apiToggleFav(req, res, id) {
  const favs = loadFavs();
  const i = favs.indexOf(id);
  if (i === -1) favs.push(id); else favs.splice(i, 1);
  saveFavs(favs);
  json(res, { fav: i === -1 });
}

function apiFavourites(req, res) {
  const favs = loadFavs();
  const videos = allVideos();
  json(res, videos.filter(v => favs.includes(v.id)).map(v => ({ ...v, fav: true })));
}

async function apiRename(req, res, id) {
  if (isExtId(id)) return json(res, { error: 'Cannot rename videos from external folders' }, 403);
  const body = await readBody(req);
  const newName = (body.newName || '').trim();
  if (!newName) return json(res, { error: 'Name required' }, 400);
  const fp = safePath(id);
  if (!fp) return json(res, { error: 'Not found' }, 404);
  const dir = path.dirname(fp);
  const ext = path.extname(fp);
  const safe = newName.replace(/[<>:"/\\|?*]/g, '_');
  const np = path.join(dir, safe + ext);
  if (fs.existsSync(np) && np !== fp) return json(res, { error: 'Name already exists' }, 409);
  try {
    fs.renameSync(fp, np);
    const newRel = path.relative(VIDEOS_DIR, np);
    const newId = toId(newRel);
    const favs = loadFavs();
    const fi = favs.indexOf(id);
    if (fi !== -1) { favs[fi] = newId; saveFavs(favs); }
    json(res, { ok: true, newId });
  } catch (e) { json(res, { error: e.message }, 500); }
}

async function apiMove(req, res, id) {
  if (isExtId(id)) return json(res, { error: 'Cannot move videos from external folders' }, 403);
  const body = await readBody(req);
  const targetCategory = (body.category ?? '').trim();
  const fp = safePath(id);
  if (!fp) return json(res, { error: 'Not found' }, 404);

  const targetDir = targetCategory
    ? path.join(VIDEOS_DIR, targetCategory)
    : VIDEOS_DIR;

  const resolvedTarget = path.resolve(targetDir);
  if (!resolvedTarget.startsWith(path.resolve(VIDEOS_DIR)))
    return json(res, { error: 'Invalid category' }, 400);

  if (!fs.existsSync(resolvedTarget)) {
    fs.mkdirSync(resolvedTarget, { recursive: true });
  }

  const filename = path.basename(fp);
  const newPath = path.join(resolvedTarget, filename);

  if (path.resolve(newPath) === path.resolve(fp))
    return json(res, { error: 'Already in this category' }, 400);

  if (fs.existsSync(newPath))
    return json(res, { error: 'A file with that name already exists in the target category' }, 409);

  try {
    fs.renameSync(fp, newPath);
    const newRel = path.relative(VIDEOS_DIR, newPath);
    const newId = toId(newRel);
    const favs = loadFavs();
    const fi = favs.indexOf(id);
    if (fi !== -1) { favs[fi] = newId; saveFavs(favs); }
    json(res, { ok: true, newId });
  } catch (e) { json(res, { error: e.message }, 500); }
}

function apiAutoSort(req, res) {
  // Find existing category folders (direct subdirs of VIDEOS_DIR, excluding system dirs)
  const systemDirs = new Set([path.basename(VAULT_DIR), path.basename(IGNORED_DIR)]);
  let folders;
  try {
    folders = fs.readdirSync(VIDEOS_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory() && !systemDirs.has(e.name))
      .map(e => e.name);
  } catch { return json(res, { moved: 0 }); }

  if (!folders.length) return json(res, { moved: 0 });

  // Find loose videos (directly in VIDEOS_DIR root)
  let loose;
  try {
    loose = fs.readdirSync(VIDEOS_DIR, { withFileTypes: true })
      .filter(e => e.isFile() && VIDEO_EXT.has(path.extname(e.name).toLowerCase()))
      .map(e => e.name);
  } catch { return json(res, { moved: 0 }); }

  if (!loose.length) return json(res, { moved: 0 });

  // Normalize a string: lowercase, replace non-alphanumeric with space
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  let moved = 0;
  const favs = loadFavs();
  let favsChanged = false;

  for (const filename of loose) {
    const nameNoExt = norm(path.basename(filename, path.extname(filename)));
    const match = folders.find(folder => nameNoExt.includes(norm(folder)));
    if (!match) continue;
    const src = path.join(VIDEOS_DIR, filename);
    const dst = path.join(VIDEOS_DIR, match, filename);
    if (fs.existsSync(dst)) continue; // skip collision
    try {
      fs.renameSync(src, dst);
      moved++;
      // Update favourites if this video was in the list
      const oldId = toId(filename);
      const newId = toId(path.join(match, filename));
      const fi = favs.indexOf(oldId);
      if (fi !== -1) { favs[fi] = newId; favsChanged = true; }
    } catch {}
  }

  if (favsChanged) saveFavs(favs);
  json(res, { moved });
}

// ─── Database API ─────────────────────────────────────────────────

function readDbFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return {}; }
}
function writeDbFile(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

function apiDbGet(req, res, type) {
  const files = { actors: ACTORS_JSON, categories: CATEGORIES_JSON, studios: STUDIOS_JSON };
  if (!files[type]) return json(res, { error: 'Unknown type' }, 400);
  json(res, readDbFile(files[type]));
}

async function apiDbUpsert(req, res, type) {
  const files = { actors: ACTORS_JSON, categories: CATEGORIES_JSON, studios: STUDIOS_JSON };
  if (!files[type]) return json(res, { error: 'Unknown type' }, 400);
  const body = await readBody(req);
  const { name, data } = body;
  if (!name || typeof name !== 'string') return json(res, { error: 'Name required' }, 400);
  const db = readDbFile(files[type]);
  db[name] = data || {};
  writeDbFile(files[type], db);
  json(res, { ok: true });
}

async function apiDbDelete(req, res, type, name) {
  const files = { actors: ACTORS_JSON, categories: CATEGORIES_JSON, studios: STUDIOS_JSON };
  if (!files[type]) return json(res, { error: 'Unknown type' }, 400);
  const db = readDbFile(files[type]);
  delete db[name];
  writeDbFile(files[type], db);
  json(res, { ok: true });
}

async function apiDbImport(req, res) {
  const body = await readBody(req);
  const paths = Array.isArray(body.paths) ? body.paths.map(p => p.trim()).filter(Boolean) : [];
  if (!paths.length) return json(res, { error: 'No paths provided' }, 400);
  const results = [];
  for (const src of paths) {
    if (!fs.existsSync(src)) { results.push({ path: src, ok: false, error: 'Not found' }); continue; }
    const stat = fs.statSync(src);
    if (!stat.isFile()) { results.push({ path: src, ok: false, error: 'Not a file' }); continue; }
    const ext = path.extname(src).toLowerCase();
    if (!VIDEO_EXT.has(ext)) { results.push({ path: src, ok: false, error: 'Not a video file' }); continue; }
    const dst = path.join(VIDEOS_DIR, path.basename(src));
    try {
      if (fs.existsSync(dst)) { results.push({ path: src, ok: false, error: 'File already exists in destination' }); continue; }
      fs.copyFileSync(src, dst);
      results.push({ path: src, ok: true });
    } catch (e) { results.push({ path: src, ok: false, error: e.message }); }
  }
  json(res, { results });
}

// ─── Extra Folders API ────────────────────────────────────────────

function apiFolders(req, res) {
  json(res, loadExtraFolders());
}

async function apiFolderAdd(req, res) {
  const body = await readBody(req);
  const folderPath = (body.path || '').trim();
  if (!folderPath) return json(res, { error: 'Path required' }, 400);
  const abs = path.resolve(folderPath);
  if (!fs.existsSync(abs)) return json(res, { error: 'Folder does not exist' }, 400);
  if (!fs.statSync(abs).isDirectory()) return json(res, { error: 'Not a directory' }, 400);
  const folders = loadExtraFolders();
  if (folders.map(f => path.resolve(f)).includes(abs)) return json(res, { error: 'Folder already added' }, 400);
  folders.push(abs);
  saveExtraFolders(folders);
  const count = scanExternal(abs).length;
  json(res, { ok: true, path: abs, count });
}

function apiFolderRemove(req, res, idx) {
  const folders = loadExtraFolders();
  const i = parseInt(idx, 10);
  if (isNaN(i) || i < 0 || i >= folders.length) return json(res, { error: 'Not found' }, 404);
  folders.splice(i, 1);
  saveExtraFolders(folders);
  json(res, { ok: true });
}

// ─── Collections ──────────────────────────────────────────────────

function loadCollections() {
  try { return JSON.parse(fs.readFileSync(COLLECTIONS_FILE, 'utf-8')); } catch { return []; }
}
function saveCollections(c) { fs.writeFileSync(COLLECTIONS_FILE, JSON.stringify(c, null, 2)); }

function apiCollections(req, res) {
  const cols = loadCollections();
  const videos = allVideos();
  const result = cols.map(col => ({
    name: col.name,
    ids: col.ids,
    count: col.ids.length,
    thumb: col.ids.map(id => videos.find(v => v.id === id)).find(v => v) || null
  }));
  json(res, result);
}

async function apiCollectionCreate(req, res) {
  const body = await readBody(req);
  let data; try { data = JSON.parse(body); } catch { return json(res, { error: 'Bad JSON' }, 400); }
  const name = (data.name || '').trim();
  if (!name) return json(res, { error: 'Name required' }, 400);
  const cols = loadCollections();
  if (cols.find(c => c.name === name)) return json(res, { error: 'Collection already exists' }, 400);
  cols.push({ name, ids: [] });
  saveCollections(cols);
  json(res, { ok: true, name });
}

async function apiCollectionDelete(req, res, name) {
  const cols = loadCollections();
  const i = cols.findIndex(c => c.name === name);
  if (i === -1) return json(res, { error: 'Not found' }, 404);
  cols.splice(i, 1);
  saveCollections(cols);
  json(res, { ok: true });
}

async function apiCollectionAddVideo(req, res, name) {
  const body = await readBody(req);
  let data; try { data = JSON.parse(body); } catch { return json(res, { error: 'Bad JSON' }, 400); }
  const id = (data.id || '').trim();
  if (!id) return json(res, { error: 'id required' }, 400);
  const cols = loadCollections();
  const col = cols.find(c => c.name === name);
  if (!col) return json(res, { error: 'Collection not found' }, 404);
  if (!col.ids.includes(id)) col.ids.push(id);
  saveCollections(cols);
  json(res, { ok: true });
}

async function apiCollectionRemoveVideo(req, res, name, id) {
  const cols = loadCollections();
  const col = cols.find(c => c.name === name);
  if (!col) return json(res, { error: 'Not found' }, 404);
  col.ids = col.ids.filter(i => i !== id);
  saveCollections(cols);
  json(res, { ok: true });
}

function apiCollectionVideos(req, res, name) {
  const cols = loadCollections();
  const col = cols.find(c => c.name === name);
  if (!col) return json(res, { error: 'Not found' }, 404);
  const videos = allVideos();
  const result = col.ids.map(id => videos.find(v => v.id === id)).filter(Boolean);
  json(res, result);
}

// ─── Actor Photos ─────────────────────────────────────────────────

function actorSlug(name) { return name.toLowerCase().replace(/[^a-z0-9]/g, '_'); }

function httpsGet(reqUrl, headers) {
  return new Promise((resolve, reject) => {
    const opts = Object.assign(url.parse(reqUrl), { headers });
    const client = reqUrl.startsWith('https') ? https : http;
    client.get(opts, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return resolve(httpsGet(res.headers.location, headers));
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers, stream: null }));
    }).on('error', reject);
  });
}

function httpsGetStream(reqUrl, headers, dest) {
  return new Promise((resolve, reject) => {
    const opts = Object.assign(url.parse(reqUrl), { headers });
    const client = reqUrl.startsWith('https') ? https : http;
    client.get(opts, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return resolve(httpsGetStream(res.headers.location, headers, dest));
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      res.pipe(dest);
      dest.on('finish', resolve);
      dest.on('error', reject);
    }).on('error', reject);
  });
}

async function fetchImdbPhotoUrl(actorName) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
  const q = encodeURIComponent(actorName.toLowerCase());
  const firstChar = actorName[0].toLowerCase().replace(/[^a-z]/, 'a');
  const suggestUrl = `https://v2.sg.media-imdb.com/suggests/${firstChar}/${q}.json`;
  const { body } = await httpsGet(suggestUrl, { 'User-Agent': UA, 'Accept': '*/*', 'Referer': 'https://www.imdb.com/' });
  const match = body.match(/\((\{[\s\S]*\})\)/);
  if (!match) return null;
  const parsed = JSON.parse(match[1]);
  for (const item of (parsed.d || [])) {
    if (item.id && item.id.startsWith('nm') && item.i && item.i.imageUrl)
      return item.i.imageUrl;
  }
  return null;
}

function apiActorPhotos(req, res) {
  if (!fs.existsSync(ACTOR_PHOTOS_DIR)) fs.mkdirSync(ACTOR_PHOTOS_DIR, { recursive: true });
  const actors = loadActors();
  json(res, actors.map(e => ({
    name: e.name,
    hasPhoto: fs.existsSync(path.join(ACTOR_PHOTOS_DIR, actorSlug(e.name) + '.jpg'))
  })));
}

async function apiActorPhotoScrape(req, res, actorName) {
  const actors = loadActors();
  const entry = actors.find(e => e.name.toLowerCase() === actorName.toLowerCase());
  if (!entry) return json(res, { error: 'Actor not found in database' }, 404);
  if (!fs.existsSync(ACTOR_PHOTOS_DIR)) fs.mkdirSync(ACTOR_PHOTOS_DIR, { recursive: true });
  const destPath = path.join(ACTOR_PHOTOS_DIR, actorSlug(entry.name) + '.jpg');
  try {
    const imgUrl = await fetchImdbPhotoUrl(entry.name);
    if (!imgUrl) return json(res, { error: 'No photo found on IMDb for "' + entry.name + '"' }, 404);
    const out = fs.createWriteStream(destPath);
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    await httpsGetStream(imgUrl, { 'User-Agent': UA, 'Referer': 'https://www.imdb.com/' }, out);
    json(res, { ok: true, name: entry.name });
  } catch (e) {
    try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch {}
    json(res, { error: e.message }, 500);
  }
}

function apiActorPhotoImg(req, res, actorName) {
  if (!fs.existsSync(ACTOR_PHOTOS_DIR)) { res.writeHead(404); res.end(); return; }
  const photoPath = path.join(ACTOR_PHOTOS_DIR, actorSlug(actorName) + '.jpg');
  if (!fs.existsSync(photoPath)) { res.writeHead(404); res.end(); return; }
  const stat = fs.statSync(photoPath);
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': stat.size, 'Cache-Control': 'public, max-age=86400' });
  fs.createReadStream(photoPath).pipe(res);
}

// ─── Books ────────────────────────────────────────────────────────

const BOOKS_DIR = path.join(DATA_DIR, 'books');
const BOOKS_META_FILE = path.join(BOOKS_DIR, '.meta.json');
fs.mkdirSync(BOOKS_DIR, { recursive: true });

function loadBooksMeta() {
  try { return JSON.parse(fs.readFileSync(BOOKS_META_FILE, 'utf-8')); } catch { return {}; }
}
function saveBooksMeta(m) { fs.writeFileSync(BOOKS_META_FILE, JSON.stringify(m, null, 2)); }
function bookToId(filename) { return Buffer.from(filename).toString('base64url'); }
function bookFromId(id) { return Buffer.from(id, 'base64url').toString('utf-8'); }

function htmlToText(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function fetchUrl(rawUrl, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    const mod = rawUrl.startsWith('https') ? https : http;
    const opts = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } };
    const req2 = mod.get(rawUrl, opts, res2 => {
      if (res2.statusCode >= 300 && res2.statusCode < 400 && res2.headers.location) {
        res2.resume();
        return resolve(fetchUrl(res2.headers.location, redirects + 1));
      }
      const chunks = [];
      res2.on('data', c => chunks.push(c));
      res2.on('end', () => resolve({ status: res2.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
    });
    req2.on('error', reject);
    req2.setTimeout(20000, () => { req2.destroy(); reject(new Error('Request timeout')); });
  });
}

async function scrapeFanfiction(storyUrl) {
  const { body } = await fetchUrl(storyUrl);

  const titleM = body.match(/<b class="xcontrast_txt">([^<]+)<\/b>/);
  const title = titleM ? titleM[1].trim() : 'Untitled Story';

  const authorM = body.match(/By:<\/span>\s*<a[^>]+href="\/u\/\d+\/[^"]*"[^>]*>([^<]+)<\/a>/);
  const author = authorM ? authorM[1].trim() : '';

  const chapOpts = body.match(/<option[^>]+value="\d+"[^>]*>/g);
  const totalChapters = chapOpts ? chapOpts.length : 1;

  function extractStoryText(html) {
    const m = html.match(/<div[^>]*\bid="storytext"[^>]*>([\s\S]+?)<\/div>\s*(?:<\/div>|<div\s)/);
    if (m) return m[1];
    const m2 = html.match(/<div[^>]*\bid="storytext"[^>]*>([\s\S]+)/);
    return m2 ? m2[1].replace(/<\/body[\s\S]*/, '') : '';
  }

  let content = `# ${title}\n`;
  if (author) content += `*by ${author}*\n`;
  content += `\n---\n\n`;

  const ch1NameM = body.match(/<option[^>]+value="1"[^>]*selected[^>]*>([^<]+)<\/option>/);
  const ch1Name = ch1NameM ? ch1NameM[1].trim() : 'Chapter 1';
  const ch1Text = htmlToText(extractStoryText(body));
  content += `## ${ch1Name}\n\n${ch1Text}\n\n`;

  const storyIdM = storyUrl.match(/fanfiction\.net\/s\/(\d+)/);
  if (storyIdM && totalChapters > 1) {
    const storyId = storyIdM[1];
    const limit = Math.min(totalChapters, 20);
    for (let ch = 2; ch <= limit; ch++) {
      try {
        const { body: cb } = await fetchUrl(`https://www.fanfiction.net/s/${storyId}/${ch}/`);
        const chapNameM = cb.match(new RegExp(`<option[^>]+value="${ch}"[^>]*selected[^>]*>([^<]+)<\\/option>`));
        const chapName = chapNameM ? chapNameM[1].trim() : `Chapter ${ch}`;
        content += `## ${chapName}\n\n${htmlToText(extractStoryText(cb))}\n\n`;
      } catch {}
    }
  }

  return { title, author, content, chapters: Math.min(totalChapters, 20) };
}

async function scrapeGenericUrl(rawUrl) {
  const { body } = await fetchUrl(rawUrl);

  const titleM = body.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleM ? titleM[1].replace(/\s+/g, ' ').trim() : 'Imported Page';

  const cleaned = body
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '');

  const text = htmlToText(cleaned);
  return { title, content: `# ${title}\n*Imported from: ${rawUrl}*\n\n---\n\n${text}` };
}

function apiBooksList(req, res) {
  const meta = loadBooksMeta();
  const books = Object.entries(meta)
    .map(([filename, m]) => ({ id: bookToId(filename), filename, ...m }))
    .sort((a, b) => b.date - a.date);
  json(res, books);
}

async function apiBooksUpload(req, res) {
  const filename = decodeURIComponent(req.headers['x-filename'] || 'book.txt');
  const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9.\-_ ()]/g, '_');
  const ext = path.extname(safeFilename).toLowerCase();
  const allowed = new Set(['.pdf', '.txt', '.doc', '.docx', '.md', '.epub']);
  if (!allowed.has(ext)) return json(res, { error: 'Unsupported file type. Allowed: pdf, txt, doc, docx, md, epub' }, 400);

  let outName = safeFilename;
  let counter = 1;
  while (fs.existsSync(path.join(BOOKS_DIR, outName))) {
    outName = path.basename(safeFilename, ext) + ` (${counter++})` + ext;
  }

  const chunks = [];
  await new Promise((resolve, reject) => {
    req.on('data', c => chunks.push(c));
    req.on('end', resolve);
    req.on('error', reject);
  });
  const data = Buffer.concat(chunks);
  fs.writeFileSync(path.join(BOOKS_DIR, outName), data);

  const meta = loadBooksMeta();
  const title = path.basename(outName, ext);
  meta[outName] = { title, ext, size: data.length, sizeF: formatBytes(data.length), date: Date.now(), type: 'upload' };
  saveBooksMeta(meta);
  json(res, { ok: true, id: bookToId(outName), title });
}

async function apiBooksImportUrl(req, res) {
  const body = await readBody(req);
  const rawUrl = (body.url || '').trim();
  if (!rawUrl) return json(res, { error: 'Missing url' }, 400);
  if (!/^https?:\/\//.test(rawUrl)) return json(res, { error: 'Invalid URL' }, 400);

  try {
    let title, content, chapters;
    if (/fanfiction\.net\/s\/\d+/.test(rawUrl)) {
      const r = await scrapeFanfiction(rawUrl);
      title = r.title; content = r.content; chapters = r.chapters;
    } else {
      const r = await scrapeGenericUrl(rawUrl);
      title = r.title; content = r.content;
    }

    let safeTitle = title.replace(/[^a-zA-Z0-9 \-_.()]/g, '_').trim().slice(0, 80) || 'imported';
    let outName = safeTitle + '.md';
    let counter = 1;
    while (fs.existsSync(path.join(BOOKS_DIR, outName))) {
      outName = safeTitle + ` (${counter++}).md`;
    }

    fs.writeFileSync(path.join(BOOKS_DIR, outName), content, 'utf-8');
    const meta = loadBooksMeta();
    meta[outName] = {
      title, ext: '.md',
      size: Buffer.byteLength(content), sizeF: formatBytes(Buffer.byteLength(content)),
      date: Date.now(),
      type: /fanfiction\.net/.test(rawUrl) ? 'fanfiction' : 'url',
      url: rawUrl,
      ...(chapters ? { chapters } : {})
    };
    saveBooksMeta(meta);
    json(res, { ok: true, id: bookToId(outName), title });
  } catch (e) {
    json(res, { error: 'Import failed: ' + e.message }, 500);
  }
}

function apiBooksRead(req, res, id) {
  const filename = bookFromId(id);
  const filePath = path.join(BOOKS_DIR, path.basename(filename));
  if (!filePath.startsWith(BOOKS_DIR + path.sep) && filePath !== BOOKS_DIR) {
    return json(res, { error: 'Invalid path' }, 400);
  }
  if (!fs.existsSync(filePath)) return json(res, { error: 'Not found' }, 404);

  const ext = path.extname(filename).toLowerCase();
  if (ext === '.pdf' || ext === '.epub') {
    const stat = fs.statSync(filePath);
    const mime = ext === '.pdf' ? 'application/pdf' : 'application/epub+zip';
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size, 'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"` });
    fs.createReadStream(filePath).pipe(res);
  } else {
    const content = fs.readFileSync(filePath, 'utf-8');
    const meta = loadBooksMeta();
    const m = meta[filename] || {};
    json(res, { title: m.title || path.basename(filename, ext), content, ext, type: m.type || 'upload' });
  }
}

function apiBooksDelete(req, res, id) {
  const filename = bookFromId(id);
  const filePath = path.join(BOOKS_DIR, path.basename(filename));
  if (!filePath.startsWith(BOOKS_DIR + path.sep) && filePath !== BOOKS_DIR) {
    return json(res, { error: 'Invalid path' }, 400);
  }
  try { fs.unlinkSync(filePath); } catch {}
  const meta = loadBooksMeta();
  delete meta[filename];
  saveBooksMeta(meta);
  json(res, { ok: true });
}

// ─── Audio ───────────────────────────────────────────────────────

const AUDIO_META_FILE = path.join(AUDIO_DIR, '.meta.json');
const AUDIO_EXT = new Set(['.mp3','.flac','.wav','.ogg','.aac','.m4a','.wma','.opus','.aiff']);

function loadAudioMeta() { try { return JSON.parse(fs.readFileSync(AUDIO_META_FILE, 'utf-8')); } catch { return {}; } }
function saveAudioMeta(m) { fs.writeFileSync(AUDIO_META_FILE, JSON.stringify(m, null, 2)); }
function audioToId(n) { return Buffer.from(n).toString('base64url'); }
function audioFromId(id) { return Buffer.from(id, 'base64url').toString(); }

function apiAudioList(req, res) {
  const meta = loadAudioMeta();
  const files = Object.entries(meta)
    .map(([filename, m]) => ({ id: audioToId(filename), filename, ...m }))
    .sort((a, b) => b.date - a.date);
  json(res, files);
}

async function apiAudioUpload(req, res) {
  const filename = decodeURIComponent(req.headers['x-filename'] || 'audio.mp3');
  const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9.\-_ ()]/g, '_');
  const ext = path.extname(safeFilename).toLowerCase();
  if (!AUDIO_EXT.has(ext)) return json(res, { error: 'Unsupported type. Allowed: mp3, flac, wav, ogg, aac, m4a, wma, opus, aiff' }, 400);
  let outName = safeFilename, counter = 1;
  while (fs.existsSync(path.join(AUDIO_DIR, outName))) {
    outName = path.basename(safeFilename, ext) + ` (${counter++})` + ext;
  }
  const chunks = [];
  await new Promise((resolve, reject) => { req.on('data', c => chunks.push(c)); req.on('end', resolve); req.on('error', reject); });
  const data = Buffer.concat(chunks);
  fs.writeFileSync(path.join(AUDIO_DIR, outName), data);
  const meta = loadAudioMeta();
  meta[outName] = { title: path.basename(outName, ext), ext, size: data.length, sizeF: formatBytes(data.length), date: Date.now() };
  saveAudioMeta(meta);
  json(res, { ok: true, id: audioToId(outName) });
}

function apiAudioStream(req, res, id) {
  const filename = audioFromId(id);
  const fp = path.join(AUDIO_DIR, path.basename(filename));
  if (!fp.startsWith(path.resolve(AUDIO_DIR) + path.sep)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(fp)) { res.writeHead(404); res.end(); return; }
  const stat = fs.statSync(fp);
  const size = stat.size;
  const ext = path.extname(fp).toLowerCase();
  const ct = MIME[ext] || 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : size - 1;
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': ct });
    fs.createReadStream(fp, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': size, 'Content-Type': ct, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(fp).pipe(res);
  }
}

function apiAudioDelete(req, res, id) {
  const filename = audioFromId(id);
  const fp = path.join(AUDIO_DIR, path.basename(filename));
  if (!fp.startsWith(path.resolve(AUDIO_DIR) + path.sep)) return json(res, { error: 'Invalid path' }, 400);
  try { fs.unlinkSync(fp); } catch {}
  const meta = loadAudioMeta();
  delete meta[filename];
  saveAudioMeta(meta);
  json(res, { ok: true });
}

// ─── Global Import ───────────────────────────────────────────────

const BOOK_EXT = new Set(['.pdf','.txt','.doc','.docx','.md','.epub']);

async function apiImport(req, res) {
  const filename = decodeURIComponent(req.headers['x-filename'] || 'file');
  const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9.\-_ ()]/g, '_');
  const ext = path.extname(safeFilename).toLowerCase();

  let destDir, kind;
  if (VIDEO_EXT.has(ext))      { destDir = VIDEOS_DIR; kind = 'video'; }
  else if (AUDIO_EXT.has(ext)) { destDir = AUDIO_DIR;  kind = 'audio'; }
  else if (BOOK_EXT.has(ext))  { destDir = BOOKS_DIR;  kind = 'book';  }
  else return json(res, { error: 'Unsupported file type: ' + ext }, 400);

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

  if (kind === 'audio') {
    const meta = loadAudioMeta();
    meta[outName] = { title: path.basename(outName, ext), ext, size: data.length, sizeF: formatBytes(data.length), date: Date.now() };
    saveAudioMeta(meta);
  } else if (kind === 'book') {
    const meta = loadBooksMeta();
    meta[outName] = { title: path.basename(outName, ext), ext, size: data.length, sizeF: formatBytes(data.length), date: Date.now(), type: 'upload' };
    saveBooksMeta(meta);
  }

  json(res, { ok: true, kind, name: outName });
}

// ─── Router ───────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const p = parsed.pathname;
  const params = new URLSearchParams(parsed.search || '');

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Filename');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // API routes
  if (p === '/api/videos' && req.method === 'GET') return apiVideos(req, res, params);
  if (p === '/api/categories' && req.method === 'GET') return apiCategories(req, res);
  if (p === '/api/main-categories' && req.method === 'GET') return apiMainCategories(req, res);
  if (p === '/api/main-categories' && req.method === 'POST') return apiCreateCategory(req, res);
  if (p === '/api/open-folder' && req.method === 'POST') return apiOpenFolder(req, res);
  if (p === '/api/favourites' && req.method === 'GET') return apiFavourites(req, res);
  if (p === '/api/history' && req.method === 'GET') return apiGetHistory(req, res);
  if (p === '/api/history' && req.method === 'DELETE') return apiClearHistory(req, res);

  let m;
  if ((m = p.match(/^\/api\/videos\/([^/]+)$/)) && req.method === 'GET') return apiVideoDetail(req, res, m[1]);
  if ((m = p.match(/^\/api\/stream\/([^/]+)$/)) && req.method === 'GET') return apiStream(req, res, m[1]);
  if ((m = p.match(/^\/api\/favourites\/([^/]+)$/)) && req.method === 'POST') return apiToggleFav(req, res, m[1]);
  if ((m = p.match(/^\/api\/history\/([^/]+)$/)) && req.method === 'POST') return apiAddHistory(req, res, m[1]);
  if ((m = p.match(/^\/api\/ratings\/([^/]+)$/)) && req.method === 'POST') return apiSetRating(req, res, decodeURIComponent(m[1]));
  if ((m = p.match(/^\/api\/ratings\/([^/]+)$/)) && req.method === 'DELETE') return apiDeleteRating(req, res, decodeURIComponent(m[1]));
  if ((m = p.match(/^\/api\/videos\/([^/]+)\/rename$/)) && req.method === 'PATCH') return apiRename(req, res, m[1]);
  if ((m = p.match(/^\/api\/videos\/([^/]+)\/move$/)) && req.method === 'PATCH') return apiMove(req, res, m[1]);
  if ((m = p.match(/^\/api\/thumbs\/([^/]+)\/generate$/)) && req.method === 'POST') return apiThumbGen(req, res, m[1]);
  if ((m = p.match(/^\/api\/thumbs\/([^/]+)\/(\d+)$/)) && req.method === 'GET') return apiThumbImg(req, res, m[1], parseInt(m[2], 10));
  if (p === '/api/duplicates' && req.method === 'GET') return apiDuplicates(req, res);
  if (p === '/api/tags' && req.method === 'GET') return apiTags(req, res);
  if ((m = p.match(/^\/api\/tags\/(.+)$/)) && req.method === 'GET') return apiTagVideos(req, res, decodeURIComponent(m[1]));
  if (p === '/api/studios' && req.method === 'GET') return apiStudios(req, res);
  if ((m = p.match(/^\/api\/studios\/(.+)$/)) && req.method === 'GET') return apiStudioVideos(req, res, decodeURIComponent(m[1]));
  if (p === '/api/folders' && req.method === 'GET') return apiFolders(req, res);
  if (p === '/api/folders' && req.method === 'POST') return apiFolderAdd(req, res);
  if ((m = p.match(/^\/api\/folders\/(\d+)$/)) && req.method === 'DELETE') return apiFolderRemove(req, res, m[1]);
  if (p === '/api/collections' && req.method === 'GET') return apiCollections(req, res);
  if (p === '/api/collections' && req.method === 'POST') return apiCollectionCreate(req, res);
  if ((m = p.match(/^\/api\/collections\/([^/]+)$/)) && req.method === 'DELETE') return apiCollectionDelete(req, res, decodeURIComponent(m[1]));
  if ((m = p.match(/^\/api\/collections\/([^/]+)\/videos$/)) && req.method === 'GET') return apiCollectionVideos(req, res, decodeURIComponent(m[1]));
  if ((m = p.match(/^\/api\/collections\/([^/]+)\/videos$/)) && req.method === 'POST') return apiCollectionAddVideo(req, res, decodeURIComponent(m[1]));
  if ((m = p.match(/^\/api\/collections\/([^/]+)\/videos\/([^/]+)$/)) && req.method === 'DELETE') return apiCollectionRemoveVideo(req, res, decodeURIComponent(m[1]), decodeURIComponent(m[2]));
  if (p === '/api/actors' && req.method === 'GET') return apiActors(req, res);
  if ((m = p.match(/^\/api\/actors\/(.+)$/)) && req.method === 'GET') return apiActorVideos(req, res, decodeURIComponent(m[1]));
  if (p === '/api/actor-photos' && req.method === 'GET') return apiActorPhotos(req, res);
  if ((m = p.match(/^\/api\/actor-photos\/(.+)\/scrape$/)) && req.method === 'POST') return apiActorPhotoScrape(req, res, decodeURIComponent(m[1]));
  if ((m = p.match(/^\/api\/actor-photos\/(.+)\/img$/)) && req.method === 'GET') return apiActorPhotoImg(req, res, decodeURIComponent(m[1]));
  if (p === '/api/settings/lists' && req.method === 'GET') return apiSettingsLists(req, res);
  if ((m = p.match(/^\/api\/settings\/(hidden|whitelist)$/)) && req.method === 'PUT') return apiSettingsSave(req, res, m[1]);
  if (p === '/api/settings/prefs' && req.method === 'GET') return apiGetPrefs(req, res);
  if (p === '/api/settings/prefs' && req.method === 'PUT') return apiSavePrefs(req, res);
  if (p === '/api/websites' && req.method === 'GET') return json(res, loadWebsites());
  if (p === '/api/websites' && req.method === 'POST') return apiWebsiteAdd(req, res);
  if ((m = p.match(/^\/api\/websites\/(\d+)$/)) && req.method === 'DELETE') return apiWebsiteDelete(req, res, parseInt(m[1]));
  if ((m = p.match(/^\/api\/websites\/(\d+)$/)) && req.method === 'PUT') return apiWebsiteUpdate(req, res, parseInt(m[1]));
  if (p === '/api/og-thumb' && req.method === 'GET') return apiOgThumb(req, res);
  if (p === '/api/bookmarks/cache' && req.method === 'GET') return apiGetBookmarksCache(req, res);
  if (p === '/api/bookmarks/cache' && req.method === 'POST') return apiSaveBookmarksCache(req, res);
  if (p === '/api/browser-favs' && req.method === 'GET') return apiBrowserFavs(req, res);
  if (p === '/api/browser-favs/file' && req.method === 'POST') return apiBrowserFavsFile(req, res);
  if (p === '/api/download-queue' && req.method === 'GET') return apiReadDownloadQueue(req, res);
  if (p === '/api/download-queue/add' && req.method === 'POST') return apiDownloadQueueAdd(req, res);
  if (p === '/api/download-queue/remove' && req.method === 'POST') return apiDownloadQueueRemove(req, res);
  if (p === '/api/download-queue' && req.method === 'POST') return apiWriteDownloadQueue(req, res);
  if (p === '/api/download' && req.method === 'POST') return apiDownloadAdd(req, res);
  if (p === '/api/download/jobs' && req.method === 'GET') return apiDownloadJobs(req, res);
  if (p === '/api/download/check' && req.method === 'GET') return apiDownloadCheck(req, res);
  if ((m = p.match(/^\/api\/download\/jobs\/([^/]+)$/)) && req.method === 'DELETE') return apiDownloadRemove(req, res, m[1]);
  if ((m = p.match(/^\/api\/videos\/([^/]+)$/)) && req.method === 'DELETE') return apiDelete(req, res, m[1]);
  if (p === '/api/auto-sort' && req.method === 'POST') return apiAutoSort(req, res);
  if (p === '/api/vault/status' && req.method === 'GET') return apiVaultStatus(req, res);
  if (p === '/api/vault/setup' && req.method === 'POST') return apiVaultSetup(req, res);
  if (p === '/api/vault/unlock' && req.method === 'POST') return apiVaultUnlock(req, res);
  if (p === '/api/vault/lock' && req.method === 'POST') return apiVaultLock(req, res);
  if (p === '/api/vault/files' && req.method === 'GET') return apiVaultFiles(req, res);
  if (p === '/api/vault/add' && req.method === 'POST') return apiVaultAdd(req, res);
  if (p === '/api/local-ip' && req.method === 'GET') {
    const ips = getLocalIPs();
    const best = ips[0] || null;
    return json(res, {
      ip: best ? best.ip : null,
      port: PORT,
      url: best ? `http://${best.ip}:${PORT}` : null,
      all: ips.map(e => ({ ip: e.ip, name: e.name, url: `http://${e.ip}:${PORT}` })),
    });
  }
  if ((m = p.match(/^\/api\/vault\/stream\/([^/]+)$/)) && req.method === 'GET') return apiVaultStream(req, res, m[1]);
  if ((m = p.match(/^\/api\/vault\/files\/([^/]+)$/)) && req.method === 'DELETE') return apiVaultDelete(req, res, m[1]);
  if ((m = p.match(/^\/api\/vault\/download\/([^/]+)$/)) && req.method === 'GET') return apiVaultDownload(req, res, m[1]);

  if ((m = p.match(/^\/api\/db\/(actors|categories|studios)$/)) && req.method === 'GET') return apiDbGet(req, res, m[1]);
  if ((m = p.match(/^\/api\/db\/(actors|categories|studios)$/)) && req.method === 'POST') return apiDbUpsert(req, res, m[1]);
  if ((m = p.match(/^\/api\/db\/(actors|categories|studios)\/(.+)$/)) && req.method === 'DELETE') return apiDbDelete(req, res, m[1], decodeURIComponent(m[2]));
  if (p === '/api/db/import' && req.method === 'POST') return apiDbImport(req, res);

  if (p === '/api/books' && req.method === 'GET') return apiBooksList(req, res);
  if (p === '/api/books/upload' && req.method === 'POST') return apiBooksUpload(req, res);
  if (p === '/api/books/import-url' && req.method === 'POST') return apiBooksImportUrl(req, res);
  if ((m = p.match(/^\/api\/books\/read\/([^/]+)$/)) && req.method === 'GET') return apiBooksRead(req, res, m[1]);
  if ((m = p.match(/^\/api\/books\/([^/]+)$/)) && req.method === 'DELETE') return apiBooksDelete(req, res, m[1]);

  if (p === '/api/import' && req.method === 'POST') return apiImport(req, res);

  if (p === '/api/audio' && req.method === 'GET') return apiAudioList(req, res);
  if (p === '/api/audio/upload' && req.method === 'POST') return apiAudioUpload(req, res);
  if ((m = p.match(/^\/api\/audio\/([^/]+)\/stream$/)) && req.method === 'GET') return apiAudioStream(req, res, m[1]);
  if ((m = p.match(/^\/api\/audio\/([^/]+)$/)) && req.method === 'DELETE') return apiAudioDelete(req, res, m[1]);

  // Static files from public/ — SPA routes fall back to index.html
  const filePath = p === '/' ? 'index.html' : p.replace(/^\//, '');
  const spaRoutes = /^\/(bookmarks|duplicates|vault|folders|recent|collections|scraper|settings|database|actors|studios|books|audio|search|favourites|video\/|tag\/|cat\/|actor\/|studio\/|collection\/)/;
  if (spaRoutes.test(p)) return serveStatic(req, res, 'index.html');
  serveStatic(req, res, filePath);
});

server.listen(PORT, () => {
  if (loadPrefs().chronologyMode === 'delete-on-startup') saveHistory([]);
  const localIP = getLocalIP();
  console.log(`\n  \x1b[1;31m▶\x1b[0m  \x1b[1mAphroArchive\x1b[0m running at \x1b[4mhttp://localhost:${PORT}\x1b[0m`);
  if (localIP) console.log(`  \x1b[1;36m📡\x1b[0m  Network:  \x1b[4mhttp://${localIP}:${PORT}\x1b[0m`);
  console.log(`  \x1b[90m📁  Videos: ${VIDEOS_DIR}\x1b[0m`);
  console.log(`  \x1b[90m📂  Public: ${PUBLIC_DIR}\x1b[0m\n`);
  if (IS_PKG) {
    const openCmd = process.platform === 'win32' ? `start http://localhost:${PORT}`
      : process.platform === 'darwin' ? `open http://localhost:${PORT}`
      : `xdg-open http://localhost:${PORT}`;
    exec(openCmd);
  }
});
