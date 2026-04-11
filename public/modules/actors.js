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

function backActors() {
  curActor = null;
  $('adv').remove('on');
  $('av').add('on');
}
