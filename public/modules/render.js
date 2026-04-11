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
  const folderCats = cats.filter(c => !c.isTag);
  const bmTotal = srcFilter !== 'local' ? _bfItems.filter(it => !bmMatchedUrls.has(it.url)).length : 0;
  const all = folderCats.reduce((s, c) => s + c.count, 0) + bmTotal;
  const dropAttrs = ' ondragover="catDragOver(event,this)" ondragleave="catDragLeave(this)" ondrop="catDrop(event,\'\')"';
  let h = '<div class="sidebar-item' + (cat ? '' : ' on') + '" onclick="selCat(\'\')"' + dropAttrs + '><span>All Videos</span><span class="count-badge">' + all + '</span></div>';
  cats.forEach(c => {
    const bmC = bmCountFor(c.isTag ? c.name : c.path);
    const displayCount = c.count + bmC;
    if (c.isTag) {
      h += '<div class="sidebar-item' + (curTag === c.name ? ' on' : '') + '" onclick="openTag(\'' + escA(c.name) + '\')">' +
        '<span>' + esc(c.name) + '</span>' +
        '<span class="count-badge">' + displayCount + '</span></div>';
    } else {
      const da = ' ondragover="catDragOver(event,this)" ondragleave="catDragLeave(this)" ondrop="catDrop(event,\'' + escA(c.path) + '\')"';
      h += '<div class="sidebar-item' + (cat === c.path ? ' on' : '') + '" onclick="selCat(\'' + escA(c.path) + '\')"' + da + '><span>' + esc(c.name) + '</span><span class="count-badge">' + displayCount + '</span></div>';
    }
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
  if (!vid || vid.external) { toast('Cannot move videos from external folders'); return; }
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
  if (!local.length && !bms.length) {
    g.innerHTML = '';
    e.style.display = 'block';
    $('empty-title').text(q ? 'No results' : recentMode ? 'No history yet' : favM ? 'No favourites yet' : 'No videos found');
    $('empty-desc').text(q ? 'Nothing matched "' + q + '"' : recentMode ? 'Videos you watch will appear here' : favM ? 'Star videos to save them here' : 'Add videos to your folder');
    return;
  }
  e.style.display = 'none';
  g.innerHTML = local.map(card).join('') + bms.map(bmCard).join('');
  attachThumbs();
  attachBmThumbs();
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
  return tpl('video-card', {
    id:       v.id,
    color,
    dragAttr: v.external ? '' : ` draggable="true" ondragstart="dragVideoStart(event,'${v.id}')"`,
    ext:      v.ext.replace('.', ''),
    duration: v.durationF ? `<span class="duration-badge">${v.durationF}</span>` : '',
    sizeF:    v.sizeF,
    rating:   v.rating ? `<div class="rating-badge"><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>${v.rating}</div>` : '',
    nameA:    escA(v.name),
    name:     esc(v.name),
    category: esc(v.category),
    starBtn:  `<button class="${v.fav ? 'st' : ''}" onclick="event.preventDefault();event.stopPropagation();togStar('${v.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="${v.fav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></button>`,
    renBtn:   v.external ? '' : `<button onclick="event.preventDefault();event.stopPropagation();openRen('${v.id}','${escA(v.name)}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>`,
    moveBtn:  v.external ? '' : `<button onclick="event.preventDefault();event.stopPropagation();openMov('${v.id}','${escA(v.name)}','${escA(v.catPath || '')}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button>`,
    tagBtn:   v.external ? '' : `<button onclick="event.preventDefault();event.stopPropagation();openVidTag('${v.id}')" title="Edit tags"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></button>`,
  });
}

// ─── Bookmark Card ───
function bmNorm(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

function getBmList() {
  if (!_bfItems.length) return [];
  let items = _bfItems.filter(it => !bmMatchedUrls.has(it.url));
  if (cat) { const cn = bmNorm(cat); items = items.filter(it => bmNorm(it.title).includes(cn)); }
  if (curTag) { const tn = bmNorm(curTag); items = items.filter(it => bmNorm(it.title).includes(tn)); }
  if (q) { const ql = q.toLowerCase(); items = items.filter(it => it.title.toLowerCase().includes(ql) || it.url.toLowerCase().includes(ql)); }
  return items;
}

function bmCard(item) {
  let hostname = '';
  try { hostname = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const encUrl = escA(item.url);
  const hasCached = !!item.img;
  return tpl('bookmark-card', {
    url:        encUrl,
    ctClass:    'card-thumb bookmark-thumb' + (hasCached ? ' has-thumb' : ''),
    needsObs:   hasCached ? '' : ` data-bm-url="${encUrl}"`,
    thumbStyle: hasCached ? `background:url(${escA(item.img)}) center/cover no-repeat` : 'background:linear-gradient(135deg,#3b82f612 0%,#06b6d406 100%)',
    urlBadge:   hasCached ? '' : '<span class="ext-badge" style="background:rgba(59,130,246,.18);color:#3b82f6">URL</span>',
    title:      esc(item.title),
    hostname:   esc(hostname),
  });
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
