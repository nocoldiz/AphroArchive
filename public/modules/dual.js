// ─── Dual Mode ───

function toggleDual() {
  dualMode = !dualMode;
  document.body.classList.toggle('dual-mode', dualMode);
  $('dualBtn').toggle('on', dualMode);
  if (dualMode) {
    dualR = { q: '', cat: cat, curTag: curTag };
    _dualTagVids = [];
    const titleEl = document.getElementById('dual-section-title');
    if (titleEl) {
      titleEl.textContent = curTag ? curTag
        : cat ? (cats.find(x => x.path === cat)?.name || cat) : 'All Videos';
    }
    renderRight();
  } else {
    dualActive = 'left';
    document.body.classList.remove('dual-right');
  }
}

// Track which pane the mouse is in and reposition sidebar
document.addEventListener('mousemove', e => {
  if (!dualMode) return;
  const rightEl = document.getElementById('dual-pane-right');
  if (!rightEl) return;
  const inRight = e.clientX >= rightEl.getBoundingClientRect().left;
  if (inRight !== (dualActive === 'right')) {
    dualActive = inRight ? 'right' : 'left';
    document.body.classList.toggle('dual-right', inRight);
  }
});

function renderRight() {
  const g = document.getElementById('video-grid-right');
  const empty = document.getElementById('empty-placeholder-right');
  if (!g) return;

  let vids;
  if (dualR.q) {
    const lo = dualR.q.toLowerCase();
    vids = _allVideos.filter(v =>
      v.name.toLowerCase().includes(lo) || (v.category || '').toLowerCase().includes(lo)
    );
    vids = _applySort(vids);
  } else if (dualR.curTag) {
    const terms = _dbTagTerms[dualR.curTag];
    if (terms && _allVideos.length) {
      vids = filterVideosByTag(terms);
    } else {
      vids = _dualTagVids; // fallback: server-fetched
    }
  } else {
    vids = filterVideosCat(dualR.cat);
  }

  if (!vids.length) {
    g.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';
  const isRerender = g.childElementCount > 0 && !g.querySelector('.skeleton');
  g.innerHTML = vids.map(card).join('');
  if (isRerender) g.querySelectorAll('.video-card.fade-in').forEach(el => el.classList.remove('fade-in'));
  attachThumbs();
}

async function dualSelCat(c) {
  dualR.cat = c;
  dualR.curTag = null;
  dualR.q = '';
  _dualTagVids = [];
  const inp = document.getElementById('search-input-right');
  if (inp) inp.value = '';
  const titleEl = document.getElementById('dual-section-title');
  if (titleEl) titleEl.textContent = c ? (cats.find(x => x.path === c)?.name || c) : 'All Videos';
  renCats(); // update sidebar highlight to reflect right pane's active category
  renderRight();
}

async function dualOpenTag(name) {
  dualR.curTag = name;
  dualR.cat = '';
  dualR.q = '';
  const inp = document.getElementById('search-input-right');
  if (inp) inp.value = '';
  const titleEl = document.getElementById('dual-section-title');
  if (titleEl) titleEl.textContent = name;

  const terms = _dbTagTerms[name];
  if (_allVideos.length && terms && terms.length) {
    renderRight();
    return;
  }
  // Slow path — fetch from server
  const g = document.getElementById('video-grid-right');
  if (g) g.innerHTML = Array(8).fill(tpl('skeleton')).join('');
  try {
    const d = await (await fetch('/api/db-tags/' + encodeURIComponent(name))).json();
    if (!d.error) _dualTagVids = d.videos || [];
  } catch { _dualTagVids = []; }
  renderRight();
}

function onDualSearch(val) {
  dualR.q = val.trim();
  const titleEl = document.getElementById('dual-section-title');
  if (titleEl) {
    titleEl.textContent = dualR.q
      ? 'Search: ' + dualR.q
      : dualR.curTag
        ? dualR.curTag
        : dualR.cat ? (cats.find(x => x.path === dualR.cat)?.name || dualR.cat) : 'All Videos';
  }
  renderRight();
}
