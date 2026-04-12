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
  BM_CACHE_FILE, OG_THUMB_CACHE_FILE,
  BOOKS_META_FILE, AUDIO_META_FILE,
  BM_DIR,
} = require('./config');

// ── Favourites ───────────────────────────────────────────────────────

function loadFavs()   { try { return JSON.parse(fs.readFileSync(FAVOURITES_FILE, 'utf-8')); } catch { return []; } }
function saveFavs(f)  { fs.writeFileSync(FAVOURITES_FILE, JSON.stringify(f)); }

// ── History ──────────────────────────────────────────────────────────

function loadHistory()  { try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')); } catch { return []; } }
function saveHistory(h) { fs.writeFileSync(HISTORY_FILE, JSON.stringify(h)); }

// ── Prefs ────────────────────────────────────────────────────────────

function loadPrefs()  { try { return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf-8')); } catch { return {}; } }
function savePrefs(p) { fs.writeFileSync(PREFS_FILE, JSON.stringify(p)); }

// ── Ratings (legacy, now merged into video meta) ─────────────────────

function loadRatings()  { try { return JSON.parse(fs.readFileSync(RATINGS_FILE, 'utf-8')); } catch { return {}; } }
function saveRatings(r) { fs.writeFileSync(RATINGS_FILE, JSON.stringify(r)); }

// ── Video meta ───────────────────────────────────────────────────────

function loadVideoMeta()  { try { return JSON.parse(fs.readFileSync(VIDEO_META_FILE, 'utf-8')); } catch { return {}; } }
function saveVideoMeta(m) { fs.writeFileSync(VIDEO_META_FILE, JSON.stringify(m, null, 2)); }

function setVideoMetaFields(id, fields) {
  const meta = loadVideoMeta();
  if (!meta[id]) meta[id] = { title: '', actors: [], tags: [], studio: '', rating: null, category: '', note: '', date: '' };
  Object.assign(meta[id], fields);
  saveVideoMeta(meta);
}

// ── Thumbnails cache ─────────────────────────────────────────────────

function loadThumbsCache()  { try { return JSON.parse(fs.readFileSync(THUMBS_CACHE_FILE, 'utf-8')); } catch { return {}; } }
function saveThumbsCache(c) { try { fs.writeFileSync(THUMBS_CACHE_FILE, JSON.stringify(c)); } catch {} }

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

function loadActors() {
  try {
    const raw = JSON.parse(fs.readFileSync(ACTORS_JSON, 'utf-8'));
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
  } catch { return []; }
}

function loadCategories() {
  try {
    const raw = JSON.parse(fs.readFileSync(CATEGORIES_JSON, 'utf-8'));
    return Object.keys(raw).map(name => {
      const entry      = raw[name];
      const tags       = Array.isArray(entry.tags) ? entry.tags : [];
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
  loadOgThumbCache, saveOgThumbCache,
  loadBookmarksCache, saveBookmarksCache,
  loadBooksMeta, saveBooksMeta,
  loadAudioMeta, saveAudioMeta,
  loadActors, loadCategories, loadStudios,
  readDbFile, writeDbFile,
};
