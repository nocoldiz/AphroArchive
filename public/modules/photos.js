// ─── Photos ───

let photoFiles = [];
let photosSort = 'date';
let photosLightboxIdx = -1;

function showPhotos() {
  closeAllViews();
  if (location.pathname !== '/photos') history.pushState(null, '', '/photos');
  photosMode = true;
  $('browse-view').add('off');
  $('photos-sidebar').add('on');
  $('photos-view').add('on');
  document.querySelectorAll('.ph-sort-btn').forEach(b => b.classList.toggle('on', b.dataset.s === photosSort));
  loadPhotos();
}

async function loadPhotos() {
  try {
    const r = await fetch('/api/photos');
    photoFiles = await r.json();
  } catch { photoFiles = []; }
  renderPhotos();
}

function setPhotosSort(s) {
  photosSort = s;
  document.querySelectorAll('.ph-sort-btn').forEach(b => b.classList.toggle('on', b.dataset.s === s));
  renderPhotos();
}

function renderPhotos() {
  const grid  = $('photosGrid').el;
  const empty = $('photosEmpty').el;
  if (!grid) return;

  let files = [...photoFiles];
  if (photosSort === 'name') files.sort((a, b) => a.filename.localeCompare(b.filename));
  else if (photosSort === 'size') files.sort((a, b) => b.size - a.size);
  else files.sort((a, b) => b.date - a.date);

  if (!files.length) {
    grid.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  grid.innerHTML = files.map((f, i) => `
    <div class="ph-card" onclick="openPhotoLightbox(${i})">
      <img class="ph-thumb" src="/api/photos/${f.id}/img" alt="${escA(f.filename)}" loading="lazy">
      <div class="ph-overlay">
        <span class="ph-name">${esc(f.filename)}</span>
        <button class="ph-del" title="Delete" onclick="event.stopPropagation();deletePhoto('${f.id}',this)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>`).join('');
}

function openPhotoLightbox(idx) {
  let files = [...photoFiles];
  if (photosSort === 'name') files.sort((a, b) => a.filename.localeCompare(b.filename));
  else if (photosSort === 'size') files.sort((a, b) => b.size - a.size);
  else files.sort((a, b) => b.date - a.date);

  photosLightboxIdx = idx;
  const f = files[idx];
  if (!f) return;
  const lb = $('photosLightbox').el;
  const img = document.getElementById('photosLbImg');
  const cap = document.getElementById('photosLbCaption');
  img.src = '/api/photos/' + f.id + '/img';
  cap.textContent = f.filename + '  ·  ' + f.sizeF;
  lb.classList.add('on');
}

function photosLightboxPrev() {
  let files = [...photoFiles];
  if (photosSort === 'name') files.sort((a, b) => a.filename.localeCompare(b.filename));
  else if (photosSort === 'size') files.sort((a, b) => b.size - a.size);
  else files.sort((a, b) => b.date - a.date);
  photosLightboxIdx = (photosLightboxIdx - 1 + files.length) % files.length;
  const f = files[photosLightboxIdx];
  document.getElementById('photosLbImg').src = '/api/photos/' + f.id + '/img';
  document.getElementById('photosLbCaption').textContent = f.filename + '  ·  ' + f.sizeF;
}

function photosLightboxNext() {
  let files = [...photoFiles];
  if (photosSort === 'name') files.sort((a, b) => a.filename.localeCompare(b.filename));
  else if (photosSort === 'size') files.sort((a, b) => b.size - a.size);
  else files.sort((a, b) => b.date - a.date);
  photosLightboxIdx = (photosLightboxIdx + 1) % files.length;
  const f = files[photosLightboxIdx];
  document.getElementById('photosLbImg').src = '/api/photos/' + f.id + '/img';
  document.getElementById('photosLbCaption').textContent = f.filename + '  ·  ' + f.sizeF;
}

function closePhotoLightbox() {
  $('photosLightbox').remove('on');
  document.getElementById('photosLbImg').src = '';
  photosLightboxIdx = -1;
}

async function deletePhoto(id, btn) {
  if (!confirm('Delete this photo?')) return;
  const r = await fetch('/api/photos/' + id, { method: 'DELETE' });
  if (r.ok) { toast('Photo deleted'); photoFiles = photoFiles.filter(f => f.id !== id); renderPhotos(); }
  else toast('Delete failed');
}

// keyboard navigation for lightbox
document.addEventListener('keydown', e => {
  if (!$('photosLightbox').el?.classList.contains('on')) return;
  if (e.key === 'ArrowLeft')  photosLightboxPrev();
  if (e.key === 'ArrowRight') photosLightboxNext();
  if (e.key === 'Escape')     closePhotoLightbox();
});
