// ─── Websites ───

let _webSites = [];
let _webStarred = new Set();
let websitesSort = 'name';

async function showWebsites() {
  closeAllViews();
  if (location.pathname !== '/websites') history.pushState(null, '', '/websites');
  websitesMode = true;
  $('browse-view').add('off');
  $('websites-sidebar').add('on');
  $('websites-view').add('on');
  const [sites, starredUrls] = await Promise.all([
    fetch('/api/websites').then(r => r.json()).catch(() => []),
    fetch('/api/websites/starred').then(r => r.json()).catch(() => []),
  ]);
  _webSites = sites;
  _webStarred = new Set(starredUrls);
  document.querySelectorAll('#websites-view .sort-btn[data-s]').forEach(b => b.classList.toggle('on', b.dataset.s === websitesSort));
  renderWebsites();
}

function setWebsitesSort(s) {
  websitesSort = s;
  document.querySelectorAll('#websites-view .sort-btn[data-s]').forEach(b => b.classList.toggle('on', b.dataset.s === s));
  renderWebsites();
}

function renderWebsites() {
  const grid = document.getElementById('websitesGrid');
  const empty = document.getElementById('websitesEmpty');
  if (!grid) return;
  let sites = [..._webSites];
  if (websitesSort === 'starred') {
    const starred = sites.filter(s => _webStarred.has(s.url));
    const rest = sites.filter(s => !_webStarred.has(s.url));
    sites = [...starred, ...rest];
  } else {
    sites.sort((a, b) => (a.name || a.url).localeCompare(b.name || b.url));
  }
  if (!sites.length) {
    grid.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  grid.innerHTML = sites.map(s => {
    const isStarred = _webStarred.has(s.url);
    let hostname = '';
    try { hostname = new URL(s.url).hostname; } catch {}
    return '<a class="search-site-item' + (isStarred ? ' starred' : '') + '" href="' + escA(s.url) + '" target="_blank" rel="noopener noreferrer" onclick="event.preventDefault();window.open(\'' + escA(s.url) + '\',\'_blank\')">' +
      '<div class="search-site-top">' +
        '<div class="search-site-icon">' +
          '<img src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(s.url) + '&sz=32" width="16" height="16" alt="" onerror="this.style.display=\'none\'">' +
        '</div>' +
        '<div class="search-site-name">' + esc(s.name || s.url) + '</div>' +
        '<button class="search-site-pin' + (isStarred ? ' on' : '') + '" onclick="event.preventDefault();event.stopPropagation();webStarToggle(\'' + escA(s.url) + '\')" title="' + (isStarred ? 'Unstar' : 'Star') + '">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="' + (isStarred ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="search-site-url">' + esc(hostname) + '</div>' +
    '</a>';
  }).join('');
}

async function webStarToggle(url) {
  try {
    const d = await fetch('/api/websites/star', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }).then(r => r.json());
    _webStarred = new Set(d.urls);
  } catch {
    if (_webStarred.has(url)) _webStarred.delete(url); else _webStarred.add(url);
  }
  renderWebsites();
}
