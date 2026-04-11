// ─── Tags ───
async function loadTagSidebar() {
  const tags = await (await fetch('/api/tags')).json();
  const el = $('tagList').el;
  if (!tags.length) { el.innerHTML = ''; return; }
  el.innerHTML = tags.map(t =>
    '<div class="sidebar-item' + (curTag === t.name ? ' on' : '') + '" data-tag="' + escA(t.name) + '" onclick="openTag(\'' + escA(t.name) + '\')">' +
    '<span>' + esc(t.name) + '</span>' +
    '<span class="count-badge">' + t.count + '</span>' +
    '</div>'
  ).join('');
}

async function openTag(name) {
  if (location.pathname !== '/tag/' + encodeURIComponent(name)) history.pushState(null, '', '/tag/' + encodeURIComponent(name));
  closeAllViews();
  curTag = name;
  $('browse-view').add('off');
  $('tag-detail-view').add('on');
  q = ''; $('search-input').val(''); $('search-ghost').html('');
  document.querySelectorAll('#tagList .sidebar-item').forEach(el => el.classList.toggle('on', el.dataset.tag === name));
  $('tag-name').text(name);
  $('tag-grid').html(tpl('loading', { message: 'Loading\u2026' }));
  renCats();
  const d = await (await fetch('/api/tags/' + encodeURIComponent(name))).json();
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
  $('tag-grid').html(localVids.map(card).join('') + bms.map(bmCard).join(''));
  attachThumbs();
  attachBmThumbs();
}

function closeTag() {
  $('tag-detail-view').remove('on');
  $('browse-view').remove('off');
  document.querySelectorAll('#tagList .sidebar-item').forEach(el => el.classList.remove('on'));
  curTag = null;
  renCats();
}
