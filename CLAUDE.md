# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

AphroArchive is a **zero-dependency local video organizer** — a Node.js HTTP server with a vanilla JS single-page frontend. No frameworks, no build step, no transpilation. It runs on Node.js and optionally packages to a standalone `.exe` via `@yao-pkg/pkg`.

## Running the App

```bash
node server.js                          # default: ./videos on port 3000
node server.js ~/Movies 8080            # custom folder and port
VIDEOS_DIR=~/Movies PORT=8080 node server.js
```

Start scripts:
- **Windows**: `start.bat`
- **Linux/macOS**: `./start.sh`

Install dependencies (ffmpeg, yt-dlp, geckodriver):
- **Windows**: `install.bat`
- **Linux/macOS**: `./install.sh`

Build Windows standalone executable:
```bash
npm run build:win   # outputs dist/AphroArchive.exe
```

Pre-generate thumbnails in batch (requires ffmpeg):
```bash
node gen-thumbs.js [videos_dir] [--concurrency=N]
```

There are no tests or linting configured.

## Architecture

### Server (`server.js` + `server/`)

The entry point is a plain `http.createServer` router in `server.js` — all routes are matched with `if (p === '/api/...')` or regex patterns. No Express.

Module responsibilities:
- `server/config.js` — All paths, environment variables, MIME types, binary resolution (`ffmpeg`, `ffprobe`, `yt-dlp`). Import constants from here rather than computing paths elsewhere.
- `server/db.js` — All load/save functions for every JSON data file. Single source of truth for persistence. All state lives in flat JSON files under `cache/`.
- `server/helpers.js` — Shared utilities: `json(res, data)`, `serveStatic`, `toId`/`fromId` (base64url file ID encoding), `readBody`, word-matching helpers.
- `server/videos.js` — Video file scanning (recursive, skips `hidden/` and `Z/` dirs), all video API handlers, category derivation from folder structure.
- Feature modules: `actors.js`, `vault.js`, `thumbnails.js`, `collections.js`, `downloads.js`, `bookmarks.js`, `books.js`, `audio.js`, `database.js`, `remote.js`, `settings.js`.

**Data storage**: All persistent data is in flat JSON files under `cache/` (runtime state) and `db/` (curated reference data — actors, categories, studios, websites). The `db/` directory is checked into git; `cache/` is not.

**Video IDs**: Files are identified by `toId(relPath)` — a base64url encoding of the path relative to VIDEOS_DIR. Use `fromId(id)` to recover the path.

**Categories**: Derived automatically from folder structure. A video at `videos/CategoryName/file.mp4` gets category `CategoryName`. Nested folders produce `Parent / Child` category names.

**PKG mode**: When packaged as an executable, `IS_PKG` is true. Data files (`videos/`, `audio/`, `cache/`) resolve relative to the executable path; `public/` assets are bundled read-only.

### Frontend (`public/`)

Pure vanilla JS, no bundler. `index.html` loads `style.css`, `themes.css`, then all module scripts as `<script src="...">` in order. State is global variables across files — not ES modules.

- `public/modules/state.js` — All global state variables (`V`, `cats`, `sort`, `cat`, `q`, view mode flags, etc.).
- `public/app.js` — `init()` bootstrap, data fetch functions (`load()`, `loadC()`), core render loop.
- `public/modules/render.js` — Card rendering and grid updates.
- `public/modules/` — Feature modules: `player.js`, `search-sites.js`, `vault.js`, `collections.js`, `bookmarks.js`, `actors.js`, `studios.js`, `tags.js`, `thumbnails.js`, `mosaic.js`, `zap.js`, `playlist.js`, `navigation.js`, `import.js`, `rename-move.js`, `settings.js`, `database.js`, `duplicates.js`, `data.js`, `utils.js`, `audio.js`, `books.js`.
- `public/templates/` — HTML snippet files loaded via fetch and injected into the DOM.

The SPA has no client-side router — view state is managed by toggling mode flags and re-rendering. Routes like `/bookmarks`, `/vault`, etc. are served as `index.html` by the server.

### External Tool Dependencies

The server shells out to:
- **ffmpeg / ffprobe** — thumbnail generation, video duration extraction. Resolved from project root first, then PATH.
- **yt-dlp** — video downloading. Looked up in `cache/` first, then project root, then PATH.
- **geckodriver + selenium** — optional Firefox-based scraping (Python scripts in `server/scrapeMethods-server.js`).

Binaries can be placed in the project root directory or `cache/` as alternatives to system PATH installation.
