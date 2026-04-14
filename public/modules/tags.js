// ─── Tag Suggestions Cache ───
let _tagSuggestions = null;

async function getTagSuggestions() {
  if (_tagSuggestions) return _tagSuggestions;
  try {
    _tagSuggestions = await (await fetch('/api/tag-suggestions')).json();
  } catch { _tagSuggestions = []; }
  return _tagSuggestions;
}

// ─── Shared Tag Modal ───
let _tmVidId   = null;
let _tmBmUrl   = null;
let _tmTags    = [];
let _tmQuery   = '';

async function openTagModal(vidId) {
  _tmVidId = vidId; _tmBmUrl = null;
  _tmQuery  = '';
  try {
    const d = await (await fetch('/api/videos/' + vidId + '/tags')).json();
    _tmTags = d.tags || [];
  } catch { _tmTags = []; }
  await getTagSuggestions();
  _renderTagModal();
  $('tag-modal').add('on');
  const inp = $('tag-modal-input').el;
  if (inp) { inp.value = ''; inp.focus(); }
}

async function openBmTagModal(url) {
  _tmBmUrl = url; _tmVidId = null;
  _tmQuery = '';
  const item = _bfItems.find(it => it.url === url);
  _tmTags = item ? [...(item.tags || [])] : [];
  await getTagSuggestions();
  _renderTagModal();
  $('tag-modal').add('on');
  const inp = $('tag-modal-input').el;
  if (inp) { inp.value = ''; inp.focus(); }
}

function closeTagModal() {
  $('tag-modal').remove('on');
  _tmVidId = null; _tmBmUrl = null;
  _tmTags  = [];
  _tmQuery = '';
}

function _renderTagModal() {
  const tagsEl = $('tag-modal-tags').el;
  tagsEl.innerHTML = _tmTags.map(t =>
    '<span class="p-tag">' + esc(t) +
    '<button class="p-tag-rm" onclick="removeTagModal(\'' + escA(t) + '\')" title="Remove">' +
    '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg></button></span>'
  ).join('');
  _filterTagModal(_tmQuery);
}

function _filterTagModal(q) {
  _tmQuery = q;
  const lo = q.trim().toLowerCase();
  const available = (_tagSuggestions || []).filter(t =>
    !_tmTags.some(x => x.toLowerCase() === t.toLowerCase()) &&
    (!lo || t.toLowerCase().includes(lo))
  );
  const list = $('tag-modal-list').el;
  list.innerHTML = available.slice(0, 60).map(t =>
    '<span class="p-tag-picker-item" onclick="addTagModal(\'' + escA(t) + '\')">' + esc(t) + '</span>'
  ).join('') || (lo ? '<span class="p-tag-picker-empty">Press Enter to add "' + esc(q.trim()) + '"</span>' : '');
}

async function addTagModal(tag) {
  if (!_tmVidId) return;
  tag = tag.trim();
  if (!tag || _tmTags.some(t => t.toLowerCase() === tag.toLowerCase())) return;
  _tmTags = [..._tmTags, tag];
  await _saveTagModal();
  _renderTagModal();
  $('tag-modal-input').val('');
  _filterTagModal('');
}

async function removeTagModal(tag) {
  if (!_tmVidId) return;
  _tmTags = _tmTags.filter(t => t.toLowerCase() !== tag.toLowerCase());
  await _saveTagModal();
  _renderTagModal();
}

async function _saveTagModal() {
  if (_tmBmUrl) {
    const item = _bfItems.find(it => it.url === _tmBmUrl);
    if (item) { item.tags = [..._tmTags]; bfSaveCache(); }
    return;
  }
  const r = await fetch('/api/videos/' + _tmVidId + '/meta', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags: _tmTags }),
  });
  if (!r.ok) { toast('Failed to save tags'); return; }
  if (curV && curV.id === _tmVidId) {
    curVTags = _tmTags;
    renderVideoTags();
  }
}

function onTagModalInput(val) {
  _filterTagModal(val);
}

function onTagModalKeydown(e) {
  if (e.key === 'Enter') {
    const q = $('tag-modal-input').el.value.trim();
    if (q) addTagModal(q);
  } else if (e.key === 'Escape') {
    closeTagModal();
  }
}

// ─── Tag Detail View (sidebar navigation) ───
async function openTag(name) {
  if (dualMode && dualActive === 'right') { await dualOpenTag(name); return; }
  if (location.pathname !== '/tag/' + encodeURIComponent(name)) history.pushState(null, '', '/tag/' + encodeURIComponent(name));
  closeAllViews();
  curTag = name;
  $('browse-view').add('off');
  $('tag-detail-view').add('on');
  q = ''; $('search-input').val(''); $('search-ghost').html('');
  $('tag-name').text(name);
  renCats();
  loadTagSidebar();

  const terms = _dbTagTerms[name];
  if (_allVideos.length && terms && terms.length) {
    // Fast path — filter in memory, no network request
    const localVids = srcFilter === 'remote' ? [] : filterVideosByTag(terms);
    const bms = srcFilter !== 'local' ? getBmList() : [];
    const g = $('tag-grid').el;
    const isRerender = g.childElementCount > 0 && !g.querySelector('.skeleton');
    g.innerHTML = localVids.map(card).join('') + bms.map(bmCard).join('');
    if (isRerender) g.querySelectorAll('.video-card.fade-in').forEach(el => el.classList.remove('fade-in'));
    attachThumbs();
    attachBmThumbs();
    return;
  }

  // Slow path — fetch from server (first visit or cache miss)
  $('tag-grid').html(Array(8).fill(tpl('skeleton')).join(''));
  const d = await (await fetch('/api/db-tags/' + encodeURIComponent(name))).json();
  if (d.error) { $('tag-grid').html(tpl('empty-state', { title: esc(d.error) })); return; }
  let localVids = srcFilter === 'remote' ? [] : d.videos;
  if (shuf) {
    localVids = localVids.slice().sort(() => Math.random() - 0.5);
  } else if (sort === 'name') {
    localVids = localVids.slice().sort((a, b) => a.name.localeCompare(b.name));
  } else if (sort === 'size') {
    localVids = localVids.slice().sort((a, b) => b.size - a.size);
  } else if (sort === 'duration') {
    localVids = localVids.slice().sort((a, b) => (b.duration || 0) - (a.duration || 0));
  }
  const bms = srcFilter !== 'local' ? getBmList() : [];
  const g2 = $('tag-grid').el;
  g2.innerHTML = localVids.map(card).join('') + bms.map(bmCard).join('');
  // Skeletons were showing before — this is the first real render, keep fade-in
  attachThumbs();
  attachBmThumbs();
}

function closeTag() {
  $('tag-detail-view').remove('on');
  $('browse-view').remove('off');
  curTag = null;
  renCats();
  loadTagSidebar();
}

async function loadTagSidebar() {
  let tags = [];
  try { tags = await (await fetch('/api/db-tags')).json(); } catch {}
  const listEl   = $('tagList').el;
  const sepEl    = document.getElementById('tags-sep');
  const headEl   = document.getElementById('sh3-tags');
  if (!tags.length) {
    listEl.innerHTML = '';
    sepEl.style.display = 'none';
    headEl.style.display = 'none';
    return;
  }
  sepEl.style.display = '';
  headEl.style.display = '';
  _dbTagTerms = {};
  tags.forEach(t => { _dbTagTerms[t.displayName] = t.terms || [t.displayName]; });
  listEl.innerHTML = tags.map(t =>
    '<div class="sidebar-item' + (curTag === t.displayName ? ' on' : '') + '" data-tag="' + escA(t.displayName) + '" onclick="openTag(\'' + escA(t.displayName) + '\')">' +
    '<span>' + esc(t.displayName) + '</span><span class="count-badge">' + t.count + '</span></div>'
  ).join('');
}
