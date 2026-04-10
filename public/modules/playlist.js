// ─── Playlist ───
function buildPl() {
  if (!curV || !V.length) return [];
  return V.filter(v => !playlistSkipped.has(v.id));
}

function renderPlaylist() {
  const pl = buildPl();
  const cols = ['#e84040','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];
  document.getElementById('pplCount').textContent = pl.length + ' video' + (pl.length !== 1 ? 's' : '');
  const listEl = document.getElementById('pplList');
  if (!pl.length) {
    listEl.innerHTML = '<div class="ppl-empty">Playlist is empty</div>';
    return;
  }
  listEl.innerHTML = pl.map((v, i) => {
    const c = cols[Math.abs(hsh(v.category)) % cols.length];
    const isCur = curV && v.id === curV.id;
    return '<div class="ppl-item' + (isCur ? ' cur' : '') + '" id="ppl-' + v.id + '" onclick="openVid(\'' + escA(v.id) + '\')">' +
      '<div class="ct ppl-ct" data-vid="' + v.id + '" style="background:linear-gradient(135deg,' + c + '12 0%,' + c + '06 100%)">' +
        '<div class="po" style="transform:translate(-50%,-50%) scale(0.6)"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></div>' +
        (v.durationF ? '<span class="durb">' + v.durationF + '</span>' : '') +
        (v.rating ? '<div class="vr-badge"><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' + v.rating + '</div>' : '') +
      '</div>' +
      '<div class="ppl-info">' +
        '<span class="ppl-num">' + (i + 1) + '</span>' +
        '<span class="ppl-name">' + esc(v.name) + '</span>' +
        '<span class="ppl-cat">' + esc(v.category) + '</span>' +
      '</div>' +
      '<button class="ppl-rm" onclick="event.stopPropagation();skipFromPlaylist(\'' + escA(v.id) + '\')" title="Remove from playlist">' +
        '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
      '</button>' +
      '</div>';
  }).join('');
  if (curV) {
    const curEl = document.getElementById('ppl-' + curV.id);
    if (curEl) setTimeout(() => curEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
  }
}

function skipFromPlaylist(id) {
  playlistSkipped.add(id);
  renderPlaylist();
}

function playNext() {
  if (curV && curV.isVault) {
    if (vaultPl.length < 2) return;
    vaultPlIdx = (vaultPlIdx + 1) % vaultPl.length;
    const f = vaultPl[vaultPlIdx];
    openVaultVid(f.id, f.name || f.originalName, f.ext);
    return;
  }
  const pl = buildPl();
  if (pl.length < 2) return;
  const idx = pl.findIndex(v => v.id === curV.id);
  openVid(pl[(idx + 1) % pl.length].id);
}

function playPrev() {
  if (curV && curV.isVault) {
    if (vaultPl.length < 2) return;
    vaultPlIdx = (vaultPlIdx - 1 + vaultPl.length) % vaultPl.length;
    const f = vaultPl[vaultPlIdx];
    openVaultVid(f.id, f.name || f.originalName, f.ext);
    return;
  }
  const pl = buildPl();
  if (pl.length < 2) return;
  const idx = pl.findIndex(v => v.id === curV.id);
  openVid(pl[(idx - 1 + pl.length) % pl.length].id);
}

document.getElementById('vP').addEventListener('ended', playNext);
document.getElementById('vPin').addEventListener('ended', pinNext);

// ─── Pin (Dual Play) ───
function togglePin() {
  if (pinnedV) unpinVideo(); else pinVideo();
}

function pinVideo() {
  if (!curV) return;
  pinnedV = curV;
  pinnedPl = buildPl().slice();
  pinnedIdx = pinnedPl.findIndex(v => v.id === pinnedV.id);
  if (pinnedIdx < 0) pinnedIdx = 0;
  const vPin = document.getElementById('vPin');
  vPin.src = '/api/stream/' + pinnedV.id;
  document.getElementById('pinTitle').textContent = pinnedV.name;
  renderPinPlaylist();
  document.getElementById('pinPanel').classList.add('on');
  document.getElementById('pinBtn').classList.add('on');
  document.getElementById('pinBtn').querySelector('span').textContent = 'Unpin';
}

function unpinVideo() {
  pinnedV = null; pinnedPl = []; pinnedIdx = 0;
  const vPin = document.getElementById('vPin');
  vPin.pause(); vPin.src = '';
  document.getElementById('pinPanel').classList.remove('on');
  document.getElementById('pinBtn').classList.remove('on');
  document.getElementById('pinBtn').querySelector('span').textContent = 'Pin';
}

function renderPinPlaylist() {
  const cols = ['#e84040','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];
  const listEl = document.getElementById('pinList');
  if (!pinnedPl.length) { listEl.innerHTML = ''; return; }
  listEl.innerHTML = pinnedPl.map((v, i) => {
    const c = cols[Math.abs(hsh(v.category)) % cols.length];
    const isCur = pinnedV && v.id === pinnedV.id;
    return '<div class="ppl-item' + (isCur ? ' cur' : '') + '" id="pinpl-' + v.id + '" onclick="pinJump(' + i + ')">' +
      '<div class="ppl-ct ct" data-vid="' + v.id + '" style="background:linear-gradient(135deg,' + c + '12 0%,' + c + '06 100%)">' +
        '<div class="po" style="transform:translate(-50%,-50%) scale(0.6)"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></div>' +
        (v.durationF ? '<span class="durb">' + v.durationF + '</span>' : '') +
      '</div>' +
      '<div class="ppl-info">' +
        '<span class="ppl-num">' + (i + 1) + '</span>' +
        '<span class="ppl-name">' + esc(v.name) + '</span>' +
      '</div>' +
      '</div>';
  }).join('');
  const curEl = document.getElementById('pinpl-' + pinnedV.id);
  if (curEl) setTimeout(() => curEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
}

function pinJump(idx) {
  if (idx < 0 || idx >= pinnedPl.length) return;
  pinnedIdx = idx;
  pinnedV = pinnedPl[idx];
  document.getElementById('vPin').src = '/api/stream/' + pinnedV.id;
  document.getElementById('pinTitle').textContent = pinnedV.name;
  renderPinPlaylist();
}

function pinNext() {
  pinJump((pinnedIdx + 1) % pinnedPl.length);
}

function pinPrev() {
  pinJump((pinnedIdx - 1 + pinnedPl.length) % pinnedPl.length);
}
