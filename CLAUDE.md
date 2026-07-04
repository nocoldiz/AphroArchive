# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.


Never create commits or use github oother than viewing past commits. never suggest creating commits

## What This Is

AphroArchive is a **local video organizer** — a Node.js HTTP server. The frontend is in transition from a vanilla JS single-page app to a Preact with TSX application. It runs on Node.js and optionally packages to a standalone `.exe` via `@yao-pkg/pkg`.

## Running the App

```bash
node server.js                          # default: ./videos on port 3000
node server.js ~/Movies 8080            # custom folder and port
VIDEOS_DIR=~/Movies PORT=8080 node server.js
```

Start scripts:
- **Windows**: `start.bat`
- **Linux/macOS**: `./start.sh`

Install dependencies (ffmpeg, yt-dlp):
- **Windows**: `install.bat`
- **Linux/macOS**: `./install.sh`

Build Windows standalone executable:
```bash
npm run build:win   # outputs dist/AphroArchive.exe
```

Pre-generate thumbnails in batch: use the **Settings → Thumbnails → Generate All** button in the web UI, or trigger `POST /api/gen-thumbs/start` (SSE progress at `GET /api/gen-thumbs/status`).

There are no tests or linting configured.

## Architecture

### Server (`server.js` + `server/`)

The entry point is a plain `http.createServer` router in `server.js` — all routes are matched with `if (p === '/api/...')` or regex patterns. No Express.

Module responsibilities (files are suffixed with `-server.js`):
- `server/config-server.js` — All paths, environment variables, MIME types, binary resolution (`ffmpeg`, `ffprobe`, `yt-dlp`). Import constants from here rather than computing paths elsewhere. Key exports: `ROOT_DIR`, `IS_PKG`, `DATA_DIR`, `VIDEOS_DIR`, `AUDIO_DIR`, `PORT`, `CACHE_DIR`, `THUMBS_DIR`, `DB_DIR`, `VAULT_DIR`, `PLUGINS_DIR`, `FFMPEG_BIN`, `FFPROBE_BIN`, `YT_DLP_BIN`.
- `server/db-server.js` — SQLite manager using `node:sqlite` DatabaseSync with write-through in-memory caches. Single source of truth for all persistence. See schema below.
- `server/helpers-server.js` — Shared utilities: `json(res, data, status)`, `serveStatic`, `toId`/`fromId` (base64url file ID encoding), `readBody` (JSON parser), `formatBytes`, `formatDuration`, `safePath` (validates against VIDEOS_DIR), `wordMatch`/`wordMatchAny`/`studioMatchAny`/`actorMatches`.
- `server/videos-server.js` — Video file scanning (`cachedScan`, `allVideos`), all video API handlers, category derivation, streaming with range support, per-category AES-256-GCM encryption/decryption, suggested video scoring.
- Feature modules: `actors-server.js`, `vault-server.js`, `thumbnails-server.js`, `collections-server.js`, `downloads-server.js`, `links-server.js`, `books-server.js`, `audio-server.js`, `database-server.js`, `remote-server.js`, `settings-server.js`, `duplicates-server.js`, `feed-watcher-server.js`, `gen-thumbs-server.js`, `imagegen-server.js`, `pages-server.js`, `photos-server.js`, `profiles-server.js`, `prompts-server.js`, `scrapeMethods-server.js`, `vault-zip-server.js`, `vision-server.js`, `assistant-server.js`, `background-worker-server.js`, `plugins-server.js`.

**Data storage**: Uses SQLite (`node:sqlite` DatabaseSync) as the primary database. In-memory write-through caches for favourites, history, ratings, and actors reduce database access.

**Video IDs**: Files are identified by `toId(relPath)` — a base64url encoding of the path relative to VIDEOS_DIR (or the absolute path for external folders). Use `fromId(id)` to recover the path. `safePath(id)` validates the resolved path is inside VIDEOS_DIR or a configured sourceFolder.

**Categories**: Derived automatically from folder structure. A video at `videos/CategoryName/file.mp4` gets category `CategoryName`. Nested folders produce `Parent/Child` category paths. `isCategoryEnabled(catPath, enabledPaths)` controls per-profile folder visibility.

**PKG mode**: When packaged as an executable, `IS_PKG` is true. Data files (`videos/`, `audio/`, `cache/`) resolve relative to the executable path; `public/` assets are bundled read-only.

**Scan cache**: `loadVideoIndex` / `saveVideoIndex` persists the file scan to SQLite (`video_index` table) for fast startup. `invalidateScanCache()` is called after file changes and after downloads complete. `fs.watch` on VIDEOS_DIR triggers invalidation automatically.

### SQLite Schema (`db-server.js`)

**Core video data**:
- `videos` — `id PK, title, studio, category, rating INT, note, date, language`
- `video_actors` — `video_id FK, actor`
- `video_tags` — `video_id FK, tag`
- `video_index` — scan cache: `id PK, name, filename, ext, rel, cat_path, category, size, mtime, modified, is_external, encrypted`

**Reference data**:
- `actors` — `name PK, date_of_birth, nationality, imdb_page`
- `categories` — `name PK, display_name`
- `category_tags` — `category_name FK, tag`
- `studios` — `name PK, website, description`
- `websites` — `name PK, url, search_url, scrape_method, description`
- `website_tags` — `website_name FK, tag`
- `enabled_categories` — `path PK`

**User data**:
- `collections` — `id PK, name, video_ids (JSON array)`
- `favourites` — `video_id PK`
- `history` — `video_id PK, timestamp INT`
- `prompts` — `id PK, text (encrypted if vault), sites (JSON, encrypted if vault), created_at INT`

**Caches**:
- `thumbs_cache` — `video_id PK, duration REAL, data (JSON)`
- `og_thumbs` — `url PK, img, ts INT` (7-day TTL)
- `visual_hashes` — `video_id PK, hash` (for duplicate detection)

**Links / Bookmarks**:
- `links` — `url PK, title, category, img, scraped_video_url, has_video, embed_url, has_embed, added_at, tags (JSON), downloaded INT, local_video_id, fav INT, vault INT`

**Settings**: `settings` — `key PK, value (JSON)`. Key prefs: `chronologyMode`, `disableSearchTracking`, `vaultTimeoutMinutes`, `anthropicApiKey`, `openrouterApiKey`, `openrouterModel`, `networkEnabled`, `sourceFolders`, `feedFolders`, `privateFeedFolders`, `assistantNsfw`, `theme`, `cardSize`, `isMuted`, `thumbBlurMode`, `comfyuiUrl`, `comfyuiWorkflowJson`, `comfyuiPositiveNodeId`, `disabledPlugins`.

### Server Module API Reference

**`videos-server.js`**:
- `GET /api/videos` — filtered/sorted list; query params: `q`, `category`, `fav`, `sort`
- `GET /api/categories` — hierarchy with counts; respects enabled categories and encryption
- `GET /api/video/:id` — detail with suggested videos (actor/category match scoring)
- `GET /api/video/:id/fast` — lightweight index-based detail
- `GET /api/stream/:id` — streaming with range support; decrypts `.enc` files on the fly
- `GET /api/preload` — fast startup data (category video counts from index)
- `POST /api/folders/create|rename|delete|move`
- `DELETE /api/video/:id`, `POST /api/rename/:id`, `POST /api/move/:id`
- `GET /api/fav/:id` — toggle favourite
- `POST /api/history/:id` — add to watch history
- `GET /api/tags/overview` — category/tag aggregates with total duration

**`actors-server.js`**:
- `GET /api/actors` — all actors with video counts and total duration
- `GET /api/actors/:name/videos` — videos for actor (supports `?fav=1`)
- `GET /api/actors/photos` — list with `hasPhoto` boolean
- `POST /api/actors/:name/photo/scrape` — fetch photo from IMDb
- `GET /api/actors/:name/photo/img` — serve actor photo or fallback to first video thumbnail
- `POST /api/actors/scrape-missing` — background-scrape missing actor bios and photos

**`vault-server.js`**:
- File format: `[12B IV][AES-256-GCM ciphertext][16B auth tag]`; key via PBKDF2-SHA512 (100k iterations)
- `POST /api/vault/setup` — initialise vault (password ≥6 chars, optional duress password)
- `POST /api/vault/unlock` / `/lock` — session unlock; 3 failures → cooldown
- `POST /api/vault/change-password` — re-encrypts ALL `.enc` files with new key
- `POST /api/vault/add` — streaming upload + encrypt
- `GET /api/vault/:id` — streaming decrypt with range support
- `DELETE /api/vault/:id` — secure shred (random overwrite then delete)
- Folder CRUD: `POST /api/vault/create-folder|delete-folder|rename-folder|move-folder`
- Text files: `POST /api/vault/create-text-file`, `PUT /api/vault/:id/update-text-file`
- Favourites: `GET /api/vault/favs`, `POST /api/vault/favs/:id/toggle`
- `POST /api/vault/restore-file/:id` / `/restore-to-origin/:id` — move file back to library
- `GET /api/vault/import-drop` — auto-import from VAULT_DROP_DIR (polled every 30s)
- Duress password triggers silent self-destruct (wipes all of VAULT_DIR)
- Auto-lock timer: `prefs.vaultTimeoutMinutes` (default 5 min; 0 = disabled)

**`thumbnails-server.js`**:
- `POST /api/thumbs/gen/:id` — generate 5 thumbnails at 0.1/0.25/0.5/0.75/0.9× duration, 480p
- `GET /api/thumbs/:id/:idx` — serve thumbnail; checks `.jpg.enc` (encrypted), alt sourceFolder cache, then main THUMBS_DIR
- `POST /api/thumbs/:id/chapters/:chapterid` — chapter-specific thumbnail

**`downloads-server.js`**:
- Download queue with statuses: `queued / running / paused / done / error`
- `classifyUrl(url)` routes to yt-dlp (video) or direct HTTP (audio/books/photos/files by extension)
- `POST /api/downloads/add` — `{items:[{url, category, pendingCategory}]}` or `{urls:[...]}`
- `GET /api/downloads/jobs`, `DELETE /api/downloads/:id`, `POST /cancel-all|remove-all`
- `POST /api/downloads/:id/restart|pause|resume`
- `GET|POST /api/downloads/config` — `maxParallelDownloads` (1–10)
- `GET|POST /api/downloads/queue` — import/export `urls.txt` queue file
- After completion: marks the originating link as `downloaded: true` and calls `autoMoveVideo(videoId, pendingCategory)`

**`links-server.js`**:
- `GET /api/og-thumb?url=` — OG image meta with 7-day cache
- `GET /api/links` — paginated link list (`limit`, `page`, `q`)
- `POST /api/links/scrape/start|stop` — background scraper (yt-dlp -j + embed extraction)
- `GET /api/browser-favs?browser=chrome|firefox` — import from browser profile
- `POST /api/browser-favs/file` — file upload import
- `GET /api/scrape?method=...&q=...` — site-specific scraper proxy
- Link CRUD: `/api/links/import`, `/export-json`, `/import-json`, `/move`, `/update-item`, `/delete-item`, `/delete-items`
- Smart thumbnail: tries yt-dlp first, then Edge headless screenshot with banner removal

**`collections-server.js`**:
- `GET /api/collections` — all collections with cover video
- `POST /api/collections/create` — `{name}`
- `DELETE /api/collections/:name`
- `POST /api/collections/:name/add` — `{id}`
- `DELETE /api/collections/:name/:id`
- `GET /api/collections/:name/videos`

**`settings-server.js`**:
- `GET /api/settings/lists` — `hidden`, `categories`, `actors`, `studios` as newline-separated text
- `POST /api/settings/save/:file` — save hidden terms list
- `GET /api/settings/prefs` / `PUT /api/settings/prefs` — read/write prefs (single field or bulk)
- `GET /api/browse-folders?path=` — list subdirectories + drives for folder picker
- `POST /api/browse-folders-native` — Windows native FolderBrowserDialog

**`database-server.js`**:
- `GET /api/db/:type` — `actors | categories | studios | websites`
- `POST /api/db/:type/upsert` — `{name, data, oldName}`
- `DELETE /api/db/:type/:name`
- `GET /api/category-tags?path=`, `PUT /api/category-tags/update`
- `GET /api/db/:type/export`, `POST /api/db/:type/import-json`

**`profiles-server.js`**:
- Each profile has its own SQLite DB in `DB_DIR/<profile>.db`
- Vault profile = superuser that merges reads from public + vault DBs
- `GET /api/profiles`, `POST /api/profiles/switch`, `POST /api/profiles/create`
- `switchProfile(name)` in `db-server.js` reinitialises the database connection

**`plugins-server.js`**:
- Reads `plugins/<id>/meta.json` from `PLUGINS_DIR` (= `plugins/` in project root)
- `GET /api/plugins` → `{plugins: PluginMeta[]}`
- Enabled/disabled state stored in `appPrefs.disabledPlugins` (array of ids in SQLite settings)

### Plugin System

Plugins live in `plugins/<id>/meta.json`. The `PluginMeta` interface:

```ts
{
  id: string;          // directory name
  name: string;
  description?: string;
  location: 'topbar' | 'sidebar' | 'home';
  type: 'view' | 'toggle' | 'widget';
  view?: string;       // currentView value to navigate to (type='view')
  toggleAction?: string; // window[toggleAction]() to call (type='toggle')
  enabledByDefault?: boolean;
  contexts?: string[]; // views where this plugin button should show
  homeWidget?: {       // present → offered on the home dashboard (see below)
    name?: string; w?: number; h?: number;
    minW?: number; minH?: number; maxH?: number; singleton?: boolean;
  };
}
```

Current plugins: `instagram` (view→instagram), `reddit` (view→reddit), `mosaic` (toggle→`toggleMosaic`, contexts=[browse,player,home]), `zapping` (toggle→`toggleZapping`). Plus the home-dashboard widget plugins (`type: 'widget'`, `location: 'home'`): `hero`, `continue-watching`, `new-additions`, `recommended`, `recently-watched`, `tonight`, `surprise`, `mood`, `pinned-shelf`, `quick-links`.

`isPluginEnabled(id)` checks `appPrefs.disabledPlugins`. `runPluginAction(plugin, currentView)` dispatches navigation or calls the toggle function. `togglePlugin(id)` persists the change via `updatePrefs`.

### Home Dashboard (`public/src/home/`)

The home view (`currentView === 'hub'`) is a resizable widget grid (`HomeView` → `Dashboard`), not a fixed card list. **Widgets are plugins.** Each lives in `plugins/<id>/` with a `meta.json` declaring a `homeWidget` block and (optionally) a `widget.tsx` that default-exports `(instance: WidgetInstance) => ComponentChildren`. `home/widgets.tsx` bundles every `plugins/*/widget.tsx` via `import.meta.glob` and merges it with the plugin metadata from `/api/plugins`; view/toggle plugins that declare a `homeWidget` but ship no `widget.tsx` render as a shortcut button. Vite's `server.fs.allow: ['..']` lets the dev server read the plugin folder above its `public/` root.

- `home/dashboardStore.ts` — layout signals + persistence. Layout is an ordered `WidgetInstance[]` (`{ iid, type, w, h, config }`); persisted to both `localStorage` and `appPrefs.homeDashboard` (server settings, allowlisted in `settings-server.js`). `DASH_COLS=4`, `DASH_ROW_H=130`.
- `home/Dashboard.tsx` — the grid, Edit mode (drag-to-reorder, per-widget resize grip that snaps span to the grid, remove) and the "Add widget" picker. Responsive: 4 / 2 / 1 columns by width.
- `home/shared.tsx` — presentational helpers widgets import (`WidgetShell`, `MiniCard`, `Row`, `thumbFor`, `nav`, `openVid`).
- `home/progress.ts` — localStorage playback-progress map powering Continue Watching + AdvancedPlayer auto-resume. `home/recommend.ts` — on-device taste scoring. `home/homeData.ts` — cached `/api/history`.

To add a widget: create `plugins/<id>/meta.json` (+ optional `widget.tsx`). No registry edit needed.

### Frontend (`public/`)

The frontend is currently in a hybrid state, migrating from pure vanilla JS to Preact with TSX.

**Legacy System**:
Pure vanilla JS, no bundler. `index.html` loads module scripts. State is global variables across files.
- `public/modules/state.js` — All global state variables.
- `public/app.js` — Bootstrap and core render loop.
- `public/templates/` — HTML snippet files loaded via fetch.

**Preact System (`public/src/`)**:
Uses Preact and TSX. Components are located in `public/src/components/`.

- `src/main.tsx` — Entry point. Mounts `<Sidebar />` → `#side`, `<Topbar />` → `#topbar-root`, `<MainContent />` → `#main-root`, `<App />` → a new `#preact-root` div appended to body.
- `src/store.ts` — All shared state via Preact signals. Also exposes signals as `window.*` properties (`window.V`, `window.cats`, `window.q`, `window.sort`, `window.cat`, `window.shuf`, `window.vaultMode`, etc.) for legacy JS compatibility.
- `src/router.ts` — `setupRouter()` wires `popstate` and routes the initial URL. `routeToPath(path)` sets `currentView` / `currentVideo` / `currentCategory` etc. from URL. Supported URL paths: `/video/:id`, `/cat/:path`, `/tag/:name`, `/actor/:name`, `/studio/:name`, `/collection/:name`, and direct views: `/vault`, `/collections`, `/settings`, `/actors`, `/studios`, `/links`, `/database`, `/photos`, `/books`, `/audio`, `/thumbnails`, `/categories`, `/chapters`, `/download-queue`, `/prompts`, `/assistant`, `/categorizer`, `/duplicates`, `/browse`, `/instagram`, `/reddit`, `/mosaic`, `/favourites`, `/recent`, `/search`, `/pages`, `/scraper`.
- `src/components/UI/MainContent.tsx` — Renders the active view based on `currentView.value`. Heavy/rarely used views are code-split with `lazy()`: `RedditView`, `InstagramView`, `DatabaseView`, `ActorScraperView`, `AssistantView`, `CategorizerView`, `PromptsView`, `DuplicatesView`. All global modals rendered here: `ContextMenu`, `TagModal`, `ActorModal`, `StudioModal`, `VaultZipModal`, `LinkIframeModal`, `RenameModal`, `MoveModal`, `VisionModal`, `VaultUnlockModal`, `ImportModal`.
- Views in `public/src/components/sections/`. Modals in `public/src/components/modals/`. Shared UI (`VideoGrid`, `Sidebar`, `Topbar`, `Search`, etc.) in `public/src/components/UI/`.

**Key Signals (`src/store.ts`)**:
- `currentView` — active view name string (`'hub'`, `'browse'`, `'player'`, `'vault'`, etc.)
- `currentVideo` — `Video | null` currently playing
- `videos` / `allVideos` — active list / unfiltered list; `allVideos` includes bookmark links as `Video` objects
- `filteredVideos` — computed: applies category, tag, fav, gallery, source, and sort filters to `videos`
- `categories`, `actors`, `studios`, `appPrefs` — loaded from API on startup
- Modal states: `tagModalState`, `actorModalState`, `studioModalState`, `renameModalState`, `moveModalState`, `vaultUnlockModalState`, `linkIframeModalState`, `presetPickerState` — shape `{ visible: boolean, ...payload }`
- `isShuffle`, `shuffleSeed`, `sortMode`, `cardSize`, `isMuted`, `thumbBlurMode` — persisted in `localStorage` and synced to `/api/settings/prefs`
- `activeProfile`, `profiles` — current profile name and list; switching calls `reloadAppData()` which resets all nav state and re-fetches data without a page reload
- `isVaultUnlocked`, `vaultGlobalView` — vault session state

**Adding a new modal**: create a signal in `store.ts` with `{ visible: boolean, ...payload }`, import it in the modal component, render the modal at the bottom of `MainContent.tsx`.

**Adding a new view**: create a component in `sections/`, add a `currentView.value === 'viewname'` branch in `MainContent.tsx`'s `renderView()`, and add `/viewname` to the `directViews` map in `router.ts`.

**Video Loading (`loadVideos` in store.ts)**:
Fetches `/api/videos`, `/api/links/cache`, and `/api/categories` in parallel. Bookmark links (not yet downloaded) are appended as `Video` objects with `isLink: true, isExternal: true`. Already-downloaded links are annotated with `linkUrl` pointing to the original page URL.

**Profiles**:
Multiple profiles via `/api/profiles` and `/api/profiles/switch`. Each profile has its own SQLite DB. Switching resets all navigation state and reloads data without a page reload. Vault-locked profiles trigger `VaultUnlockModal`. The "Vault" profile is a superuser that merges reads from all other profiles + the vault DB.

### Key Architectural Patterns

1. **Write-through caching**: `loadFavs/saveFavs`, `loadHistory/saveHistory`, `loadVideoMeta/saveVideoMeta` keep hot data in memory and flush to SQLite on write.
2. **AES-256-GCM everywhere**: Both per-category video encryption and the vault use `[12B IV][ciphertext][16B auth tag]` format. Key derivation is PBKDF2-SHA512 with 100k iterations. The vault adds a duress password with a separate salt for silent self-destruct.
3. **Legacy/Preact bridge**: Signals are exposed via `Object.defineProperty(window, ...)` so old JS can read/write `window.V`, `window.cat`, etc. Legacy functions like `window.refresh()`, `window.load()`, `window.openVid()` call into the signal-based store. When adding new state, define both the signal AND the `window.*` bridge if it needs to be readable by legacy code.
4. **URL sync suppression**: A `_routeResolving` flag prevents URL sync from overwriting a deep-link URL with `/` while the video list is still loading.
5. **Scan invalidation**: `invalidateScanCache()` in `videos-server.js` clears the `video_index` table. Call it after any file add/remove/move operation. `fs.watch` on VIDEOS_DIR does this automatically for external changes.
6. **Category encryption**: `unlockedCategories` is a `Map<catPath, key>` in `videos-server.js`. `isUnlocked(catPath)` and `getUnlockKey(catPath)` gate encrypted folder access. Unlocking requires the category master password.

### External Tool Dependencies

The server shells out to:
- **ffmpeg / ffprobe** — thumbnail generation, video duration extraction. Resolved from project root first, then PATH.
- **yt-dlp** — video downloading and link metadata scraping. Looked up in `cache/` first, then project root, then PATH.
- **Edge (headless)** — smart link thumbnail screenshots via `EDGE_BIN` from config.

Binaries can be placed in the project root directory or `cache/` as alternatives to system PATH installation.
