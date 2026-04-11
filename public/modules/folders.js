// ─── Folders ───
function showFolders() {
  if (mosaicOn) stopMosaic();
  if (location.pathname !== '/folders') history.pushState(null, '', '/folders');
  foldersMode = true;
  $('browse-view').add('off');
  ['player-view','duplicates-view','actors-view','actor-detail-view','studios-view','studio-detail-view','tag-detail-view','vault-view','scraper-view','collections-view','settings-view','import-favs-view','database-view'].forEach(id => $(id).remove('on'));
  document.querySelectorAll('.sidebar-item.on').forEach(el => el.classList.remove('on'));
  $('folders-sidebar').add('on');
  dupMode = false; vaultMode = false; scraperMode = false; collectionsMode = false; settingsMode = false; importFavsMode = false; dbMode = false;
  studioMode = false; actorMode = false;
  curActor = null; curStudio = null; curTag = null; curV = null; curCollection = null;
  $('folders-view').add('on');
  loadFolders();
}

async function loadFolders() {
  const folders = await (await fetch('/api/folders')).json();
  renderFolders(folders);
}

function renderFolders(folders) {
  const el = $('folderList').el;
  if (!folders.length) {
    el.innerHTML = '<div class="folder-empty">No external folders added yet.</div>';
    return;
  }
  el.innerHTML = folders.map((f, i) =>
    '<div class="folder-row">' +
    '<svg class="folder-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' +
    '<span class="folder-path">' + esc(f) + '</span>' +
    '<button class="folder-remove" onclick="removeFolder(' + i + ')" title="Remove"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
    '</div>'
  ).join('');
}

async function addFolder() {
  const input = $('folderPathIn').el;
  const err = $('folderErr').el;
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
