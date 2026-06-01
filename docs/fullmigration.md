# Full SQLite Migration Plan

## Goal

Move every piece of persistent user data into per-profile SQLite databases
(`db/aphroarchive_{profile}.db`). No JSON/text files will be written for
metadata after this migration. Binary assets (thumbnails, encrypted vault
files, actor photos) remain on disk as files; only their *metadata* moves into
SQLite.

---

## Current State — Data Still in JSON/Text Files

| File | Owner module | Content |
|------|-------------|---------|
| `cache/links_cache.json` | links-server | Link items cache |
| `cache/og_thumb_cache.json` | links-server | OG-image URL cache |
| `cache/.AphroArchive-starred-sites.json` | links-server | Starred website URLs |
| `cache/.AphroArchive-thumbcache.json` | db-server | Thumbnail duration/frame cache |
| `cache/.AphroArchive-visual-hashes.json` | duplicates-server | Perceptual hash per video |
| `cache/.AphroArchive-prompts.json` | prompts-server | Saved AI prompts |
| `cache/comments_{id}.json` (per video) | comments-server | AI + user comments |
| `videos/.meta.json` | db-server (legacy) | Video metadata (already migrated to SQLite but file still read on cold start) |
| `books/.meta.json` | db-server | Book file metadata |
| `audio/.meta.json` | db-server | Audio file metadata |
| `db/actors.json` | database-server | Actor reference data |
| `db/categories.json` | database-server | Category reference data (already in SQLite tables) |
| `db/studios.json` | database-server | Studio reference data (already in SQLite tables) |
| `db/websites.json` | database-server | Websites (already in SQLite tables) |
| `cache/.AphroArchive-ratings.json` | db-server (legacy) | Ratings (already migrated, still referenced in migration path) |
| `cache/.AphroArchive-favourites.json` | db-server (legacy) | Favourites (already in SQLite) |
| `cache/.AphroArchive-history.json` | db-server (legacy) | History (already in SQLite) |
| `cache/.AphroArchive-collections.json` | db-server (legacy) | Collections (already in SQLite) |
| `cache/.AphroArchive-prefs.json` | db-server (legacy) | Prefs (already in SQLite settings) |
| `cache/whitelist.txt` | links-server | Browser link domain whitelist |
| `cache/hidden.txt` | settings-server (legacy) | Hidden category terms (already in SQLite settings) |

---

## Already in SQLite (No Change Needed)

- `videos`, `video_actors`, `video_tags` — video metadata
- `favourites`, `history`, `collections`
- `categories`, `category_tags`, `studios`, `websites`, `website_tags`
- `enabled_categories`
- `settings` — holds `prefs`, `hidden_terms`
- `video_index` — filesystem scan cache

---

## New SQLite Tables (added to `ensureSchema()`)

### `actors`
```sql
CREATE TABLE IF NOT EXISTS actors (
  name TEXT PRIMARY KEY,
  date_of_birth TEXT,
  nationality TEXT,
  imdb_page TEXT
);
```

### `links`
```sql
CREATE TABLE IF NOT EXISTS links (
  url TEXT PRIMARY KEY,
  title TEXT,
  category TEXT,
  img TEXT,
  scraped_video_url TEXT,
  embed_url TEXT,
  added_at INTEGER
);
```

### `og_thumbs`
```sql
CREATE TABLE IF NOT EXISTS og_thumbs (
  url TEXT PRIMARY KEY,
  img TEXT,
  ts INTEGER
);
```

### `thumbs_cache`
```sql
CREATE TABLE IF NOT EXISTS thumbs_cache (
  video_id TEXT PRIMARY KEY,
  duration REAL,
  data TEXT   -- JSON blob for extra fields (chapters, frames, etc.)
);
```

### `visual_hashes`
```sql
CREATE TABLE IF NOT EXISTS visual_hashes (
  video_id TEXT PRIMARY KEY,
  hash TEXT
);
```

### `comments`
```sql
CREATE TABLE IF NOT EXISTS comments (
  video_id TEXT PRIMARY KEY,
  data TEXT  -- JSON array of comment objects
);
```

### `prompts`
```sql
CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  text TEXT,
  sites TEXT,         -- JSON array
  created_at INTEGER
);
```

### `books_meta`
```sql
CREATE TABLE IF NOT EXISTS books_meta (
  filename TEXT PRIMARY KEY,
  title TEXT,
  ext TEXT,
  size INTEGER,
  size_f TEXT,
  date INTEGER,
  type TEXT
);
```

### `audio_meta`
```sql
CREATE TABLE IF NOT EXISTS audio_meta (
  filename TEXT PRIMARY KEY,
  title TEXT,
  ext TEXT,
  size INTEGER,
  size_f TEXT,
  date INTEGER
);
```

---

## New / Updated `db-server.js` Functions

| Function | Action |
|----------|--------|
| `loadActors()` | Read from `actors` table instead of `actors.json` |
| `saveActors(raw)` | Write to `actors` table (new) |
| `loadLinksCache()` | Read from `links` table |
| `saveLinksCache(data)` | Write to `links` table |
| `loadOgThumbCache()` | Read from `og_thumbs` table → return Map |
| `saveOgThumbCache(map)` | Write to `og_thumbs` table |
| `loadThumbsCache()` | Read from `thumbs_cache` table |
| `saveThumbsCache(c)` | Write to `thumbs_cache` table |
| `setThumbCacheEntry(id, entry)` | Upsert single row (new, for efficiency) |
| `loadStarredSites()` | Read from `settings` key `starred_sites` |
| `saveStarredSites(urls)` | Write to `settings` key `starred_sites` |
| `loadComments(videoId)` | Read from `comments` table (new) |
| `saveComments(videoId, arr)` | Write to `comments` table (new) |
| `clearAllComments()` | DELETE FROM comments (new) |
| `loadVisualHashes()` | Read from `visual_hashes` table (new) |
| `setVisualHash(id, hash)` | Upsert row in `visual_hashes` (new) |
| `saveVisualHashes(hashes)` | Bulk write `visual_hashes` (new) |
| `loadPrompts()` | Read from `prompts` table (new) |
| `savePrompt(prompt)` | Insert/upsert into `prompts` (new) |
| `updatePrompt(id, fields)` | Update `prompts` row (new) |
| `deletePrompt(id)` | Delete from `prompts` (new) |
| `deleteAllPrompts()` | DELETE FROM prompts (new) |
| `loadBooksMeta()` | Read from `books_meta` table |
| `saveBooksMeta(m)` | Write to `books_meta` table |
| `loadAudioMeta()` | Read from `audio_meta` table |
| `saveAudioMeta(m)` | Write to `audio_meta` table |

---

## Module Changes

### `database-server.js`
- **Actors**: replace `readDbFile(ACTORS_JSON)` / `writeDbFile(ACTORS_JSON, db)` with SQLite `loadActors()` / `saveActors(raw)` from db-server
- Categories, studios, websites: already use SQLite; no change

### `prompts-server.js`
- Remove `loadPrompts()` / `savePrompts()` local functions and `PROMPTS_FILE` import
- Import `loadPrompts`, `savePrompt`, `updatePrompt`, `deletePrompt`, `deleteAllPrompts` from `db-server`

### `comments-server.js`
- Remove `loadCommentFile()` / `saveCommentFile()` and `CACHE_DIR` JSON I/O
- Import `loadComments`, `saveComments`, `clearAllComments` from `db-server`
- `apiClearAllComments`: use `clearAllComments()` instead of scanning filesystem

### `duplicates-server.js`
- Remove `HASHES_FILE` and all `fs.readFileSync`/`fs.writeFileSync` for hashes
- Import `loadVisualHashes`, `setVisualHash`, `saveVisualHashes` from `db-server`

### `videos-server.js`
- Replace all 4 direct `BM_CACHE_FILE` reads with `loadLinksCache()` from db-server

---

## Migration Code (runs once at startup in `db-server.js`)

Each migration block checks if the SQLite table is empty before importing.

| From | To |
|------|----|
| `actors.json` | `actors` table |
| `links_cache.json` | `links` table |
| `og_thumb_cache.json` | `og_thumbs` table |
| `.AphroArchive-thumbcache.json` | `thumbs_cache` table |
| `.AphroArchive-visual-hashes.json` | `visual_hashes` table |
| `.AphroArchive-prompts.json` | `prompts` table |
| `comments_*.json` files | `comments` table (bulk read all files) |
| `videos/.meta.json` | already migrated to `videos` table; stop reading it |
| `books/.meta.json` | `books_meta` table |
| `audio/.meta.json` | `audio_meta` table |
| `.AphroArchive-starred-sites.json` | `settings` key `starred_sites` |
| `.AphroArchive-ratings.json` | already merged into `videos` table |

After migration, the old files are left in place (not deleted automatically)
so the admin can verify and remove them manually. The server will no longer
read or write them after the migration runs.

---

## Files Affected

| File | Change type |
|------|-------------|
| `server/db-server.js` | Major: new tables, new functions, migration blocks |
| `server/database-server.js` | Minor: actors use SQLite |
| `server/prompts-server.js` | Moderate: remove local JSON I/O |
| `server/comments-server.js` | Moderate: remove per-file JSON I/O |
| `server/duplicates-server.js` | Minor: remove JSON file usage |
| `server/videos-server.js` | Minor: remove 4 direct BM_CACHE_FILE reads |

---

## Vault (Out of Scope)

`.vault-config.json` and `.vault-meta.json` use custom AES-256-GCM encryption
applied at the file level. Migrating them to SQLite would require storing the
encrypted blob in a BLOB column or re-encrypting per-row. This is deferred —
the vault system is left as-is in this migration.
