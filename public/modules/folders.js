// ─── Folders ───
function showFolders() {
  if (mosaicOn) stopMosaic();
  if (location.pathname !== '/folders') history.pushState(null, '', '/folders');
  foldersMode = true;
  document.getElementById('bv').classList.add('off');
  ['pv','dv','av','adv','sv','sdv','tagDV','vaultV','scraperV','collectionsV','settingsV','importFavsV','dbV'].forEach(id => document.getElementById(id).classList.remove('on'));
  document.querySelectorAll('.ci.on').forEach(el => el.classList.remove('on'));
  document.getElementById('foldersSB').classList.add('on');
  dupMode = false; vaultMode = false; scraperMode = false; collectionsMode = false; settingsMode = false; importFavsMode = false; dbMode = false;
  studioMode = false; actorMode = false;
  curActor = null; curStudio = null; curTag = null; curV = null; curCollection = null;
  document.getElementById('foldersV').classList.add('on');
  loadFolders();
}

async function loadFolders() {
  const folders = await (await fetch('/api/folders')).json();
  renderFolders(folders);
}

function renderFolders(folders) {
  const el = document.getElementById('folderList');
  if (!folders.length) {
    el.innerHTML = '<div class="fv-empty">No external folders added yet.</div>';
    return;
  }
  el.innerHTML = folders.map((f, i) =>
    '<div class="fv-row">' +
    '<svg class="fv-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' +
    '<span class="fv-path">' + esc(f) + '</span>' +
    '<button class="fv-rm" onclick="removeFolder(' + i + ')" title="Remove"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
    '</div>'
  ).join('');
}

async function addFolder() {
  const input = document.getElementById('folderPathIn');
  const err = document.getElementById('folderErr');
  const p = input.value.trim();
  err.style.display = 'none';
  if (!p) return;
  const r = await fetch('/api/folders', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: p })
  });
  const d = await r.json();
  if (!r.ok) { err.textContent = d.error || 'Failed'; err.style.display = 'block'; return; }
  input.value = '';
  toast('Folder added — ' + (d.count || 0) + ' video' + (d.count !== 1 ? 's' : '') + ' found');
  loadFolders();
  await refresh();
}

async function removeFolder(idx) {
  const r = await fetch('/api/folders/' + idx, { method: 'DELETE' });
  if (!r.ok) { toast('Remove failed'); return; }
  toast('Folder removed');
  loadFolders();
  await refresh();
}
