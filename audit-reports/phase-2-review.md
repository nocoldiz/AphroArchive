# Phase 2 — Regression review

## Regressions fixed (0)



## Remaining concerns

- No regressions confirmed, so nothing was edited. tsc --noEmit reports 0 errors. All 34 changed server modules load with node -e require(...). server.js passes node --check; it was not required because that would start the server.
- Server and client contracts verified against the server.js routes: PATCH /api/videos/:id/move and /rename take {category} and {newName}; POST /api/db/:type; DELETE /api/vault/files/:id; DELETE /api/download/jobs/:id; GET /api/browse-folders returns {currentPath, parent, dirs, drives}; /api/corrupted[/vault]/scan answers 400 'Already running'. Every class added in the TSX diff (ui-btn variants, ui-tab with .on, ui-input, ui-chip, ui-toolbar, empty-state--sm, modal-overlay.on, modal-dialog/header/body/footer, modal-btn--sm/--danger/--primary, modal-error, collection-option) and every CSS variable added in the diff exists in public/style.css or public/themes.css.
- public/src/zap.ts getRandomVidForZapping: the hoisted `cat.toLowerCase()` now runs even when no folder is selected. It is safe today because currentFolder is signal<string>('') and nothing assigns null to it (window.cat is bridged to that signal). If legacy code ever sets window.cat = null this will throw. `(cat || '')` would harden it. Not changed because it is unverified.
- server/db-server.js deleteVideoMetaEverywhere (now used by apiDelete and the categorizer/purge paths) also removes the id from watch history, visual_hashes, collections and other profiles' DBs. The old apiDelete only dropped meta, favourites and the thumb cache. This is intended for deleted files, but it widens behaviour.
- server/gen-thumbs-server.js: the batch calls genThumbs directly without thumbnails-server's genLock. A grid request for the same id can generate it at the same moment; harmless duplicate work. Batch waiters also sit in the LIFO slot queue behind grid requests, so batch runs may be slow while the grid is active.
- server/videos-server.js apiRenameFolder relabel only migrates ids for VIDEOS_DIR-relative entries. Videos in a category under a source folder (absolute-path ids) still lose meta and favourites on rename. This predates the refactor.
- server/downloads-server.js: failure, cancel and pause now delete the partial direct-download file. Direct downloads never resumed from partial data (no Range use), so nothing is lost.

Reviewer tsc errors: 0

## Change counts per area

- fix:fe-sections-p-z: 41 changes, 7 left unfixed
- fix:fe-core: 35 changes, 10 left unfixed
- fix:fe-shared-ui: 28 changes, 7 left unfixed
- fix:fe-modals: 37 changes, 8 left unfixed
- fix:server-core: 24 changes, 7 left unfixed
- fix:fe-sections-a-l: 43 changes, 11 left unfixed
- fix:server-features: 29 changes, 9 left unfixed
