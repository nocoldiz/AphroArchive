// ─── Actors ───
let _actorList = [];

async function showActors() {
  closeAllViews();
  if (location.pathname !== '/actors') history.pushState(null, '', '/actors');
  actorMode = true;
  $('browse-view').add('off');
  $('actor-sidebar').add('on');
  $('actors-view').add('on');
  loadActorList();
}

async function loadActorList() {
  $('actorGrid').html(tpl('loading', { message: 'Loading actors\u2026' }));
  _actorList = await (await fetch('/api/actors')).json();
  $('actor-search-input').val('');
  renderActors(_actorList);
}

function filterActors(q) {
  const lo = q.trim().toLowerCase();
  renderActors(lo ? _actorList.filter(a => a.name.toLowerCase().includes(lo)) : _actorList);
}

function renderActors(actors) {
  const el = $('actorGrid').el;
  if (!actors.length) {
    el.innerHTML = tpl('empty-state', {
      icon:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
      title: 'No actors found',
      desc:  'Add actors in the Database section',
    });
    return;
  }
  const cols = ['#e84040','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];
  el.innerHTML = '<div class="actor-grid">' + actors.map(a => {
    const c = cols[Math.abs(hsh(a.name)) % cols.length];
    const metaParts = [];
    if (a.nationality) metaParts.push(esc(a.nationality));
    if (a.age != null) metaParts.push(a.deceased ? 'b. ' + (new Date().getFullYear() - a.age) + ' †' : a.age + ' y/o');
    const imdbLink = a.imdb_page ? '<a class="actor-link" href="' + esc(a.imdb_page) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">IMDb</a>' : '';
    const meta = metaParts.length ? '<div class="actor-meta">' + metaParts.join(' · ') + (imdbLink ? ' · ' + imdbLink : '') + '</div>' : (imdbLink ? '<div class="actor-meta">' + imdbLink + '</div>' : '');
    return '<div class="actor-card fade-in" onclick="openActor(\'' + escA(a.name) + '\')">' +
      '<div class="actor-avatar" style="background:' + c + '22;color:' + c + '">' +
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>' +
      '<img class="actor-photo" src="/api/actor-photos/' + encodeURIComponent(a.name) + '/img" alt="" onerror="this.style.display=\'none\'">' +
      '</div>' +
      '<div class="actor-name">' + esc(a.name) + '</div>' +
      '<div class="actor-count">' + a.count + ' video' + (a.count !== 1 ? 's' : '') + '</div>' +
      meta +
      '</div>';
  }).join('') + '</div>';
}

async function openActor(name) {
  if (location.pathname !== '/actor/' + encodeURIComponent(name)) history.pushState(null, '', '/actor/' + encodeURIComponent(name));
  curActor = name;
  $('actors-view').remove('on');
  $('actor-detail-view').add('on');
  $('actor-detail-name').text(name);
  $('actor-detail-grid').html(tpl('loading', { message: 'Loading\u2026' }));
  const d = await (await fetch('/api/actors/' + encodeURIComponent(name))).json();
  if (d.error) { $('actor-detail-grid').html(tpl('empty-state', { title: esc(d.error) })); return; }
  $('actor-detail-grid').html(d.videos.map(card).join(''));
  attachThumbs();
}

async function openActorFromVideo(name) {
  if (location.pathname !== '/actor/' + encodeURIComponent(name)) history.pushState(null, '', '/actor/' + encodeURIComponent(name));
  actorMode = true;
  curActor = name;
  $('player-view').remove('on');
  $('browse-view').add('off');
  document.querySelectorAll('.sidebar-item.on').forEach(e => e.classList.remove('on'));
  $('actor-sidebar').add('on');
  $('actors-view').remove('on');
  $('actor-detail-view').add('on');
  $('actor-detail-name').text(name);
  $('actor-detail-grid').html(tpl('loading', { message: 'Loading\u2026' }));
  const d = await (await fetch('/api/actors/' + encodeURIComponent(name))).json();
  if (d.error) { $('actor-detail-grid').html(tpl('empty-state', { title: esc(d.error) })); return; }
  $('actor-detail-grid').html(d.videos.map(card).join(''));
  attachThumbs();
}

function backActors() {
  curActor = null;
  $('actor-detail-view').remove('on');
  $('actors-view').add('on');
}
