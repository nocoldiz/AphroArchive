// ─── Search Sites ───
let _searchSites = [];
let _ssTab = 'cards';
let _ssActiveSite = null; // { name, scrapeMethod }
let _ssSearching = false;

async function showSearchSites() {
  closeAllViews();
  if (location.pathname !== '/search') history.pushState(null, '', '/search');
  $('browse-view').add('off');
  $('search-sites-sidebar').add('on');
  $('search-sites-view').add('on');

  _searchSites = await fetch('/api/websites').then(r => r.json()).catch(() => []);
  ssSwitchTab(_ssTab, true);
}

// ─── Tab switching ───
function ssSwitchTab(tab, force) {
  if (_ssTab === tab && !force) return;
  _ssTab = tab;
  $('ss-tab-cards').el.classList.toggle('on', tab === 'cards');
  $('ss-tab-sites').el.classList.toggle('on', tab === 'sites');
  $('ss-cards-pane').el.style.display = tab === 'cards' ? '' : 'none';
  $('ss-sites-pane').el.style.display = tab === 'sites' ? '' : 'none';
  $('ss-search-btn').el.style.display = tab === 'cards' ? '' : 'none';
  if (tab === 'cards') ssRenderPills();
  else renderSearchSites();
}

// ─── Input handlers ───
function ssOnInput() {
  if (_ssTab === 'sites') renderSearchSites();
}

function ssEnter() {
  if (_ssTab === 'cards') ssDoSearch();
  else renderSearchSites();
}

// ─── Site pills (cards tab) ───
function ssRenderPills() {
  const scrapable = _searchSites.filter(s => s.scrapeMethod);
  const noScr = $('ss-cards-no-scrapers').el;
  const pills = $('ss-site-pills').el;

  if (!scrapable.length) {
    noScr.style.display = '';
    pills.innerHTML = '';
    $('ss-cards-grid').html('');
    return;
  }
  noScr.style.display = 'none';

  // Default to first scrapable site if none selected or selected is gone
  if (!_ssActiveSite || !scrapable.find(s => s.scrapeMethod === _ssActiveSite.scrapeMethod)) {
    _ssActiveSite = scrapable[0];
  }

  pills.innerHTML = scrapable.map(s =>
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

  // Store results for bookmark access
  grid._ssResults = results;
}

function ssBookmark(idx) {
  const grid = $('ss-cards-grid').el;
  const results = grid._ssResults;
  if (!results || !results[idx]) return;
  const r = results[idx];

  // Check if already bookmarked
  const already = _bfItems.some(it => it.url === r.url);
  if (already) { toast('Already in bookmarks'); return; }

  _bfItems.push({ url: r.url, title: r.title, img: r.thumb });
  bfSaveCache();
  rebuildBookmarkVidIds(_bfItems);
  renCats();

  // Mark button as saved
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

  list.html(searchable.map(s => {
    const url = keyword ? s.searchURL + encodeURIComponent(keyword) : s.searchURL;
    const displayName = esc(s.name || s.url);
    const displayUrl = esc(url);
    return '<a class="search-site-item" href="' + escA(url) + '" target="_blank" rel="noopener noreferrer">' +
      '<div class="search-site-icon">' +
        '<img src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(s.url) + '&sz=32" ' +
        'width="16" height="16" alt="" onerror="this.style.display=\'none\'">' +
      '</div>' +
      '<div class="search-site-body">' +
        '<div class="search-site-name">' + displayName + (keyword ? ' <span class="search-site-kw">— ' + esc(keyword) + '</span>' : '') + '</div>' +
        '<div class="search-site-url">' + displayUrl + '</div>' +
      '</div>' +
      '<svg class="search-site-open" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>' +
    '</a>';
  }).join(''));
}
