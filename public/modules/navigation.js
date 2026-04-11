// ─── Init ───
async function init() {
  showSk();
  await fetch('/api/auto-sort', { method: 'POST' }).catch(() => {});
  const [,, , vs] = await Promise.all([load(), loadC(), loadTagSidebar(), fetch('/api/vault/status').then(r => r.json())]);
  if (vs.hidden) $('vaultSB').show(false);
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
    const p = $('vP').el;
    p.pause(); p.src = '';
    curV = null;
    $('pv').remove('on');
    $('vaultV').add('on');
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
    $('zapUI').show(false);
    $('vP').show();
    $('vP_zap').show(false);
    activePlayer = 'vP';
  }
  if (location.pathname !== '/') history.pushState(null, '', '/');
  $('vaultV').remove('on');
  $('vaultSB').remove('on');
  $('scraperV').remove('on');
  $('scraperSB').remove('on');
  $('collectionsV').remove('on');
  $('collectionsSB').remove('on');
  if ($('foldersV').el) $('foldersV').remove('on');
  if ($('foldersSB').el) $('foldersSB').remove('on');
  if ($('booksV').el) $('booksV').remove('on');
  if ($('booksSB').el) $('booksSB').remove('on');
  $('settingsV').remove('on');
  $('settingsSB').remove('on');
  if ($('dbV').el) $('dbV').remove('on');
  if ($('databaseSB').el) $('databaseSB').remove('on');
  vaultMode = false; scraperMode = false; foldersMode = false; importFavsMode = false; collectionsMode = false; settingsMode = false; dbMode = false; booksMode = false;
  curCollection = null;
  $('bv').remove('off');
  $('pv').remove('on');
  $('dv').remove('on');
  $('dupSB').remove('on');
  $('sv').remove('on');
  $('sdv').remove('on');
  $('studioSB').remove('on');
  $('av').remove('on');
  $('adv').remove('on');
  $('actorSB').remove('on');
  $('tagDV').remove('on');
  document.querySelectorAll('#tagList .ci').forEach(el => el.classList.remove('on'));
  dupMode = false;
  studioMode = false;
  curStudio = null;
  actorMode = false;
  curActor = null;
  curTag = null;
  recentMode = false;
  recentVids = [];
  $('recentSB').remove('on');
  const p = $('vP').el;
  p.pause();
  p.src = '';
  curV = null;
  refresh();
}

// ─── Close All Views ───
function closeAllViews() {
  if (mosaicOn) stopMosaic();
  if (curV) {
    $('pv').remove('on');
    const vp = $('vP').el; vp.pause(); vp.src = '';
    curV = null;
  }
  [
    'dv','dupSB','sv','sdv','studioSB','av','adv','actorSB','tagDV',
    'vaultV','vaultSB','scraperV','scraperSB',
    'collectionsV','collectionsSB','foldersV','foldersSB',
    'booksV','booksSB',
    'importFavsV','importFavsSB','settingsV','settingsSB','recentSB'
  ].forEach(id => { const el = $(id).el; if (el) el.classList.remove('on'); });
  document.querySelectorAll('#tagList .ci').forEach(el => el.classList.remove('on'));
  dupMode = false; vaultMode = false; scraperMode = false;
  studioMode = false; curStudio = null;
  actorMode = false; curActor = null;
  collectionsMode = false; curCollection = null;
  foldersMode = false; importFavsMode = false; booksMode = false;
  settingsMode = false; recentMode = false; recentVids = [];
  curTag = null;
}

// ─── Category Selection ───
function selCat(c) {
  closeAllViews();
  cat = c;
  const catUrl = c ? '/cat/' + encodeURIComponent(c) : '/';
  if (location.pathname !== catUrl) history.pushState(null, '', catUrl);
  $('sT').text(c ? cats.find(x => x.path === c)?.name || c : 'All Videos');
  $('bv').remove('off');
  q = '';
  $('sI').val('');
  $('sGhost').html('');
  refresh();
}

// ─── Favourites Toggle ───
function toggleFav() {
  favM = !favM;
  $('fBtn').toggle('on', favM);
  $('sT').text(favM ? 'Favourites' : 'All Videos');
  if (favM) { cat = ''; history.pushState(null, '', '/favourites'); }
  else history.pushState(null, '', '/');
  refresh();
}

// ─── Sorting ───
async function setSort(s, el) {
  sort = s;
  shuf = false;
  document.querySelectorAll('.sb[data-s]').forEach(b => b.classList.toggle('on', b.dataset.s === s));
  document.querySelectorAll('#shBtn, #shBtnTag').forEach(b => b.classList.remove('on'));
  if (curTag) { await openTag(curTag); return; }
  await load(); render();
}

async function toggleShuf() {
  shuf = !shuf;
  document.querySelectorAll('#shBtn, #shBtnTag').forEach(b => b.classList.toggle('on', shuf));
  if (shuf) document.querySelectorAll('.sb[data-s]').forEach(b => b.classList.remove('on'));
  else document.querySelector('.sb[data-s="' + sort + '"]')?.classList.add('on');
  if (curTag) { await openTag(curTag); return; }
  await load(); render();
}

// ─── Recently Watched ───
async function showRecent() {
  if (mosaicOn) stopMosaic();
  if (location.pathname !== '/recent') history.pushState(null, '', '/recent');
  recentMode = true;
  recentVids = [];
  $('recentSB').add('on');
  $('bv').remove('off');
  $('pv').remove('on');
  ['actorSB','studioSB','dupSB','vaultSB','foldersSB','collectionsSB','scraperSB','settingsSB'].forEach(id => {
    const el = $(id).el;
    if (el) el.classList.remove('on');
  });
  cat = ''; q = ''; favM = false;
  $('sI').val('');
  $('sGhost').html('');
  const data = await (await fetch('/api/history')).json();
  recentVids = data;
  $('sT').text('Recently Watched');
  render();
}

// ─── Scraper ───
function showScraper() {
  if (mosaicOn) stopMosaic();
  if (location.pathname !== '/scraper') history.pushState(null, '', '/scraper');
  scraperMode = true;
  $('bv').add('off');
  $('pv').remove('on');
  $('dv').remove('on');
  $('av').remove('on');
  $('adv').remove('on');
  $('sv').remove('on');
  $('sdv').remove('on');
  $('tagDV').remove('on');
  $('vaultV').remove('on');
  document.querySelectorAll('.ci.on').forEach(el => el.classList.remove('on'));
  $('scraperSB').add('on');
  dupMode = false; studioMode = false; actorMode = false; foldersMode = false; collectionsMode = false; settingsMode = false; dbMode = false;
  curActor = null; curStudio = null; curTag = null; curV = null; curCollection = null;
  $('scraperV').add('on');
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
  const ghost = $('sGhost').el;
  const hint = acSuggest(val);
  if (!hint || !val) { ghost.innerHTML = ''; return; }
  ghost.innerHTML = '<span class="sg-typed">' + val + '</span><span class="sg-hint">' + hint + '</span>';
}

const sIEl = $('sI').el;
let sTO;
sIEl.addEventListener('input', e => {
  acUpdateGhost(e.target.value);
  clearTimeout(sTO);
  sTO = setTimeout(() => {
    q = e.target.value.trim();
    refresh();
  }, 300);
});
sIEl.addEventListener('blur', () => { $('sGhost').html(''); });
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
    $('sGhost').html('');
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
  if (path === '/folders') { showFolders(); return; }
  if (path === '/recent') { showRecent(); return; }
  if (path === '/collections') { showCollections(); return; }
  if (path === '/scraper') { showScraper(); return; }
  if (path === '/books') { showBooks(); return; }
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
