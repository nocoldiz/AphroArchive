// ─── Categories View ───

let _cvData = [];
let _cvSort = 'name'; // 'name' | 'count-desc' | 'count-asc'

function showCategoriesView() {
  closeAllViews();
  if (location.pathname !== '/categories') history.pushState(null, '', '/categories');
  categoriesMode = true;
  $('browse-view').add('off');
  $('categories-view-sidebar').add('on');
  $('categories-view').add('on');
  document.querySelectorAll('.cv-sort-btn').forEach(b => b.classList.toggle('on', b.dataset.s === _cvSort));
  loadCategoriesView();
}

async function loadCategoriesView() {
  $('cvGrid').html('<div class="cv-loading">Loading\u2026</div>');
  try {
    const r = await fetch('/api/categories-overview');
    _cvData = await r.json();
  } catch { _cvData = []; }
  renderCategoriesView();
}

function setCvSort(s) {
  _cvSort = s;
  document.querySelectorAll('.cv-sort-btn').forEach(b => b.classList.toggle('on', b.dataset.s === s));
  renderCategoriesView();
}

function renderCategoriesView() {
  const grid  = $('cvGrid').el;
  const empty = $('cvEmpty').el;
  if (!_cvData.length) {
    grid.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  let items = [..._cvData];
  if (_cvSort === 'name')       items.sort((a, b) => a.name.localeCompare(b.name));
  else if (_cvSort === 'count-desc') items.sort((a, b) => b.count - a.count);
  else if (_cvSort === 'count-asc')  items.sort((a, b) => a.count - b.count);

  grid.innerHTML = items.map(item => {
    const thumbSrc = item.thumbId ? '/api/thumbs/' + item.thumbId + '/0' : '';
    const onclick  = item.type === 'cat'
      ? 'selCat(\'' + escA(item.path) + '\')'
      : 'openTag(\'' + escA(item.name) + '\')';
    const typeIcon = item.type === 'cat'
      ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
      : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>';
    const onctx  = item.type === 'cat'
      ? ' oncontextmenu="showContextMenu(event, \'category\', {path:\'' + escA(item.path) + '\', name:\'' + escA(item.name) + '\', encrypted:' + !!item.encrypted + ', partial:' + !!item.partial + '})"'
      : '';
    let lockIcon = '';
    if (item.partial) {
      lockIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e84040" stroke-width="3" style="position:absolute;top:10px;right:10px;z-index:2;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';
    } else if (item.encrypted) {
      lockIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="position:absolute;top:10px;right:10px;z-index:2;color:white;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
    }
    return '<div class="cv-card" onclick="' + onclick + '"' + onctx + '>' +
      lockIcon +
      (thumbSrc ? '<img class="cv-thumb" src="' + thumbSrc + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '<div class="cv-thumb cv-thumb--empty"></div>') +
      '<div class="cv-overlay">' +
      '<span class="cv-type">' + typeIcon + '</span>' +
      '<div class="cv-info">' +
      '<span class="cv-name">' + esc(item.name) + '</span>' +
      '<span class="cv-count">' + item.count + '</span>' +
      '</div>' +
      '</div>' +
      '</div>';
  }).join('');
}
