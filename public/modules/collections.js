// ─── Collections ───
function showCollections() {
  if (mosaicOn) stopMosaic();
  if (location.pathname !== '/collections') history.pushState(null, '', '/collections');
  collectionsMode = true;
  $('bv').add('off');
  document.querySelectorAll('.ci.on').forEach(e => e.classList.remove('on'));
  $('collectionsSB').add('on');
  scraperMode = false; foldersMode = false; importFavsMode = false; settingsMode = false; dbMode = false;
  studioMode = false; actorMode = false;
  curActor = null; curStudio = null; curTag = null; curV = null;
  document.querySelectorAll('.pv,.adv,.sv,.av,.dv,.scraperV,.foldersV,.settingsV').forEach(e => e.classList.remove('on'));
  $('vaultV').remove('on');
  if ($('dbV').el) $('dbV').remove('on');
  $('collectionsV').add('on');
  curCollection = null;
  $('cvTitle').text('Collections');
  $('cvNewRow').show();
  loadCollectionsView();
}

async function loadCollectionsView() {
  const cols = await (await fetch('/api/collections')).json();
  renderCollections(cols);
}

function renderCollections(cols) {
  const el = $('cvContent').el;
  if (!cols.length) {
    el.innerHTML = '<div class="cv-empty">No collections yet. Create one above.</div>';
    return;
  }
  el.innerHTML = '<div class="cv-grid">' + cols.map(col =>
    '<div class="cv-card" onclick="openCollectionDetail(\'' + escA(col.name) + '\')">' +
    '<div class="cv-card-name">' + esc(col.name) + '</div>' +
    '<div class="cv-card-count">' + col.count + ' video' + (col.count !== 1 ? 's' : '') + '</div>' +
    '<button class="cv-del" onclick="event.stopPropagation();deleteCollection(\'' + escA(col.name) + '\')" title="Delete collection"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
    '</div>'
  ).join('') + '</div>';
}

async function openCollectionDetail(name) {
  if (location.pathname !== '/collection/' + encodeURIComponent(name)) history.pushState(null, '', '/collection/' + encodeURIComponent(name));
  curCollection = name;
  $('cvTitle').text(name);
  $('cvNewRow').show(false);
  const videos = await (await fetch('/api/collections/' + encodeURIComponent(name) + '/videos')).json();
  const el = $('cvContent').el;
  el.innerHTML =
    '<button class="bbk" style="margin-bottom:16px" onclick="showCollections()">' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>Collections</button>' +
    (videos.length ? '<div class="vg">' + videos.map(v => card(v)).join('') + '</div>'
      : '<div class="cv-empty">No videos in this collection.</div>');
}

async function createCollection() {
  const inp = $('cvNameIn').el;
  const name = inp.value.trim();
  if (!name) return;
  const r = await fetch('/api/collections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  const d = await r.json();
  if (!r.ok) { toast(d.error || 'Failed'); return; }
  inp.value = '';
  toast('Collection "' + name + '" created');
  loadCollectionsView();
}

async function deleteCollection(name) {
  if (!confirm('Delete collection "' + name + '"?')) return;
  const r = await fetch('/api/collections/' + encodeURIComponent(name), { method: 'DELETE' });
  if (!r.ok) { toast('Delete failed'); return; }
  toast('Collection deleted');
  loadCollectionsView();
}

// ─── Add-to-Collection Modal ───
async function openAddToCollection() {
  if (!curV) return;
  cvTargetId = curV.id;
  const cols = await (await fetch('/api/collections')).json();
  const list = $('cvModalList').el;
  const newSection = $('cvModalNew').el;
  const createBtn = $('cvModalCreateBtn').el;
  newSection.classList.remove('on');
  createBtn.style.display = 'none';
  $('cvModalNameIn').val('');
  list.innerHTML = cols.map(col =>
    '<button class="cv-opt" onclick="addToCollection(\'' + escA(col.name) + '\')">' + esc(col.name) + '</button>'
  ).join('') +
  '<button class="cv-opt cv-opt-new" onclick="showCvNewInput()">+ New collection…</button>';
  $('cvModal').add('on');
}

function showCvNewInput() {
  $('cvModalNew').add('on');
  $('cvModalCreateBtn').show();
  $('cvModalNameIn').el.focus();
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
  const name = $('cvModalNameIn').el.value.trim();
  if (!name) return;
  const cr = await fetch('/api/collections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  if (!cr.ok) { const d = await cr.json(); toast(d.error || 'Failed'); return; }
  await addToCollection(name);
}

function closeCvModal() {
  $('cvModal').remove('on');
  cvTargetId = null;
}
