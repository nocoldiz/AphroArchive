// ─── Tags ───
async function loadTagSidebar() {
  const tags = await (await fetch('/api/tags')).json();
  const el = document.getElementById('tagList');
  if (!tags.length) { el.innerHTML = ''; return; }
  el.innerHTML = tags.map(t =>
    '<div class="ci' + (curTag === t.name ? ' on' : '') + '" data-tag="' + escA(t.name) + '" onclick="openTag(\'' + escA(t.name) + '\')">' +
    '<span>' + esc(t.name) + '</span>' +
    '<span class="n">' + t.count + '</span>' +
    '</div>'
  ).join('');
}

async function openTag(name) {
  if (location.pathname !== '/tag/' + encodeURIComponent(name)) history.pushState(null, '', '/tag/' + encodeURIComponent(name));
  closeAllViews();
  curTag = name;
  document.getElementById('bv').classList.add('off');
  document.getElementById('tagDV').classList.add('on');
  q = ''; document.getElementById('sI').value = ''; document.getElementById('sGhost').innerHTML = '';
  document.querySelectorAll('#tagList .ci').forEach(el => el.classList.toggle('on', el.dataset.tag === name));
  document.getElementById('tagName').textContent = name;
  document.getElementById('tagG').innerHTML = '<div class="dup-scan">Loading\u2026</div>';
  renCats();
  const d = await (await fetch('/api/tags/' + encodeURIComponent(name))).json();
  if (d.error) { document.getElementById('tagG').innerHTML = '<div class="es" style="padding:40px 20px"><h3>' + esc(d.error) + '</h3></div>'; return; }
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
  document.getElementById('tagG').innerHTML = localVids.map(card).join('') + bms.map(bmCard).join('');
  attachThumbs();
  attachBmThumbs();
}

function closeTag() {
  document.getElementById('tagDV').classList.remove('on');
  document.getElementById('bv').classList.remove('off');
  document.querySelectorAll('#tagList .ci').forEach(el => el.classList.remove('on'));
  curTag = null;
  renCats();
}
