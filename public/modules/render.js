// ─── Staggered fade-in for card grids ───
function _staggerFadeIn(container) {
  const cards = container.querySelectorAll('.video-card, .bm-card');
  cards.forEach((el, i) => {
    el.classList.add('fade-in');
    el.style.animationDelay = Math.min(i * 35, 420) + 'ms';
  });
}

// ─── Skeleton ───
function showSk() {
  $('video-grid').html(Array(8).fill(tpl('skeleton')).join(''));
}

// ─── Sidebar Categories ───
function bmCountFor(key) {
  if (!_bfItems.length || srcFilter === 'local') return 0;
  const kn = bmNorm(key);
  return _bfItems.filter(it => !bmMatchedUrls.has(it.url) && bmNorm(it.title).includes(kn)).length;
}

function renCats() {
  const el = $('cList').el;
  const bmTotal = srcFilter !== 'local' ? _bfItems.filter(it => !bmMatchedUrls.has(it.url)).length : 0;
  const all = cats.reduce((s, c) => s + c.count, 0) + bmTotal;
  const dropAttrs = ' ondragover="catDragOver(event,this)" ondragleave="catDragLeave(this)" ondrop="catDrop(event,\'\')"';
  // In dual-right mode, highlight the right pane's active category
  const activeCat = (dualMode && dualActive === 'right') ? dualR.cat : cat;
  let h = '<div class="sidebar-item' + (activeCat ? '' : ' on') + '" onclick="selCat(\'\')"' + dropAttrs + '><span>All Videos</span><span class="count-badge">' + all + '</span></div>';
  cats.forEach(c => {
    const bmC = bmCountFor(c.path);
    const displayCount = c.count + bmC;
    const da = ' ondragover="catDragOver(event,this)" ondragleave="catDragLeave(this)" ondrop="catDrop(event,\'' + escA(c.path) + '\')"';
    h += '<div class="sidebar-item' + (activeCat === c.path ? ' on' : '') + '" onclick="selCat(\'' + escA(c.path) + '\')"' + da + '><span>' + esc(c.name) + '</span><span class="count-badge">' + displayCount + '</span></div>';
  });
  el.innerHTML = h;
}

// ─── Drag helpers ───
function catDragOver(e, el) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  el.classList.add('drop-over');
}
function catDragLeave(el) { el.classList.remove('drop-over'); }
function catDrop(e, catPath) {
  e.preventDefault();
  e.currentTarget.classList.remove('drop-over');
  const id = e.dataTransfer.getData('text/plain');
  if (!id) return;
  const vid = V.find(v => v.id === id);
  if (!vid) return;
  if ((vid.catPath || '') === catPath) return;
  dropMoveVideo(id, catPath);
}
function dragVideoStart(e, id) {
  e.dataTransfer.setData('text/plain', id);
  e.dataTransfer.effectAllowed = 'move';
}

// ─── Main Grid ───
function render() {
  const g = $('video-grid').el, e = $('empty-placeholder').el;
  let base = recentMode ? recentVids : favM ? V.filter(v => v.fav) : V;
  const local = srcFilter === 'remote' ? [] : base;
  const bms   = (!recentMode && !favM && srcFilter !== 'local') ? getBmList() : [];
  const countEl = document.getElementById('result-count');
  const total = local.length + bms.length;
  if (countEl) {
    const filtered = q || favM || recentMode || (cat && cat !== '');
    countEl.textContent = filtered ? total + ' result' + (total !== 1 ? 's' : '') : '';
  }
  if (!local.length && !bms.length) {
    g.innerHTML = '';
    e.style.display = 'block';
    $('empty-title').text(q ? 'No video results' : recentMode ? 'No history yet' : favM ? 'No favourites yet' : 'No videos found');
    $('empty-desc').text(q ? 'Nothing matched "' + q + '" in videos' : recentMode ? 'Videos you watch will appear here' : favM ? 'Star videos to save them here' : 'Add videos to your folder');
    renderSearchExtras(q);
    return;
  }
  e.style.display = 'none';
  g.innerHTML = local.map(card).join('') + bms.map(bmCard).join('');
  _staggerFadeIn(g);
  attachThumbs();
  attachBmThumbs();
  renderSearchExtras(q);
}

// ─── Cross-media search results (photos / audio / books) ───
let _searchExtrasQuery = null;

function _hideSearchExtras() {
  ['photos', 'audio', 'books'].forEach(t => {
    const el = document.getElementById('search-extra-' + t);
    if (el) el.style.display = 'none';
  });
}

function renderSearchExtras(query) {
  if (!query) { _searchExtrasQuery = null; _hideSearchExtras(); return; }
  if (query === _searchExtrasQuery) return; // already rendered for this query
  _searchExtrasQuery = query;
  const ql = query.toLowerCase();

  Promise.all([
    fetch('/api/photos').then(r => r.json()).catch(() => []),
    fetch('/api/audio').then(r => r.json()).catch(() => []),
    fetch('/api/books').then(r => r.json()).catch(() => []),
  ]).then(([photos, audio, books]) => {
    if (_searchExtrasQuery !== query) return; // query changed while fetching

    const mPhotos = photos.filter(p => p.filename.toLowerCase().includes(ql));
    const mAudio  = audio.filter(a => (a.title || '').toLowerCase().includes(ql));
    const mBooks  = books.filter(b => (b.title || b.filename || '').toLowerCase().includes(ql));

    // Photos
    const phSec  = document.getElementById('search-extra-photos');
    const phGrid = document.getElementById('search-extra-photos-grid');
    if (phSec && phGrid) {
      if (mPhotos.length) {
        phGrid.innerHTML = mPhotos.map(p =>
          '<div class="ph-card" onclick="window.open(\'/api/photos/' + p.id + '/img\',\'_blank\')">' +
          '<img class="ph-thumb" src="/api/photos/' + p.id + '/img" alt="' + escA(p.filename) + '" loading="lazy">' +
          '<div class="ph-overlay"><span class="ph-name">' + esc(p.filename) + '</span></div>' +
          '</div>'
        ).join('');
        phSec.style.display = '';
      } else {
        phSec.style.display = 'none';
      }
    }

    // Audio
    const auSec  = document.getElementById('search-extra-audio');
    const auGrid = document.getElementById('search-extra-audio-grid');
    if (auSec && auGrid) {
      if (mAudio.length) {
        auGrid.innerHTML = mAudio.map(f =>
          '<div class="au-card' + (curAudio === f.id ? ' playing' : '') + '" onclick="playAudio(\'' + escA(f.id) + '\')">' +
          '<div class="au-card-icon">' + _auIcon() + '</div>' +
          '<div class="au-card-info">' +
          '<div class="au-card-title" title="' + escA(f.title) + '">' + esc(f.title) + '</div>' +
          '<div class="au-card-meta"><span class="au-badge">' + esc(f.ext.replace('.', '').toUpperCase()) + '</span><span>' + esc(f.sizeF) + '</span></div>' +
          '</div></div>'
        ).join('');
        auSec.style.display = '';
      } else {
        auSec.style.display = 'none';
      }
    }

    // Books
    const bkSec  = document.getElementById('search-extra-books');
    const bkGrid = document.getElementById('search-extra-books-grid');
    if (bkSec && bkGrid) {
      if (mBooks.length) {
        bkGrid.innerHTML = mBooks.map(b =>
          '<div class="bk-card" onclick="openBook(\'' + escA(b.id) + '\')">' +
          '<div class="bk-icon">' + bookTypeIcon(b.ext) + '</div>' +
          '<div class="bk-info">' +
          '<div class="bk-title">' + esc(b.title || b.filename) + '</div>' +
          '<div class="bk-meta">' + bookTypeBadge(b.type, b.ext) + '<span>' + esc(b.sizeF || '') + '</span></div>' +
          '</div></div>'
        ).join('');
        bkSec.style.display = '';
      } else {
        bkSec.style.display = 'none';
      }
    }
  });
}

function setSrcFilter(val) {
  srcFilter = val;
  document.querySelectorAll('.src-btn').forEach(b => b.classList.toggle('on', b.dataset.src === val));
  if (curTag) { openTag(curTag); return; }
  render();
}

// ─── Video Card ───
function card(v) {
  const cols = ['#e84040', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];
  const color = cols[Math.abs(hsh(v.category)) % cols.length];
  const cached = thumbMap[v.id];
  const hasThumb = cached && cached.length;
  const thumbClass = hasThumb ? 'card-thumb has-thumb' : 'card-thumb';
  const thumbStyle = hasThumb
    ? `background:url(${cached[0]}) center/cover no-repeat`
    : `background:linear-gradient(135deg,${color}12 0%,${color}06 100%)`;
  return tpl('video-card', {
    id:         v.id,
    thumbClass,
    thumbStyle,
    dragAttr:   ` draggable="true" ondragstart="dragVideoStart(event,'${v.id}')"`,
    ext:        v.ext.replace('.', ''),
    duration:   v.durationF ? `<span class="duration-badge">${v.durationF}</span>` : '',
    sizeF:      v.sizeF,
    rating:     v.rating ? `<div class="rating-badge"><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>${v.rating}</div>` : '',
    nameA:      escA(v.name),
    name:       esc(v.name),
    category:   esc(v.category),
    starBtn:    `<button class="${v.fav ? 'st' : ''}" onclick="event.preventDefault();event.stopPropagation();togStar('${v.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="${v.fav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></button>`,
    renBtn:     `<button onclick="event.preventDefault();event.stopPropagation();openRen('${v.id}','${escA(v.name)}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>`,
    moveBtn:    `<button onclick="event.preventDefault();event.stopPropagation();openMov('${v.id}','${escA(v.name)}','${escA(v.catPath || '')}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button>`,
    tagBtn:     `<button onclick="event.preventDefault();event.stopPropagation();openTagModal('${v.id}')" title="Edit tags"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></button>`,
    actorBtn:   `<button onclick="event.preventDefault();event.stopPropagation();openActorModalForCard('${v.id}')" title="Tag actors"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg></button>`,
    studioBtn:  `<button onclick="event.preventDefault();event.stopPropagation();openStudioModalForCard('${v.id}')" title="Tag studio"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-4 0v2M8 7V5a2 2 0 0 0-4 0v2"/></svg></button>`,
    plBtn:      `<button class="pl-card-btn${playlistSkipped.has(v.id) ? ' pl-off' : ''}" onclick="event.preventDefault();event.stopPropagation();toggleCardPlaylist('${v.id}',this)" title="${playlistSkipped.has(v.id) ? 'Add to playlist' : 'Remove from playlist'}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><polyline points="3 6 4 7 6 5"/><polyline points="3 12 4 13 6 11"/><polyline points="3 18 4 19 6 17"/></svg></button>`,
    descBtn:    `<button onclick="event.preventDefault();event.stopPropagation();describeVideoThumb('${v.id}')" title="Describe thumbnail with AI"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>`,
  });
}

// ─── Bookmark Card ───
function bmNorm(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

function getBmList() {
  if (!_bfItems.length) return [];
  let items = _bfItems.filter(it => !bmMatchedUrls.has(it.url));
  if (cat) {
    items = items.filter(it => {
      if (it.category && it.category === cat) return true;
      return bmNorm(it.title).includes(bmNorm(cat));
    });
  }
  if (curTag) {
    const tn = bmNorm(curTag);
    items = items.filter(it =>
      (it.tags || []).some(t => bmNorm(t).includes(tn)) || bmNorm(it.title).includes(tn)
    );
  }
  if (q) { const ql = q.toLowerCase(); items = items.filter(it => it.title.toLowerCase().includes(ql) || it.url.toLowerCase().includes(ql)); }
  return items;
}

function bmCard(item) {
  let hostname = '';
  try { hostname = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const encUrl = escA(item.url);
  const hasCached = !!item.img;
  const u = escA(item.url);
  return tpl('bookmark-card', {
    url:        encUrl,
    ctClass:    'card-thumb bookmark-thumb' + (hasCached ? ' has-thumb' : ''),
    needsObs:   hasCached ? '' : ` data-bm-url="${encUrl}"`,
    thumbStyle: hasCached ? `background:url(${escA(item.img)}) center/cover no-repeat` : 'background:linear-gradient(135deg,#3b82f612 0%,#06b6d406 100%)',
    urlBadge:   hasCached ? '' : '<span class="ext-badge" style="background:rgba(59,130,246,.18);color:#3b82f6">URL</span>',
    title:      esc(item.title),
    hostname:   esc(hostname),
    starBtn:    `<button class="bm-star-btn${item.fav ? ' st' : ''}" onclick="event.preventDefault();event.stopPropagation();togBmStar('${u}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="${item.fav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></button>`,
    renBtn:     `<button onclick="event.preventDefault();event.stopPropagation();openBmRen('${u}','${escA(item.title)}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>`,
    moveBtn:    `<button onclick="event.preventDefault();event.stopPropagation();openBmMov('${u}','${escA(item.title)}','${escA(item.category||'')}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button>`,
    tagBtn:     `<button onclick="event.preventDefault();event.stopPropagation();openBmTagModal('${u}')" title="Edit tags"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></button>`,
  });
}

// ─── Bookmark action helpers ───

function togBmStar(url) {
  const item = _bfItems.find(it => it.url === url);
  if (!item) return;
  item.fav = !item.fav;
  bfSaveCache();
  document.querySelectorAll('.bookmark-card').forEach(el => {
    if (el.dataset.bmUrl !== url) return;
    const btn = el.querySelector('.bm-star-btn');
    if (!btn) return;
    btn.classList.toggle('st', !!item.fav);
    btn.querySelector('svg').setAttribute('fill', item.fav ? 'currentColor' : 'none');
  });
  toast(item.fav ? '\u2605 Added to favourites' : 'Removed from favourites');
}

function bmRemove(url) {
  _bfItems = _bfItems.filter(it => it.url !== url);
  bmMatchedUrls.delete(url);
  bfSaveCache();
  document.querySelectorAll('.bookmark-card').forEach(el => { if (el.dataset.bmUrl === url) el.remove(); });
}

// ─── Bookmark Thumbnail Observer ───
function initBmThumbObs() {
  if (bmThumbObs) return;
  bmThumbObs = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      bmThumbObs.unobserve(e.target);
      loadBmThumb(e.target);
    }
  }, { rootMargin: '300px' });
}

async function loadBmThumb(el) {
  const url = el.dataset.bmUrl;
  if (!url) return;
  try {
    const d = await (await fetch('/api/og-thumb?url=' + encodeURIComponent(url))).json();
    if (d.img) {
      applyThumb(el, d.img);
      const item = _bfItems.find(it => it.url === url);
      if (item && item.img !== d.img) { item.img = d.img; bfSaveCache(); }
    }
  } catch {}
}

function attachBmThumbs() {
  initBmThumbObs();
  document.querySelectorAll('.bookmark-thumb[data-bm-url]').forEach(el => bmThumbObs.observe(el));
}
