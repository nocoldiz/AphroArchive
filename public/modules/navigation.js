// ─── Init ───
async function init() {
  showSk();
  await fetch('/api/auto-sort', { method: 'POST' }).catch(() => {});
  const [,, , vs] = await Promise.all([load(), loadC(), loadTagSidebar(), fetch('/api/vault/status').then(r => r.json())]);
  if (vs.hidden) document.getElementById('vaultSB').style.display = 'none';
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
    const p = document.getElementById('vP');
    p.pause(); p.src = '';
    curV = null;
    document.getElementById('pv').classList.remove('on');
    document.getElementById('vaultV').classList.add('on');
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
    document.getElementById('zapUI').style.display = 'none';
    document.getElementById('vP').style.display = '';
    document.getElementById('vP_zap').style.display = 'none';
    activePlayer = 'vP';
  }
  if (location.pathname !== '/') history.pushState(null, '', '/');
  document.getElementById('vaultV').classList.remove('on');
  document.getElementById('vaultSB').classList.remove('on');
  document.getElementById('scraperV').classList.remove('on');
  document.getElementById('scraperSB').classList.remove('on');
  document.getElementById('collectionsV').classList.remove('on');
  document.getElementById('collectionsSB').classList.remove('on');
  if (document.getElementById('foldersV')) document.getElementById('foldersV').classList.remove('on');
  if (document.getElementById('foldersSB')) document.getElementById('foldersSB').classList.remove('on');
  if (document.getElementById('booksV')) document.getElementById('booksV').classList.remove('on');
  if (document.getElementById('booksSB')) document.getElementById('booksSB').classList.remove('on');
  document.getElementById('settingsV').classList.remove('on');
  document.getElementById('settingsSB').classList.remove('on');
  if (document.getElementById('dbV')) document.getElementById('dbV').classList.remove('on');
  if (document.getElementById('databaseSB')) document.getElementById('databaseSB').classList.remove('on');
  vaultMode = false; scraperMode = false; foldersMode = false; importFavsMode = false; collectionsMode = false; settingsMode = false; dbMode = false; booksMode = false;
  curCollection = null;
  document.getElementById('bv').classList.remove('off');
  document.getElementById('pv').classList.remove('on');
  document.getElementById('dv').classList.remove('on');
  document.getElementById('dupSB').classList.remove('on');
  document.getElementById('sv').classList.remove('on');
  document.getElementById('sdv').classList.remove('on');
  document.getElementById('studioSB').classList.remove('on');
  document.getElementById('av').classList.remove('on');
  document.getElementById('adv').classList.remove('on');
  document.getElementById('actorSB').classList.remove('on');
  document.getElementById('tagDV').classList.remove('on');
  document.querySelectorAll('#tagList .ci').forEach(el => el.classList.remove('on'));
  dupMode = false;
  studioMode = false;
  curStudio = null;
  actorMode = false;
  curActor = null;
  curTag = null;
  recentMode = false;
  recentVids = [];
  document.getElementById('recentSB').classList.remove('on');
  const p = document.getElementById('vP');
  p.pause();
  p.src = '';
  curV = null;
  refresh();
}

// ─── Close All Views ───
function closeAllViews() {
  if (mosaicOn) stopMosaic();
  if (curV) {
    document.getElementById('pv').classList.remove('on');
    const vp = document.getElementById('vP'); vp.pause(); vp.src = '';
    curV = null;
  }
  [
    'dv','dupSB','sv','sdv','studioSB','av','adv','actorSB','tagDV',
    'vaultV','vaultSB','scraperV','scraperSB',
    'collectionsV','collectionsSB','foldersV','foldersSB',
    'booksV','booksSB',
    'importFavsV','importFavsSB','settingsV','settingsSB','recentSB'
  ].forEach(id => { const el = document.getElementById(id); if (el) el.classList.remove('on'); });
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
  document.getElementById('sT').textContent = c ? cats.find(x => x.path === c)?.name || c : 'All Videos';
  document.getElementById('bv').classList.remove('off');
  q = '';
  document.getElementById('sI').value = '';
  document.getElementById('sGhost').innerHTML = '';
  refresh();
}

// ─── Favourites Toggle ───
function toggleFav() {
  favM = !favM;
  document.getElementById('fBtn').classList.toggle('on', favM);
  document.getElementById('sT').textContent = favM ? 'Favourites' : 'All Videos';
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
  document.getElementById('recentSB').classList.add('on');
  document.getElementById('bv').classList.remove('off');
  document.getElementById('pv').classList.remove('on');
  ['actorSB','studioSB','dupSB','vaultSB','foldersSB','collectionsSB','scraperSB','settingsSB'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('on');
  });
  cat = ''; q = ''; favM = false;
  document.getElementById('sI').value = '';
  document.getElementById('sGhost').innerHTML = '';
  const data = await (await fetch('/api/history')).json();
  recentVids = data;
  document.getElementById('sT').textContent = 'Recently Watched';
  render();
}

// ─── Scraper ───
function showScraper() {
  if (mosaicOn) stopMosaic();
  if (location.pathname !== '/scraper') history.pushState(null, '', '/scraper');
  scraperMode = true;
  document.getElementById('bv').classList.add('off');
  document.getElementById('pv').classList.remove('on');
  document.getElementById('dv').classList.remove('on');
  document.getElementById('av').classList.remove('on');
  document.getElementById('adv').classList.remove('on');
  document.getElementById('sv').classList.remove('on');
  document.getElementById('sdv').classList.remove('on');
  document.getElementById('tagDV').classList.remove('on');
  document.getElementById('vaultV').classList.remove('on');
  document.querySelectorAll('.ci.on').forEach(el => el.classList.remove('on'));
  document.getElementById('scraperSB').classList.add('on');
  dupMode = false; studioMode = false; actorMode = false; foldersMode = false; collectionsMode = false; settingsMode = false; dbMode = false;
  curActor = null; curStudio = null; curTag = null; curV = null; curCollection = null;
  document.getElementById('scraperV').classList.add('on');
  ActorScraper.load();
}

// ─── Panoramic Mode ───
function togglePan() {
  const on = document.body.classList.toggle('pan');
  document.getElementById('panBtn').classList.toggle('on', on);
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
  const ghost = document.getElementById('sGhost');
  const hint = acSuggest(val);
  if (!hint || !val) { ghost.innerHTML = ''; return; }
  ghost.innerHTML = '<span class="sg-typed">' + val + '</span><span class="sg-hint">' + hint + '</span>';
}

const sIEl = document.getElementById('sI');
let sTO;
sIEl.addEventListener('input', e => {
  acUpdateGhost(e.target.value);
  clearTimeout(sTO);
  sTO = setTimeout(() => {
    q = e.target.value.trim();
    refresh();
  }, 300);
});
sIEl.addEventListener('blur', () => { document.getElementById('sGhost').innerHTML = ''; });
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
    document.getElementById('sGhost').innerHTML = '';
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
    document.getElementById(name + 'Section').classList.add('closed');
    document.getElementById('sh3-' + name).classList.add('closed');
  }
});
if (localStorage.getItem('pan')) { document.body.classList.add('pan'); document.getElementById('panBtn').classList.add('on'); }

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
