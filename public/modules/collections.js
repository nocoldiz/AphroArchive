// ─── Collections ───
function showCollections() {
  closeAllViews();
  if (location.pathname !== '/collections') history.pushState(null, '', '/collections');
  collectionsMode = true;
  $('browse-view').add('off');
  $('collections-sidebar').add('on');
  $('collections-view').add('on');
  $('collection-title').text('Playlist');
  $('collection-new-row').show();
  loadCollectionsView();
}

async function loadCollectionsView() {
  const cols = await (await fetch('/api/collections')).json();
  renderCollections(cols);
}

function renderCollections(cols) {
  const el = $('collection-content').el;
  if (!cols.length) {
    el.innerHTML = '<div class="collection-empty">No playlists yet. Create one above.</div>';
    return;
  }
  el.innerHTML = '<div class="collection-grid">' + cols.map(col =>
    '<div class="collection-card" onclick="openCollectionDetail(\'' + escA(col.name) + '\')">' +
    '<div class="collection-card-name">' + esc(col.name) + '</div>' +
    '<div class="collection-card-count">' + col.count + ' video' + (col.count !== 1 ? 's' : '') + '</div>' +
    '<button class="collection-delete" onclick="event.stopPropagation();deleteCollection(\'' + escA(col.name) + '\')" title="Delete collection"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
    '</div>'
  ).join('') + '</div>';
}

async function openCollectionDetail(name) {
  if (location.pathname !== '/collection/' + encodeURIComponent(name)) history.pushState(null, '', '/collection/' + encodeURIComponent(name));
  curCollection = name;
  $('collection-title').text(name);
  $('collection-new-row').show(false);
  const videos = await (await fetch('/api/collections/' + encodeURIComponent(name) + '/videos')).json();
  const el = $('collection-content').el;
  el.innerHTML =
    '<button class="back-btn" style="margin-bottom:16px" onclick="showCollections()">' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>Playlist</button>' +
    (videos.length ? '<div class="video-grid">' + videos.map(v => card(v)).join('') + '</div>'
      : '<div class="collection-empty">No videos in this playlist.</div>');
}

async function createCollection() {
  const inp = $('collection-name-input').el;
  const name = inp.value.trim();
  if (!name) return;
  const r = await fetch('/api/collections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  const d = await r.json();
  if (!r.ok) { toast(d.error || 'Failed'); return; }
  inp.value = '';
  toast('Playlist "' + name + '" created');
  loadCollectionsView();
}

async function deleteCollection(name) {
  if (!confirm('Delete playlist "' + name + '"?')) return;
  const r = await fetch('/api/collections/' + encodeURIComponent(name), { method: 'DELETE' });
  if (!r.ok) { toast('Delete failed'); return; }
  toast('Playlist deleted');
  loadCollectionsView();
}

// ─── Add-to-Collection Modal ───
async function openAddToCollection() {
  if (!curV) return;
  cvTargetId = curV.id;
  const cols = await (await fetch('/api/collections')).json();
  const list = $('collection-modal-list').el;
  const newSection = $('collection-modal-new').el;
  const createBtn = $('collection-modal-create-btn').el;
  newSection.classList.remove('on');
  createBtn.style.display = 'none';
  $('collection-modal-name-input').val('');
  list.innerHTML = cols.map(col =>
    '<button class="collection-option" onclick="addToCollection(\'' + escA(col.name) + '\')">' + esc(col.name) + '</button>'
  ).join('') +
  '<button class="collection-option collection-option-new" onclick="showCvNewInput()">+ New playlist…</button>';
  $('collection-modal').add('on');
}

function showCvNewInput() {
  $('collection-modal-new').add('on');
  $('collection-modal-create-btn').show();
  $('collection-modal-name-input').el.focus();
}

async function addToCollection(name) {
  const r = await fetch('/api/collections/' + encodeURIComponent(name) + '/videos', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: cvTargetId })
  });
  const d = await r.json();
  closeCvModal();
  if (r.ok) toast('Added to "' + name + '"');
  else toast(d.error || 'Failed');
}

async function submitCvNew() {
  const name = $('collection-modal-name-input').el.value.trim();
  if (!name) return;
  const cr = await fetch('/api/collections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  if (!cr.ok) { const d = await cr.json(); toast(d.error || 'Failed'); return; }
  await addToCollection(name);
}

function closeCvModal() {
  $('collection-modal').remove('on');
  cvTargetId = null;
}
