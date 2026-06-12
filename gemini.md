# GEMINI.md

This file provides guidance to Gemini when working with code in this repository.

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
- `server/config-server.js` — All paths, environment variables, MIME types, binary resolution (`ffmpeg`, `ffprobe`, `yt-dlp`). Import constants from here rather than computing paths elsewhere.
- `server/db-server.js` — Low-level SQLite database manager and in-memory caches. Single source of truth for persistence.
- `server/helpers-server.js` — Shared utilities: `json(res, data)`, `serveStatic`, `toId`/`fromId` (base64url file ID encoding), `readBody`, word-matching helpers.
- `server/videos-server.js` — Video file scanning (recursive, skips `hidden/` and `Z/` dirs), all video API handlers, category derivation from folder structure.
- Feature modules: `actors-server.js`, `vault-server.js`, `thumbnails-server.js`, `collections-server.js`, `downloads-server.js`, `links-server.js`, `books-server.js`, `audio-server.js`, `database-server.js`, `remote-server.js`, `settings-server.js`, `comments-server.js`, `duplicates-server.js`, `feed-watcher-server.js`, `gen-thumbs-server.js`, `imagegen-server.js`, `pages-server.js`, `photos-server.js`, `profiles-server.js`, `prompts-server.js`, `scrapeMethods-server.js`, `vault-zip-server.js`, `vision-server.js`, `assistant-server.js`, `background-worker-server.js`.

**Data storage**: Uses SQLite (`better-sqlite3`) as the primary database, which stores videos, video actors, video tags, websites, categories, favourites, comments, collections, settings, ratings, audio/book metadata, etc. In-memory write-through caches are used for favourites, history, ratings, and actors to reduce database access.

**Video IDs**: Files are identified by `toId(relPath)` — a base64url encoding of the path relative to VIDEOS_DIR (or the absolute path for external folders). Use `fromId(id)` to recover the path.

**Categories**: Derived automatically from folder structure. A video at `videos/CategoryName/file.mp4` gets category `CategoryName`. Nested folders produce `Parent / Child` category names.

**PKG mode**: When packaged as an executable, `IS_PKG` is true. Data files (`videos/`, `audio/`, `cache/`) resolve relative to the executable path; `public/` assets are bundled read-only.

### Frontend (`public/`)

The frontend is currently in a hybrid state, migrating from pure vanilla JS to Preact with TSX.

**Legacy System**:
Pure vanilla JS, no bundler. `index.html` loads module scripts. State is global variables across files.
- `public/modules/state.js` — All global state variables.
- `public/app.js` — Bootstrap and core render loop.
- `public/templates/` — HTML snippet files loaded via fetch.

**Preact System (`public/src/`)**:
Uses Preact and TSX. Components are located in `public/src/components/`.
- `src/main.tsx` mounts components to specific DOM elements.
- `src/store.ts` handles shared state using Preact signals.
- Views like `HomeView.tsx`, `VaultView.tsx`, `InstagramView.tsx`, `RedditView.tsx`, `SettingsView.tsx`, `BrowseView.tsx` etc. are located under `public/src/components/sections/` and loaded dynamically via `MainContent.tsx`.

### External Tool Dependencies

The server shells out to:
- **ffmpeg / ffprobe** — thumbnail generation, video duration extraction. Resolved from project root first, then PATH.
- **yt-dlp** — video downloading. Looked up in `cache/` first, then project root, then PATH.

Binaries can be placed in the project root directory or `cache/` as alternatives to system PATH installation.
