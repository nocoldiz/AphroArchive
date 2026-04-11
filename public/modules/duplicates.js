// ─── Duplicates ───
function showDups() {
  if (location.pathname !== '/duplicates') history.pushState(null, '', '/duplicates');
  dupMode = true;
  $('browse-view').add('off');
  $('player-view').remove('on');
  $('duplicates-view').add('on');
  $('duplicates-sidebar').add('on');
  $('vault-view').remove('on');
  $('vault-sidebar').remove('on');
  $('scraper-view').remove('on');
  $('scraper-sidebar').remove('on');
  $('settings-view').remove('on');
  $('settings-sidebar').remove('on');
  if ($('database-view').el) $('database-view').remove('on');
  vaultMode = false; scraperMode = false; importFavsMode = false; settingsMode = false; dbMode = false;
  $('actors-view').remove('on');
  $('actor-detail-view').remove('on');
  $('actor-sidebar').remove('on');
  $('studios-view').remove('on');
  $('studio-detail-view').remove('on');
  $('studio-sidebar').remove('on');
  $('tag-detail-view').remove('on');
  document.querySelectorAll('#tagList .sidebar-item').forEach(el => el.classList.remove('on'));
  studioMode = false; curStudio = null;
  actorMode = false; curActor = null;
  curTag = null;
  if (curV) {
    const vp = $('video-player').el;
    vp.pause(); vp.src = '';
    curV = null;
  }
  loadDups();
}

async function loadDups() {
  $('duplicates-content').html(tpl('loading', { message: 'Scanning for duplicates\u2026' }));
  const groups = await (await fetch('/api/duplicates')).json();
  renderDups(groups);
}

function renderDups(groups) {
  const el = $('duplicates-content').el;
  const nBtn = $('duplicates-count').el;
  if (!groups.length) {
    nBtn.style.display = 'none';
    el.innerHTML = tpl('empty-state', { title: 'No duplicates found', desc: 'All videos appear to be unique' });
    return;
  }
  nBtn.textContent = groups.length;
  nBtn.style.display = '';
  const totalVids = groups.reduce((s, g) => s + g.length, 0);
  const wasted = groups.reduce((s, g) => s + g[0].size * (g.length - 1), 0);
  const cols = ['#e84040','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];
  let h = '<div class="duplicate-meta">' + totalVids + ' videos across ' + groups.length + ' groups &mdash; <b>' + fmtBytes(wasted) + '</b> potentially wasted</div>';
  groups.forEach(group => {
    h += '<div class="duplicate-group">';
    h += '<div class="duplicate-group-header"><span class="duplicate-count">' + group.length + ' copies</span> &nbsp;&bull;&nbsp; ' + group[0].sizeF + ' each</div>';
    h += '<div class="duplicate-cards">';
    group.forEach(v => {
      const c = cols[Math.abs(hsh(v.category)) % cols.length];
      const bg = 'linear-gradient(135deg,' + c + '12 0%,' + c + '06 100%)';
      h += '<div class="duplicate-card">';
      h += '<div class="duplicate-thumb" data-vid="' + v.id + '" style="background:' + bg + '" onclick="openVid(\'' + v.id + '\')">';
      h += '<div class="play-overlay"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></div></div>';
      h += '<div class="duplicate-info">';
      h += '<div class="duplicate-name" title="' + escA(v.name) + '">' + esc(v.name) + '</div>';
      h += '<div class="duplicate-category">' + esc(v.rel) + '</div>';
      h += '<button class="duplicate-delete" onclick="delVideo(\'' + v.id + '\')">Delete</button>';
      h += '</div></div>';
    });
    h += '</div></div>';
  });
  el.innerHTML = h;
  attachThumbs();
}
