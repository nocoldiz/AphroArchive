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
    document.getElementById('recentSB').classList.remove('on');
    document.getElementById('bv').classList.remove('off');
  }
  if (vaultMode) {
    document.getElementById('vaultV').classList.remove('on');
    document.getElementById('vaultSB').classList.remove('on');
    document.getElementById('bv').classList.remove('off');
    vaultMode = false;
  }
  if (studioMode) {
    document.getElementById('sv').classList.remove('on');
    document.getElementById('sdv').classList.remove('on');
    document.getElementById('studioSB').classList.remove('on');
    document.getElementById('bv').classList.remove('off');
    studioMode = false;
    curStudio = null;
  }
  if (actorMode) {
    document.getElementById('av').classList.remove('on');
    document.getElementById('adv').classList.remove('on');
    document.getElementById('actorSB').classList.remove('on');
    document.getElementById('bv').classList.remove('off');
    actorMode = false;
    curActor = null;
  }
  if (curTag) {
    document.getElementById('tagDV').classList.remove('on');
    document.querySelectorAll('#tagList .ci').forEach(el => el.classList.remove('on'));
    document.getElementById('bv').classList.remove('off');
    curTag = null;
  }
  await load();
  await loadC();
  await loadTagSidebar();
  render();
}
