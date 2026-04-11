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
  if (recentMode) {
    recentMode = false;
    recentVids = [];
    $('recentSB').remove('on');
    $('bv').remove('off');
  }
  if (vaultMode) {
    $('vaultV').remove('on');
    $('vaultSB').remove('on');
    $('bv').remove('off');
    vaultMode = false;
  }
  if (studioMode) {
    $('sv').remove('on');
    $('sdv').remove('on');
    $('studioSB').remove('on');
    $('bv').remove('off');
    studioMode = false;
    curStudio = null;
  }
  if (actorMode) {
    $('av').remove('on');
    $('adv').remove('on');
    $('actorSB').remove('on');
    $('bv').remove('off');
    actorMode = false;
    curActor = null;
  }
  if (curTag) {
    $('tagDV').remove('on');
    document.querySelectorAll('#tagList .ci').forEach(el => el.classList.remove('on'));
    $('bv').remove('off');
    curTag = null;
  }
  await load();
  await loadC();
  await loadTagSidebar();
  render();
}
