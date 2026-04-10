// ─── Books ───

function showBooks() {
  if (mosaicOn) stopMosaic();
  if (location.pathname !== '/books') history.pushState(null, '', '/books');
  booksMode = true;
  document.getElementById('bv').classList.add('off');
  ['pv','dv','av','adv','sv','sdv','tagDV','vaultV','scraperV','collectionsV','settingsV','importFavsV'].forEach(id => {
    const el = document.getElementById(id); if (el) el.classList.remove('on');
  });
  if (document.getElementById('dbV')) document.getElementById('dbV').classList.remove('on');
  document.querySelectorAll('.ci.on').forEach(el => el.classList.remove('on'));
  document.getElementById('booksSB').classList.add('on');
  dupMode = false; vaultMode = false; scraperMode = false; collectionsMode = false;
  settingsMode = false; importFavsMode = false; dbMode = false;
  studioMode = false; actorMode = false;
  curActor = null; curStudio = null; curTag = null; curV = null; curCollection = null;
  document.getElementById('booksV').classList.add('on');
  loadBooks();
}

async function loadBooks() {
  const res = await fetch('/api/books');
  const books = await res.json();
  renderBooks(books);
}

function renderBooks(books) {
  const grid = document.getElementById('booksGrid');
  const empty = document.getElementById('booksEmpty');
  if (!books.length) {
    grid.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  grid.innerHTML = books.map(b => {
    const icon = bookTypeIcon(b.ext);
    const badge = bookTypeBadge(b.type, b.ext);
    const chapInfo = b.chapters ? `<span class="bk-chapters">${b.chapters} ch.</span>` : '';
    return `<div class="bk-card" onclick="openBook('${b.id}')">
      <div class="bk-icon">${icon}</div>
      <div class="bk-info">
        <div class="bk-title">${esc(b.title || b.filename)}</div>
        <div class="bk-meta">${badge}${chapInfo}<span>${b.sizeF || ''}</span></div>
      </div>
      <button class="bk-del" title="Delete" onclick="event.stopPropagation();deleteBook('${b.id}',this)">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
  }).join('');
}

function bookTypeIcon(ext) {
  if (ext === '.pdf') return '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="11" y2="17"/></svg>';
  if (ext === '.epub') return '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';
  return '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';
}

function bookTypeBadge(type, ext) {
  if (type === 'fanfiction') return '<span class="bk-badge bk-badge--ff">FF.net</span>';
  if (type === 'url') return '<span class="bk-badge bk-badge--url">Web</span>';
  if (ext) return `<span class="bk-badge">${ext.replace('.','').toUpperCase()}</span>`;
  return '';
}

async function openBook(id) {
  const reader = document.getElementById('booksReader');
  const readerTitle = document.getElementById('booksReaderTitle');
  const readerBody = document.getElementById('booksReaderBody');
  readerTitle.textContent = 'Loading…';
  readerBody.innerHTML = '<div class="bk-loading">Loading…</div>';
  reader.classList.add('on');

  const r = await fetch(`/api/books/read/${id}`);
  if (r.headers.get('content-type')?.includes('application/pdf') ||
      r.headers.get('content-type')?.includes('epub')) {
    // PDF/EPUB: open in new tab
    reader.classList.remove('on');
    window.open(`/api/books/read/${id}`, '_blank');
    return;
  }

  const data = await r.json();
  readerTitle.textContent = data.title || '';
  readerBody.innerHTML = renderMarkdown(data.content || '');
}

function closeBookReader() {
  document.getElementById('booksReader').classList.remove('on');
}

function renderMarkdown(md) {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Headings
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold / italic
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // HR
    .replace(/^---$/gm, '<hr>')
    // Paragraphs (double newline)
    .split(/\n{2,}/).map(p => {
      p = p.trim();
      if (!p || p.startsWith('<h') || p.startsWith('<hr')) return p;
      return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
    }).join('\n');
}

async function importBookUrl() {
  const input = document.getElementById('booksUrlInput');
  const err = document.getElementById('booksUrlErr');
  const btn = document.getElementById('booksUrlBtn');
  const rawUrl = input.value.trim();
  err.style.display = 'none';
  if (!rawUrl) return;
  btn.disabled = true;
  btn.textContent = 'Importing…';
  try {
    const r = await fetch('/api/books/import-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: rawUrl })
    });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.error || 'Import failed'; err.style.display = 'block'; return; }
    input.value = '';
    toast('Imported: ' + d.title);
    loadBooks();
  } catch (e) {
    err.textContent = e.message;
    err.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import';
  }
}

async function uploadBookFiles() {
  const fileInput = document.getElementById('booksFileIn');
  const files = fileInput.files;
  if (!files.length) return;
  let done = 0;
  for (const file of files) {
    try {
      const r = await fetch('/api/books/upload', {
        method: 'POST',
        headers: { 'x-filename': encodeURIComponent(file.name) },
        body: file
      });
      const d = await r.json();
      if (r.ok) done++;
      else toast('Failed: ' + (d.error || file.name));
    } catch { toast('Upload error: ' + file.name); }
  }
  fileInput.value = '';
  if (done) { toast(done + ' book' + (done !== 1 ? 's' : '') + ' added'); loadBooks(); }
}

async function deleteBook(id, btn) {
  if (!confirm('Delete this book?')) return;
  const r = await fetch('/api/books/' + id, { method: 'DELETE' });
  if (r.ok) { toast('Book deleted'); loadBooks(); }
  else toast('Delete failed');
}
