import { signal } from '@preact/signals';
import { allVideos, categories, currentCategory, bookmarkVidIds } from './store';

// ─── Mosaic State ───
export const mosaicOn = signal(false);
export const mosTileCount = signal(6);
export const mosaicIv = signal(5); // seconds

let _mosaicPhotos: any[] = [];
let _mosPool: any[] = [];
let _mosLayoutIdx = 0;
const _mosLayouts = ['mos-layout-a', 'mos-layout-b', 'mos-layout-c', 'mos-layout-d', 'mos-layout-e'];
let _mosCycleCounter = 0;
let mosaicTimer: any = null;
let mosTilesState: any[] = [];
let mosHoveredIdx = -1;
let _mosaicPhotoMode = false;

// Helper to get global state or elements
const $ = (id: string) => {
  const el = document.getElementById(id);
  return {
    el,
    add: (cls: string) => el?.classList.add(cls),
    remove: (cls: string) => el?.classList.remove(cls),
    text: (txt: string) => { if (el) el.textContent = txt; },
    html: (html: string) => { if (el) el.innerHTML = html; },
    val: (v: any) => { if (el) (el as HTMLInputElement).value = v; }
  };
};

const toast = (msg: string) => {
  const w = window as any;
  if (w.toast) w.toast(msg);
};

export function toggleMosaic() {
  if (mosaicOn.value) stopMosaic(); else startMosaic();
}

export function startMosaic() {
  const V = allVideos.value;
  if (!V.length) { toast('No videos to show'); return; }
  _mosaicPhotoMode = false;
  mosaicOn.value = true;
  $('browse-view').add('off');
  
  const curV = (window as any).curV;
  if (curV) {
    const vp = document.getElementById('video-player') as HTMLVideoElement;
    if (vp) { vp.pause(); vp.src = ''; }
    (window as any).curV = null;
  }
  
  const cat = currentCategory.value;
  const catObj = categories.value.find(x => x.path === cat);
  $('mosaic-category-label').text(cat ? (catObj?.name || cat) + ' — Mosaic' : 'All Videos — Mosaic');
  
  const cntLbl = document.getElementById('mosaic-count-label');
  if (cntLbl) cntLbl.textContent = 'Players';
  
  $('mosaic-interval').text(mosaicIv.value + 's');
  $('mosaic-view').add('on');
  $('mosBtn').add('on');

  // Cache eligible videos for performance
  const bms = bookmarkVidIds.value;
  _mosPool = V.filter(v => !bms.has(v.id));
  if (!_mosPool.length) _mosPool = V;

  buildMosaicTiles();
  scheduleMosaic();
}

export function startMosaicWithPhotos(photos: any[]) {
  _mosaicPhotoMode = true;
  _mosaicPhotos = photos;
  mosaicOn.value = true;
  
  const curV = (window as any).curV;
  if (curV) {
    const vp = document.getElementById('video-player') as HTMLVideoElement;
    if (vp) { vp.pause(); vp.src = ''; }
    (window as any).curV = null;
  }
  
  $('mosaic-category-label').text('Photos — Mosaic');
  const cntLbl = document.getElementById('mosaic-count-label');
  if (cntLbl) cntLbl.textContent = 'Tiles';
  
  $('mosaic-interval').text(mosaicIv.value + 's');
  $('mosaic-view').add('on');
  $('mosBtn').add('on');
  
  buildMosaicTiles();
  scheduleMosaic();
}

export function stopMosaic() {
  const wasPhotoMode = _mosaicPhotoMode;
  mosaicOn.value = false;
  _mosaicPhotoMode = false;
  _mosaicPhotos = [];
  clearTimeout(mosaicTimer);
  
  mosTilesState.forEach(t => {
    if (!t.isPhoto) { t.a.pause(); t.a.src = ''; t.b.pause(); t.b.src = ''; }
  });
  mosTilesState = [];
  mosHoveredIdx = -1;
  
  $('mosaic-view').remove('on');
  $('mosBtn').remove('on');
  
  const cntLbl = document.getElementById('mosaic-count-label');
  if (cntLbl) cntLbl.textContent = 'Players';
  
  if (!wasPhotoMode) $('browse-view').remove('off');
}

function mosPick(n: number) {
  const src = _mosPool.length ? _mosPool : allVideos.value;
  if (!src.length) return [];
  const a = [...src].sort(() => Math.random() - 0.5);
  const result = [];
  while (result.length < n) result.push(...a);
  return result.slice(0, n);
}

function mosPickExcluding(excludeId: string) {
  const src = _mosPool.length ? _mosPool : allVideos.value;
  if (!src.length) return null;
  const shuffled = [...src].sort(() => Math.random() - 0.5);
  return shuffled.find(v => v.id !== excludeId) || shuffled[0];
}

function _mosPickPhotos(n: number) {
  if (!_mosaicPhotos.length) return [];
  const a = [..._mosaicPhotos].sort(() => Math.random() - 0.5);
  const result = [];
  while (result.length < n) result.push(...a);
  return result.slice(0, n);
}

function _mosPickPhotoExcluding(excludeId: string) {
  const others = _mosaicPhotos.filter(p => p.id !== excludeId);
  const pool = others.length ? others : _mosaicPhotos;
  return pool[Math.floor(Math.random() * pool.length)];
}

function mosSeekRandom(el: HTMLVideoElement) {
  const dur = parseFloat(el.dataset.dur || '0') || el.duration || 0;
  if (dur > 5) el.currentTime = Math.random() * (dur * 0.85);
}

function preloadMosTile(tile: any, v: any) {
  const pre = tile.active === 'a' ? tile.b : tile.a;
  pre.pause();
  pre.dataset.vid = v.id;
  pre.dataset.dur = v.duration || 0;
  pre.dataset.ready = '0';
  
  pre.poster = '/api/thumbs/' + v.id + '/0';
  pre.src = '/api/stream/' + v.id;
  
  pre.addEventListener('loadedmetadata', () => {
    mosSeekRandom(pre);
    pre.play().catch(() => {});
  }, { once: true });
  
  pre.addEventListener('seeked', () => { pre.dataset.ready = '1'; }, { once: true });
}

export function buildMosaicTiles() {
  const grid = document.getElementById('mosaic-grid');
  if (!grid) return;
  
  mosTilesState.forEach(t => {
    if (!t.isPhoto) { t.a.pause(); t.a.src = ''; t.b.pause(); t.b.src = ''; }
  });
  mosTilesState = [];
  mosHoveredIdx = -1;
  grid.innerHTML = '';

  const n = mosTileCount.value;
  if (n === 6) {
    grid.classList.add(_mosLayouts[_mosLayoutIdx]);
    grid.style.gridTemplateColumns = '';
    grid.style.gridTemplateRows = '';
  } else {
    _mosLayouts.forEach(l => grid.classList.remove(l));
    const cols = n <= 2 ? n : n <= 4 ? 2 : n <= 9 ? 3 : 4;
    grid.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
    grid.style.gridTemplateRows = '';
  }

  if (_mosaicPhotoMode) {
    const picks = _mosPickPhotos(n);
    picks.forEach((f, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'mos-tile';
      const img = document.createElement('img');
      img.className = 'mos-v mos-v-active';
      img.src = '/api/photos/' + f.id + '/img';
      wrap.appendChild(img);
      grid.appendChild(wrap);
      const tile = { wrap, img, photoId: f.id, isPhoto: true };
      mosTilesState.push(tile);
      wrap.addEventListener('mouseenter', () => { mosHoveredIdx = i; wrap.classList.add('mos-hovered'); });
      wrap.addEventListener('mouseleave', () => { if (mosHoveredIdx === i) mosHoveredIdx = -1; wrap.classList.remove('mos-hovered'); });
    });
    return;
  }

  const picks = mosPick(n);
  picks.forEach((v, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'mos-tile';

    const a = document.createElement('video');
    a.muted = true; a.playsInline = true; a.loop = true;
    a.className = 'mos-v mos-v-active';
    a.dataset.vid = v.id; a.dataset.dur = v.duration || 0;

    const b = document.createElement('video');
    b.muted = true; b.playsInline = true; b.loop = true;
    b.className = 'mos-v';
    b.dataset.ready = '0';

    wrap.appendChild(a); wrap.appendChild(b);
    grid.appendChild(wrap);

    const tile = { wrap, a, b, active: 'a', vidId: v.id, isPhoto: false };
    mosTilesState.push(tile);

    a.poster = '/api/thumbs/' + v.id + '/0';
    a.src = '/api/stream/' + v.id;
    a.addEventListener('loadedmetadata', () => { mosSeekRandom(a); a.play().catch(() => {}); }, { once: true });
    a.play().catch(() => {});

    const nextV = mosPickExcluding(v.id);
    if (nextV) preloadMosTile(tile, nextV);

    wrap.addEventListener('mouseenter', () => {
      mosHoveredIdx = i;
      wrap.classList.add('mos-hovered');
      mosTilesState.forEach((t, j) => {
        const activeEl = t.active === 'a' ? t.a : t.b;
        activeEl.muted = (j !== i);
      });
    });
    wrap.addEventListener('mouseleave', () => {
      if (mosHoveredIdx === i) mosHoveredIdx = -1;
      wrap.classList.remove('mos-hovered');
      mosTilesState.forEach(t => { if (!t.isPhoto) { t.a.muted = true; t.b.muted = true; } });
    });
  });
}

export function scheduleMosaic() {
  clearTimeout(mosaicTimer);
  if (!mosaicOn.value) return;
  mosaicTimer = setTimeout(() => {
    refreshMosaicTiles();
    _mosCycleCounter++;
    if (_mosCycleCounter >= 2) {
      _mosCycleCounter = 0;
      cycleMosaicLayout();
    }
    scheduleMosaic();
  }, mosaicIv.value * 1000);
}

function cycleMosaicLayout() {
  if (mosTileCount.value !== 6) return;
  const grid = document.getElementById('mosaic-grid');
  if (!grid) return;
  
  grid.classList.remove(_mosLayouts[_mosLayoutIdx]);
  
  let nextIdx = _mosLayoutIdx;
  while (nextIdx === _mosLayoutIdx) {
    nextIdx = Math.floor(Math.random() * _mosLayouts.length);
  }
  _mosLayoutIdx = nextIdx;
  
  grid.classList.add(_mosLayouts[_mosLayoutIdx]);
}

export function refreshMosaicTiles() {
  if (_mosaicPhotoMode) {
    mosTilesState.forEach((tile, i) => {
      if (i === mosHoveredIdx) return;
      const next = _mosPickPhotoExcluding(tile.photoId);
      if (!next) return;
      tile.img.classList.remove('mos-v-active');
      setTimeout(() => {
        tile.img.src = '/api/photos/' + next.id + '/img';
        tile.img.classList.add('mos-v-active');
        tile.photoId = next.id;
      }, 450);
    });
    return;
  }

  mosTilesState.forEach((tile, i) => {
    if (i === mosHoveredIdx) return;

    setTimeout(() => {
      const nextEl = tile.active === 'a' ? tile.b : tile.a;
      const curEl  = tile.active === 'a' ? tile.a : tile.b;

      if (nextEl.dataset.ready === '1') {
        nextEl.muted = true;
        nextEl.play().catch(() => {});
        nextEl.classList.add('mos-v-active');
        curEl.classList.remove('mos-v-active');
        tile.active = tile.active === 'a' ? 'b' : 'a';
        tile.vidId = nextEl.dataset.vid;
        
        setTimeout(() => {
          curEl.pause();
          const nextV = mosPickExcluding(tile.vidId);
          if (nextV) preloadMosTile(tile, nextV);
        }, 800);
      } else {
        mosSeekRandom(curEl);
      }
    }, i * 150);
  });
}

export function setMosaicIv(delta: number) {
  mosaicIv.value = Math.max(2, Math.min(60, mosaicIv.value + delta));
  $('mosaic-interval').text(mosaicIv.value + 's');
  scheduleMosaic();
}

export function setMosaicCount(val: any) {
  mosTileCount.value = Math.max(1, Math.min(16, parseInt(val) || 6));
  $('mosaic-count').val(mosTileCount.value);
  if (mosaicOn.value) { buildMosaicTiles(); scheduleMosaic(); }
}

// Bridge to window
if (typeof window !== 'undefined') {
  (window as any).toggleMosaic = toggleMosaic;
  (window as any).startMosaic = startMosaic;
  (window as any).startMosaicWithPhotos = startMosaicWithPhotos;
  (window as any).stopMosaic = stopMosaic;
  (window as any).setMosaicIv = setMosaicIv;
  (window as any).setMosaicCount = setMosaicCount;
}
