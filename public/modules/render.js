// ─── Skeleton ───
function showSk() {
  document.getElementById('vG').innerHTML = Array(8).fill('<div class="sk skc"></div>').join('');
}

// ─── Sidebar Categories ───
function bmCountFor(key) {
  if (!_bfItems.length || srcFilter === 'local') return 0;
  const kn = bmNorm(key);
  return _bfItems.filter(it => !bmMatchedUrls.has(it.url) && bmNorm(it.title).includes(kn)).length;
}

function renCats() {
  const el = document.getElementById('cList');
  const folderCats = cats.filter(c => !c.isTag);
  const bmTotal = srcFilter !== 'local' ? _bfItems.filter(it => !bmMatchedUrls.has(it.url)).length : 0;
  const all = folderCats.reduce((s, c) => s + c.count, 0) + bmTotal;
  const dropAttrs = ' ondragover="catDragOver(event,this)" ondragleave="catDragLeave(this)" ondrop="catDrop(event,\'\')"';
  let h = '<div class="ci' + (cat ? '' : ' on') + '" onclick="selCat(\'\')"' + dropAttrs + '><span>All Videos</span><span class="n">' + all + '</span></div>';
  cats.forEach(c => {
    const bmC = bmCountFor(c.isTag ? c.name : c.path);
    const displayCount = c.count + bmC;
    if (c.isTag) {
      h += '<div class="ci' + (curTag === c.name ? ' on' : '') + '" onclick="openTag(\'' + escA(c.name) + '\')">' +
        '<span>' + esc(c.name) + '</span>' +
        '<span class="n">' + displayCount + '</span></div>';
    } else {
      const da = ' ondragover="catDragOver(event,this)" ondragleave="catDragLeave(this)" ondrop="catDrop(event,\'' + escA(c.path) + '\')"';
      h += '<div class="ci' + (cat === c.path ? ' on' : '') + '" onclick="selCat(\'' + escA(c.path) + '\')"' + da + '><span>' + esc(c.name) + '</span><span class="n">' + displayCount + '</span></div>';
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
  const g = document.getElementById('vG'), e = document.getElementById('emp');
  let base = recentMode ? recentVids : favM ? V.filter(v => v.fav) : V;
  const local = srcFilter === 'remote' ? [] : base;
  const bms   = (!recentMode && !favM && srcFilter !== 'local') ? getBmList() : [];
  if (!local.length && !bms.length) {
    g.innerHTML = '';
    e.style.display = 'block';
    document.getElementById('eT').textContent = q ? 'No results' : recentMode ? 'No history yet' : favM ? 'No favourites yet' : 'No videos found';
    document.getElementById('eD').textContent = q ? 'Nothing matched "' + q + '"' : recentMode ? 'Videos you watch will appear here' : favM ? 'Star videos to save them here' : 'Add videos to your folder';
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
  const c = cols[Math.abs(hsh(v.category)) % cols.length];
  const dragAttr = !v.external ? ' draggable="true" ondragstart="dragVideoStart(event,\'' + v.id + '\')"' : '';
  return '<a class="vc fi" href="/video/' + v.id + '" onclick="event.preventDefault();openVid(\'' + v.id + '\')"' + dragAttr + '>' +
    '<div class="ct" data-vid="' + v.id + '" style="background:linear-gradient(135deg,' + c + '12 0%,' + c + '06 100%)">' +
    '<span class="eb">' + v.ext.replace('.', '') + '</span>' +
    '<div class="po"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></div>' +
    (v.durationF ? '<span class="durb">' + v.durationF + '</span>' : '') +
    '<span class="szb">' + v.sizeF + '</span>' +
    (v.rating ? '<div class="vr-badge"><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' + v.rating + '</div>' : '') +
    '</div>' +
    '<div class="cb"><div class="ctit" title="' + escA(v.name) + '">' + esc(v.name) + '</div>' +
    '<div class="cm"><span class="ccat">' + esc(v.category) + '</span>' +
    '<div class="ca">' +
    '<button class="' + (v.fav ? 'st' : '') + '" onclick="event.preventDefault();event.stopPropagation();togStar(\'' + v.id + '\')"><svg width="14" height="14" viewBox="0 0 24 24" fill="' + (v.fav ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></button>' +
    (!v.external ? '<button onclick="event.preventDefault();event.stopPropagation();openRen(\'' + v.id + '\',\'' + escA(v.name) + '\')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>' +
    '<button onclick="event.preventDefault();event.stopPropagation();openMov(\'' + v.id + '\',\'' + escA(v.name) + '\',\'' + escA(v.catPath || '') + '\')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button>' +
    '<button onclick="event.preventDefault();event.stopPropagation();openVidTag(\'' + v.id + '\')" title="Edit tags"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></button>' : '') +
    '</div></div></div></a>';
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
  const thumbStyle = hasCached
    ? 'background:url(' + escA(item.img) + ') center/cover no-repeat'
    : 'background:linear-gradient(135deg,#3b82f612 0%,#06b6d406 100%)';
  const ctClass = 'ct bm-ct' + (hasCached ? ' has-thumb' : '');
  const needsObs = hasCached ? '' : ' data-bm-url="' + encUrl + '"';
  return '<a class="vc fi bm-card" href="' + encUrl + '" target="_blank" rel="noopener" data-bm-url="' + encUrl + '">' +
    '<div class="' + ctClass + '"' + needsObs + ' style="' + thumbStyle + '">' +
    (hasCached ? '' : '<span class="eb" style="background:rgba(59,130,246,.18);color:#3b82f6">URL</span>') +
    '<div class="po" style="opacity:.55"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></div>' +
    '</div>' +
    '<div class="cb"><div class="ctit" title="' + encUrl + '">' + esc(item.title) + '</div>' +
    '<div class="cm"><span class="ccat">' + esc(hostname) + '</span>' +
    '<div class="ca"><button onclick="event.preventDefault();event.stopPropagation();bmRemove(\'' + encUrl + '\')" title="Remove bookmark"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>' +
    '</div></div></a>';
}

function bmRemove(url) {
  _bfItems = _bfItems.filter(it => it.url !== url);
  bmMatchedUrls.delete(url);
  bfSaveCache();
  document.querySelectorAll('.bm-card').forEach(el => { if (el.dataset.bmUrl === url) el.remove(); });
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
  document.querySelectorAll('.bm-ct[data-bm-url]').forEach(el => bmThumbObs.observe(el));
}
