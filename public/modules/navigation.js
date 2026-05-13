

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
  await loadTemplates();
  showSk();
  const [,, vs] = await Promise.all([loadC(), Promise.resolve(), fetch('/api/vault/status').then(r => r.json())]);
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
    'books-view','books-sidebar','audio-view','audio-sidebar','photos-view','photos-sidebar','thumbnails-sidebar','thumbnails-view','pages-view','pages-sidebar','prompts-view','prompts-sidebar','search-sites-view','search-sites-sidebar',
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
  closeAllViews();
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










window.addEventListener('DOMContentLoaded', () => {
  init();
});
