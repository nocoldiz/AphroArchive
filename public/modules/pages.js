// ─── Pages ───
// Local HTML files stored in pages/, viewed with the shared HTML viewer.

let _pagesList = [];

async function showPages() {
  closeAllViews();
  if (location.pathname !== '/pages') history.pushState(null, '', '/pages');
  pagesMode = true;
  $('browse-view').add('off');
  $('pages-sidebar').add('on');
  $('pages-view').add('on');
  await loadPages();
}

async function loadPages() {
  const grid  = document.getElementById('pagesGrid');
  const empty = document.getElementById('pagesEmpty');
  if (!grid) return;
  grid.innerHTML = '<div style="color:var(--tx2);font-size:0.85rem;padding:8px 0">Loading…</div>';
  try {
    _pagesList = await fetch('/api/pages').then(r => r.json());
  } catch { _pagesList = []; }
  renderPages();
}

function renderPages() {
  const grid  = document.getElementById('pagesGrid');
  const empty = document.getElementById('pagesEmpty');
  if (!grid) return;
  if (!_pagesList.length) {
    grid.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';
  grid.innerHTML = _pagesList.map(p => `
    <div class="page-card" onclick="openPageFile('${escA(p.id)}','${escA(p.name)}')">
      <div class="page-card-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="9" y1="13" x2="15" y2="13"/>
          <line x1="9" y1="17" x2="13" y2="17"/>
        </svg>
      </div>
      <div class="page-card-body">
        <div class="page-card-name">${esc(p.name)}</div>
        <div class="page-card-meta">${esc(p.sizeF)} · ${esc(new Date(p.mtime).toLocaleDateString())}</div>
      </div>
      <button class="page-card-del" onclick="event.stopPropagation();deletePageCard('${escA(p.id)}')" title="Delete">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/>
        </svg>
      </button>
    </div>
  `).join('');
}

async function openPageFile(id, name) {
  await _openHtmlViewer('/api/pages/' + id + '/stream', name, async () => {
    if (!confirm('Delete "' + name + '"?')) return;
    const r = await fetch('/api/pages/' + id, { method: 'DELETE' });
    if (!r.ok) { toast('Delete failed'); return; }
    _pagesList = _pagesList.filter(p => p.id !== id);
    closeVaultPage();
    renderPages();
    toast('Page deleted');
  });
}

async function deletePageCard(id) {
  const p = _pagesList.find(x => x.id === id);
  if (!confirm('Delete "' + (p ? p.name : 'this page') + '"?')) return;
  const r = await fetch('/api/pages/' + id, { method: 'DELETE' });
  if (!r.ok) { toast('Delete failed'); return; }
  _pagesList = _pagesList.filter(x => x.id !== id);
  renderPages();
  toast('Page deleted');
}

async function pagesUpload(input) {
  const files = [...input.files].filter(f => /\.(html?|xhtml|mhtml)$/i.test(f.name));
  if (!files.length) return;
  for (const file of files) {
    const buf = await file.arrayBuffer();
    await fetch('/api/pages/upload', {
      method: 'POST',
      headers: { 'X-Filename': file.name, 'Content-Type': 'application/octet-stream' },
      body: buf,
    });
  }
  input.value = '';
  await loadPages();
  toast(files.length === 1 ? '"' + files[0].name + '" added' : files.length + ' pages added');
}
