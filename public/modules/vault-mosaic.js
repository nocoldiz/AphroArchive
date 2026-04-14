// ─── Vault Photo Mosaic ───────────────────────────────────────────────
// Infinite 2D canvas where vault photos are scattered and can be freely
// panned / zoomed. Click a photo to open the full lightbox.

const VM_TILE    = 200;   // base tile size px
const VM_GAP     = 28;    // gap between tiles
const VM_MAX_ROT = 5;     // max rotation degrees (±)
const VM_ZOOM_MIN = 0.05;
const VM_ZOOM_MAX = 4;

let _vmZ = 1, _vmX = 0, _vmY = 0;
let _vmDrag = false, _vmDragSX = 0, _vmDragSY = 0;
let _vmDragMoved = false, _vmClickSuppressed = false;
let _vmPinchDist = 0, _vmPinchMidX = 0, _vmPinchMidY = 0;
let _vmPhotos = [];
let _vmRafPending = false;

// ── Hash helper (deterministic per id) ───────────────────────────────

function _vmHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

// ── Open / close ─────────────────────────────────────────────────────

function openVaultMosaic() {
  _vmPhotos = vaultFiles.filter(f => VAULT_IMG_EXTS.has((f.ext || '').toLowerCase()));
  if (!_vmPhotos.length) { toast('No photos in vault to display'); return; }
  const view = document.getElementById('vaultMosaicView');
  view.style.display = 'block';
  requestAnimationFrame(() => {
    _vmBuildWorld();
    _vmFitAll();
    _vmAttach();
  });
  document.addEventListener('keydown', _vmKey);
}

function closeVaultMosaic() {
  document.getElementById('vaultMosaicView').style.display = 'none';
  document.removeEventListener('keydown', _vmKey);
  _vmDetach();
  _vmPhotos = [];
}

// ── Build world ───────────────────────────────────────────────────────

function _vmBuildWorld() {
  const world = document.getElementById('vmWorld');
  world.innerHTML = '';

  const n    = _vmPhotos.length;
  const cols = Math.max(3, Math.ceil(Math.sqrt(n * 1.5)));

  _vmPhotos.forEach((f, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const h   = _vmHash(f.id);
    const rot = (((h         % (VM_MAX_ROT * 200 + 1)) / 100) - VM_MAX_ROT);
    const ox  = (((h >>> 6)  % 41) - 20);
    const oy  = (((h >>> 12) % 41) - 20);
    const x   = col * (VM_TILE + VM_GAP) + ox;
    const y   = row * (VM_TILE + VM_GAP) + oy;

    // Vary tile size slightly (±15%) for organic feel
    const sizeVariance = 0.85 + ((h >>> 18) % 31) / 100;
    const tileSize = Math.round(VM_TILE * sizeVariance);

    const outer = document.createElement('div');
    outer.className = 'vm-tile';
    outer.style.cssText = `left:${x}px;top:${y}px;width:${tileSize}px;height:${tileSize}px;--rot:${rot.toFixed(2)}deg`;

    const img = document.createElement('img');
    img.src = '/api/vault/stream/' + f.id;
    img.loading = 'lazy';
    img.draggable = false;
    img.alt = '';

    const label = document.createElement('div');
    label.className = 'vm-tile-label';
    label.textContent = f.name || f.originalName;

    outer.appendChild(img);
    outer.appendChild(label);

    outer.addEventListener('click', () => {
      if (_vmClickSuppressed) return;
      openVaultPhoto(f.id, f.name || f.originalName);
    });

    world.appendChild(outer);
  });

  // Set explicit world bounds so the world div has a measured size
  const rows = Math.ceil(n / cols);
  world.style.width  = (cols * (VM_TILE + VM_GAP) + VM_GAP + 80) + 'px';
  world.style.height = (rows * (VM_TILE + VM_GAP) + VM_GAP + 80) + 'px';

  _vmUpdateCounter();
}

// ── Transform ────────────────────────────────────────────────────────

function _vmApply() {
  const world = document.getElementById('vmWorld');
  if (world) world.style.transform = `translate(${_vmX}px,${_vmY}px) scale(${_vmZ})`;
  const badge = document.getElementById('vmZoomBadge');
  if (badge) badge.textContent = Math.round(_vmZ * 100) + '%';
  _vmRafPending = false;
}

function _vmApplyRAF() {
  if (_vmRafPending) return;
  _vmRafPending = true;
  requestAnimationFrame(_vmApply);
}

function _vmFitAll() {
  const view  = document.getElementById('vaultMosaicView');
  const world = document.getElementById('vmWorld');
  const vw = view.clientWidth, vh = view.clientHeight;
  const ww = parseFloat(world.style.width)  || 800;
  const wh = parseFloat(world.style.height) || 600;
  const pad = 80;
  _vmZ = Math.min(1, (vw - pad) / ww, (vh - pad) / wh);
  _vmX = (vw - ww * _vmZ) / 2;
  _vmY = (vh - wh * _vmZ) / 2;
  _vmApply();
}

function _vmZoomTo(newZ, cx, cy) {
  newZ = Math.max(VM_ZOOM_MIN, Math.min(VM_ZOOM_MAX, newZ));
  const wx = (cx - _vmX) / _vmZ;
  const wy = (cy - _vmY) / _vmZ;
  _vmZ = newZ;
  _vmX = cx - wx * _vmZ;
  _vmY = cy - wy * _vmZ;
  _vmApplyRAF();
}

function vmZoomIn()  {
  const v = document.getElementById('vaultMosaicView');
  _vmZoomTo(_vmZ * 1.25, v.clientWidth / 2, v.clientHeight / 2);
}
function vmZoomOut() {
  const v = document.getElementById('vaultMosaicView');
  _vmZoomTo(_vmZ / 1.25, v.clientWidth / 2, v.clientHeight / 2);
}

// ── Events ───────────────────────────────────────────────────────────

function _vmWheel(e) {
  e.preventDefault();
  const r = e.currentTarget.getBoundingClientRect();
  const cx = e.clientX - r.left;
  const cy = e.clientY - r.top;
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  _vmZoomTo(_vmZ * factor, cx, cy);
}

function _vmMousedown(e) {
  if (e.button !== 0) return;
  _vmDrag = true; _vmDragMoved = false;
  _vmDragSX = e.clientX - _vmX;
  _vmDragSY = e.clientY - _vmY;
  document.getElementById('vmCanvas').classList.add('dragging');
}

function _vmMousemove(e) {
  if (!_vmDrag) return;
  const dx = Math.abs(e.clientX - (_vmDragSX + _vmX));
  const dy = Math.abs(e.clientY - (_vmDragSY + _vmY));
  if (dx > 3 || dy > 3) _vmDragMoved = true;
  _vmX = e.clientX - _vmDragSX;
  _vmY = e.clientY - _vmDragSY;
  _vmApplyRAF();
}

function _vmMouseup() {
  if (!_vmDrag) return;
  _vmDrag = false;
  document.getElementById('vmCanvas').classList.remove('dragging');
  if (_vmDragMoved) {
    _vmClickSuppressed = true;
    setTimeout(() => { _vmClickSuppressed = false; _vmDragMoved = false; }, 50);
  }
}

function _vmTouchstart(e) {
  if (e.touches.length === 2) {
    const t0 = e.touches[0], t1 = e.touches[1];
    _vmPinchDist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
    _vmPinchMidX = (t0.clientX + t1.clientX) / 2;
    _vmPinchMidY = (t0.clientY + t1.clientY) / 2;
    _vmDrag = false;
  } else if (e.touches.length === 1) {
    _vmDrag = true; _vmDragMoved = false;
    _vmDragSX = e.touches[0].clientX - _vmX;
    _vmDragSY = e.touches[0].clientY - _vmY;
  }
}

function _vmTouchmove(e) {
  if (e.touches.length === 2) {
    e.preventDefault();
    const t0 = e.touches[0], t1 = e.touches[1];
    const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
    const midX = (t0.clientX + t1.clientX) / 2;
    const midY = (t0.clientY + t1.clientY) / 2;
    const r = document.getElementById('vmCanvas').getBoundingClientRect();
    const cx = midX - r.left, cy = midY - r.top;
    _vmZoomTo(_vmZ * (dist / _vmPinchDist), cx, cy);
    // also pan with pinch midpoint movement
    _vmX += midX - _vmPinchMidX;
    _vmY += midY - _vmPinchMidY;
    _vmPinchDist = dist;
    _vmPinchMidX = midX;
    _vmPinchMidY = midY;
  } else if (e.touches.length === 1 && _vmDrag) {
    _vmDragMoved = true;
    _vmX = e.touches[0].clientX - _vmDragSX;
    _vmY = e.touches[0].clientY - _vmDragSY;
    _vmApplyRAF();
  }
}

function _vmTouchend(e) {
  if (e.touches.length < 2) _vmPinchDist = 0;
  if (e.touches.length === 0) _vmDrag = false;
}

function _vmKey(e) {
  if (e.key === 'Escape') closeVaultMosaic();
  else if (e.key === '+' || e.key === '=') vmZoomIn();
  else if (e.key === '-') vmZoomOut();
  else if (e.key === '0') _vmFitAll();
}

function _vmAttach() {
  const canvas = document.getElementById('vmCanvas');
  canvas.addEventListener('wheel',      _vmWheel,      { passive: false });
  canvas.addEventListener('mousedown',  _vmMousedown);
  window.addEventListener('mousemove',  _vmMousemove);
  window.addEventListener('mouseup',    _vmMouseup);
  canvas.addEventListener('touchstart', _vmTouchstart, { passive: true });
  canvas.addEventListener('touchmove',  _vmTouchmove,  { passive: false });
  canvas.addEventListener('touchend',   _vmTouchend,   { passive: true });
}

function _vmDetach() {
  const canvas = document.getElementById('vmCanvas');
  canvas.removeEventListener('wheel',      _vmWheel);
  canvas.removeEventListener('mousedown',  _vmMousedown);
  window.removeEventListener('mousemove',  _vmMousemove);
  window.removeEventListener('mouseup',    _vmMouseup);
  canvas.removeEventListener('touchstart', _vmTouchstart);
  canvas.removeEventListener('touchmove',  _vmTouchmove);
  canvas.removeEventListener('touchend',   _vmTouchend);
}

// ── Misc ─────────────────────────────────────────────────────────────

function _vmUpdateCounter() {
  const el = document.getElementById('vmCounter');
  if (el) el.textContent = _vmPhotos.length + ' photo' + (_vmPhotos.length !== 1 ? 's' : '');
}
