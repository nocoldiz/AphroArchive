# AphroArchive — TODO & Roadmap

## Bookmark Import: Match categories/tags instead of saved websites

- [x] Analyze codebase: understand current bookmark import flow
- [x] Modify `server/links-server.js` `apiBrowserFavs` — filter bookmarks by category names and tag names instead of whitelist
- [x] Modify `server/links-server.js` `apiBrowserFavsFile` — same filter for uploaded bookmark files
- [x] Modify `public/src/components/sections/LinksView.tsx` `importFavs` — frontend filter by categories/tags instead of websites

## Security (Fix First)

- [ ] **Request size limit** — `readBody()` has no payload cap; a large request exhausts memory. Add a max-bytes guard before accumulating chunks.
- [ ] **CORS lockdown** — `Access-Control-Allow-Origin: *` lets any site call the API. Restrict to `localhost` only since this is a local app.
- [ ] **Whitelist domain matching** — `matchesWhitelist()` uses `includes()`, so `evil-example.com` matches a whitelist entry of `example.com`. Switch to exact hostname or `endsWith('.' + entry)` logic.
- [x] **Rate limit vault unlock** — 3 failed attempts trigger a cooldown (implemented in `vault-server.js`).
- [ ] **Actor photo content-type validation** — Downloaded IMDb images are written to disk without checking the Content-Type. Validate that it is a known image type before saving.
- [ ] **Duplicate CORS header** — `Access-Control-Allow-Headers` is set twice; the second write drops `X-Filename`. Remove the duplicate.
- [ ] **IV reuse risk in AES-GCM** — Current key derivation re-uses the same key across sessions. Derive a new encryption key via HKDF on each session to prevent IV collision.
- [ ] **PBKDF2 iterations** — 100,000 rounds is below current NIST guidance (600,000+). Increase and re-derive on next unlock.

## Bugs

- [ ] **Resume playback position** — There is no mechanism to save or restore the playback position when a video is revisited. Add `localStorage` persistence keyed by video ID.
- [ ] **Vault timer race** — `resetVaultTimer()` exits early if `vaultKey` is null, which means the timer is not restarted after it fires. The lock state can become inconsistent.
- [ ] **Thumbnail queue unbounded** — No concurrency cap on ffmpeg thumbnail spawns. Under load this can queue thousands of processes. Add a max-concurrent limit (e.g. 3).
- [ ] **Silently swallowed errors** — ffprobe/ffmpeg failures return `null` with no log entry. At minimum log the error so the user can diagnose missing binaries.
- [ ] **Duplicate temp decryption** — Concurrent requests for the same vault file each trigger a separate decrypt. Lock on the file ID so only the first request decrypts.

## Performance

- [ ] **Suggested videos O(n²)** — `apiVideoDetail` computes similarity by iterating all videos × all actors. Pre-build an inverted index from actor → video IDs.
- [ ] **Streaming scan** — `scan()` loads all paths into one array before returning. For very large libraries switch to an async generator to start serving results sooner.

## Missing Features

- [ ] **Resume playback** — Store `{id: timestamp}` in localStorage; restore on video open.
- [ ] **Batch operations** — Selection works (drag-box + shift-hover via `useVideoSelection.ts`; `openBulkMove` exists); still missing: bulk add-tag, bulk add-actor, bulk delete, bulk add-to-collection.
- [ ] **Watch-time tracking** — Record seconds watched per video; show completion percentage on cards.
- [x] **Subtitle support** — `PlayerView` fetches `/api/subtitles/:id`; `AdvancedPlayer` renders `<track>` elements served from `/api/subtitle-file/:id/:filename`.
- [x] **Export metadata** — `GET /api/db/:type/export` and `POST /api/db/:type/import-json` for actors, studios, categories, websites.
- [ ] **Smart duplicate handling** — When duplicates are detected, offer to keep the highest-resolution file and move the others to trash rather than just flagging.
- [ ] **Search result count** — Show "X results" after filtering so the user knows how many videos matched.
- [ ] **API documentation** — Add an `api.md` or OpenAPI spec describing each endpoint, its parameters, and response shape.
- [ ] **Folder watch / auto-refresh** — Watch VIDEOS_DIR with `fs.watch` and push a lightweight update event to the frontend so new files appear without a manual refresh.
- [x] **Multi-user support** — Full profiles system: each profile has its own SQLite DB; switching resets state without a page reload (`profiles-server.js`, `store.ts:switchProfile`).
- [ ] **Cast / network streaming** — Add a "cast" button that serves the video URL for use with Chromecast or similar via the browser Cast API.
- [x] **Playback speed control** — `AdvancedPlayer.tsx` has a speed select (0.5×–2×); `playbackRate` applied to the `<video>` element.
- [ ] **A/B loop** — Mark a start and end point to repeat a clip segment.
- [x] **Scene timestamps / chapters** — `ChaptersView.tsx` exists, `/chapters` is a registered route, and `Video.chapters` field is in the type and SQLite schema.
- [ ] **Video notes** — Add a private freeform text note to any video, shown on the player page.
- [ ] **Library stats dashboard** — Total size, video count, most-tagged actors, longest video, etc.
- [ ] **Recently watched row** — A horizontal scroll row on the home page showing the last 10–20 videos played.

## UX Improvements

- [ ] **Progress on vault upload** — Show a progress bar when uploading a file to the vault (use `XMLHttpRequest` with `upload.onprogress`).
- [ ] **Toast duration control** — Let toasts persist longer for errors (currently all durations are the same).
- [ ] **Search empty state** — When search input is cleared, reset the results to the default view automatically.
- [ ] **Category breadcrumb clickable** — The breadcrumb showing current category/collection is display-only. Make each segment a navigation link.
- [ ] **Keyboard navigation in grid** — Arrow keys should move focus between video cards; Enter opens the video.
- [ ] **ARIA labels** — Add `aria-label` to icon buttons (star, favourite, play) that have no visible text.
- [ ] **Accessible colour contrast** — Audit `--tx3` and muted text against backgrounds for WCAG AA compliance.
- [ ] **Error messages with guidance** — Replace generic "Failed" toasts with context: "Could not generate thumbnail — ffmpeg not found."
- [ ] **Restore scroll position on back** — Going back from the player should return to the same scroll position in the grid.
- [ ] **Custom thumbnail selection** — Pick which of the generated thumbnails to use as the card image.
- [ ] **Accent color picker** — Let the user change the red accent (`--ac`) to another color from the settings page.
- [ ] **Auto-play countdown** — After a video ends, show a 5-second countdown before playing the next one with a cancel button.
- [ ] **Drag to category** — Drag a video card onto a sidebar category to move it.

## Plugin System

- [ ] **Plugin `contexts` not enforced** — `PluginMeta` has a `contexts` field (e.g. `mosaic` sets `["browse","player","home"]`) but the Topbar never checks it against `currentView`; context-sensitive plugins always appear. Read `currentView` in the Topbar plugin loop and hide buttons when the view isn't in `contexts`.
- [ ] **Sidebar plugin location unimplemented** — The `PluginMeta` interface supports `location: 'sidebar'` but `Sidebar.tsx` does not render any plugins. Implement a plugin section in the sidebar for sidebar-located plugins.

## Orphaned / Unreachable Views

- [ ] **`ScreenshotsView` has no URL route** — `ScreenshotsView` is imported and rendered in `MainContent.tsx` for view `'screenshots'` but `/screenshots` is absent from `router.ts` `directViews`. Add it so the view is deep-linkable.
- [ ] **`ImageGenView.tsx` is unrouted** — `public/src/components/sections/ImageGenView.tsx` exists (backed by `server/imagegen-server.js`) but is never imported in `MainContent.tsx` and has no entry in `router.ts`. Wire it up or remove it if abandoned.

## Code Quality & Refactoring

- [ ] **Standardize error responses** — All API errors should return `{ error: "message" }` JSON with appropriate HTTP status codes, not mixed plain-text/empty responses.
- [ ] **Validate JSON input** — Add a lightweight validator for all POST/PATCH bodies: required fields, type checks, max string lengths.
- [ ] **Consistent async** — Avoid mixing `readFileSync` in async functions. Decide on one I/O style per module.
- [ ] **Structured logging** — Replace `console.log` with a minimal logger that includes timestamp and level, and can be silenced in production.
- [ ] **Graceful shutdown** — Handle `SIGINT`/`SIGTERM` to flush any in-progress downloads and clean up vault temp files before exit.
- [ ] **Input length limits** — Actor names, category names, collection names, and URLs should be capped at reasonable lengths on the server.
- [ ] **Test coverage** — Add at minimum unit tests for `wordMatch`, `matchesWhitelist`, `safePath`, and the vault encrypt/decrypt round-trip.
- [ ] **Config file support** — Allow paths (VIDEOS_DIR, SETTINGS_DIR, port) to be set via a config file or environment variables rather than being hardcoded.
- [ ] **Dead import in MainContent** — `VideoGrid` is imported at the top of `MainContent.tsx` but never used there (it's used by individual view components). Remove the import.

## Vault

- [x] **Vault password change** — `POST /api/vault/change-password` re-encrypts all `.enc` files with the new key.
- [ ] **Vault thumbnail support** — Generate and display thumbnails for encrypted files.
- [ ] **Import from library to vault** — Move existing library videos into the vault directly (currently only supports uploading).
- [ ] **Vault file rename** — Rename encrypted files from within the vault UI without re-uploading.
- [ ] **Vault notes** — Attach a short private note/description to each vault file, stored encrypted alongside the metadata.
- [ ] **Photo slideshow mode** — Auto-advance through vault images with a configurable interval and fullscreen display.
- [x] **Drag-and-drop upload** — `DropOverlay.tsx` (global) detects `vaultMode.value` and routes dropped files to `POST /api/vault/add`; also handles standard import for videos/audio/books/photos.

## Search & Filtering

- [ ] **Multi-filter support** — Combine actor + studio + tag in one search query.
- [ ] **Date range filter** — Filter videos added/modified between two dates.
- [ ] **Duration filter** — Filter by short/medium/long (e.g., <5min, 5-30min, 30min+).
- [ ] **Unwatched filter** — Show only videos not yet in watch history.
- [ ] **Saved searches** — Link a filter/query combo and recall it with one click.
- [ ] **Recent searches** — Dropdown of last 10 search terms when clicking the search bar.
- [ ] **Search within actors/studios pages** — The actor and studio detail pages have no search; hard to find a video when an actor has 100+ entries.

## Library Management

- [x] **Tag management from the UI** — `DatabaseView.tsx` with full CRUD via `POST /api/db/:type/upsert` and `DELETE /api/db/:type/:name` for actors, studios, categories, websites.
- [x] **Folder/category creation** — `POST /api/folders/create` on server; `window.createCategory()` in `store.ts` calls `POST /api/main-categories`.
- [ ] **Content-based duplicate detection** — Hash file contents (not just names) to catch renamed duplicates the current dupe scanner misses.
- [ ] **Batch rename with pattern** — Rename multiple files at once using a template like `{actor} - {title}` with live preview.
- [ ] **Category merge** — Merge two categories into one, moving all files and updating metadata.

## Player — Advanced Controls

- [ ] **Audio track selection** — Let users switch between multiple audio tracks in multi-language MKV/MP4 files via a dropdown in the player toolbar.
- [ ] **Subtitle file management** — Upload `.srt`/`.vtt` subtitle files per video; store them as sidecars; let users switch or disable them from the player.
- [ ] **Subtitle auto-search** — Query OpenSubtitles API by filename hash and offer matched subtitle files for one-click download and attachment.
- [x] **Live captions (CC)** — `AdvancedPlayer.tsx` uses the browser `SpeechRecognition` API to generate live captions from mic input; CC button toggles on/off with overlay display.
- [ ] **Whisper transcription** — Generate subtitles locally via `whisper.cpp` or the OpenAI Whisper API; save result as `.vtt` sidecar linked to the video.
- [x] **Keyboard shortcuts in player** — `AdvancedPlayer.tsx`: Space=play/pause, ←/→=seek ±10s, ↑/↓=volume, M=mute, F=fullscreen, C=CC, N=next, P=prev.
- [ ] **Picture-in-Picture** — Button that calls `videoEl.requestPictureInPicture()` so the player floats while browsing the library.
- [ ] **Theater mode** — Dim everything outside the player; close sidebar and topbar; toggle with keyboard shortcut T.
- [x] **Player screenshot** — `takeScreenshot()` in `PlayerView.tsx` draws the current frame to canvas and `POST /api/screenshots/upload`; "Take Screenshot" button is visible in the action bar.
- [ ] **Clip export** — Select start/end timestamps in the player and export a clip using ffmpeg via `POST /api/clips/export`; progress streamed as SSE.
- [ ] **Volume normalization** — Auto-adjust playback volume using loudness metadata from ffprobe; let users toggle it per-session.
- [ ] **360° / VR video** — Detect equirectangular videos (filename hint or aspect 2:1) and render them in a Three.js sphere with mouse-drag panning.
- [ ] **Video quality selector** — If multiple resolution versions exist for the same title (e.g. 720p + 1080p + 4K), group them and let the user switch quality from the player.
- [ ] **Mini-player** — A compact sticky player bar that appears when navigating away from PlayerView; keeps the video playing with basic controls visible.
- [x] **Chapter jump UI** — `PlayerView.tsx` renders a chapter list in the sidebar; `AdvancedPlayer` shows chapter markers on the seekbar; `jumpToChapter(time)` seeks and plays.
- [ ] **Frame-by-frame stepping** — While paused, advance/rewind one frame at a time (via `requestVideoFrameCallback` or 1/fps seek).

## Player — Queue & Autoplay

- [x] **Smart autoplay queue** — `playerNextUp` signal auto-fills from `filteredVideos`; `onEnded` calls `onNext()`; `PlayerView` shows the Next Up sidebar list.
- [ ] **Shuffle queue** — When shuffle is on, maintain a pre-shuffled queue so "next" and "back" are deterministic within a session.
- [x] **Playlist builder / drag reorder** — Next Up list in `PlayerView` supports drag-and-drop reordering and per-item remove; saving as a collection goes through `AddToCollectionModal`.
- [ ] **"Play all from here"** — Right-click a video card → "Play all from here" enqueues everything after it in the current sorted view.
- [ ] **Up-next overlay** — While the last 30s of a video plays, show a dismissible card previewing the next-up video.
- [ ] **Skip intro / credits** — Store per-video intro-start and credits-start timestamps; show a "Skip Intro" button when the player enters that range.

## Metadata & Scraping

- [ ] **TMDB auto-match** — Parse filenames to extract title + year, query TMDB API, and offer a match to pull synopsis, genre, release date, poster, backdrop, and cast.
- [ ] **IMDB rating display** — Fetch and store IMDB rating + vote count alongside TMDB data; show star badge on cards.
- [ ] **NFO sidecar support** — Read and write Kodi-compatible `.nfo` XML files alongside video files so metadata survives outside the SQLite DB and is portable.
- [ ] **Backdrop / banner images** — Store wide backdrop images from TMDB per title; use them as hero banners on the video detail page and as category backgrounds.
- [ ] **Poster mode** — Card layout variant that shows portrait poster art (from TMDB) instead of the generated thumbnail, giving a Netflix-style grid.
- [ ] **Trailer integration** — Fetch official trailer YouTube URL from TMDB; add "Play Trailer" button on the video detail page (opens in the link iframe player).
- [ ] **Genre tags from TMDB** — When TMDB metadata is fetched, auto-create genre tags (Action, Drama, etc.) on the video so tag filtering works by genre.
- [ ] **Batch TMDB scrape** — "Enrich library" button that queues all unmatched videos for TMDB lookup with a progress bar; respect TMDB rate limits.
- [ ] **Manual metadata override** — Edit title, year, synopsis, genre, and custom poster URL inline on the video detail page without leaving the app.
- [ ] **Language / audio format tags** — Auto-read audio codec and channel count from ffprobe and show badges (DTS, AC3, AAC, Dolby Atmos, 5.1) on the detail page.
- [ ] **Resolution / HDR badges** — Parse video stream metadata (4K, 1080p, HDR10, Dolby Vision) from ffprobe and show as badges on cards and the detail page.
- [ ] **File info panel** — Expandable section on video detail showing container, video codec, audio codec, bitrate, framerate, colour space — sourced from ffprobe.

## TV Shows & Series

- [ ] **Series detection** — Auto-group files matching `Show Name S01E02` or `Show Name - 1x02` patterns into a Series object with seasons and episodes.
- [ ] **Episode progress tracking** — Mark individual episodes as watched; show season completion percentage in the series overview.
- [ ] **"Continue watching" for series** — Remember the last episode watched per series and offer "Resume S02E04" from the series card.
- [ ] **Series view** — Dedicated page with season/episode grid, series metadata (from TMDB TV endpoint), and episode synopsis per row.
- [ ] **Next episode auto-play** — At the end of an episode, auto-queue the next episode of the same series in order.
- [ ] **Missing episodes indicator** — Compare local episodes against TMDB season episode count and highlight gaps.

## Home Page dashboard widgets

Replaced the static home cards with a customizable widget dashboard
(`public/src/home/`): a resizable grid with an Edit mode, drag-to-reorder,
per-widget resize grip, and an "Add widget" picker. Layout persists to
localStorage + appPrefs. Plugins can declare `homeWidget` in meta.json to
appear as widgets (see reddit/instagram). Each item below is a widget.

- [x] **Continue Watching row** — Resumes in-progress videos (localStorage progress tracked in AdvancedPlayer), sorted by most recently paused, with per-card progress bar + remove.
- [x] **New Additions row** — Horizontally scrollable row of the last 20 videos added.
- [x] **Recommended For You** — On-device scoring by shared categories, tags, actors, studios vs. watch history (`home/recommend.ts`).
- [x] **"Surprise Me" button** — Opens a random (unwatched-preferred) video immediately.
- [x] **Pinned shelves** — Pinned Shelf widget: pin any folder, tag, actor, or playlist as a named row; add multiple, reorder in edit mode.
- [x] **Home page editor** — Edit mode toolbar + widget picker to add/remove/reorder/resize sections.
- [x] **Hero banner** — Cycling featured/recent spotlight with backdrop image and play button.
- [x] **Mood / genre browser** — Tag/genre tiles; click to filter the grid (falls back to categories).
- [x] **"What to Watch Tonight"** — Rule-based daily pick factoring watch history + time of day (shorter picks late at night).
- [x] **Recently watched** — Recently Watched widget (up to 20 history entries) with link to the `/recent` view.

## Library Views & Layouts

- [ ] **List view** — Compact table layout with columns: thumbnail, title, duration, size, rating, date added — sortable by clicking headers.
- [ ] **Table view** — Dense spreadsheet-style view with inline editable rating and tag cells.
- [ ] **Banner view** — Wide-card layout using backdrop images (16:9) instead of square thumbnails.
- [ ] **Decade / year browser** — Group videos by release decade or year; useful for movie collections.
- [ ] **Map view** — If country-of-origin metadata is available, show a world map with dots; click a country to filter.
- [ ] **Timeline view** — Visualize watch history on a calendar heatmap (GitHub contribution style) showing days with most viewing activity.
- [ ] **Grid density presets** — Quick buttons for S / M / L / XL card sizes beyond the existing slider.

## Search & Discovery (Expanded)

- [ ] **Full-text search across metadata** — Index title + synopsis + notes + actor names + tags into SQLite FTS5 so a single query matches all fields.
- [ ] **Boolean search syntax** — Support `actor:Jane tag:action -tag:short duration:>30m` query syntax in the search bar.
- [ ] **Resolution filter** — Filter by 4K / 1080p / 720p / SD using the resolution badge data from ffprobe.
- [ ] **Rating filter** — Slider to show only videos with rating ≥ N stars.
- [ ] **Search by file size** — Useful for finding space-hungry files; filter >2GB or <500MB.
- [ ] **Search suggestions / autocomplete** — As the user types, suggest matching titles, actor names, tags, and categories in a dropdown.
- [ ] **Tag cloud view** — Visual tag cloud in the search panel where tag size reflects frequency; click to filter.
- [ ] **"Not watched" filter** — Toggle to show only videos with no history entry; pairs with the Unwatched filter task already listed.
- [ ] **Fuzzy search** — Tolerate typos in search queries using trigram matching (SQLite FTS5 supports this with porter stemmer).

## Streaming & Network

- [ ] **HLS transcoding** — On-the-fly ffmpeg HLS segmentation for formats the browser can't play natively (MKV, HEVC, AV1 on some clients); serve via `GET /api/hls/:id/index.m3u8`.
- [ ] **Hardware-accelerated encode** — Auto-detect NVENC (NVIDIA), QSV (Intel), VAAPI (Linux), or VideoToolbox (macOS) and pass the appropriate ffmpeg flag for transcode jobs.
- [ ] **Adaptive bitrate** — Generate multiple HLS quality levels (360p, 720p, 1080p) so the player switches automatically on slow connections.
- [ ] **DLNA / UPnP server** — Expose the library as a DLNA media server so smart TVs and players on the LAN can browse and play natively without a browser.
- [ ] **Remote access mode** — Reverse proxy setup guide + optional basic-auth header check so the server can be safely exposed on a VPN or with a password.
- [ ] **Chromecast / Cast API** — Implement the Google Cast sender SDK in the player; detect available devices and show a cast button.
- [ ] **AirPlay support** — Use `<video>` `x-webkit-airplay="allow"` attribute and guide users on AirPlay-compatible browsers/devices.
- [ ] **PWA manifest & service worker** — Add `manifest.json` + a service worker so the app can be installed as a PWA on desktop/mobile and caches the shell for offline startup.
- [ ] **WebSocket live updates** — Replace the `/api/ping` poll and manual refresh pattern with a WebSocket channel that pushes `scan_complete`, `download_done`, and `vault_locked` events.
- [ ] **Bandwidth throttle option** — For streaming over slow links, cap output bitrate via ffmpeg `-b:v` in HLS mode.

## AI & Automation

- [ ] **Auto-chapter detection** — Use scene-change detection (`ffmpeg select='gt(scene,0.4)'`) to auto-generate chapter markers; save to the chapters field.
- [ ] **Whisper batch transcription** — Queue all videos for Whisper transcription (local or API); store `.vtt` sidecars; enable full-text subtitle search.
- [ ] **AI auto-tagging from vision** — Send first thumbnail to the vision model; parse response to suggest relevant tags (genre, mood, setting); user confirms before saving.
- [ ] **Smart categorization suggestions** — When adding untagged videos, AI suggests which existing category and tags best fit based on filename + visual content.
- [ ] **"More like this" recommendations** — Button on the detail page that scores the full library by shared actors, tags, studio, duration, and TMDB genre match; shows top 12 results.
- [ ] **Watch pattern analysis** — Analyse history to surface "you tend to watch X on weekends" or "you haven't finished any videos over 2h" insights in the stats dashboard.
- [ ] **Auto-synopsis from filename** — For unmatched videos, use the AI assistant to generate a plausible one-sentence description from the filename and tags.
- [ ] **Download suggestion queue** — AI reviews your links list and watch history and suggests content you haven't downloaded yet that matches your tastes.

## Download & Acquisition (Expanded)

- [ ] **Torrent / magnet support** — Integrate `webtorrent` to download magnet links and `.torrent` files via the download queue; seeds while the file is being watched.
- [ ] **RSS / feed auto-downloader** — Subscribe to RSS/Atom feeds (Nyaa, Showrss, YouTube channel RSS); automatically queue new items matching per-feed filters.
- [ ] **Post-download automation rules** — User-defined rules: "if category matches X, move to folder Y and add tag Z"; run after every download completes.
- [ ] **Browser extension** — Minimal extension that sends the current tab URL to `/api/downloads/add` via the local server; works like a "send to AphroArchive" button.
- [ ] **Download scheduling** — Set time windows for downloads (e.g., 2–6 AM only); pause/resume the queue outside those windows.
- [ ] **Download deduplication** — Before queuing a URL, check if it already exists in the links cache or has already been downloaded; warn the user.
- [ ] **yt-dlp format picker** — Let users choose video quality/format for individual yt-dlp downloads (best, 1080p, 720p, audio-only) instead of always using best.
- [ ] **Batch URL import** — Paste or upload a list of URLs; preview all of them before queuing; tag them all with a single category in one step.
- [ ] **Download history / log** — Persistent log of all completed/failed downloads with timestamp, size, duration, and error message; searchable.
- [ ] **Archive.org integration** — Queue Internet Archive item URLs; `yt-dlp` supports them natively, but add a dedicated search for `archive.org/search` in the link scraper.

## Customization & Themes

- [ ] **Theme builder** — Live editor for the CSS custom properties (`--ac`, `--bg`, `--tx`, `--card`, etc.) with a colour picker; save as named themes.
- [ ] **Custom CSS injection** — Text area in Settings → Appearance where users can paste arbitrary CSS that is injected into `<style>` after the main stylesheet.
- [ ] **Font selector** — Dropdown of system/web-safe fonts to use for the UI; persisted in prefs.
- [ ] **Compact / comfortable / spacious density** — Global density switch that adjusts padding, font size, and card margins app-wide.
- [ ] **Custom sidebar sections** — Let users add a sidebar entry pointing to any category, tag, collection, or actor for one-click navigation; drag to reorder.
- [ ] **Custom keyboard shortcuts** — Settings panel mapping actions (play, favourite, add-to-collection, etc.) to user-chosen key combos stored in prefs.
- [ ] **Icon pack selector** — Swap the default icon set (Feather/Lucide) for an alternative pack (e.g. Material, Phosphor) loaded from a plugin.
- [ ] **Animated backgrounds** — Optional subtle animated gradient or particle background on the home page; toggle in appearance settings.

## Mobile & TV (10-Foot UI)

- [ ] **Responsive breakpoints** — Ensure the grid, sidebar, topbar, and player all reflow cleanly at 480px / 768px / 1024px / 1440px widths.
- [ ] **Touch-friendly player controls** — Larger hit targets, swipe-left/right to seek ±10s, swipe-up/down for volume on mobile.
- [ ] **TV / couch mode** — Toggle a "10-foot UI" that enlarges cards, hides dense controls, and makes the app fully navigable with only arrow keys + Enter/Back.
- [ ] **Fullscreen grid navigation** — In TV mode, the grid becomes the full viewport with D-pad navigation; selected card shows a play/info action bar.
- [ ] **Android TV / Fire TV APK** — Wrap the app in a Capacitor TV build targeting Android TV leanback launcher.
- [ ] **Gamepad support** — Map Xbox/PS controller buttons: A=play, B=back, X=favourite, Y=info, bumpers=seek, triggers=volume, left stick=scroll.
- [ ] **Gesture shortcuts on mobile** — Swipe down on the player to minimise to mini-player; swipe up to fullscreen; pinch to zoom (for photos/vault images).

## Library Health & Maintenance

- [ ] **Library health check** — Scan for: missing thumbnail, zero duration, file no longer on disk, broken path, orphaned DB entries (metadata for deleted files).
- [ ] **File integrity check** — Compute and store MD5/SHA256 hash at import time; periodic re-check flags files that changed unexpectedly (corruption detection).
- [ ] **Storage usage breakdown** — Pie chart in stats dashboard: videos vs. thumbnails vs. vault vs. audio vs. books vs. cache, with per-category size breakdown.
- [ ] **Auto-delete watched** — Optional rule: after a video is watched N times, move it to trash or a designated folder automatically.
- [ ] **Trash / soft delete** — Instead of permanent deletion, move files to a `trash/` folder; show a recoverable trash view; auto-purge after 30 days.
- [ ] **Watched folder auto-import** — Poll configurable "drop folders"; when a new file appears, move it to VIDEOS_DIR, generate thumbnail, and add to DB automatically.
- [ ] **Rename rules engine** — User-defined regex → replacement rules applied to filenames at import or on demand (e.g. strip release group tags `[GROUP]`).
- [ ] **Batch re-encode to H.265** — Select videos and queue an ffmpeg re-encode job to HEVC to save space; show before/after size estimate; preserve metadata.

## Social & Personal Tracking

- [ ] **Watchlist / Plan to Watch** — "Add to Watchlist" button per video; dedicated Watchlist view; differentiate from Favourites which implies already-watched love.
- [ ] **Personal review / journal** — Rich-text note field per video with a date stamp and star rating; exportable as Markdown.
- [ ] **Watch statistics page** — Charts: videos watched per week, total hours by month, top actors/categories, completion rate, average rating given.
- [ ] **Trakt.tv sync** — Import watch history from Trakt; push new watches to Trakt via their API; two-way scrobbling.
- [ ] **Letterboxd watchlist import** — Import the CSV watchlist/diary export from Letterboxd to seed the watchlist and history.
- [ ] **IMDB watchlist import** — Import the CSV export of an IMDB watchlist to pre-populate watch targets.
- [ ] **Mood tags** — User-defined mood labels (relaxing, intense, funny, sad) attachable to videos; filter by mood from the search panel.
- [ ] **Rewatch tracker** — Count and display how many times each video has been watched; sort/filter by rewatch count.
- [ ] **Watch streaks** — Track consecutive days with at least one video watched; show current streak and longest streak in the stats page.

## Integrations & Import/Export

- [ ] **Plex library import** — Read a Plex `Library/Application Support` SQLite DB and import metadata (ratings, watch history, posters) into AphroArchive.
- [ ] **Jellyfin library import** — Parse Jellyfin's NFO files and user data JSON to pre-populate the DB without re-scraping.
- [ ] **Kodi NFO compatibility** — On export/import, write and read `.nfo` XML in the Kodi standard so the library is portable to Kodi and back.
- [ ] **Obsidian vault link** — Export each video as a Markdown note (title, metadata, tags, journal) into a user-specified Obsidian vault folder; live-sync on changes.
- [ ] **Full backup / restore** — One-click export: ZIP of SQLite DB + all sidecars + prefs (no binary files); one-click restore from ZIP on a new machine.
- [ ] **Webhook on events** — POST to a user-configured URL on events: video watched, download complete, vault unlocked; payload is JSON with event type and data.
- [ ] **Zapier / n8n integration** — Document the webhook format so users can build automations (e.g. notify Discord when a download finishes).
- [ ] **OPDS feed** — Expose books as an OPDS catalogue feed so any e-reader app (Moon+ Reader, KOReader) can browse and download directly.

## Privacy & Security (Expanded)

- [ ] **Per-video privacy flag** — Mark individual videos as private; they are hidden from the main grid unless a "show private" toggle is active.
- [ ] **Stealth mode** — A full-library hide mode (beyond panic key) triggered by a keyboard shortcut; replaces all thumbnails with grey boxes and blurs titles until deactivated.
- [ ] **App PIN lock** — Optional PIN required on startup (or after N minutes of inactivity) before the library is accessible; separate from vault password.
- [ ] **HTTPS support** — Generate a self-signed cert (or accept a user-provided cert/key) and optionally run on HTTPS; needed for Cast API and PWA install.
- [ ] **IP allowlist** — Accept connections only from `127.0.0.1` and user-configured IPs/subnets; reject all others with 403 before any route handling.
- [ ] **Audit log** — Append-only log of vault unlock/lock, profile switch, download queue events, and panic activations; viewable in Settings; optionally encrypted.
- [ ] **CSP headers** — Add `Content-Security-Policy` response headers to prevent XSS from injected content in scraped page titles or filenames.

---

> Highest priority: **resume playback**, **multi-filter**, **batch operations**, **restore scroll on back**, **video list caching**