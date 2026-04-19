// ─── Search Sites ───
let _searchSites = [];
let _ssTab = 'sites';
let _ssActiveSite = null; // { name, scrapeMethod }
let _ssSearching = false;
let _ssStarred = new Set(); // URLs of starred sites (server-backed)
let _ssSearchHistory = []; // [{ site: {...}, query: '...' }]
let _ssTrackingDisabled = false;

async function showSearchSites() {
  closeAllViews();
  if (location.pathname !== '/search') history.pushState(null, '', '/search');
  $('browse-view').add('off');
  $('search-sites-sidebar').add('on');
  $('search-sites-view').add('on');

  const [sites, starredUrls, prefs] = await Promise.all([
    fetch('/api/websites').then(r => r.json()).catch(() => []),
    fetch('/api/websites/starred').then(r => r.json()).catch(() => []),
    fetch('/api/settings/prefs').then(r => r.json()).catch(() => ({})),
  ]);
  _searchSites = sites;
  _ssStarred = new Set(starredUrls);
  _ssTrackingDisabled = !!prefs.disableSearchTracking;
  _ssLoadHistory();
  ssSwitchTab(_ssTab, true);
}

// ─── Search history persistence ───
function _ssLoadHistory() {
  try { _ssSearchHistory = JSON.parse(localStorage.getItem('ss_history') || '[]'); } catch { _ssSearchHistory = []; }
}
function _ssSaveHistory() {
  localStorage.setItem('ss_history', JSON.stringify(_ssSearchHistory));
}
function _ssAddHistory(site, query) {
  if (_ssTrackingDisabled || !query) return;
  _ssSearchHistory = _ssSearchHistory.filter(h => !(h.siteUrl === site.url && h.query === query));
  _ssSearchHistory.unshift({ siteUrl: site.url, siteName: site.name, query, ts: Date.now() });
  if (_ssSearchHistory.length > 100) _ssSearchHistory = _ssSearchHistory.slice(0, 100);
  _ssSaveHistory();
}

// ─── Tab switching ───
function ssSwitchTab(tab, force) {
  if (_ssTab === tab && !force) return;
  _ssTab = tab;
  $('ss-tab-cards').el.classList.toggle('on', tab === 'cards');
  $('ss-tab-sites').el.classList.toggle('on', tab === 'sites');
  $('ss-tab-history').el.classList.toggle('on', tab === 'history');
  $('ss-cards-pane').el.style.display = tab === 'cards' ? '' : 'none';
  $('ss-sites-pane').el.style.display = tab === 'sites' ? '' : 'none';
  $('ss-history-pane').el.style.display = tab === 'history' ? '' : 'none';
  $('ss-search-btn').el.style.display = tab === 'cards' ? '' : 'none';
  if (tab === 'cards') ssRenderPills();
  else if (tab === 'sites') renderSearchSites();
  else renderSearchHistory();
}

// ─── Input handlers ───
function ssOnInput() {
  if (_ssTab === 'sites') renderSearchSites();
}

function ssEnter() {
  if (_ssTab === 'cards') ssDoSearch();
  else renderSearchSites();
}

// ─── Star toggle ───
async function ssStarToggle(url) {
  try {
    const d = await fetch('/api/websites/star', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }).then(r => r.json());
    _ssStarred = new Set(d.urls);
  } catch {
    if (_ssStarred.has(url)) _ssStarred.delete(url); else _ssStarred.add(url);
  }
  if (_ssTab === 'cards') ssRenderPills();
  else renderSearchSites();
}

// ─── Site pills (cards tab) ───
function ssRenderPills() {
  const starredScrapable = _searchSites.filter(s => s.scrapeMethod && _ssStarred.has(s.url));
  const noStarEl = $('ss-cards-no-scrapers').el;
  const pills = $('ss-site-pills').el;

  if (!starredScrapable.length) {
    noStarEl.style.display = '';
    pills.innerHTML = '';
    $('ss-cards-grid').html('');
    return;
  }
  noStarEl.style.display = 'none';

  if (!_ssActiveSite || !starredScrapable.find(s => s.scrapeMethod === _ssActiveSite.scrapeMethod)) {
    _ssActiveSite = starredScrapable[0];
  }

  pills.innerHTML = starredScrapable.map(s =>
    '<button class="ss-pill' + (s.scrapeMethod === _ssActiveSite.scrapeMethod ? ' on' : '') + '" ' +
    'onclick="ssSelectSite(' + JSON.stringify(s.scrapeMethod) + ')">' +
    '<img src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(s.url) + '&sz=16" ' +
    'width="12" height="12" alt="" onerror="this.style.display=\'none\'" style="vertical-align:-1px;margin-right:5px">' +
    esc(s.name || s.url) + '</button>'
  ).join('');
}

function ssSelectSite(scrapeMethod) {
  const site = _searchSites.find(s => s.scrapeMethod === scrapeMethod);
  if (!site) return;
  _ssActiveSite = site;
  ssRenderPills();
  const q = ($('search-sites-input').el?.value || '').trim();
  if (q) ssDoSearch();
}

// ─── Scrape search ───
async function ssDoSearch() {
  if (_ssSearching) return;
  const q = ($('search-sites-input').el?.value || '').trim();
  if (!q || !_ssActiveSite) return;

  _ssSearching = true;
  const grid = $('ss-cards-grid').el;
  const empty = $('ss-cards-empty').el;
  empty.style.display = 'none';
  grid.innerHTML = '<div class="ss-loading"><div class="ss-loading-spin"></div>Searching…</div>';

  try {
    const r = await fetch('/api/scrape?method=' + encodeURIComponent(_ssActiveSite.scrapeMethod) + '&q=' + encodeURIComponent(q));
    const d = await r.json();
    if (d.error) { grid.innerHTML = '<div class="ss-error">' + esc(d.error) + '</div>'; return; }
    ssRenderCards(d.results || []);
  } catch (e) {
    grid.innerHTML = '<div class="ss-error">Request failed: ' + esc(e.message) + '</div>';
  } finally {
    _ssSearching = false;
  }
}

function ssRenderCards(results) {
  const grid = $('ss-cards-grid').el;
  const empty = $('ss-cards-empty').el;
  if (!results.length) {
    grid.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  grid.innerHTML = results.map((r, i) =>
    '<div class="ss-card" onclick="window.open(\'' + escA(r.url) + '\',\'_blank\')">' +
      '<div class="ss-card-thumb">' +
        '<img src="' + escA(r.thumb) + '" alt="" loading="lazy" onerror="this.parentNode.classList.add(\'no-thumb\')">' +
        '<div class="ss-card-play"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></div>' +
        '<button class="ss-card-bm" onclick="event.stopPropagation();ssBookmark(' + i + ')" title="Save to bookmarks" id="ssbm-' + i + '">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="ss-card-info">' +
        '<div class="ss-card-title" title="' + escA(r.title) + '">' + esc(r.title) + '</div>' +
        '<div class="ss-card-source">' + esc(r.source || '') + '</div>' +
      '</div>' +
    '</div>'
  ).join('');

  grid._ssResults = results;
}

function ssBookmark(idx) {
  const grid = $('ss-cards-grid').el;
  const results = grid._ssResults;
  if (!results || !results[idx]) return;
  const r = results[idx];

  const already = _bfItems.some(it => it.url === r.url);
  if (already) { toast('Already in bookmarks'); return; }

  _bfItems.push({ url: r.url, title: r.title, img: r.thumb });
  bfSaveCache();
  rebuildBookmarkVidIds(_bfItems);
  renCats();

  const btn = document.getElementById('ssbm-' + idx);
  if (btn) btn.classList.add('saved');
  toast('Saved to bookmarks');
}

// ─── Sites tab ───
function renderSearchSites() {
  const keyword = ($('search-sites-input').el?.value || '').trim();
  const searchable = _searchSites.filter(s => s.searchURL);

  const list = $('search-sites-list');
  const empty = $('search-sites-empty');

  if (!searchable.length) {
    list.html('');
    empty.show(true);
    return;
  }
  empty.show(false);

  const starred   = searchable.filter(s => _ssStarred.has(s.url));
  const unstarred = searchable.filter(s => !_ssStarred.has(s.url));
  const sorted    = [...starred, ...unstarred];

  list.html(sorted.map(s => {
    const isStarred = _ssStarred.has(s.url);
    const hasSearch = s.hasSearch !== false;
    const url = (keyword && hasSearch) ? s.searchURL + encodeURIComponent(keyword) : s.searchURL;
    const href = `onclick="event.preventDefault();_ssOpenSite('${escA(s.url)}','${escA(s.searchURL)}',${JSON.stringify(s.name||s.url)},${JSON.stringify(s.hasSearch !== false)});"`;
    let hostname = '';
    try { hostname = new URL(s.url).hostname; } catch {}
    return '<a class="search-site-item' + (isStarred ? ' starred' : '') + '" href="' + escA(url) + '" target="_blank" rel="noopener noreferrer" ' + href + '>' +
      '<div class="search-site-top">' +
        '<div class="search-site-icon">' +
          '<img src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(s.url) + '&sz=32" ' +
          'width="16" height="16" alt="" onerror="this.style.display=\'none\'">' +
        '</div>' +
        '<div class="search-site-name">' + esc(s.name || s.url) + (keyword && hasSearch ? ' <span class="search-site-kw">— ' + esc(keyword) + '</span>' : '') + '</div>' +
        '<button class="search-site-pin' + (isStarred ? ' on' : '') + '" onclick="event.preventDefault();event.stopPropagation();ssStarToggle(\'' + escA(s.url) + '\')" title="' + (isStarred ? 'Unstar' : 'Star') + '">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="' + (isStarred ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="search-site-url">' + esc(hostname) + '</div>' +
    '</a>';
  }).join(''));
}

function _ssOpenSite(siteUrl, searchUrl, siteName, hasSearch) {
  const q = ($('search-sites-input').el?.value || '').trim();
  const url = (q && hasSearch) ? searchUrl + encodeURIComponent(q) : searchUrl;
  if (q && hasSearch) {
    const site = _searchSites.find(s => s.url === siteUrl);
    if (site) _ssAddHistory(site, q);
  }
  window.open(url, '_blank');
}

// ─── Latest search tab ───
function renderSearchHistory() {
  const pane = $('ss-history-pane').el;
  const controls = '<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap">' +
    '<button class="ss-hist-ctrl-btn" onclick="ssClearHistory()" title="Clear all">Clear all</button>' +
    '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--tx2);cursor:pointer">' +
      '<input type="checkbox" id="ss-tracking-toggle" onchange="ssToggleTracking(this.checked)" ' + (_ssTrackingDisabled ? 'checked' : '') + '>' +
      'Disable tracking' +
    '</label>' +
  '</div>';

  if (!_ssSearchHistory.length) {
    pane.innerHTML = controls + '<div class="empty-state" style="padding:20px 0"><p>' + (_ssTrackingDisabled ? 'Search tracking is disabled.' : 'No recent searches.') + '</p></div>';
    return;
  }

  const items = _ssSearchHistory.map((h, i) => {
    const site = _searchSites.find(s => s.url === h.siteUrl);
    const hasSearch = site ? site.hasSearch !== false : true;
    const url = (hasSearch && site) ? site.searchURL + encodeURIComponent(h.query) : (site ? site.searchURL : h.siteUrl);
    let favicon = '';
    try { favicon = '<img src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(h.siteUrl) + '&sz=16" width="12" height="12" style="vertical-align:-1px;margin-right:5px" onerror="this.style.display=\'none\'">'; } catch {}
    return '<div class="ss-hist-item">' +
      '<a href="' + escA(url) + '" target="_blank" rel="noopener noreferrer" class="ss-hist-link" onclick="ssHistClick(event,' + i + ')">' +
        favicon + esc(h.siteName || h.siteUrl) +
        (hasSearch ? ' <span class="search-site-kw">— ' + esc(h.query) + '</span>' : '') +
      '</a>' +
      '<button class="ss-hist-rm" onclick="ssRemoveHistory(' + i + ')" title="Remove">×</button>' +
    '</div>';
  }).join('');

  pane.innerHTML = controls + items;
  document.getElementById('ss-tracking-toggle').checked = _ssTrackingDisabled;
}

function ssHistClick(e, i) {
  // No additional tracking needed — already in history
}

function ssRemoveHistory(i) {
  _ssSearchHistory.splice(i, 1);
  _ssSaveHistory();
  renderSearchHistory();
}

function ssClearHistory() {
  _ssSearchHistory = [];
  _ssSaveHistory();
  renderSearchHistory();
}

async function ssToggleTracking(disabled) {
  _ssTrackingDisabled = disabled;
  await fetch('/api/settings/prefs', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ disableSearchTracking: disabled }),
  }).catch(() => {});
  if (disabled) { _ssSearchHistory = []; _ssSaveHistory(); }
  renderSearchHistory();
}
