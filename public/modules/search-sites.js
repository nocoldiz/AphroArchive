// ─── Search Sites ───
let _searchSites = [];

async function showSearchSites() {
  if (mosaicOn) stopMosaic();
  if (location.pathname !== '/search') history.pushState(null, '', '/search');
  $('browse-view').add('off');
  ['player-view','duplicates-view','actors-view','actor-detail-view','studios-view','studio-detail-view',
   'tag-detail-view','vault-view','scraper-view','collections-view','settings-view','import-favs-view',
   'books-view','database-view'].forEach(id => { const el = $(id).el; if (el) el.classList.remove('on'); });
  document.querySelectorAll('.sidebar-item.on').forEach(el => el.classList.remove('on'));
  $('search-sites-sidebar').add('on');
  dupMode = false; vaultMode = false; scraperMode = false; collectionsMode = false;
  settingsMode = false; importFavsMode = false; dbMode = false; booksMode = false;
  studioMode = false; actorMode = false;
  curActor = null; curStudio = null; curTag = null; curV = null; curCollection = null;
  $('search-sites-view').add('on');

  _searchSites = await fetch('/api/websites').then(r => r.json()).catch(() => []);
  renderSearchSites();
}

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

  list.html(searchable.map((s, i) => {
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
