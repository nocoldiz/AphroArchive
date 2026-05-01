// ─── Video Player ───
async function openVid(id, prevView) {
  if (window.shiftKeyPressed || (typeof videoSelMode !== 'undefined' && videoSelMode)) {
    if (window.toggleVideoSel) { toggleVideoSel(id); return; }
  }
  _prevView = prevView || null;
  if (remoteMode) {
    await fetch('/api/remote/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'play', id }),
    }).catch(() => {});
    toast('▶ Playing on main device');
    return;
  }
  if (location.pathname !== '/video/' + id) history.pushState(null, '', '/video/' + id);
  fetch('/api/history/' + id, { method: 'POST' });
  const d = await (await fetch('/api/videos/' + id)).json();
  curV = d.video;
  if (q) {
    q = '';
    $('search-input').val('');
    $('search-ghost').html('');
  }
  $('browse-view').add('off');
  $('tag-detail-view').remove('on');
  $('actor-detail-view').remove('on');
  $('studio-detail-view').remove('on');
  $('player-view').add('on');
  const vid = $('video-player').el;
  // Clear any existing tracks before setting new src
  while (vid.firstChild) vid.removeChild(vid.firstChild);
  vid.src = '/api/stream/' + id;
  fetch('/api/subtitles/' + id).then(r => r.json()).then(tracks => {
    tracks.forEach((t, i) => {
      const el = document.createElement('track');
      el.kind    = 'subtitles';
      el.label   = t.label;
      el.src     = '/api/subtitle-file/' + id + '/' + encodeURIComponent(t.filename);
      el.default = i === 0;
      vid.appendChild(el);
    });
  }).catch(() => {});
  $('player-title').text(curV.name);
  $('player-category').text(curV.category);
  $('player-size').text(curV.sizeF);
  $('player-duration').text(curV.durationF || '');
  updPStar();
  const actorsEl = $('player-actors').el;
  if (d.actors && d.actors.length) {
    actorsEl.innerHTML = d.actors.map(a =>
      '<button class="p-actor-tag" onclick="openActorFromVideo(\'' + escA(a) + '\')">' +
      '<img class="p-actor-ph" src="/api/actor-photos/' + encodeURIComponent(a) + '/img" alt="" onerror="this.style.display=\'none\'">' +
      esc(a) + '</button>'
    ).join('');
  } else {
    actorsEl.innerHTML = '';
  }
  curVTags = d.tags || [];
  curVAllCategories = d.allCategories || [];
  curVActors = d.actors || [];
  curVStudio = d.studio || '';
  renderVideoTags();
  renderRating(d.video.rating || null);
  renderPlayerStudio();
  renderPlaylist();
  $('suggestions-grid').html(d.suggested.map(card).join(''));
  attachThumbs();
  requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  loadAiComments(curV.id, curV.name);
}

function _aiAvatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return 'hsl(' + (Math.abs(h) % 360) + ',55%,45%)';
}

function _aiUsername() {
  const adj  = ['Curious','Sneaky','Bold','Gentle','Witty','Calm','Fuzzy','Quick','Silent','Clever'];
  const noun = ['Otter','Falcon','Panda','Wolf','Raven','Tiger','Fox','Lynx','Elk','Bear'];
  const num  = Math.floor(Math.random() * 90 + 10);
  return adj[Math.floor(Math.random() * adj.length)] + noun[Math.floor(Math.random() * noun.length)] + num;
}

async function loadAiComments(videoId, videoName) {
  const sec = $('ai-comments-section').el;
  if (!sec) return;
  if (!aiCommentsEnabled) { sec.style.display = 'none'; return; }
  sec.style.display = '';
  const inputRow = document.getElementById('ai-comment-input-row');
  if (inputRow) inputRow.style.display = 'none'; // widget renders its own input
  const count = await CommentsWidget.init(videoId, videoName, 'ai-comments-list', null, { theme: 'dark' });
  if (count === 0 && !document.getElementById('ai-comments-list').textContent.trim()) {
    sec.style.display = 'none';
  }
}

let _prevView = null;

async function openVidTag(id) {
  const pv = curTag ? { type: 'tag', tag: curTag } : null;
  await openVid(id, pv);
}

function searchVideoOn(engine) {
  if (!curV) return;
  const q = encodeURIComponent(curV.name);
  if (engine === 'ddg') window.open('https://duckduckgo.com/?q=' + q, '_blank');
  else if (engine === 'yandex') window.open('https://yandex.com/search/?text=' + q, '_blank');
}

async function openVideoFolder() {
  if (!curV) return;
  const r = await fetch('/api/open-folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: curV.id }) });
  if (!r.ok) { const d = await r.json(); toast(d.error || 'Failed'); }
}

// ─── Favourites ───
async function togStar(id) {
  const d = await (await fetch('/api/favourites/' + id, { method: 'POST' })).json();
  const v = V.find(x => x.id === id);
  if (v) v.fav = d.fav;
  render();
  toast(d.fav ? '\u2605 Added to favourites' : 'Removed from favourites');
}

async function togglePStar() {
  if (!curV) return;
  const d = await (await fetch('/api/favourites/' + curV.id, { method: 'POST' })).json();
  curV.fav = d.fav;
  updPStar();
  toast(d.fav ? '\u2605 Added to favourites' : 'Removed from favourites');
}

function updPStar() {
  const b = $('player-star-btn').el;
  b.classList.toggle('st', curV?.fav);
  b.querySelector('svg').setAttribute('fill', curV?.fav ? 'currentColor' : 'none');
}

// ─── Rating ───
function renderRating(rating) {
  curVRating = rating;
  const el = $('player-rating').el;
  if (!el) return;
  if (curV && curV.isVault) { el.innerHTML = ''; return; }
  let html = '';
  for (let i = 1; i <= 5; i++) {
    html += '<button class="p-star' + (rating >= i ? ' on' : '') + '" ' +
      'onclick="setRating(' + i + ')" ' +
      'onmouseenter="hoverRating(' + i + ')" ' +
      'onmouseleave="hoverRating(' + (rating || 0) + ')">★</button>';
  }
  if (rating) html += '<button class="p-star-clear" onclick="clearRating()" onmouseenter="hoverRating(' + (rating || 0) + ')" title="Remove rating">✕</button>';
  el.innerHTML = html;
}

function hoverRating(n) {
  document.querySelectorAll('#player-rating .p-star').forEach((el, i) => {
    el.classList.toggle('on', i < n);
  });
}

async function setRating(stars) {
  if (!curV || curV.isVault) return;
  if (curVRating === stars) { await clearRating(); return; }
  const r = await fetch('/api/videos/' + curV.id + '/meta', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating: stars })
  });
  if (!r.ok) { toast('Failed to save rating'); return; }
  renderRating(stars);
  const v = V.find(x => x.id === curV.id);
  if (v) v.rating = stars;
}

async function clearRating() {
  if (!curV) return;
  await fetch('/api/videos/' + curV.id + '/meta', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating: null })
  });
  renderRating(null);
  const v = V.find(x => x.id === curV.id);
  if (v) v.rating = null;
}

// ─── Video Tag Management ───
function renderVideoTags() {
  const row = $('player-tags-row').el;
  const el = $('player-tags').el;
  const canEdit = curV && !curV.isVault;
  row.style.display = (curVTags.length || canEdit) ? '' : 'none';
  $('player-tag-add-btn').el.style.display = canEdit ? '' : 'none';
  el.innerHTML = curVTags.map(t =>
    '<span class="p-tag">' + esc(t) + '</span>'
  ).join('');
}

async function applyVideoRename(newName) {
  const r = await fetch('/api/videos/' + curV.id + '/rename', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newName })
  });
  const d = await r.json();
  if (!r.ok) { toast(d.error || 'Rename failed'); return false; }
  curV.id = d.newId;
  curV.name = newName;
  $('player-title').text(newName);
  const vp = $('video-player').el, t = vp.currentTime;
  vp.src = '/api/stream/' + d.newId;
  vp.currentTime = t;
  return true;
}

// ─── Card-level actor/studio modals (no view navigation) ───
async function openActorModalForCard(id) {
  const d = await fetch('/api/videos/' + id).then(r => r.json()).catch(() => null);
  if (!d) return;
  curV = d.video;
  curVActors = d.actors || [];
  curVStudio = d.studio || '';
  openActorModal();
}

async function openStudioModalForCard(id) {
  const d = await fetch('/api/videos/' + id).then(r => r.json()).catch(() => null);
  if (!d) return;
  curV = d.video;
  curVActors = d.actors || [];
  curVStudio = d.studio || '';
  openStudioModal();
}

// ─── Actor Modal ───
let _actorModalList = [];

function renderPlayerActors() {
  $('player-actors').el.innerHTML = curVActors.map(a =>
    '<button class="p-actor-tag" onclick="openActorFromVideo(\'' + escA(a) + '\')">' +
    '<img class="p-actor-ph" src="/api/actor-photos/' + encodeURIComponent(a) + '/img" alt="" onerror="this.style.display=\'none\'">' +
    esc(a) + '</button>'
  ).join('');
}

async function openActorModal() {
  if (!curV || curV.isVault) return;
  _actorModalList = await (await fetch('/api/actors')).json().catch(() => []);
  document.getElementById('actor-modal').classList.add('on');
  _renderActorModalChips();
  _renderActorModalSuggestions('');
  const inp = document.getElementById('actor-modal-input');
  inp.value = '';
  inp.focus();
}

function closeActorModal() {
  document.getElementById('actor-modal').classList.remove('on');
}

function _renderActorModalChips() {
  document.getElementById('actor-modal-actors').innerHTML = curVActors.map(a =>
    '<span class="tag-chip">' + esc(a) +
    '<button onclick="removeActorFromVideo(\'' + escA(a) + '\')" title="Remove">✕</button></span>'
  ).join('');
}

function _renderActorModalSuggestions(q) {
  const trimmed = q.trim();
  const lo = trimmed.toLowerCase();
  const hits = lo
    ? _actorModalList.filter(a => a.name.toLowerCase().includes(lo) && !curVActors.includes(a.name))
    : _actorModalList.filter(a => !curVActors.includes(a.name));
  const exactMatch = lo && _actorModalList.some(a => a.name.toLowerCase() === lo);
  const hitsHtml = hits.slice(0, 40).map(a =>
    '<div class="p-tag-picker-item" onclick="addActorFromModal(\'' + escA(a.name) + '\')">' + esc(a.name) + '</div>'
  ).join('');
  const addHtml = (lo && !exactMatch)
    ? '<div class="p-tag-picker-item p-tag-picker-new" onclick="addActorFromModal(\'' + escA(trimmed) + '\')">Add "<strong>' + esc(trimmed) + '</strong>" as new actor</div>'
    : '';
  document.getElementById('actor-modal-list').innerHTML = hitsHtml + addHtml;
}

function onActorModalInput(v) { _renderActorModalSuggestions(v); }

function onActorModalKeydown(e) {
  if (e.key === 'Enter') {
    const v = document.getElementById('actor-modal-input').value.trim();
    if (v) addActorFromModal(v);
  } else if (e.key === 'Escape') {
    closeActorModal();
  }
}

async function addActorFromModal(name) {
  name = (name || '').trim();
  if (!name || !curV || curV.isVault) return;
  const exists = _actorModalList.some(a => a.name.toLowerCase() === name.toLowerCase());
  if (!exists) {
    const r = await fetch('/api/db/actors', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data: {} })
    });
    if (r.ok) toast('Added "' + name + '" to actors database');
    _actorModalList = await (await fetch('/api/actors')).json().catch(() => _actorModalList);
  }
  const newActors = [...new Set([...curVActors, name])];
  const r = await fetch('/api/videos/' + curV.id + '/meta', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actors: newActors })
  });
  if (!r.ok) { toast('Failed to add actor'); return; }
  curVActors = newActors;
  renderPlayerActors();
  _renderActorModalChips();
  const inp = document.getElementById('actor-modal-input');
  _renderActorModalSuggestions(inp.value);
  inp.value = '';
  inp.focus();
}

async function removeActorFromVideo(name) {
  if (!curV || curV.isVault) return;
  const newActors = curVActors.filter(a => a !== name);
  const r = await fetch('/api/videos/' + curV.id + '/meta', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actors: newActors })
  });
  if (!r.ok) { toast('Failed to remove actor'); return; }
  curVActors = newActors;
  renderPlayerActors();
  _renderActorModalChips();
  _renderActorModalSuggestions(document.getElementById('actor-modal-input').value);
}

// ─── Studio Modal ───
let _studioModalList = [];

function renderPlayerStudio() {
  const el = document.getElementById('player-studio');
  if (el) el.textContent = curVStudio || '';
  const row = document.getElementById('player-studio-row');
  if (row) row.style.display = (curV && !curV.isVault) ? '' : 'none';
}

async function openStudioModal() {
  if (!curV || curV.isVault) return;
  _studioModalList = await (await fetch('/api/studios')).json().catch(() => []);
  document.getElementById('studio-modal').classList.add('on');
  const inp = document.getElementById('studio-modal-input');
  inp.value = curVStudio || '';
  _renderStudioModalList(inp.value);
  inp.focus();
  inp.select();
}

function closeStudioModal() {
  document.getElementById('studio-modal').classList.remove('on');
}

function _renderStudioModalList(q) {
  const trimmed = q.trim();
  const lo = trimmed.toLowerCase();
  const hits = lo
    ? _studioModalList.filter(s => s.name.toLowerCase().includes(lo))
    : _studioModalList;
  const exactMatch = lo && _studioModalList.some(s => s.name.toLowerCase() === lo);
  const hitsHtml = hits.slice(0, 40).map(s =>
    '<div class="p-tag-picker-item' + (s.name === curVStudio ? ' selected' : '') + '" onclick="pickStudio(\'' + escA(s.name) + '\')">' + esc(s.name) + '</div>'
  ).join('');
  const addHtml = (lo && !exactMatch)
    ? '<div class="p-tag-picker-item p-tag-picker-new" onclick="pickStudio(\'' + escA(trimmed) + '\')">Add "<strong>' + esc(trimmed) + '</strong>" as new studio</div>'
    : '';
  document.getElementById('studio-modal-list').innerHTML = hitsHtml + addHtml;
}

function onStudioModalInput(v) { _renderStudioModalList(v); }

function onStudioModalKeydown(e) {
  if (e.key === 'Enter') submitStudio();
  else if (e.key === 'Escape') closeStudioModal();
}

function pickStudio(name) {
  name = (name || '').trim();
  document.getElementById('studio-modal-input').value = name;
  _renderStudioModalList(name);
}

async function submitStudio() {
  const name = (document.getElementById('studio-modal-input').value || '').trim();
  closeStudioModal();
  if (!curV || curV.isVault) return;
  let createdStudio = false;
  if (name) {
    const exists = _studioModalList.some(s => s.name.toLowerCase() === name.toLowerCase());
    if (!exists) {
      const dr = await fetch('/api/db/studios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, data: {} })
      });
      if (dr.ok) createdStudio = true;
    }
  }
  const r = await fetch('/api/videos/' + curV.id + '/meta', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studio: name })
  });
  if (!r.ok) { toast('Failed to set studio'); return; }
  curVStudio = name;
  renderPlayerStudio();
  toast(createdStudio ? 'Added "' + name + '" to studios database' : name ? 'Studio set' : 'Studio cleared');
}

// ─── Playback position persistence ───
(function () {
  const LS_PREFIX = 'pos:';
  const SAVE_INTERVAL = 5000; // ms between localStorage writes
  const MIN_SAVE_S = 10;      // don't save if under 10s (treat as "just started")
  const END_THRESHOLD = 0.97; // clear saved pos when within last 3%

  let _saveTimer = null;

  function savePos(vid) {
    if (!curV) return;
    const pct = vid.duration ? vid.currentTime / vid.duration : 0;
    if (vid.currentTime < MIN_SAVE_S || pct >= END_THRESHOLD) return;
    try { localStorage.setItem(LS_PREFIX + curV.id, Math.floor(vid.currentTime)); } catch {}
  }

  function clearPos(id) {
    try { localStorage.removeItem(LS_PREFIX + id); } catch {}
  }

  function restorePos(vid) {
    if (!curV) return;
    let saved;
    try { saved = parseInt(localStorage.getItem(LS_PREFIX + curV.id), 10); } catch {}
    if (saved && saved > MIN_SAVE_S) vid.currentTime = saved;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const vid = document.getElementById('video-player');
    if (!vid) return;

    vid.addEventListener('timeupdate', () => {
      if (_saveTimer) return;
      _saveTimer = setTimeout(() => {
        _saveTimer = null;
        savePos(vid);
      }, SAVE_INTERVAL);
    });

    vid.addEventListener('loadedmetadata', () => restorePos(vid));

    vid.addEventListener('ended', () => {
      if (curV) clearPos(curV.id);
    });
  });
})();

// ─── Keyboard Shortcuts ───
document.addEventListener('keydown', e => {
  // Don't fire when typing
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
  // Only act when a video is open
  if (!curV) return;

  const vid = $('video-player').el;
  if (!vid) return;

  switch (e.key) {
    case 'ArrowLeft':
      e.preventDefault();
      vid.currentTime = Math.max(0, vid.currentTime - 10);
      toast('⏪ −10s', 700);
      break;
    case 'ArrowRight':
      e.preventDefault();
      vid.currentTime = Math.min(vid.duration || Infinity, vid.currentTime + 10);
      toast('⏩ +10s', 700);
      break;
    case 'ArrowUp':
      e.preventDefault();
      vid.volume = Math.min(1, Math.round((vid.volume + 0.1) * 10) / 10);
      toast('🔊 ' + Math.round(vid.volume * 100) + '%', 700);
      break;
    case 'ArrowDown':
      e.preventDefault();
      vid.volume = Math.max(0, Math.round((vid.volume - 0.1) * 10) / 10);
      toast('🔉 ' + Math.round(vid.volume * 100) + '%', 700);
      break;
    case ' ':
      // Only intercept space when the video element itself isn't focused
      if (document.activeElement !== vid) {
        e.preventDefault();
        if (vid.paused) vid.play(); else vid.pause();
      }
      break;
    case 'f': case 'F':
      togglePStar();
      break;
    case 'm': case 'M':
      vid.muted = !vid.muted;
      toast(vid.muted ? '🔇 Muted' : '🔊 Unmuted', 700);
      break;
    case 'n': case 'N':
      playNext();
      break;
    case 'p': case 'P':
      playPrev();
      break;
  }
});
