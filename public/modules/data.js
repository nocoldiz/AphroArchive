// ─── Data Fetching ───
async function load() {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (cat) p.set('category', cat);
  if (favFilter) p.set('fav', '1');
  p.set('sort', sort);
  V = await (await fetch('/api/videos?' + p)).json();
  V = _applySort(V);
  if (!q && !cat) _allVideos = V; // cache for local filtering
}

// ─── Local filtering helpers (avoids a round-trip for category/tag switches) ───

function _wordMatch(name, term) {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('\\b' + esc + '\\b', 'i').test(name);
}

function _applySort(list) {
  const out = list.slice();
  if (shuf) return out.sort(() => Math.random() - 0.5);
  if (sort === 'name')     return out.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'size')     return out.sort((a, b) => b.size - a.size);
  if (sort === 'duration') return out.sort((a, b) => (b.duration || 0) - (a.duration || 0));
  return out.sort((a, b) => b.mtime - a.mtime);
}

function filterVideosCat(catFilter) {
  if (!catFilter) return _applySort(favFilter ? _allVideos.filter(v => v.fav) : _allVideos);
  return _applySort(_allVideos.filter(v => {
    if (favFilter && !v.fav) return false;
    if (catFilter === '__uncategorized__' || catFilter === '') return v.catPath === '';
    const vp = v.catPath.toLowerCase().replace(/\\/g, '/');
    const cl = catFilter.toLowerCase().replace(/\\/g, '/');
    return vp === cl || vp.startsWith(cl + '/') || v.category === catFilter;
  }));
}

function filterVideosByTag(terms) {
  const termsLo = terms.map(t => t.toLowerCase());
  return _applySort(_allVideos.filter(v => {
    if (favFilter && !v.fav) return false;
    const vTagsLo = (v.tags || []).map(t => t.toLowerCase());
    return vTagsLo.some(t => termsLo.includes(t)) || terms.some(t => _wordMatch(v.name, t));
  }));
}

async function loadC() {
  cats = await (await fetch('/api/categories')).json();
  renCats();
}

async function createCategory() {
  const name = prompt('New folder name:');
  if (!name || !name.trim()) return;
  const r = await fetch('/api/main-categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) });
  const d = await r.json();
  if (!r.ok) { toast(d.error || 'Failed'); return; }
  toast('Created folder: ' + d.name);
  await loadC();
  refresh(true);
}

async function refresh(full = false) {
  if (categoriesMode) {
    $('categories-view').remove('on');
    $('categories-view-sidebar').remove('on');
    $('browse-view').remove('off');
    categoriesMode = false;
  }
  if (recentMode) {
    recentMode = false;
    recentVids = [];
    $('recent-sidebar').remove('on');
    $('browse-view').remove('off');
  }
  if (vaultMode) {
    $('vault-view').remove('on');
    $('vault-sidebar').remove('on');
    $('browse-view').remove('off');
    vaultMode = false;
  }
  if (studioMode) {
    $('studios-view').remove('on');
    $('studio-detail-view').remove('on');
    $('studio-sidebar').remove('on');
    $('browse-view').remove('off');
    studioMode = false;
    curStudio = null;
  }
  if (actorMode) {
    $('actors-view').remove('on');
    $('actor-detail-view').remove('on');
    $('actor-sidebar').remove('on');
    $('browse-view').remove('off');
    actorMode = false;
    curActor = null;
  }
  if (curTag) {
    $('tag-detail-view').remove('on');
    document.querySelectorAll('#tagList .sidebar-item').forEach(el => el.classList.remove('on'));
    $('browse-view').remove('off');
    curTag = null;
  }
  const tasks = [load()];
  if (full) { tasks.push(loadC()); tasks.push(loadTagSidebar()); }
  await Promise.all(tasks);
  render();
}
