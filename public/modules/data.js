// ─── Data Fetching ───
async function load() {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (cat) p.set('category', cat);
  p.set('sort', sort);
  V = await (await fetch('/api/videos?' + p)).json();
  if (shuf) V.sort(() => Math.random() - 0.5);
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
  refresh();
}

async function refresh() {
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
  await Promise.all([load(), loadC(), loadTagSidebar()]);
  render();
}
