# Rework status

Last updated: 2026-10-19. Work is **paused** at the user's request. Pick up from "Next steps".

## Done

### 1. Categorizer rework (Sep 30 2026)
- **Two modes** in `CategorizerView.tsx`:
  - **Auto-categorize:** videos in the media root go into the best (deepest) matching folder. Unrecognised videos stay in the root.
  - **Recategorize:** re-sorts all videos, or only the chosen main folders. A video moves only when another folder clearly matches better.
- **Uncategorized videos now show** in the left panel. Before, the panel returned `[]` when no folder was picked.
- **Matching engine** (`server/categorizer-server.js`):
  - category tags are matched to folders loosely ("Science Fiction" ↔ "Sci-Fi");
  - a tag can list its own alternates as `Alien | UFO`;
  - built-in synonyms ("xmas" ↔ "christmas"), plus plural, inflection and UK/US-spelling insensitivity;
  - several matching keywords add up, and a tag shared by several categories counts for less;
  - how the library is already filed makes a tag more or less trusted, and video tags are learned;
  - a first-letter pre-filter speeds things up (5,000 videos × 250 folders ≈ 1.3 s).

### 2. App-wide audit (Oct 19 2026, multi-agent workflow)
- **Shared UI classes** added to `public/style.css`: `ui-btn` (`--primary`/`--danger`/`--ghost`/`--sm`/`--icon`), `ui-input`, `ui-label`, `ui-toolbar`, `ui-title`, `ui-chip`, `ui-badge`, `ui-tabs`/`ui-tab`, `empty-state`, and the `modal-overlay on` + `modal-dialog`/`-header`/`-body`/`-footer` shell. Missing tokens (`--accent`, `--border`, `--bg1`, …) were aliased, and `--danger` was added. The full guide is at the top of `audit-reports/phase-1-audit.md`.
- **237 changes** (138 bug, 45 performance, 42 UI, 12 refactor) across server core, server features, frontend core, shared UI, views A–L, views P–Z and modals. 59 issues were found and deliberately left unfixed; each is listed with its reason in `audit-reports/phase-1-audit.md`.
- **Regression review** found no regressions. tsc reports 0 errors and all changed server modules load. Reviewer concerns: `audit-reports/phase-2-review.md`.
- **Reports and diff snapshots:** `audit-reports/phase-*.md` and `.patch`. Each patch is the full `git diff` at that point, including earlier uncommitted work.

### 3. Link an existing installation (Oct 19 2026)
- **First run:** the onboarding welcome screen has "Load an existing installation…". It opens a folder picker; the chosen folder must contain a `db` folder with `.db` files, and the app shows the database and media it found.
- **Settings → Storage → Installation:** link an installation folder (Browse…), and unlink it.
- **How it works:**
  - `server/config-server.js`: `APP_DIR` (the exe's folder) and `APP_PATHS_FILE` (`paths.json` there). Its `installDir` key sets `DATA_DIR`, so db, cache, media, feeds, screenshots and models all resolve inside the linked folder, and that folder's own `paths.json` overrides apply.
  - `server/install-server.js`: `GET /api/install`, `GET /api/install/check?path=`, `POST /api/install/link`, `POST /api/install/unlink`.
  - **Restart:** link and unlink restart the server. `gracefulShutdown(…, relaunch)` in `server.js` frees the port, then `relaunchSelf()` starts the same exe or script with `APHRO_NO_BROWSER=1` (Electron uses `app.relaunch`). The page polls `/api/install` and reloads.
  - Frontend: `public/src/install.ts`.
- **Tested end-to-end with the packaged exe, in isolated scratch folders:** first run → link → automatic restart onto the linked db and media → the link survives a plain restart → unlink → back to the app's own data, with the linked folder untouched.

### 4. Build and copy (Oct 19 2026)
- Built `dist/AphroArchive.exe` (Windows) and `dist/AphroArchive-linux`.
- **Launch check:** the packaged exe started from an isolated folder with no server errors.
  - All 34 routes were loaded in headless Edge with a CDP script (`audit-reports/routes-check.mjs`; run as `node audit-reports/routes-check.mjs http://localhost:<port>`): no JS exceptions, no failed API calls.
  - The only 404 is the first request for a thumbnail that doesn't exist yet; the thumbnail is then generated on demand.
- **Copied** both binaries to `D:\AphroArchive` (verified identical). The previous binaries are kept there as `AphroArchive.exe.prev-2026-09-30` and `AphroArchive-linux.prev-2026-07-06`. Nothing else on D: was touched.

### 5. Original-data recognition (StashDB) + mass rename (Oct 19 2026)
- `server/identify-server.js` identifies videos the way Stash does. It fingerprints each file and looks it up on a stash-box server with `findScenesBySceneFingerprints`, sending the `ApiKey` header and batches of 40.
  - Fingerprints are oshash, phash (25 frames at 160px → 5×5 sprite → goimagehash PerceptionHash) and optionally MD5.
  - Both hashes were checked against the real Go libraries (goimagehash, imaging, Stash's oshash) on two test videos: identical output.
- Results go in the new `stash_ids` table (`db-server.js`: `loadStashIds`/`setStashId`/`moveStashId`). Fingerprints are cached by size and mtime, and an entry follows its video through rename and move.
- Prefs: `stashboxEndpoint` (default `https://stashdb.org/graphql`), `stashboxApiKey`, `stashboxUseMd5`.
- Routes: `POST /api/identify/start` (`{force, ids}`), `/stop`, `GET /api/identify/poll`, `GET /api/identify/results`, `POST /api/identify/apply` (`{items:[{id,newName,sceneId,applyMeta}]}`).
- `videos-server.js`: the core of `apiRename` became `renameVideo(id, newName)` so the rename modal reuses it. It renames sidecars and moves favourites, meta and the stash id.
- UI:
  - Sync panel row "Scrape original data", with Start/Stop and **Rename…**.
  - `modals/OriginalNamesModal.tsx`: stash-box settings, name template, a candidate picker per video, editable new names, conflict check, and optionally saving studio, performers and date.
- Tested on an isolated server against a mock stash-box: identify → match → rename + metadata. **Not yet tested against real StashDB** (needs the user's API key), and the modal has not been checked visually in a browser.

### 5. Zapping fix + build (Oct 19 2026)
- Zapping could not be reproduced as fully broken in isolated tests (fresh build and the previous D: exe, started from home/browse/folder/player, with real mouse clicks).
- Fixed real gaps: `ZapView` now passes `hlsSrc` and honours `streamUrl` like PlayerView, so non-native formats get the HLS fallback. `zap.ts` null-guards `currentFolder`, and the preload uses `streamUrl`.
- Found but not fixed: HLS transcode of a synthetic wmv2 file fails in **both** players ("Parsed buffers not in DTS sequence").
- Copied `AphroArchive.exe` to `D:\AphroArchive`; the previous one is `AphroArchive.exe.prev-2026-10-19`. Linux binary not rebuilt.
- Follow-up from the user: the zap pool now follows the sidebar/topbar folder and tag selection.
  - An `effect` in `zap.ts` watches `currentFolder`/`currentTag`/`currentTagTerms`. While zapping, it keeps `currentView` on `player`, sets `zapFilteredPool` from `filteredVideos` and switches immediately.
  - `toggleZapping` also starts from the current selection.
  - Tested with folder clicks. Tag clicks use the same path but weren't tested.
  - Rebuilt and copied to `D:\AphroArchive\AphroArchive.exe` (verified identical).
- **Zap showed no picture (sound only).** Root cause: `.view-fade` (the wrapper around every view in `MainContent.tsx`) animated with `forwards`, which left `transform: translateY(0)` applied permanently.
  - Any transform makes the element the containing block for `position: fixed` descendants. `.zap-immersive` (and any other full-screen overlay inside a view) collapsed to the wrapper's 0px height.
  - Fix in `public/style.css`: `viewFadeIn` is now opacity-only without `forwards`. `modalIn` also dropped `forwards` and ends at `transform: none`.
  - Verified by screenshot: the video is 1271×808.
  - Routes check: no errors, same as the previous build.
  - Rebuilt to `dist/`. **Not yet copied**: the user's `D:\AphroArchive\AphroArchive.exe` was running and locked.

## Baseline facts
- `npx tsc --noEmit -p tsconfig.json` → 0 errors before and after.
- `npx vitest run --config vitest.config.js` → 5 failures in `tests/vault-server.test.cjs`. These were already failing before the rework (setup/unlock return undefined), and a cause hasn't been looked for yet.

## Next steps (not started)
1. **Fast startup:** show videos as soon as the first batch is available, instead of waiting for the full scan/list. Look at `loadVideos` in `public/src/store.ts`, `/api/preload`, paged `/api/videos`, and `cachedScan`/`video_index` in `server/videos-server.js`.
2. **Very long videos:**
   - stream efficiently: range responses with bounded chunk sizes, no full reads, HLS/segment offsets (`server/hls-server.js`);
   - encrypted-video seek: AES-GCM currently decrypts from byte 0 and needs a chunked format plus migration;
   - see `memory/project_public_backlog.md`.
3. **Remove dead code app-wide:** unused routes, exports, files, components, CSS, and legacy `public/modules` leftovers. Verify each removal against every reference first.
4. **Runtime check of every view:** run from an isolated copy in the scratchpad, with its own db, a generated test media folder (including a 2-hour video) and a junction to `node_modules`. Drive headless Edge (`EDGE_BIN`) over CDP through every route and collect console errors and failed API calls.
5. **Small follow-ups from the reviewer:**
   - `apiRenameFolder` loses meta/favourites for absolute-path ids under source folders. This was already the case before the rework.
   - `gen-thumbs-server` batch bypasses `genLock`, so the same thumbnail can be generated twice.
6. Write `audit-reports/phase-N-*.md` + `.patch` at the end of every phase.

## Rules from the user for this work
- **Never overwrite the user's DB or data.** Dev mode uses the real `db/` (see `memory/project_shared_dev_db.md`), so run runtime tests from an isolated copy.
- **Copying to `D:\AphroArchive`:** copy only the built binaries (`AphroArchive.exe`, `AphroArchive-linux`). Never touch `db/`, `cache/`, media, vault or feed folders there.
- No commits.
