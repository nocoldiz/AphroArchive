'use strict';
// ═══════════════════════════════════════════════════════════════════
//  bookmarks.js — Websites, browser-favs import, OG thumbnails,
//                 bookmarks cache, and scrape proxy
// ═══════════════════════════════════════════════════════════════════

const fs    = require('fs');
const path  = require('path');
const http  = require('http');
const https = require('https');
const os    = require('os');
const url   = require('url');
const { BM_CACHE_FILE, OG_THUMB_CACHE_FILE, BM_DIR } = require('./config');
const { json, readBody }   = require('./helpers');
const { loadWebsites, saveWebsites, loadBookmarksCache, saveBookmarksCache, loadOgThumbCache, saveOgThumbCache } = require('./db');
const scrapeMethods        = require('./scrapeMethods');

// ── OG thumbnail cache ───────────────────────────────────────────────

const _ogCache = loadOgThumbCache();
const OG_TTL   = 1000 * 60 * 60 * 24 * 7; // 7 days

function fetchOgImage(targetUrl) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(targetUrl);
      const lib    = parsed.protocol === 'https:' ? https : http;
      const opts   = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AphroArchive/1.0)', 'Accept': 'text/html' },
        timeout: 8000,
      };
      const req = lib.request(opts, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchOgImage(res.headers.location).then(resolve).catch(() => resolve(null));
        }
        let data = '';
        res.on('data', chunk => { data += chunk; if (data.length > 200000) req.destroy(); });
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
  const qs        = new URL('http://x' + req.url).searchParams;
  const targetUrl = qs.get('url');
  if (!targetUrl) return json(res, { error: 'No URL' }, 400);
  const now    = Date.now();
  const cached = _ogCache.get(targetUrl);
  if (cached && now - cached.ts < OG_TTL) return json(res, { img: cached.img });
  const img = await fetchOgImage(targetUrl);
  _ogCache.set(targetUrl, { img, ts: now });
  saveOgThumbCache(_ogCache);
  json(res, { img });
}

// ── Bookmarks cache ───────────────────────────────────────────────────

function apiGetBookmarksCache(req, res) {
  json(res, loadBookmarksCache());
}

async function apiSaveBookmarksCache(req, res) {
  const body  = await readBody(req);
  const items = Array.isArray(body.items) ? body.items : [];
  try {
    saveBookmarksCache({ items });
    json(res, { ok: true, count: items.length });
  } catch (e) { json(res, { error: e.message }, 500); }
}

// ── Websites ──────────────────────────────────────────────────────────

async function apiWebsiteAdd(req, res) {
  const body = await readBody(req);
  if (!body.url) return json(res, { error: 'url required' }, 400);
  const sites = loadWebsites();
  sites.push({
    name: body.name || body.url,
    url: body.url,
    searchURL: body.searchURL || '',
    scrapeMethod: body.scrapeMethod || '',
    tags: body.tags || [],
    description: body.description || '',
  });
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
  const body  = await readBody(req);
  const sites = loadWebsites();
  if (index < 0 || index >= sites.length) return json(res, { error: 'Not found' }, 404);
  sites[index] = { ...sites[index], ...body };
  saveWebsites(sites);
  json(res, { ok: true });
}

// ── Scrape proxy ──────────────────────────────────────────────────────

async function apiScrape(req, res) {
  const params = new URLSearchParams(req.url.split('?')[1] || '');
  const method = (params.get('method') || '').trim();
  const q      = (params.get('q') || '').trim();
  if (!method) return json(res, { error: 'method required' }, 400);
  if (!q)      return json(res, { error: 'q required' }, 400);
  if (!scrapeMethods[method]) return json(res, { error: 'Unknown scrape method: ' + method }, 400);
  try {
    const results = await scrapeMethods[method](q);
    json(res, { results });
  } catch (e) { json(res, { error: e.message }, 500); }
}

// ── Browser favourites ────────────────────────────────────────────────

function loadWhitelist() {
  const sites = loadWebsites();
  if (sites.length) return sites.map(s => { try { return new URL(s.url).hostname; } catch { return s.url; } });
  try {
    const { BROWSER_WHITELIST_FILE } = require('./config');
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
  const raw   = fs.readFileSync(filePath);
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
  const home       = os.homedir();
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
    const qs        = new URLSearchParams((url.parse(req.url).query) || '');
    const browser   = qs.get('browser') || 'chrome';
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

    json(res, { items: all.filter(b => matchesWhitelist(b.url, whitelist)) });
  } catch (e) {
    console.error('apiBrowserFavs error:', e);
    json(res, { error: e.message, items: [] }, 500);
  }
}

async function apiBrowserFavsFile(req, res) {
  try {
    const body     = await readBody(req);
    const { data, filename, browser } = body;
    if (!data) return json(res, { error: 'No file data' }, 400);
    const whitelist = loadWhitelist();
    if (!whitelist.length) return json(res, { whitelist_empty: true, items: [] });

    const buf         = Buffer.from(data, 'base64');
    const MOZILLA_MAGIC = Buffer.from('mozLz40\0');
    const all         = [];

    if (browser === 'firefox' || buf.slice(0, 8).equals(MOZILLA_MAGIC)) {
      let parsed;
      if (buf.slice(0, 8).equals(MOZILLA_MAGIC)) {
        const uncompressedSize = buf.readUInt32LE(8);
        parsed = JSON.parse(decompressLz4Block(buf.slice(12), uncompressedSize).toString('utf-8'));
      } else {
        parsed = JSON.parse(buf.toString('utf-8'));
      }
      extractFirefoxBookmarks(parsed, all);
    } else {
      const parsed = JSON.parse(buf.toString('utf-8'));
      for (const root of Object.values(parsed.roots || {})) {
        if (root && typeof root === 'object') extractChromeBookmarks(root, all);
      }
    }

    json(res, { items: all.filter(b => matchesWhitelist(b.url, whitelist)) });
  } catch (e) {
    console.error('apiBrowserFavsFile error:', e);
    json(res, { error: e.message, items: [] }, 500);
  }
}

module.exports = {
  apiOgThumb,
  apiGetBookmarksCache, apiSaveBookmarksCache,
  apiWebsiteAdd, apiWebsiteDelete, apiWebsiteUpdate,
  apiScrape,
  apiBrowserFavs, apiBrowserFavsFile,
};
