// ─── State ───
let V = [], cats = [], sort = 'date', cat = '', q = '', favM = false, curV = null, renId = null;
let srcFilter = 'both'; // 'both' | 'local' | 'remote'
let recentMode = false, recentVids = [];
let movId = null, movCurCat = '', shuf = false, dupMode = false;
let pinnedV = null, pinnedPl = [], pinnedIdx = 0;
let mosaicOn = false, mosaicTimer = null, mosaicIv = 8;
let vaultMode = false, vaultSelMode = false, scraperMode = false, foldersMode = false, importFavsMode = false;
const vaultSel = new Set(); // selected vault file ids
let vaultFiles = [], vaultPl = [], vaultPlIdx = 0, vaultQ = '', vaultSort = 'date';
const VAULT_IMG_EXTS = new Set(['.jpg','.jpeg','.png','.gif','.webp','.avif','.bmp','.heic']);
let studioMode = false, curStudio = null;
let actorMode = false, curActor = null;
let curTag = null;
const thumbMap = {}, thumbQueue = []; // id -> null|[]|string[]
let thumbRunning = 0, thumbObs = null, hoverTimer = null, hoverEl = null, hoverIdx = 0;
let zapOn = false, zapTimer = null, zapIv = 8, zapLock = false;
let zapNextVid = null, zapNextTime = 0;
let activePlayer = 'vP'; // Tracks which video element is currently visible
const bookmarkVidIds = new Set(); // IDs of videos that match imported bookmarks
const bmMatchedUrls = new Set();  // bookmark URLs that are already downloaded as local videos
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
    // Refresh counts and grid now that bookmarks are loaded
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

function rebuildBookmarkVidIds(items) {
  bookmarkVidIds.clear();
  bmMatchedUrls.clear();
  for (const v of V) {
    const vname = v.name.toLowerCase().replace(/\.[^.]+$/, '');
    for (const it of items) {
      if (it.url.toLowerCase().includes(vname)) {
        bookmarkVidIds.add(v.id);
        bmMatchedUrls.add(it.url);
      }
    }
  }
}

function showSk() {
  $('vG').html(Array(8).fill('<div class="sk skc"></div>').join(''));
}

// ─── Data Fetching ───
async function load() {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (cat) p.set('category', cat);
  p.set('sort', sort);
  V = await (await fetch('/api/videos?' + p)).json();
  if (shuf) V.sort(() => Math.random() - 0.5);
}

async function loadC() {
  cats = await (await fetch('/api/categories')).json();
  renCats();
}

async function createCategory() {
  const name = prompt('New folder name:');
  if (!name || !name.trim()) return;
  const r = await fetch('/api/main-categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) });
  const d = await r.json();
  if (!r.ok) { toast(d.error || 'Failed'); return; }
  toast('Created folder: ' + d.name);
  await loadC();
  refresh();
}

function searchVideoOn(engine) {
  if (!curV) return;
  const q = encodeURIComponent(curV.name);
  if (engine === 'ddg') window.open('https://duckduckgo.com/?q=' + q, '_blank');
  else if (engine === 'yandex') window.open('https://yandex.com/search/?text=' + q, '_blank');
}

async function openVideoFolder() {
  if (!curV) return;
  const r = await fetch('/api/open-folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: curV.id }) });
  if (!r.ok) { const d = await r.json(); toast(d.error || 'Failed'); }
}

// ─── Sidebar Categories ───
function bmCountFor(key, isTag) {
  if (!_bfItems.length || srcFilter === 'local') return 0;
  const kn = bmNorm(key);
  return _bfItems.filter(it => !bmMatchedUrls.has(it.url) && bmNorm(it.title).includes(kn)).length;
}

function renCats() {
  const el = $('cList').el;
  const folderCats = cats.filter(c => !c.isTag);
  const bmTotal = srcFilter !== 'local' ? _bfItems.filter(it => !bmMatchedUrls.has(it.url)).length : 0;
  const all = folderCats.reduce((s, c) => s + c.count, 0) + bmTotal;
  let h = '<div class="ci' + (cat ? '' : ' on') + '" onclick="selCat(\'\')"><span>All Videos</span><span class="n">' + all + '</span></div>';
  cats.forEach(c => {
    const bmC = bmCountFor(c.isTag ? c.name : c.path, c.isTag);
    const displayCount = c.count + bmC;
    if (c.isTag) {
      const on = curTag === c.name && !$('bv').el.classList.contains('off') === false;
      h += '<div class="ci' + (curTag === c.name ? ' on' : '') + '" onclick="openTag(\'' + escA(c.name) + '\')">' +
        '<span>' + esc(c.name) + '</span>' +
        '<span class="n">' + displayCount + '</span></div>';
    } else {
      h += '<div class="ci' + (cat === c.path ? ' on' : '') + '" onclick="selCat(\'' + escA(c.path) + '\')"><span>' + esc(c.name) + '</span><span class="n">' + displayCount + '</span></div>';
    }
  });
  el.innerHTML = h;
}

// ─── Rendering ───
function render() {
  const g = $('vG').el, e = $('emp').el;
  let base = recentMode ? recentVids : favM ? V.filter(v => v.fav) : V;
  const local = srcFilter === 'remote' ? [] : base;
  const bms   = (!recentMode && !favM && srcFilter !== 'local') ? getBmList() : [];
  if (!local.length && !bms.length) {
    g.innerHTML = '';
    e.style.display = 'block';
    $('eT').text(q ? 'No results' : recentMode ? 'No history yet' : favM ? 'No favourites yet' : 'No videos found');
    $('eD').text(q ? 'Nothing matched "' + q + '"' : recentMode ? 'Videos you watch will appear here' : favM ? 'Star videos to save them here' : 'Add videos to your folder');
    return;
  }
  e.style.display = 'none';
  g.innerHTML = local.map(card).join('') + bms.map(bmCard).join('');
  attachThumbs();
  attachBmThumbs();
}

function setSrcFilter(val) {
  srcFilter = val;
  document.querySelectorAll('.src-btn').forEach(b => b.classList.toggle('on', b.dataset.src === val));
  if (curTag) { openTag(curTag); return; }
  render();
}

// ─── Bookmark cards in main grid ───
let bmThumbObs = null;

function bmNorm(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

function getBmList() {
  if (!_bfItems.length) return [];
  let items = _bfItems.filter(it => !bmMatchedUrls.has(it.url));
  if (cat) { const cn = bmNorm(cat); items = items.filter(it => bmNorm(it.title).includes(cn)); }
  if (curTag) { const tn = bmNorm(curTag); items = items.filter(it => bmNorm(it.title).includes(tn)); }
  if (q) { const ql = q.toLowerCase(); items = items.filter(it => it.title.toLowerCase().includes(ql) || it.url.toLowerCase().includes(ql)); }
  return items;
}

function bmCard(item) {
  let hostname = '';
  try { hostname = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const encUrl = escA(item.url);
  const hasCached = !!item.img;
  const thumbStyle = hasCached
    ? 'background:url(' + escA(item.img) + ') center/cover no-repeat'
    : 'background:linear-gradient(135deg,#3b82f612 0%,#06b6d406 100%)';
  const ctClass = 'ct bm-ct' + (hasCached ? ' has-thumb' : '');
  const needsObs = hasCached ? '' : ' data-bm-url="' + encUrl + '"';
  return '<a class="vc fi bm-card" href="' + encUrl + '" target="_blank" rel="noopener" data-bm-url="' + encUrl + '">' +
    '<div class="' + ctClass + '"' + needsObs + ' style="' + thumbStyle + '">' +
    (hasCached ? '' : '<span class="eb" style="background:rgba(59,130,246,.18);color:#3b82f6">URL</span>') +
    '<div class="po" style="opacity:.55"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></div>' +
    '</div>' +
    '<div class="cb"><div class="ctit" title="' + encUrl + '">' + esc(item.title) + '</div>' +
    '<div class="cm"><span class="ccat">' + esc(hostname) + '</span>' +
    '<div class="ca"><button onclick="event.preventDefault();event.stopPropagation();bmRemove(\'' + encUrl + '\')" title="Remove bookmark"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>' +
    '</div></div></a>';
}

function bmRemove(url) {
  _bfItems = _bfItems.filter(it => it.url !== url);
  bmMatchedUrls.delete(url);
  bfSaveCache();
  document.querySelectorAll('.bm-card').forEach(el => { if (el.dataset.bmUrl === url) el.remove(); });
}

function initBmThumbObs() {
  if (bmThumbObs) return;
  bmThumbObs = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      bmThumbObs.unobserve(e.target);
      loadBmThumb(e.target);
    }
  }, { rootMargin: '300px' });
}

async function loadBmThumb(el) {
  const url = el.dataset.bmUrl;
  if (!url) return;
  try {
    const d = await (await fetch('/api/og-thumb?url=' + encodeURIComponent(url))).json();
    if (d.img) {
      applyThumb(el, d.img);
      // Persist img into the bookmark item so next render uses it immediately
      const item = _bfItems.find(it => it.url === url);
      if (item && item.img !== d.img) { item.img = d.img; bfSaveCache(); }
    }
  } catch {}
}

function attachBmThumbs() {
  initBmThumbObs();
  document.querySelectorAll('.bm-ct[data-bm-url]').forEach(el => bmThumbObs.observe(el));
}

function card(v) {
  const cols = ['#e84040', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];
  const c = cols[Math.abs(hsh(v.category)) % cols.length];
  return '<a class="vc fi" href="/video/' + v.id + '" onclick="event.preventDefault();openVid(\'' + v.id + '\')">' +
    '<div class="ct" data-vid="' + v.id + '" style="background:linear-gradient(135deg,' + c + '12 0%,' + c + '06 100%)">' +
    '<span class="eb">' + v.ext.replace('.', '') + '</span>' +
    '<div class="po"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></div>' +
    (v.durationF ? '<span class="durb">' + v.durationF + '</span>' : '') +
    '<span class="szb">' + v.sizeF + '</span>' +
    (v.rating ? '<div class="vr-badge"><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' + v.rating + '</div>' : '') +
    '</div>' +
    '<div class="cb"><div class="ctit" title="' + escA(v.name) + '">' + esc(v.name) + '</div>' +
    '<div class="cm"><span class="ccat">' + esc(v.category) + '</span>' +
    '<div class="ca">' +
    '<button class="' + (v.fav ? 'st' : '') + '" onclick="event.preventDefault();event.stopPropagation();togStar(\'' + v.id + '\')"><svg width="14" height="14" viewBox="0 0 24 24" fill="' + (v.fav ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></button>' +
    (!v.external ? '<button onclick="event.preventDefault();event.stopPropagation();openRen(\'' + v.id + '\',\'' + escA(v.name) + '\')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>' +
    '<button onclick="event.preventDefault();event.stopPropagation();openMov(\'' + v.id + '\',\'' + escA(v.name) + '\',\'' + escA(v.catPath || '') + '\')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button>' +
    '<button onclick="event.preventDefault();event.stopPropagation();openVidTag(\'' + v.id + '\')" title="Edit tags"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></button>' : '') +
    '</div></div></div></a>';
}

// ─── Navigation ───
async function openVid(id) {
  if (location.pathname !== '/video/' + id) history.pushState(null, '', '/video/' + id);
  fetch('/api/history/' + id, { method: 'POST' });
  const d = await (await fetch('/api/videos/' + id)).json();
  curV = d.video;
  $('bv').add('off');
  $('pv').add('on');
  $('vP').el.src = '/api/stream/' + id;
  $('pT').text(curV.name);
  $('pC').text(curV.category);
  $('pS').text(curV.sizeF);
  $('pD').text(curV.durationF || '');
  updPStar();
  const actorsEl = $('pActors').el;
  if (d.actors && d.actors.length) {
    actorsEl.innerHTML = d.actors.map(a =>
      '<button class="p-actor-tag" onclick="openActorFromVideo(\'' + escA(a) + '\')">' +
      '<img class="p-actor-ph" src="/api/actor-photos/' + encodeURIComponent(a) + '/img" alt="" onerror="this.style.display=\'none\'">' +
      esc(a) + '</button>'
    ).join('');
  } else {
    actorsEl.innerHTML = '';
  }
  curVTags = d.tags || [];
  curVAllCategories = d.allCategories || [];
  curVActors = d.actors || [];
  renderVideoTags();
  renderRating(d.video.rating || null);
  renderPlaylist();
  $('sG').html(d.suggested.map(card).join(''));
  attachThumbs();
  requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'instant' }));
}

async function openVidTag(id) {
  await openVid(id);
  requestAnimationFrame(() => {
    const row = $('pTagsRow').el;
    if (row && row.style.display !== 'none') toggleTagPicker();
  });
}

// ─── Rating ───
let curVRating = null;

function renderRating(rating) {
  curVRating = rating;
  const el = $('pRating').el;
  if (!el) return;
  if (curV && curV.isVault) { el.innerHTML = ''; return; }
  let html = '';
  for (let i = 1; i <= 5; i++) {
    html += '<button class="p-star' + (rating >= i ? ' on' : '') + '" ' +
      'onclick="setRating(' + i + ')" ' +
      'onmouseenter="hoverRating(' + i + ')" ' +
      'onmouseleave="hoverRating(' + (rating || 0) + ')">★</button>';
  }
  if (rating) html += '<button class="p-star-clear" onclick="clearRating()" onmouseenter="hoverRating(' + (rating || 0) + ')" title="Remove rating">✕</button>';
  el.innerHTML = html;
}

function hoverRating(n) {
  document.querySelectorAll('#pRating .p-star').forEach((el, i) => {
    el.classList.toggle('on', i < n);
  });
}

async function setRating(stars) {
  if (!curV || curV.isVault) return;
  if (curVRating === stars) { await clearRating(); return; }
  const r = await fetch('/api/ratings/' + encodeURIComponent(curV.id), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stars })
  });
  if (!r.ok) { toast('Failed to save rating'); return; }
  renderRating(stars);
  const v = V.find(x => x.id === curV.id);
  if (v) v.rating = stars;
}

async function clearRating() {
  if (!curV) return;
  await fetch('/api/ratings/' + encodeURIComponent(curV.id), { method: 'DELETE' });
  renderRating(null);
  const v = V.find(x => x.id === curV.id);
  if (v) v.rating = null;
}

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
  $('settingsV').remove('on');
  $('settingsSB').remove('on');
  if ($('dbV').el) $('dbV').remove('on');
  if ($('databaseSB').el) $('databaseSB').remove('on');
  vaultMode = false; scraperMode = false; foldersMode = false; importFavsMode = false; collectionsMode = false; settingsMode = false; dbMode = false;
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

// ─── Sorting & Filtering ───
async function setSort(s, el) {
  sort = s;
  shuf = false;
  document.querySelectorAll('.sb[data-s]').forEach(b => b.classList.toggle('on', b.dataset.s === s));
  document.querySelectorAll('#shBtn, #shBtnTag').forEach(b => b.classList.remove('on'));
  if (curTag) { await openTag(curTag); return; }
  await load(); render();
}

// ─── Close all section/mode views ───
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
    'importFavsV','importFavsSB','settingsV','settingsSB','recentSB'
  ].forEach(id => { const el = $(id).el; if (el) el.classList.remove('on'); });
  document.querySelectorAll('#tagList .ci').forEach(el => el.classList.remove('on'));
  dupMode = false; vaultMode = false; scraperMode = false;
  studioMode = false; curStudio = null;
  actorMode = false; curActor = null;
  collectionsMode = false; curCollection = null;
  foldersMode = false; importFavsMode = false;
  settingsMode = false; recentMode = false; recentVids = [];
  curTag = null;
}

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

function toggleFav() {
  favM = !favM;
  $('fBtn').toggle('on', favM);
  $('sT').text(favM ? 'Favourites' : 'All Videos');
  if (favM) { cat = ''; history.pushState(null, '', '/favourites'); }
  else history.pushState(null, '', '/');
  refresh();
}

// ─── Search Autocomplete ───
let acTerms = [];
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
  return match.slice(last.length); // the part to append
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

async function refresh() {
  if (recentMode) {
    recentMode = false;
    recentVids = [];
    $('recentSB').remove('on');
    $('bv').remove('off');
  }
  if (vaultMode) {
    $('vaultV').remove('on');
    $('vaultSB').remove('on');
    $('bv').remove('off');
    vaultMode = false;
  }
  if (studioMode) {
    $('sv').remove('on');
    $('sdv').remove('on');
    $('studioSB').remove('on');
    $('bv').remove('off');
    studioMode = false;
    curStudio = null;
  }
  if (actorMode) {
    $('av').remove('on');
    $('adv').remove('on');
    $('actorSB').remove('on');
    $('bv').remove('off');
    actorMode = false;
    curActor = null;
  }
  if (curTag) {
    $('tagDV').remove('on');
    document.querySelectorAll('#tagList .ci').forEach(el => el.classList.remove('on'));
    $('bv').remove('off');
    curTag = null;
  }
  await load();
  await loadC();
  await loadTagSidebar();
  render();
}

// ─── Favourites ───
async function togStar(id) {
  const d = await (await fetch('/api/favourites/' + id, { method: 'POST' })).json();
  const v = V.find(x => x.id === id);
  if (v) v.fav = d.fav;
  render();
  toast(d.fav ? '\u2605 Added to favourites' : 'Removed from favourites');
}

async function togglePStar() {
  if (!curV) return;
  const d = await (await fetch('/api/favourites/' + curV.id, { method: 'POST' })).json();
  curV.fav = d.fav;
  updPStar();
  toast(d.fav ? '\u2605 Added to favourites' : 'Removed from favourites');
}

function updPStar() {
  const b = $('pSB').el;
  b.classList.toggle('st', curV?.fav);
  b.querySelector('svg').setAttribute('fill', curV?.fav ? 'currentColor' : 'none');
}

// ─── Rename ───
function openRen(id, name) {
  renId = id;
  $('rI').val(name);
  $('rE').show(false);
  $('rM').add('on');
  setTimeout(() => $('rI').el.focus(), 50);
}

function openRenP() { if (curV) openRen(curV.id, curV.name); }

// ─── Extract actor names from title ───
function extractActorNames(title, knownActors = []) {
  const found = new Set(knownActors);

  // Strip file extension
  let t = title.replace(/\.[a-z0-9]{2,5}$/i, '').trim();

  // Capture underscore-style names (Aiden_guy → "Aiden guy")
  t.replace(/\b([A-Za-z]+_[A-Za-z]+(?:_[A-Za-z]+)*)\b/g, (_, g) => { found.add(g.replace(/_/g, ' ')); });
  t = t.replace(/_/g, ' ');

  // CamelCase words: TheBuffBoy, SamirOneBoy
  (t.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g) || []).forEach(w => found.add(w));

  const stop = new Set([
    'video','the','a','an','in','on','at','to','for','of','or','but',
    'makes','make','takes','take','adores','adore','loves','love',
    'watches','watch','shopping','fitting','room','night','romantic',
    'amend','cry','him','her','them','from','by','hot','sexy',
    'goes','going','wants','gets','got','part','episode','scene',
    'compilation','vol','ft','feat','his','their','our','your','my',
    'he','she','they','we','you','i','tv','rfc'
  ]);

  // Extract consecutive title-case word sequences (First Last, Marco Maxxx…)
  function capSeqs(text) {
    const results = [], words = text.split(/\s+/);
    let cur = [];
    for (const w of words) {
      const c = w.replace(/[^a-zA-Z]/g, '');
      if (c.length > 1 && /^[A-Z][a-z]/.test(c) && !stop.has(c.toLowerCase())) {
        cur.push(c);
      } else {
        if (cur.length) { results.push(cur.join(' ')); cur = []; }
      }
    }
    if (cur.length) results.push(cur.join(' '));
    return results;
  }

  // Verbs that typically separate two actor names in a narrative title
  const verbPat = /\b(makes?\s+\w+(?:\s+\w+)?\s+for|adores?|loves?|takes?\b|watches?|goes?\s+\w+|and)\b/i;

  const dashSegs = t.split(/\s*[–—]\s*/);

  for (const seg of dashSegs) {
    // Pattern: "Name [verb] Name"
    const vm = seg.match(verbPat);
    if (vm) {
      const vi = seg.search(verbPat);
      const before = seg.slice(0, vi).trim();
      const after  = seg.slice(vi + vm[0].length).trim();
      capSeqs(before).forEach(n => found.add(n));
      const afterSeqs = capSeqs(after);
      if (afterSeqs.length) found.add(afterSeqs[0]); // first name sequence after verb
    }

    // Pattern: "with Name, Name, Name"
    const wm = seg.match(/\bwith\s+([A-Z][^–—]+?)(?=\s*$|\s*[,–—]|$)/);
    if (wm) {
      (wm[1] + ',' + seg.slice(seg.indexOf(wm[0]) + wm[0].length))
        .split(/,\s*/).forEach(p => capSeqs(p.trim()).forEach(n => found.add(n)));
    }
    const wm2 = seg.match(/\bwith\s+(.+)/i);
    if (wm2) wm2[1].split(/,\s*/).forEach(p => capSeqs(p.trim()).forEach(n => found.add(n)));

    // Pattern: "featuring/feat Name"
    const fm = seg.match(/\b(?:featuring|feat\.?)\s+([A-Z][^,–—]+)/i);
    if (fm) capSeqs(fm[1].trim()).forEach(n => found.add(n));

    // Pattern: "and Name" anywhere
    const andRe = /\band\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/g;
    let am;
    while ((am = andRe.exec(seg)) !== null) capSeqs(am[1]).forEach(n => found.add(n));
  }

  // First segment before a dash: username or clean name list
  if (dashSegs.length > 1) {
    const first = dashSegs[0].trim();
    const words = first.split(/\s+/);
    if (words.length === 1) {
      // Single word username (e.g. "Svandylove") — not an ALL-CAPS acronym
      if (/^[A-Z][a-zA-Z]+$/.test(first) && !/^[A-Z]{2,}$/.test(first)) found.add(first);
    } else if (!verbPat.test(first)) {
      // Multi-word without story verbs — treat as comma-separated name list
      first.split(/,\s*/).forEach(p => capSeqs(p.trim()).forEach(n => found.add(n)));
    }
  }

  return [...found].filter(n => n && n.length > 1 && !stop.has(n.toLowerCase()));
}

function extractAndRenameActors() {
  if (!curV) return;
  const actors = extractActorNames(curV.name, curVActors);
  if (!actors.length) { toast('No actor names detected'); return; }
  const newName = actors.join(', ') + ' - ' + curV.name;
  openRen(curV.id, newName);
}
function closeRen() { $('rM').remove('on'); renId = null; }

async function doRen() {
  const n = $('rI').el.value.trim();
  if (!n) return;
  const r = await fetch('/api/videos/' + renId + '/rename', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newName: n })
  });
  const d = await r.json();
  if (!r.ok) {
    const e = $('rE').el;
    e.textContent = d.error || 'Failed';
    e.style.display = 'block';
    return;
  }
  closeRen();
  toast('Renamed successfully');
  if (curV && curV.id === renId) {
    curV.id = d.newId;
    curV.name = n;
    $('pT').text(n);
    const p = $('vP').el, t = p.currentTime;
    p.src = '/api/stream/' + d.newId;
    p.currentTime = t;
  }
  await refresh();
}

// ─── Move ───
async function openMov(id, name, curCatPath) {
  movId = id;
  movCurCat = curCatPath;
  $('mvInfo').text('Moving: ' + name);
  $('mvE').show(false);
  $('mvNew').val('');
  const norm = p => p.replace(/\\/g, '/');
  const mainCats = await (await fetch('/api/main-categories')).json();
  const list = $('mvList').el;
  list.innerHTML = mainCats.map(c => {
    const isCur = norm(c.path) === norm(curCatPath);
    return '<div class="mv-item' + (isCur ? ' cur' : '') + '" data-cat="' + esc(c.path) + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' +
      '<span>' + esc(c.name) + '</span></div>';
  }).join('');
  list.querySelectorAll('.mv-item:not(.cur)').forEach(el => {
    el.addEventListener('click', () => doMove(el.dataset.cat));
  });
  $('mvM').add('on');
}

function openMovP() { if (curV) openMov(curV.id, curV.name, curV.catPath || ''); }
function closeMov() { $('mvM').remove('on'); movId = null; }

async function doMove(targetCat) {
  if (!movId) return;
  const r = await fetch('/api/videos/' + movId + '/move', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: targetCat })
  });
  const d = await r.json();
  if (!r.ok) {
    const e = $('mvE').el;
    e.textContent = d.error || 'Move failed';
    e.style.display = 'block';
    return;
  }
  closeMov();
  toast('Moved to ' + (targetCat || 'Uncategorized'));
  if (curV && curV.id === movId) {
    curV.id = d.newId;
    curV.catPath = targetCat;
    curV.category = targetCat || 'Uncategorized';
    $('pC').text(curV.category);
    const p = $('vP').el, t = p.currentTime;
    p.src = '/api/stream/' + d.newId;
    p.currentTime = t;
  }
  await refresh();
}

async function doMoveNew() {
  const name = $('mvNew').el.value.trim();
  if (!name) return;
  const safe = name.replace(/[<>:"/\\|?*]/g, '_');
  await doMove(safe);
}

// ─── Modal close handlers ───
$('rM').el.addEventListener('click', e => { if (e.target === $('rM').el) closeRen(); });
$('mvM').el.addEventListener('click', e => { if (e.target === $('mvM').el) closeMov(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeRen(); closeMov(); if (mosaicOn) stopMosaic(); closeBfIframe(); }
  if (e.key === 'Enter' && renId) doRen();
});

// ─── Duplicates ───
function fmtBytes(b) {
  if (!b) return '0 B';
  const k = 1024, s = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(1) + ' ' + s[i];
}

function showDups() {
  if (location.pathname !== '/duplicates') history.pushState(null, '', '/duplicates');
  dupMode = true;
  $('bv').add('off');
  $('pv').remove('on');
  $('dv').add('on');
  $('dupSB').add('on');
  $('vaultV').remove('on');
  $('vaultSB').remove('on');
  $('scraperV').remove('on');
  $('scraperSB').remove('on');
  $('settingsV').remove('on');
  $('settingsSB').remove('on');
  if ($('dbV').el) $('dbV').remove('on');
  vaultMode = false; scraperMode = false; importFavsMode = false; settingsMode = false; dbMode = false;
  $('av').remove('on');
  $('adv').remove('on');
  $('actorSB').remove('on');
  $('sv').remove('on');
  $('sdv').remove('on');
  $('studioSB').remove('on');
  $('tagDV').remove('on');
  document.querySelectorAll('#tagList .ci').forEach(el => el.classList.remove('on'));
  studioMode = false; curStudio = null;
  actorMode = false; curActor = null;
  curTag = null;
  if (curV) {
    const vp = $('vP').el;
    vp.pause(); vp.src = '';
    curV = null;
  }
  loadDups();
}

async function loadDups() {
  $('dupContent').html('<div class="dup-scan">Scanning for duplicates\u2026</div>');
  const groups = await (await fetch('/api/duplicates')).json();
  renderDups(groups);
}

function renderDups(groups) {
  const el = $('dupContent').el;
  const nBtn = $('dupN').el;
  if (!groups.length) {
    nBtn.style.display = 'none';
    el.innerHTML = '<div class="es" style="padding:40px 20px"><h3>No duplicates found</h3><p>All videos appear to be unique</p></div>';
    return;
  }
  nBtn.textContent = groups.length;
  nBtn.style.display = '';
  const totalVids = groups.reduce((s, g) => s + g.length, 0);
  const wasted = groups.reduce((s, g) => s + g[0].size * (g.length - 1), 0);
  const cols = ['#e84040','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];
  let h = '<div class="dup-meta">' + totalVids + ' videos across ' + groups.length + ' groups &mdash; <b>' + fmtBytes(wasted) + '</b> potentially wasted</div>';
  groups.forEach(group => {
    h += '<div class="dup-group">';
    h += '<div class="dup-gh"><span class="dup-cnt">' + group.length + ' copies</span> &nbsp;&bull;&nbsp; ' + group[0].sizeF + ' each</div>';
    h += '<div class="dup-cards">';
    group.forEach(v => {
      const c = cols[Math.abs(hsh(v.category)) % cols.length];
      const bg = 'linear-gradient(135deg,' + c + '12 0%,' + c + '06 100%)';
      h += '<div class="dup-card">';
      h += '<div class="dup-th" data-vid="' + v.id + '" style="background:' + bg + '" onclick="openVid(\'' + v.id + '\')">';
      h += '<div class="po"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></div></div>';
      h += '<div class="dup-info">';
      h += '<div class="dup-name" title="' + escA(v.name) + '">' + esc(v.name) + '</div>';
      h += '<div class="dup-cat">' + esc(v.rel) + '</div>';
      h += '<button class="dup-del" onclick="delVideo(\'' + v.id + '\')">Delete</button>';
      h += '</div></div>';
    });
    h += '</div></div>';
  });
  el.innerHTML = h;
  attachThumbs();
}

async function delVideo(id) {
  if (!confirm('Permanently delete this video file?')) return;
  const r = await fetch('/api/videos/' + id, { method: 'DELETE' });
  const d = await r.json();
  if (!r.ok) { toast(d.error || 'Delete failed'); return; }
  delete thumbMap[id];
  toast('Deleted');
  if (dupMode) loadDups(); else { V = V.filter(v => v.id !== id); render(); }
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
  // deselect other sidebar items
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

// ─── Vault ───
async function showVault() {
  if (mosaicOn) stopMosaic();
  if (location.pathname !== '/vault') history.pushState(null, '', '/vault');
  vaultMode = true;
  // hide everything else
  $('bv').add('off');
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
  dupMode = false; studioMode = false; curStudio = null; actorMode = false; curActor = null; curTag = null;
  if (curV) { const vp = $('vP').el; vp.pause(); vp.src = ''; curV = null; }
  $('vaultSB').add('on');
  $('vaultV').add('on');
  loadVaultView();
}

async function loadVaultView() {
  const s = await (await fetch('/api/vault/status')).json();
  const auth = $('vaultAuth').el;
  const files = $('vaultFiles').el;
  const btn = $('vaultAuthBtn').el;
  const err = $('vaultErr').el;
  err.textContent = '';
  if (s.unlocked) {
    auth.style.display = 'none';
    files.style.display = 'block';
    loadVaultFiles();
  } else if (!s.configured) {
    auth.style.display = 'flex';
    files.style.display = 'none';
    $('vaultAuthTitle').text('Create Vault');
    $('vaultAuthDesc').text('Set a master password. It cannot be changed or recovered.');
    $('vaultPwConfirm').el.style.display = 'block';
    btn.textContent = 'Create Vault';
    btn.onclick = doVaultSetup;
  } else {
    auth.style.display = 'flex';
    files.style.display = 'none';
    $('vaultAuthTitle').text('Vault Locked');
    $('vaultAuthDesc').text('Enter your password to access encrypted files.');
    $('vaultPwConfirm').show(false);
    btn.textContent = 'Unlock';
    btn.onclick = doVaultUnlock;
  }
}

async function doVaultSetup() {
  const pw = $('vaultPw').el.value;
  const pw2 = $('vaultPwConfirm').el.value;
  const err = $('vaultErr').el;
  const btn = $('vaultAuthBtn').el;
  err.textContent = '';
  if (pw.length < 6) { err.textContent = 'Password must be at least 6 characters'; return; }
  if (pw !== pw2) { err.textContent = 'Passwords do not match'; return; }
  btn.disabled = true; btn.textContent = 'Creating…';
  const r = await fetch('/api/vault/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
  const d = await r.json();
  btn.disabled = false;
  if (!r.ok) { err.textContent = d.error || 'Failed'; btn.textContent = 'Create Vault'; return; }
  $('vaultPw').val('');
  $('vaultPwConfirm').val('');
  loadVaultView();
}

async function doVaultUnlock() {
  const pw = $('vaultPw').el.value;
  const err = $('vaultErr').el;
  const btn = $('vaultAuthBtn').el;
  err.textContent = '';
  btn.disabled = true; btn.textContent = 'Verifying…';
  const r = await fetch('/api/vault/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
  const d = await r.json();
  btn.disabled = false; btn.textContent = 'Unlock';
  if (!r.ok) { err.textContent = d.error || 'Wrong password'; return; }
  $('vaultPw').val('');
  loadVaultView();
}

async function lockVault() {
  await fetch('/api/vault/lock', { method: 'POST' });
  loadVaultView();
}

async function loadVaultFiles() {
  vaultQ = ''; vaultSort = 'date';
  const vsi = $('vaultSearchInput').el;
  if (vsi) vsi.value = '';
  document.querySelectorAll('.vault-sort-btn').forEach(b => b.classList.toggle('on', b.dataset.sort === 'date'));
  vaultSelMode = false;
  vaultSel.clear();
  updateVaultSelBar();
  const selBtn = $('vaultSelBtn').el;
  if (selBtn) selBtn.classList.remove('on');
  const grid = $('vaultGrid').el;
  const empty = $('vaultEmpty').el;
  grid.innerHTML = '<div class="dup-scan">Loading\u2026</div>';
  empty.style.display = 'none';
  const files = await (await fetch('/api/vault/files')).json();
  if (files.error) { grid.innerHTML = ''; return; }
  vaultFiles = files;
  renderVaultGrid();
}

function renderVaultGrid() {
  const grid = $('vaultGrid').el;
  const empty = $('vaultEmpty').el;
  const q = vaultQ.toLowerCase();
  let files = q ? vaultFiles.filter(f => (f.name || f.originalName).toLowerCase().includes(q)) : vaultFiles.slice();
  if (vaultSort === 'size-asc') files.sort((a, b) => a.size - b.size);
  else if (vaultSort === 'size-desc') files.sort((a, b) => b.size - a.size);
  else if (vaultSort === 'name') files.sort((a, b) => (a.name || a.originalName).localeCompare(b.name || b.originalName));
  // 'date' keeps server order (newest first)
  if (!files.length) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    empty.querySelector('p').textContent = vaultQ ? 'No results for "' + vaultQ + '"' : 'Add video files using the button above';
    return;
  }
  empty.style.display = 'none';
  const cols = ['#e84040','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];
  grid.innerHTML = files.map(f => {
    const isImg = VAULT_IMG_EXTS.has(f.ext.toLowerCase());
    const c = cols[Math.abs(hsh(f.originalName)) % cols.length];
    const ctClass = 'ct vault-ct' + (isImg ? ' has-thumb' : '');
    const ctStyle = isImg ? 'cursor:pointer' : 'background:linear-gradient(135deg,' + c + '12 0%,' + c + '06 100%);cursor:pointer';
    const inner = isImg
      ? '<img src="/api/vault/stream/' + escA(f.id) + '" alt="" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">'
      : '<span class="eb">' + f.ext.replace('.','') + '</span>';
    return '<div class="vc fi" data-vault-id="' + escA(f.id) + '">' +
      '<div class="' + ctClass + '" style="' + ctStyle + '" onclick="vaultCardClick(\'' + escA(f.id) + '\',\'' + escA(f.name || f.originalName) + '\',\'' + escA(f.ext) + '\')">' +
      inner +
      '<div class="vault-chk" id="vchk-' + escA(f.id) + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>' +
      '<div class="po"></div>' +
      '<span class="szb">' + f.sizeF + '</span></div>' +
      '<div class="cb"><div class="ctit" title="' + escA(f.originalName) + '">' + esc(f.name || f.originalName) + '</div>' +
      '<div class="cm"><span class="ccat" style="color:var(--ac)">Vault</span>' +
      '<div class="ca"><button onclick="deleteVaultFile(\'' + escA(f.id) + '\')" title="Delete"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg></button></div></div></div></div>';
  }).join('');
}

function searchVault(q) {
  vaultQ = q;
  const clr = $('vaultSearchClear').el;
  if (clr) clr.style.display = q ? '' : 'none';
  renderVaultGrid();
}

function setVaultSort(s) {
  vaultSort = s;
  document.querySelectorAll('.vault-sort-btn').forEach(b => b.classList.toggle('on', b.dataset.sort === s));
  renderVaultGrid();
}

async function addVaultFiles() {
  const input = $('vaultFileIn').el;
  const files = input.files;
  if (!files.length) return;
  const prog = $('vaultProgress').el;
  prog.style.display = 'block';
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    prog.textContent = 'Encrypting ' + (i + 1) + '/' + files.length + ': ' + f.name + '\u2026';
    const r = await fetch('/api/vault/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(f.name) },
      body: f
    });
    if (!r.ok) toast('Failed to encrypt: ' + f.name);
  }
  prog.style.display = 'none';
  input.value = '';
  loadVaultFiles();
  toast('Encrypted and stored in vault');
}

async function openVaultVid(id, name, ext) {
  $('bv').add('off');
  $('vaultV').remove('on');
  $('pv').add('on');
  $('vP').el.src = '/api/vault/stream/' + id;
  $('pT').text(name);
  $('pC').text('Vault');
  $('pS').text('');
  $('pD').text('');
  $('sG').html('');
  curV = { id, name, category: 'Vault', fav: false, isVault: true };
  curVTags = []; curVAllCategories = []; curVActors = [];
  renderVideoTags();
  renderRating(null);
  updPStar();
  // Build vault video playlist from current search results (exclude images)
  if (!vaultFiles.length) vaultFiles = await (await fetch('/api/vault/files')).then(r => r.json()).catch(() => []);
  const _vaultBase = vaultQ ? vaultFiles.filter(f => (f.name || f.originalName).toLowerCase().includes(vaultQ.toLowerCase())) : vaultFiles;
  vaultPl = _vaultBase.filter(f => !VAULT_IMG_EXTS.has((f.ext || '').toLowerCase()));
  vaultPlIdx = vaultPl.findIndex(f => f.id === id);
  if (vaultPlIdx < 0) vaultPlIdx = 0;
  renderVaultPlaylist();
  window.scrollTo(0, 0);
}

function renderVaultPlaylist() {
  const listEl = $('pplList').el;
  const countEl = $('pplCount').el;
  countEl.textContent = vaultPl.length + ' video' + (vaultPl.length !== 1 ? 's' : '');
  if (!vaultPl.length) { listEl.innerHTML = '<div class="ppl-empty">No videos in vault</div>'; return; }
  const cols = ['#e84040','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];
  listEl.innerHTML = vaultPl.map((f, i) => {
    const c = cols[Math.abs(hsh(f.originalName)) % cols.length];
    const isCur = curV && f.id === curV.id;
    return '<div class="ppl-item' + (isCur ? ' cur' : '') + '" id="vppl-' + escA(f.id) + '" onclick="vaultCardClick(\'' + escA(f.id) + '\',\'' + escA(f.name || f.originalName) + '\',\'' + escA(f.ext) + '\')">' +
      '<div class="ct ppl-ct" style="background:linear-gradient(135deg,' + c + '12 0%,' + c + '06 100%)">' +
        '<div class="po" style="transform:translate(-50%,-50%) scale(0.6)"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></div>' +
        '<span class="szb">' + f.sizeF + '</span>' +
      '</div>' +
      '<div class="ppl-info">' +
        '<span class="ppl-num">' + (i + 1) + '</span>' +
        '<span class="ppl-name">' + esc(f.name || f.originalName) + '</span>' +
        '<span class="ppl-cat">Vault</span>' +
      '</div></div>';
  }).join('');
  const curEl = $('vppl-' + (curV ? curV.id : '').el);
  if (curEl) setTimeout(() => curEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
}

async function deleteVaultFile(id) {
  if (!confirm('Permanently delete this encrypted file?')) return;
  const r = await fetch('/api/vault/files/' + id, { method: 'DELETE' });
  if (!r.ok) { toast('Delete failed'); return; }
  toast('Deleted');
  loadVaultFiles();
}

const VAULT_IMAGE_EXTS = new Set(['.jpg','.jpeg','.png','.gif','.webp','.avif','.bmp','.heic']);
function vaultCardClick(id, name, ext) {
  if (vaultSelMode) toggleVaultSel(id);
  else if (VAULT_IMAGE_EXTS.has(ext.toLowerCase())) openVaultPhoto(id, name);
  else openVaultVid(id, name, ext);
}

function openVaultPhoto(id, name) {
  const overlay = $('vaultPhotoOverlay').el;
  $('vaultPhotoImg').el.src = '/api/vault/stream/' + id;
  $('vaultPhotoName').text(name);
  overlay.classList.add('on');
  document.addEventListener('keydown', _vaultPhotoKey);
}

function closeVaultPhoto() {
  $('vaultPhotoOverlay').remove('on');
  $('vaultPhotoImg').el.src = '';
  document.removeEventListener('keydown', _vaultPhotoKey);
}

function _vaultPhotoKey(e) { if (e.key === 'Escape') closeVaultPhoto(); }

function toggleVaultSelMode() {
  vaultSelMode = !vaultSelMode;
  const btn = $('vaultSelBtn').el;
  if (btn) btn.classList.toggle('on', vaultSelMode);
  const grid = $('vaultGrid').el;
  if (grid) grid.classList.toggle('vault-sel-mode', vaultSelMode);
  if (!vaultSelMode) { clearVaultSelection(); }
}

function toggleVaultSel(id) {
  if (vaultSel.has(id)) vaultSel.delete(id); else vaultSel.add(id);
  const chk = $('vchk-' + id).el;
  const card = document.querySelector('[data-vault-id="' + id + '"]');
  if (chk) chk.classList.toggle('on', vaultSel.has(id));
  if (card) card.classList.toggle('vault-selected', vaultSel.has(id));
  updateVaultSelBar();
}

function clearVaultSelection() {
  vaultSel.forEach(id => {
    const chk = $('vchk-' + id).el;
    const card = document.querySelector('[data-vault-id="' + id + '"]');
    if (chk) chk.classList.remove('on');
    if (card) card.classList.remove('vault-selected');
  });
  vaultSel.clear();
  updateVaultSelBar();
}

function updateVaultSelBar() {
  const bar = $('vaultSelBar').el;
  const count = $('vaultSelCount').el;
  if (!bar) return;
  if (vaultSel.size === 0) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  count.textContent = vaultSel.size + ' selected';
}

function downloadVaultSelected() {
  const ids = [...vaultSel];
  ids.forEach((id, i) => {
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = '/api/vault/download/' + id;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }, i * 300);
  });
  toast('Downloading ' + ids.length + ' file' + (ids.length > 1 ? 's' : '') + '\u2026');
}

// ─── Studios ───
async function showStudios() {
  if (mosaicOn) stopMosaic();
  if (location.pathname !== '/studios') history.pushState(null, '', '/studios');
  studioMode = true;
  curStudio = null;
  $('bv').add('off');
  $('pv').remove('on');
  $('dv').remove('on');
  $('dupSB').remove('on');
  $('sdv').remove('on');
  $('studioSB').add('on');
  $('av').remove('on');
  $('adv').remove('on');
  $('actorSB').remove('on');
  $('tagDV').remove('on');
  document.querySelectorAll('#tagList .ci').forEach(el => el.classList.remove('on'));
  $('vaultV').remove('on');
  $('vaultSB').remove('on');
  $('scraperV').remove('on');
  $('scraperSB').remove('on');
  $('collectionsV').remove('on');
  $('collectionsSB').remove('on');
  $('foldersV').remove('on');
  $('foldersSB').remove('on');
  $('settingsV').remove('on');
  $('settingsSB').remove('on');
  if ($('dbV').el) $('dbV').remove('on');
  dupMode = false; vaultMode = false; scraperMode = false; foldersMode = false; importFavsMode = false; collectionsMode = false; settingsMode = false; dbMode = false;
  actorMode = false; curActor = null;
  curTag = null; curCollection = null;
  if (curV) { const vp = $('vP').el; vp.pause(); vp.src = ''; curV = null; }
  $('sv').add('on');
  loadStudioList();
}

async function loadStudioList() {
  $('studioGrid').html('<div class="dup-scan">Loading studios\u2026</div>');
  const studios = await (await fetch('/api/studios')).json();
  renderStudios(studios);
}

function renderStudios(studios) {
  const el = $('studioGrid').el;
  if (!studios.length) {
    el.innerHTML = '<div class="es" style="padding:40px 20px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="7" width="20" height="15" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg><h3>No studios found</h3><p>Add studios in the Database section</p></div>';
    return;
  }
  const cols = ['#e84040','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];
  el.innerHTML = '<div class="act-grid">' + studios.map(s => {
    const c = cols[Math.abs(hsh(s.name)) % cols.length];
    const websiteLink = s.website ? '<a class="act-link" href="' + esc(s.website) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">Website</a>' : '';
    const desc = s.description ? '<div class="act-desc">' + esc(s.description) + '</div>' : '';
    return '<div class="act-card fi" onclick="openStudio(\'' + escA(s.name) + '\')">' +
      '<div class="act-av" style="background:' + c + '22;color:' + c + '">' +
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="7" width="20" height="15" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg></div>' +
      '<div class="act-name">' + esc(s.name) + '</div>' +
      '<div class="act-cnt">' + s.count + ' video' + (s.count !== 1 ? 's' : '') + (websiteLink ? ' · ' + websiteLink : '') + '</div>' +
      desc +
      '</div>';
  }).join('') + '</div>';
}

async function openStudio(name) {
  if (location.pathname !== '/studio/' + encodeURIComponent(name)) history.pushState(null, '', '/studio/' + encodeURIComponent(name));
  curStudio = name;
  $('sv').remove('on');
  $('sdv').add('on');
  $('sdName').text(name);
  $('sdG').html('<div class="dup-scan">Loading\u2026</div>');
  const d = await (await fetch('/api/studios/' + encodeURIComponent(name))).json();
  if (d.error) { $('sdG').html('<div class="es" style="padding:40px 20px"><h3>' + esc(d.error) + '</h3></div>'); return; }
  $('sdG').html(d.videos.map(card).join(''));
  attachThumbs();
}

function backStudios() {
  curStudio = null;
  $('sdv').remove('on');
  $('sv').add('on');
}

// ─── Actors ───
async function showActors() {
  if (mosaicOn) stopMosaic();
  if (location.pathname !== '/actors') history.pushState(null, '', '/actors');
  actorMode = true;
  curActor = null;
  $('bv').add('off');
  $('pv').remove('on');
  $('dv').remove('on');
  $('dupSB').remove('on');
  $('adv').remove('on');
  $('actorSB').add('on');
  $('sv').remove('on');
  $('sdv').remove('on');
  $('studioSB').remove('on');
  $('tagDV').remove('on');
  document.querySelectorAll('#tagList .ci').forEach(el => el.classList.remove('on'));
  $('vaultV').remove('on');
  $('vaultSB').remove('on');
  $('scraperV').remove('on');
  $('scraperSB').remove('on');
  $('collectionsV').remove('on');
  $('collectionsSB').remove('on');
  $('foldersV').remove('on');
  $('foldersSB').remove('on');
  $('settingsV').remove('on');
  $('settingsSB').remove('on');
  if ($('dbV').el) $('dbV').remove('on');
  dupMode = false; vaultMode = false; scraperMode = false; foldersMode = false; importFavsMode = false; collectionsMode = false; settingsMode = false; dbMode = false;
  studioMode = false; curStudio = null;
  curTag = null; curCollection = null;
  if (curV) { const vp = $('vP').el; vp.pause(); vp.src = ''; curV = null; }
  $('av').add('on');
  loadActorList();
}

async function loadActorList() {
  $('actorGrid').html('<div class="dup-scan">Loading actors\u2026</div>');
  const actors = await (await fetch('/api/actors')).json();
  renderActors(actors);
}

function renderActors(actors) {
  const el = $('actorGrid').el;
  if (!actors.length) {
    el.innerHTML = '<div class="es" style="padding:40px 20px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg><h3>No actors found</h3><p>Add actors in the Database section</p></div>';
    return;
  }
  const cols = ['#e84040','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];
  el.innerHTML = '<div class="act-grid">' + actors.map(a => {
    const c = cols[Math.abs(hsh(a.name)) % cols.length];
    const metaParts = [];
    if (a.nationality) metaParts.push(esc(a.nationality));
    if (a.age != null) metaParts.push(a.deceased ? 'b. ' + (new Date().getFullYear() - a.age) + ' †' : a.age + ' y/o');
    const imdbLink = a.imdb_page ? '<a class="act-link" href="' + esc(a.imdb_page) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">IMDb</a>' : '';
    const meta = metaParts.length ? '<div class="act-meta">' + metaParts.join(' · ') + (imdbLink ? ' · ' + imdbLink : '') + '</div>' : (imdbLink ? '<div class="act-meta">' + imdbLink + '</div>' : '');
    return '<div class="act-card fi" onclick="openActor(\'' + escA(a.name) + '\')">' +
      '<div class="act-av" style="background:' + c + '22;color:' + c + '">' +
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>' +
      '<img class="act-ph" src="/api/actor-photos/' + encodeURIComponent(a.name) + '/img" alt="" onerror="this.style.display=\'none\'">' +
      '</div>' +
      '<div class="act-name">' + esc(a.name) + '</div>' +
      '<div class="act-cnt">' + a.count + ' video' + (a.count !== 1 ? 's' : '') + '</div>' +
      meta +
      '</div>';
  }).join('') + '</div>';
}

async function openActor(name) {
  if (location.pathname !== '/actor/' + encodeURIComponent(name)) history.pushState(null, '', '/actor/' + encodeURIComponent(name));
  curActor = name;
  $('av').remove('on');
  $('adv').add('on');
  $('adName').text(name);
  $('adG').html('<div class="dup-scan">Loading\u2026</div>');
  const d = await (await fetch('/api/actors/' + encodeURIComponent(name))).json();
  if (d.error) { $('adG').html('<div class="es" style="padding:40px 20px"><h3>' + esc(d.error) + '</h3></div>'); return; }
  $('adG').html(d.videos.map(card).join(''));
  attachThumbs();
}

// ─── Video tag management ───
let curVTags = [], curVAllCategories = [], curVActors = [];

function renderVideoTags() {
  const row = $('pTagsRow').el;
  const el = $('pTags').el;
  const canEdit = curV && !curV.isVault && !curV.external;
  // Show the row if there are tags OR the user can edit
  row.style.display = (curVTags.length || canEdit) ? '' : 'none';
  $('pTagAddBtn').el.style.display = canEdit ? '' : 'none';
  el.innerHTML = curVTags.map(t =>
    '<span class="p-tag">' + esc(t) +
    (canEdit
      ? '<button class="p-tag-rm" onclick="removeVideoTag(\'' + escA(t) + '\')" title="Remove tag">' +
        '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg></button>'
      : '') +
    '</span>'
  ).join('');
}

async function removeVideoTag(tag) {
  if (!curV || curV.isVault || curV.external) return;
  const re = new RegExp('\\s*' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'gi');
  const newName = curV.name.replace(re, ' ').trim().replace(/\s+/g, ' ').replace(/\s*-\s*$/, '').trim();
  if (!newName) { toast('Cannot remove — name would be empty'); return; }
  const ok = await applyVideoRename(newName);
  if (!ok) return;
  curVTags = curVTags.filter(t => t.toLowerCase() !== tag.toLowerCase());
  renderVideoTags();
  closeTagPicker();
}

function toggleTagPicker() {
  const picker = $('pTagPicker').el;
  const btn = $('pTagAddBtn').el;
  if (picker.style.display === 'none') {
    const available = curVAllCategories.filter(c =>
      !curVTags.some(t => t.toLowerCase() === c.toLowerCase())
    );
    const list = $('pTagPickerList').el;
    if (!available.length) {
      list.innerHTML = '<span class="p-tag-picker-empty">All categories already present</span>';
    } else {
      list.innerHTML = available.map(c =>
        '<span class="p-tag-picker-item" data-tag="' + escA(c) + '" onclick="this.classList.toggle(\'sel\')">' + esc(c) + '</span>'
      ).join('');
    }
    picker.style.display = '';
    btn.classList.add('on');
    const search = $('pTagPickerSearch').el;
    search.value = '';
    search.focus();
  } else {
    closeTagPicker();
  }
}

function filterTagPicker(q) {
  const lo = q.trim().toLowerCase();
  document.querySelectorAll('#pTagPickerList .p-tag-picker-item').forEach(el => {
    el.style.display = !lo || el.dataset.tag.toLowerCase().includes(lo) ? '' : 'none';
  });
}

function closeTagPicker() {
  $('pTagPicker').show(false);
  $('pTagAddBtn').remove('on');
  $('pTagPickerSearch').val('');
}

async function applyTagPicker() {
  const selected = [...document.querySelectorAll('#pTagPickerList .p-tag-picker-item.sel')]
    .map(el => el.dataset.tag);
  closeTagPicker();
  if (!selected.length) return;
  const sepIdx = curV.name.indexOf(' - ');
  const base = sepIdx !== -1 ? curV.name.slice(0, sepIdx).trim() : curV.name.trim();
  const existing = sepIdx !== -1 ? curV.name.slice(sepIdx + 3).trim() : '';
  const newTagsSection = existing ? existing + ' ' + selected.join(' ') : selected.join(' ');
  const newName = base + ' - ' + newTagsSection;
  const ok = await applyVideoRename(newName);
  if (!ok) return;
  selected.forEach(t => { if (!curVTags.some(x => x.toLowerCase() === t.toLowerCase())) curVTags.push(t); });
  renderVideoTags();
}

async function applyVideoRename(newName) {
  const r = await fetch('/api/videos/' + curV.id + '/rename', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newName })
  });
  const d = await r.json();
  if (!r.ok) { toast(d.error || 'Rename failed'); return false; }
  curV.id = d.newId;
  curV.name = newName;
  $('pT').text(newName);
  const vp = $('vP').el, t = vp.currentTime;
  vp.src = '/api/stream/' + d.newId;
  vp.currentTime = t;
  return true;
}

async function openActorFromVideo(name) {
  if (location.pathname !== '/actor/' + encodeURIComponent(name)) history.pushState(null, '', '/actor/' + encodeURIComponent(name));
  actorMode = true;
  curActor = name;
  $('pv').remove('on');
  $('bv').add('off');
  document.querySelectorAll('.ci.on').forEach(e => e.classList.remove('on'));
  $('actorSB').add('on');
  $('av').remove('on');
  $('adv').add('on');
  $('adName').text(name);
  $('adG').html('<div class="dup-scan">Loading\u2026</div>');
  const d = await (await fetch('/api/actors/' + encodeURIComponent(name))).json();
  if (d.error) { $('adG').html('<div class="es" style="padding:40px 20px"><h3>' + esc(d.error) + '</h3></div>'); return; }
  $('adG').html(d.videos.map(card).join(''));
  attachThumbs();
}

function toggleActorInput() {
  const panel = $('pActorInput').el;
  if (panel.style.display === 'none') {
    panel.style.display = '';
    $('pActorAddBtn').add('on');
    const inp = $('pActorInputVal').el;
    inp.value = '';
    inp.focus();
  } else {
    closeActorInput();
  }
}

function closeActorInput() {
  $('pActorInput').show(false);
  $('pActorAddBtn').remove('on');
}

async function submitActorInput() {
  const name = $('pActorInputVal').el.value.trim();
  closeActorInput();
  if (!name || !curV || curV.isVault || curV.external) return;
  const newName = name + ' ' + curV.name;
  const ok = await applyVideoRename(newName);
  if (!ok) return;
  // Refresh actor tags from updated name
  const d = await (await fetch('/api/videos/' + curV.id)).json();
  const actorsEl = $('pActors').el;
  if (d.actors && d.actors.length) {
    actorsEl.innerHTML = d.actors.map(a =>
      '<button class="p-actor-tag" onclick="openActorFromVideo(\'' + escA(a) + '\')">' +
      '<img class="p-actor-ph" src="/api/actor-photos/' + encodeURIComponent(a) + '/img" alt="" onerror="this.style.display=\'none\'">' +
      esc(a) + '</button>'
    ).join('');
  }
}

function backActors() {
  curActor = null;
  $('adv').remove('on');
  $('av').add('on');
}

function showScraper() {
  if (mosaicOn) stopMosaic();
  if (location.pathname !== '/scraper') history.pushState(null, '', '/scraper');
  scraperMode = true;
  // Hide all other views
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

function showFolders() {
  if (mosaicOn) stopMosaic();
  if (location.pathname !== '/folders') history.pushState(null, '', '/folders');
  foldersMode = true;
  $('bv').add('off');
  ['pv','dv','av','adv','sv','sdv','tagDV','vaultV','scraperV','collectionsV','settingsV','importFavsV','dbV'].forEach(id => $(id).remove('on'));
  document.querySelectorAll('.ci.on').forEach(el => el.classList.remove('on'));
  $('foldersSB').add('on');
  dupMode = false; vaultMode = false; scraperMode = false; collectionsMode = false; settingsMode = false; importFavsMode = false; dbMode = false;
  studioMode = false; actorMode = false;
  curActor = null; curStudio = null; curTag = null; curV = null; curCollection = null;
  $('foldersV').add('on');
  loadFolders();
}

function showImportFavs() {
  if (mosaicOn) stopMosaic();
  if (location.pathname !== '/bookmarks') history.pushState(null, '', '/bookmarks');
  importFavsMode = true;
  $('bv').add('off');
  ['pv','dv','av','adv','sv','sdv','tagDV','vaultV','scraperV','collectionsV','settingsV','foldersV','dbV'].forEach(id => $(id).remove('on'));
  document.querySelectorAll('.ci.on').forEach(el => el.classList.remove('on'));
  $('importFavsSB').add('on');
  dupMode = false; vaultMode = false; scraperMode = false; foldersMode = false; collectionsMode = false; settingsMode = false; dbMode = false;
  studioMode = false; actorMode = false;
  curActor = null; curStudio = null; curTag = null; curV = null; curCollection = null;
  $('importFavsV').add('on');
  if (!_bfItems.length) bfLoadCache();
}

async function loadFolders() {
  const folders = await (await fetch('/api/folders')).json();
  renderFolders(folders);
}

function renderFolders(folders) {
  const el = $('folderList').el;
  if (!folders.length) {
    el.innerHTML = '<div class="fv-empty">No external folders added yet.</div>';
    return;
  }
  el.innerHTML = folders.map((f, i) =>
    '<div class="fv-row">' +
    '<svg class="fv-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' +
    '<span class="fv-path">' + esc(f) + '</span>' +
    '<button class="fv-rm" onclick="removeFolder(' + i + ')" title="Remove"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
    '</div>'
  ).join('');
}

async function addFolder() {
  const input = $('folderPathIn').el;
  const err = $('folderErr').el;
  const p = input.value.trim();
  err.style.display = 'none';
  if (!p) return;
  const r = await fetch('/api/folders', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: p })
  });
  const d = await r.json();
  if (!r.ok) { err.textContent = d.error || 'Failed'; err.style.display = 'block'; return; }
  input.value = '';
  toast('Folder added — ' + (d.count || 0) + ' video' + (d.count !== 1 ? 's' : '') + ' found');
  loadFolders();
  await refresh();
}

async function removeFolder(idx) {
  const r = await fetch('/api/folders/' + idx, { method: 'DELETE' });
  if (!r.ok) { toast('Remove failed'); return; }
  toast('Folder removed');
  loadFolders();
  await refresh();
}

// ─── Browser Favourites Import ───

async function importBrowserFavs(browser) {
  const btn = $(browser === 'chrome' ? 'bfChrome' : 'bfFirefox').el;
  const out = $('browserFavsResult').el;
  btn.disabled = true;
  btn.textContent = 'Loading…';
  out.innerHTML = '';
  try {
    const r = await fetch('/api/browser-favs?browser=' + browser);
    let d;
    try { d = await r.json(); } catch { d = { error: 'Server returned an invalid response (status ' + r.status + ')' }; }
    if (d.whitelist_empty) {
      out.innerHTML = '<p style="font-size:0.82rem;color:var(--tx2)">Whitelist is empty — add domains in <span style="color:var(--ac);cursor:pointer" onclick="showSettings()">Settings → Whitelist</span> first.</p>';
      return;
    }
    if (!r.ok || d.error) {
      out.innerHTML = '<p style="font-size:0.82rem;color:#e84040">' + esc(d.error || 'Failed to read bookmarks') + '</p>';
      return;
    }
    renderBrowserFavs(d.items, browser);
  } catch (e) {
    out.innerHTML = '<p style="font-size:0.82rem;color:#e84040">Error: ' + esc(e.message) + '</p>';
  } finally {
    btn.disabled = false;
    btn.innerHTML = browser === 'chrome'
      ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:5px"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="21.17" y1="8" x2="12" y2="8"/><line x1="3.95" y1="6.06" x2="8.54" y2="14"/><line x1="10.88" y1="21.94" x2="15.46" y2="14"/></svg>Chrome / Edge'
      : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:5px"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 7.38 16.76C17.5 20.5 15 21 12 21s-5.5-.5-7.38-1.24A10 10 0 0 1 12 2z"/></svg>Firefox';
  }
}

async function importBrowserFavsFile(browser, input) {
  const file = input.files[0];
  if (!file) return;
  const out = $('browserFavsResult').el;
  out.innerHTML = '<p style="font-size:0.82rem;color:var(--tx2)">Reading ' + esc(file.name) + '…</p>';
  try {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const data = btoa(bin);
    const r = await fetch('/api/browser-favs/file', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, filename: file.name, browser })
    });
    let d;
    try { d = await r.json(); } catch { d = { error: 'Server returned an invalid response (status ' + r.status + ')' }; }
    if (d.whitelist_empty) {
      out.innerHTML = '<p style="font-size:0.82rem;color:var(--tx2)">Whitelist is empty — add domains in <span style="color:var(--ac);cursor:pointer" onclick="showSettings()">Settings → Whitelist</span> first.</p>';
      return;
    }
    if (!r.ok || d.error) {
      out.innerHTML = '<p style="font-size:0.82rem;color:#e84040">' + esc(d.error || 'Failed') + '</p>';
      return;
    }
    renderBrowserFavs(d.items, browser);
  } catch (e) {
    out.innerHTML = '<p style="font-size:0.82rem;color:#e84040">Error: ' + esc(e.message) + '</p>';
  }
  input.value = '';
}

let _bfCats = [];

let _bfItems = [], _bfMatchedCount = 0, _bfVisible = [];
let _bfViewMode = 'list'; // 'list' | 'grid'

async function bfLoadCache() {
  try {
    const r = await fetch('/api/bookmarks/cache');
    if (!r.ok) return;
    const d = await r.json();
    if (d.items && d.items.length) renderBrowserFavs(d.items, '_cache_');
  } catch {}
}

async function bfSaveCache() {
  try {
    await fetch('/api/bookmarks/cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: _bfItems })
    });
  } catch {}
}

function bfRemoveItem(url) {
  _bfItems = _bfItems.filter(it => it.url !== url);
  _bfMatchedCount = _bfItems.filter(it => bfMatchesLocalVideo(it.url)).length;
  _bfVisible = _bfVisible.filter(it => it.url !== url);
  bfSaveCache();
  if (!_bfItems.length) {
    $('bfSearchWrap').show(false);
    $('browserFavsResult').html('');
    return;
  }
  bfRenderList(_bfVisible);
}

function bfMatchesLocalVideo(url) {
  if (!V.length) return false;
  const haystack = url.toLowerCase();
  return V.some(v => {
    // Strip extension from filename for matching
    const fname = v.name.toLowerCase().replace(/\.[^.]+$/, '');
    return haystack.includes(fname);
  });
}

async function renderBrowserFavs(items, browser) {
  const out = $('browserFavsResult').el;
  const searchWrap = $('bfSearchWrap').el;
  const searchInput = $('bfSearch').el;
  if (!items.length) {
    searchWrap.style.display = 'none';
    out.innerHTML = '<p style="font-size:0.82rem;color:var(--tx2)">No bookmarks matched the whitelist.</p>';
    return;
  }

  // Auto-mark items that match a local video and move them to the bottom
  const unmatched = [], matched = [];
  for (const item of items) {
    const dlKey = 'bfdl:' + item.url;
    if (bfMatchesLocalVideo(item.url)) {
      sessionStorage.setItem(dlKey, '1');
      matched.push(item);
    } else {
      unmatched.push(item);
    }
  }
  _bfItems = [...unmatched, ...matched];
  _bfMatchedCount = matched.length;
  rebuildBookmarkVidIds(_bfItems);

  searchWrap.style.display = 'block';
  if (searchInput) searchInput.value = '';
  bfRenderList(_bfItems);
  if (browser !== '_cache_') bfSaveCache();
  // Pre-fetch OG thumbs for all items that don't have a cached image yet
  preFetchBmThumbs(_bfItems);
  // Refresh sidebar counts and grid
  renCats();
  if (!importFavsMode && !vaultMode && !studioMode && !actorMode && !dupMode) {
    if (curTag) openTag(curTag); else render();
  }
}

async function preFetchBmThumbs(items) {
  const missing = items.filter(it => !it.img);
  for (const item of missing) {
    try {
      const d = await (await fetch('/api/og-thumb?url=' + encodeURIComponent(item.url))).json();
      if (d.img) item.img = d.img;
    } catch {}
    await new Promise(r => setTimeout(r, 80)); // small delay to avoid hammering
  }
  if (missing.some(it => it.img)) bfSaveCache();
}

function bfRenderList(items) {
  _bfVisible = items;
  const out = $('browserFavsResult').el;
  const total = _bfItems.length;
  const pct = total ? Math.round(_bfMatchedCount / total * 100) : 0;
  const statsHtml =
    '<div class="bf-stats">' +
      '<span class="bf-stats-label">' + items.length + ' bookmark' + (items.length !== 1 ? 's' : '') + '</span>' +
      '<div class="bf-pct-wrap" title="' + _bfMatchedCount + ' of ' + total + ' already in library">' +
        '<div class="bf-pct-bar"><div class="bf-pct-fill" style="width:' + pct + '%"></div></div>' +
        '<span class="bf-pct-num">' + pct + '% in library</span>' +
      '</div>' +
    '</div>';

  if (_bfViewMode === 'grid') {
    out.innerHTML = statsHtml + '<div class="bf-grid" id="bfGrid">' +
      items.map((item, i) => {
        const inLib = bfMatchesLocalVideo(item.url);
        const encUrl = escA(item.url);
        const encTitle = escA(item.title);
        let hostname = '';
        try { hostname = new URL(item.url).hostname; } catch {}
        return '<div class="bf-card' + (inLib ? ' bf-downloaded' : '') + '" data-bf-idx="' + i + '" onclick="window.open(\'' + encUrl + '\',\'_blank\')">' +
          '<div class="bf-card-thumb">' +
            '<div class="bf-card-thumb-loading" id="bfth' + i + '">' +
              '<div class="bf-card-thumb-spin"></div>' +
            '</div>' +
            '<div class="bf-card-play"><svg width="22" height="22" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="5,3 19,12 5,21"/></svg></div>' +
            '<button class="bf-card-rm" onclick="event.stopPropagation();bfRemoveItem(\'' + encUrl + '\')" title="Remove bookmark"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
          '</div>' +
          '<div class="bf-card-info">' +
            '<div class="bf-card-title">' + esc(item.title || item.url) + '</div>' +
            '<div class="bf-card-host">' +
              '<img src="https://www.google.com/s2/favicons?sz=12&domain_url=' + encodeURIComponent(item.url) + '" width="12" height="12" onerror="this.style.display=\'none\'" style="flex-shrink:0">' +
              esc(hostname) +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
    bfLoadGridThumbs(items);
  } else {
    out.innerHTML = statsHtml +
      '<div class="bf-list">' +
      items.map(item => {
        const inLib = sessionStorage.getItem('bfdl:' + item.url) === '1';
        return '<div class="bf-row' + (inLib ? ' bf-downloaded' : '') + '">' +
          '<img class="bf-favicon" src="https://www.google.com/s2/favicons?sz=16&domain_url=' + encodeURIComponent(item.url) + '" width="16" height="16" onerror="this.style.display=\'none\'">' +
          '<a class="bf-title" href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer" title="' + esc(item.url) + '">' + esc(item.title) + '</a>' +
          '<span class="bf-host" data-url="' + esc(item.url) + '">' + esc(new URL(item.url).hostname) + '</span>' +
          '<button class="bf-rm-btn" onclick="bfRemoveItem(\'' + escA(item.url) + '\')" title="Remove bookmark"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
          '</div>';
      }).join('') +
      '</div>';
  }
}

function bfSetView(mode) {
  _bfViewMode = mode;
  const btnList = $('bfViewList').el;
  const btnGrid = $('bfViewGrid').el;
  if (btnList) btnList.classList.toggle('on', mode === 'list');
  if (btnGrid) btnGrid.classList.toggle('on', mode === 'grid');
  bfRenderList(_bfVisible);
}

function bfLoadGridThumbs(items) {
  if (!('IntersectionObserver' in window)) {
    // fallback: load all immediately
    items.forEach((item, i) => bfFetchThumb(item, i));
    return;
  }
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const idx = parseInt(entry.target.dataset.bfIdx, 10);
      if (!isNaN(idx) && items[idx]) bfFetchThumb(items[idx], idx);
      obs.unobserve(entry.target);
    });
  }, { rootMargin: '200px' });
  document.querySelectorAll('#bfGrid .bf-card').forEach(el => obs.observe(el));
}

async function bfFetchThumb(item, idx) {
  const thumbEl = $('bfth' + idx).el;
  if (!thumbEl) return;
  try {
    const r = await fetch('/api/og-thumb?url=' + encodeURIComponent(item.url));
    const d = await r.json();
    if (!thumbEl.isConnected) return;
    if (d.img) {
      thumbEl.outerHTML = '<img src="' + esc(d.img) + '" alt="" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.outerHTML=\'<div class=bf-card-thumb-ph><svg width=28 height=28 viewBox=&quot;0 0 24 24&quot; fill=none stroke=currentColor stroke-width=1.5><path d=&quot;M15 10l4.553-2.553A1 1 0 0 1 21 8.382V17a1 1 0 0 1-1.553.832L15 15M3 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z&quot;/></svg></div>\'">';
    } else {
      thumbEl.outerHTML = '<div class="bf-card-thumb-ph"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M15 10l4.553-2.553A1 1 0 0 1 21 8.382V17a1 1 0 0 1-1.553.832L15 15M3 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div>';
    }
  } catch {
    if (thumbEl && thumbEl.isConnected) thumbEl.outerHTML = '<div class="bf-card-thumb-ph"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M15 10l4.553-2.553A1 1 0 0 1 21 8.382V17a1 1 0 0 1-1.553.832L15 15M3 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div>';
  }
}

function bfFilterList(q) {
  const term = q.trim().toLowerCase();
  const filtered = term
    ? _bfItems.filter(item => item.title.toLowerCase().includes(term) || item.url.toLowerCase().includes(term))
    : _bfItems;
  bfRenderList(filtered);
}

function bfCopyVisible() {
  if (!_bfVisible.length) { toast('No bookmarks to copy'); return; }
  const text = _bfVisible.map(item => item.url).join('\n');
  navigator.clipboard.writeText(text).then(() => {
    toast('Copied ' + _bfVisible.length + ' URL' + (_bfVisible.length !== 1 ? 's' : ''));
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    toast('Copied ' + _bfVisible.length + ' URL' + (_bfVisible.length !== 1 ? 's' : ''));
  });
}

function bfOpenAllVisible() {
  if (!_bfVisible.length) { toast('No bookmarks to open'); return; }
  const n = _bfVisible.length;
  if (n > 10 && !confirm('Open ' + n + ' tabs?')) return;
  _bfVisible.forEach((item, i) => {
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = item.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }, i * 100);
  });
  toast('Opening ' + n + ' tab' + (n !== 1 ? 's' : '') + '…');
}

function openBfIframe(url, title) {
  const mo = $('bfiframeMo').el;
  const iframe = $('bfiframeEl').el;
  const blocked = $('bfiframeBlocked').el;
  $('bfiframeTitle').text(title || url);
  $('bfiframeLink').el.href = url;
  $('bfiframeFallback').el.href = url;
  blocked.classList.remove('on');
  iframe.src = '';
  // Detect X-Frame-Options/CSP block via load event timing
  let loaded = false;
  iframe.onload = () => { loaded = true; };
  setTimeout(() => { if (!loaded) blocked.classList.add('on'); }, 4000);
  iframe.src = url;
  mo.classList.add('on');
}

function closeBfIframe(e) {
  if (e instanceof MouseEvent && e.target !== $('bfiframeMo').el) return;
  $('bfiframeMo').remove('on');
  $('bfiframeEl').el.src = '';
}

function bfToggleAll(checked) {
  document.querySelectorAll('.bf-chk').forEach(cb => cb.checked = checked);
}

async function downloadSelected() {
  const urls = [...document.querySelectorAll('.bf-chk:checked')].map(cb => cb.value);
  if (!urls.length) { toast('Select at least one bookmark'); return; }
  const category = ($('bfCatSel').el || {}).value || '';
  const r = await fetch('/api/download', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls, category })
  });
  const d = await r.json();
  if (!r.ok) { toast(d.error || 'Failed to queue downloads'); return; }
  toast(d.ids.length + ' download' + (d.ids.length !== 1 ? 's' : '') + ' queued');
  startDlPoller();
  renderDlQueue();
}

// ─── Download Queue UI ───

let dlPoller = null;

function startDlPoller() {
  if (dlPoller) return;
  dlPoller = setInterval(async () => {
    const jobs = await (await fetch('/api/download/jobs')).json();
    renderDlQueue(jobs);
    const active = jobs.some(j => j.status === 'queued' || j.status === 'running');
    if (!active) {
      clearInterval(dlPoller); dlPoller = null;
      if (jobs.some(j => j.status === 'done')) refresh();
    }
  }, 1500);
}

async function renderDlQueue(jobs) {
  if (!jobs) {
    try { jobs = await (await fetch('/api/download/jobs')).json(); } catch { return; }
  }
  const panel = $('dlQueuePanel').el;
  const list = $('dlQueueList').el;
  const counter = $('dlQueueCount').el;
  if (!panel) return;
  if (!jobs.length) { panel.style.display = 'none'; return; }
  panel.style.display = '';
  const active = jobs.filter(j => j.status === 'queued' || j.status === 'running').length;
  counter.textContent = active ? '(' + active + ' active)' : '';
  list.innerHTML = jobs.map(j => {
    const pct = j.progress || 0;
    const statusTx = j.status === 'running'
      ? pct.toFixed(1) + '%' + (j.speed && j.speed !== 'Unknown' ? ' · ' + j.speed : '') + (j.eta && j.eta !== 'Unknown' ? ' ETA ' + j.eta : '')
      : j.status === 'done' ? 'Done'
      : j.status === 'error' ? (j.error || 'Error')
      : 'Queued';
    const statusCls = j.status === 'done' ? 'dlj-done' : j.status === 'error' ? 'dlj-err' : '';
    return '<div class="dlj-row">' +
      '<div class="dlj-info">' +
        '<span class="dlj-title" title="' + esc(j.url) + '">' + esc(j.title === j.url ? new URL(j.url).hostname + '/…' : j.title) + '</span>' +
        '<span class="dlj-status ' + statusCls + '">' + esc(statusTx) + '</span>' +
      '</div>' +
      (j.status === 'running' ? '<div class="dlj-bar"><div class="dlj-fill" style="width:' + pct + '%"></div></div>' : '') +
      '<button class="fv-rm" onclick="removeDlJob(\'' + j.id + '\')" title="' + (j.status === 'running' ? 'Cancel' : 'Remove') + '">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
      '</button>' +
    '</div>';
  }).join('');
}

async function removeDlJob(id) {
  await fetch('/api/download/jobs/' + id, { method: 'DELETE' });
  renderDlQueue();
}

async function clearDoneJobs() {
  const jobs = await (await fetch('/api/download/jobs')).json();
  await Promise.all(jobs.filter(j => j.status === 'done' || j.status === 'error').map(j =>
    fetch('/api/download/jobs/' + j.id, { method: 'DELETE' })
  ));
  renderDlQueue();
}

// ─── Collections ───
let collectionsMode = false, curCollection = null;

function showCollections() {
  if (mosaicOn) stopMosaic();
  if (location.pathname !== '/collections') history.pushState(null, '', '/collections');
  collectionsMode = true;
  $('bv').add('off');
  document.querySelectorAll('.ci.on').forEach(e => e.classList.remove('on'));
  $('collectionsSB').add('on');
  scraperMode = false; foldersMode = false; importFavsMode = false; settingsMode = false; dbMode = false;
  studioMode = false; actorMode = false;
  curActor = null; curStudio = null; curTag = null; curV = null;
  document.querySelectorAll('.pv,.adv,.sv,.av,.dv,.scraperV,.foldersV,.settingsV').forEach(e => e.classList.remove('on'));
  $('vaultV').remove('on');
  if ($('dbV').el) $('dbV').remove('on');
  $('collectionsV').add('on');
  curCollection = null;
  $('cvTitle').text('Collections');
  $('cvNewRow').show();
  loadCollectionsView();
}

async function loadCollectionsView() {
  const cols = await (await fetch('/api/collections')).json();
  renderCollections(cols);
}

function renderCollections(cols) {
  const el = $('cvContent').el;
  if (!cols.length) {
    el.innerHTML = '<div class="cv-empty">No collections yet. Create one above.</div>';
    return;
  }
  el.innerHTML = '<div class="cv-grid">' + cols.map(col =>
    '<div class="cv-card" onclick="openCollectionDetail(\'' + escA(col.name) + '\')">' +
    '<div class="cv-card-name">' + esc(col.name) + '</div>' +
    '<div class="cv-card-count">' + col.count + ' video' + (col.count !== 1 ? 's' : '') + '</div>' +
    '<button class="cv-del" onclick="event.stopPropagation();deleteCollection(\'' + escA(col.name) + '\')" title="Delete collection"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
    '</div>'
  ).join('') + '</div>';
}

async function openCollectionDetail(name) {
  if (location.pathname !== '/collection/' + encodeURIComponent(name)) history.pushState(null, '', '/collection/' + encodeURIComponent(name));
  curCollection = name;
  $('cvTitle').text(name);
  $('cvNewRow').show(false);
  const videos = await (await fetch('/api/collections/' + encodeURIComponent(name) + '/videos')).json();
  const el = $('cvContent').el;
  el.innerHTML =
    '<button class="bbk" style="margin-bottom:16px" onclick="showCollections()">' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>Collections</button>' +
    (videos.length ? '<div class="vg">' + videos.map(v => card(v)).join('') + '</div>'
      : '<div class="cv-empty">No videos in this collection.</div>');
}

async function createCollection() {
  const inp = $('cvNameIn').el;
  const name = inp.value.trim();
  if (!name) return;
  const r = await fetch('/api/collections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  const d = await r.json();
  if (!r.ok) { toast(d.error || 'Failed'); return; }
  inp.value = '';
  toast('Collection "' + name + '" created');
  loadCollectionsView();
}

async function deleteCollection(name) {
  if (!confirm('Delete collection "' + name + '"?')) return;
  const r = await fetch('/api/collections/' + encodeURIComponent(name), { method: 'DELETE' });
  if (!r.ok) { toast('Delete failed'); return; }
  toast('Collection deleted');
  loadCollectionsView();
}

// Add-to-collection modal
let cvTargetId = null;
async function openAddToCollection() {
  if (!curV) return;
  cvTargetId = curV.id;
  const cols = await (await fetch('/api/collections')).json();
  const list = $('cvModalList').el;
  const newSection = $('cvModalNew').el;
  const createBtn = $('cvModalCreateBtn').el;
  newSection.classList.remove('on');
  createBtn.style.display = 'none';
  $('cvModalNameIn').val('');
  list.innerHTML = cols.map(col =>
    '<button class="cv-opt" onclick="addToCollection(\'' + escA(col.name) + '\')">' + esc(col.name) + '</button>'
  ).join('') +
  '<button class="cv-opt cv-opt-new" onclick="showCvNewInput()">+ New collection…</button>';
  $('cvModal').add('on');
}

function showCvNewInput() {
  $('cvModalNew').add('on');
  $('cvModalCreateBtn').show();
  $('cvModalNameIn').el.focus();
}

async function addToCollection(name) {
  const r = await fetch('/api/collections/' + encodeURIComponent(name) + '/videos', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: cvTargetId })
  });
  const d = await r.json();
  closeCvModal();
  if (r.ok) toast('Added to "' + name + '"');
  else toast(d.error || 'Failed');
}

async function submitCvNew() {
  const name = $('cvModalNameIn').el.value.trim();
  if (!name) return;
  const cr = await fetch('/api/collections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  if (!cr.ok) { const d = await cr.json(); toast(d.error || 'Failed'); return; }
  await addToCollection(name);
}

function closeCvModal() {
  $('cvModal').remove('on');
  cvTargetId = null;
}

// ─── Settings ───
let settingsMode = false;

function showSettings() {
  if (mosaicOn) stopMosaic();
  if (location.pathname !== '/settings') history.pushState(null, '', '/settings');
  settingsMode = true;
  $('bv').add('off');
  document.querySelectorAll('.ci.on').forEach(e => e.classList.remove('on'));
  $('settingsSB').add('on');
  ['pv','dv','av','adv','sv','sdv','tagDV','vaultV','scraperV','foldersV','importFavsV','collectionsV','dbV']
    .forEach(id => $(id).remove('on'));
  vaultMode = false; scraperMode = false; foldersMode = false; importFavsMode = false; collectionsMode = false; dbMode = false;
  studioMode = false; actorMode = false;
  curActor = null; curStudio = null; curTag = null; curV = null; curCollection = null;
  $('settingsV').add('on');
  loadSettings();
  const activeTheme = localStorage.getItem('theme') || '';
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === activeTheme);
  });
}

async function loadSettings() {
  const d = await (await fetch('/api/settings/lists')).json();
  $('stgHidden').val(d.hidden || '');
  $('stgWhitelist').val(d.whitelist || '');
  updateSettingsHint('stgHiddenHint', d.hidden || '');
  updateSettingsHint('stgWhitelistHint', d.whitelist || '');
}

function updateSettingsHint(hintId, content) {
  const count = content.split('\n').map(l => l.trim()).filter(l => l.length > 0).length;
  const el = $(hintId).el;
  if (el) el.textContent = count + ' entr' + (count !== 1 ? 'ies' : 'y');
}

async function saveSettingsList(file) {
  const taId = { hidden: 'stgHidden', whitelist: 'stgWhitelist' }[file];
  const content = $(taId).el.value;
  const r = await fetch('/api/settings/' + file, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  });
  const d = await r.json();
  if (!r.ok) { toast(d.error || 'Save failed'); return; }
  toast('Saved ' + d.count + ' ' + file + ' entr' + (d.count !== 1 ? 'ies' : 'y'));
  updateSettingsHint('stg' + file.charAt(0).toUpperCase() + file.slice(1) + 'Hint', content);
  // Refresh sidebar-dependent data
  if (file === 'actors') loadActorList && typeof loadActorList === 'function' && loadActorList();
  if (file === 'categories' || file === 'studios') renCats && typeof renCats === 'function' && renCats();
  refresh();
}

// ─── Connect ───
async function showConnect() {
  $('connectModal').add('on');
  const urlEl = $('connectUrl').el;
  const canvas = $('connectQR').el;
  urlEl.textContent = 'Loading…';
  canvas.style.display = 'none';
  try {
    const d = await (await fetch('/api/local-ip')).json();
    if (!d.url) { urlEl.textContent = 'Could not detect local IP address.'; return; }
    urlEl.textContent = d.url;
    canvas.style.display = 'block';
    QRCode.toCanvas(canvas, d.url, { width: 220, margin: 2, color: { dark: '#000', light: '#fff' } });
  } catch (e) {
    urlEl.textContent = 'Error loading network info.';
  }
}
function closeConnectModal() {
  $('connectModal').remove('on');
}

// ─── Tags ───

async function openTag(name) {
  if (location.pathname !== '/tag/' + encodeURIComponent(name)) history.pushState(null, '', '/tag/' + encodeURIComponent(name));
  closeAllViews();
  curTag = name;
  $('bv').add('off');
  $('tagDV').add('on');
  q = ''; $('sI').val(''); $('sGhost').html('');
  document.querySelectorAll('#tagList .ci').forEach(el => el.classList.toggle('on', el.dataset.tag === name));
  $('tagName').text(name);
  $('tagG').html('<div class="dup-scan">Loading\u2026</div>');
  renCats();
  const d = await (await fetch('/api/db-tags/' + encodeURIComponent(name))).json();
  if (d.error) { $('tagG').html('<div class="es" style="padding:40px 20px"><h3>' + esc(d.error) + '</h3></div>'); return; }
  let localVids = srcFilter === 'remote' ? [] : d.videos;
  if (shuf) {
    localVids = localVids.slice().sort(() => Math.random() - 0.5);
  } else if (sort === 'name') {
    localVids = localVids.slice().sort((a, b) => a.name.localeCompare(b.name));
  } else if (sort === 'size') {
    localVids = localVids.slice().sort((a, b) => b.size - a.size);
  } else if (sort === 'duration') {
    localVids = localVids.slice().sort((a, b) => (b.duration || 0) - (a.duration || 0));
  }
  // 'date' is already sorted by mtime desc from server
  const bms = srcFilter !== 'local' ? getBmList() : [];
  $('tagG').html(localVids.map(card).join('') + bms.map(bmCard).join(''));
  attachThumbs();
  attachBmThumbs();
}

function closeTag() {
  $('tagDV').remove('on');
  $('bv').remove('off');
  document.querySelectorAll('#tagList .ci').forEach(el => el.classList.remove('on'));
  curTag = null;
  renCats();
}

// ─── Panoramic ───
function togglePan() {
  const on = document.body.classList.toggle('pan');
  $('panBtn').toggle('on', on);
  localStorage.setItem('pan', on ? '1' : '');
}

// ─── Mosaic Mode ───
let mosTileCount = 6;
let mosHoveredIdx = -1;
let mosTilesState = []; // [{wrap, a, b, active:'a'|'b', vidId}]

function toggleMosaic() {
  if (mosaicOn) stopMosaic(); else startMosaic();
}

function startMosaic() {
  if (!V.length) { toast('No videos to show'); return; }
  mosaicOn = true;
  $('bv').add('off');
  $('pv').remove('on');
  $('dv').remove('on');
  $('dupSB').remove('on');
  dupMode = false;
  if (curV) { const vp = $('vP').el; vp.pause(); vp.src = ''; curV = null; }
  $('mosCatLbl').el.textContent = cat
    ? (cats.find(x => x.path === cat)?.name || cat) + ' — Mosaic'
    : 'All Videos — Mosaic';
  $('mosIv').text(mosaicIv + 's');
  $('mosV').add('on');
  $('mosBtn').add('on');
  buildMosaicTiles();
  scheduleMosaic();
}

function stopMosaic() {
  mosaicOn = false;
  clearTimeout(mosaicTimer);
  mosTilesState.forEach(t => {
    t.a.pause(); t.a.src = '';
    t.b.pause(); t.b.src = '';
  });
  mosTilesState = [];
  mosHoveredIdx = -1;
  $('mosV').remove('on');
  $('mosBtn').remove('on');
  $('bv').remove('off');
}

function mosPick(n) {
  const pool = V.filter(v => !bookmarkVidIds.has(v.id));
  const src = pool.length ? pool : V;
  if (!src.length) return [];
  const a = [...src].sort(() => Math.random() - 0.5);
  const result = [];
  while (result.length < n) result.push(...a);
  return result.slice(0, n);
}

function mosPickExcluding(excludeId) {
  const pool = V.filter(v => !bookmarkVidIds.has(v.id));
  const src = pool.length ? pool : V;
  const shuffled = [...src].sort(() => Math.random() - 0.5);
  return shuffled.find(v => v.id !== excludeId) || shuffled[0];
}

function mosSeekRandom(el) {
  const dur = parseFloat(el.dataset.dur) || el.duration || 0;
  if (dur > 5) el.currentTime = Math.random() * (dur * 0.85);
}

function preloadMosTile(tile, v) {
  const pre = tile.active === 'a' ? tile.b : tile.a;
  pre.pause();
  pre.dataset.vid = v.id;
  pre.dataset.dur = v.duration || 0;
  pre.dataset.ready = '0';
  pre.src = '/api/stream/' + v.id;
  pre.addEventListener('loadedmetadata', () => {
    mosSeekRandom(pre);
    pre.play().catch(() => {}); // play muted+invisible to buffer the frame
  }, { once: true });
  pre.addEventListener('seeked', () => { pre.dataset.ready = '1'; }, { once: true });
}

function buildMosaicTiles() {
  const grid = $('mosGrid').el;
  mosTilesState.forEach(t => { t.a.pause(); t.a.src = ''; t.b.pause(); t.b.src = ''; });
  mosTilesState = [];
  mosHoveredIdx = -1;
  grid.innerHTML = '';

  const n = mosTileCount;
  if (n === 6) {
    grid.classList.add('mos-layout-6');
    grid.style.gridTemplateColumns = '';
    grid.style.gridTemplateRows = '';
  } else {
    grid.classList.remove('mos-layout-6');
    const cols = n <= 2 ? n : n <= 4 ? 2 : n <= 9 ? 3 : 4;
    grid.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
    grid.style.gridTemplateRows = '';
  }

  const picks = mosPick(n);
  picks.forEach((v, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'mos-tile';

    const a = document.createElement('video');
    a.muted = true; a.playsInline = true; a.loop = true;
    a.className = 'mos-v mos-v-active';
    a.dataset.vid = v.id; a.dataset.dur = v.duration || 0;

    const b = document.createElement('video');
    b.muted = true; b.playsInline = true; b.loop = true;
    b.className = 'mos-v';
    b.dataset.ready = '0';

    wrap.appendChild(a); wrap.appendChild(b);
    grid.appendChild(wrap);

    const tile = { wrap, a, b, active: 'a', vidId: v.id };
    mosTilesState.push(tile);

    // Load and play A
    a.src = '/api/stream/' + v.id;
    a.addEventListener('loadedmetadata', () => { mosSeekRandom(a); a.play().catch(() => {}); }, { once: true });
    a.play().catch(() => {});

    // Preload B immediately
    const nextV = mosPickExcluding(v.id);
    preloadMosTile(tile, nextV);

    // Hover: lock audio to this tile
    wrap.addEventListener('mouseenter', () => {
      mosHoveredIdx = i;
      wrap.classList.add('mos-hovered');
      mosTilesState.forEach((t, j) => {
        const activeEl = t.active === 'a' ? t.a : t.b;
        activeEl.muted = (j !== i);
      });
    });
    wrap.addEventListener('mouseleave', () => {
      if (mosHoveredIdx === i) mosHoveredIdx = -1;
      wrap.classList.remove('mos-hovered');
      mosTilesState.forEach(t => { t.a.muted = true; t.b.muted = true; });
    });
  });
}

function scheduleMosaic() {
  clearTimeout(mosaicTimer);
  if (!mosaicOn) return;
  mosaicTimer = setTimeout(() => { refreshMosaicTiles(); scheduleMosaic(); }, mosaicIv * 1000);
}

function refreshMosaicTiles() {
  mosTilesState.forEach((tile, i) => {
    if (i === mosHoveredIdx) return; // don't disturb hovered tile

    const nextEl = tile.active === 'a' ? tile.b : tile.a;
    const curEl  = tile.active === 'a' ? tile.a : tile.b;

    if (nextEl.dataset.ready === '1') {
      // Preloaded video is ready — crossfade
      nextEl.muted = true;
      nextEl.play().catch(() => {});
      nextEl.classList.add('mos-v-active');
      curEl.classList.remove('mos-v-active');
      tile.active = tile.active === 'a' ? 'b' : 'a';
      tile.vidId = nextEl.dataset.vid;
      // After transition finishes, stop old video and preload the next one
      setTimeout(() => {
        curEl.pause();
        preloadMosTile(tile, mosPickExcluding(tile.vidId));
      }, 650);
    } else {
      // Preloaded not ready yet — just seek current video to a new spot
      mosSeekRandom(curEl);
    }
  });
}

function setMosaicIv(delta) {
  mosaicIv = Math.max(2, Math.min(60, mosaicIv + delta));
  $('mosIv').text(mosaicIv + 's');
  scheduleMosaic();
}

function setMosaicCount(val) {
  mosTileCount = Math.max(1, Math.min(16, parseInt(val) || 6));
  $('mosCnt').val(mosTileCount);
  if (mosaicOn) { buildMosaicTiles(); scheduleMosaic(); }
}

// ─── Shuffle ───
async function toggleShuf() {
  shuf = !shuf;
  document.querySelectorAll('#shBtn, #shBtnTag').forEach(b => b.classList.toggle('on', shuf));
  if (shuf) document.querySelectorAll('.sb[data-s]').forEach(b => b.classList.remove('on'));
  else document.querySelector('.sb[data-s="' + sort + '"]')?.classList.add('on');
  if (curTag) { await openTag(curTag); return; }
  await load(); render();
}

// ─── Autoplay / Next ───
// ─── Playlist ───
const playlistSkipped = new Set();

function buildPl() {
  if (!curV || !V.length) return [];
  return V.filter(v => !playlistSkipped.has(v.id));
}

function renderPlaylist() {
  const pl = buildPl();
  const cols = ['#e84040','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];
  $('pplCount').text(pl.length + ' video' + (pl.length !== 1 ? 's' : ''));
  const listEl = $('pplList').el;
  if (!pl.length) {
    listEl.innerHTML = '<div class="ppl-empty">Playlist is empty</div>';
    return;
  }
  listEl.innerHTML = pl.map((v, i) => {
    const c = cols[Math.abs(hsh(v.category)) % cols.length];
    const isCur = curV && v.id === curV.id;
    return '<div class="ppl-item' + (isCur ? ' cur' : '') + '" id="ppl-' + v.id + '" onclick="openVid(\'' + escA(v.id) + '\')">' +
      '<div class="ct ppl-ct" data-vid="' + v.id + '" style="background:linear-gradient(135deg,' + c + '12 0%,' + c + '06 100%)">' +
        '<div class="po" style="transform:translate(-50%,-50%) scale(0.6)"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></div>' +
        (v.durationF ? '<span class="durb">' + v.durationF + '</span>' : '') +
        (v.rating ? '<div class="vr-badge"><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' + v.rating + '</div>' : '') +
      '</div>' +
      '<div class="ppl-info">' +
        '<span class="ppl-num">' + (i + 1) + '</span>' +
        '<span class="ppl-name">' + esc(v.name) + '</span>' +
        '<span class="ppl-cat">' + esc(v.category) + '</span>' +
      '</div>' +
      '<button class="ppl-rm" onclick="event.stopPropagation();skipFromPlaylist(\'' + escA(v.id) + '\')" title="Remove from playlist">' +
        '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
      '</button>' +
      '</div>';
  }).join('');
  // Scroll to current item
  if (curV) {
    const curEl = $('ppl-' + curV.id).el;
    if (curEl) setTimeout(() => curEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
  }
}

function skipFromPlaylist(id) {
  playlistSkipped.add(id);
  renderPlaylist();
}

function playNext() {
  if (curV && curV.isVault) {
    if (vaultPl.length < 2) return;
    vaultPlIdx = (vaultPlIdx + 1) % vaultPl.length;
    const f = vaultPl[vaultPlIdx];
    openVaultVid(f.id, f.name || f.originalName, f.ext);
    return;
  }
  const pl = buildPl();
  if (pl.length < 2) return;
  const idx = pl.findIndex(v => v.id === curV.id);
  openVid(pl[(idx + 1) % pl.length].id);
}

function playPrev() {
  if (curV && curV.isVault) {
    if (vaultPl.length < 2) return;
    vaultPlIdx = (vaultPlIdx - 1 + vaultPl.length) % vaultPl.length;
    const f = vaultPl[vaultPlIdx];
    openVaultVid(f.id, f.name || f.originalName, f.ext);
    return;
  }
  const pl = buildPl();
  if (pl.length < 2) return;
  const idx = pl.findIndex(v => v.id === curV.id);
  openVid(pl[(idx - 1 + pl.length) % pl.length].id);
}

$('vP').el.addEventListener('ended', playNext);
$('vPin').el.addEventListener('ended', pinNext);

// ─── Pin (dual play) ───
function togglePin() {
  if (pinnedV) unpinVideo(); else pinVideo();
}

function pinVideo() {
  if (!curV) return;
  pinnedV = curV;
  pinnedPl = buildPl().slice();
  pinnedIdx = pinnedPl.findIndex(v => v.id === pinnedV.id);
  if (pinnedIdx < 0) pinnedIdx = 0;
  const vPin = $('vPin').el;
  vPin.src = '/api/stream/' + pinnedV.id;
  $('pinTitle').text(pinnedV.name);
  renderPinPlaylist();
  $('pinPanel').add('on');
  $('pinBtn').add('on');
  $('pinBtn').el.querySelector('span').textContent = 'Unpin';
}

function unpinVideo() {
  pinnedV = null; pinnedPl = []; pinnedIdx = 0;
  const vPin = $('vPin').el;
  vPin.pause(); vPin.src = '';
  $('pinPanel').remove('on');
  $('pinBtn').remove('on');
  $('pinBtn').el.querySelector('span').textContent = 'Pin';
}

function renderPinPlaylist() {
  const cols = ['#e84040','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];
  const listEl = $('pinList').el;
  if (!pinnedPl.length) { listEl.innerHTML = ''; return; }
  listEl.innerHTML = pinnedPl.map((v, i) => {
    const c = cols[Math.abs(hsh(v.category)) % cols.length];
    const isCur = pinnedV && v.id === pinnedV.id;
    return '<div class="ppl-item' + (isCur ? ' cur' : '') + '" id="pinpl-' + v.id + '" onclick="pinJump(' + i + ')">' +
      '<div class="ppl-ct ct" data-vid="' + v.id + '" style="background:linear-gradient(135deg,' + c + '12 0%,' + c + '06 100%)">' +
        '<div class="po" style="transform:translate(-50%,-50%) scale(0.6)"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></div>' +
        (v.durationF ? '<span class="durb">' + v.durationF + '</span>' : '') +
      '</div>' +
      '<div class="ppl-info">' +
        '<span class="ppl-num">' + (i + 1) + '</span>' +
        '<span class="ppl-name">' + esc(v.name) + '</span>' +
      '</div>' +
      '</div>';
  }).join('');
  const curEl = $('pinpl-' + pinnedV.id).el;
  if (curEl) setTimeout(() => curEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
}

function pinJump(idx) {
  if (idx < 0 || idx >= pinnedPl.length) return;
  pinnedIdx = idx;
  pinnedV = pinnedPl[idx];
  $('vPin').el.src = '/api/stream/' + pinnedV.id;
  $('pinTitle').text(pinnedV.name);
  renderPinPlaylist();
}

function pinNext() {
  pinJump((pinnedIdx + 1) % pinnedPl.length);
}

function pinPrev() {
  pinJump((pinnedIdx - 1 + pinnedPl.length) % pinnedPl.length);
}

// ─── Thumbnails ───
function initThumbObs() {
  if (thumbObs) return;
  thumbObs = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const id = e.target.dataset.vid;
      if (id in thumbMap) continue;
      thumbObs.unobserve(e.target);
      queueThumb(id);
    }
  }, { rootMargin: '300px' });
}

function attachThumbs() {
  initThumbObs();
  document.querySelectorAll('.ct[data-vid], .dup-th[data-vid]').forEach(el => {
    const id = el.dataset.vid, v = thumbMap[id];
    if (v && v.length) { applyThumb(el, v[0]); return; }
    if (!(id in thumbMap)) thumbObs.observe(el);
  });
}

function queueThumb(id) {
  thumbMap[id] = null;
  thumbQueue.push(id);
  runThumbQ();
}

async function runThumbQ() {
  if (thumbRunning >= 3 || !thumbQueue.length) return;
  thumbRunning++;
  const id = thumbQueue.shift();
  try {
    const d = await (await fetch('/api/thumbs/' + id + '/generate', { method: 'POST' })).json();
    thumbMap[id] = d.count > 0 ? Array.from({ length: d.count }, (_, i) => '/api/thumbs/' + id + '/' + i) : [];
    if (thumbMap[id].length) {
      thumbMap[id].forEach(u => { const i = new Image(); i.src = u; }); // preload
      const el = document.querySelector('.ct[data-vid="' + id + '"]');
      if (el) applyThumb(el, thumbMap[id][0]);
    }
  } catch { thumbMap[id] = []; }
  thumbRunning--;
  runThumbQ();
}

function applyThumb(el, url) {
  el.style.background = 'url(' + url + ') center/cover no-repeat';
  el.classList.add('has-thumb');
}

// ─── Zapping Mode ───

function toggleZapping() {
  if (zapOn) {
    stopZapping();
  } else {
    if (mosaicOn) stopMosaic(); // prevent clash with mosaic
    zapOn = true;
    zapLock = false;
    $('zapUI').el.style.display = 'flex';
    $('zapLockBtn').text('Lock to Current');
    
    // Switch to player view
    $('bv').add('off');
    $('pv').add('on');
    
    startZapping();
  }
}

function stopZapping() {
  zapOn = false;
  clearTimeout(zapTimer);
  $('zapUI').show(false);
  
  // Ensure we revert to the main player visually
  $('vP').show();
  $('vP_zap').show(false);
  activePlayer = 'vP';
  
  goHome();
}

function setZapIv(delta) {
  zapIv = Math.max(2, zapIv + delta);
  $('zapIv').text(zapIv + 's');
}

function toggleZapLock() {
  zapLock = !zapLock;
  $('zapLockBtn').text(zapLock ? 'Unlock (Resume Zapping)' : 'Lock to Current');
  if (!zapLock) {
    // Resume switching
    zapTimer = setTimeout(doZapSwitch, zapIv * 1000);
  } else {
    clearTimeout(zapTimer);
  }
}

function getRandomVidForZapping() {
  // Respect current category if selected, otherwise all videos; exclude bookmark videos
  let list = cat ? V.filter(v => v.category === cat || v.catPath === cat) : V;
  list = list.filter(v => !bookmarkVidIds.has(v.id));
  if (!list.length) list = V.filter(v => !bookmarkVidIds.has(v.id)); // fallback excluding bookmarks
  if (!list.length) list = V; // last resort
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

async function startZapping() {
  await prepareNextZap();
  doZapSwitch();
}

async function prepareNextZap() {
  if (zapLock) return;
  
  zapNextVid = getRandomVidForZapping();
  if (!zapNextVid) return;
  
  // Fetch metadata to get duration for a safe random start time
  const d = await (await fetch('/api/videos/' + zapNextVid.id)).json();
  const duration = d.video.duration || 60; // fallback to 60s if unknown
  
  // Random time leaving enough room for the zapping interval
  zapNextTime = Math.random() * Math.max(0, duration - zapIv);
  
  // Preload into the hidden secondary video player
  const nextPlayerId = activePlayer === 'vP' ? 'vP_zap' : 'vP';
  const vpNext = $(nextPlayerId).el;
  
  vpNext.src = '/api/stream/' + zapNextVid.id + '#t=' + zapNextTime;
  vpNext.load();
  vpNext.pause(); // prevent autoplay on the preloaded player
}

async function doZapSwitch() {
  if (!zapOn || zapLock) return;
  
  if (!zapNextVid) await prepareNextZap();
  if (!zapNextVid) return; // if still no videos available
  
  const nextPlayerId = activePlayer === 'vP' ? 'vP_zap' : 'vP';
  const currPlayerId = activePlayer;
  
  const vpNext = $(nextPlayerId).el;
  const vpCurr = $(currPlayerId).el;
  
  // Seamless swap
  vpNext.style.display = ''; // or 'block' depending on your CSS
  vpNext.currentTime = zapNextTime;
  vpNext.play().catch(e => console.log('Autoplay prevented:', e));
  
  vpCurr.pause();
  vpCurr.style.display = 'none';
  
  activePlayer = nextPlayerId;
  
  // Update Video details UI
  curV = zapNextVid;
  $('pT').text(curV.name);
  if ($('pC').el) $('pC').text(curV.category);
  
  // Prepare the next video while current is playing
  prepareNextZap();
  
  // Schedule the next swap
  zapTimer = setTimeout(doZapSwitch, zapIv * 1000);
}

document.addEventListener('mouseenter', e => {
  const ct = e.target.closest?.('.ct[data-vid], .dup-th[data-vid]');
  if (!ct) return;
  clearTimeout(hoverTimer);
  hoverEl = ct;
  hoverTimer = setTimeout(() => {
    if (ct !== hoverEl || ct.querySelector('.ct-preview')) return;
    const vid = document.createElement('video');
    vid.className = 'ct-preview';
    vid.muted = true;
    vid.playsInline = true;
    vid.preload = 'metadata';
    vid.src = '/api/stream/' + ct.dataset.vid;
    vid.addEventListener('loadedmetadata', () => {
      vid.currentTime = vid.duration > 0 ? vid.duration / 2 : 0;
    });
    vid.addEventListener('seeked', function onSeeked() {
      vid.removeEventListener('seeked', onSeeked);
      vid.play().catch(() => {});
      vid._stop = setTimeout(() => vid.pause(), 10000);
    });
    ct.appendChild(vid);
  }, 250);
}, true);

document.addEventListener('mouseleave', e => {
  const ct = e.target.closest?.('.ct[data-vid], .dup-th[data-vid]');
  if (!ct || ct !== hoverEl) return;
  clearTimeout(hoverTimer);
  hoverEl = null;
  const vid = ct.querySelector('.ct-preview');
  if (vid) { clearTimeout(vid._stop); vid.pause(); vid.src = ''; vid.remove(); }
}, true);

// ─── Database ───
let dbMode = false, dbTab = 'actors', _dbData = {};

function showDatabase() {
  if (mosaicOn) stopMosaic();
  if (location.pathname !== '/database') history.pushState(null, '', '/database');
  dbMode = true;
  $('bv').add('off');
  ['pv','dv','av','adv','sv','sdv','tagDV','vaultV','scraperV','collectionsV','settingsV','foldersV','importFavsV'].forEach(id => $(id).remove('on'));
  document.querySelectorAll('.ci.on').forEach(el => el.classList.remove('on'));
  $('databaseSB').add('on');
  dupMode = false; vaultMode = false; scraperMode = false; foldersMode = false; importFavsMode = false;
  collectionsMode = false; settingsMode = false; studioMode = false; actorMode = false;
  curActor = null; curStudio = null; curTag = null; curV = null;
  $('dbV').add('on');
  loadDbTab(dbTab);
}

async function loadDbTab(tab) {
  dbTab = tab;
  document.querySelectorAll('.db-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('dbGrid').html('<div class="dup-scan">Loading\u2026</div>');
  const r = await fetch('/api/db/' + tab);
  _dbData = await r.json();
  renderDbCards(_dbData, tab);
}

function dbSwitchTab(tab) { loadDbTab(tab); }

function renderDbCards(data, tab) {
  const entries = Object.entries(data);
  if (!entries.length) {
    $('dbGrid').html('<div class="es" style="padding:40px 20px);text-align:center"><h3 style="color:var(--tx2)">No entries yet</h3><p style="color:var(--tx3)">Click + Add to create one</p></div>');
    return;
  }
  $('dbGrid').html(entries.map(([name, info]) => dbCard(name, info, tab)).join(''));
}

function dbCard(name, info, tab) {
  let details = '';
  if (tab === 'actors') {
    if (info.imdb_page)     details += '<a href="' + escA(info.imdb_page) + '" target="_blank" class="db-link" onclick="event.stopPropagation()">IMDb ↗</a>';
    if (info.date_of_birth) details += '<div class="db-field"><span class="db-lbl">Born</span><span>' + esc(info.date_of_birth) + '</span></div>';
    if (info.nationality)   details += '<div class="db-field"><span class="db-lbl">From</span><span>' + esc(info.nationality) + '</span></div>';
    if (info.movies)        details += '<div class="db-field db-movies"><span>' + esc(info.movies.slice(0, 120)) + (info.movies.length > 120 ? '\u2026' : '') + '</span></div>';
  } else if (tab === 'categories') {
    const tags = Array.isArray(info.tags) ? info.tags : [];
    if (tags.length) details += '<div class="db-tags">' + tags.map(t => '<span class="db-tag">' + esc(t) + '</span>').join('') + '</div>';
  } else if (tab === 'studios') {
    if (info.website)           details += '<a href="' + escA(info.website) + '" target="_blank" class="db-link" onclick="event.stopPropagation()">Website ↗</a>';
    if (info.short_description) details += '<div class="db-field db-movies"><span>' + esc(info.short_description.slice(0, 160)) + (info.short_description.length > 160 ? '\u2026' : '') + '</span></div>';
  }
  const encName = escA(name);
  return '<div class="db-card">' +
    '<div class="db-card-hd">' +
    '<span class="db-name">' + esc(name) + '</span>' +
    '<div class="db-card-acts">' +
    '<button onclick="dbShowEdit(\'' + encName + '\')" title="Edit"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>' +
    '<button onclick="dbDeleteEntry(\'' + encName + '\')" title="Delete"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>' +
    '</div></div>' +
    '<div class="db-card-body">' + details + '</div>' +
    '</div>';
}

function dbShowAdd() {
  openDbModal(null);
}

function dbShowEdit(name) {
  openDbModal(name, _dbData[name]);
}

function openDbModal(name, data) {
  const isEdit = !!name;
  $('dbMoTitle').text(isEdit ? 'Edit \u2014 ' + name : 'Add Entry');
  const body = $('dbMoBody').el;
  let fields = '<div style="display:flex;flex-direction:column;gap:2px"><label style="font-size:0.75rem;color:var(--tx3)">Name</label><input class="stg-ta" id="dbMoName" style="padding:8px;min-height:0" value="' + (isEdit ? escA(name) : '') + '" ' + (isEdit ? 'readonly' : '') + ' placeholder="Entry name"></div>';
  if (dbTab === 'actors') {
    fields += dbFieldInput('IMDb URL', 'dbMoImdb', data?.imdb_page || '');
    fields += dbFieldInput('Date of Birth', 'dbMoDob', data?.date_of_birth || '');
    fields += dbFieldInput('Nationality', 'dbMoNat', data?.nationality || '');
    fields += '<div style="display:flex;flex-direction:column;gap:2px"><label style="font-size:0.75rem;color:var(--tx3)">Movies</label><textarea class="stg-ta" id="dbMoMovies" style="min-height:70px">' + esc(data?.movies || '') + '</textarea></div>';
  } else if (dbTab === 'categories') {
    fields += '<div style="display:flex;flex-direction:column;gap:2px"><label style="font-size:0.75rem;color:var(--tx3)">Tags / Aliases (comma-separated)</label><input class="stg-ta" id="dbMoTags" style="padding:8px;min-height:0" value="' + escA((data?.tags || []).join(', ')) + '" placeholder="alias1, alias2"></div>';
  } else if (dbTab === 'studios') {
    fields += dbFieldInput('Website URL', 'dbMoWebsite', data?.website || '');
    fields += '<div style="display:flex;flex-direction:column;gap:2px"><label style="font-size:0.75rem;color:var(--tx3)">Description</label><textarea class="stg-ta" id="dbMoDesc" style="min-height:70px">' + esc(data?.short_description || '') + '</textarea></div>';
  }
  body.innerHTML = fields;
  $('dbMo').el.style.display = 'flex';
}

function dbFieldInput(label, id, value) {
  return '<div style="display:flex;flex-direction:column;gap:2px"><label style="font-size:0.75rem;color:var(--tx3)">' + label + '</label><input class="stg-ta" id="' + id + '" style="padding:8px;min-height:0" value="' + escA(value) + '"></div>';
}

function closeDbModal() {
  $('dbMo').show(false);
}

async function dbSaveModal() {
  const name = $('dbMoName').el.value.trim();
  if (!name) { toast('Name is required'); return; }
  let data = {};
  if (dbTab === 'actors') {
    data = {
      imdb_page:     $('dbMoImdb').el?.value.trim() || '',
      date_of_birth: $('dbMoDob').el?.value.trim() || '',
      nationality:   $('dbMoNat').el?.value.trim() || '',
      movies:        $('dbMoMovies').el?.value.trim() || '',
    };
  } else if (dbTab === 'categories') {
    const tagsRaw = $('dbMoTags').el?.value || '';
    data = { displayName: name, tags: tagsRaw.split(',').map(t => t.trim()).filter(Boolean) };
  } else if (dbTab === 'studios') {
    data = {
      website:           $('dbMoWebsite').el?.value.trim() || '',
      short_description: $('dbMoDesc').el?.value.trim() || '',
    };
  }
  const r = await fetch('/api/db/' + dbTab, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, data })
  });
  if (!r.ok) { toast('Save failed'); return; }
  closeDbModal();
  toast('Saved');
  loadDbTab(dbTab);
}

async function dbDeleteEntry(name) {
  if (!confirm('Delete "' + name + '"?')) return;
  const r = await fetch('/api/db/' + dbTab + '/' + encodeURIComponent(name), { method: 'DELETE' });
  if (!r.ok) { toast('Delete failed'); return; }
  toast('Deleted');
  loadDbTab(dbTab);
}

async function dbImportVideos() {
  const ta = $('dbImportPaths').el;
  const paths = ta.value.split('\n').map(l => l.trim()).filter(Boolean);
  if (!paths.length) { toast('Enter at least one file path'); return; }
  const status = $('dbImportStatus').el;
  status.textContent = 'Copying\u2026';
  const r = await fetch('/api/db/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths })
  });
  const d = await r.json();
  const ok = d.results.filter(x => x.ok).length;
  const fail = d.results.filter(x => !x.ok).length;
  status.textContent = ok + ' copied' + (fail ? ', ' + fail + ' failed' : '');
  if (ok) { ta.value = d.results.filter(x => !x.ok).map(x => x.path).join('\n'); toast(ok + ' video' + (ok !== 1 ? 's' : '') + ' copied'); refresh(); }
  else toast('No files copied \u2014 check paths');
}

// ─── Utilities ───
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function escA(s) { return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }
function hsh(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; } return h; }
function toast(m) { const e = $('tst').el; e.textContent = m; e.classList.add('show'); setTimeout(() => e.classList.remove('show'), 2500); }

// ─── Collapsible sections ───
function toggleSection(name) {
  const sec = $(name + 'Section').el;
  const h = $('sh3-' + name).el;
  const closed = sec.classList.toggle('closed');
  h.classList.toggle('closed', closed);
  localStorage.setItem('sc_' + name, closed ? '1' : '');
}

// ─── Lock vault on page unload ───
window.addEventListener('pagehide', () => { navigator.sendBeacon('/api/vault/lock'); });

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

// ─── Start ───
['library', 'browse', 'media', 'web', 'manage', 'cats', 'tags'].forEach(name => {
  if (localStorage.getItem('sc_' + name)) {
    $(name + 'Section').add('closed');
    $('sh3-' + name).add('closed');
  }
});
if (localStorage.getItem('pan')) { document.body.classList.add('pan'); $('panBtn').add('on'); }

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
  if (path === '/settings') { showSettings(); return; }
  if (path === '/database') { showDatabase(); return; }
  if (path === '/actors') { showActors(); return; }
  if (path === '/studios') { showStudios(); return; }
  if ((m = path.match(/^\/video\/([^/]+)$/))) { openVid(decodeURIComponent(m[1])); return; }
  if ((m = path.match(/^\/tag\/(.+)$/))) { openTag(decodeURIComponent(m[1])); return; }
  if ((m = path.match(/^\/cat\/(.+)$/))) { selCat(decodeURIComponent(m[1])); return; }
  if ((m = path.match(/^\/actor\/(.+)$/))) {
    await showActors();
    openActor(decodeURIComponent(m[1]));
    return;
  }
  if ((m = path.match(/^\/studio\/(.+)$/))) {
    await showStudios();
    openStudio(decodeURIComponent(m[1]));
    return;
  }
  if ((m = path.match(/^\/collection\/(.+)$/))) {
    showCollections();
    openCollectionDetail(decodeURIComponent(m[1]));
    return;
  }
  goHome();
}

window.addEventListener('popstate', () => { routeToPath(location.pathname); });

init().then(() => {
  if (location.pathname !== '/') routeToPath(location.pathname);
});
