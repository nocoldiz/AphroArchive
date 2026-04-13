# AphroArchive — TODO & Roadmap

## Security (Fix First)

- [ ] **Request size limit** — `readBody()` has no payload cap; a large request exhausts memory. Add a max-bytes guard before accumulating chunks.
- [ ] **CORS lockdown** — `Access-Control-Allow-Origin: *` lets any site call the API. Restrict to `localhost` only since this is a local app.
- [ ] **Whitelist domain matching** — `matchesWhitelist()` uses `includes()`, so `evil-example.com` matches a whitelist entry of `example.com`. Switch to exact hostname or `endsWith('.' + entry)` logic.
- [ ] **Vault temp file security** — Decrypted files land in the world-readable system tmpdir and persist for up to 5 minutes. Use a private subdirectory with restricted permissions and wipe securely (overwrite then delete) on cleanup.
- [ ] **Rate limit vault unlock** — No attempt throttle exists. Add a per-IP lockout after N failed PIN/password tries.
- [ ] **Actor photo content-type validation** — Downloaded IMDb images are written to disk without checking the Content-Type. Validate that it is a known image type before saving.
- [ ] **Duplicate CORS header** — `Access-Control-Allow-Headers` is set twice; the second write drops `X-Filename`. Remove the duplicate.
- [ ] **IV reuse risk in AES-GCM** — Current key derivation re-uses the same key across sessions. Derive a new encryption key via HKDF on each session to prevent IV collision.
- [ ] **PBKDF2 iterations** — 100,000 rounds is below current NIST guidance (600,000+). Increase and re-derive on next unlock.

## Bugs

- [ ] **Resume playback position** — There is no mechanism to save or restore the playback position when a video is revisited. Add `localStorage` persistence keyed by video ID.
- [ ] **Vault timer race** — `resetVaultTimer()` exits early if `vaultKey` is null, which means the timer is not restarted after it fires. The lock state can become inconsistent.
- [ ] **Thumbnail queue unbounded** — No concurrency cap on ffmpeg thumbnail spawns. Under load this can queue thousands of processes. Add a max-concurrent limit (e.g. 3).
- [ ] **allVideos() called per request** — The full filesystem scan runs on nearly every API call with no cache. Results should be cached and invalidated only on file-system events or explicit refresh.
- [ ] **Regex compiled per match** — `wordMatch()` compiles a new `RegExp` on every invocation. Pre-compile and cache regexes keyed by term.
- [ ] **Silently swallowed errors** — ffprobe/ffmpeg failures return `null` with no log entry. At minimum log the error so the user can diagnose missing binaries.
- [ ] **loadActors / loadFavs called repeatedly** — These read from disk on every endpoint. Load once at startup and refresh only on writes.
- [ ] **Duplicate temp decryption** — Concurrent requests for the same vault file each trigger a separate decrypt. Lock on the file ID so only the first request decrypts.

## Performance

- [ ] **Video list caching** — Cache the result of `allVideos()` in memory and invalidate via `fs.watch` on VIDEOS_DIR. This is the single biggest performance win.
- [ ] **Metadata in-memory cache** — Actors, studios, categories, favourites, and history are all read from disk per request. Load at startup, write-through on mutations.
- [ ] **Suggested videos O(n²)** — `apiVideoDetail` computes similarity by iterating all videos × all actors. Pre-build an inverted index from actor → video IDs.
- [ ] **Streaming scan** — `scan()` loads all paths into one array before returning. For very large libraries switch to an async generator to start serving results sooner.

## Missing Features

- [ ] **Resume playback** — Store `{id: timestamp}` in localStorage; restore on video open.
- [ ] **Batch operations** — Select multiple videos and apply actions (add tag, add actor, move to collection, delete) in one step.
- [ ] **Watch-time tracking** — Record seconds watched per video; show completion percentage on cards.
- [ ] **Subtitle support** — Auto-detect `.srt`/`.vtt` files beside the video and load them as text tracks in the `<video>` element.
- [ ] **Export metadata** — Allow exporting all ratings, actors, and categories as JSON or CSV for backup/import.
- [ ] **Smart duplicate handling** — When duplicates are detected, offer to keep the highest-resolution file and move the others to trash rather than just flagging.
- [ ] **Search result count** — Show "X results" after filtering so the user knows how many videos matched.
- [ ] **Mobile layout** — Sidebar collapses and video cards reflow on screens narrower than 768 px. The fixed 220 px sidebar currently breaks on phones.
- [ ] **API documentation** — Add an `api.md` or OpenAPI spec describing each endpoint, its parameters, and response shape.
- [ ] **Folder watch / auto-refresh** — Watch VIDEOS_DIR with `fs.watch` and push a lightweight update event to the frontend so new files appear without a manual refresh.
- [ ] **Multi-user support** — Separate history, ratings, and favourites per named profile stored as separate JSON files.
- [ ] **Cast / network streaming** — Add a "cast" button that serves the video URL for use with Chromecast or similar via the browser Cast API.
- [ ] **Playback speed control** — Persistent speed setting (0.5×–2×) that remembers preference across videos.
- [ ] **A/B loop** — Mark a start and end point to repeat a clip segment.
- [ ] **Scene timestamps / chapters** — Mark named timestamps in a video (e.g., "intro at 0:30") stored in a sidecar JSON.
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

## Code Quality & Refactoring

- [ ] **Split server.js** — At 1600+ lines the file is hard to navigate. Extract route groups into separate files: `routes/videos.js`, `routes/vault.js`, `routes/actors.js`, `routes/downloads.js`.
- [ ] **Standardize error responses** — All API errors should return `{ error: "message" }` JSON with appropriate HTTP status codes, not mixed plain-text/empty responses.
- [ ] **Validate JSON input** — Add a lightweight validator for all POST/PATCH bodies: required fields, type checks, max string lengths.
- [ ] **Consistent async** — Avoid mixing `readFileSync` in async functions. Decide on one I/O style per module.
- [ ] **Remove hardcoded category init** — `server.js` auto-creates `Straight/Gay/Lesbian/Transgender` subdirectories on startup. This should be opt-in or configurable.
- [ ] **Structured logging** — Replace `console.log` with a minimal logger that includes timestamp and level, and can be silenced in production.
- [ ] **Graceful shutdown** — Handle `SIGINT`/`SIGTERM` to flush any in-progress downloads and clean up vault temp files before exit.
- [ ] **Input length limits** — Actor names, category names, collection names, and URLs should be capped at reasonable lengths on the server.
- [ ] **Test coverage** — Add at minimum unit tests for `wordMatch`, `matchesWhitelist`, `safePath`, and the vault encrypt/decrypt round-trip.
- [ ] **Config file support** — Allow paths (VIDEOS_DIR, SETTINGS_DIR, port) to be set via a config file or environment variables rather than being hardcoded.

## Vault

- [ ] **Vault password change** — Currently there's no way to change the vault password without deleting everything.
- [ ] **Vault thumbnail support** — Generate and display thumbnails for encrypted files.
- [ ] **Import from library to vault** — Move existing library videos into the vault directly (currently only supports uploading).
- [ ] **Vault file rename** — Rename encrypted files from within the vault UI without re-uploading.
- [ ] **Vault notes** — Attach a short private note/description to each vault file, stored encrypted alongside the metadata.
- [ ] **Photo slideshow mode** — Auto-advance through vault images with a configurable interval and fullscreen display.
- [ ] **Drag-and-drop upload** — Drop files directly onto the vault grid instead of using the file picker.

## Search & Filtering

- [ ] **Multi-filter support** — Combine actor + studio + tag in one search query.
- [ ] **Date range filter** — Filter videos added/modified between two dates.
- [ ] **Duration filter** — Filter by short/medium/long (e.g., <5min, 5-30min, 30min+).
- [ ] **Unwatched filter** — Show only videos not yet in watch history.
- [ ] **Saved searches** — Bookmark a filter/query combo and recall it with one click.
- [ ] **Recent searches** — Dropdown of last 10 search terms when clicking the search bar.
- [ ] **Search within actors/studios pages** — The actor and studio detail pages have no search; hard to find a video when an actor has 100+ entries.

## Library Management

- [ ] **Tag management from the UI** — Edit actors, studios, categories directly from a settings panel instead of editing files manually.
- [ ] **Folder/category creation** — Create new category folders from within the app.
- [ ] **Content-based duplicate detection** — Hash file contents (not just names) to catch renamed duplicates the current dupe scanner misses.
- [ ] **Batch rename with pattern** — Rename multiple files at once using a template like `{actor} - {title}` with live preview.
- [ ] **Category merge** — Merge two categories into one, moving all files and updating metadata.

---

> Highest priority: **resume playback**, **multi-filter**, **batch operations**, **restore scroll on back**, **video list caching**
