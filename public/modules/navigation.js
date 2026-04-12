// ─── Init ───
async function init() {
  await loadTemplates();
  showSk();
  await fetch('/api/auto-sort', { method: 'POST' }).catch(() => {});
  const [,, , vs] = await Promise.all([load(), loadC(), loadTagSidebar(), fetch('/api/vault/status').then(r => r.json())]);
  if (vs.hidden) $('vault-sidebar').show(false);
  V.sort(() => Math.random() - 0.5);
  render();
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
    if (!importFavsMode && !vaultMode && !studioMode && !actorMode && !dupMode) {
      if (curTag) openTag(curTag); else render();
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
  } else {
    goHome();
  }
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
  vaultMode = false; scraperMode = false; importFavsMode = false; collectionsMode = false; settingsMode = false; dbMode = false; booksMode = false; audioMode = false;
  curCollection = null;
  $('browse-view').remove('off');
  $('player-view').remove('on');
  $('duplicates-view').remove('on');
  $('duplicates-sidebar').remove('on');
  $('studios-view').remove('on');
  $('studio-detail-view').remove('on');
  $('studio-sidebar').remove('on');
  $('actors-view').remove('on');
  $('actor-detail-view').remove('on');
  $('actor-sidebar').remove('on');
  $('tag-detail-view').remove('on');
  document.querySelectorAll('#tagList .sidebar-item').forEach(el => el.classList.remove('on'));
  dupMode = false;
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
  refresh();
}

// ─── Close All Views ───
function closeAllViews() {
  if (mosaicOn) stopMosaic();
  if (curV) {
    $('player-view').remove('on');
    const vp = $('video-player').el; vp.pause(); vp.src = '';
    curV = null;
  }
  [
    'duplicates-view','duplicates-sidebar','studios-view','studio-detail-view','studio-sidebar','actors-view','actor-detail-view','actor-sidebar','tag-detail-view',
    'vault-view','vault-sidebar','scraper-view','scraper-sidebar',
    'collections-view','collections-sidebar',
    'books-view','books-sidebar','audio-view','audio-sidebar','search-sites-view','search-sites-sidebar',
    'import-favs-view','import-favs-sidebar','settings-view','settings-sidebar','database-view','database-sidebar','recent-sidebar'
  ].forEach(id => { const el = $(id).el; if (el) el.classList.remove('on'); });
  document.querySelectorAll('.sidebar-item.on').forEach(el => el.classList.remove('on'));
  dupMode = false; vaultMode = false; scraperMode = false; dbMode = false;
  studioMode = false; curStudio = null;
  actorMode = false; curActor = null;
  collectionsMode = false; curCollection = null;
  importFavsMode = false; booksMode = false; audioMode = false;
  settingsMode = false; recentMode = false; recentVids = [];
  $('clearRecentBtn').show(false);
  $('clearRecentSep').show(false);
  curTag = null;
}

// ─── Category Selection ───
function selCat(c) {
  closeAllViews();
  cat = c;
  const catUrl = c ? '/cat/' + encodeURIComponent(c) : '/';
  if (location.pathname !== catUrl) history.pushState(null, '', catUrl);
  $('section-title').text(c ? cats.find(x => x.path === c)?.name || c : 'All Videos');
  $('browse-view').remove('off');
  q = '';
  $('search-input').val('');
  $('search-ghost').html('');
  refresh();
}

// ─── Favourites Toggle ───
function toggleFav() {
  favM = !favM;
  $('fBtn').toggle('on', favM);
  $('section-title').text(favM ? 'Favourites' : 'All Videos');
  if (favM) { cat = ''; history.pushState(null, '', '/favourites'); }
  else history.pushState(null, '', '/');
  refresh();
}

// ─── Sorting ───
async function setSort(s, el) {
  sort = s;
  shuf = false;
  document.querySelectorAll('.sort-btn[data-s]').forEach(b => b.classList.toggle('on', b.dataset.s === s));
  document.querySelectorAll('#shBtn, #shBtnTag').forEach(b => b.classList.remove('on'));
  if (curTag) { await openTag(curTag); return; }
  await load(); render();
}

async function toggleShuf() {
  shuf = !shuf;
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
    refresh();
  }, 300);
});
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
['cats', 'tags'].forEach(name => {
  if (localStorage.getItem('sc_' + name)) {
    $(name + 'Section').add('closed');
    $('sh3-' + name).add('closed');
  }
});
if (localStorage.getItem('pan')) { document.body.classList.add('pan'); $('panBtn').add('on'); }

// ─── Router ───
async function routeToPath(path) {
  let m;
  if (path === '/' || path === '') { goHome(); return; }
  if (path === '/favourites') { if (!favM) toggleFav(); return; }
  if (path === '/bookmarks') { showImportFavs(); return; }
  if (path === '/duplicates') { showDups(); return; }
  if (path === '/vault') { showVault(); return; }
  if (path === '/recent') { showRecent(); return; }
  if (path === '/collections') { showCollections(); return; }
  if (path === '/scraper') { showScraper(); return; }
  if (path === '/books') { showBooks(); return; }
  if (path === '/audio') { showAudio(); return; }
  if (path === '/search') { showSearchSites(); return; }
  if (path === '/settings') { showSettings(); return; }
  if (path === '/database') { showDatabase(); return; }
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
  if (location.pathname !== '/') routeToPath(location.pathname);
});
