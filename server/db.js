'use strict';
// ═══════════════════════════════════════════════════════════════════
//  db.js — All load/save functions for persistent data
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const {
  FAVOURITES_FILE, HISTORY_FILE, PREFS_FILE, RATINGS_FILE,
  VIDEO_META_FILE, THUMBS_CACHE_FILE,
  VAULT_CONFIG_FILE, VAULT_META_FILE,
  COLLECTIONS_FILE,
  HIDDEN_FILE,
  WEBSITES_JSON,
  ACTORS_JSON, CATEGORIES_JSON, STUDIOS_JSON,
  BM_CACHE_FILE, OG_THUMB_CACHE_FILE, STARRED_SITES_FILE,
  BOOKS_META_FILE, AUDIO_META_FILE,
  BM_DIR,
} = require('./config');

// ── In-memory write-through caches ──────────────────────────────────
// Each cache is null until first access, then kept in sync with disk.

let _favs       = null;
let _history    = null;
let _videoMeta  = null;
let _thumbs     = null;
let _actors     = null;
let _categories = null;
let _studios    = null;

// ── Favourites ───────────────────────────────────────────────────────

function loadFavs() {
  if (!_favs) { try { _favs = JSON.parse(fs.readFileSync(FAVOURITES_FILE, 'utf-8')); } catch { _favs = []; } }
  return _favs;
}
function saveFavs(f) {
  _favs = f;
  fs.writeFileSync(FAVOURITES_FILE, JSON.stringify(f));
}

// ── History ──────────────────────────────────────────────────────────

function loadHistory() {
  if (!_history) { try { _history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')); } catch { _history = []; } }
  return _history;
}
function saveHistory(h) {
  _history = h;
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(h));
}

// ── Prefs ────────────────────────────────────────────────────────────

function loadPrefs()  { try { return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf-8')); } catch { return {}; } }
function savePrefs(p) { fs.writeFileSync(PREFS_FILE, JSON.stringify(p)); }

// ── Ratings (legacy, now merged into video meta) ─────────────────────

function loadRatings()  { try { return JSON.parse(fs.readFileSync(RATINGS_FILE, 'utf-8')); } catch { return {}; } }
function saveRatings(r) { fs.writeFileSync(RATINGS_FILE, JSON.stringify(r)); }

// ── Video meta ───────────────────────────────────────────────────────

function loadVideoMeta() {
  if (!_videoMeta) { try { _videoMeta = JSON.parse(fs.readFileSync(VIDEO_META_FILE, 'utf-8')); } catch { _videoMeta = {}; } }
  return _videoMeta;
}
function saveVideoMeta(m) {
  _videoMeta = m;
  fs.writeFileSync(VIDEO_META_FILE, JSON.stringify(m, null, 2));
}

function setVideoMetaFields(id, fields) {
  const meta = loadVideoMeta();
  if (!meta[id]) meta[id] = { title: '', actors: [], tags: [], studio: '', rating: null, category: '', note: '', date: '' };
  Object.assign(meta[id], fields);
  saveVideoMeta(meta);
}

// ── Thumbnails cache ─────────────────────────────────────────────────

function loadThumbsCache() {
  if (!_thumbs) { try { _thumbs = JSON.parse(fs.readFileSync(THUMBS_CACHE_FILE, 'utf-8')); } catch { _thumbs = {}; } }
  return _thumbs;
}
function saveThumbsCache(c) {
  _thumbs = c;
  try { fs.writeFileSync(THUMBS_CACHE_FILE, JSON.stringify(c)); } catch {}
}

// ── Vault ────────────────────────────────────────────────────────────

function loadVaultConfig() { try { return JSON.parse(fs.readFileSync(VAULT_CONFIG_FILE, 'utf-8')); } catch { return null; } }
function saveVaultConfig(c) { fs.writeFileSync(VAULT_CONFIG_FILE, JSON.stringify(c)); }
function loadVaultMeta()   { try { return JSON.parse(fs.readFileSync(VAULT_META_FILE,   'utf-8')); } catch { return {}; } }
function saveVaultMeta(m)  { fs.writeFileSync(VAULT_META_FILE, JSON.stringify(m)); }

// ── Collections ──────────────────────────────────────────────────────

function loadCollections()  { try { return JSON.parse(fs.readFileSync(COLLECTIONS_FILE, 'utf-8')); } catch { return []; } }
function saveCollections(c) { fs.writeFileSync(COLLECTIONS_FILE, JSON.stringify(c, null, 2)); }

// ── Hidden terms ─────────────────────────────────────────────────────

function loadHidden() {
  try {
    return fs.readFileSync(HIDDEN_FILE, 'utf-8')
      .split('\n').map(l => l.trim()).filter(l => l.length > 0);
  } catch { return []; }
}

// ── Websites ─────────────────────────────────────────────────────────

function loadWebsites() { try { return JSON.parse(fs.readFileSync(WEBSITES_JSON, 'utf-8')); } catch { return []; } }
function saveWebsites(s) { fs.writeFileSync(WEBSITES_JSON, JSON.stringify(s, null, 2)); }

// ── Starred sites (cache) ─────────────────────────────────────────────

function loadStarredSites() { try { return JSON.parse(fs.readFileSync(STARRED_SITES_FILE, 'utf-8')); } catch { return []; } }
function saveStarredSites(urls) { fs.writeFileSync(STARRED_SITES_FILE, JSON.stringify(urls)); }

// ── OG thumbnail cache ───────────────────────────────────────────────

function loadOgThumbCache() {
  try { return new Map(Object.entries(JSON.parse(fs.readFileSync(OG_THUMB_CACHE_FILE, 'utf-8')))); }
  catch { return new Map(); }
}
function saveOgThumbCache(map) {
  try {
    fs.mkdirSync(BM_DIR, { recursive: true });
    const obj = {};
    map.forEach((v, k) => { obj[k] = v; });
    fs.writeFileSync(OG_THUMB_CACHE_FILE, JSON.stringify(obj));
  } catch {}
}

// ── Bookmarks cache ──────────────────────────────────────────────────

function loadBookmarksCache() {
  try { return JSON.parse(fs.readFileSync(BM_CACHE_FILE, 'utf-8')); }
  catch { return { items: [] }; }
}
function saveBookmarksCache(data) {
  fs.mkdirSync(path.dirname(BM_CACHE_FILE), { recursive: true });
  fs.writeFileSync(BM_CACHE_FILE, JSON.stringify(data));
}

// ── Books meta ───────────────────────────────────────────────────────

function loadBooksMeta()  { try { return JSON.parse(fs.readFileSync(BOOKS_META_FILE, 'utf-8')); } catch { return {}; } }
function saveBooksMeta(m) { fs.writeFileSync(BOOKS_META_FILE, JSON.stringify(m, null, 2)); }

// ── Audio meta ───────────────────────────────────────────────────────

function loadAudioMeta()  { try { return JSON.parse(fs.readFileSync(AUDIO_META_FILE, 'utf-8')); } catch { return {}; } }
function saveAudioMeta(m) { fs.writeFileSync(AUDIO_META_FILE, JSON.stringify(m, null, 2)); }

// ── Actors / Categories / Studios (DB JSON files) ────────────────────

function parseActorAge(dob) {
  if (!dob || /not listed/i.test(dob)) return null;
  const diedMatch = dob.match(/died[^)]*?(\d{4})/i);
  const bornMatch = dob.match(/(\d{4})/);
  if (!bornMatch) return null;
  const birthYear = parseInt(bornMatch[1]);
  if (diedMatch) return { age: parseInt(diedMatch[1]) - birthYear, deceased: true };
  return { age: new Date().getFullYear() - birthYear, deceased: false };
}

function _parseActors(raw) {
  return Object.keys(raw).map(name => {
    const entry   = raw[name];
    const ageInfo = parseActorAge(entry.date_of_birth);
    return {
      name, terms: [name],
      nationality: entry.nationality || null,
      age: ageInfo ? ageInfo.age : null,
      deceased: ageInfo ? ageInfo.deceased : false,
      imdb_page: entry.imdb_page || null,
    };
  });
}

function loadActors() {
  if (!_actors) { try { _actors = _parseActors(JSON.parse(fs.readFileSync(ACTORS_JSON, 'utf-8'))); } catch { _actors = []; } }
  return _actors;
}

function _parseCategories(raw) {
  return Object.keys(raw).map(name => {
    const entry      = raw[name];
    const tags       = Array.isArray(entry.tags) ? entry.tags : [];
    const displayName = entry.displayName || name;
    return { name, displayName, terms: [name, ...tags] };
  });
}

function loadCategories() {
  if (!_categories) { try { _categories = _parseCategories(JSON.parse(fs.readFileSync(CATEGORIES_JSON, 'utf-8'))); } catch { _categories = []; } }
  return _categories;
}

function _parseStudios(raw) {
  return Object.keys(raw).map(name => {
    const entry = raw[name];
    return { name, terms: [name], website: entry.website || null, description: entry.short_description || null };
  });
}

function loadStudios() {
  if (!_studios) { try { _studios = _parseStudios(JSON.parse(fs.readFileSync(STUDIOS_JSON, 'utf-8'))); } catch { _studios = []; } }
  return _studios;
}

// Called by database.js after writing actors/categories/studios to disk
function invalidateDbTypeCache(type) {
  if (type === 'actors')     _actors     = null;
  if (type === 'categories') _categories = null;
  if (type === 'studios')    _studios    = null;
}

// ── Generic DB file helpers ──────────────────────────────────────────

function readDbFile(file)       { try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return {}; } }
function writeDbFile(file, obj) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(obj, null, 2)); }

module.exports = {
  loadFavs, saveFavs,
  loadHistory, saveHistory,
  loadPrefs, savePrefs,
  loadRatings, saveRatings,
  loadVideoMeta, saveVideoMeta, setVideoMetaFields,
  loadThumbsCache, saveThumbsCache,
  loadVaultConfig, saveVaultConfig, loadVaultMeta, saveVaultMeta,
  loadCollections, saveCollections,
  loadHidden,
  loadWebsites, saveWebsites,
  loadStarredSites, saveStarredSites,
  loadOgThumbCache, saveOgThumbCache,
  loadBookmarksCache, saveBookmarksCache,
  loadBooksMeta, saveBooksMeta,
  loadAudioMeta, saveAudioMeta,
  loadActors, loadCategories, loadStudios, invalidateDbTypeCache,
  readDbFile, writeDbFile,
};
