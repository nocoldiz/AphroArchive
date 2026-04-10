// ─── Actors ───
async function showActors() {
  if (mosaicOn) stopMosaic();
  if (location.pathname !== '/actors') history.pushState(null, '', '/actors');
  actorMode = true;
  curActor = null;
  document.getElementById('bv').classList.add('off');
  document.getElementById('pv').classList.remove('on');
  document.getElementById('dv').classList.remove('on');
  document.getElementById('dupSB').classList.remove('on');
  document.getElementById('adv').classList.remove('on');
  document.getElementById('actorSB').classList.add('on');
  document.getElementById('sv').classList.remove('on');
  document.getElementById('sdv').classList.remove('on');
  document.getElementById('studioSB').classList.remove('on');
  document.getElementById('tagDV').classList.remove('on');
  document.querySelectorAll('#tagList .ci').forEach(el => el.classList.remove('on'));
  document.getElementById('vaultV').classList.remove('on');
  document.getElementById('vaultSB').classList.remove('on');
  document.getElementById('scraperV').classList.remove('on');
  document.getElementById('scraperSB').classList.remove('on');
  document.getElementById('collectionsV').classList.remove('on');
  document.getElementById('collectionsSB').classList.remove('on');
  document.getElementById('foldersV').classList.remove('on');
  document.getElementById('foldersSB').classList.remove('on');
  document.getElementById('settingsV').classList.remove('on');
  document.getElementById('settingsSB').classList.remove('on');
  if (document.getElementById('dbV')) document.getElementById('dbV').classList.remove('on');
  dupMode = false; vaultMode = false; scraperMode = false; foldersMode = false; importFavsMode = false; collectionsMode = false; settingsMode = false; dbMode = false;
  studioMode = false; curStudio = null;
  curTag = null; curCollection = null;
  if (curV) { const vp = document.getElementById('vP'); vp.pause(); vp.src = ''; curV = null; }
  document.getElementById('av').classList.add('on');
  loadActorList();
}

async function loadActorList() {
  document.getElementById('actorGrid').innerHTML = '<div class="dup-scan">Loading actors\u2026</div>';
  const actors = await (await fetch('/api/actors')).json();
  renderActors(actors);
}

function renderActors(actors) {
  const el = document.getElementById('actorGrid');
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
  document.getElementById('av').classList.remove('on');
  document.getElementById('adv').classList.add('on');
  document.getElementById('adName').textContent = name;
  document.getElementById('adG').innerHTML = '<div class="dup-scan">Loading\u2026</div>';
  const d = await (await fetch('/api/actors/' + encodeURIComponent(name))).json();
  if (d.error) { document.getElementById('adG').innerHTML = '<div class="es" style="padding:40px 20px"><h3>' + esc(d.error) + '</h3></div>'; return; }
  document.getElementById('adG').innerHTML = d.videos.map(card).join('');
  attachThumbs();
}

async function openActorFromVideo(name) {
  if (location.pathname !== '/actor/' + encodeURIComponent(name)) history.pushState(null, '', '/actor/' + encodeURIComponent(name));
  actorMode = true;
  curActor = name;
  document.getElementById('pv').classList.remove('on');
  document.getElementById('bv').classList.add('off');
  document.querySelectorAll('.ci.on').forEach(e => e.classList.remove('on'));
  document.getElementById('actorSB').classList.add('on');
  document.getElementById('av').classList.remove('on');
  document.getElementById('adv').classList.add('on');
  document.getElementById('adName').textContent = name;
  document.getElementById('adG').innerHTML = '<div class="dup-scan">Loading\u2026</div>';
  const d = await (await fetch('/api/actors/' + encodeURIComponent(name))).json();
  if (d.error) { document.getElementById('adG').innerHTML = '<div class="es" style="padding:40px 20px"><h3>' + esc(d.error) + '</h3></div>'; return; }
  document.getElementById('adG').innerHTML = d.videos.map(card).join('');
  attachThumbs();
}

function backActors() {
  curActor = null;
  document.getElementById('adv').classList.remove('on');
  document.getElementById('av').classList.add('on');
}
