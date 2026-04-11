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
