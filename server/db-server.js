'use strict';
// ═══════════════════════════════════════════════════════════════════
//  db.js — All load/save functions for persistent data
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  FAVOURITES_FILE, HISTORY_FILE, PREFS_FILE, RATINGS_FILE,
  VIDEO_META_FILE, THUMBS_CACHE_FILE,
  VAULT_CONFIG_FILE, VAULT_META_FILE,
  COLLECTIONS_FILE,
  HIDDEN_FILE,
  WEBSITES_JSON,
  ACTORS_JSON, CATEGORIES_JSON, STUDIOS_JSON,
  BM_CACHE_FILE, OG_THUMB_CACHE_FILE, STARRED_SITES_FILE, PROMPTS_FILE,
  BOOKS_META_FILE, AUDIO_META_FILE,
  LINK_DIR,
  VAULT_DIR,
  DB_DIR,
  CACHE_DIR,
} = require('./config-server');

const { DatabaseSync } = eval("require('node:sqlite')");

// ── In-memory write-through caches ──────────────────────────────────
let _favs       = null;
let _history    = null;
let _videoMeta  = null;
let _thumbs     = null;
let _actors     = null;
let _categories = null;
let _studios    = null;

let db;
let currentProfile = 'default';
let _dbInMemory = false;

// Wraps a synchronous function in a BEGIN/COMMIT/ROLLBACK block
function txn(fn) {
  db.exec('BEGIN');
  try { fn(); db.exec('COMMIT'); }
  catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}

function ensureSchema(database) {
  database.exec(`
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

    CREATE TABLE IF NOT EXISTS enabled_categories (
      path TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS actors (
      name TEXT PRIMARY KEY,
      date_of_birth TEXT,
      nationality TEXT,
      imdb_page TEXT
    );

    CREATE TABLE IF NOT EXISTS links (
      url TEXT PRIMARY KEY,
      title TEXT,
      category TEXT,
      img TEXT,
      scraped_video_url TEXT,
      has_video INTEGER DEFAULT 0,
      embed_url TEXT,
      has_embed INTEGER DEFAULT 0,
      added_at INTEGER,
      tags TEXT,
      downloaded INTEGER DEFAULT 0,
      local_video_id TEXT,
      fav INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS og_thumbs (
      url TEXT PRIMARY KEY,
      img TEXT,
      ts INTEGER
    );

    CREATE TABLE IF NOT EXISTS thumbs_cache (
      video_id TEXT PRIMARY KEY,
      duration REAL,
      data TEXT
    );

    CREATE TABLE IF NOT EXISTS visual_hashes (
      video_id TEXT PRIMARY KEY,
      hash TEXT
    );

    CREATE TABLE IF NOT EXISTS comments (
      video_id TEXT PRIMARY KEY,
      data TEXT
    );

    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      text TEXT,
      sites TEXT,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS books_meta (
      filename TEXT PRIMARY KEY,
      title TEXT,
      ext TEXT,
      size INTEGER,
      size_f TEXT,
      date INTEGER,
      type TEXT
    );

    CREATE TABLE IF NOT EXISTS audio_meta (
      filename TEXT PRIMARY KEY,
      title TEXT,
      ext TEXT,
      size INTEGER,
      size_f TEXT,
      date INTEGER
    );

    CREATE TABLE IF NOT EXISTS video_index (
      id TEXT PRIMARY KEY,
      name TEXT,
      filename TEXT,
      ext TEXT,
      rel TEXT,
      cat_path TEXT,
      category TEXT,
      size INTEGER,
      size_f TEXT,
      mtime INTEGER,
      modified TEXT,
      is_external INTEGER DEFAULT 0,
      encrypted INTEGER DEFAULT 0
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
  // Migrations for columns added after initial schema
  try { database.exec('ALTER TABLE links ADD COLUMN tags TEXT'); } catch {}
  try { database.exec('ALTER TABLE links ADD COLUMN downloaded INTEGER DEFAULT 0'); } catch {}
  try { database.exec('ALTER TABLE links ADD COLUMN local_video_id TEXT'); } catch {}
  try { database.exec('ALTER TABLE links ADD COLUMN has_video INTEGER DEFAULT 0'); } catch {}
  try { database.exec('ALTER TABLE links ADD COLUMN has_embed INTEGER DEFAULT 0'); } catch {}
  try { database.exec('ALTER TABLE links ADD COLUMN fav INTEGER DEFAULT 0'); } catch {}
  try { database.exec('ALTER TABLE links ADD COLUMN vault INTEGER DEFAULT 0'); } catch {}
  try { database.exec('ALTER TABLE videos ADD COLUMN language TEXT'); } catch {}
}

function switchProfile(profileName) {
  currentProfile = profileName;
  _dbInMemory = false;
  if (db) {
    try { db.close(); } catch(e) {}
  }
  const dbPath = path.join(DB_DIR, `aphroarchive_${profileName}.db`);
  fs.mkdirSync(DB_DIR, { recursive: true });
  db = new DatabaseSync(dbPath);
  ensureSchema(db);

  // Clear caches
  _favs       = null;
  _history    = null;
  _videoMeta  = null;
  _thumbs     = null;
  _actors     = null;
  _categories = null;
  _studios    = null;

  return db;
}

// Initialize with last active profile (or default); defer disk creation until preset is chosen
{
  let startProfile = 'default';
  try {
    const _lastFile = path.join(DB_DIR, 'last-profile.txt');
    const _name = fs.readFileSync(_lastFile, 'utf-8').trim();
    const _dbPath = path.join(DB_DIR, `aphroarchive_${_name}.db`);
    if (_name && _name !== 'Vault' && fs.existsSync(_dbPath)) startProfile = _name;
  } catch {}
  const _startDbPath = path.join(DB_DIR, `aphroarchive_${startProfile}.db`);
  if (fs.existsSync(_startDbPath)) {
    switchProfile(startProfile);
  } else {
    // First run — no DB on disk yet; stay in memory until the user picks a preset
    currentProfile = startProfile;
    _dbInMemory = true;
    db = new DatabaseSync(':memory:');
    ensureSchema(db);
  }
}


// ── Full JSON → SQLite migration (runs once per table) ───────────────

function _migrateJsonToSqlite() {
  // Actors
  try {
    const actorCount = db.prepare('SELECT COUNT(*) as c FROM actors').get().c;
    if (actorCount === 0 && fs.existsSync(ACTORS_JSON)) {
      const raw = JSON.parse(fs.readFileSync(ACTORS_JSON, 'utf-8'));
      txn(() => {
        const ins = db.prepare('INSERT OR IGNORE INTO actors (name, date_of_birth, nationality, imdb_page) VALUES (?, ?, ?, ?)');
        for (const [name, d] of Object.entries(raw)) ins.run(name, d.date_of_birth || null, d.nationality || null, d.imdb_page || null);
      });
      console.log('[migrate] actors.json → actors table');
    }
  } catch (e) { console.error('[migrate] actors:', e.message); }

  // Links cache
  try {
    const bmCount = db.prepare('SELECT COUNT(*) as c FROM links').get().c;
    if (bmCount === 0 && fs.existsSync(BM_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(BM_CACHE_FILE, 'utf-8'));
      const items = Array.isArray(data.items) ? data.items : [];
      txn(() => {
        const ins = db.prepare('INSERT OR IGNORE INTO links (url, title, category, img, scraped_video_url, embed_url, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
        for (const it of items) ins.run(it.url, it.title ?? null, it.category ?? null, it.img ?? null, it.scrapedVideoUrl ?? null, it.embedUrl ?? null, it.addedAt ?? Date.now());
      });
      console.log(`[migrate] links_cache.json → links table (${items.length} items)`);
    }
  } catch (e) { console.error('[migrate] links:', e.message); }

  // OG thumb cache
  try {
    const ogCount = db.prepare('SELECT COUNT(*) as c FROM og_thumbs').get().c;
    if (ogCount === 0 && fs.existsSync(OG_THUMB_CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(OG_THUMB_CACHE_FILE, 'utf-8'));
      txn(() => {
        const ins = db.prepare('INSERT OR IGNORE INTO og_thumbs (url, img, ts) VALUES (?, ?, ?)');
        for (const [url, v] of Object.entries(raw)) ins.run(url, v.img ?? null, v.ts ?? null);
      });
      console.log('[migrate] og_thumb_cache.json → og_thumbs table');
    }
  } catch (e) { console.error('[migrate] og_thumbs:', e.message); }

  // Thumbs cache
  try {
    const tcCount = db.prepare('SELECT COUNT(*) as c FROM thumbs_cache').get().c;
    if (tcCount === 0 && fs.existsSync(THUMBS_CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(THUMBS_CACHE_FILE, 'utf-8'));
      txn(() => {
        const ins = db.prepare('INSERT OR IGNORE INTO thumbs_cache (video_id, duration, data) VALUES (?, ?, ?)');
        for (const [id, entry] of Object.entries(raw)) {
          const { duration, ...rest } = entry;
          ins.run(id, duration ?? null, Object.keys(rest).length ? JSON.stringify(rest) : null);
        }
      });
      console.log('[migrate] thumbcache.json → thumbs_cache table');
    }
  } catch (e) { console.error('[migrate] thumbs_cache:', e.message); }

  // Visual hashes
  try {
    const hashCount = db.prepare('SELECT COUNT(*) as c FROM visual_hashes').get().c;
    const HASHES_FILE = path.join(CACHE_DIR, '.AphroArchive-visual-hashes.json');
    if (hashCount === 0 && fs.existsSync(HASHES_FILE)) {
      const raw = JSON.parse(fs.readFileSync(HASHES_FILE, 'utf-8'));
      txn(() => {
        const ins = db.prepare('INSERT OR IGNORE INTO visual_hashes (video_id, hash) VALUES (?, ?)');
        for (const [id, hash] of Object.entries(raw)) ins.run(id, hash);
      });
      console.log('[migrate] visual-hashes.json → visual_hashes table');
    }
  } catch (e) { console.error('[migrate] visual_hashes:', e.message); }

  // Prompts
  try {
    const pCount = db.prepare('SELECT COUNT(*) as c FROM prompts').get().c;
    if (pCount === 0 && fs.existsSync(PROMPTS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf-8'));
      if (Array.isArray(raw) && raw.length) {
        txn(() => {
          const ins = db.prepare('INSERT OR IGNORE INTO prompts (id, text, sites, created_at) VALUES (?, ?, ?, ?)');
          for (const p of raw) ins.run(p.id, p.text, JSON.stringify(p.sites || []), p.createdAt || Date.now());
        });
        console.log(`[migrate] prompts.json → prompts table (${raw.length} prompts)`);
      }
    }
  } catch (e) { console.error('[migrate] prompts:', e.message); }

  // Comments (per-video JSON files in cache/)
  try {
    const cCount = db.prepare('SELECT COUNT(*) as c FROM comments').get().c;
    if (cCount === 0) {
      const cacheDir = CACHE_DIR;
      if (fs.existsSync(cacheDir)) {
        const files = fs.readdirSync(cacheDir).filter(f => f.startsWith('comments_') && f.endsWith('.json'));
        if (files.length) {
          txn(() => {
            const ins = db.prepare('INSERT OR IGNORE INTO comments (video_id, data) VALUES (?, ?)');
            for (const f of files) {
              try {
                const videoId = f.replace(/^comments_/, '').replace(/\.json$/, '');
                const data = fs.readFileSync(path.join(cacheDir, f), 'utf-8');
                ins.run(videoId, data);
              } catch {}
            }
          });
          console.log(`[migrate] ${files.length} comment files → comments table`);
        }
      }
    }
  } catch (e) { console.error('[migrate] comments:', e.message); }

  // Books meta
  try {
    const bCount = db.prepare('SELECT COUNT(*) as c FROM books_meta').get().c;
    if (bCount === 0 && fs.existsSync(BOOKS_META_FILE)) {
      const raw = JSON.parse(fs.readFileSync(BOOKS_META_FILE, 'utf-8'));
      txn(() => {
        const ins = db.prepare('INSERT OR IGNORE INTO books_meta (filename, title, ext, size, size_f, date, type) VALUES (?, ?, ?, ?, ?, ?, ?)');
        for (const [fn, d] of Object.entries(raw)) ins.run(fn, d.title ?? null, d.ext ?? null, d.size ?? 0, d.sizeF ?? null, d.date ?? null, d.type ?? null);
      });
      console.log('[migrate] books/.meta.json → books_meta table');
    }
  } catch (e) { console.error('[migrate] books_meta:', e.message); }

  // Audio meta
  try {
    const aCount = db.prepare('SELECT COUNT(*) as c FROM audio_meta').get().c;
    if (aCount === 0 && fs.existsSync(AUDIO_META_FILE)) {
      const raw = JSON.parse(fs.readFileSync(AUDIO_META_FILE, 'utf-8'));
      txn(() => {
        const ins = db.prepare('INSERT OR IGNORE INTO audio_meta (filename, title, ext, size, size_f, date) VALUES (?, ?, ?, ?, ?, ?)');
        for (const [fn, d] of Object.entries(raw)) ins.run(fn, d.title ?? null, d.ext ?? null, d.size ?? 0, d.sizeF ?? null, d.date ?? null);
      });
      console.log('[migrate] audio/.meta.json → audio_meta table');
    }
  } catch (e) { console.error('[migrate] audio_meta:', e.message); }

  // Starred sites
  try {
    const ssRow = db.prepare("SELECT value FROM settings WHERE key = 'starred_sites'").get();
    if (!ssRow && fs.existsSync(STARRED_SITES_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STARRED_SITES_FILE, 'utf-8'));
      db.prepare("INSERT INTO settings (key, value) VALUES ('starred_sites', ?)").run(JSON.stringify(raw));
      console.log('[migrate] starred-sites.json → settings table');
    }
  } catch (e) { console.error('[migrate] starred_sites:', e.message); }
}

_migrateJsonToSqlite();

// Caches moved to top of file

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
    txn(() => {
      db.prepare('DELETE FROM favourites').run();
      const insert = db.prepare('INSERT INTO favourites (video_id) VALUES (?)');
      for (const id of f) {
        insert.run(id);
      }
    });
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
    txn(() => {
      db.prepare('DELETE FROM history').run();
      const insert = db.prepare('INSERT INTO history (video_id, timestamp) VALUES (?, ?)');
      let ts = Date.now();
      for (const id of h) {
        insert.run(id, ts--); // Use decreasing timestamps to maintain order
      }
    });
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

function getDefaultWriteRoot() {
  try {
    const prefs = loadPrefs();
    const candidate = (prefs.defaultRoot || prefs.defaultPath || prefs.defaultWriteRoot || '').toString().trim();
    if (candidate) {
      return path.resolve(candidate);
    }
  } catch (e) {
    console.error('getDefaultWriteRoot error:', e.message);
  }
  const { VIDEOS_DIR } = require('./config-server');
  return VIDEOS_DIR;
}

function resolveCategoryPhysicalPath(catPath) {
  const writeRoot = getDefaultWriteRoot();
  const roots = [writeRoot];
  const writeRes = path.resolve(writeRoot);
  const vRes = path.resolve( require('./config-server').VIDEOS_DIR );
  if (writeRes !== vRes) roots.push( require('./config-server').VIDEOS_DIR );

  try {
    const p = loadPrefs();
    for (const sf of (p.sourceFolders || [])) {
      if (!sf) continue;
      const r = path.resolve(sf);
      if (fs.existsSync(sf) && !roots.some(rr => path.resolve(rr) === r)) {
        roots.push(sf);
      }
    }
  } catch (e) {}

  if (!catPath) return writeRoot;
  const rel = String(catPath).replace(/\\/g, '/');
  for (const root of roots) {
    const cand = path.join(root, rel);
    if (fs.existsSync(cand)) return cand;
  }
  return path.join(writeRoot, rel);
}

// ── Ratings (legacy, now merged into video meta) ─────────────────────

function loadRatings()  { try { return JSON.parse(fs.readFileSync(RATINGS_FILE, 'utf-8')); } catch { return {}; } }
function saveRatings(r) { fs.writeFileSync(RATINGS_FILE, JSON.stringify(r)); }

// ── Video meta ───────────────────────────────────────────────────────

function _readVideoMetaFromDb(database) {
  const out = {};
  const rows = database.prepare('SELECT * FROM videos').all();
  const getActors = database.prepare('SELECT actor FROM video_actors WHERE video_id = ?');
  const getTags = database.prepare('SELECT tag FROM video_tags WHERE video_id = ?');
  for (const row of rows) {
    out[row.id] = {
      title: row.title || '',
      studio: row.studio || '',
      category: row.category || '',
      rating: row.rating,
      note: row.note || '',
      date: row.date || '',
      language: row.language || '',
      actors: getActors.all(row.id).map(r => r.actor),
      tags: getTags.all(row.id).map(r => r.tag)
    };
  }
  return out;
}

// Remove a video's metadata row from the public database(s). When the Vault
// profile is active the row lives in another profile's DB, so it is deleted
// there too — encryption must leave no trace in any public database.
function deleteVideoMetaEverywhere(id) {
  _videoMeta = null;
  const wipe = (database) => {
    database.prepare('DELETE FROM video_actors WHERE video_id = ?').run(id);
    database.prepare('DELETE FROM video_tags WHERE video_id = ?').run(id);
    database.prepare('DELETE FROM videos WHERE id = ?').run(id);
  };
  try { wipe(db); } catch (e) { console.error('Failed to delete video meta:', e); }
  if (currentProfile === 'Vault') {
    for (const dbPath of _otherProfileDbPaths()) {
      let other = null;
      try {
        other = new DatabaseSync(dbPath);
        wipe(other);
      } catch (e) {
        console.error('[vault] failed to delete public meta in', path.basename(dbPath), e.message);
      } finally {
        if (other) { try { other.close(); } catch {} }
      }
    }
  }
}

function loadVideoMeta() {
  if (currentProfile === 'Vault') {
    if (!_videoMeta) {
      const result = {};
      // Public meta from every other profile, then private vault meta on top
      for (const metaMap of _mapOtherProfiles(_readVideoMetaFromDb)) Object.assign(result, metaMap);
      const meta = loadVaultMeta();
      for (const [id, item] of Object.entries(meta)) {
        if (item.videoMeta) result[id] = item.videoMeta;
      }
      _videoMeta = result;
    }
    return _videoMeta;
  }

  if (!_videoMeta) {
    _videoMeta = {};
    try {
      _videoMeta = _readVideoMetaFromDb(db);
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
    txn(() => {
      db.prepare('DELETE FROM video_actors').run();
      db.prepare('DELETE FROM video_tags').run();
      db.prepare('DELETE FROM videos').run();

      const insertVideo = db.prepare('INSERT INTO videos (id, title, studio, category, rating, note, date, language) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const insertActor = db.prepare('INSERT INTO video_actors (video_id, actor) VALUES (?, ?)');
      const insertTag = db.prepare('INSERT INTO video_tags (video_id, tag) VALUES (?, ?)');

      for (const [id, data] of Object.entries(m)) {
        insertVideo.run(id, data.title || '', data.studio || '', data.category || '', data.rating || null, data.note || '', data.date || '', data.language || '');
        if (Array.isArray(data.actors)) {
          for (const actor of data.actors) insertActor.run(id, actor);
        }
        if (Array.isArray(data.tags)) {
          for (const tag of data.tags) insertTag.run(id, tag);
        }
      }
    });
  } catch (e) {
    console.error('Failed to save video meta to SQLite:', e);
  }
}

function setVideoMetaFields(id, fields) {
  const meta = loadVideoMeta();
  if (!meta[id]) meta[id] = { title: '', actors: [], tags: [], studio: '', rating: null, category: '', note: '', date: '', language: '' };
  Object.assign(meta[id], fields);

  try {
    txn(() => {
      const stmt = db.prepare('INSERT INTO videos (id, title, studio, category, rating, note, date, language) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, studio=excluded.studio, category=excluded.category, rating=excluded.rating, note=excluded.note, date=excluded.date, language=excluded.language');
      const current = meta[id];
      stmt.run(id, current.title || '', current.studio || '', current.category || '', current.rating || null, current.note || '', current.date || '', current.language || '');

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
    });
  } catch (e) {
    console.error('Failed to set video meta fields in SQLite:', e);
  }
}

// ── Thumbnails cache ─────────────────────────────────────────────────

function loadThumbsCache() {
  if (!_thumbs) {
    _thumbs = {};
    try {
      const rows = db.prepare('SELECT video_id, duration, data FROM thumbs_cache').all();
      for (const r of rows) {
        const extra = r.data ? JSON.parse(r.data) : {};
        _thumbs[r.video_id] = { duration: r.duration, ...extra };
      }
    } catch (e) {
      console.error('Failed to load thumbs cache from SQLite:', e);
    }
  }
  return _thumbs;
}

function saveThumbsCache(c) {
  _thumbs = c;
  try {
    txn(() => {
      db.prepare('DELETE FROM thumbs_cache').run();
      const ins = db.prepare('INSERT INTO thumbs_cache (video_id, duration, data) VALUES (?, ?, ?)');
      for (const [id, entry] of Object.entries(c)) {
        const { duration, ...rest } = entry;
        ins.run(id, duration ?? null, Object.keys(rest).length ? JSON.stringify(rest) : null);
      }
    });
  } catch (e) {
    console.error('Failed to save thumbs cache to SQLite:', e);
  }
}

function setThumbCacheEntry(id, entry) {
  const cache = loadThumbsCache();
  cache[id] = entry;
  try {
    const { duration, ...rest } = entry;
    db.prepare('INSERT INTO thumbs_cache (video_id, duration, data) VALUES (?, ?, ?) ON CONFLICT(video_id) DO UPDATE SET duration=excluded.duration, data=excluded.data')
      .run(id, duration ?? null, Object.keys(rest).length ? JSON.stringify(rest) : null);
  } catch (e) {
    console.error('Failed to set thumbs cache entry in SQLite:', e);
  }
}

// ── Vault ────────────────────────────────────────────────────────────

let _vaultKey = null;

function setVaultKey(key) { _vaultKey = key; }

function _encryptString(text, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let enc = cipher.update(text, 'utf8', 'base64');
  enc += cipher.final('base64');
  const tag = cipher.getAuthTag().toString('base64');
  return JSON.stringify({
    iv: iv.toString('base64'),
    tag: tag,
    ciphertext: enc
  });
}

function _decryptString(jsonStr, key) {
  const obj = JSON.parse(jsonStr);
  const iv = Buffer.from(obj.iv, 'base64');
  const tag = Buffer.from(obj.tag, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  let dec = decipher.update(obj.ciphertext, 'base64', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}

// ── Vault superuser merge ────────────────────────────────────────────
// When the Vault profile is active, reads act as a merged view of every
// other profile's public database plus the Vault's own private rows.
// Writes always go to the Vault's own DB, so private entries (actors,
// websites, tags, links…) never leak into public profiles.

function _otherProfileDbPaths() {
  try {
    return fs.readdirSync(DB_DIR)
      .filter(f => /^aphroarchive_.+\.db$/.test(f) && f !== `aphroarchive_${currentProfile}.db` && f !== 'aphroarchive_Vault.db')
      .map(f => path.join(DB_DIR, f));
  } catch { return []; }
}

// Run fn against each other profile's DB (read-only) and collect results.
// Returns [] unless the Vault profile is active.
function _mapOtherProfiles(fn) {
  if (currentProfile !== 'Vault') return [];
  const out = [];
  for (const dbPath of _otherProfileDbPaths()) {
    let other = null;
    try {
      other = new DatabaseSync(dbPath, { readOnly: true });
      out.push(fn(other));
    } catch (e) {
      console.error('[vault] merged read failed for', path.basename(dbPath), e.message);
    } finally {
      if (other) { try { other.close(); } catch {} }
    }
  }
  return out;
}

function loadVaultConfig() { try { return JSON.parse(fs.readFileSync(VAULT_CONFIG_FILE, 'utf-8')); } catch { return null; } }
function saveVaultConfig(c) { fs.writeFileSync(VAULT_CONFIG_FILE, JSON.stringify(c)); }

function loadVaultMeta() {
  try {
    const raw = fs.readFileSync(VAULT_META_FILE, 'utf-8');
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch {}
    // Encrypted wrapper produced by _encryptString is itself valid JSON, so
    // detect it by shape ({iv, tag, ciphertext}) rather than by parse failure.
    // Vault entry ids are UUIDs, so a real meta map can never have these keys.
    const isEncrypted = parsed && typeof parsed.iv === 'string' &&
      typeof parsed.tag === 'string' && typeof parsed.ciphertext === 'string';
    if (parsed && !isEncrypted) return parsed; // legacy cleartext
    if (!_vaultKey) throw new Error('Vault is locked or key missing');
    return JSON.parse(_decryptString(raw, _vaultKey));
  } catch (e) {
    return {};
  }
}

function saveVaultMeta(m) {
  if (currentProfile === 'Vault') _videoMeta = null; // merged view includes vault meta
  const jsonStr = JSON.stringify(m);
  if (!_vaultKey) {
    fs.writeFileSync(VAULT_META_FILE, jsonStr);
    return;
  }
  const encrypted = _encryptString(jsonStr, _vaultKey);
  fs.writeFileSync(VAULT_META_FILE, encrypted);
}

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
    txn(() => {
      db.prepare('DELETE FROM collections').run();
      const insert = db.prepare('INSERT INTO collections (id, name, video_ids) VALUES (?, ?, ?)');
      for (const coll of c) {
        insert.run(coll.id, coll.name, JSON.stringify(coll.video_ids || []));
      }
    });
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

function _readWebsiteRows(database) {
  const rows = database.prepare('SELECT * FROM websites').all();
  const getTags = database.prepare('SELECT tag FROM website_tags WHERE website_name = ?');
  return rows.map(row => ({
    name: row.name,
    url: row.url,
    searchURL: row.search_url,
    scrapeMethod: row.scrape_method,
    tags: getTags.all(row.name).map(r => r.tag),
    description: row.description
  }));
}

function loadWebsites() {
  try {
    const merged = new Map();
    for (const list of _mapOtherProfiles(_readWebsiteRows)) {
      for (const s of list) merged.set(s.name.toLowerCase(), s);
    }
    for (const s of _readWebsiteRows(db)) merged.set(s.name.toLowerCase(), s); // private rows win
    return [...merged.values()];
  } catch (e) {
    console.error('Failed to load websites from SQLite:', e);
    return [];
  }
}

function saveWebsites(s) {
  try {
    txn(() => {
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
    });
  } catch (e) {
    console.error('Failed to save websites to SQLite:', e);
  }
}

// ── Starred sites ─────────────────────────────────────────────────────

function loadStarredSites() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'starred_sites'").get();
    return row ? JSON.parse(row.value) : [];
  } catch { return []; }
}

function saveStarredSites(urls) {
  try {
    db.prepare("INSERT INTO settings (key, value) VALUES ('starred_sites', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify(urls));
  } catch (e) { console.error('Failed to save starred sites:', e); }
}

// ── OG thumbnail cache ───────────────────────────────────────────────

function loadOgThumbCache() {
  const map = new Map();
  try {
    const rows = db.prepare('SELECT url, img, ts FROM og_thumbs').all();
    for (const r of rows) map.set(r.url, { img: r.img, ts: r.ts });
  } catch (e) { console.error('Failed to load OG thumb cache:', e); }
  return map;
}

function saveOgThumbCache(map) {
  try {
    const ins = db.prepare('INSERT INTO og_thumbs (url, img, ts) VALUES (?, ?, ?) ON CONFLICT(url) DO UPDATE SET img=excluded.img, ts=excluded.ts');
    map.forEach((v, k) => ins.run(k, v.img ?? null, v.ts ?? null));
  } catch (e) { console.error('Failed to save OG thumb cache:', e); }
}

// ── Links cache ──────────────────────────────────────────────────

function _rowToLink(r) {
  return {
    url: r.url,
    title: r.title,
    category: r.category,
    img: r.img,
    scrapedVideoUrl: r.scraped_video_url,
    hasVideo: !!r.has_video,
    embedUrl: r.embed_url,
    hasEmbed: !!r.has_embed,
    addedAt: r.added_at,
    tags: r.tags ? JSON.parse(r.tags) : [],
    downloaded: !!r.downloaded,
    localVideoId: r.local_video_id || null,
    fav: !!r.fav,
    vault: !!r.vault,
  };
}

function _linkParams(it) {
  return [
    it.url,
    it.title ?? null,
    it.category ?? null,
    it.img ?? null,
    it.scrapedVideoUrl ?? null,
    it.hasVideo ? 1 : 0,
    it.embedUrl ?? null,
    it.hasEmbed ? 1 : 0,
    it.addedAt ?? Date.now(),
    Array.isArray(it.tags) && it.tags.length ? JSON.stringify(it.tags) : null,
    it.downloaded ? 1 : 0,
    it.localVideoId ?? null,
    it.fav ? 1 : 0,
    it.vault ? 1 : 0,
  ];
}

const _LINK_COLS = 'url, title, category, img, scraped_video_url, has_video, embed_url, has_embed, added_at, tags, downloaded, local_video_id, fav, vault';
const _LINK_PLACEHOLDERS = '?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?';

function loadLinksCache() {
  try {
    const publicLinks = (database) =>
      database.prepare(`SELECT ${_LINK_COLS} FROM links WHERE vault = 0 OR vault IS NULL`).all().map(_rowToLink);
    const merged = new Map();
    for (const list of _mapOtherProfiles(publicLinks)) {
      for (const l of list) merged.set(l.url, l);
    }
    for (const l of publicLinks(db)) merged.set(l.url, l); // private rows win
    return { items: [...merged.values()] };
  } catch (e) {
    console.error('Failed to load links cache from SQLite:', e);
    return { items: [] };
  }
}

function loadVaultLinks() {
  try {
    const rows = db.prepare(`SELECT ${_LINK_COLS} FROM links WHERE vault = 1`).all();
    return rows.map(_rowToLink);
  } catch (e) {
    console.error('Failed to load vault links from SQLite:', e);
    return [];
  }
}

// Upsert a single link into the current user's DB.
function upsertLink(it) {
  if (!it || !it.url) return;
  try {
    db.prepare(`INSERT OR REPLACE INTO links (${_LINK_COLS}) VALUES (${_LINK_PLACEHOLDERS})`).run(_linkParams(it));
  } catch (e) { console.error('Failed to upsert link:', e); }
}

// Delete a single link by URL from the current user's DB.
function deleteLink(url) {
  if (!url) return;
  try {
    db.prepare('DELETE FROM links WHERE url = ?').run(url);
  } catch (e) { console.error('Failed to delete link:', e); }
}

// Bulk replace — only use for full imports (JSON import, browser favs import).
// For scraping or individual edits, prefer upsertLink.
function saveLinksCache(data) {
  const raw = (data && Array.isArray(data.items)) ? data.items : [];
  const seenUrls = new Set();
  const seenNames = new Set();
  const items = [];
  for (const it of raw) {
    if (!it || !it.url) continue;
    const u = it.url;
    const nm = (it.title || '').trim().toLowerCase();
    if (seenUrls.has(u) || (nm && seenNames.has(nm))) continue;
    seenUrls.add(u);
    if (nm) seenNames.add(nm);
    items.push(it);
  }
  try {
    txn(() => {
      db.prepare('DELETE FROM links').run();
      const ins = db.prepare(`INSERT INTO links (${_LINK_COLS}) VALUES (${_LINK_PLACEHOLDERS})`);
      for (const it of items) ins.run(_linkParams(it));
    });
  } catch (e) { console.error('Failed to save links cache to SQLite:', e); }
}

// ── Books meta ───────────────────────────────────────────────────────

function loadBooksMeta() {
  try {
    const rows = db.prepare('SELECT filename, title, ext, size, size_f, date, type FROM books_meta').all();
    const out = {};
    for (const r of rows) out[r.filename] = { title: r.title, ext: r.ext, size: r.size, sizeF: r.size_f, date: r.date, type: r.type };
    return out;
  } catch (e) { console.error('Failed to load books meta:', e); return {}; }
}

function saveBooksMeta(m) {
  try {
    txn(() => {
      db.prepare('DELETE FROM books_meta').run();
      const ins = db.prepare('INSERT INTO books_meta (filename, title, ext, size, size_f, date, type) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const [filename, d] of Object.entries(m)) {
        ins.run(filename, d.title ?? null, d.ext ?? null, d.size ?? 0, d.sizeF ?? null, d.date ?? null, d.type ?? null);
      }
    });
  } catch (e) { console.error('Failed to save books meta:', e); }
}

// ── Audio meta ───────────────────────────────────────────────────────

function loadAudioMeta() {
  try {
    const rows = db.prepare('SELECT filename, title, ext, size, size_f, date FROM audio_meta').all();
    const out = {};
    for (const r of rows) out[r.filename] = { title: r.title, ext: r.ext, size: r.size, sizeF: r.size_f, date: r.date };
    return out;
  } catch (e) { console.error('Failed to load audio meta:', e); return {}; }
}

function saveAudioMeta(m) {
  try {
    txn(() => {
      db.prepare('DELETE FROM audio_meta').run();
      const ins = db.prepare('INSERT INTO audio_meta (filename, title, ext, size, size_f, date) VALUES (?, ?, ?, ?, ?, ?)');
      for (const [filename, d] of Object.entries(m)) {
        ins.run(filename, d.title ?? null, d.ext ?? null, d.size ?? 0, d.sizeF ?? null, d.date ?? null);
      }
    });
  } catch (e) { console.error('Failed to save audio meta:', e); }
}

// ── Comments ─────────────────────────────────────────────────────────

function loadComments(videoId) {
  try {
    const row = db.prepare('SELECT data FROM comments WHERE video_id = ?').get(videoId);
    if (!row) return null;
    const raw = _isVaultEncryptActive() ? _tryDecrypt(row.data) : row.data;
    return JSON.parse(raw);
  } catch (e) { console.error('Failed to load comments:', e); return null; }
}

function saveComments(videoId, arr) {
  try {
    const vault = _isVaultEncryptActive();
    const data = vault ? _encryptString(JSON.stringify(arr), _vaultKey) : JSON.stringify(arr);
    db.prepare('INSERT INTO comments (video_id, data) VALUES (?, ?) ON CONFLICT(video_id) DO UPDATE SET data=excluded.data')
      .run(videoId, data);
  } catch (e) { console.error('Failed to save comments:', e); }
}

function clearAllComments() {
  try { db.prepare('DELETE FROM comments').run(); } catch (e) { console.error('Failed to clear comments:', e); }
}

// ── Visual hashes (duplicate detection) ──────────────────────────────

function loadVisualHashes() {
  try {
    const rows = db.prepare('SELECT video_id, hash FROM visual_hashes').all();
    const out = {};
    for (const r of rows) out[r.video_id] = r.hash;
    return out;
  } catch (e) { console.error('Failed to load visual hashes:', e); return {}; }
}

function setVisualHash(videoId, hash) {
  try {
    db.prepare('INSERT INTO visual_hashes (video_id, hash) VALUES (?, ?) ON CONFLICT(video_id) DO UPDATE SET hash=excluded.hash')
      .run(videoId, hash);
  } catch (e) { console.error('Failed to set visual hash:', e); }
}

function saveVisualHashes(hashes) {
  try {
    txn(() => {
      db.prepare('DELETE FROM visual_hashes').run();
      const ins = db.prepare('INSERT INTO visual_hashes (video_id, hash) VALUES (?, ?)');
      for (const [id, hash] of Object.entries(hashes)) ins.run(id, hash);
    });
  } catch (e) { console.error('Failed to save visual hashes:', e); }
}

// ── Prompts ───────────────────────────────────────────────────────────

function _isVaultEncryptActive() {
  return currentProfile === 'Vault' && !!_vaultKey;
}

function _tryDecrypt(str) {
  if (!_vaultKey || !str) return str;
  try { return _decryptString(str, _vaultKey); } catch { return str; }
}

function loadPrompts() {
  try {
    const rows = db.prepare('SELECT id, text, sites, created_at FROM prompts ORDER BY created_at DESC').all();
    const vault = _isVaultEncryptActive();
    return rows.map(r => {
      const text  = vault ? _tryDecrypt(r.text)  : r.text;
      const sites = vault ? _tryDecrypt(r.sites) : (r.sites || '[]');
      return { id: r.id, text, sites: JSON.parse(sites || '[]'), createdAt: r.created_at };
    });
  } catch (e) { console.error('Failed to load prompts:', e); return []; }
}

function savePrompt(prompt) {
  try {
    const vault = _isVaultEncryptActive();
    const text  = vault ? _encryptString(prompt.text,                    _vaultKey) : prompt.text;
    const sites = vault ? _encryptString(JSON.stringify(prompt.sites || []), _vaultKey) : JSON.stringify(prompt.sites || []);
    db.prepare('INSERT INTO prompts (id, text, sites, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET text=excluded.text, sites=excluded.sites')
      .run(prompt.id, text, sites, prompt.createdAt || Date.now());
  } catch (e) { console.error('Failed to save prompt:', e); }
}

function updatePrompt(id, fields) {
  try {
    const row = db.prepare('SELECT text, sites FROM prompts WHERE id = ?').get(id);
    if (!row) return false;
    const vault = _isVaultEncryptActive();
    let newText, newSites;
    if (fields.text !== undefined) {
      newText = vault ? _encryptString(fields.text, _vaultKey) : fields.text;
    } else {
      newText = row.text; // already in correct form (encrypted or plain)
    }
    if (fields.sites !== undefined) {
      newSites = vault ? _encryptString(JSON.stringify(fields.sites), _vaultKey) : JSON.stringify(fields.sites);
    } else {
      newSites = row.sites; // already in correct form
    }
    db.prepare('UPDATE prompts SET text = ?, sites = ? WHERE id = ?').run(newText, newSites, id);
    return true;
  } catch (e) { console.error('Failed to update prompt:', e); return false; }
}

// Re-encrypts all prompts and comments in the current DB from oldKey → newKey.
// Called by vault-server.js during password change.
function reEncryptVaultSqlite(oldKey, newKey) {
  try {
    const rows = db.prepare('SELECT id, text, sites FROM prompts').all();
    const upd  = db.prepare('UPDATE prompts SET text = ?, sites = ? WHERE id = ?');
    for (const row of rows) {
      let text = row.text, sites = row.sites || '[]';
      try { text  = _decryptString(row.text,  oldKey); } catch {}
      try { sites = _decryptString(row.sites,  oldKey); } catch {}
      upd.run(_encryptString(text, newKey), _encryptString(sites, newKey), row.id);
    }
  } catch (e) { console.error('[vault] re-encrypt prompts failed:', e); }

  try {
    const rows = db.prepare('SELECT video_id, data FROM comments').all();
    const upd  = db.prepare('UPDATE comments SET data = ? WHERE video_id = ?');
    for (const row of rows) {
      let data = row.data;
      try { data = _decryptString(row.data, oldKey); } catch {}
      upd.run(_encryptString(data, newKey), row.video_id);
    }
  } catch (e) { console.error('[vault] re-encrypt comments failed:', e); }
}

function deletePrompt(id) {
  try { db.prepare('DELETE FROM prompts WHERE id = ?').run(id); } catch (e) { console.error('Failed to delete prompt:', e); }
}

function deleteAllPrompts() {
  try { db.prepare('DELETE FROM prompts').run(); } catch (e) { console.error('Failed to delete all prompts:', e); }
}

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

function _readActorRows(database) {
  const rows = database.prepare('SELECT name, date_of_birth, nationality, imdb_page FROM actors').all();
  return rows.map(r => {
    const ageInfo = parseActorAge(r.date_of_birth);
    return {
      name: r.name, terms: [r.name],
      date_of_birth: r.date_of_birth || null,
      nationality: r.nationality || null,
      age: ageInfo ? ageInfo.age : null,
      deceased: ageInfo ? ageInfo.deceased : false,
      imdb_page: r.imdb_page || null,
    };
  });
}

function loadActors() {
  if (!_actors) {
    try {
      const merged = new Map();
      for (const list of _mapOtherProfiles(_readActorRows)) {
        for (const a of list) merged.set(a.name.toLowerCase(), a);
      }
      for (const a of _readActorRows(db)) merged.set(a.name.toLowerCase(), a); // private rows win
      _actors = [...merged.values()];
    } catch (e) { console.error('Failed to load actors from SQLite:', e); _actors = []; }
  }
  return _actors;
}

function saveActors(raw) {
  _actors = null;
  try {
    txn(() => {
      db.prepare('DELETE FROM actors').run();
      const ins = db.prepare('INSERT INTO actors (name, date_of_birth, nationality, imdb_page) VALUES (?, ?, ?, ?)');
      for (const [name, data] of Object.entries(raw)) {
        ins.run(name, data.date_of_birth || null, data.nationality || null, data.imdb_page || null);
      }
    });
  } catch (e) { console.error('Failed to save actors to SQLite:', e); }
}

function _parseCategories(raw) {
  return Object.keys(raw).map(name => {
    const entry      = raw[name];
    const tags       = Array.isArray(entry.tags) ? entry.tags : [];
    const displayName = entry.displayName || name;
    return { name, displayName, terms: [name, ...tags] };
  });
}

function _readCategoryRows(database) {
  const rows = database.prepare('SELECT * FROM categories').all();
  const getTags = database.prepare('SELECT tag FROM category_tags WHERE category_name = ?');
  return rows.map(row => {
    const tags = getTags.all(row.name).map(r => r.tag);
    return { name: row.name, displayName: row.display_name, terms: [row.name, ...tags] };
  });
}

function loadCategories() {
  if (currentProfile === 'Vault') {
    // Superuser view: every profile's categories, the Vault's own private
    // categories table, plus categories derived from encrypted file metadata.
    const merged = new Map();
    for (const list of _mapOtherProfiles(_readCategoryRows)) {
      for (const c of list) merged.set(c.name.toLowerCase(), c);
    }
    try {
      for (const c of _readCategoryRows(db)) merged.set(c.name.toLowerCase(), c); // private rows win
    } catch (e) { console.error('Failed to load vault categories from SQLite:', e); }
    const meta = loadVaultMeta();
    for (const item of Object.values(meta)) {
      if (item.category && !merged.has(item.category.toLowerCase())) {
        merged.set(item.category.toLowerCase(), { name: item.category, displayName: item.category, terms: [item.category] });
      }
    }
    return [...merged.values()];
  }

  if (!_categories) {
    try {
      _categories = _readCategoryRows(db);
    } catch (e) {
      console.error('Failed to load categories from SQLite:', e);
      _categories = [];
    }
  }
  return _categories;
}

function loadEnabledCategories() {
  try {
    const rows = db.prepare('SELECT path FROM enabled_categories').all();
    return rows.map(r => r.path);
  } catch (e) {
    console.error('Failed to load enabled categories:', e);
    return [];
  }
}

function saveEnabledCategories(paths) {
  try {
    const insert = db.prepare('INSERT OR IGNORE INTO enabled_categories (path) VALUES (?)');
    const del = db.prepare('DELETE FROM enabled_categories');
    txn(() => {
      del.run();
      for (const p of paths) insert.run(p);
    });
  } catch (e) {
    console.error('Failed to save enabled categories:', e);
  }
}

function saveCategories(cats) {
  _categories = null;
  try {
    txn(() => {
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
    });
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
    txn(() => {
      db.prepare('DELETE FROM studios').run();
      const insertStudio = db.prepare('INSERT INTO studios (name, website, description) VALUES (?, ?, ?)');
      for (const [name, data] of Object.entries(studios)) {
        insertStudio.run(name, data.website || null, data.short_description || data.description || null);
      }
    });
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

// ── Video file index (full scan cache persisted to DB) ───────────────

function loadVideoIndex() {
  try {
    const rows = db.prepare('SELECT * FROM video_index').all();
    if (!rows.length) return null;
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      filename: r.filename,
      ext: r.ext,
      rel: r.rel,
      catPath: r.cat_path,
      category: r.category,
      size: r.size,
      sizeF: r.size_f,
      mtime: r.mtime,
      modified: r.modified,
      ...(r.is_external ? { isExternal: true } : {}),
      ...(r.encrypted ? { encrypted: true } : {}),
    }));
  } catch (e) {
    console.error('Failed to load video index from SQLite:', e);
    return null;
  }
}

function getVideoIndexEntry(id) {
  try {
    const r = db.prepare('SELECT * FROM video_index WHERE id = ?').get(id);
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      filename: r.filename,
      ext: r.ext,
      rel: r.rel,
      catPath: r.cat_path,
      category: r.category,
      size: r.size,
      sizeF: r.size_f,
      mtime: r.mtime,
      modified: r.modified,
      ...(r.is_external ? { isExternal: true } : {}),
      ...(r.encrypted ? { encrypted: true } : {}),
    };
  } catch (e) {
    console.error('Failed to get video index entry from SQLite:', e);
    return null;
  }
}

function getSingleVideoMeta(id) {
  try {
    const row = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
    if (!row) return null;
    const actors = db.prepare('SELECT actor FROM video_actors WHERE video_id = ?').all(id).map(r => r.actor);
    const tags = db.prepare('SELECT tag FROM video_tags WHERE video_id = ?').all(id).map(r => r.tag);
    return {
      title: row.title || '',
      studio: row.studio || '',
      category: row.category || '',
      rating: row.rating,
      note: row.note || '',
      date: row.date || '',
      language: row.language || '',
      actors,
      tags
    };
  } catch (e) {
    console.error('Failed to get single video meta from SQLite:', e);
    return null;
  }
}

function saveVideoIndex(videos) {
  try {
    txn(() => {
      db.prepare('DELETE FROM video_index').run();
      const insert = db.prepare(
        'INSERT INTO video_index (id, name, filename, ext, rel, cat_path, category, size, size_f, mtime, modified, is_external, encrypted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      for (const v of videos) {
        insert.run(
          v.id, v.name, v.filename || v.name, v.ext || '',
          v.rel, v.catPath || '', v.category || '',
          v.size || 0, v.sizeF || '', v.mtime || 0, v.modified || '',
          v.isExternal ? 1 : 0, v.encrypted ? 1 : 0
        );
      }
    });
  } catch (e) {
    console.error('Failed to save video index to SQLite:', e);
  }
}

function clearVideoIndex() {
  try {
    db.prepare('DELETE FROM video_index').run();
  } catch (e) {
    console.error('Failed to clear video index from SQLite:', e);
  }
}

function loadAllVideoTags() {
  try {
    return db.prepare('SELECT DISTINCT tag FROM video_tags ORDER BY tag').all().map(r => r.tag);
  } catch { return []; }
}

function saveLinksToDb(items) {
  const cats = loadCategories();
  const { wordMatchAny } = require('./helpers-server');

  try {
    const seenUrls = new Set();
    const seenNames = new Set();
    let inserted = 0;
    txn(() => {
      const insertVideo = db.prepare('INSERT OR IGNORE INTO videos (id, title, category) VALUES (?, ?, ?)');
      for (const item of items) {
        if (!item || !item.url) continue;
        const u = item.url;
        const nm = (item.title || '').trim().toLowerCase();
        if (seenUrls.has(u) || (nm && seenNames.has(nm))) continue;
        seenUrls.add(u);
        if (nm) seenNames.add(nm);
        const id = Buffer.from(u).toString('base64url');
        let category = 'Uncategorized';
        for (const cat of cats) {
          if (wordMatchAny(item.title, cat.terms)) {
            category = cat.displayName;
            break;
          }
        }
        insertVideo.run(id, item.title, category);
        inserted++;
      }
    });
    return { ok: true, count: inserted };
  } catch (e) {
    console.error('Failed to save links to SQLite:', e);
    return { error: e.message };
  }
}

module.exports = {
  loadFavs, saveFavs,
  loadHistory, saveHistory,
  loadPrefs, savePrefs, getDefaultWriteRoot, resolveCategoryPhysicalPath,
  loadRatings, saveRatings,
  loadVideoMeta, saveVideoMeta, setVideoMetaFields, deleteVideoMetaEverywhere,
  loadThumbsCache, saveThumbsCache, setThumbCacheEntry,
  loadVaultConfig, saveVaultConfig, loadVaultMeta, saveVaultMeta, setVaultKey,
  loadCollections, saveCollections,
  loadHidden, saveHidden,
  loadWebsites, saveWebsites,
  loadStarredSites, saveStarredSites,
  loadOgThumbCache, saveOgThumbCache,
  loadLinksCache, loadVaultLinks, saveLinksCache, upsertLink, deleteLink,
  loadBooksMeta, saveBooksMeta,
  loadAudioMeta, saveAudioMeta,
  loadActors, saveActors, loadCategories, saveCategories, loadStudios, saveStudios, invalidateDbTypeCache,
  loadEnabledCategories, saveEnabledCategories,
  loadComments, saveComments, clearAllComments,
  loadVisualHashes, setVisualHash, saveVisualHashes,
  loadPrompts, savePrompt, updatePrompt, deletePrompt, deleteAllPrompts, reEncryptVaultSqlite,
  readDbFile, writeDbFile,
  loadVideoIndex, saveVideoIndex, clearVideoIndex, getVideoIndexEntry, getSingleVideoMeta,
  switchProfile, getCurrentProfile: () => currentProfile,
  isDbOnDisk: () => !_dbInMemory,
  closeDb: () => { if (db) { db.close(); db = null; } },
  saveLinksToDb, loadAllVideoTags,
};
