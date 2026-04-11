// ─── Tags ───
async function loadTagSidebar() {
  const tags = await (await fetch('/api/tags')).json();
  const el = $('tagList').el;
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
  $('bv').add('off');
  $('tagDV').add('on');
  q = ''; $('sI').val(''); $('sGhost').html('');
  document.querySelectorAll('#tagList .ci').forEach(el => el.classList.toggle('on', el.dataset.tag === name));
  $('tagName').text(name);
  $('tagG').html('<div class="dup-scan">Loading\u2026</div>');
  renCats();
  const d = await (await fetch('/api/tags/' + encodeURIComponent(name))).json();
  if (d.error) { $('tagG').html('<div class="es" style="padding:40px 20px"><h3>' + esc(d.error) + '</h3></div>'); return; }
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
  $('tagG').html(localVids.map(card).join('') + bms.map(bmCard).join(''));
  attachThumbs();
  attachBmThumbs();
}

function closeTag() {
  $('tagDV').remove('on');
  $('bv').remove('off');
  document.querySelectorAll('#tagList .ci').forEach(el => el.classList.remove('on'));
  curTag = null;
  renCats();
}
