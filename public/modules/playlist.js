// ─── Playlist ───
function buildPl() {
  if (!curV || !V.length) return [];
  return V.filter(v => !playlistSkipped.has(v.id));
}

function renderPlaylist() {
  const pl = buildPl();
  const cols = ['#e84040','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];
  $('playlist-count').text(pl.length + ' video' + (pl.length !== 1 ? 's' : ''));
  const listEl = $('playlist-list').el;
  if (!pl.length) {
    listEl.innerHTML = '<div class="playlist-empty">Nothing up next</div>';
    return;
  }
  listEl.innerHTML = pl.map((v, i) => {
    const c = cols[Math.abs(hsh(v.category)) % cols.length];
    const isCur = curV && v.id === curV.id;
    return '<div class="playlist-item' + (isCur ? ' cur' : '') + '" id="ppl-' + v.id + '" onclick="openVid(\'' + escA(v.id) + '\')">' +
      '<div class="card-thumb playlist-thumb" data-vid="' + v.id + '" style="background:linear-gradient(135deg,' + c + '12 0%,' + c + '06 100%)">' +
        '<div class="play-overlay" style="transform:translate(-50%,-50%) scale(0.6)"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></div>' +
        (v.durationF ? '<span class="duration-badge">' + v.durationF + '</span>' : '') +
        (v.rating ? '<div class="rating-badge"><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' + v.rating + '</div>' : '') +
      '</div>' +
      '<div class="playlist-info">' +
        '<span class="playlist-num">' + (i + 1) + '</span>' +
        '<span class="playlist-name">' + esc(v.name) + '</span>' +
        '<span class="playlist-category">' + esc(v.category) + '</span>' +
      '</div>' +
      '<button class="playlist-remove" onclick="event.stopPropagation();skipFromPlaylist(\'' + escA(v.id) + '\')" title="Remove from playlist">' +
        '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
      '</button>' +
      '</div>';
  }).join('');
  if (curV) {
    const curEl = $('ppl-' + curV.id).el;
    if (curEl) setTimeout(() => curEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
  }
}

function skipFromPlaylist(id) {
  playlistSkipped.add(id);
  renderPlaylist();
}

function toggleCardPlaylist(id, btn) {
  if (playlistSkipped.has(id)) {
    playlistSkipped.delete(id);
    btn.classList.remove('pl-off');
    btn.title = 'Remove from playlist';
    toast('Added to playlist', 900);
  } else {
    playlistSkipped.add(id);
    btn.classList.add('pl-off');
    btn.title = 'Add to playlist';
    toast('Removed from playlist', 900);
  }
  if (curV) renderPlaylist();
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

$('video-player').el.addEventListener('ended', playNext);
$('vPin').el.addEventListener('ended', pinNext);

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
  const vPin = $('vPin').el;
  vPin.src = '/api/stream/' + pinnedV.id;
  $('pinTitle').text(pinnedV.name);
  renderPinPlaylist();
  $('pinPanel').add('on');
  $('pinBtn').add('on');
  $('pinBtn').el.querySelector('span').textContent = 'Unpin';
}

function unpinVideo() {
  pinnedV = null; pinnedPl = []; pinnedIdx = 0;
  const vPin = $('vPin').el;
  vPin.pause(); vPin.src = '';
  $('pinPanel').remove('on');
  $('pinBtn').remove('on');
  $('pinBtn').el.querySelector('span').textContent = 'Pin';
}

function renderPinPlaylist() {
  const cols = ['#e84040','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];
  const listEl = $('pinList').el;
  if (!pinnedPl.length) { listEl.innerHTML = ''; return; }
  listEl.innerHTML = pinnedPl.map((v, i) => {
    const c = cols[Math.abs(hsh(v.category)) % cols.length];
    const isCur = pinnedV && v.id === pinnedV.id;
    return '<div class="playlist-item' + (isCur ? ' cur' : '') + '" id="pinpl-' + v.id + '" onclick="pinJump(' + i + ')">' +
      '<div class="playlist-thumb card-thumb" data-vid="' + v.id + '" style="background:linear-gradient(135deg,' + c + '12 0%,' + c + '06 100%)">' +
        '<div class="play-overlay" style="transform:translate(-50%,-50%) scale(0.6)"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></div>' +
        (v.durationF ? '<span class="duration-badge">' + v.durationF + '</span>' : '') +
      '</div>' +
      '<div class="playlist-info">' +
        '<span class="playlist-num">' + (i + 1) + '</span>' +
        '<span class="playlist-name">' + esc(v.name) + '</span>' +
      '</div>' +
      '</div>';
  }).join('');
  const curEl = $('pinpl-' + pinnedV.id).el;
  if (curEl) setTimeout(() => curEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
}

function pinJump(idx) {
  if (idx < 0 || idx >= pinnedPl.length) return;
  pinnedIdx = idx;
  pinnedV = pinnedPl[idx];
  $('vPin').el.src = '/api/stream/' + pinnedV.id;
  $('pinTitle').text(pinnedV.name);
  renderPinPlaylist();
}

function pinNext() {
  pinJump((pinnedIdx + 1) % pinnedPl.length);
}

function pinPrev() {
  pinJump((pinnedIdx - 1 + pinnedPl.length) % pinnedPl.length);
}
