// ─── Filter state persistence ───
let chaptersMode = false;
function _restoreFilterState() {
  const s = localStorage.getItem('aa_sort');
  if (s && ['date','name','size','duration'].includes(s)) sort = s;
  if (localStorage.getItem('aa_shuf') === '1') shuf = true;
}

function _syncSortButtons() {
  if (shuf) {
    document.querySelectorAll('.sort-btn[data-s]').forEach(b => b.classList.remove('on'));
    document.querySelectorAll('#shBtn, #shBtnTag').forEach(b => b.classList.add('on'));
  } else {
    document.querySelectorAll('.sort-btn[data-s]').forEach(b => b.classList.toggle('on', b.dataset.s === sort));
    document.querySelectorAll('#shBtn, #shBtnTag').forEach(b => b.classList.remove('on'));
  }
}

// ─── Init ───
async function init() {
  await checkAndShowPresetPicker();
  _restoreFilterState();
  await loadTemplates();
  showSk();
  await fetch('/api/auto-sort', { method: 'POST' }).catch(() => {});
  const [,, vs] = await Promise.all([loadC(), loadTagSidebar(), fetch('/api/vault/status').then(r => r.json())]);
  vaultMode = vs.unlocked;
  _syncSortButtons();
  loadBookmarkVidsOnInit();
}

async function loadBookmarkVidsOnInit() {
  try {
    const r = await fetch('/api/bookmarks/cache');
    if (!r.ok) return;
    const d = await r.json();
    if (!d.items || !d.items.length) return;
    if (!_bfItems.length) _bfItems = d.items;
    rebuildBookmarkVidIds(d.items);
    renCats();
    // Patch bookmark cards in-place without rebuilding video cards.
    // A full render/openTag call would destroy all existing card DOM nodes,
    // forcing the browser to re-decode every thumbnail texture simultaneously —
    // which is what causes the one-time synchronized flicker.
    const inBrowse = !importFavsMode && !vaultMode && !studioMode && !actorMode
                  && !dbMode && !categoriesMode && !collectionsMode
                  && !booksMode && !audioMode && !photosMode && !promptsMode
                  && !settingsMode && !scraperMode && !recentMode;
    if (inBrowse) {
      const gridId = curTag ? 'tag-grid' : 'video-grid';
      const g = document.getElementById(gridId);
      if (g) {
        g.querySelectorAll('.bookmark-card').forEach(el => el.remove());
        const bms = getBmList();
        if (bms.length) {
          const tmp = document.createElement('div');
          tmp.innerHTML = bms.map(bmCard).join('');
          while (tmp.firstChild) g.appendChild(tmp.firstChild);
          attachBmThumbs();
        }
      }
    }
    if (!localStorage.getItem('bm_notice_shown')) {
      toast('Bookmark videos will not be picked for Zapping or Mosaic mode');
      localStorage.setItem('bm_notice_shown', '1');
    }
  } catch {}
}

// ─── Navigation ───
function goBack() {
  playlistSkipped.clear();
  if (vaultMode) {
    const p = $('video-player').el;
    p.pause(); p.src = '';
    curV = null;
    $('player-view').remove('on');
    $('vault-view').add('on');
    if (location.pathname !== '/') history.pushState(null, '', '/');
    loadVaultFiles();
  } else if (_prevView) {
    const pv = _prevView;
    _prevView = null;
    const p = $('video-player').el;
    p.pause(); p.src = '';
    curV = null;
    $('player-view').remove('on');
    if (pv.type === 'tag') openTag(pv.tag);
  } else {
    goHome();
  }
}

function showHome() {
  closeAllViews();
  $('browse-view').add('off');
  $('home-view').add('on');
  if (location.pathname !== '/') history.pushState(null, '', '/');
}

function goHome() {
  playlistSkipped.clear();
  if (mosaicOn) stopMosaic();
  if (zapOn) {
    zapOn = false;
    clearTimeout(zapTimer);
    $('zap-ui').show(false);
    $('video-player').show();
    $('video-player-zap').show(false);
    activePlayer = 'video-player';
  }
  if (location.pathname !== '/') history.pushState(null, '', '/');
  $('home-view').remove('on');
  $('vault-view').remove('on');
  $('vault-sidebar').remove('on');
  $('scraper-view').remove('on');
  $('scraper-sidebar').remove('on');
  $('collections-view').remove('on');
  $('collections-sidebar').remove('on');
  if ($('books-view').el) $('books-view').remove('on');
  if ($('books-sidebar').el) $('books-sidebar').remove('on');
  if ($('audio-view').el) $('audio-view').remove('on');
  if ($('audio-sidebar').el) $('audio-sidebar').remove('on');
  if ($('search-sites-view').el) $('search-sites-view').remove('on');
  if ($('search-sites-sidebar').el) $('search-sites-sidebar').remove('on');
  $('settings-view').remove('on');
  $('settings-sidebar').remove('on');
  if ($('database-view').el) $('database-view').remove('on');
  if ($('database-sidebar').el) $('database-sidebar').remove('on');
  if ($('chapters-view').el) $('chapters-view').remove('on');
  if ($('chapters-sidebar').el) $('chapters-sidebar').remove('on');
  if (vaultMode || (typeof vaultPromptsMode !== 'undefined' && vaultPromptsMode)) fetch('/api/vault/lock', { method: 'POST' }).catch(() => {});
  promptsMode = false; categoriesMode = false; chaptersMode = false; if (typeof vaultPromptsMode !== 'undefined') vaultPromptsMode = false;
  curCollection = null;
  $('browse-view').remove('off');
  $('player-view').remove('on');
  $('studios-view').remove('on');
  $('studio-detail-view').remove('on');
  $('studio-sidebar').remove('on');
  $('actors-view').remove('on');
  $('actor-detail-view').remove('on');
  $('actor-sidebar').remove('on');
  $('tag-detail-view').remove('on');
  document.querySelectorAll('#tagList .sidebar-item').forEach(el => el.classList.remove('on'));
  studioMode = false;
  curStudio = null;
  actorMode = false;
  curActor = null;
  curTag = null;
  recentMode = false;
  recentVids = [];
  $('recent-sidebar').remove('on');
  $('clearRecentBtn').show(false);
  $('clearRecentSep').show(false);
  const p = $('video-player').el;
  p.pause();
  p.src = '';
  curV = null;
  galleryFilter = '';
  document.querySelectorAll('#gallery-filter, #gallery-filter-tag').forEach(i => i.value = '');
  refresh();
}
function showChaptersView() {
  closeAllViews();
  chaptersMode = true;
  $('browse-view').add('off');
  $('chapters-view').add('on');
  $('chapters-sidebar').add('on');
  renderChaptersView();
}

// ─── Close All Views ───
function closeAllViews() {
  closeTagModal();
  if (mosaicOn) stopMosaic();
  if (curV) {
    $('player-view').remove('on');
    const vp = $('video-player').el; vp.pause(); vp.src = '';
    curV = null;
  }
  [
    'home-view',
    'studios-view','studio-detail-view','studio-sidebar','actors-view','actor-detail-view','actor-sidebar','tag-detail-view',
    'vault-view','vault-sidebar','scraper-view','scraper-sidebar',
    'collections-view','collections-sidebar',
    'books-view','books-sidebar','audio-view','audio-sidebar','photos-view','photos-sidebar','pages-view','pages-sidebar','prompts-view','prompts-sidebar','search-sites-view','search-sites-sidebar',
    'import-favs-view','import-favs-sidebar','settings-view','settings-sidebar','database-view','database-sidebar','recent-sidebar',
    'categories-view','categories-view-sidebar','chapters-view','chapters-sidebar',
  ].forEach(id => { const el = $(id).el; if (el) el.classList.remove('on'); });
  document.querySelectorAll('.sidebar-item.on').forEach(el => el.classList.remove('on'));
  if (vaultMode || (typeof vaultPromptsMode !== 'undefined' && vaultPromptsMode)) fetch('/api/vault/lock', { method: 'POST' }).catch(() => {});
  vaultMode = false; scraperMode = false; dbMode = false;
  studioMode = false; curStudio = null;
  actorMode = false; curActor = null;
  collectionsMode = false; curCollection = null;
  importFavsMode = false; booksMode = false; audioMode = false; photosMode = false; pagesMode = false; promptsMode = false; categoriesMode = false; chaptersMode = false; if (typeof vaultPromptsMode !== 'undefined') vaultPromptsMode = false;
  settingsMode = false; recentMode = false; recentVids = [];
  $('clearRecentBtn').show(false);
  $('clearRecentSep').show(false);
  curTag = null;
}

// ─── Category Selection ───
function selCat(c) {
  if (dualMode && dualActive === 'right') { dualSelCat(c); return; }
  closeAllViews();
  cat = c;
  
  // Ensure we clear any existing search query so the category filter isn't 
  // being restricted by a hidden search term.
  q = ''; 
  $('search-input').val('');
  $('search-ghost').html('');
  galleryFilter = '';
  document.querySelectorAll('#gallery-filter, #gallery-filter-tag').forEach(i => i.value = '');

  const catUrl = c ? '/cat/' + encodeURIComponent(c) : '/';
  if (location.pathname !== catUrl) history.pushState(null, '', catUrl);
  
  $('section-title').text(c ? cats.find(x => x.path === c)?.name || c : 'All Videos');
  $('browse-view').remove('off');
  
  window.scrollTo({ top: 0, behavior: 'instant' });

  // Force a refresh to get the filtered list from the server/state 
  // instead of relying on the conditional render check.
  refresh(); 
}

// ─── Favourites Toggle ───
function toggleFav() {
  favM = !favM;
  $('fBtn').toggle('on', favM);
  $('section-title').text(favM ? 'Favourites' : 'All Videos');
  if (favM) { cat = ''; history.pushState(null, '', '/favourites'); }
  else history.pushState(null, '', '/');
  
  // Reset the inline fav filter when switching to global favourites
  favFilter = false;
  document.querySelectorAll('#favFilterBtn, #favFilterBtnTag, #favFilterBtnStudio, #favFilterBtnActor, #favFilterBtnCol').forEach(b => b.classList.remove('on'));
  
  refresh();
}

function toggleStarredFilter() {
  favFilter = !favFilter;
  document.querySelectorAll('#favFilterBtn, #favFilterBtnTag, #favFilterBtnStudio, #favFilterBtnActor, #favFilterBtnCol').forEach(b => {
    b.classList.toggle('on', favFilter);
  });
  
  if (curTag) openTag(curTag);
  else if (studioMode && curStudio) openStudio(curStudio);
  else if (actorMode && curActor) openActor(curActor);
  else if (collectionsMode && curCollection) openCollectionDetail(curCollection);
  else {
    load().then(() => render());
  }
}

// ─── Sorting ───
async function setSort(s, el) {
  sort = s;
  shuf = false;
  localStorage.setItem('aa_sort', s);
  localStorage.removeItem('aa_shuf');
  document.querySelectorAll('.sort-btn[data-s]').forEach(b => b.classList.toggle('on', b.dataset.s === s));
  document.querySelectorAll('#shBtn, #shBtnTag').forEach(b => b.classList.remove('on'));
  if (curTag) { await openTag(curTag); return; }
  await load(); render();
}

async function toggleShuf() {
  shuf = !shuf;
  localStorage.setItem('aa_shuf', shuf ? '1' : '');
  document.querySelectorAll('#shBtn, #shBtnTag').forEach(b => b.classList.toggle('on', shuf));
  if (shuf) document.querySelectorAll('.sort-btn[data-s]').forEach(b => b.classList.remove('on'));
  else document.querySelector('.sort-btn[data-s="' + sort + '"]')?.classList.add('on');
  if (curTag) { await openTag(curTag); return; }
  await load(); render();
}

// ─── Recently Watched ───
async function showRecent() {
  closeAllViews();
  if (location.pathname !== '/recent') history.pushState(null, '', '/recent');
  recentMode = true;
  recentVids = [];
  $('recent-sidebar').add('on');
  $('browse-view').remove('off');
  cat = ''; q = ''; favM = false;
  $('search-input').val('');
  $('search-ghost').html('');
  const data = await (await fetch('/api/history')).json();
  recentVids = data;
  $('section-title').text('Recently Watched');
  $('clearRecentBtn').show(true);
  $('clearRecentSep').show(true);
  render();
}

async function clearRecent() {
  await fetch('/api/history', { method: 'DELETE' });
  recentVids = [];
  render();
  toast('History cleared');
}

// ─── Scraper ───
function showScraper() {
  closeAllViews();
  if (location.pathname !== '/scraper') history.pushState(null, '', '/scraper');
  scraperMode = true;
  $('browse-view').add('off');
  $('scraper-sidebar').add('on');
  $('scraper-view').add('on');
  ActorScraper.load();
}

// ─── Panoramic Mode ───
function togglePan() {
  const on = document.body.classList.toggle('pan');
  $('panBtn').toggle('on', on);
  localStorage.setItem('pan', on ? '1' : '');
}

// ─── Search Autocomplete ───
(async () => {
  try {
    const r = await fetch('/api/settings/lists');
    if (r.ok) {
      const d = await r.json();
      const parse = s => (s || '').split('\n').map(l => l.trim()).filter(Boolean);
      const hiddenTerms = parse(d.hidden);
      const isHiddenTerm = name => hiddenTerms.some(t => new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(name));
      acTerms = [...parse(d.actors), ...parse(d.studios), ...parse(d.categories)].filter(t => !isHiddenTerm(t));
      _bfKnownTerms = []; // invalidate bookmark sort cache
    }
  } catch {}
})();

function acSuggest(val) {
  if (!val) return '';
  const words = val.split(/\s+/);
  const last = words[words.length - 1];
  if (!last) return '';
  const lo = last.toLowerCase();
  const match = acTerms.find(t => t.toLowerCase().startsWith(lo) && t.toLowerCase() !== lo);
  if (!match) return '';
  return match.slice(last.length);
}

function acUpdateGhost(val) {
  const ghost = $('search-ghost').el;
  const hint = acSuggest(val);
  if (!hint || !val) { ghost.innerHTML = ''; return; }
  ghost.innerHTML = '<span class="ghost-typed">' + val + '</span><span class="ghost-hint">' + hint + '</span>';
}

const sIEl = $('search-input').el;
let sTO;
sIEl.addEventListener('input', e => {
  acUpdateGhost(e.target.value);
  clearTimeout(sTO);
  sTO = setTimeout(() => {
    q = e.target.value.trim();
    if (q) {
      // Close any active detail views (actors, studios, etc.)
      closeAllViews();
      
      // Reset Category and Tag to "All Videos"
      cat = '';
      curTag = null;
      $('section-title').text('All Videos'); 
      
      $('browse-view').remove('off');
      if (location.pathname !== '/') history.pushState(null, '', '/');
    }
    refresh();
  }, 300);
})
sIEl.addEventListener('blur', () => { $('search-ghost').html(''); });
sIEl.addEventListener('keydown', e => {
  if (e.key === 'Tab') {
    const hint = acSuggest(sIEl.value);
    if (hint) {
      e.preventDefault();
      sIEl.value += hint;
      acUpdateGhost(sIEl.value);
      clearTimeout(sTO);
      sTO = setTimeout(() => { q = sIEl.value.trim(); refresh(); }, 300);
    }
  } else if (e.key === 'Escape') {
    $('search-ghost').html('');
  }
});

// ─── Themes ───
function applyTheme(name) {
  if (name) document.documentElement.setAttribute('data-theme', name);
  else document.documentElement.removeAttribute('data-theme');
  localStorage.setItem('theme', name);
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === name);
  });
}

(function loadTheme() {
  const saved = localStorage.getItem('theme') || '';
  if (saved) document.documentElement.setAttribute('data-theme', saved);
})();

// ─── Startup ───
['library', 'browse', 'media', 'web', 'manage', 'cats', 'tags'].forEach(name => {
  if (localStorage.getItem('sc_' + name)) {
    $(name + 'Section').add('closed');
    $('sh3-' + name).add('closed');
  }
});
if (localStorage.getItem('pan')) { document.body.classList.add('pan'); $('panBtn').add('on'); }

// ─── Router ───
async function routeToPath(path) {
  let m;
  if (path === '/' || path === '') { showHome(); return; }
  if (path === '/favourites') { if (!favM) { favM = true; $('fBtn').add('on'); } refresh(); return; }
  if (path === '/bookmarks') { showImportFavs(); return; }
  if (path === '/duplicates') { showDups(); return; }
  if (path === '/vault') { showVault(); return; }
  if (path === '/vault/prompts') { showVaultPrompts(); return; }
  if (path === '/recent') { showRecent(); return; }
  if (path === '/collections') { showCollections(); return; }
  if (path === '/scraper') { showScraper(); return; }
  if (path === '/books') { showBooks(); return; }
  if (path === '/audio') { showAudio(); return; }
  if (path === '/photos') { showPhotos(); return; }
  if (path === '/pages')  { showPages(); return; }
  if (path === '/search') { showSearchSites(); return; }
  if (path === '/prompts') { showPrompts(); return; }
  if (path === '/settings') { showSettings(); return; }
  if (path === '/database') { showDatabase(); return; }
  if (path === '/categories') { showCategoriesView(); return; }
  if (path === '/actors') { showActors(); return; }
  if (path === '/studios') { showStudios(); return; }
  if ((m = path.match(/^\/video\/([^/]+)$/))) { openVid(decodeURIComponent(m[1])); return; }
  if ((m = path.match(/^\/tag\/(.+)$/))) { openTag(decodeURIComponent(m[1])); return; }
  if ((m = path.match(/^\/cat\/(.+)$/))) { selCat(decodeURIComponent(m[1])); return; }
  if ((m = path.match(/^\/actor\/(.+)$/))) { await showActors(); openActor(decodeURIComponent(m[1])); return; }
  if ((m = path.match(/^\/studio\/(.+)$/))) { await showStudios(); openStudio(decodeURIComponent(m[1])); return; }
  if ((m = path.match(/^\/collection\/(.+)$/))) { showCollections(); openCollectionDetail(decodeURIComponent(m[1])); return; }
  goHome();
}

window.addEventListener('popstate', () => { routeToPath(location.pathname); });

init().then(() => {
  routeToPath(location.pathname);
});
