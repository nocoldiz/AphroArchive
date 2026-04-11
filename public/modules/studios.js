// ─── Studios ───
let _studioList = [];

async function showStudios() {
  if (mosaicOn) stopMosaic();
  if (location.pathname !== '/studios') history.pushState(null, '', '/studios');
  studioMode = true;
  curStudio = null;
  $('browse-view').add('off');
  $('player-view').remove('on');
  $('duplicates-view').remove('on');
  $('duplicates-sidebar').remove('on');
  $('studio-detail-view').remove('on');
  $('studio-sidebar').add('on');
  $('actors-view').remove('on');
  $('actor-detail-view').remove('on');
  $('actor-sidebar').remove('on');
  $('tag-detail-view').remove('on');
  document.querySelectorAll('#tagList .sidebar-item').forEach(el => el.classList.remove('on'));
  $('vault-view').remove('on');
  $('vault-sidebar').remove('on');
  $('scraper-view').remove('on');
  $('scraper-sidebar').remove('on');
  $('collections-view').remove('on');
  $('collections-sidebar').remove('on');
  $('folders-view').remove('on');
  $('folders-sidebar').remove('on');
  $('settings-view').remove('on');
  $('settings-sidebar').remove('on');
  if ($('database-view').el) $('database-view').remove('on');
  dupMode = false; vaultMode = false; scraperMode = false; foldersMode = false; importFavsMode = false; collectionsMode = false; settingsMode = false; dbMode = false;
  actorMode = false; curActor = null;
  curTag = null; curCollection = null;
  if (curV) { const vp = $('video-player').el; vp.pause(); vp.src = ''; curV = null; }
  $('studios-view').add('on');
  loadStudioList();
}

async function loadStudioList() {
  $('studioGrid').html(tpl('loading', { message: 'Loading studios\u2026' }));
  _studioList = await (await fetch('/api/studios')).json();
  $('studio-search-input').val('');
  renderStudios(_studioList);
}

function filterStudios(q) {
  const lo = q.trim().toLowerCase();
  renderStudios(lo ? _studioList.filter(s => s.name.toLowerCase().includes(lo)) : _studioList);
}

function renderStudios(studios) {
  const el = $('studioGrid').el;
  if (!studios.length) {
    el.innerHTML = tpl('empty-state', {
      icon:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="7" width="20" height="15" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>',
      title: 'No studios found',
      desc:  'Add studios in the Database section',
    });
    return;
  }
  const cols = ['#e84040','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];
  el.innerHTML = '<div class="actor-grid">' + studios.map(s => {
    const c = cols[Math.abs(hsh(s.name)) % cols.length];
    const websiteLink = s.website ? '<a class="actor-link" href="' + esc(s.website) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">Website</a>' : '';
    const desc = s.description ? '<div class="actor-desc">' + esc(s.description) + '</div>' : '';
    return '<div class="actor-card fade-in" onclick="openStudio(\'' + escA(s.name) + '\')">' +
      '<div class="actor-avatar" style="background:' + c + '22;color:' + c + '">' +
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="7" width="20" height="15" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg></div>' +
      '<div class="actor-name">' + esc(s.name) + '</div>' +
      '<div class="actor-count">' + s.count + ' video' + (s.count !== 1 ? 's' : '') + (websiteLink ? ' · ' + websiteLink : '') + '</div>' +
      desc +
      '</div>';
  }).join('') + '</div>';
}

async function openStudio(name) {
  if (location.pathname !== '/studio/' + encodeURIComponent(name)) history.pushState(null, '', '/studio/' + encodeURIComponent(name));
  curStudio = name;
  $('studios-view').remove('on');
  $('studio-detail-view').add('on');
  $('studio-detail-name').text(name);
  $('studio-detail-grid').html(tpl('loading', { message: 'Loading\u2026' }));
  const d = await (await fetch('/api/studios/' + encodeURIComponent(name))).json();
  if (d.error) { $('studio-detail-grid').html(tpl('empty-state', { title: esc(d.error) })); return; }
  $('studio-detail-grid').html(d.videos.map(card).join(''));
  attachThumbs();
}

function backStudios() {
  curStudio = null;
  $('studio-detail-view').remove('on');
  $('studios-view').add('on');
}
