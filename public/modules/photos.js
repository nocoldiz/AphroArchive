// ─── Photos ───

let photoFiles = [];
let photosSort = 'date';
let photosQuery = '';
let photosLightboxIdx = -1;
let photosLightboxFile = null;

// ─── Slideshow ───
let photosSlideOn = false;
let photosSlideTimer = null;
let photosSlideSecs = 3;

function showPhotos() {
  closeAllViews();
  if (location.pathname !== '/photos') history.pushState(null, '', '/photos');
  photosMode = true;
  $('browse-view').add('off');
  $('photos-sidebar').add('on');
  $('photos-view').add('on');
  document.querySelectorAll('#photos-view .sort-btn[data-s]').forEach(b => b.classList.toggle('on', b.dataset.s === photosSort));
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
  document.querySelectorAll('#photos-view .sort-btn[data-s]').forEach(b => b.classList.toggle('on', b.dataset.s === s));
  renderPhotos();
}

function setPhotosQuery(q) {
  photosQuery = q;
  renderPhotos();
}

function _getSortedFilteredPhotos() {
  let files = [...photoFiles];
  if (photosSort === 'name') files.sort((a, b) => a.filename.localeCompare(b.filename));
  else if (photosSort === 'size') files.sort((a, b) => b.size - a.size);
  else files.sort((a, b) => b.date - a.date);
  if (photosQuery) {
    const q = photosQuery.toLowerCase();
    files = files.filter(f => f.filename.toLowerCase().includes(q));
  }
  return files;
}

function renderPhotos() {
  const grid  = $('photosGrid').el;
  const empty = $('photosEmpty').el;
  if (!grid) return;

  const files = _getSortedFilteredPhotos();

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
  const files = _getSortedFilteredPhotos();
  photosLightboxIdx  = idx;
  photosLightboxFile = files[idx];
  const f = photosLightboxFile;
  if (!f) return;
  const lb  = $('photosLightbox').el;
  const img = document.getElementById('photosLbImg');
  const cap = document.getElementById('photosLbCaption');
  const dp  = document.getElementById('photosLbDesc');
  img.src = '/api/photos/' + f.id + '/img';
  cap.textContent = f.filename + '  ·  ' + f.sizeF;
  if (dp) { dp.style.display = 'none'; dp.textContent = ''; }
  lb.classList.add('on');
  _updateSlideBtn();
}

function photosLightboxPrev() {
  const files = _getSortedFilteredPhotos();
  if (!files.length) return;
  photosLightboxIdx  = (photosLightboxIdx - 1 + files.length) % files.length;
  photosLightboxFile = files[photosLightboxIdx];
  document.getElementById('photosLbImg').src = '/api/photos/' + photosLightboxFile.id + '/img';
  document.getElementById('photosLbCaption').textContent = photosLightboxFile.filename + '  ·  ' + photosLightboxFile.sizeF;
  const dp = document.getElementById('photosLbDesc');
  if (dp) { dp.style.display = 'none'; dp.textContent = ''; }
  if (photosSlideOn) _scheduleSlide();
}

function photosLightboxNext() {
  const files = _getSortedFilteredPhotos();
  if (!files.length) return;
  photosLightboxIdx  = (photosLightboxIdx + 1) % files.length;
  photosLightboxFile = files[photosLightboxIdx];
  document.getElementById('photosLbImg').src = '/api/photos/' + photosLightboxFile.id + '/img';
  document.getElementById('photosLbCaption').textContent = photosLightboxFile.filename + '  ·  ' + photosLightboxFile.sizeF;
  const dp = document.getElementById('photosLbDesc');
  if (dp) { dp.style.display = 'none'; dp.textContent = ''; }
  if (photosSlideOn) _scheduleSlide();
}

function closePhotoLightbox() {
  $('photosLightbox').remove('on');
  document.getElementById('photosLbImg').src = '';
  photosLightboxIdx  = -1;
  photosLightboxFile = null;
  photosSlideOn = false;
  clearTimeout(photosSlideTimer);
  _updateSlideBtn();
}

// ─── Slideshow ───

function togglePhotoSlideshow() {
  photosSlideOn = !photosSlideOn;
  _updateSlideBtn();
  if (photosSlideOn) _scheduleSlide();
  else clearTimeout(photosSlideTimer);
}

function _scheduleSlide() {
  clearTimeout(photosSlideTimer);
  photosSlideTimer = setTimeout(() => {
    if (!photosSlideOn) return;
    photosLightboxNext();
  }, photosSlideSecs * 1000);
}

function setPhotoSlideSecs(s) {
  photosSlideSecs = parseInt(s) || 3;
  if (photosSlideOn) _scheduleSlide();
}

function _updateSlideBtn() {
  const btn = document.getElementById('photosLbSlideBtn');
  if (!btn) return;
  btn.innerHTML = photosSlideOn
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  btn.title = photosSlideOn ? 'Pause slideshow' : 'Start slideshow';
}

// ─── Photo Mosaic ───

function startPhotoMosaic() {
  if (!photoFiles.length) { toast('No photos to show'); return; }
  startMosaicWithPhotos([...photoFiles]);
}

// ─── Other ───

function downloadPhotoLightbox() {
  if (!photosLightboxFile) return;
  const a = document.createElement('a');
  a.href = '/api/photos/' + photosLightboxFile.id + '/download';
  a.download = '';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function describePhotoLightbox() {
  if (!photosLightboxFile) return;
  const dp = document.getElementById('photosLbDesc');
  if (dp) { dp.style.display = ''; dp.textContent = 'Analyzing…'; }
  const r = await fetch('/api/vision/describe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'photo', id: photosLightboxFile.id })
  }).then(r => r.json()).catch(() => null);
  const text = r ? (r.description || r.error || 'No description returned') : 'Request failed';
  if (dp) dp.textContent = text;
}

async function deletePhoto(id, btn) {
  if (!confirm('Delete this photo?')) return;
  const r = await fetch('/api/photos/' + id, { method: 'DELETE' });
  if (r.ok) { toast('Photo deleted'); photoFiles = photoFiles.filter(f => f.id !== id); renderPhotos(); }
  else toast('Delete failed');
}

document.addEventListener('keydown', e => {
  if (!$('photosLightbox').el?.classList.contains('on')) return;
  if (e.key === 'ArrowLeft')  photosLightboxPrev();
  if (e.key === 'ArrowRight') photosLightboxNext();
  if (e.key === 'Escape')     closePhotoLightbox();
  if (e.key === ' ')          { e.preventDefault(); togglePhotoSlideshow(); }
});
