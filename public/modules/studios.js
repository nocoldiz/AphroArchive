// ─── Studios ───
let _studioList = [];

async function showStudios() {
  closeAllViews();
  if (location.pathname !== '/studios') history.pushState(null, '', '/studios');
  studioMode = true;
  $('browse-view').add('off');
  $('studio-sidebar').add('on');
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

function _studioCard(s) {
  const cols = ['#e84040','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];
  const c = cols[Math.abs(hsh(s.name)) % cols.length];
  const websiteLink = s.website ? '<a class="actor-link" href="' + esc(s.website) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">Website</a>' : '';
  const desc = s.description ? '<div class="actor-desc">' + esc(s.description) + '</div>' : '';
  return '<div class="actor-card fade-in' + (s.count === 0 ? ' actor-card-unmatched' : '') + '" onclick="openStudio(\'' + escA(s.name) + '\')">' +
    '<div class="actor-avatar" style="background:' + c + '22;color:' + c + '">' +
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="7" width="20" height="15" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg></div>' +
    '<div class="actor-name">' + esc(s.name) + '</div>' +
    '<div class="actor-count">' + (s.count > 0 ? s.count + ' video' + (s.count !== 1 ? 's' : '') : 'No videos') + (websiteLink ? ' · ' + websiteLink : '') + '</div>' +
    desc +
    '</div>';
}

function renderStudios(studios) {
  const el = $('studioGrid').el;
  const active = studios.filter(s => s.count > 0);
  const others = studios.filter(s => s.count === 0);
  if (!active.length && !others.length) {
    el.innerHTML = tpl('empty-state', {
      icon:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="7" width="20" height="15" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>',
      title: 'No studios found',
      desc:  'Add studios in the Database section',
    });
    return;
  }
  let html = '';
  if (active.length) html += '<div class="actor-grid">' + active.map(_studioCard).join('') + '</div>';
  if (others.length) {
    html += '<div class="actor-section-sep"><span>Other Studios</span></div>';
    html += '<div class="actor-grid">' + others.map(_studioCard).join('') + '</div>';
  }
  el.innerHTML = html;
}

async function openStudio(name) {
  if (location.pathname !== '/studio/' + encodeURIComponent(name)) history.pushState(null, '', '/studio/' + encodeURIComponent(name));
  if (curStudio !== name) closeAllViews();
  curStudio = name;
  studioMode = true;
  $('studios-view').remove('on');
  $('studio-detail-view').add('on');
  $('studio-detail-name').text(name);
  $('studio-detail-grid').html(tpl('loading', { message: 'Loading\u2026' }));
  const url = '/api/studios/' + encodeURIComponent(name) + (favFilter ? '?fav=1' : '');
  const d = await (await fetch(url)).json();
  if (d.error) { $('studio-detail-grid').html(tpl('empty-state', { title: esc(d.error) })); return; }
  $('studio-detail-grid').html(d.videos.map(card).join(''));
  _staggerFadeIn($('studio-detail-grid').el);
  attachThumbs();
}

function backStudios() {
  curStudio = null;
  $('studio-detail-view').remove('on');
  $('studios-view').add('on');
}
