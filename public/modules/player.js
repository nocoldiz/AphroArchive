// ─── Video Player ───
async function openVid(id) {
  if (location.pathname !== '/video/' + id) history.pushState(null, '', '/video/' + id);
  fetch('/api/history/' + id, { method: 'POST' });
  const d = await (await fetch('/api/videos/' + id)).json();
  curV = d.video;
  document.getElementById('bv').classList.add('off');
  document.getElementById('pv').classList.add('on');
  document.getElementById('vP').src = '/api/stream/' + id;
  document.getElementById('pT').textContent = curV.name;
  document.getElementById('pC').textContent = curV.category;
  document.getElementById('pS').textContent = curV.sizeF;
  document.getElementById('pD').textContent = curV.durationF || '';
  updPStar();
  const actorsEl = document.getElementById('pActors');
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
  document.getElementById('sG').innerHTML = d.suggested.map(card).join('');
  attachThumbs();
  requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'instant' }));
}

async function openVidTag(id) {
  await openVid(id);
  requestAnimationFrame(() => {
    const row = document.getElementById('pTagsRow');
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
  const b = document.getElementById('pSB');
  b.classList.toggle('st', curV?.fav);
  b.querySelector('svg').setAttribute('fill', curV?.fav ? 'currentColor' : 'none');
}

// ─── Rating ───
function renderRating(rating) {
  curVRating = rating;
  const el = document.getElementById('pRating');
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
  document.querySelectorAll('#pRating .p-star').forEach((el, i) => {
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
  const row = document.getElementById('pTagsRow');
  const el = document.getElementById('pTags');
  const canEdit = curV && !curV.isVault && !curV.external;
  row.style.display = (curVTags.length || canEdit) ? '' : 'none';
  document.getElementById('pTagAddBtn').style.display = canEdit ? '' : 'none';
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
  if (!curV || curV.isVault || curV.external) return;
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
  const picker = document.getElementById('pTagPicker');
  const btn = document.getElementById('pTagAddBtn');
  if (picker.style.display === 'none') {
    const available = curVAllCategories.filter(c =>
      !curVTags.some(t => t.toLowerCase() === c.toLowerCase())
    );
    const list = document.getElementById('pTagPickerList');
    if (!available.length) {
      list.innerHTML = '<span class="p-tag-picker-empty">All categories already present</span>';
    } else {
      list.innerHTML = available.map(c =>
        '<span class="p-tag-picker-item" data-tag="' + escA(c) + '" onclick="this.classList.toggle(\'sel\')">' + esc(c) + '</span>'
      ).join('');
    }
    picker.style.display = '';
    btn.classList.add('on');
    const search = document.getElementById('pTagPickerSearch');
    search.value = '';
    search.focus();
  } else {
    closeTagPicker();
  }
}

function filterTagPicker(q) {
  const lo = q.trim().toLowerCase();
  document.querySelectorAll('#pTagPickerList .p-tag-picker-item').forEach(el => {
    el.style.display = !lo || el.dataset.tag.toLowerCase().includes(lo) ? '' : 'none';
  });
}

function closeTagPicker() {
  document.getElementById('pTagPicker').style.display = 'none';
  document.getElementById('pTagAddBtn').classList.remove('on');
  document.getElementById('pTagPickerSearch').value = '';
}

async function applyTagPicker() {
  const selected = [...document.querySelectorAll('#pTagPickerList .p-tag-picker-item.sel')]
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
  document.getElementById('pT').textContent = newName;
  const vp = document.getElementById('vP'), t = vp.currentTime;
  vp.src = '/api/stream/' + d.newId;
  vp.currentTime = t;
  return true;
}

// ─── Actor Input Panel ───
function toggleActorInput() {
  const panel = document.getElementById('pActorInput');
  if (panel.style.display === 'none') {
    panel.style.display = '';
    document.getElementById('pActorAddBtn').classList.add('on');
    const inp = document.getElementById('pActorInputVal');
    inp.value = '';
    inp.focus();
  } else {
    closeActorInput();
  }
}

function closeActorInput() {
  document.getElementById('pActorInput').style.display = 'none';
  document.getElementById('pActorAddBtn').classList.remove('on');
}

async function submitActorInput() {
  const name = document.getElementById('pActorInputVal').value.trim();
  closeActorInput();
  if (!name || !curV || curV.isVault || curV.external) return;
  const newName = name + ' ' + curV.name;
  const ok = await applyVideoRename(newName);
  if (!ok) return;
  const d = await (await fetch('/api/videos/' + curV.id)).json();
  const actorsEl = document.getElementById('pActors');
  if (d.actors && d.actors.length) {
    actorsEl.innerHTML = d.actors.map(a =>
      '<button class="p-actor-tag" onclick="openActorFromVideo(\'' + escA(a) + '\')">' +
      '<img class="p-actor-ph" src="/api/actor-photos/' + encodeURIComponent(a) + '/img" alt="" onerror="this.style.display=\'none\'">' +
      esc(a) + '</button>'
    ).join('');
  }
}
