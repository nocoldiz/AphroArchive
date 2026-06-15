'use strict';
// ═══════════════════════════════════════════════════════════════════
//  config.js — Directory paths, MIME types, and environment config
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT_DIR = path.join(__dirname, '..');          // project root (parent of server/)
const IS_PKG = typeof process.pkg !== 'undefined';
const DATA_DIR = IS_PKG ? path.dirname(process.execPath) : ROOT_DIR;
const PLUGINS_DIR = path.join(ROOT_DIR, 'plugins');
const WIDGETS_DIR = path.join(ROOT_DIR, 'widgets');

function resolveBin(name) {
  const winName = process.platform === 'win32' ? name + '.exe' : name;
  const local = path.join(DATA_DIR, winName);
  return fs.existsSync(local) ? local : (process.platform === 'win32' ? winName : name);
}

// ── Custom storage paths (paths.json) ───────────────────────────────
const PATHS_FILE = path.join(DATA_DIR, 'paths.json');
function _loadPathsCfg() {
  try { return fs.existsSync(PATHS_FILE) ? JSON.parse(fs.readFileSync(PATHS_FILE, 'utf8')) : {}; }
  catch (e) { return {}; }
}
function _resolveCustomDir(custom, defaultDir) {
  if (!custom) return defaultDir;
  const p = path.resolve(custom);
  if (fs.existsSync(p)) return p;
  console.warn(`[paths] '${p}' not found, using default: ${defaultDir}`);
  return defaultDir;
}
const _pathsCfg = _loadPathsCfg();

const VIDEOS_DIR = path.resolve(process.argv[2] || process.env.VIDEOS_DIR || path.join(DATA_DIR, 'videos'));
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const PORT = parseInt(process.argv[3] || process.env.PORT || '3000', 10);
const DIST_PUBLIC = path.join(ROOT_DIR, 'dist', 'public');
const PUBLIC_DIR = fs.existsSync(path.join(DIST_PUBLIC, 'index.html'))
  ? DIST_PUBLIC
  : path.join(ROOT_DIR, 'public');

const DEFAULT_CACHE_DIR = path.join(DATA_DIR, 'cache');
const DEFAULT_DB_DIR    = path.join(DATA_DIR, 'db');
const DEFAULT_VAULT_DIR = path.join(VIDEOS_DIR, 'hidden');

const CACHE_DIR = _resolveCustomDir(_pathsCfg.cacheDir, DEFAULT_CACHE_DIR);
const DB_DIR    = _resolveCustomDir(_pathsCfg.dbDir,    DEFAULT_DB_DIR);
const VAULT_DIR = _resolveCustomDir(_pathsCfg.vaultDir, DEFAULT_VAULT_DIR);

const LINK_DIR = CACHE_DIR;
const FFMPEG_BIN = resolveBin('ffmpeg');
const FFPROBE_BIN = resolveBin('ffprobe');
const YT_DLP_BIN = (() => {
  const winName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const inBmDir = path.join(CACHE_DIR, winName);
  return fs.existsSync(inBmDir) ? inBmDir : resolveBin('yt-dlp');
})();

const WHISPER_BIN = (() => {
  for (const name of ['whisper-ctranslate2', 'whisper']) {
    const winName = process.platform === 'win32' ? name + '.exe' : name;
    const local = path.join(DATA_DIR, winName);
    if (fs.existsSync(local)) return local;
  }
  return process.platform === 'win32' ? 'whisper.exe' : 'whisper';
})();

const THUMBS_DIR = path.join(CACHE_DIR, '.AphroArchive-thumbs');
const ACTOR_PHOTOS_DIR = path.join(CACHE_DIR, '.AphroArchive-actor-photos');
const PROCESS_DIR = path.join(DATA_DIR, 'process');
const IGNORED_DIR = path.join(VIDEOS_DIR, 'Z');
const BOOKS_DIR = path.join(DATA_DIR, 'books');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
const SCREENSHOTS_DIR = path.join(DATA_DIR, 'screenshots');
const PAGES_DIR = path.join(DATA_DIR, 'pages');
const FILES_DIR = path.join(DATA_DIR, 'files');
const LINK_THUMBS_DIR = path.join(CACHE_DIR, '.AphroArchive-bm-thumbs');

const EDGE_BIN = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const FAVOURITES_FILE = path.join(CACHE_DIR, '.AphroArchive-favourites.json');
const HISTORY_FILE = path.join(CACHE_DIR, '.AphroArchive-history.json');
const THUMBS_CACHE_FILE = path.join(CACHE_DIR, '.AphroArchive-thumbcache.json');
const VAULT_CONFIG_FILE = path.join(CACHE_DIR, '.vault-config.json');
const VAULT_META_FILE = path.join(CACHE_DIR, '.vault-meta.json');
const BROWSER_WHITELIST_FILE = path.join(CACHE_DIR, 'whitelist.txt');
const COLLECTIONS_FILE = path.join(CACHE_DIR, '.AphroArchive-collections.json');
const RATINGS_FILE = path.join(CACHE_DIR, '.AphroArchive-ratings.json');
const HIDDEN_FILE = path.join(CACHE_DIR, 'hidden.txt');
const PREFS_FILE = path.join(CACHE_DIR, '.AphroArchive-prefs.json');
const VIDEO_META_FILE = path.join(VIDEOS_DIR, '.meta.json');
const BOOKS_META_FILE = path.join(BOOKS_DIR, '.meta.json');
const AUDIO_META_FILE = path.join(AUDIO_DIR, '.meta.json');
const PRESETS_DIR = path.join(ROOT_DIR, 'presets');   // DB preset templates (checked into git)
const ACTORS_JSON = path.join(DB_DIR, 'actors.json');
const CATEGORIES_JSON = path.join(DB_DIR, 'categories.json');
const CHANNELS_JSON = path.join(DB_DIR, 'channels.json');
const WEBSITES_JSON = path.join(DB_DIR, 'websites.json');
const BM_CACHE_FILE = path.join(CACHE_DIR, 'links_cache.json');
const OG_THUMB_CACHE_FILE = path.join(LINK_DIR, 'og_thumb_cache.json');
const STARRED_SITES_FILE = path.join(CACHE_DIR, '.AphroArchive-starred-sites.json');
const PROMPTS_FILE = path.join(CACHE_DIR, '.AphroArchive-prompts.json');

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv',
  '.webm', '.m4v', '.mpg', '.mpeg', '.3gp', '.ogv', '.ts']);

const AUDIO_EXT = new Set(['.mp3', '.flac', '.wav', '.ogg', '.aac', '.m4a', '.wma', '.opus', '.aiff']);

const BOOK_EXT = new Set(['.pdf', '.txt', '.doc', '.docx', '.md', '.epub']);

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.heic']);

const MIME = {
  '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime', '.wmv': 'video/x-ms-wmv', '.flv': 'video/x-flv',
  '.webm': 'video/webm', '.m4v': 'video/x-m4v', '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg', '.3gp': 'video/3gpp', '.ogv': 'video/ogg', '.ts': 'video/mp2t',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.bmp': 'image/bmp', '.heic': 'image/heic',
  '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.aac': 'audio/aac', '.m4a': 'audio/mp4',
  '.wma': 'audio/x-ms-wma', '.opus': 'audio/opus', '.aiff': 'audio/aiff',
};

const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.ts': 'application/javascript; charset=utf-8',
  '.tsx': 'application/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
};

function getLocalIPs() {
  const ifaces = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if ((iface.family === 'IPv4' || iface.family === 4) && !iface.internal) {
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

module.exports = {
  ROOT_DIR, IS_PKG, DATA_DIR, LINK_DIR,
  FFMPEG_BIN, FFPROBE_BIN, YT_DLP_BIN, WHISPER_BIN,
  VIDEOS_DIR, AUDIO_DIR, PORT, PUBLIC_DIR, CACHE_DIR,
  THUMBS_DIR, ACTOR_PHOTOS_DIR, VAULT_DIR, PROCESS_DIR, IGNORED_DIR,
  DB_DIR, PRESETS_DIR, BOOKS_DIR, PHOTOS_DIR, SCREENSHOTS_DIR, PAGES_DIR, FILES_DIR, LINK_THUMBS_DIR, EDGE_BIN,
  PATHS_FILE, DEFAULT_CACHE_DIR, DEFAULT_DB_DIR, DEFAULT_VAULT_DIR,
  FAVOURITES_FILE, HISTORY_FILE, THUMBS_CACHE_FILE,
  VAULT_CONFIG_FILE, VAULT_META_FILE, BROWSER_WHITELIST_FILE,
  COLLECTIONS_FILE, RATINGS_FILE, HIDDEN_FILE, PREFS_FILE,
  VIDEO_META_FILE, BOOKS_META_FILE, AUDIO_META_FILE,
  ACTORS_JSON, CATEGORIES_JSON, CHANNELS_JSON, WEBSITES_JSON,
  BM_CACHE_FILE, OG_THUMB_CACHE_FILE, STARRED_SITES_FILE, PROMPTS_FILE,
  VIDEO_EXT, AUDIO_EXT, BOOK_EXT, IMAGE_EXT, MIME, STATIC_MIME,
  getLocalIPs, getLocalIP, PLUGINS_DIR, WIDGETS_DIR,
};
