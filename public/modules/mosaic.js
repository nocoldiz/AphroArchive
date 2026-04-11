// ─── Mosaic Mode ───
function toggleMosaic() {
  if (mosaicOn) stopMosaic(); else startMosaic();
}

function startMosaic() {
  if (!V.length) { toast('No videos to show'); return; }
  mosaicOn = true;
  $('browse-view').add('off');
  $('player-view').remove('on');
  $('duplicates-view').remove('on');
  $('duplicates-sidebar').remove('on');
  dupMode = false;
  if (curV) { const vp = $('video-player').el; vp.pause(); vp.src = ''; curV = null; }
  $('mosaic-category-label').el.textContent = cat
    ? (cats.find(x => x.path === cat)?.name || cat) + ' — Mosaic'
    : 'All Videos — Mosaic';
  $('mosaic-interval').text(mosaicIv + 's');
  $('mosaic-view').add('on');
  $('mosBtn').add('on');
  buildMosaicTiles();
  scheduleMosaic();
}

function stopMosaic() {
  mosaicOn = false;
  clearTimeout(mosaicTimer);
  mosTilesState.forEach(t => {
    t.a.pause(); t.a.src = '';
    t.b.pause(); t.b.src = '';
  });
  mosTilesState = [];
  mosHoveredIdx = -1;
  $('mosaic-view').remove('on');
  $('mosBtn').remove('on');
  $('browse-view').remove('off');
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
  mosTilesState.forEach(t => { t.a.pause(); t.a.src = ''; t.b.pause(); t.b.src = ''; });
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

    const tile = { wrap, a, b, active: 'a', vidId: v.id };
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
      mosTilesState.forEach(t => { t.a.muted = true; t.b.muted = true; });
    });
  });
}

function scheduleMosaic() {
  clearTimeout(mosaicTimer);
  if (!mosaicOn) return;
  mosaicTimer = setTimeout(() => { refreshMosaicTiles(); scheduleMosaic(); }, mosaicIv * 1000);
}

function refreshMosaicTiles() {
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
