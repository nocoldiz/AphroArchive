// ─── Mosaic Mode ───
let _mosaicPhotoMode = false;
let _mosaicPhotos = [];

function toggleMosaic() {
  if (mosaicOn) stopMosaic(); else startMosaic();
}

function startMosaic() {
  if (!V.length) { toast('No videos to show'); return; }
  _mosaicPhotoMode = false;
  mosaicOn = true;
  $('browse-view').add('off');
  $('player-view').remove('on');
  if (curV) { const vp = $('video-player').el; vp.pause(); vp.src = ''; curV = null; }
  $('mosaic-category-label').el.textContent = cat
    ? (cats.find(x => x.path === cat)?.name || cat) + ' — Mosaic'
    : 'All Videos — Mosaic';
  const cntLbl = document.getElementById('mosaic-count-label');
  if (cntLbl) cntLbl.textContent = 'Players';
  $('mosaic-interval').text(mosaicIv + 's');
  $('mosaic-view').add('on');
  $('mosBtn').add('on');
  buildMosaicTiles();
  scheduleMosaic();
}

function startMosaicWithPhotos(photos) {
  _mosaicPhotoMode = true;
  _mosaicPhotos = photos;
  mosaicOn = true;
  $('player-view').remove('on');
  if (curV) { const vp = $('video-player').el; vp.pause(); vp.src = ''; curV = null; }
  $('mosaic-category-label').el.textContent = 'Photos — Mosaic';
  const cntLbl = document.getElementById('mosaic-count-label');
  if (cntLbl) cntLbl.textContent = 'Tiles';
  $('mosaic-interval').text(mosaicIv + 's');
  $('mosaic-view').add('on');
  $('mosBtn').add('on');
  buildMosaicTiles();
  scheduleMosaic();
}

function stopMosaic() {
  const wasPhotoMode = _mosaicPhotoMode;
  mosaicOn = false;
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

function mosPick(n) {
  const pool = V.filter(v => !bookmarkVidIds.has(v.id));
  const src = pool.length ? pool : V;
  if (!src.length) return [];
  const a = [...src].sort(() => Math.random() - 0.5);
  const result = [];
  while (result.length < n) result.push(...a);
  return result.slice(0, n);
}

function mosPickExcluding(excludeId) {
  const pool = V.filter(v => !bookmarkVidIds.has(v.id));
  const src = pool.length ? pool : V;
  const shuffled = [...src].sort(() => Math.random() - 0.5);
  return shuffled.find(v => v.id !== excludeId) || shuffled[0];
}

function _mosPickPhotos(n) {
  if (!_mosaicPhotos.length) return [];
  const a = [..._mosaicPhotos].sort(() => Math.random() - 0.5);
  const result = [];
  while (result.length < n) result.push(...a);
  return result.slice(0, n);
}

function _mosPickPhotoExcluding(excludeId) {
  const others = _mosaicPhotos.filter(p => p.id !== excludeId);
  const pool = others.length ? others : _mosaicPhotos;
  return pool[Math.floor(Math.random() * pool.length)];
}

function mosSeekRandom(el) {
  const dur = parseFloat(el.dataset.dur) || el.duration || 0;
  if (dur > 5) el.currentTime = Math.random() * (dur * 0.85);
}

function preloadMosTile(tile, v) {
  const pre = tile.active === 'a' ? tile.b : tile.a;
  pre.pause();
  pre.dataset.vid = v.id;
  pre.dataset.dur = v.duration || 0;
  pre.dataset.ready = '0';
  pre.src = '/api/stream/' + v.id;
  pre.addEventListener('loadedmetadata', () => {
    mosSeekRandom(pre);
    pre.play().catch(() => {});
  }, { once: true });
  pre.addEventListener('seeked', () => { pre.dataset.ready = '1'; }, { once: true });
}

function buildMosaicTiles() {
  const grid = $('mosaic-grid').el;
  mosTilesState.forEach(t => {
    if (!t.isPhoto) { t.a.pause(); t.a.src = ''; t.b.pause(); t.b.src = ''; }
  });
  mosTilesState = [];
  mosHoveredIdx = -1;
  grid.innerHTML = '';

  const n = mosTileCount;
  if (n === 6) {
    grid.classList.add('mos-layout-6');
    grid.style.gridTemplateColumns = '';
    grid.style.gridTemplateRows = '';
  } else {
    grid.classList.remove('mos-layout-6');
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

    a.src = '/api/stream/' + v.id;
    a.addEventListener('loadedmetadata', () => { mosSeekRandom(a); a.play().catch(() => {}); }, { once: true });
    a.play().catch(() => {});

    const nextV = mosPickExcluding(v.id);
    preloadMosTile(tile, nextV);

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

function scheduleMosaic() {
  clearTimeout(mosaicTimer);
  if (!mosaicOn) return;
  mosaicTimer = setTimeout(() => { refreshMosaicTiles(); scheduleMosaic(); }, mosaicIv * 1000);
}

function refreshMosaicTiles() {
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
        preloadMosTile(tile, mosPickExcluding(tile.vidId));
      }, 650);
    } else {
      mosSeekRandom(curEl);
    }
  });
}

function setMosaicIv(delta) {
  mosaicIv = Math.max(2, Math.min(60, mosaicIv + delta));
  $('mosaic-interval').text(mosaicIv + 's');
  scheduleMosaic();
}

function setMosaicCount(val) {
  mosTileCount = Math.max(1, Math.min(16, parseInt(val) || 6));
  $('mosaic-count').val(mosTileCount);
  if (mosaicOn) { buildMosaicTiles(); scheduleMosaic(); }
}
