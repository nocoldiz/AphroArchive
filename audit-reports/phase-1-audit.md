# Phase 1 — App-wide audit & fix

## ui-conventions

## UI unification guide (style.css / themes.css)

**Edited:** `c:\github\AphroArchive\public\style.css` and `c:\github\AphroArchive\public\themes.css`.

- The edits only add to the CSS: new tokens, new selectors added to existing rules, and one new block at the end of style.css.
- Line endings are byte-checked against HEAD: CRLF is kept, and the bytes differ only where I changed something. `git diff --stat` reports the whole of style.css as changed. That comes from `core.autocrlf=true`, not from the content: `--ignore-cr-at-eol` shows +256/−7.
- Braces are balanced in both files. No TSX was edited.

### Bugs fixed (checked against the code)
1. **Missing tokens.** Components used tokens that were never defined: `--accent`, `--border`, `--text`, `--text-muted`, `--tx1`, `--bg1`, `--acc`, `--err`. I added them to `:root` as aliases of the theme tokens. Examples of what was broken:
   - The BooksView reader is a full-screen panel with `background: var(--bg1)`, so it was see-through.
   - LinksView, FolderTree and VideoGrid used `--accent` and `--border`, so those colours and borders didn't show.
   - `.actor-link` uses `--acc`; `.premium-input` uses `--border` and `--accent`; several rules use `--tx1`.
   - I also added a new `--danger: #e5484d` token.
2. **`.modal` and `.modal-content` had no CSS at all.** Six screens use `<div class="modal on"><div class="modal-content">`: the PlayerView note and encrypt dialogs, the 4 ContextMenu dialogs, the VideoGrid encrypt dialog, and VisionModal. They drew inline in the page flow with no background. They are now a fixed overlay (z-index 10000) with a styled panel. The light theme also gets the lighter overlay.
3. **Classes used by components but never styled:**
   - `.modal-btn--danger` (Settings and Rss "Remove" buttons)
   - `.btn` (Actors and Channels "Back", the Vision "Close", PlayerView)
   - `.btn-sm` and `.btn-danger` (LibraryHealthView)
   - `.modal-input` (DatabaseView album form and PromptsView): these showed raw browser-styled white inputs

   They are now aliases in the kit below. `.modal-btn--secondary` needs no rule, because the base `.modal-btn` already looks like a secondary button.

### Class guide
**Rules**
- Use tokens only: `--bg/--bg2/--bg3/--bg4`, `--tx/--tx2/--tx3`, `--ac/--acg`, `--brd`, `--danger`, `--r` (10px), `--rl` (14px), `--tr`. Never hardcode `#e84040`, `#ff4d4d`, `#c0392b` or `#e53935`: use `var(--danger)`, or `var(--ac)` for accent.
- Don't use `--accent`, `--border`, `--text`, `--text-muted`, `--tx1`, `--bg1`, `--acc` or `--err` in new code. They are aliases only, kept for code that already uses them.
- Only convert an element when its inline style matches the class. Keep inline styles for layout only (`flex`, `width`, `margin`).

**Modals: use the existing, theme-aware classes** (all the themes style `.modal-overlay` and `.modal-dialog`)
| Use | Replaces | Example |
|---|---|---|
| `modal-overlay on` | inline `position:fixed; inset:0; background:rgba(0,0,0,.7–.88); display:flex; …` | `<div className="modal-overlay on" onClick={bgClose}>` |
| `modal-dialog` | inline panel `background:var(--bg2); padding:20–24px; borderRadius:8–12px; border; width:360–440px` | `<div className="modal-dialog" style={{ maxWidth: 520 }}>` (default max-width is 420px) |
| `modal-header` + `<h2>` | inline header and title styles | `<div className="modal-header"><h2>Rename</h2></div>` |
| `modal-body` | inline body wrapper | `<div className="modal-body"><p>…</p></div>` |
| `modal-footer` | inline `display:flex; justifyContent:flex-end; gap:8px` | `<div className="modal-footer">…</div>` |
| `modal-btn`, `modal-btn--primary`, `--danger`, `--flat`, `--sm` | modal buttons | `<button className="modal-btn modal-btn--primary">Save</button>` |
| `modal-error` | inline red error text | (display:none by default) |

- Overlays that need a higher stacking order can keep `style={{ zIndex: 20000 }}`.
- `.modal`/`.modal-content` now work, but they are legacy. Write new code with `modal-overlay on`/`modal-dialog`.

**Buttons outside modals**
| Class | Replaces | Example |
|---|---|---|
| `ui-btn` | inline `background:var(--bg3); border:1px solid var(--brd); color:var(--tx); padding:7–9px 14–16px; borderRadius:4–6px` | `<button className="ui-btn">Browse…</button>` |
| `ui-btn ui-btn--primary` | inline `background:var(--ac); color:#fff; border:none; …`, OnboardingWizard `accentBtn` | `<button className="ui-btn ui-btn--primary">Save</button>` |
| `ui-btn ui-btn--danger` | red delete buttons (`#e53935`, `#ff4d4d`, `btnSm('#c0392b')`) | `<button className="ui-btn ui-btn--danger">Delete</button>` |
| `ui-btn ui-btn--ghost` | inline `background:none; border:none; color:var(--tx3)` (back links, text buttons) | `<button className="ui-btn ui-btn--ghost">← Back</button>` |
| `ui-btn--sm` (add to any of the above) | inline `padding:'4px 8–10px', fontSize:'11–12px'`, SettingsView `btnSm` and `btnOutline` | `<button className="ui-btn ui-btn--sm ui-btn--danger">Remove</button>` |
| `ui-btn--icon` | × close and icon-only buttons (use with `--ghost`) | `<button className="ui-btn ui-btn--ghost ui-btn--icon">×</button>` |

- `ui-btn` is `inline-flex` with a 6px gap, so it works with an icon plus text.
- For a disabled button, use the `disabled` attribute instead of inline opacity or cursor.
- `modal-btn--sm` also exists, for `modal-btn` buttons that currently have inline `padding:'4px 8px', fontSize:'12px'`.
- Keep existing `.sort-btn` (pill-shaped sort/filter toggles), `.dash-btn`, `.cta-btn` (buttons over thumbnails) and `.btn-primary` as they are.

**Form controls**
| Class | Replaces | Example |
|---|---|---|
| `ui-input` | the input styles in SettingsView `inp`, OnboardingWizard `inputStyle`, and inline note/textarea styles | `<input className="ui-input" value={v} onInput={…} />` |
| `ui-input` on select or textarea | inline select and textarea styles (themes `<option>` and sets vertical resize) | `<select className="ui-input" style={{ width: 'auto' }}>` |
| `ui-label` | inline `fontSize:'0.78rem', color:'var(--tx3)'` labels | `<label className="ui-label">Year</label>` |

- `ui-input` is width 100% by default. Override with `style={{ width: 'auto', flex: 1 }}` inside a row.
- Inputs inside `.modal-dialog` are already styled, so they need no class.

**Layout and other elements**
| Class | Replaces | Example |
|---|---|---|
| `ui-toolbar` | inline `view-header` with `display:flex; alignItems:center; marginBottom:20px` | `<div className="ui-toolbar"><h1 className="ui-title">Links</h1><div className="ui-toolbar__actions">…</div></div>` |
| `ui-toolbar__actions` | right-aligned action groups (`display:flex; gap; flexWrap`) | as above |
| `ui-title` | inline view h1/h2 sizes (1.5rem/600, default h1) | `<h1 className="ui-title">Actors</h1>` |
| `ui-chip` (+ `.on`) | clickable pill buttons `padding:'4px 10px', borderRadius:'999px', bg3/brd` (SearchSitesView, SettingsView connect pills); same look as `.filter-pill` | `<button className={`ui-chip${on ? ' on' : ''}`}>Tag</button>` |
| `ui-badge`, `ui-badge--ac`, `ui-badge--danger` | count and status labels that can't be clicked | `<span className="ui-badge ui-badge--ac">NEW</span>` |
| `ui-tabs` > `ui-tab` (+ `.on`) | AudioView `tabStyle`, inline tab bars (same look as `.ss-tabs`/`.ss-tab`) | `<div className="ui-tabs"><button className={`ui-tab${t === 'a' ? ' on' : ''}`}>A</button></div>` |
| `empty-state` (+ `h3`, `p`, `svg`) | inline `textAlign:center; padding:60px; color:var(--tx3)` | `<div className="empty-state"><h3>No videos</h3><p>…</p></div>` |
| `empty-state empty-state--sm` | the same with `padding:'40px'` (14 places) | `<div className="empty-state empty-state--sm">Nothing here</div>` |

- `.view-header` was never defined and I left it that way, because the Actors and Channels detail headers depend on flex-start alignment. Replace it with `ui-toolbar` and keep the "Back + title" order.
- Keep `.section-header`, `.video-grid`, `.cv-*` and `.ph-*`: they are the existing card and grid systems.

### Not fixed (outside my files, or not verified)
- **`--ac-rgb`** is used as `rgba(var(--ac-rgb,255,74,74),…)` in PlayerView, RadioModeView, AdvancedPlayer and LibraryHealthView. It is not defined, so the fallback is always red-ish and ignores the theme. A fix needs an RGB triplet for each of the 21 themes. A simpler route is for components to use `var(--acg)` or `color-mix(in srgb, var(--ac) 10%, transparent)`.
- **Hardcoded colours in components:** ActorModal, TagModal, ChannelModal and VaultZipModal have duplicate inline overlay and panel styles with `zIndex:1000` and `rgba(0,0,0,.7)`, which the themes can't override. Components should move to `modal-overlay on` + `modal-dialog`. That is TSX work, so it's not mine to do.
- **`.btn-primary` in LibraryHealthView:162 and SearchSitesView** gets colour only, with no padding, because `.btn-primary` has no padding. Switch those to `ui-btn ui-btn--primary`.
- **`.modal-backdrop` and `.modal-box`** (SubtitleEditorModal:175-176) are not defined anywhere, so that modal is probably unstyled and not an overlay. I didn't alias them because I haven't checked how it renders. Switch it to `modal-overlay on` + `modal-dialog`.
- **`select` and `textarea` have no global `font-family`/`color: inherit` reset.** Adding one would turn existing unstyled selects white-on-white in dark themes, so I left it. Per-component `ui-input` is the safe way to fix them.

## fix:fe-sections-p-z

### Changes (41)

- **bug** `public/src/components/sections/PagesView.tsx`: Upload loop now checks r.ok and catches errors per file, and reports 'N of M pages added' on partial failure instead of always claiming success.
- **bug** `public/src/components/sections/PagesView.tsx`: deletePage uses a functional setPagesList, so deleting from the HTML viewer callback or the context menu no longer works on a stale list. A non-array /api/pages response is guarded.
- **perf** `public/src/components/sections/PhotosView.tsx`: Sorted/filtered files and the subfolder list are memoized. Before, they were re-filtered and re-sorted over the whole photo list on every render, including every slideshow tick.
- **bug** `public/src/components/sections/PhotosView.tsx`: deletePhoto uses a functional setPhotos and handles network errors. The keyboard handler effect now depends on files, so arrow keys use the current list. A non-array response is guarded.
- **ui** `public/src/components/sections/PhotosView.tsx`: The AI filter select uses ui-input (themed options) instead of inline colours.
- **bug** `public/src/components/sections/PlayerView.tsx`: Download progress state is reset when the video changes. Before, polling for a download started on video A kept going after you moved on, and when it finished it replaced currentVideo with A's file. Polling also stops if the job disappears from the queue.
- **bug** `public/src/components/sections/PlayerView.tsx`: startDownload catches network/JSON errors. Before, isDownloading stayed true forever on a failed request.
- **bug** `public/src/components/sections/PlayerView.tsx`: The batch chapter-detect EventSource is kept in a ref, closed on unmount and closed before reopening. JSON.parse of an SSE frame is guarded.
- **bug** `public/src/components/sections/PlayerView.tsx`: Error handling added to toggleFav (r.ok plus try/catch), encrypt, delete (a non-JSON error body no longer throws) and open-folder (network rejection).
- **refactor** `public/src/components/sections/PlayerView.tsx`: Removed the unused PlayerAction component.
- **ui** `public/src/components/sections/PlayerView.tsx`: Transcript button uses var(--acg) instead of the undefined --ac-rgb. Delete uses var(--danger) instead of #ff4a4a. The note textarea uses ui-input.
- **perf** `public/src/components/sections/RadioModeView.tsx`: The filtered channel list and the audio/video counts are memoized. Before, three full filter passes ran on every render, including media play/pause state changes.
- **bug** `public/src/components/sections/RadioModeView.tsx`: addStreams checks r.ok, so a server error shows 'Failed to add streams' instead of 'Added 0, skipped 0'.
- **ui** `public/src/components/sections/RadioModeView.tsx`: Search input and paste textarea use ui-input. The Add button uses ui-btn ui-btn--primary (the disabled attribute replaces inline opacity). The selected row uses var(--acg) instead of the undefined --ac-rgb.
- **bug** `public/src/components/sections/RssView.tsx`: refresh checks r.ok. Before, a server error showed 'Up to date (undefined feed(s))'.
- **ui** `public/src/components/sections/RssView.tsx`: Five inline-styled inputs use ui-input. The small Remove buttons use modal-btn--sm instead of an inline padding/fontSize.
- **perf** `public/src/components/sections/ScreenshotsView.tsx`: The sorted/filtered list is memoized. Before, it copied and sorted the whole list on every render and slideshow tick.
- **bug** `public/src/components/sections/ScreenshotsView.tsx`: Delete uses a functional setState and catches network errors. The keyboard effect depends on files. A non-array response is guarded.
- **bug** `public/src/components/sections/SearchResultsView.tsx`: mediaMatches now depends on allVideos. Before, it was keyed only on the query, so it stayed empty or stale when the library loaded or reloaded after typing.
- **bug** `public/src/components/sections/SearchResultsView.tsx`: fetchScope only caches successful responses. Before, a failed or vault-locked response (for example /api/prompts) was cached as [] for the whole session.
- **perf** `public/src/components/sections/SearchResultsView.tsx`: The nine async-scope filters are memoized on data/tokens/scopes. Before, they re-scanned every list (photos, books and so on) on each selection toggle.
- **bug** `public/src/components/sections/SearchSitesView.tsx`: The 'Disable tracking' checkbox now persists disableSearchTracking via updatePrefs. Before, it only set local state, and the next mount reloaded the old value from prefs.
- **bug** `public/src/components/sections/SearchSitesView.tsx`: Guarded non-array sites/starred responses, a localStorage.setItem that throws, and a malformed star response.
- **perf** `public/src/components/sections/SearchSitesView.tsx`: starredScrapable and sortedSites are memoized. Before, starredScrapable was a new array every render, so its useEffect ran on every render.
- **ui** `public/src/components/sections/SearchSitesView.tsx`: The Search button uses ui-btn ui-btn--primary ui-btn--sm instead of the padding-less .btn-primary, and is disabled while searching.
- **bug** `public/src/components/sections/SeriesView.tsx`: JSON import checks r.ok and shows the server error instead of 'Imported undefined series'.
- **ui** `public/src/components/sections/SeriesView.tsx`: Import/Export buttons use ui-btn ui-btn--sm.
- **bug** `public/src/components/sections/ThumbnailsView.tsx`: Init wrapped in try/finally. Before, a failed loadThumbnails or loadVideos left the view on 'Loading thumbnails...' forever.
- **bug** `public/src/components/sections/SubtitlesView.tsx`: Whisper model download checks r.ok. Before, a failed download still marked the model as ready.
- **bug** `public/src/components/sections/SubtitlesView.tsx`: Single and selected regenerate, delete, and start/stop batch now check r.ok or catch rejections. Before, 'Subtitle deleted' and 'Queued' toasts showed on failure, and start/stop left unhandled rejections.
- **ui** `public/src/components/sections/SubtitlesView.tsx`: Row Edit/Regen/Delete use ui-btn ui-btn--sm (Delete adds --danger; the disabled attribute replaces inline opacity). Search uses ui-input. Loading and empty use empty-state. #e84040 is replaced by var(--danger).
- **perf** `public/src/components/sections/SettingsView.tsx`: Scraper/re-encode status polling (3 fetches every 2s) now runs only while the Cache tab, the only one that shows it, is active. Before, it ran the whole time Settings was open.
- **bug** `public/src/components/sections/SettingsView.tsx`: Panic-key capture: listeners left by a focus that captured nothing are removed on blur, refocus and unmount. Before, the next global keypress could be swallowed and saved as a panic key. A newly captured key now re-renders the list immediately.
- **bug** `public/src/components/sections/SettingsView.tsx`: Categorize plan/execute check r.ok and default categories to []. Before, an error response passed undefined categories to CategorizeModal, or showed 'undefined videos'.
- **bug** `public/src/components/sections/SettingsView.tsx`: Whisper model download checks r.ok. Clear Thumbnails/Favourites/History and Rescan report failures instead of always showing success. localStorage theme get/set is wrapped in try/catch.
- **ui** `public/src/components/sections/SettingsView.tsx`: Cache-tab btnSm/btnOutline inline styles became ui-btn ui-btn--sm (--primary, --danger for Clear). Remove buttons use modal-btn--sm. Connect URL pills use ui-chip. #e84040 is replaced by var(--danger).
- **bug** `public/src/components/sections/VaultView.tsx`: The infinite-scroll observer effect now depends on hasMore/status instead of sentinelRef.current, which is read during render before the sentinel mounts. Before, the sentinel could go unobserved and scrolling stopped loading more files.
- **bug** `public/src/components/sections/VaultView.tsx`: Bulk delete, bulk decrypt and dedup only remove files the server actually deleted or restored. Before, failed items disappeared from the list and the toast over-reported the count.
- **bug** `public/src/components/sections/VaultView.tsx`: Fixed stale closures in single delete, move, fav toggle and select toggle by using functional setState. encryptItems handles network rejection, so 'Encrypting…' no longer gets stuck. Folder create/rename/move tolerate non-JSON error bodies. Lock handles network errors.
- **perf** `public/src/components/sections/VaultView.tsx`: categoryMap lower-cases each category's terms once, not once per file per category.
- **ui** `public/src/components/sections/VaultView.tsx`: Toolbar buttons and labels use ui-btn / ui-btn--primary (Delete Selected uses var(--danger)). Search and unlock inputs use ui-input. The Back button uses ui-btn--ghost. The empty state uses empty-state--sm. The link-import modal uses modal-overlay on + modal-dialog + modal-btn.

### Found, not fixed (7)

- `public/src/components/sections/VaultView.tsx`: On mount with the vault unlocked, /api/vault/status and /api/vault/files are each fetched twice: the mount effect, the isVaultUnlocked effect, and the status.unlocked effect all fire. — _The isVaultUnlocked effect's reload is needed for re-unlocks where status.unlocked stays true. Deduplicating needs an in-flight guard and a check of how the VaultUnlockModal and profile-switch flows sequence; not verified safely._
- `public/src/components/sections/SubtitlesView.tsx`: The Whisper language input calls updatePrefs (a PUT) on every keystroke, and clearing it snaps back to 'auto'. — _Switching to onChange/blur needs a local draft state, because SSE-driven re-renders would reset a controlled input. That is a behaviour change, so I left it for the owner._
- `public/src/components/sections/SubtitlesView.tsx`: es.onerror closes the /api/gen-whisper/status EventSource permanently, so batch progress stops updating after any transient error until the view is remounted. — _Unclear whether the close is intentional (the server may close the stream when idle). Needs a check of the server SSE lifecycle before adding a reconnect._
- `public/src/components/sections/SettingsView.tsx`: Panic-key capture calls preventDefault on mousedown, so clicking elsewhere to leave the field doesn't move focus. The input still shows 'Listening…' although it has stopped listening. — _Fixing it means reworking the capture flow (pre-existing UX quirk); I only fixed the listener leak and the stale list._
- `public/src/components/sections/PlayerView.tsx`: Roughly 12 player action buttons repeat the same inline pill style (padding 8px 16px, borderRadius 20px, bg2, brd). — _No shared pill-button class matches this look: ui-chip is smaller, and ui-btn has a different radius and background. A .ui-btn--pill (or a player-action class) in style.css would let them be unified; I may not edit CSS._
- `public/src/components/sections/ZapView.tsx`: Vault items in the zap queue render <img src=''>, which makes the browser request the page URL. — _Minor and harmless. No change made, to avoid altering the onError/visibility behaviour._
- `public/style.css`: A full-width row-style tab bar (.db-tab) is used by SettingsView and SearchSitesView with inline active-state styles that duplicate .db-tab.on. — _Shared CSS is out of my area; the inline overrides were left to avoid visual changes._

tsc errors: 0

## fix:fe-core

### Changes (35)

- **bug** `public/src/home/Dashboard.tsx`: Widgets are now mounted as components (WidgetBody). Before, def.render(inst) was called inline, so every widget's hooks (useState/useMemo) sat on Dashboard's own hook list and got scrambled when a widget was removed or reordered. Any state change in one widget also re-rendered the whole dashboard.
- **bug** `public/src/home/widgets.tsx`: The generic shortcut renderer is cached per plugin (WeakMap). Now that widgets mount as components, a new closure on each render would remount them every time.
- **bug** `public/src/components/UI/MainContent.tsx`: Added lazy stubs for window.toggleMosaic and window.startMosaicWithPhotos. mosaic.ts only loads with the lazy MosaicView chunk, so the topbar/sidebar Mosaic toggle and the Photos/Vault 'Mosaic' buttons did nothing until /mosaic had been visited.
- **bug** `public/src/mosaic.ts`: stopMosaic (also run on MosaicView unmount) now only goes to 'hub' when the current view is still 'mosaic'. Before, navigating from the mosaic to any other view redirected to home.
- **bug** `public/src/mosaic.ts`: buildMosaicTiles sets mosaicOn=true once the grid exists. Opening /mosaic directly never set it, so tiles never refreshed.
- **bug** `public/src/mosaic.ts`: Deferred tile-swap timers (150ms/800ms/450ms) now check tileLive(). Before, after stop or rebuild they called preloadMosTile on detached videos and started new streams (socket leak).
- **bug** `public/src/mosaic.ts`: Tile teardown uses removeAttribute('src') + load() instead of src='', which made the browser request the page URL as media and did not free the socket.
- **bug** `public/src/mosaic.ts`: Photo-mode refresh used /api/photos/<id>/img even for vault photos. Both the initial load and the refresh now use photoSrc(), which picks the vault stream URL when needed.
- **bug** `public/src/mosaic.ts`: Bridged window.mosaicOn to the real signal. store.goHome and zap.toggleZapping checked w.mosaicOn, a static false, so they never stopped the mosaic.
- **perf** `public/src/mosaic.ts`: mosPickExcluding is now O(1) random picking and mosPick a partial Fisher-Yates. Before, the whole library was sort-shuffled for every tile on every refresh tick.
- **bug** `public/src/tv-mode.ts`: toggleTVMode now imports zapOn/stopZapping directly. window.zapOn was never defined, so starting TV mode never stopped an active zap session.
- **bug** `public/src/zap.ts`: startZapping bails if zapping was stopped during toggleZapping's 300ms delay. Before, it still preloaded a stream into #zap-preload.
- **perf** `public/src/zap.ts`: The folder path is normalised once, outside the per-video filter in getRandomVidForZapping.
- **bug** `public/src/router.ts`: Clearing the tag on navigation now also clears currentTagTerms (clearTag). /tag/X resets the terms when the tag changes, so a previous tag's match terms no longer leak into back/forward navigation and show the wrong videos.
- **bug** `public/src/router.ts`: Added /radio and /screenshots to directViews. URL sync pushed those paths, but reload or back on them fell through to goHome.
- **perf** `public/src/router.ts`: Removed the dead legacy infinite-scroll listener. It forced layout (scrollHeight) on every scroll event and incremented w._renderLimit, but w.render/getLinkList/curTag were never defined, so it had no effect.
- **perf** `public/src/store.ts`: filteredVideos reads narrow computeds (_isFavView, _hiddenFolders, _pinnedTagsOnly, _pinnedTags). Every view change (e.g. browse to player) and every unrelated prefs save no longer re-filters and re-sorts the whole library.
- **perf** `public/src/store.ts`: Tag-term regexes in filteredVideos are compiled once per recompute instead of once per video per term.
- **perf** `public/src/store.ts`: filteredVideos no longer copies the full list up front (and copied twice for searches). It copies once, only when sorting would mutate a source signal array.
- **perf** `public/src/store.ts`: rebuildLinkVidIds lowercases URLs once instead of once per video x link. It also skips empty names, which matched every URL.
- **perf** `public/src/thumbPref.ts`: The parsed pref map is cached in memory and invalidated on the storage event. getThumbPref was JSON-parsing localStorage on every card mount. setItem is now wrapped in try/catch.
- **perf** `public/src/home/progress.ts`: The progress map is cached in memory and invalidated on the storage event. VideoCard calls getProgress on every render, which re-parsed the blob each time. getAllProgress returns a copy.
- **perf** `public/src/plugins.ts`: loadPlugins shares one in-flight request. Sidebar, Topbar and Settings each called it on mount, so /api/plugins was fetched multiple times.
- **bug** `public/src/hooks/useVideoSelection.ts`: Drag-select listens for mousedown on the document and checks grid containment, with drag state in refs. The effect bound to gridRef.current at mount, when only the loading skeleton exists, and never re-ran (deps were stable), so drag-select was dead after the first load. Listeners also stopped being re-bound on every drag start/stop.
- **bug** `public/src/hooks/useVideoSelection.ts`: shiftKeyPressed is reset on window blur. Releasing Shift while the window was unfocused left it stuck, and hovering then kept selecting cards.
- **bug** `public/src/components/UI/VideoGrid.tsx`: The list-view 'Added' date and the year/decade grouping used mtime*1000, but mtime is already epoch ms, so dates came out tens of thousands of years off.
- **bug** `public/src/components/UI/VideoGrid.tsx`: The fav toggle (card and list row) now updates both videos and allVideos through a shared applyFav helper. Search results, home widgets and the player showed stale fav state.
- **bug** `public/src/components/UI/VideoGrid.tsx`: Single-card encrypt now removes the video from allVideos as well, so it doesn't linger in search, home or zap.
- **bug** `public/src/components/UI/VideoGrid.tsx`: Bulk delete only removes the videos the server actually deleted and reports failures. Before, it removed every selected video even when DELETE failed.
- **bug** `public/src/components/UI/VideoGrid.tsx`: The hover-preview timer is cleared on card unmount.
- **ui** `public/src/components/UI/VideoGrid.tsx`: The encrypt confirm moved from legacy .modal/.modal-content to modal-overlay on + modal-dialog, with backdrop click to close and class= changed to className. Cancel now comes before the primary button.
- **ui** `public/src/components/UI/VideoGrid.tsx`: Replaced hardcoded #c0392b with var(--danger), and the var(--border) alias with var(--brd).
- **ui** `public/src/components/UI/AdvancedPlayer.tsx`: Replaced the undefined rgba(var(--ac-rgb,255,74,74),.2) (always red, ignored the theme) with color-mix(in srgb, var(--ac) 20%, transparent) in 3 places.
- **perf** `public/src/components/UI/AdvancedPlayer.tsx`: The 'progress' event handler keeps the previous buffered array when the ranges are unchanged, avoiding a full re-render of the 1400-line player on each event.
- **ui** `public/src/App.tsx`: Connection-lost overlay: icon stroke now uses var(--danger), and the Reload button uses ui-btn ui-btn--primary instead of inline styles.

### Found, not fixed (10)

- `widgets/*/widget.tsx`: The task lists plugins/*/widget.tsx, but there are no widget.tsx files under plugins/. The home widgets live in widgets/<id>/widget.tsx (home/widgets.tsx globs '../../../widgets/*/widget.tsx'), and CLAUDE.md still says plugins/<id>/widget.tsx. — _Outside my file list, so I did not audit or edit them. CLAUDE.md also needs updating._
- `plugins/mosaic/MosaicView.tsx`: The unmount cleanup calls stopMosaic(), and the Close/step buttons use .btn-primary, which has no padding. — _Not my file. I made stopMosaic safe to call on unmount from inside mosaic.ts instead. The buttons should be switched to ui-btn ui-btn--primary._
- `public/src/store.ts`: The scroll-position memory only re-keys on currentView changes. A folder or tag change inside browse leaves prevKey stale, so the restored scroll can belong to a different folder. — _A fix needs subscribing to currentFolder/currentTag as well, and that interacts badly with routeToPath setting view before folder (it would overwrite the saved position). Not verified to be safe._
- `public/src/store.ts`: There is a large block of dead legacy window.* globals and bridges (w.load, w.refresh, w.filterVideosCat, w.filterVideosByTag, w._applySort, w.loadC, and dozens of w.xxxMode flags). No legacy JS remains: index.html only loads /src/main.tsx. — _Callers may still exist in TSX outside my area (e.g. w.refresh, w.loadC). Needs a cross-area grep before removing; not done, to stay behaviour-safe._
- `public/src/components/UI/AdvancedPlayer.tsx`: timeupdate calls setCurrentTime about 4 times a second, which re-renders the whole 1400-line player tree, including every channel, subtitle and chapter list. — _A fix needs splitting the time bar into a child component or signal. That is too large a refactor to do safely here._
- `public/src/components/UI/AdvancedPlayer.tsx`: The controls auto-hide timer is only armed on mousemove, so if playback starts without the mouse moving, the controls never hide. controlsTimeoutRef is also not cleared on unmount. — _Minor, and changing the hide behaviour is a UX decision. Left as is._
- `public/src/components/UI/VideoGrid.tsx`: VideoSelBar and its tag/actor/collection popovers are entirely inline-styled with hardcoded colours (#7c3aed, #ff7300, rgba backgrounds), and the selected-card highlight uses hardcoded #ff7300. — _This is a floating pill toolbar that no shared class covers (ui-btn would change its look). It needs a dedicated CSS class in style.css, which I may not edit._
- `public/src/components/UI/VideoGrid.tsx`: The runEncryptSelected poll interval is not tied to the component. If /api/encryption/status keeps failing, it polls forever (catch {} swallows the errors). — _Low impact. A fix needs a give-up policy decision._
- `public/src/tv-mode.ts`: initTVMode filters all videos once per folder (O(folders x videos)). — _Only runs on toggle, and folder counts are small. Not worth the risk._
- `public/src/zap.ts`: toggleZapping does not stop an active TV mode (the reverse case of the tv-mode fix). — _zap.ts importing tv-mode would create a cycle (tv-mode now imports zap). Needs a design decision._

tsc errors: 0

## fix:fe-shared-ui

### Changes (28)

- **bug** `public/src/components/UI/LibraryFilters.tsx`: Dragging a video onto a sidebar or dropdown folder sent POST to /api/videos/:id/move, but the server only routes PATCH, so drops always 404'd. It now uses PATCH and handles a non-JSON error reply. The dead window.loadVideos call is gone (the scan SSE already refreshes) and a toast confirms the move.
- **bug** `public/src/components/UI/LibraryFilters.tsx`: SectionDropdowns returned early before its useEffect (rules-of-hooks violation when sections move between topbar and sidebar). The early return now comes after the hook.
- **bug** `public/src/components/UI/Sidebar.tsx`: Sidebar returned null for the reddit view before about 10 useState/useEffect calls (conditional hooks). The early return now comes after every hook.
- **perf** `public/src/components/UI/Sidebar.tsx`: /api/photos/folders was fetched on every app start. It is now fetched once, on the first visit to the Photos view (the only place it renders), with a guard for non-array replies. localStorage write is wrapped in try/catch.
- **bug** `public/src/components/UI/ContextMenu.tsx`: 'Add selection as Actor/Channel' posted to /api/db/:type/upsert, which does not exist (the route is POST /api/db/:type), so it always failed. The URL is fixed, and it now checks first whether the name exists, because upsert replaces the whole entry and would wipe stored details.
- **bug** `public/src/components/UI/ContextMenu.tsx`: The encryption-completion setInterval could stack when encrypting twice and was never cleared on unmount. It now clears before starting and on unmount.
- **bug** `public/src/components/UI/ContextMenu.tsx`: The Favourite toggle patched only videos, so allVideos (home widgets, search, tags) kept the stale fav state. Both lists are now patched.
- **refactor** `public/src/components/UI/ContextMenu.tsx`: Removed the unused esc() helper.
- **ui** `public/src/components/UI/ContextMenu.tsx`: Hardcoded #ff4a4a/#e84040 danger colours are now var(--danger), and ContextItem's default colour is var(--tx) instead of the alias var(--text).
- **bug** `public/src/components/UI/Search.tsx`: The ghost autocomplete hint wrote the raw query and the DB-sourced hint via innerHTML (HTML injection, and typing '<' broke rendering). It is now built with textContent spans.
- **bug** `public/src/components/UI/Search.tsx`: An in-flight suggest response could reopen the dropdown after the box was cleared. The sequence counter is now bumped on the short-query path.
- **perf** `public/src/components/UI/Search.tsx`: Hidden-term regexes are compiled once instead of once per hidden term per autocomplete term.
- **bug** `public/src/components/UI/DownloadManager.tsx`: 'Clear finished' only filtered client state, so finished jobs came back on the next poll that returned a changed list. It now DELETEs the done/error jobs on the server too, and paused jobs are kept.
- **bug** `public/src/components/UI/DownloadManager.tsx`: The poll scheduler could fork a second polling chain that was never cancelled: a kick or visibilitychange during an in-flight poll left two timer chains. The scheduler now keeps a single timer and never pushes back a sooner queued poll.
- **refactor** `public/src/components/UI/DownloadManager.tsx`: Removed the write-only prevJobStatuses ref and the unused loadVideos import. Hardcoded #e55/#a11 reds are now var(--danger).
- **bug** `public/src/components/UI/SyncManager.tsx`: Same polling-chain fork fix as DownloadManager: single-timer scheduler.
- **ui** `public/src/components/UI/SyncManager.tsx`: Start/Stop actions now trigger a re-poll after 150ms (bursts coalesce, e.g. stopAll), so rows update right away instead of after up to 2–10s. Removed the unused appPrefs import.
- **refactor** `public/src/components/UI/GlobalDownloadBar.tsx`: Deleted the dead component. It is imported nowhere and would have polled /api/download/jobs every 1s.
- **perf** `public/src/components/UI/navItems.tsx`: getNavItems runs on every Sidebar/Topbar/dropdown render and filtered the whole library each time to count local videos. The count is now cached per allVideos array reference. Removed the unused currentFolder import.
- **perf** `public/src/components/UI/SearchExtras.tsx`: The full /api/photos, /api/audio and /api/books lists were refetched on every query change. One fetch is now shared through a 30s module cache.
- **bug** `public/src/components/UI/SearchExtras.tsx`: Results for an older query could overwrite newer ones; added an effect-cancel flag. A photo without a filename (or a non-array reply) no longer throws.
- **bug** `public/src/components/UI/DropOverlay.tsx`: /api/import also returns kind 'file', so counts.file++ produced NaN and file-only drops showed no toast. 'file' is now counted and reported.
- **perf** `public/src/components/UI/FilterPanel.tsx`: Actor, channel and tag option lists (the tag list is a full-library scan) recomputed on every allVideos change even with the panel closed. They are now computed only while the panel is open.
- **bug** `public/src/components/UI/FolderTree.tsx`: The breadcrumb map put its key on an inner span inside an unkeyed fragment (key warning / reconciliation issue). It now uses a keyed Fragment.
- **ui** `public/src/components/UI/FolderTree.tsx`: var(--accent) is now var(--ac), and the hardcoded #e84040 delete colour is now var(--danger).
- **bug** `public/src/components/UI/CategoryTagsModal.tsx`: Save closed the modal even when the server rejected it (no r.ok check), silently losing the edits. It now stays open and shows a toast with the error.
- **ui** `public/src/components/UI/CategoryTagsModal.tsx`: Converted the inline overlay and panel to modal-overlay on + modal-dialog + modal-header/body/footer + modal-btn (themes now apply). The textarea uses ui-input, and the --tx1 alias is removed.
- **ui** `public/src/components/UI/CategorizeModal.tsx`: Converted the overlay and panel to modal-overlay on + modal-dialog (layout overrides kept inline). The search box uses ui-input, Cancel uses ui-btn ui-btn--sm, and Move uses ui-btn ui-btn--primary with disabled styling from CSS. --tx1 is now --tx.

### Found, not fixed (7)

- `public/style.css`: `.modal-dialog, .modal-content { animation: modalIn ... forwards }` keeps a non-none transform after the animation ends. That makes the dialog the containing block for position:fixed descendants. In ContextMenu's 'Manage Subfolders' modal, FolderTree's right-click menu (fixed at clientX/clientY) and its nested create/rename/move Modal (modal-overlay, fixed inset:0) are positioned and clipped relative to the dialog, not the viewport. — _CSS is off-limits for this area. Fix: drop `forwards` from the modalIn animation (the end state equals the default) or end on `transform: none`._
- `public/style.css`: `.tb-acts button` (specificity 0,1,1) overrides `.ui-btn` and `.ui-btn--sm` (0,1,0) padding, radius, border and font-size. Buttons in the SyncManager and DownloadManager dropdown panels (rendered inside .tb-acts) therefore can't be moved to ui-btn without looking wrong, so their inline styles were kept. — _Needs a CSS change, e.g. `.tb-acts button:not(.ui-btn)` / `.tb-moved button:not(.ui-btn)`, or scoping to direct children. After that the panel buttons can switch to `ui-btn ui-btn--sm` (+ --primary / --ghost / --danger)._
- `public/src/components/UI/DropOverlay.tsx`: After a drop-import, audio/books/photos refresh only through the window bridges w.audioMode/w.loadAudio, w.booksMode/w.loadBooks and w.photosMode/w.loadPhotos, which look like legacy globals that are no longer defined. Those views probably don't refresh until navigation. — _Not verified where (or whether) these bridges are still defined; the right refresh hook belongs to the sections area._
- `public/src/components/UI/LibraryFilters.tsx`: window.showCategory is called from LibraryFilters.selectCategory and from Search.applySuggestion, but nothing in public/src defines it. These are dead legacy calls. — _Harmless no-ops. Left in case legacy code or plugins define it; removing them is cosmetic._
- `public/src/components/UI/ContextMenu.tsx`: The 'all_videos' context menu items ('Lock all unencrypted' / 'Unlock all encrypted') only toast 'Not implemented in TSX yet'. — _Feature work, not a fix. The /api/folders/encrypt-all route exists if someone wants to wire it up._
- `public/src/components/UI/ContextMenu.tsx`: The four ContextMenu dialogs (Restore, Encrypt Folder, Encrypt Video, Subfolders) still use the legacy `.modal on` / `.modal-content` pair. — _Left as is: they render correctly with the new aliases. Moving the Subfolders dialog to modal-overlay/modal-dialog would not fix the fixed-position issue above (same animation), so that should be fixed in CSS first._
- `CLAUDE.md`: Documents `POST /api/db/:type/upsert`, but server.js routes `POST /api/db/(actors|categories|channels|websites)` with no /upsert suffix. That stale doc is likely how the ContextMenu bug got in. — _Not my file; documentation update needed._

tsc errors: 0

## fix:fe-modals

### Changes (37)

- **refactor** `public/src/components/modals/useEscape.ts`: New small hook useEscape(active, handler) that always calls the latest handler. It replaces the Escape keydown wiring each modal did on its own and is used by all closable modals.
- **bug** `public/src/components/modals/PhotoLightbox.tsx`: Moved the keydown useEffect above the `if (!isOpen) return null`. Before, closing the lightbox skipped the effect's cleanup, so a stale listener kept calling onPrev/onNext/onClose afterwards.
- **bug** `public/src/components/modals/PhotoLightbox.tsx`: Arrow keys and Space no longer fire while typing in an input or textarea (the slideshow seconds field). Clearing that field no longer sends NaN to onSlideSecsChange. Delete colour #ff4d4d replaced with var(--danger).
- **bug** `public/src/components/modals/AddToCollectionModal.tsx`: The 'New playlist' input was always hidden because its wrapper .collection-modal-new is display:none unless it has .on. Removed the wrapper, so the input shows and 'Create & Add' can be used.
- **ui** `public/src/components/modals/AddToCollectionModal.tsx`: Moved to modal-overlay on + modal-dialog + modal-footer. Rows use .collection-option buttons instead of inline rgba hover handlers. Added Escape, a busy guard against double-submit, and fetch error handling.
- **bug** `public/src/components/modals/OnboardingWizard.tsx`: The folder browser fetched /api/settings/browse-folders, a route that does not exist, so it always failed. It now calls /api/browse-folders and shows the server's error message.
- **bug** `public/src/components/modals/OnboardingWizard.tsx`: Subfolder paths were always joined with a backslash, which broke folder browsing on macOS/Linux. A new joinPath helper uses the path's own separator. Browse errors were only shown on the Theme step, so they are now also shown on the Folders step.
- **ui** `public/src/components/modals/OnboardingWizard.tsx`: Overlay and panels moved to modal-overlay/modal-dialog (z-index 40000 kept). The folder-browser and Browse buttons use ui-btn and the path input uses ui-input. Removed the now-unused inputStyle and ghostBtn objects. #e84040 replaced with var(--danger).
- **bug** `public/src/components/modals/VaultUnlockModal.tsx`: Status started as {}, so the modal showed 'Create Vault' until /api/vault/status returned, and pressing Enter could call setup on a vault that already exists. Submit is now gated until status has loaded.
- **bug** `public/src/components/modals/VaultUnlockModal.tsx`: Passwords, error and loading state now reset each time the modal opens. Added a double-submit guard, overlay click and Escape close (blocked while loading), and autoFocus.
- **ui** `public/src/components/modals/VaultUnlockModal.tsx`: Salt radios get width:auto, because the .modal-dialog input rule stretched them to 100% with padding. Inline input styles removed in favour of the .modal-dialog styling. The error uses .modal-error. Dropped the unused `h` import.
- **bug** `public/src/components/modals/RenameModal.tsx`: State reset only when currentName changed, so reopening for the same video kept the half-typed name and the old error. It now resets on every open. Added a saving guard against double rename and Escape close.
- **ui** `public/src/components/modals/RenameModal.tsx`: Moved to modal-dialog, modal-header h2, modal-error, modal-footer and modal-btn/--primary.
- **bug** `public/src/components/modals/TagModal.tsx`: Tags are cleared on open, so the previous video's tags no longer flash. Late responses for a previously opened video are ignored. A failed PATCH now shows toastError. Escape works globally instead of only from the input.
- **ui** `public/src/components/modals/TagModal.tsx`: Moved to modal-overlay on + modal-dialog + modal-header (zIndex 1000 kept). Overlay click closes it. The close icon uses ui-btn ghost icon.
- **bug** `public/src/components/modals/ActorModal.tsx`: Same fixes as TagModal: state reset on open, stale responses ignored, PATCH errors shown, Array.isArray guard on /api/actors, global Escape.
- **ui** `public/src/components/modals/ActorModal.tsx`: Moved to modal-overlay on + modal-dialog + modal-header. Overlay click closes it.
- **bug** `public/src/components/modals/ChannelModal.tsx`: State reset on open and stale responses ignored. Added a saving guard against double-submit. A failed PATCH keeps the modal open and shows toastError instead of closing silently.
- **ui** `public/src/components/modals/ChannelModal.tsx`: Moved to modal-overlay/modal-dialog/modal-header/modal-footer with modal-btn buttons. Overlay click and Escape close it.
- **bug** `public/src/components/modals/VaultZipModal.tsx`: Fixed the `fontCloser` typo, so the title is now a proper h2. Errors show inline instead of with alert(). A non-JSON error body no longer throws. revokeObjectURL is deferred so the download is not cancelled. Added a double-submit guard and state reset on open.
- **ui** `public/src/components/modals/VaultZipModal.tsx`: Moved to modal-overlay/modal-dialog/modal-footer/modal-btn with ui-label. Overlay click and Escape close it, except while generating.
- **ui** `public/src/components/modals/VisionModal.tsx`: Moved from the legacy .modal/.modal-content to modal-overlay on + modal-dialog (zIndex 10000 kept). Added overlay click and Escape close, and modal-btn Close.
- **bug** `public/src/components/modals/SubtitleEditorModal.tsx`: Used the undefined .modal-backdrop/.modal-box classes, so it was not an overlay at all. Now uses modal-overlay on + modal-dialog (padding 0, zIndex 20000).
- **bug** `public/src/components/modals/SubtitleEditorModal.tsx`: Raw mode and cues now reset on each open. A late response from the previously opened video is ignored. Added a save double-submit guard and Escape close (which still asks to confirm unsaved changes). Error colour uses var(--danger).
- **bug** `public/src/components/modals/ImportLinksToQueueModal.tsx`: 'Add N to Queue' only imported the selected links that matched the current filter, though the label counted every selected link. It now imports all of them. The filter no longer crashes on links with no title.
- **perf** `public/src/components/modals/ImportLinksToQueueModal.tsx`: Section was a component defined inside the parent, so it was a new component type on every render and each keystroke or checkbox toggle remounted the whole list. It is now a render function.
- **ui** `public/src/components/modals/ImportLinksToQueueModal.tsx`: Moved to modal-overlay on + modal-dialog (padding 0, zIndex 10000 kept) with ui-btn and ui-btn--primary buttons. Checkboxes get width:auto. Added Escape close.
- **bug** `public/src/components/modals/ImportModal.tsx`: Closing via overlay or X during an import reset `importing` while the upload loop kept running, which allowed a second concurrent import after reopening. Close is now blocked while importing. Failed link saves now show toastError instead of failing silently. Added Escape.
- **ui** `public/src/components/modals/ImportModal.tsx`: Panel moved to modal-dialog. Buttons use ui-btn/ui-btn--primary and the close icon uses ui-btn ghost icon. The textarea uses ui-input.
- **bug** `public/src/components/modals/MoveModal.tsx`: Added Escape close (blocked while moving), and 'Move here' is guarded against firing while busy. handleClose reads the live signal rather than a stale snapshot.
- **perf** `public/src/components/modals/MoveModal.tsx`: Badge was a component defined inside MoveModal, so its spans remounted on every render. It is now a module-level component.
- **ui** `public/src/components/modals/MoveModal.tsx`: Moved to modal-dialog + modal-header. Buttons use modal-btn/--primary, ui-btn--sm and ui-btn--primary. The error uses .modal-error. Inputs inside the flex rows get width:auto/minWidth:0.
- **bug** `public/src/components/modals/PresetPicker.tsx`: The manual 'Change preset' picker (mergeMode) had no way to close without applying. It now has a Cancel button and closes on Escape or overlay click; the first-run picker stays non-dismissable. Added an applying guard against duplicate /api/presets/apply calls.
- **ui** `public/src/components/modals/PresetPicker.tsx`: Moved to modal-overlay on + modal-dialog + modal-header. Dropped the conflicting .preset-dialog/.preset-dialog-hd classes, which double-padded the dialog. Footer uses modal-btn--sm/--primary. Checkboxes get width:auto.
- **bug** `public/src/components/modals/ConnectModal.tsx`: The network-access toggle now reverts and shows an error if saving the pref fails, instead of showing a state the server never saved. Added Escape close.
- **ui** `public/src/components/modals/ConnectModal.tsx`: Moved from .collection-modal/.collection-modal-box to modal-overlay on + modal-dialog + modal-header. Overlay click now compares the target with currentTarget. Error colour uses var(--danger).
- **refactor** `public/src/components/modals/LinkIframeModal.tsx`: Replaced its hand-rolled Escape keydown effect with the shared useEscape hook. Behaviour is unchanged.

### Found, not fixed (8)

- `public/src/components/sections/PhotosView.tsx, ScreenshotsView.tsx, ThumbnailsView.tsx`: Each of these views registers its own window keydown handler (ArrowLeft/ArrowRight/Escape/Space) while it renders PhotoLightbox, which handles the same keys. One ArrowRight moves two photos, and Space toggles the slideshow twice, so it does nothing. — _These files are outside my area. Fix: delete the view-level 'Keyboard listeners for lightbox' useEffect (PhotosView ~L179, ScreenshotsView ~L121, ThumbnailsView ~L80) and rely on PhotoLightbox, as VaultView already does._
- `public/src/components/UI/VideoGrid.tsx, public/src/components/UI/ContextMenu.tsx`: 'Add to Playlist' from a grid card or the context menu sets currentVideo and showAddToCollectionModal, but AddToCollectionModal is only rendered in PlayerView. Outside the player nothing opens, and the flag stays true until the player is next visited. — _Outside my area. Fix: render `{showAddToCollectionModal.value && <AddToCollectionModal onClose={...} />}` once in MainContent.tsx and remove it from PlayerView.tsx:696. Ideally also pass the target video as a prop instead of overwriting currentVideo._
- `server/videos-server.js (apiImport ~L2718)`: ImportModal sends the destination folder in the 'x-category' header unencoded. A folder name with non-Latin-1 characters makes fetch throw (header values must be ByteStrings), so every file import into that folder fails silently. — _It needs a matching server change. Change the server to `decodeURIComponent(req.headers['x-category'] || '')`; after that, ImportModal can send encodeURIComponent(category)._
- `public/style.css (.modal-dialog input, L1789)`: .modal-dialog input applies width:100% and padding to every input, including checkboxes and radios. I worked around it with inline width:auto in VaultUnlock, PresetPicker and ImportLinksToQueue. — _CSS is not mine. Suggest scoping it to `.modal-dialog input:not([type=checkbox]):not([type=radio])`._
- `public/style.css (.modal-btn)`: There is no `.modal-btn:disabled` rule, so disabled modal buttons (Save, Unlock, Move here, Download ZIP and others) look exactly like enabled ones. — _CSS is not mine. Suggest `.modal-btn:disabled { opacity: .5; cursor: default; pointer-events: none }`, the same as `.ui-btn:disabled`._
- `public/style.css (.modal-btn--primary:hover)`: The hover box-shadow is hardcoded to rgba(232,64,64,.3), so it is red in every theme. — _CSS is not mine. It should use var(--acg) or color-mix with var(--ac)._
- `public/src/components/modals/ActorModal.tsx / ChannelModal.tsx`: Both modals load the current actors or channel from GET /api/videos/:id (apiVideoDetailFast). That endpoint also scores every visible video to build 'suggested', which is wasted work for a picker. — _There is no lightweight meta endpoint. A server change such as GET /api/videos/:id/meta, or a ?lite=1 flag that skips suggestions, would be needed._
- `public/src/components/modals/TagModal.tsx`: When the modal is opened with a linkUrl and no vidId, tags start empty and are never saved, because there is no link-tag API call. — _No caller passes linkUrl today (every opener sets linkUrl: null), so this path is unreachable. Left as is._

tsc errors: 0

## fix:server-core

### Changes (24)

- **bug** `server/videos-server.js`: apiStream: encrypted-folder videos are now detected. The old check read meta[id].encrypted, a field that never exists, so .enc files were streamed as raw ciphertext. It now checks the .enc extension against the scan entry and uses the real extension for the MIME type.
- **bug** `server/videos-server.js`: Added _idForPath(): new ids now use the same form as scan(), with native separators relative to VIDEOS_DIR, or the absolute path for external files. Move, decrypt, import, opened-copy, folder relabel and purge used to rebuild ids with '/', so on Windows favourites and metadata were orphaned after the rescan. apiRename also built '../..' ids for files in source folders.
- **bug** `server/videos-server.js`: Path traversal: added _isInsideLibrary(). apiFolderRename, apiFolderMove, apiRenameFolder and apiDeleteFolder now reject '..' paths that point outside the library or at a root, and reject names containing separators, '.' or '..'. apiFolderDelete with path '.' used to empty the whole library into its parent folder.
- **bug** `server/videos-server.js`: apiCategorizeExecute: srcPath and destFolder come from the client, so they could move any file on disk. Both must now resolve inside an allowed library root.
- **bug** `server/videos-server.js`: apiClearThumbs called unlinkSync on per-video thumbnail directories, which always failed, so nothing was cleared. It now removes the directories with rmSync and keeps encrypted (.enc) thumbs, which cannot be regenerated.
- **bug** `server/videos-server.js`: apiVideoDetailFast: allTagSet.add(...metaTags) added only the first tag, and added undefined (sent as null) when there were none. It now builds new Set(metaTags).
- **bug** `server/videos-server.js`: runEncryptFolder now marks the job as running before its first await, so two concurrent requests can no longer both start encrypting. External source-folder videos now use their absolute rel path; they were silently skipped before.
- **bug** `server/videos-server.js`: apiAddChapter and apiDeleteChapter now persist chapters with setVideoMetaFields. Before, manual chapters lived only in the in-memory meta cache and were lost on restart or cache reset.
- **perf** `server/videos-server.js`: apiImport and apiVideosUpload stream uploads straight to disk instead of holding the whole file in memory, which could exhaust the heap on multi-GB videos. Partial files are removed on error, and an aborted upload no longer hangs the handler.
- **perf** `server/videos-server.js`: Rename, move, moveVideoToFolder (categorizer, auto-sort, auto-file) and delete now update single rows (moveVideoMeta / deleteVideoMetaEverywhere). They used to rewrite the whole videos table with saveVideoMeta, and the whole thumbs_cache table, for one id, which made batch moves O(library × moves). apiFolderRename (relabel) also migrates favourites now.
- **perf** `server/videos-server.js`: Favourites lookups in video detail, fast detail, favourites, tag, db-tag, channel and duplicates handlers use a Set instead of Array#includes for each video.
- **bug** `server/db-server.js`: Added a videos.chapters column (additive ALTER) that is read and written by _readVideoMetaFromDb, getSingleVideoMeta, saveVideoMeta and setVideoMetaFields. saveVideoMeta also writes reencoded now; its full rewrite used to wipe that flag, for example on every startup in initVideoMeta. getSingleVideoMeta now returns reencoded.
- **bug** `server/db-server.js`: saveFavs and saveHistory use INSERT OR IGNORE, so one duplicate id no longer rolls back the whole save and leaves the DB out of sync with the in-memory cache.
- **perf** `server/db-server.js`: _readVideoMetaFromDb uses two bulk queries grouped in JS instead of two queries per video (N+1). Order is unchanged.
- **perf** `server/db-server.js`: loadPrefs caches the raw prefs JSON and still parses it per call, so it skips the SQLite query on hot paths (network guard, safePath, streams). The cache is refreshed by savePrefs and reset in _clearCaches.
- **refactor** `server/db-server.js`: Added and exported moveVideoMeta(oldId, newId, fields), which re-keys one video's metadata, actors and tags.
- **bug** `server/helpers-server.js`: Added and exported isInside(p, root, strict), a containment check on path-segment boundaries that also handles drive roots. safePath, isAllowedMediaPath and serveStatic use it; the bare startsWith let sibling dirs like '<media>2' or '<public>-x' pass as inside.
- **bug** `server/helpers-server.js`: readBody now resolves on 'error' and 'aborted'. An aborted request used to leave the awaiting handler hanging forever.
- **bug** `server/helpers-server.js`: formatBytes returns '0 B' for undefined, NaN or negative input instead of 'NaN undefined', and clamps the unit index above TB.
- **bug** `server/gen-thumbs-server.js`: The batch writes each thumb-cache entry as it finishes (setThumbCacheEntry). The old end-of-run saveThumbsCache rewrote the table from a snapshot taken at the start, dropping concurrent and deleted-video changes and losing all progress on a stop or crash.
- **perf** `server/gen-thumbs-server.js`: The batch reuses genThumbs from thumbnails-server, which shares the global 3-slot ffmpeg cap and 2-frame parallelism, instead of a duplicate ffprobe/ffmpeg pipeline that ran up to 10 ffmpeg processes on top of grid requests. It also records width and height now. The duplicate VIDEO_EXT and toId were removed.
- **bug** `server/background-worker-server.js`: Stop is now honoured mid-run: the file and actor loops break when the worker is disabled. Before, the whole library was processed after Stop.
- **perf** `server/background-worker-server.js`: Generated thumbnails are now recorded in the thumb cache (setThumbCacheEntry), so the grid no longer regenerates them on first view. The redundant inline helpers requires and the unused toId import were removed.
- **refactor** `server.js`: Removed a duplicate /api/videos/recategorize-all route and the inline helpers require in /api/media-counts.

### Found, not fixed (7)

- `server/downloads-server.js`: Lines ~262 and ~287 build video ids as toId(path.relative(VIDEOS_DIR, p).replace(/\\/g,'/')). On Windows this does not match scan() ids, which use native separators, so the downloaded or auto-moved video's metadata and favourites are orphaned. gen-whisper-server.js:43 has the same problem. — _Outside my files. The fix is to compute ids exactly like scan(): path.relative(VIDEOS_DIR, fp) with no separator rewrite, or absolute paths for external files (the same as videos-server's _idForPath)._
- `server/hls-server.js`: apiHlsPlaylist sends 'Access-Control-Allow-Origin: *', which overrides the server's origin allowlist. Any website can then read playlists, which include video ids (base64 file paths). — _Not verified whether the browser extension's in-page hls.js needs '*' (content-script fetches carry the page's origin), so I left it._
- `server/background-worker-server.js`: After generating thumbs, subtitles or chapters, the worker calls invalidateScanCache(). That forces a full rescan and broadcasts scan_changed (a gallery reload for every client), although none of these change the scan. — _The frontend may rely on scan_changed to re-fetch thumbnails that failed earlier; not verified._
- `server/categorizer-server.js`: listFolders() walks every library root with synchronous readdirSync on each createMatcher/bestFolderFor call, which includes every download and feed auto-file. — _The file has the user's uncommitted work in progress. I left it untouched rather than refactor it under them._
- `server/videos-server.js`: apiUploadSubtitle buffers the body and awaits only 'end', so an aborted upload hangs the handler. apiOpenFolder and apiOpenFolderInExplorer build shell commands with exec and an interpolated path (a quote in a folder name breaks the command). apiOpenFolderInExplorer accepts '..' in catPath. — _Low impact and not verified end to end. Suggested fix: execFile('explorer', [folder]) or the platform equivalent, plus an isInside check._
- `server/videos-server.js`: apiDelete now uses deleteVideoMetaEverywhere, so deleting a file also removes it from history and collections. Before, those kept dangling ids. — _This is an intended behaviour change, flagged for review. If collections should keep entries for deleted files, use a narrower delete._
- `server/db-server.js`: The required `node -e require(...)` checks loaded db-server against the real db/db.db, so the additive migration `ALTER TABLE videos ADD COLUMN chapters TEXT` has already run there. It is nullable and harmless, and the server would have run it on its next start anyway. — _Informational only. A side effect of the allowed require check._

tsc errors: 0

## fix:fe-sections-a-l

### Changes (43)

- **bug** `public/src/components/sections/CorruptedView.tsx`: Vault deletes called DELETE /api/vault/:id, a route that does not exist, so they always failed. They now call /api/vault/files/:id.
- **bug** `public/src/components/sections/CorruptedView.tsx`: POST /scan now runs before the SSE subscription. Before, a re-scan could show the previous job's 'done' replay as the new result. A failed start (other than 400 'already running') now resets the state and shows a toast.
- **bug** `public/src/components/sections/CorruptedView.tsx`: There is now one EventSource per mode. Switching tabs used to close the running scan's stream, which left that tab stuck on 'scanning' forever. Both streams close on unmount.
- **ui** `public/src/components/sections/CorruptedView.tsx`: Scan, Stop and Delete buttons now use ui-btn (primary, danger, sm). The mode tabs use ui-tabs/ui-tab, the empty state uses empty-state, and #e84040/#c44 became var(--danger).
- **bug** `public/src/components/sections/DuplicatesView.tsx`: The 'keep best + rename' step called POST /api/rename/:id, which does not exist, so renames never happened. It now calls PATCH /api/videos/:id/rename with {newName}. The rename runs after the other copies are deleted, so a same-folder duplicate can no longer cause a 409. The toasts report the real deleted and renamed counts.
- **bug** `public/src/components/sections/DuplicatesView.tsx`: The Preview button called window.playVideo, which is never defined, so it did nothing. It now uses window.openVid.
- **perf** `public/src/components/sections/DuplicatesView.tsx`: visibleGroups and totalWasted are memoized. stopScan now catches network errors.
- **ui** `public/src/components/sections/DuplicatesView.tsx`: Inline-styled buttons became ui-btn variants. The mode toggles became ui-tab with the disabled attribute while scanning, and the loading and empty states use empty-state.
- **bug** `public/src/components/sections/LibraryHealthView.tsx`: The scan is now POSTed before opening the SSE. Before, the status stream's 'idle' or stale 'done' replay could end the new scan early or show old results. Results also have an Array.isArray guard.
- **ui** `public/src/components/sections/LibraryHealthView.tsx`: Buttons: btn-primary became ui-btn--primary and btn-sm/btn-danger became ui-btn--sm/--danger. The undefined --ac-rgb row highlight is now var(--acg), the empty states use empty-state--sm, and the unused import and style object were removed.
- **bug** `public/src/components/sections/LinksView.tsx`: Download progress froze after the first update. The [jobs] effect cleanup cleared the interval but left dlPollerRef set, so the poller never restarted. The cleanup now nulls the ref.
- **bug** `public/src/components/sections/LinksView.tsx`: Importing from the bookmark picker POSTs the full list to /api/links/cache, which replaces the whole table. While later pages were still loading, this deleted every link not fetched yet. Import is now blocked with a toast until allLoaded.
- **bug** `public/src/components/sections/LinksView.tsx`: LinkCard used new URL(item.url) without a try. One malformed stored URL threw and crashed the whole grid render.
- **bug** `public/src/components/sections/LinksView.tsx`: The table and grid ResizeObserver effects only depended on viewMode. They ran while the scroll container was still unmounted (loading), so the default 600px height stuck and rows below it stayed blank on tall windows. They now also depend on whether rows are present.
- **perf** `public/src/components/sections/LinksView.tsx`: updateMatches now normalises video names once instead of per link × video. It runs on every edit and delete. The recognised-host list is memoized instead of spreading the Set on every isRecognizedUrl call. The scrape poller has a try/catch, and the jobs response has an array guard.
- **ui** `public/src/components/sections/LinksView.tsx`: Header: view-header became ui-toolbar/ui-title/ui-toolbar__actions. Alias tokens became real tokens, and hardcoded #e53935/green/red became var(--danger).
- **bug** `public/src/components/sections/DownloadQueueView.tsx`: While any finished job was listed, every 1.5s poll re-fetched the entire link list and flashed 'Loading links…'. It now refreshes quietly, and only when the done count increases. The baseline resets on Clear Queue.
- **bug** `public/src/components/sections/DownloadQueueView.tsx`: downloadSelected used links.find(...)! and crashed when a selected URL was no longer in the list. Jobs and folders now have Array.isArray guards.
- **perf** `public/src/components/sections/DownloadQueueView.tsx`: For every row on every render and poll, resolveTargetFolder built regexes for each tag × folder and jobs.find ran per row. Both are now memoized maps (folderByUrl, jobByUrl, linkByUrl), and the visible filter is memoized.
- **ui** `public/src/components/sections/DownloadQueueView.tsx`: modal-btn buttons used outside a modal became ui-btn/--sm/--primary/--danger. The search field uses ui-input, the empty states use empty-state--sm, and #f44336 became var(--danger).
- **bug** `public/src/components/sections/DatabaseView.tsx`: Several handlers toasted success even when the request failed: wildcard save and delete, series save and delete, album save and delete. Entry save and delete and openPresetImport had no network error handling. All now check r.ok, and the modal stays open when a save fails.
- **ui** `public/src/components/sections/DatabaseView.tsx`: 16 identical inline-styled modal-btn buttons became ui-btn. Add buttons use ui-btn--primary, and row Edit/✕/Remove buttons use ui-btn--sm/--danger. Tabs use ui-tab, inputs and selects use ui-input, and empty states use empty-state--sm. The entry, scraper, preset-import, series and album modals moved to modal-overlay on + modal-dialog, with labels as ui-label (zIndex 1000 kept).
- **bug** `public/src/components/sections/CategorizerView.tsx`: renameFolder used startsWith(oldPath), so renaming 'Foo' also rewrote the optimistic paths of a sibling 'Foobar'. It now matches the exact path or the path + '/'.
- **perf** `public/src/components/sections/CategorizerView.tsx`: canDrop/onDrop did allVids.find per dragged id on every dragover event. They now use a memoized id→video Map, and localVids is memoized. #c44 became var(--danger). The user's uncommitted HOW_LABEL change was left as is.
- **bug** `public/src/components/sections/BooksView.tsx`: PDF/EPUB were fetched in full just to sniff the content-type, then opened with window.open after an await, which can be popup-blocked. They now open directly and synchronously. Also added res.ok checks for CBZ and text reads, cancel of the sniffed body, an array guard, and a fix for '{b.chapters && …}' rendering a stray '0'.
- **refactor** `public/src/components/sections/BooksView.tsx`: Removed dead URL-import state and the importBook handler, which had no UI. Sort and filter are memoized.
- **ui** `public/src/components/sections/BooksView.tsx`: The reader close button became ui-btn ghost icon, the CBZ view toggles ui-tab, Save ui-btn--primary, the editor textarea ui-input, and the empty state empty-state--sm.
- **bug** `public/src/components/sections/AudioView.tsx`: '{t.duration && …}' rendered a stray '0'. Non-array API responses crashed the sort and filter, so array guards were added. A network failure on delete is now handled. The album filter also tolerates a missing artist.
- **refactor** `public/src/components/sections/AudioView.tsx`: The getColor/colors helper was duplicated in two tabs; it is now hoisted to module scope. Music, album and artist filter/sort are memoized.
- **ui** `public/src/components/sections/AudioView.tsx`: The main tabStyle tabs and Grid/List toggles now use ui-tabs/ui-tab. Search inputs use ui-input, the close button uses ui-btn ghost icon, and the empty state uses empty-state--sm.
- **bug** `public/src/components/sections/ActorsView.tsx`: Switching actors quickly could show the previous actor's videos when an earlier response arrived late. The response is now ignored once stale. There is also an array guard on /api/actors.
- **perf** `public/src/components/sections/ActorsView.tsx`: Filter, sort and split are memoized. The headers use ui-toolbar/ui-title/ui-btn, and alias tokens became real tokens.
- **bug** `public/src/components/sections/ChannelsView.tsx`: Same as ActorsView: a stale response is ignored when switching channels, and there is an array guard. Filter and sort are memoized, and the headers use ui-toolbar/ui-title/ui-btn.
- **bug** `public/src/components/sections/CategoriesView.tsx`: The cv-card list had no key. A key was added, along with an array guard on the response.
- **perf** `public/src/components/sections/CategoriesView.tsx`: Hidden-set building, filter and sort were memoized. Before, they ran on every render, including every encryption-status poll tick. The header uses ui-toolbar, and the partial lock icon uses var(--danger).
- **bug** `public/src/components/sections/ChaptersView.tsx`: The gen-chapters EventSource was never closed on unmount and kept setting state. It is now held in a ref and closed on unmount or restart.
- **perf** `public/src/components/sections/ChaptersView.tsx`: Merging manual and auto chapters across the whole library is memoized. Before, it re-ran on every filter keystroke.
- **bug** `public/src/components/sections/CollectionsView.tsx`: openDetail showed the previous playlist's videos, or 'No videos', until the fetch finished, and out-of-order responses could win. It now clears the list, shows a loading state and drops stale responses. Errors on load, create and delete are now handled, and the unused currentVideo import was removed.
- **ui** `public/src/components/sections/CollectionsView.tsx`: The create input uses ui-input and also submits on Enter, and the Create button uses ui-btn--primary. The delete button's inline style was removed in favour of the existing .collection-delete CSS.
- **bug** `public/src/components/sections/FilesView.tsx`: deleteFile toasted 'Deleted' even when the request failed. It now checks r.ok. The files and folders responses have array guards.
- **perf** `public/src/components/sections/FilesView.tsx`: The filtered list is memoized. Per-folder counts used files.filter for each folder on every render; they now come from a single memoized Map.
- **ui** `public/src/components/sections/ActorScraperView.tsx`: Inline-styled Scrape buttons became ui-btn ui-btn--sm ui-btn--primary with the disabled attribute. Scrape All uses ui-btn--primary. There is an array guard on the response.
- **bug** `public/src/components/sections/BrowseView.tsx`: Clear history cleared the local list even when DELETE /api/history failed. It now checks the response and shows an error toast on failure.

### Found, not fixed (11)

- `public/src/components/UI/VideoGrid.tsx`: Line 198 calls window.playVideo, which is never defined anywhere, so that action does nothing. — _Outside my area. Use window.openVid(id) from store.ts:1524, the same fix applied in DuplicatesView._
- `server.js / server/books-server.js`: The /api/books/cbz/:id/file/:path route passes the raw, undecoded pathname segment (p = urlObj.pathname). CBZ page files with spaces, '#' or non-ASCII names return 404. BooksView also does not encode the filename in the URL. — _Needs decodeURIComponent(m[2]) server-side and encodeURIComponent on the client together. The server change is outside my area, and encoding on the client alone would break names that work today._
- `public/style.css`: '.modal-dialog input' sets width:100% and background on every input, including checkboxes and radios. Because of this, DatabaseView's 'Add websites from saved links' modal (checkbox list) and CategorizerView's plan modal could not move to modal-overlay/modal-dialog without stretching their checkboxes. — _CSS is not mine to edit. Suggested scope: .modal-dialog input:not([type=checkbox]):not([type=radio])._
- `public/style.css`: .modal-overlay has z-index 500, but these views' overlays used 1000. I kept style={{ zIndex: 1000 }} on the converted DatabaseView modals. — _CSS change outside my area. Worth checking whether 500 is low enough to sit under the topbar or player chrome._
- `public/src/components/sections/CategorizerView.tsx`: renderPanel() is only ever called with 'left' (the right side is renderRightPanel()). Its side === 'right' branches (breadcrumb, subfolder strip, about 80 lines) are dead code. The plan modal and drop highlights still use inline overlay styles and hardcoded rgba(232,64,64,…) / rgba(232,130,20,…) instead of var(--acg). — _The file has the user's uncommitted work, so I kept changes to small targeted fixes. A large dead-code removal or modal rewrite there is a riskier change._
- `public/src/components/sections/LinksView.tsx`: LinkCard is wrapped in memo(), but onRemove, onToggleStar, onUpdate, onVault and onChannelClick are new closures on every render (removeItem and toggleStar close over items), so the memo never skips a render. — _Fixing it means changing the handlers to functional updates plus useCallback across several call sites. The grid is already virtualized, so the gain is moderate and I kept the change small._
- `public/src/components/sections/LinksView.tsx`: moveSelectedToVault and encryptSelected are near-duplicates hitting the same endpoint; only encryptSelected reports failures. The BookmarkPickerModal and the add/bulk bars still use many inline-styled buttons and inputs. — _Merging them changes the error behaviour of the vault-locked path. The large inline-style conversion was left to keep this pass low-risk._
- `server/links-server.js`: Bookmark-picker import has to POST the entire link list to /api/links/cache, which deletes and re-inserts the whole links table. I added a client guard, but an append endpoint (or reusing /api/links/import-urls with titles) would be safer. — _API contract change outside my area._
- `public/src/components/sections/LibraryHealthView.tsx`: TYPE_COLOR hex values (including #e84040) are joined with '22' to make alpha backgrounds, so they cannot be swapped for var(--danger) without switching to color-mix(). — _Left as is to avoid changing the badge rendering; it needs a color-mix() refactor._
- `public/src/components/sections/CorruptedView.tsx`: The 'deleted' Set is shared between the Videos and Vault modes, and mode stays 'vault' if the vault locks while selected. — _Minor and not confirmed as user-visible. Not changed._
- `public/src/components/sections/FilesView.tsx`: createFolder only adds the folder in local state. An empty new folder disappears on the next loadAll() (any upload, move or delete) because /api/files/folders only lists folders that have files. — _Looks like a design limit of the virtual-folder API. Fixing it needs a server endpoint to persist empty folders._

tsc errors: 0

## fix:server-features

### Changes (29)

- **bug** `server/subtitles-server.js`: Security: the video id reached readFile/writeFile/unlink without any check, so '../' or an absolute path allowed arbitrary file writes. resolveVideoPath now uses helpers safePath. The client-supplied ext is limited to SUBTITLE_EXT, and the duplicate VIDEO_EXT/toId/fromId definitions are removed.
- **bug** `server/reencode-server.js`: Client ids were resolved without a guard and the file was then replaced, so any file on disk could be overwritten. Ids now go through safePath. Added -nostats/-loglevel error so ffmpeg progress output no longer overflows execFile's 1 MB stderr buffer and kills long encodes. The hand-rolled body parser is replaced with readBody.
- **bug** `server/books-server.js`: The CBZ cache dir was built from the raw URL id (backslash or '..' could escape CACHE_DIR/cbz); the id must now be base64url. The CBZ page filename is URL-decoded, which fixes pages whose names contain spaces. A failed extraction removes its half-written cache and the fd is always closed. Also: redirects now resolve relative Location headers, X-Filename decoding no longer throws, and stream error handlers were added.
- **bug** `server/downloads-server.js`: dlActive was decremented twice (remove/cancel/removeAll plus the job's finally), so it went negative and the concurrency limit stopped working; only the finally decrements now, clamped at 0. Video ids keep native separators so they match the scan's ids on Windows (link to local video mapping). A filename decoded from the URL could escape the target dir via %2F..; basename is now taken after decoding. Partial files are deleted on failure. A malformed redirect no longer throws. Added '--' before the url for yt-dlp. Input is type-checked. Bulk stdin EPIPE is handled.
- **bug** `server/gen-whisper-server.js`: fpToId changed backslashes to '/', so detected languages were saved under ids no video has on Windows. The 1 MB default maxBuffer killed long transcriptions, so it is now 64 MB. A second queue worker shared the same queue, ran whisper concurrently and could drop forced regenerations; there is now one worker that honours item.force. Duplicate VIDEO_EXT/toId removed.
- **bug** `server/database-server.js`: Any actor upsert or delete in the Database view wiped date_of_birth for every actor (it was hard-coded to null). DOB is now preserved, and the edited actor's fields are merged. Guards added for a missing data object, non-string import paths, null website entries and a null body.
- **bug** `server/vault-server.js`: apiVaultAdd: auto-lock is now held during the upload and the key is re-checked before saving meta; locking mid-upload could clobber the vault meta (the same hazard already handled in _encryptLocalFileToVault). Also: failed or aborted uploads send a response and remove the partial .enc file, and a malformed X-Filename no longer throws. Restore and restore-to-origin take the basename of originalName, so a stored '../' name can't write outside destDir. Cancelling a download now stops the decrypt stream. Delete validates the id with _safeId. No crypto logic was changed.
- **bug** `server/vision-server.js`: source='thumb' joined the raw id and thumbIdx into a path (traversal); both are now validated. Added a stdin error handler so ffmpeg EPIPE (early exit or failed spawn) can't raise an uncaught error.
- **bug** `server/links-server.js`: Argument injection: urls are now passed to yt-dlp after '--', and Edge screenshots only accept http(s) or file: urls, so a '--flag' url can't become a browser switch. OG and embed fetches have a redirect hop limit and resolve relative Location headers. The link thumb id must be base64url. yt-dlp calls got a timeout and a larger maxBuffer. Background jobs got .catch handlers. JSON import guards null items. Removed Array.from(Set) from the per-item filter.
- **bug** `server/actors-server.js`: On failure httpsGetStream never closed the write stream, which leaked an fd and blocked unlink on Windows, and a write-stream error before the response was unhandled. The background scrape left empty photo files that blocked retries and could write to a missing dir. Redirects resolve relative locations. Added a stream error handler.
- **perf** `server/actors-server.js`: apiActors lowercases video names and tagged-actor sets once instead of per actor×video pair; apiActorVideos uses a Set for favourites.
- **bug** `server/zip-reader-server.js`: For data-descriptor entries the ZipCrypto check byte must be the high byte of the mod-time (as the code comment already said), but 0 was used, so valid passwords were rejected. The duplicated central-directory parser is merged into _parseCentralDir, which now has a bounds check.
- **bug** `server/scrapeMethods-server.js`: Redirects now resolve relative locations, drain the response and stop after 5 hops (a redirect loop recursed without limit). Response errors reject.
- **bug** `server/rss-server.js`: A malformed redirect Location threw inside the response callback, an uncaught error. It now resolves ''.
- **bug** `server/assistant-server.js`: When the client closes the SSE chat, the upstream OpenRouter request is now aborted instead of streaming on.
- **bug** `server/audio-server.js`: Replaced the hand-rolled range parsing with helpers parseRange, which fixes suffix ranges (bytes=-N). A malformed X-Filename no longer throws and leaves the request hanging.
- **refactor** `server/files-server.js`: Uses helpers parseRange (fixes suffix ranges) and readBody (removed the duplicate _readBody). X-Filename decoding is safe and the download stream has an error handler.
- **bug** `server/screenshots-server.js`: Upload is restricted to image extensions, since the folder is served same-origin with a MIME type taken from the extension (e.g. .html). Added stream error handlers.
- **perf** `server/photos-server.js`: PNG AI-metadata is cached by path+mtime, so the photo list no longer opens every PNG synchronously on each request. Added stream error handlers.
- **perf** `server/duplicates-server.js`: Hashes are decoded from hex to bytes once per scan, instead of parseInt/substr in every one of the O(n²) grouping comparisons.
- **perf** `server/auto-chapters-server.js`: The auto-chapters JSON cache is kept in memory (this module is the only writer). hasAutoChapters/ensureAutoChaptersForVideo re-parsed the whole file once per video from the background worker. Added -nostats; removed the dead videoFpFromId/fromId.
- **perf** `server/collections-server.js`: Collection thumbs and videos are looked up through a Map/Set instead of videos.find/favs.includes inside loops.
- **refactor** `server/library-health-server.js`: Uses helpers readBody instead of an inline body parser. Result filtering uses a Set instead of ids.includes.
- **bug** `server/profiles-server.js`: Preset selection ids are restricted to known preset folders (they were joined onto PRESETS_DIR unchecked).
- **bug** `server/settings-server.js`: Rejects a non-object prefs body ('x' in null threw and the request hung). Hidden-list content is coerced to a string.
- **bug** `server/prompts-server.js`: A non-string text field no longer throws in add/update/send-comfyui.
- **bug** `server/opened-folders-server.js`: A non-string path no longer throws in open/close.
- **bug** `server/pages-server.js`: Added a read-stream error handler so a file vanishing mid-request can't raise an uncaught error.
- **bug** `server/vault-zip-server.js`: Folder ZIP joined VIDEOS_DIR with the absolute rel of external (sourceFolder) videos, so those files were silently skipped. They are now resolved correctly.

### Found, not fixed (9)

- `server.js`: Route handlers are called as `return handler(...)` inside the async try without await, so a rejected handler promise skips the router's catch: no 500 is sent and the request hangs (it is only logged by process.on('unhandledRejection')). — _Outside my files. Fix: `return await handler(...)`, or wrap dispatch in one awaited call._
- `server/helpers-server.js`: safePath checks VIDEOS_DIR and sourceFolders with startsWith and no path.sep, so a sibling folder like 'videos2' passes. parseRange returns 416 when end >= size instead of clamping it per RFC 7233. — _Not my file._
- `server/vault-server.js`: Several vault handlers call (body.password || '').trim() and similar without String(), so a non-string body field throws and the request hangs. The range branch of _streamDecrypt still uses a hand-rolled parser and gets bytes=-N suffix ranges wrong. — _Vault code: only clear bugs were fixed. These are low impact and touch auth paths, so they were left for a deliberate review._
- `server/settings-server.js`: GET /api/settings/prefs returns anthropicApiKey and openrouterApiKey to any allowed client, including LAN clients when networkEnabled is on. apiVerifyVaultPassword trims the password and compares the hash without constant time. — _Changing it would change the API contract the frontend relies on. Needs a product decision (mask the keys)._
- `server/feed-watcher-server.js`: renameSync from feed/ to MEDIA_DIR fails with EXDEV when they are on different drives. The error is logged and the file is never ingested. — _Needs a copy+unlink fallback. Not verified how the feed dir is configured in practice._
- `server/subtitles-server.js`: Subtitle-list ids use forward slashes, while the library scan uses native separators on Windows. They work with safePath but don't match /api/videos ids. — _Self-contained in SubtitlesView today. Changing the ids could break cached client state._
- `server/vault-zip-server.js`: ZIP import and export buffer entire archives (export up to 500 MB) and inflate entries with no size cap (zip bomb). — _A streaming rewrite is too large and risky for this pass._
- `public/src/components/sections/BooksView.tsx`: CBZ page URLs interpolate raw filenames; '#' or '?' in a page name breaks the request. — _Frontend file, outside my area. It should use encodeURIComponent(f); the server now decodes it._
- `server/prompts-server.js`: The ComfyUI request always uses the http module, and its port falls back to 8188 even when the URL has no explicit port (e.g. an https URL on 443). — _Behaviour change; not verified against real ComfyUI setups._

