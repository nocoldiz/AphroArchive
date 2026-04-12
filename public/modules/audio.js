// ─── Audio ───

let audioSort = 'date';
let audioView = localStorage.getItem('audioView') || 'card';
let audioFiles = [];
let curAudio = null;

function showAudio() {
  closeAllViews();
  if (location.pathname !== '/audio') history.pushState(null, '', '/audio');
  audioMode = true;
  $('browse-view').add('off');
  $('audio-sidebar').add('on');
  $('audio-view').add('on');
  document.querySelectorAll('.au-sort-btn').forEach(b => b.classList.toggle('on', b.dataset.s === audioSort));
  document.querySelectorAll('.au-view-btn').forEach(b => b.classList.toggle('on', b.dataset.v === audioView));
  loadAudio();
}

async function loadAudio() {
  try {
    const r = await fetch('/api/audio');
    audioFiles = await r.json();
  } catch { audioFiles = []; }
  renderAudio();
}

function setAudioSort(s) {
  audioSort = s;
  document.querySelectorAll('.au-sort-btn').forEach(b => b.classList.toggle('on', b.dataset.s === s));
  renderAudio();
}

function setAudioView(v) {
  audioView = v;
  localStorage.setItem('audioView', v);
  document.querySelectorAll('.au-view-btn').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  renderAudio();
}

function renderAudio() {
  const grid = $('audioGrid').el;
  const empty = $('audioEmpty').el;
  if (!grid) return;

  let files = [...audioFiles];
  if (audioSort === 'name') files.sort((a, b) => a.title.localeCompare(b.title));
  else if (audioSort === 'size') files.sort((a, b) => b.size - a.size);
  else files.sort((a, b) => b.date - a.date);

  if (!files.length) {
    grid.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  if (audioView === 'list') {
    grid.className = 'au-list';
    grid.innerHTML = files.map(f => `
      <div class="au-row${curAudio === f.id ? ' playing' : ''}" onclick="playAudio('${f.id}')">
        <div class="au-row-icon">${_auIcon()}</div>
        <div class="au-row-info">
          <span class="au-row-title">${esc(f.title)}</span>
          <span class="au-row-meta"><span class="au-badge">${f.ext.replace('.','').toUpperCase()}</span>${f.sizeF}</span>
        </div>
        <button class="au-del" title="Delete" onclick="event.stopPropagation();deleteAudio('${f.id}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`).join('');
  } else {
    grid.className = 'au-grid';
    grid.innerHTML = files.map(f => `
      <div class="au-card${curAudio === f.id ? ' playing' : ''}" onclick="playAudio('${f.id}')">
        <div class="au-card-icon">${_auIcon()}</div>
        <div class="au-card-info">
          <div class="au-card-title" title="${escA(f.title)}">${esc(f.title)}</div>
          <div class="au-card-meta"><span class="au-badge">${f.ext.replace('.','').toUpperCase()}</span><span>${f.sizeF}</span></div>
        </div>
        <button class="au-del" title="Delete" onclick="event.stopPropagation();deleteAudio('${f.id}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`).join('');
  }
}

function _auIcon() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
}

function playAudio(id) {
  curAudio = id;
  const f = audioFiles.find(x => x.id === id);
  const audioEl = $('audioEl').el;
  $('audioPlayerTitle').text(f ? f.title : '');
  audioEl.src = '/api/audio/' + id + '/stream';
  $('audioPlayer').show(true);
  audioEl.play().catch(() => {});
  renderAudio();
}

function closeAudioPlayer() {
  const audioEl = $('audioEl').el;
  audioEl.pause();
  audioEl.src = '';
  curAudio = null;
  $('audioPlayer').show(false);
  renderAudio();
}

async function uploadAudioFiles() {
  const fileInput = $('audioFileIn').el;
  const files = fileInput.files;
  if (!files.length) return;
  let done = 0;
  for (const file of files) {
    try {
      const r = await fetch('/api/audio/upload', {
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
  if (done) { toast(done + ' file' + (done !== 1 ? 's' : '') + ' added'); loadAudio(); }
}

async function deleteAudio(id) {
  if (!confirm('Delete this audio file?')) return;
  const r = await fetch('/api/audio/' + id, { method: 'DELETE' });
  if (r.ok) {
    if (curAudio === id) closeAudioPlayer();
    toast('Deleted');
    loadAudio();
  } else {
    toast('Delete failed');
  }
}
