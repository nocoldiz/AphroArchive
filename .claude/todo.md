# AphroArchive — TODO & Roadmap



## Bookmark Import: Match folders/tags instead of saved websites

- [x] Analyze codebase: understand current bookmark import flow
- [x] Modify `server/links-server.js` `apiBrowserFavs` — filter bookmarks by category names and tag names instead of whitelist
- [x] Modify `server/links-server.js` `apiBrowserFavsFile` — same filter for uploaded bookmark files
- [x] Modify `public/src/components/sections/LinksView.tsx` `importFavs` — frontend filter by folders/tags instead of websites

## Security (Fix First)

- [x] **Request size limit** — `readBody()` now rejects payloads over 10 MB (destroys socket, resolves `{}`).
- [x] **CORS lockdown** — `Access-Control-Allow-Origin` now allows only `localhost`/`127.0.0.1` and browser extension origins. Adds `Vary: Origin`.
- [x] **Whitelist domain matching** — Old `matchesWhitelist()` replaced by `matchesCategoryOrTag()` (not a security gate). No action needed.
- [x] **Rate limit vault unlock** — 3 failed attempts trigger a cooldown (implemented in `vault-server.js`).
- [x] **Actor photo content-type validation** — `httpsGetStream` now validates `Content-Type` against `ALLOWED_IMAGE_TYPES` before writing to disk.
- [x] **Duplicate CORS header** — Only one `Access-Control-Allow-Headers` exists in `server.js`; no duplicate found.
- [ ] **IV reuse risk in AES-GCM** — IVs are random 12 bytes per file; birthday collision requires ~2^48 ops. HKDF session keys would add defence-in-depth but need a format migration. Deferred.
- [x] **PBKDF2 iterations** — New vaults and password changes now use 600k rounds. Existing vaults read `cfg.iterations` (fallback: 100k). Upgrade via Settings → Vault → Change Password.

## Bugs

- [x] **Resume playback position** — Already implemented: `home/progress.ts` + `AdvancedPlayer.tsx` `startTimeRef` reads saved progress on load.
- [x] **Vault timer race** — `resetVaultTimer()` now clears any stale timer before the `!vaultKey` guard, preventing orphaned timers when the auto-lock fires mid-async.
- [x] **Thumbnail queue unbounded** — `thumbnails-server.js` now has a `MAX_CONCURRENT_GENS = 3` semaphore (`_acquireGenSlot` / `_releaseGenSlot`) wrapping all `genThumbs` calls.
- [x] **Silently swallowed errors** — `ffprobeInfo` and `genThumbs` in `thumbnails-server.js` and the batch worker in `gen-thumbs-server.js` now log `console.warn` on ffprobe/ffmpeg failure.

## Performance

- [x] **Suggested videos O(n²)** — Both `apiVideoDetail` and `apiVideoDetailFast` now build an actor → videoId inverted index from the bulk-loaded meta map. Only candidate videos (shared actors + same category) are scored, eliminating per-video SQLite reads.

## Missing Features

- [x] **Resume playback** — Store `{id: timestamp}` in localStorage; restore on video open. (`home/progress.ts` + `AdvancedPlayer.tsx` startTimeRef)
- [x] **Batch operations** — `VideoSelBar` now has Tag / Actor / Playlist inline panels in addition to Delete, Move, Encrypt, Download.
- [x] **Watch-time tracking** — Completion progress bar shown on card thumbnails via `home/progress.ts`.
- [x] **Subtitle support** — `PlayerView` fetches `/api/subtitles/:id`; `AdvancedPlayer` renders `<track>` elements served from `/api/subtitle-file/:id/:filename`.
- [x] **Export metadata** — `GET /api/db/:type/export` and `POST /api/db/:type/import-json` for actors, studios, folders, websites.
- [x] **Smart duplicate handling** — Each group has a "Keep Best & Delete Rest" button; best = highest resolution (w×h), then largest size, then fav, then named category. `★ keep` badge shown on the chosen file; resolution shown in metadata row.
- [x] **Search result count** — "X videos" count shown above the grid in `VideoGrid`.
- [x] **Folder watch / auto-refresh** — `videos-server.js` broadcasts `scan_changed` SSE on cache invalidation; `store.ts` reconnects and calls `loadVideos()` with a 1.5 s debounce.
- [x] **Multi-user support** — Full profiles system: each profile has its own SQLite DB; switching resets state without a page reload (`profiles-server.js`, `store.ts:switchProfile`).
- [ ] **Cast / network streaming** — Add a "cast" button that serves the video URL for use with Chromecast or similar via the browser Cast API.
- [x] **Playback speed control** — `AdvancedPlayer.tsx` has a speed select (0.5×–2×); `playbackRate` applied to the `<video>` element.
- [x] **A/B loop** — A/B buttons in `AdvancedPlayer` controls; green/red markers on seekbar; loops back to A when playhead hits B.
- [x] **Scene timestamps / chapters** — `ChaptersView.tsx` exists, `/chapters` is a registered route, and `Video.chapters` field is in the type and SQLite schema.
- [x] **Video notes** — Freeform textarea in `PlayerView` below Tags row; auto-saves on blur via `PATCH /api/videos/:id/meta`.

## UX Improvements

- [x] **Toast duration control** — `toast()` now takes `{ type, duration }`; error toasts persist 5s with a red style. `window.toastError` helper added (`toast.ts`).
- [x] **Search empty state** — `Search.tsx` snapshots view/category/tag on first keystroke and restores it when the box is cleared.
- [x] **Category breadcrumb clickable** — `BrowseView.tsx` `<Breadcrumb>` renders each path segment as a navigable link ("All Videos / Parent / Child").
- [x] **Keyboard navigation in grid** — Cards are focusable (`tabIndex`); arrow keys move focus (column count derived from row layout); Enter/Space opens (`VideoGrid.tsx`).
- [x] **ARIA labels** — `aria-label`/`aria-pressed` added to card play/fav/queue/menu/link buttons and topbar sidebar toggles.
- [x] **Error messages with guidance** — `loadVideos`/`deleteVideo` now use `toastError` with actionable context (server down, file locked).
- [x] **Restore scroll position on back** — `store.ts` remembers `window.scrollY` per browse/hub/fav/recent key and restores on return (e.g. from the player).
- [x] **Custom thumbnail selection** — `thumbPref.ts` stores a per-video preferred thumb index; PlayerView shows a 5-thumb picker; `VideoCard` honours it.
- [x] **Drag to category** — Already implemented: `VideoCard` is `draggable`; sidebar folder items accept the drop and call `/api/videos/:id/move`.
- [x] **Shift+click range select** — `VideoGrid` tracks `lastClickedIndex`; Shift+click selects the range, Ctrl/Cmd+click toggles one, plain click toggles while in select mode.
- [x] **Select all / deselect all** — "Select all" button added to `VideoSelBar` and the grid context menu; Escape clears selection.
- [x] **Inline quick-actions on card hover** — Cards now show play, fav and add-to-queue icon buttons on hover.
- [x] **Right-click context menu on grid background** — Empty grid space opens a `grid` context menu: Refresh library, Select all, Create folder here.
- [x] **Double-click to fullscreen** — `AdvancedPlayer` video element toggles fullscreen on `dblclick`.
- [x] **Seek on arrow-key hold** — Held arrow keys ramp the seek step (×2 after 1s, ×4 after 2s); reset on keyup.
- [x] **Volume memory per video** — `AdvancedPlayer` persists `vol:<id>` and restores it per video (falls back to the global level).
- [x] **Media Session API** — `AdvancedPlayer` sets `navigator.mediaSession` metadata (title, artwork) and play/pause/seek/next/prev handlers + playbackState.
- [x] **Sidebar collapse to icon rail** — Topbar `.rail-toggle` collapses the sidebar to a 60px icon rail (`sidebarCollapsed` signal + `body.sidebar-rail` CSS); desktop-only.
- [x] **Pinned folders & tags in sidebar** — Context-menu "Pin folder/tag to top"; pins render at the top of the Folders/Tags lists, persisted in prefs (`pinnedFolders`, `pinnedTags`).
- [ ] **Loading skeleton cards** — While `loadVideos` is in flight, render animated placeholder cards matching the current card size instead of a blank grid.
- [ ] **Scroll-to-top button** — Floating button appears after scrolling down >400px in the grid; smooth-scrolls back to top; hidden otherwise.
- [ ] **Sticky sort/count header** — The "X videos · Sort" bar in `SectionControls` stays pinned below the topbar when the grid scrolls so the count is always visible.
- [ ] **"New" badge on cards** — Small pill overlay on video cards added within the last 7 days, derived from the `date` field in the index; disappears on hover to show the thumbnail.
- [ ] **Rating stars on card** — If a video has a rating set, show filled star icons as a small overlay at the bottom of the thumbnail (matches the detail-page rating display).
- [ ] **Unplayed dot indicator** — Subtle coloured dot on cards not yet in watch history; disappears after first play; toggle in appearance prefs.
- [ ] **Duration badge on thumbnail** — Small pill (e.g. `1:23:04`) in the bottom-right corner of every card thumbnail, sourced from `thumbs_cache` duration; styled consistently with streaming service conventions.
- [ ] **Sidebar section collapse** — Folders, Tags, Actors, and Collections groups in the sidebar have a chevron toggle; collapsed state persisted per profile in `appPrefs`.

## Plugin System

- [x] **Plugin `contexts` not enforced** — `PluginMeta` has a `contexts` field (e.g. `mosaic` sets `["browse","player","home"]`) but the Topbar never checks it against `currentView`; context-sensitive plugins always appear. Read `currentView` in the Topbar plugin loop and hide buttons when the view isn't in `contexts`.
- [x] **Sidebar plugin location unimplemented** — The `PluginMeta` interface supports `location: 'sidebar'` but `Sidebar.tsx` does not render any plugins. Implement a plugin section in the sidebar for sidebar-located plugins.

## Files View (`FilesView.tsx` / `server/files-server.js`)

New untracked files — scope to be defined. Suggested features:

- [ ] **Wire up route** — Add `/files` to `router.ts` `directViews` and import `FilesView` in `MainContent.tsx` so it is reachable.
- [ ] **Directory tree browser** — Left-panel tree showing the VIDEOS_DIR folder hierarchy; click to expand/collapse; selected folder filters the right-panel file list.
- [ ] **File list with metadata columns** — Right panel table: filename, size, modified date, duration, encrypted flag; sortable by any column.
- [ ] **Bulk file operations** — Select multiple files → Move to folder, Delete, Encrypt/Decrypt, Add to vault; reuses `VideoSelBar` pattern.
- [ ] **Inline rename** — Double-click a filename in the list to enter edit mode; commits on Enter/blur via `POST /api/rename/:id`.
- [ ] **Drag files between folders** — Drag rows onto tree nodes to move files; calls `POST /api/move/:id`.
- [ ] **File type filter bar** — Tabs or pills to show All / Videos / Audio / Books / Photos; filters the list by MIME category.

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
- [ ] **Search suggestions / autocomplete** — As the user types, suggest matching titles, actor names, tags, and folders in a dropdown.
- [ ] **Full-text search across metadata** — Index title + notes + actor names + tags into SQLite FTS5 so a single query matches all fields simultaneously.
- [ ] **Boolean search syntax** — Support `actor:Jane tag:action -tag:short duration:>30m` query syntax in the search bar.
- [ ] **Rating filter** — Slider or star buttons to show only videos with rating ≥ N stars.
- [ ] **Fuzzy search** — Tolerate typos using SQLite FTS5 porter stemmer; surface near-matches alongside exact ones.
- [ ] **Active filter chips** — Show applied filters (tag, actor, duration range, etc.) as removable chip pills above the grid; clicking × on a chip removes that filter.
- [ ] **Sort persistence per folder** — Remember the last-used sort mode per category path, not just globally; restore it when navigating back to the same folder.

## Library Management

- [x] **Tag management from the UI** — `DatabaseView.tsx` with full CRUD via `POST /api/db/:type/upsert` and `DELETE /api/db/:type/:name` for actors, studios, folders, websites.
- [x] **Folder/category creation** — `POST /api/folders/create` on server; `window.createCategory()` in `store.ts` calls `POST /api/main-folders`.
- [ ] **Content-based duplicate detection** — Hash file contents (not just names) to catch renamed duplicates the current dupe scanner misses.
- [ ] **Batch rename with pattern** — Rename multiple files at once using a template like `{actor} - {title}` with live preview.
- [ ] **Category merge** — Merge two folders into one, moving all files and updating metadata.
- [ ] **Trash / soft delete** — Instead of permanent deletion, move files to a `trash/` folder; show a recoverable trash view; auto-purge after 30 days.
- [ ] **Watched folder auto-import** — Poll configurable "drop folders"; when a new file appears, move it to VIDEOS_DIR, generate thumbnail, and add to DB automatically.
- [ ] **Library health check** — Scan for: missing thumbnail, zero duration, file no longer on disk, orphaned DB entries for deleted files. Show a report with fix buttons.
- [ ] **Rename rules engine** — User-defined regex → replacement rules applied to filenames at import or on demand (e.g. strip release group tags `[GROUP]`).

## Video Tools (ffmpeg)

- [ ] **Video joiner modal** — When 2+ videos are selected, a "Join" button appears in the multi-select action bar. Opens a modal with:
  - Drag-to-reorder list of the selected videos (title + thumbnail)
  - Target folder picker (browse-folders dropdown)
  - Output filename field (pre-filled from the first video's name)
  - Toggle: delete originals after join / keep originals
  - On confirm: `POST /api/videos/join` streams the ffmpeg concat job; SSE progress bar in the modal. Merged file inherits the union of all source videos' tags, actors, and studio; category = target folder.
- [ ] **Clip export** — In the player, set start/end timestamps with bracket markers on the seekbar; "Export Clip" sends `POST /api/clips/export`; ffmpeg trims the file; SSE progress shown inline.
- [ ] **A/B loop** — Two loop-point buttons (A and B) in the player toolbar; holding the section between them repeats indefinitely until cancelled.
- [ ] **Auto-chapter detection** — ffmpeg scene-change filter (`select='gt(scene,0.4)'`) generates candidate chapter timestamps; user reviews and confirms in the Chapters editor before saving.
- [ ] **Batch re-encode to H.265** — Multi-select videos → "Re-encode" action; server queues ffmpeg HEVC jobs one at a time; shows before/after size estimate; preserves all metadata; optionally replaces the original.
- [ ] **Video info panel** — Expandable section on the video detail page showing container, video codec, resolution, framerate, audio codec, bitrate, colour space — fetched from ffprobe on first open and cached.
- [ ] **Resolution / codec badges on cards** — Show `4K`, `1080p`, `HEVC`, `AV1` etc. as small overlaid badges on video cards, sourced from the ffprobe cache.
- [ ] **Volume normalization** — One-click loudness normalization per video using ffprobe loudness scan + `dynaudnorm` filter; applies at playback time without re-encoding.

## Player — Advanced Controls

- [x] **Keyboard shortcuts in player** — `AdvancedPlayer.tsx`: Space=play/pause, ←/→=seek ±10s, ↑/↓=volume, M=mute, F=fullscreen, C=CC, N=next, P=prev.
- [x] **Live captions (CC)** — `AdvancedPlayer.tsx` uses the browser `SpeechRecognition` API to generate live captions from mic input; CC button toggles on/off with overlay display.
- [x] **Player screenshot** — `takeScreenshot()` in `PlayerView.tsx` draws the current frame to canvas and `POST /api/screenshots/upload`; "Take Screenshot" button is visible in the action bar.
- [x] **Chapter jump UI** — `PlayerView.tsx` renders a chapter list in the sidebar; `AdvancedPlayer` shows chapter markers on the seekbar; `jumpToChapter(time)` seeks and plays.
- [ ] **Seekbar scrubber preview** — On hover over the seekbar, show the nearest stored thumbnail (from the 5 existing thumbs) in a small floating preview above the cursor, matching YouTube/Netflix behavior.
- [ ] **Playerbar auto-hide** — Controls fade out after 3 s of inactivity; reappear on any mousemove/keypress/touch; always visible when paused or in the first 2 s.
- [ ] **Animated chapter tick crossings** — Chapter markers on the seekbar briefly pulse when the playhead crosses them as a visual cue.
- [x] **Subtitle file management** — Upload `.srt`/`.vtt` files per video from the player; list loaded subtitles; switch between tracks or disable; stored as sidecars.
- [ ] **Subtitle auto-search** — Query OpenSubtitles by filename hash and offer matched files for one-click download and attachment.
- [x] **Audio track selection** — Switch between multiple audio tracks in multi-language MKV/MP4 files via a player toolbar dropdown.
- [ ] **Picture-in-Picture** — "PiP" button calls `videoEl.requestPictureInPicture()` so the player floats while browsing the library.
- [ ] **Theater mode** — Dim everything outside the player; hide sidebar and topbar; toggle with keyboard shortcut T.
- [ ] **Mini-player** — Compact sticky player bar that keeps playback going when navigating away from PlayerView; click to return to full player.
- [ ] **Frame-by-frame stepping** — While paused, step one frame forward/backward via `requestVideoFrameCallback` or 1/fps seek; bound to , and . keys.
- [ ] **Skip intro / credits** — Per-video intro-end and credits-start timestamps stored in chapters; show a "Skip" button automatically when playback enters that range.
- [ ] **360° / VR video** — Detect equirectangular videos (2:1 aspect or `_360` filename hint) and render in a Three.js sphere with mouse/gyro panning.

## Player — Queue & Autoplay

- [x] **Smart autoplay queue** — `playerNextUp` signal auto-fills from `filteredVideos`; `onEnded` calls `onNext()`; `PlayerView` shows the Next Up sidebar list.
- [x] **Playlist builder / drag reorder** — Next Up list in `PlayerView` supports drag-and-drop reordering and per-item remove; saving as a collection goes through `AddToCollectionModal`.
- [x] **Shuffle queue** — When shuffle is on, maintain a pre-shuffled order per session so "next" and "back" are deterministic; re-roll only when shuffle is toggled.

## Metadata & Scraping

- [ ] **TMDB auto-match** — Parse filenames to extract title + year, query TMDB API, and offer a match to pull synopsis, genre, release date, poster, backdrop, and cast.
- [ ] **IMDB rating display** — Fetch and store IMDB rating + vote count alongside TMDB data; show star badge on cards.
- [ ] **NFO sidecar support** — Read and write Kodi-compatible `.nfo` XML files alongside video files so metadata survives outside the SQLite DB and is portable.
- [ ] **Backdrop / banner images** — Store wide backdrop images from TMDB per title; use them as hero banners on the video detail page and as category backgrounds.
- [ ] **Poster mode** — Card layout variant that shows portrait poster art (from TMDB) instead of the generated thumbnail.
- [ ] **Trailer integration** — Fetch official trailer YouTube URL from TMDB; "Play Trailer" button on the detail page (opens in the link iframe player).
- [ ] **Genre tags from TMDB** — When TMDB metadata is fetched, auto-create genre tags (Action, Drama, etc.) so tag filtering works by genre.
- [ ] **Batch TMDB scrape** — "Enrich library" button that queues all unmatched videos for TMDB lookup with a progress bar; respects rate limits.
- [ ] **Manual metadata override** — Edit title, year, synopsis, genre, and custom poster URL inline on the video detail page without leaving the app.
- [ ] **Language / audio format tags** — Auto-read audio codec and channel count from ffprobe; show badges (DTS, AC3, AAC, Atmos, 5.1) on the detail page.

## TV Shows & Series

- [ ] **Series detection** — Auto-group files matching `Show Name S01E02` or `Show Name - 1x02` patterns into a Series object with seasons and episodes.
- [ ] **Episode progress tracking** — Mark individual episodes as watched; show season completion percentage in the series overview.
- [ ] **"Continue watching" for series** — Remember the last episode watched per series and offer "Resume S02E04" from the series card.
- [ ] **Series view** — Dedicated page with season/episode grid, series metadata (from TMDB TV endpoint), and episode synopsis per row.
- [ ] **Next episode auto-play** — At the end of an episode, auto-queue the next episode of the same series in order.
- [ ] **Missing episodes indicator** — Compare local episodes against TMDB season episode count and highlight gaps.

## Home Page Dashboard Widgets

Replaced the static home cards with a customizable widget dashboard
(`public/src/home/`): a resizable grid with an Edit mode, drag-to-reorder,
per-widget resize grip, and an "Add widget" picker. Layout persists to
localStorage + appPrefs. Plugins can declare `homeWidget` in meta.json to
appear as widgets (see reddit/instagram). Each item below is a widget.

- [x] **Continue Watching row** — Resumes in-progress videos (localStorage progress tracked in AdvancedPlayer), sorted by most recently paused, with per-card progress bar + remove.
- [x] **New Additions row** — Horizontally scrollable row of the last 20 videos added.
- [x] **Recommended For You** — On-device scoring by shared folders, tags, actors, studios vs. watch history (`home/recommend.ts`).
- [x] **"Surprise Me" button** — Opens a random (unwatched-preferred) video immediately.
- [x] **Pinned shelves** — Pinned Shelf widget: pin any folder, tag, actor, or playlist as a named row; add multiple, reorder in edit mode.
- [x] **Home page editor** — Edit mode toolbar + widget picker to add/remove/reorder/resize sections.
- [x] **Hero banner** — Cycling featured/recent spotlight with backdrop image and play button.
- [x] **Mood / genre browser** — Tag/genre tiles; click to filter the grid (falls back to folders).
- [x] **Recently watched** — Recently Watched widget (up to 20 history entries) with link to the `/recent` view.
- [ ] **Library stats widget** — Card showing total video count, combined duration, total disk size, and watched % (history count ÷ total); all derived from the in-memory caches, no extra queries.
- [ ] **Calendar heatmap widget** — GitHub-style contribution grid (52 weeks × 7 days) coloured by watch-history density per day; hover shows date + count; links to `/recent` filtered to that day.
- [ ] **Top actors widget** — Horizontally scrollable row of the most-watched actors with photo (from `actors/photos/`) and watch count; click navigates to actor detail.
- [ ] **Active downloads widget** — Live mini-list of running download jobs (title, progress bar, speed); powered by SSE from `/api/downloads/jobs`; collapses when queue is empty.

## Library Views & Layouts

- [x] **List view** — Compact table layout with columns: thumbnail, title, duration, size, rating, date added. Toggle in SectionControls; persisted to localStorage.
- [x] **Decade / year browser** — Group videos by year or decade via SectionControls dropdown; renders labelled sections with video counts; works in both grid and list modes.
- [ ] **Filmstrip mode** — A single wide horizontal-scroll row of all current-filter videos (fixed card height ~180px); useful on ultrawide screens as a quick-scan layout alongside the detail panel.
- [ ] **Folder mosaic cards** — A "Folders" landing page showing each top-level folder as a large card with a 4-thumbnail mosaic collage and video count; navigating into it opens the normal grid.
- [ ] **Masonry / variable-height grid** — Option to render portrait-aspect thumbnails (e.g. poster art) taller than landscape ones using CSS `grid-row: span N`; enabled when Poster mode is active.
- [ ] **Calendar view** — Monthly calendar grid where each day cell lists video thumbnails added or watched on that date; prev/next month navigation; toggle in SectionControls.

## Streaming & Network

- [x] **HLS transcoding** — `GET /api/hls/:id/index.m3u8` + `GET /api/hls/:id/seg:N.ts` in `server/hls-server.js`; per-segment ffmpeg transcode; HLS toggle button in AdvancedPlayer loads hls.js from `/hls.js`.
- [ ] **Hardware-accelerated encode** — Auto-detect NVENC (NVIDIA), QSV (Intel), VAAPI (Linux), VideoToolbox (macOS) and pass the right ffmpeg flag for HLS transcode jobs.
- [ ] **Adaptive bitrate** — Generate multiple HLS quality levels (360p, 720p, 1080p) so the player switches automatically on slow connections.
- [ ] **DLNA / UPnP server** — Expose the library as a DLNA media server so smart TVs and players on the LAN can browse and play natively without a browser.
- [ ] **Remote access mode** — Reverse proxy setup guide + optional basic-auth header check for safe VPN/password-protected access.
- [ ] **Chromecast / Cast API** — Implement the Google Cast sender SDK in the player; detect available devices and show a cast button.
- [ ] **AirPlay support** — Add `x-webkit-airplay="allow"` to the `<video>` element; guide users on AirPlay-compatible browsers/devices.
- [ ] **PWA manifest & service worker** — `manifest.json` + service worker so the app installs as a PWA on desktop/mobile and caches the shell for offline startup.
- [ ] **WebSocket live updates** — Replace the `/api/ping` poll with a WebSocket channel that pushes `scan_complete`, `download_done`, and `vault_locked` events to all tabs.

## Download & Acquisition (Expanded)

- [ ] **Torrent / magnet support** — Integrate `webtorrent` to download magnet links and `.torrent` files via the download queue; seeds while the file is being watched.
- [ ] **Download deduplication** — Before queuing a URL, check if it already exists in the links cache or was previously downloaded; warn the user.
- [ ] **Estimated disk space warning** — Before queuing large downloads, estimate the final file size from yt-dlp metadata and warn if less than X GB free.

## Customization & Themes

- [ ] **Theme builder** — Live editor for CSS custom properties (`--ac`, `--bg`, `--tx`, `--card`) with colour pickers; save as named themes alongside the built-in ones.
- [ ] **Custom CSS injection** — Textarea in Settings → Appearance; injected into `<style>` after the main stylesheet so users can override anything.
- [ ] **Font selector** — Dropdown of system/web-safe fonts; persisted in prefs and applied via `font-family` on `:root`.
- [ ] **Compact / comfortable / spacious density** — Global density switch that adjusts `--gap`, `--pad`, font size, and card margins app-wide.
- [ ] **Custom sidebar sections** — Users can add a sidebar entry pointing to any category, tag, collection, or actor for one-click navigation; drag to reorder.
- [ ] **Custom keyboard shortcuts** — Settings panel mapping actions (play, favourite, add-to-collection, open-player) to user-chosen key combos stored in prefs.
- [ ] **Animated backgrounds** — Optional subtle animated gradient or particle effect on the home page; toggle in appearance settings.
- [ ] **Card metadata density toggle** — Three presets (Title Only / Title + Duration / Full: title + duration + actors + tags) that control which metadata fields appear below the thumbnail; persisted in `appPrefs`.
- [ ] **Card label position** — Toggle between title below the thumbnail vs. a gradient overlay at the bottom of the image; the overlay variant saves vertical space and looks cinematic.

## Animations & Transitions

- [ ] **View fade transition** — 150 ms `opacity` fade on `#main-root` when `currentView` changes; implemented as a CSS class toggled around the signal update.
- [ ] **Grid card entrance animation** — Cards fade + translate-up with a short staggered delay (total ≤ 250 ms) on initial grid render or after a filter change; disabled when `prefers-reduced-motion` is set.
- [ ] **Modal backdrop blur** — `backdrop-filter: blur(6px)` on modal overlays instead of a flat dim; consistent across `ContextMenu`, `TagModal`, `VaultUnlockModal`, and all other modals.
- [ ] **Sidebar link hover underline slide** — CSS `transform: scaleX()` animated underline on sidebar nav items (starts from left on hover, retracts on leave).
- [ ] **Topbar search expand animation** — Search bar smoothly expands to full width with a width transition when focused; collapses back on blur if empty.
- [ ] **Toast slide-in** — Toasts slide in from the bottom-right with a spring ease; slide out on dismiss; currently appear instantly.
- [ ] **Progress bar fill animation** — Watch-progress bars on card thumbnails animate to their stored value on mount instead of appearing at the final width instantly.
- [ ] **Scroll-triggered section headers** — When grouped by year/decade, section header labels fade in as they enter the viewport (IntersectionObserver).

## Mobile & TV (10-Foot UI)

- [ ] **Responsive breakpoints** — Grid, sidebar, topbar, and player reflow cleanly at 480px / 768px / 1024px / 1440px.
- [ ] **Touch-friendly player controls** — Larger hit targets; swipe left/right on the video to seek ±10s; swipe up/down for volume.
- [ ] **TV / couch mode** — Toggle a "10-foot UI" that enlarges cards, hides dense controls, and makes the app fully navigable with only arrow keys + Enter/Back.
- [ ] **Gamepad support** — Map Xbox/PS controller buttons: A=play, B=back, X=favourite, Y=info, bumpers=seek, triggers=volume, left stick=scroll.
- [ ] **Gesture shortcuts on mobile** — Swipe down on the player to minimise to mini-player; swipe up to fullscreen; pinch to zoom (photos/vault images).

## Social & Personal Tracking

- [ ] **Watchlist / Plan to Watch** — "Add to Watchlist" button per video; dedicated Watchlist view; differentiated from Favourites which implies already-watched love.
- [ ] **Personal review / journal** — Freetext note field per video with a date stamp and star rating; exportable as Markdown; different from the quick `note` DB field.
- [ ] **Trakt.tv sync** — Import watch history from Trakt; push new watches to Trakt via their API; two-way scrobbling.
- [ ] **Letterboxd watchlist import** — Import the CSV watchlist/diary export from Letterboxd to seed the watchlist and history.
- [ ] **IMDB watchlist import** — Import the CSV export of an IMDB watchlist to pre-populate watch targets.
- [ ] **Mood tags** — User-defined mood labels (relaxing, intense, funny, sad) attachable to videos; filter by mood from the search panel.
- [ ] **Rewatch tracker** — Count and display how many times each video has been watched; sort/filter the grid by rewatch count.

## Integrations & Import/Export

- [ ] **Plex library import** — Read a Plex SQLite DB and import metadata (ratings, watch history, posters) into AphroArchive.
- [ ] **Jellyfin library import** — Parse Jellyfin's NFO files and user data JSON to pre-populate the DB without re-scraping.
- [ ] **Kodi NFO compatibility** — Write and read `.nfo` XML in the Kodi standard on export/import so the library is portable to/from Kodi.
- [ ] **Full backup / restore** — One-click export: ZIP of SQLite DB + all sidecars + prefs (no binary video files); one-click restore from ZIP on a new machine.
- [ ] **Webhook on events** — POST to a user-configured URL on: video watched, download complete, vault unlock; JSON payload with event type and data.
- [ ] **OPDS feed** — Expose books as an OPDS catalogue feed so any e-reader app (Moon+ Reader, KOReader) can browse and download directly.

## Privacy & Security (Expanded)

- [ ] **Per-video privacy flag** — Mark individual videos as private; they are hidden from the main grid unless a "show private" toggle is active.
- [ ] **Stealth mode** — Full-library hide triggered by a keyboard shortcut; replaces all thumbnails with grey boxes and blurs titles until deactivated.
- [ ] **App PIN lock** — Optional PIN required on startup (or after N minutes of inactivity) before the library is accessible; separate from vault password.
- [ ] **HTTPS support** — Accept a user-provided cert/key pair and optionally run on HTTPS; needed for Cast API, PWA install on mobile, and AirPlay.
- [ ] **IP allowlist** — Accept connections only from `127.0.0.1` and user-configured subnets; reject all others with 403 before any route handling.
- [ ] **Audit log** — Append-only log of vault unlock/lock, profile switch, download events, and panic activations; viewable in Settings; optionally encrypted.
- [ ] **CSP headers** — Add `Content-Security-Policy` response headers to prevent XSS from injected content in scraped page titles or filenames.

---

> Highest priority: **video joiner**, **resume playback**, **multi-filter**, **batch operations**, **restore scroll on back**
