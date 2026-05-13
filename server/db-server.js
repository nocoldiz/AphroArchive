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
} = require('./config-server');

const Database = require('better-sqlite3');
const dbPath = path.join(__dirname, '../db/aphroarchive.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    title TEXT,
    studio TEXT,
    category TEXT,
    rating INTEGER,
    note TEXT,
    date TEXT
  );

  CREATE TABLE IF NOT EXISTS video_actors (
    video_id TEXT,
    actor TEXT,
    PRIMARY KEY (video_id, actor),
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS video_tags (
    video_id TEXT,
    tag TEXT,
    PRIMARY KEY (video_id, tag),
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS favourites (
    video_id TEXT PRIMARY KEY
  );

  CREATE TABLE IF NOT EXISTS history (
    video_id TEXT PRIMARY KEY,
    timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    name TEXT,
    video_ids TEXT -- JSON array
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT -- JSON value
  );

  CREATE TABLE IF NOT EXISTS categories (
    name TEXT PRIMARY KEY,
    display_name TEXT
  );

  CREATE TABLE IF NOT EXISTS category_tags (
    category_name TEXT,
    tag TEXT,
    PRIMARY KEY (category_name, tag),
    FOREIGN KEY (category_name) REFERENCES categories(name) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS studios (
    name TEXT PRIMARY KEY,
    website TEXT,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS websites (
    name TEXT PRIMARY KEY,
    url TEXT,
    search_url TEXT,
    scrape_method TEXT,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS website_tags (
    website_name TEXT,
    tag TEXT,
    PRIMARY KEY (website_name, tag),
    FOREIGN KEY (website_name) REFERENCES websites(name) ON DELETE CASCADE
  );
`);

// Migration from JSON to SQLite
const videoCount = db.prepare('SELECT COUNT(*) as count FROM videos').get().count;
if (videoCount === 0) {
  console.log('Migrating data from JSON to SQLite...');
  try {
    db.transaction(() => {
      // Migrate Video Meta
      if (fs.existsSync(VIDEO_META_FILE)) {
        const meta = JSON.parse(fs.readFileSync(VIDEO_META_FILE, 'utf-8'));
        const insertVideo = db.prepare('INSERT INTO videos (id, title, studio, category, rating, note, date) VALUES (?, ?, ?, ?, ?, ?, ?)');
        const insertActor = db.prepare('INSERT INTO video_actors (video_id, actor) VALUES (?, ?)');
        const insertTag = db.prepare('INSERT INTO video_tags (video_id, tag) VALUES (?, ?)');

        for (const [id, data] of Object.entries(meta)) {
          insertVideo.run(id, data.title || '', data.studio || '', data.category || '', data.rating || null, data.note || '', data.date || '');
          if (Array.isArray(data.actors)) {
            for (const actor of data.actors) {
              insertActor.run(id, actor);
            }
          }
          if (Array.isArray(data.tags)) {
            for (const tag of data.tags) {
              insertTag.run(id, tag);
            }
          }
        }
      }

      // Migrate Favourites
      if (fs.existsSync(FAVOURITES_FILE)) {
        const favs = JSON.parse(fs.readFileSync(FAVOURITES_FILE, 'utf-8'));
        const insertFav = db.prepare('INSERT INTO favourites (video_id) VALUES (?)');
        if (Array.isArray(favs)) {
          for (const id of favs) {
            try { insertFav.run(id); } catch {} // Ignore duplicates
          }
        }
      }

      // Migrate Collections
      if (fs.existsSync(COLLECTIONS_FILE)) {
        const colls = JSON.parse(fs.readFileSync(COLLECTIONS_FILE, 'utf-8'));
        const insertColl = db.prepare('INSERT INTO collections (id, name, video_ids) VALUES (?, ?, ?)');
        if (Array.isArray(colls)) {
          for (const c of colls) {
            try { insertColl.run(c.id, c.name, JSON.stringify(c.video_ids || [])); } catch {}
          }
        }
      }
    })();
    console.log('Migration to SQLite complete!');
  } catch (e) {
    console.error('Failed to migrate data to SQLite:', e);
  }
}

// Migration for categories, studios, and websites
const categoryCount = db.prepare('SELECT COUNT(*) as count FROM categories').get().count;
if (categoryCount === 0) {
  console.log('Migrating categories, studios, and websites from JSON to SQLite...');
  try {
    db.transaction(() => {
      // Migrate Categories
      if (fs.existsSync(CATEGORIES_JSON)) {
        const cats = JSON.parse(fs.readFileSync(CATEGORIES_JSON, 'utf-8'));
        const insertCat = db.prepare('INSERT INTO categories (name, display_name) VALUES (?, ?)');
        const insertCatTag = db.prepare('INSERT INTO category_tags (category_name, tag) VALUES (?, ?)');
        for (const [name, data] of Object.entries(cats)) {
          insertCat.run(name, data.displayName || name);
          if (Array.isArray(data.tags)) {
            for (const tag of data.tags) insertCatTag.run(name, tag);
          }
        }
      }

      // Migrate Studios
      if (fs.existsSync(STUDIOS_JSON)) {
        const studios = JSON.parse(fs.readFileSync(STUDIOS_JSON, 'utf-8'));
        const insertStudio = db.prepare('INSERT INTO studios (name, website, description) VALUES (?, ?, ?)');
        for (const [name, data] of Object.entries(studios)) {
          insertStudio.run(name, data.website || null, data.short_description || null);
        }
      }

      // Migrate Websites
      if (fs.existsSync(WEBSITES_JSON)) {
        const sites = JSON.parse(fs.readFileSync(WEBSITES_JSON, 'utf-8'));
        const insertSite = db.prepare('INSERT INTO websites (name, url, search_url, scrape_method, description) VALUES (?, ?, ?, ?, ?)');
        const insertSiteTag = db.prepare('INSERT INTO website_tags (website_name, tag) VALUES (?, ?)');
        for (const site of sites) {
          const name = site.name || site.url;
          insertSite.run(name, site.url || '', site.searchURL || '', site.scrapeMethod || '', site.description || '');
          if (Array.isArray(site.tags)) {
            for (const tag of site.tags) insertSiteTag.run(name, tag);
          }
        }
      }
    })();
    console.log('Migration of categories, studios, and websites complete!');
  } catch (e) {
    console.error('Failed to migrate categories, studios, and websites:', e);
  }
}

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
  if (!_favs) {
    try {
      const rows = db.prepare('SELECT video_id FROM favourites').all();
      _favs = rows.map(r => r.video_id);
    } catch (e) {
      console.error('Failed to load favourites from SQLite:', e);
      _favs = [];
    }
  }
  return _favs;
}

function saveFavs(f) {
  _favs = f;
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM favourites').run();
      const insert = db.prepare('INSERT INTO favourites (video_id) VALUES (?)');
      for (const id of f) {
        insert.run(id);
      }
    })();
  } catch (e) {
    console.error('Failed to save favourites to SQLite:', e);
  }
}

// ── History ──────────────────────────────────────────────────────────

function loadHistory() {
  if (!_history) {
    try {
      const rows = db.prepare('SELECT video_id FROM history ORDER BY timestamp DESC').all();
      _history = rows.map(r => r.video_id);
    } catch (e) {
      console.error('Failed to load history from SQLite:', e);
      _history = [];
    }
  }
  return _history;
}

function saveHistory(h) {
  _history = h;
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM history').run();
      const insert = db.prepare('INSERT INTO history (video_id, timestamp) VALUES (?, ?)');
      let ts = Date.now();
      for (const id of h) {
        insert.run(id, ts--); // Use decreasing timestamps to maintain order
      }
    })();
  } catch (e) {
    console.error('Failed to save history to SQLite:', e);
  }
}

// ── Prefs ────────────────────────────────────────────────────────────

function loadPrefs() {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('prefs');
    return row ? JSON.parse(row.value) : {};
  } catch (e) {
    console.error('Failed to load prefs from SQLite:', e);
    return {};
  }
}

function savePrefs(p) {
  try {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('prefs', JSON.stringify(p));
  } catch (e) {
    console.error('Failed to save prefs to SQLite:', e);
  }
}

// ── Ratings (legacy, now merged into video meta) ─────────────────────

function loadRatings()  { try { return JSON.parse(fs.readFileSync(RATINGS_FILE, 'utf-8')); } catch { return {}; } }
function saveRatings(r) { fs.writeFileSync(RATINGS_FILE, JSON.stringify(r)); }

// ── Video meta ───────────────────────────────────────────────────────

function loadVideoMeta() {
  if (!_videoMeta) {
    _videoMeta = {};
    try {
      const rows = db.prepare('SELECT * FROM videos').all();
      const getActors = db.prepare('SELECT actor FROM video_actors WHERE video_id = ?');
      const getTags = db.prepare('SELECT tag FROM video_tags WHERE video_id = ?');
      
      for (const row of rows) {
        const actors = getActors.all(row.id).map(r => r.actor);
        const tags = getTags.all(row.id).map(r => r.tag);
        _videoMeta[row.id] = {
          title: row.title || '',
          studio: row.studio || '',
          category: row.category || '',
          rating: row.rating,
          note: row.note || '',
          date: row.date || '',
          actors,
          tags
        };
      }
    } catch (e) {
      console.error('Failed to load video meta from SQLite:', e);
    }
  }
  return _videoMeta;
}

function saveVideoMeta(m) {
  _videoMeta = m;
  // This is a legacy fallback. In SQLite we should use setVideoMetaFields.
  // But if we must save the whole object, we can do it in a transaction.
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM video_actors').run();
      db.prepare('DELETE FROM video_tags').run();
      db.prepare('DELETE FROM videos').run();
      
      const insertVideo = db.prepare('INSERT INTO videos (id, title, studio, category, rating, note, date) VALUES (?, ?, ?, ?, ?, ?, ?)');
      const insertActor = db.prepare('INSERT INTO video_actors (video_id, actor) VALUES (?, ?)');
      const insertTag = db.prepare('INSERT INTO video_tags (video_id, tag) VALUES (?, ?)');

      for (const [id, data] of Object.entries(m)) {
        insertVideo.run(id, data.title || '', data.studio || '', data.category || '', data.rating || null, data.note || '', data.date || '');
        if (Array.isArray(data.actors)) {
          for (const actor of data.actors) insertActor.run(id, actor);
        }
        if (Array.isArray(data.tags)) {
          for (const tag of data.tags) insertTag.run(id, tag);
        }
      }
    })();
  } catch (e) {
    console.error('Failed to save video meta to SQLite:', e);
  }
}

function setVideoMetaFields(id, fields) {
  const meta = loadVideoMeta();
  if (!meta[id]) meta[id] = { title: '', actors: [], tags: [], studio: '', rating: null, category: '', note: '', date: '' };
  Object.assign(meta[id], fields);
  
  try {
    db.transaction(() => {
      const stmt = db.prepare('INSERT INTO videos (id, title, studio, category, rating, note, date) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, studio=excluded.studio, category=excluded.category, rating=excluded.rating, note=excluded.note, date=excluded.date');
      const current = meta[id];
      stmt.run(id, current.title || '', current.studio || '', current.category || '', current.rating || null, current.note || '', current.date || '');
      
      if (fields.actors) {
        db.prepare('DELETE FROM video_actors WHERE video_id = ?').run(id);
        const insertActor = db.prepare('INSERT INTO video_actors (video_id, actor) VALUES (?, ?)');
        for (const actor of fields.actors) insertActor.run(id, actor);
      }
      if (fields.tags) {
        db.prepare('DELETE FROM video_tags WHERE video_id = ?').run(id);
        const insertTag = db.prepare('INSERT INTO video_tags (video_id, tag) VALUES (?, ?)');
        for (const tag of fields.tags) insertTag.run(id, tag);
      }
    })();
  } catch (e) {
    console.error('Failed to set video meta fields in SQLite:', e);
  }
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

function loadCollections() {
  try {
    const rows = db.prepare('SELECT * FROM collections').all();
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      video_ids: JSON.parse(row.video_ids || '[]')
    }));
  } catch (e) {
    console.error('Failed to load collections from SQLite:', e);
    return [];
  }
}

function saveCollections(c) {
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM collections').run();
      const insert = db.prepare('INSERT INTO collections (id, name, video_ids) VALUES (?, ?, ?)');
      for (const coll of c) {
        insert.run(coll.id, coll.name, JSON.stringify(coll.video_ids || []));
      }
    })();
  } catch (e) {
    console.error('Failed to save collections to SQLite:', e);
  }
}

// ── Hidden terms ─────────────────────────────────────────────────────

function loadHidden() {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('hidden_terms');
    if (row) return JSON.parse(row.value);
    
    // Fallback to file and migrate
    if (fs.existsSync(HIDDEN_FILE)) {
      const lines = fs.readFileSync(HIDDEN_FILE, 'utf-8')
        .split('\n').map(l => l.trim()).filter(l => l.length > 0);
      saveHidden(lines);
      return lines;
    }
    return [];
  } catch (e) {
    console.error('Failed to load hidden terms from SQLite:', e);
    return [];
  }
}

// ── Websites ─────────────────────────────────────────────────────────

function loadWebsites() {
  try {
    const rows = db.prepare('SELECT * FROM websites').all();
    return rows.map(row => {
      const tags = db.prepare('SELECT tag FROM website_tags WHERE website_name = ?').all(row.name).map(r => r.tag);
      return {
        name: row.name,
        url: row.url,
        searchURL: row.search_url,
        scrapeMethod: row.scrape_method,
        tags,
        description: row.description
      };
    });
  } catch (e) {
    console.error('Failed to load websites from SQLite:', e);
    return [];
  }
}

function saveWebsites(s) {
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM website_tags').run();
      db.prepare('DELETE FROM websites').run();
      const insertSite = db.prepare('INSERT INTO websites (name, url, search_url, scrape_method, description) VALUES (?, ?, ?, ?, ?)');
      const insertTag = db.prepare('INSERT INTO website_tags (website_name, tag) VALUES (?, ?)');
      for (const site of s) {
        const name = site.name || site.url;
        insertSite.run(name, site.url || '', site.searchURL || '', site.scrapeMethod || '', site.description || '');
        if (Array.isArray(site.tags)) {
          for (const tag of site.tags) insertTag.run(name, tag);
        }
      }
    })();
  } catch (e) {
    console.error('Failed to save websites to SQLite:', e);
  }
}

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
  if (!_categories) {
    try {
      const rows = db.prepare('SELECT * FROM categories').all();
      _categories = rows.map(row => {
        const tags = db.prepare('SELECT tag FROM category_tags WHERE category_name = ?').all(row.name).map(r => r.tag);
        return { name: row.name, displayName: row.display_name, terms: [row.name, ...tags] };
      });
    } catch (e) {
      console.error('Failed to load categories from SQLite:', e);
      _categories = [];
    }
  }
  return _categories;
}

function saveCategories(cats) {
  _categories = null;
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM category_tags').run();
      db.prepare('DELETE FROM categories').run();
      const insertCat = db.prepare('INSERT INTO categories (name, display_name) VALUES (?, ?)');
      const insertCatTag = db.prepare('INSERT INTO category_tags (category_name, tag) VALUES (?, ?)');
      for (const [name, data] of Object.entries(cats)) {
        insertCat.run(name, data.displayName || name);
        if (Array.isArray(data.tags)) {
          for (const tag of data.tags) insertCatTag.run(name, tag);
        }
      }
    })();
  } catch (e) {
    console.error('Failed to save categories to SQLite:', e);
  }
}

function _parseStudios(raw) {
  return Object.keys(raw).map(name => {
    const entry = raw[name];
    return { name, terms: [name], website: entry.website || null, description: entry.short_description || null };
  });
}

function loadStudios() {
  if (!_studios) {
    try {
      const rows = db.prepare('SELECT * FROM studios').all();
      _studios = rows.map(row => ({
        name: row.name,
        terms: [row.name],
        website: row.website,
        description: row.description
      }));
    } catch (e) {
      console.error('Failed to load studios from SQLite:', e);
      _studios = [];
    }
  }
  return _studios;
}

function saveStudios(studios) {
  _studios = null;
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM studios').run();
      const insertStudio = db.prepare('INSERT INTO studios (name, website, description) VALUES (?, ?, ?)');
      for (const [name, data] of Object.entries(studios)) {
        insertStudio.run(name, data.website || null, data.short_description || data.description || null);
      }
    })();
  } catch (e) {
    console.error('Failed to save studios to SQLite:', e);
  }
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

function saveHidden(lines) {
  try {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('hidden_terms', JSON.stringify(lines));
  } catch (e) {
    console.error('Failed to save hidden terms to SQLite:', e);
  }
}

module.exports = {
  loadFavs, saveFavs,
  loadHistory, saveHistory,
  loadPrefs, savePrefs,
  loadRatings, saveRatings,
  loadVideoMeta, saveVideoMeta, setVideoMetaFields,
  loadThumbsCache, saveThumbsCache,
  loadVaultConfig, saveVaultConfig, loadVaultMeta, saveVaultMeta,
  loadCollections, saveCollections,
  loadHidden, saveHidden,
  loadWebsites, saveWebsites,
  loadStarredSites, saveStarredSites,
  loadOgThumbCache, saveOgThumbCache,
  loadBookmarksCache, saveBookmarksCache,
  loadBooksMeta, saveBooksMeta,
  loadAudioMeta, saveAudioMeta,
  loadActors, loadCategories, saveCategories, loadStudios, saveStudios, invalidateDbTypeCache,
  readDbFile, writeDbFile,
};
