

Instructions for Claude:
When reading this file, execute one command at a time, after the task is completed, move it in done and save this file, if i prompt you "Continue" then execute the next one.
Each command is separated by an empty newline


TO DO


add in setting add the possibilty to password protect the app on startup, this is different from vault since it will not encrypt just hide everything



If no videos are present, show "Import videos" multi file selector for video MIME type only, when at least 1 video is present hide this button

- [ ] **Split server.js** — At 1600+ lines the file is hard to navigate. Extract route groups into separate files: `routes/videos.js`, `routes/vault.js`, `routes/actors.js`, `routes/downloads.js`.


- **Virtual scrolling for large libraries** — Rendering 1000+ cards at once slows the browser; only render cards in the viewport

 Prioritize generating thumbnails for visible cards first, then background-queue the rest


split themes.css inside public/themes in different files.
Themes list now will be built dinamically with only ones present in themes.css, user can add new ones and they will appear

File deletion has no confirmation dialog. 

Add a new filter option in filter bar: All/ Watched / Unwatched, by default is all

Add a new filter option in filter bar: ilter by short/medium/long (e.g., <5min, 5-30min, 30min+)


Show "X results" after filtering so the user knows how many videos matched

Watch videos, books, audio and public/themes folder with `fs.watch` and push a lightweight update event to the frontend so new files appear without a manual refresh


-----------------------------------------------------------------------------


DONE

Cleared pre-populated db/categories.json to {}; removed auto-creation of Straight/Gay/Lesbian/Transgender folders on server startup; apiCategories now always includes Uncategorized sorted first; sidebar shows Uncategorized with the existing + button to create new folder categories

Audio section added: sidebar item, /audio view, card/list toggle, sort (date/name/size), import via file selector (mp3/flac/wav/ogg/aac/m4a/wma/opus/aiff), delete, mini player with HTML5 audio; server routes GET/POST/stream/DELETE /api/audio

Import button (upload icon) added to topbar; /api/import routes files to videos/audio/books by extension; drag-and-drop on whole app shows overlay and imports on drop; public/modules/import.js

"Clear History" button added to section-controls in browse view; shown only when recentMode is active

Watch history setting added to Settings: "Keep history" / "Delete on startup" / "Don't save history"; stored in .AphroArchive-prefs.json; server clears history on listen() when delete-on-startup; skips recording when dont-save; auto-saves on select change; shown only when recentMode is active; calls DELETE /api/history (already existed), clears recentVids, re-renders

Ensure videos/books/audio folders exist on startup — AUDIO_DIR added, all three created with mkdirSync at boot before server starts

Search within actors/studios pages — filter input added to both list views, filters client-side in real-time, cleared on re-open

whitelist.txt → websites.json migration: auto-migrates on first run, loadWhitelist() reads hostnames from websites.json, /api/websites CRUD endpoints, new Search sidebar section showing searchable sites with keyword in URL, opens in new tab

QR code connection to a device on same network — fixed IP detection: now ranks 192.168.x.x over VPN/tunnel ranges, handles Node v18+ numeric family values, shows all available interfaces as switcher buttons in the modal

Keyboard shortcuts — Arrow Left/Right seek ±10s, Arrow Up/Down volume ±10%, Space play/pause, F toggle fav, M mute, N next, P prev; brief toast feedback on seek/volume; skips when focus is in an input or textarea