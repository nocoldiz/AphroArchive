// ─── Video Player ───
async function openVid(id) {
  if (location.pathname !== '/video/' + id) history.pushState(null, '', '/video/' + id);
  fetch('/api/history/' + id, { method: 'POST' });
  const d = await (await fetch('/api/videos/' + id)).json();
  curV = d.video;
  $('browse-view').add('off');
  $('player-view').add('on');
  $('video-player').el.src = '/api/stream/' + id;
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
  renderVideoTags();
  renderRating(d.video.rating || null);
  renderPlaylist();
  $('suggestions-grid').html(d.suggested.map(card).join(''));
  attachThumbs();
  requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'instant' }));
}

async function openVidTag(id) {
  await openVid(id);
  requestAnimationFrame(() => {
    const row = $('player-tags-row').el;
    if (row && row.style.display !== 'none') toggleTagPicker();
  });
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
  const r = await fetch('/api/ratings/' + encodeURIComponent(curV.id), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stars })
  });
  if (!r.ok) { toast('Failed to save rating'); return; }
  renderRating(stars);
  const v = V.find(x => x.id === curV.id);
  if (v) v.rating = stars;
}

async function clearRating() {
  if (!curV) return;
  await fetch('/api/ratings/' + encodeURIComponent(curV.id), { method: 'DELETE' });
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
    '<span class="p-tag">' + esc(t) +
    (canEdit
      ? '<button class="p-tag-rm" onclick="removeVideoTag(\'' + escA(t) + '\')" title="Remove tag">' +
        '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg></button>'
      : '') +
    '</span>'
  ).join('');
}

async function removeVideoTag(tag) {
  if (!curV || curV.isVault) return;
  const re = new RegExp('\\s*' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'gi');
  const newName = curV.name.replace(re, ' ').trim().replace(/\s+/g, ' ').replace(/\s*-\s*$/, '').trim();
  if (!newName) { toast('Cannot remove — name would be empty'); return; }
  const ok = await applyVideoRename(newName);
  if (!ok) return;
  curVTags = curVTags.filter(t => t.toLowerCase() !== tag.toLowerCase());
  renderVideoTags();
  closeTagPicker();
}

function toggleTagPicker() {
  const picker = $('player-tag-picker').el;
  const btn = $('player-tag-add-btn').el;
  if (picker.style.display === 'none') {
    const available = curVAllCategories.filter(c =>
      !curVTags.some(t => t.toLowerCase() === c.toLowerCase())
    );
    const list = $('player-tag-picker-list').el;
    if (!available.length) {
      list.innerHTML = '<span class="p-tag-picker-empty">All categories already present</span>';
    } else {
      list.innerHTML = available.map(c =>
        '<span class="p-tag-picker-item" data-tag="' + escA(c) + '" onclick="this.classList.toggle(\'sel\')">' + esc(c) + '</span>'
      ).join('');
    }
    picker.style.display = '';
    btn.classList.add('on');
    const search = $('player-tag-picker-search').el;
    search.value = '';
    search.focus();
  } else {
    closeTagPicker();
  }
}

function filterTagPicker(q) {
  const lo = q.trim().toLowerCase();
  document.querySelectorAll('#player-tag-picker-list .p-tag-picker-item').forEach(el => {
    el.style.display = !lo || el.dataset.tag.toLowerCase().includes(lo) ? '' : 'none';
  });
}

function closeTagPicker() {
  $('player-tag-picker').show(false);
  $('player-tag-add-btn').remove('on');
  $('player-tag-picker-search').val('');
}

async function applyTagPicker() {
  const selected = [...document.querySelectorAll('#player-tag-picker-list .p-tag-picker-item.sel')]
    .map(el => el.dataset.tag);
  closeTagPicker();
  if (!selected.length) return;
  const sepIdx = curV.name.indexOf(' - ');
  const base = sepIdx !== -1 ? curV.name.slice(0, sepIdx).trim() : curV.name.trim();
  const existing = sepIdx !== -1 ? curV.name.slice(sepIdx + 3).trim() : '';
  const newTagsSection = existing ? existing + ' ' + selected.join(' ') : selected.join(' ');
  const newName = base + ' - ' + newTagsSection;
  const ok = await applyVideoRename(newName);
  if (!ok) return;
  selected.forEach(t => { if (!curVTags.some(x => x.toLowerCase() === t.toLowerCase())) curVTags.push(t); });
  renderVideoTags();
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

// ─── Actor Input Panel ───
function toggleActorInput() {
  const panel = $('player-actor-input').el;
  if (panel.style.display === 'none') {
    panel.style.display = '';
    $('player-actor-add-btn').add('on');
    const inp = $('player-actor-input-val').el;
    inp.value = '';
    inp.focus();
  } else {
    closeActorInput();
  }
}

function closeActorInput() {
  $('player-actor-input').show(false);
  $('player-actor-add-btn').remove('on');
}

async function submitActorInput() {
  const name = $('player-actor-input-val').el.value.trim();
  closeActorInput();
  if (!name || !curV || curV.isVault) return;
  const newName = name + ' ' + curV.name;
  const ok = await applyVideoRename(newName);
  if (!ok) return;
  const d = await (await fetch('/api/videos/' + curV.id)).json();
  const actorsEl = $('player-actors').el;
  if (d.actors && d.actors.length) {
    actorsEl.innerHTML = d.actors.map(a =>
      '<button class="p-actor-tag" onclick="openActorFromVideo(\'' + escA(a) + '\')">' +
      '<img class="p-actor-ph" src="/api/actor-photos/' + encodeURIComponent(a) + '/img" alt="" onerror="this.style.display=\'none\'">' +
      esc(a) + '</button>'
    ).join('');
  }
}

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
