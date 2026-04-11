// ─── Bookmark Matching ───
function rebuildBookmarkVidIds(items) {
  bookmarkVidIds.clear();
  bmMatchedUrls.clear();
  for (const v of V) {
    const vname = v.name.toLowerCase().replace(/\.[^.]+$/, '');
    for (const it of items) {
      if (it.url.toLowerCase().includes(vname)) {
        bookmarkVidIds.add(v.id);
        bmMatchedUrls.add(it.url);
      }
    }
  }
}

function bfMatchesLocalVideo(url) {
  if (!V.length) return false;
  const haystack = url.toLowerCase();
  return V.some(v => {
    const fname = v.name.toLowerCase().replace(/\.[^.]+$/, '');
    return haystack.includes(fname);
  });
}

// ─── Bookmarks Cache ───
async function bfLoadCache() {
  try {
    const r = await fetch('/api/bookmarks/cache');
    if (!r.ok) return;
    const d = await r.json();
    if (d.items && d.items.length) renderBrowserFavs(d.items, '_cache_');
  } catch {}
}

async function bfSaveCache() {
  try {
    await fetch('/api/bookmarks/cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: _bfItems })
    });
  } catch {}
}

function bfRemoveItem(url) {
  _bfItems = _bfItems.filter(it => it.url !== url);
  _bfMatchedCount = _bfItems.filter(it => bfMatchesLocalVideo(it.url)).length;
  _bfVisible = _bfVisible.filter(it => it.url !== url);
  bfSaveCache();
  if (!_bfItems.length) {
    $('bfSearchWrap').show(false);
    $('browserFavsResult').html('');
    return;
  }
  bfRenderList(_bfVisible);
}

// ─── Import Favourites View ───
function showImportFavs() {
  if (mosaicOn) stopMosaic();
  if (location.pathname !== '/bookmarks') history.pushState(null, '', '/bookmarks');
  importFavsMode = true;
  $('bv').add('off');
  ['pv','dv','av','adv','sv','sdv','tagDV','vaultV','scraperV','collectionsV','settingsV','foldersV','dbV'].forEach(id => $(id).remove('on'));
  document.querySelectorAll('.ci.on').forEach(el => el.classList.remove('on'));
  $('importFavsSB').add('on');
  dupMode = false; vaultMode = false; scraperMode = false; foldersMode = false; collectionsMode = false; settingsMode = false; dbMode = false;
  studioMode = false; actorMode = false;
  curActor = null; curStudio = null; curTag = null; curV = null; curCollection = null;
  $('importFavsV').add('on');
  if (!_bfItems.length) bfLoadCache();
}

// ─── Browser Favs Import ───
async function importBrowserFavs(browser) {
  const btn = $(browser === 'chrome' ? 'bfChrome' : 'bfFirefox').el;
  const out = $('browserFavsResult').el;
  btn.disabled = true;
  btn.textContent = 'Loading…';
  out.innerHTML = '';
  try {
    const r = await fetch('/api/browser-favs?browser=' + browser);
    let d;
    try { d = await r.json(); } catch { d = { error: 'Server returned an invalid response (status ' + r.status + ')' }; }
    if (d.whitelist_empty) {
      out.innerHTML = '<p style="font-size:0.82rem;color:var(--tx2)">Whitelist is empty — add domains in <span style="color:var(--ac);cursor:pointer" onclick="showSettings()">Settings → Whitelist</span> first.</p>';
      return;
    }
    if (!r.ok || d.error) {
      out.innerHTML = '<p style="font-size:0.82rem;color:#e84040">' + esc(d.error || 'Failed to read bookmarks') + '</p>';
      return;
    }
    renderBrowserFavs(d.items, browser);
  } catch (e) {
    out.innerHTML = '<p style="font-size:0.82rem;color:#e84040">Error: ' + esc(e.message) + '</p>';
  } finally {
    btn.disabled = false;
    btn.innerHTML = browser === 'chrome'
      ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:5px"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="21.17" y1="8" x2="12" y2="8"/><line x1="3.95" y1="6.06" x2="8.54" y2="14"/><line x1="10.88" y1="21.94" x2="15.46" y2="14"/></svg>Chrome / Edge'
      : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:5px"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 7.38 16.76C17.5 20.5 15 21 12 21s-5.5-.5-7.38-1.24A10 10 0 0 1 12 2z"/></svg>Firefox';
  }
}

async function importBrowserFavsFile(browser, input) {
  const file = input.files[0];
  if (!file) return;
  const out = $('browserFavsResult').el;
  out.innerHTML = '<p style="font-size:0.82rem;color:var(--tx2)">Reading ' + esc(file.name) + '…</p>';
  try {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const data = btoa(bin);
    const r = await fetch('/api/browser-favs/file', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, filename: file.name, browser })
    });
    let d;
    try { d = await r.json(); } catch { d = { error: 'Server returned an invalid response (status ' + r.status + ')' }; }
    if (d.whitelist_empty) {
      out.innerHTML = '<p style="font-size:0.82rem;color:var(--tx2)">Whitelist is empty — add domains in <span style="color:var(--ac);cursor:pointer" onclick="showSettings()">Settings → Whitelist</span> first.</p>';
      return;
    }
    if (!r.ok || d.error) {
      out.innerHTML = '<p style="font-size:0.82rem;color:#e84040">' + esc(d.error || 'Failed') + '</p>';
      return;
    }
    renderBrowserFavs(d.items, browser);
  } catch (e) {
    out.innerHTML = '<p style="font-size:0.82rem;color:#e84040">Error: ' + esc(e.message) + '</p>';
  }
  input.value = '';
}

async function renderBrowserFavs(items, browser) {
  const out = $('browserFavsResult').el;
  const searchWrap = $('bfSearchWrap').el;
  const searchInput = $('bfSearch').el;
  if (!items.length) {
    searchWrap.style.display = 'none';
    out.innerHTML = '<p style="font-size:0.82rem;color:var(--tx2)">No bookmarks matched the whitelist.</p>';
    return;
  }
  const unmatched = [], matched = [];
  for (const item of items) {
    const dlKey = 'bfdl:' + item.url;
    if (bfMatchesLocalVideo(item.url)) {
      sessionStorage.setItem(dlKey, '1');
      matched.push(item);
    } else {
      unmatched.push(item);
    }
  }
  _bfItems = [...unmatched, ...matched];
  _bfMatchedCount = matched.length;
  rebuildBookmarkVidIds(_bfItems);

  searchWrap.style.display = 'block';
  if (searchInput) searchInput.value = '';
  bfRenderList(_bfItems);
  if (browser !== '_cache_') bfSaveCache();
  preFetchBmThumbs(_bfItems);
  renCats();
  if (!importFavsMode && !vaultMode && !studioMode && !actorMode && !dupMode) {
    if (curTag) openTag(curTag); else render();
  }
}

async function preFetchBmThumbs(items) {
  const missing = items.filter(it => !it.img);
  for (const item of missing) {
    try {
      const d = await (await fetch('/api/og-thumb?url=' + encodeURIComponent(item.url))).json();
      if (d.img) item.img = d.img;
    } catch {}
    await new Promise(r => setTimeout(r, 80));
  }
  if (missing.some(it => it.img)) bfSaveCache();
}

function bfRenderList(items) {
  _bfVisible = items;
  const out = $('browserFavsResult').el;
  const total = _bfItems.length;
  const pct = total ? Math.round(_bfMatchedCount / total * 100) : 0;
  const statsHtml =
    '<div class="bf-stats">' +
      '<span class="bf-stats-label">' + items.length + ' bookmark' + (items.length !== 1 ? 's' : '') + '</span>' +
      '<div class="bf-pct-wrap" title="' + _bfMatchedCount + ' of ' + total + ' already in library">' +
        '<div class="bf-pct-bar"><div class="bf-pct-fill" style="width:' + pct + '%"></div></div>' +
        '<span class="bf-pct-num">' + pct + '% in library</span>' +
      '</div>' +
    '</div>';

  if (_bfViewMode === 'grid') {
    out.innerHTML = statsHtml + '<div class="bf-grid" id="bfGrid">' +
      items.map((item, i) => {
        const inLib = bfMatchesLocalVideo(item.url);
        const encUrl = escA(item.url);
        const encTitle = escA(item.title);
        let hostname = '';
        try { hostname = new URL(item.url).hostname; } catch {}
        return '<div class="bf-card' + (inLib ? ' bf-downloaded' : '') + '" data-bf-idx="' + i + '" onclick="window.open(\'' + encUrl + '\',\'_blank\')">' +
          '<div class="bf-card-thumb">' +
            '<div class="bf-card-thumb-loading" id="bfth' + i + '">' +
              '<div class="bf-card-thumb-spin"></div>' +
            '</div>' +
            '<div class="bf-card-play"><svg width="22" height="22" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="5,3 19,12 5,21"/></svg></div>' +
            '<button class="bf-card-rm" onclick="event.stopPropagation();bfRemoveItem(\'' + encUrl + '\')" title="Remove bookmark"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
          '</div>' +
          '<div class="bf-card-info">' +
            '<div class="bf-card-title">' + esc(item.title || item.url) + '</div>' +
            '<div class="bf-card-host">' +
              '<img src="https://www.google.com/s2/favicons?sz=12&domain_url=' + encodeURIComponent(item.url) + '" width="12" height="12" onerror="this.style.display=\'none\'" style="flex-shrink:0">' +
              esc(hostname) +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
    bfLoadGridThumbs(items);
  } else {
    out.innerHTML = statsHtml +
      '<div class="bf-list">' +
      items.map(item => {
        const inLib = sessionStorage.getItem('bfdl:' + item.url) === '1';
        return '<div class="bf-row' + (inLib ? ' bf-downloaded' : '') + '">' +
          '<img class="bf-favicon" src="https://www.google.com/s2/favicons?sz=16&domain_url=' + encodeURIComponent(item.url) + '" width="16" height="16" onerror="this.style.display=\'none\'">' +
          '<a class="bf-title" href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer" title="' + esc(item.url) + '">' + esc(item.title) + '</a>' +
          '<span class="bf-host" data-url="' + esc(item.url) + '">' + esc(new URL(item.url).hostname) + '</span>' +
          '<button class="bf-rm-btn" onclick="bfRemoveItem(\'' + escA(item.url) + '\')" title="Remove bookmark"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
          '</div>';
      }).join('') +
      '</div>';
  }
}

function bfSetView(mode) {
  _bfViewMode = mode;
  const btnList = $('bfViewList').el;
  const btnGrid = $('bfViewGrid').el;
  if (btnList) btnList.classList.toggle('on', mode === 'list');
  if (btnGrid) btnGrid.classList.toggle('on', mode === 'grid');
  bfRenderList(_bfVisible);
}

function bfLoadGridThumbs(items) {
  if (!('IntersectionObserver' in window)) {
    items.forEach((item, i) => bfFetchThumb(item, i));
    return;
  }
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const idx = parseInt(entry.target.dataset.bfIdx, 10);
      if (!isNaN(idx) && items[idx]) bfFetchThumb(items[idx], idx);
      obs.unobserve(entry.target);
    });
  }, { rootMargin: '200px' });
  document.querySelectorAll('#bfGrid .bf-card').forEach(el => obs.observe(el));
}

async function bfFetchThumb(item, idx) {
  const thumbEl = $('bfth' + idx).el;
  if (!thumbEl) return;
  try {
    const r = await fetch('/api/og-thumb?url=' + encodeURIComponent(item.url));
    const d = await r.json();
    if (!thumbEl.isConnected) return;
    if (d.img) {
      thumbEl.outerHTML = '<img src="' + esc(d.img) + '" alt="" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.outerHTML=\'<div class=bf-card-thumb-ph><svg width=28 height=28 viewBox=&quot;0 0 24 24&quot; fill=none stroke=currentColor stroke-width=1.5><path d=&quot;M15 10l4.553-2.553A1 1 0 0 1 21 8.382V17a1 1 0 0 1-1.553.832L15 15M3 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z&quot;/></svg></div>\'">';
    } else {
      thumbEl.outerHTML = '<div class="bf-card-thumb-ph"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M15 10l4.553-2.553A1 1 0 0 1 21 8.382V17a1 1 0 0 1-1.553.832L15 15M3 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div>';
    }
  } catch {
    if (thumbEl && thumbEl.isConnected) thumbEl.outerHTML = '<div class="bf-card-thumb-ph"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M15 10l4.553-2.553A1 1 0 0 1 21 8.382V17a1 1 0 0 1-1.553.832L15 15M3 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div>';
  }
}

function bfFilterList(q) {
  const term = q.trim().toLowerCase();
  const filtered = term
    ? _bfItems.filter(item => item.title.toLowerCase().includes(term) || item.url.toLowerCase().includes(term))
    : _bfItems;
  bfRenderList(filtered);
}

function bfCopyVisible() {
  if (!_bfVisible.length) { toast('No bookmarks to copy'); return; }
  const text = _bfVisible.map(item => item.url).join('\n');
  navigator.clipboard.writeText(text).then(() => {
    toast('Copied ' + _bfVisible.length + ' URL' + (_bfVisible.length !== 1 ? 's' : ''));
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    toast('Copied ' + _bfVisible.length + ' URL' + (_bfVisible.length !== 1 ? 's' : ''));
  });
}

function bfOpenAllVisible() {
  if (!_bfVisible.length) { toast('No bookmarks to open'); return; }
  const n = _bfVisible.length;
  if (n > 10 && !confirm('Open ' + n + ' tabs?')) return;
  _bfVisible.forEach((item, i) => {
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = item.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }, i * 100);
  });
  toast('Opening ' + n + ' tab' + (n !== 1 ? 's' : '') + '…');
}

function openBfIframe(url, title) {
  const mo = $('bfiframeMo').el;
  const iframe = $('bfiframeEl').el;
  const blocked = $('bfiframeBlocked').el;
  $('bfiframeTitle').text(title || url);
  $('bfiframeLink').el.href = url;
  $('bfiframeFallback').el.href = url;
  blocked.classList.remove('on');
  iframe.src = '';
  let loaded = false;
  iframe.onload = () => { loaded = true; };
  setTimeout(() => { if (!loaded) blocked.classList.add('on'); }, 4000);
  iframe.src = url;
  mo.classList.add('on');
}

function closeBfIframe(e) {
  if (e instanceof MouseEvent && e.target !== $('bfiframeMo').el) return;
  $('bfiframeMo').remove('on');
  $('bfiframeEl').el.src = '';
}

function bfToggleAll(checked) {
  document.querySelectorAll('.bf-chk').forEach(cb => cb.checked = checked);
}

async function downloadSelected() {
  const urls = [...document.querySelectorAll('.bf-chk:checked')].map(cb => cb.value);
  if (!urls.length) { toast('Select at least one bookmark'); return; }
  const category = ($('bfCatSel').el || {}).value || '';
  const r = await fetch('/api/download', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls, category })
  });
  const d = await r.json();
  if (!r.ok) { toast(d.error || 'Failed to queue downloads'); return; }
  toast(d.ids.length + ' download' + (d.ids.length !== 1 ? 's' : '') + ' queued');
  startDlPoller();
  renderDlQueue();
}

// ─── Download Queue ───
function startDlPoller() {
  if (dlPoller) return;
  dlPoller = setInterval(async () => {
    const jobs = await (await fetch('/api/download/jobs')).json();
    renderDlQueue(jobs);
    const active = jobs.some(j => j.status === 'queued' || j.status === 'running');
    if (!active) {
      clearInterval(dlPoller); dlPoller = null;
      if (jobs.some(j => j.status === 'done')) refresh();
    }
  }, 1500);
}

async function renderDlQueue(jobs) {
  if (!jobs) {
    try { jobs = await (await fetch('/api/download/jobs')).json(); } catch { return; }
  }
  const panel = $('dlQueuePanel').el;
  const list = $('dlQueueList').el;
  const counter = $('dlQueueCount').el;
  if (!panel) return;
  if (!jobs.length) { panel.style.display = 'none'; return; }
  panel.style.display = '';
  const active = jobs.filter(j => j.status === 'queued' || j.status === 'running').length;
  counter.textContent = active ? '(' + active + ' active)' : '';
  list.innerHTML = jobs.map(j => {
    const pct = j.progress || 0;
    const statusTx = j.status === 'running'
      ? pct.toFixed(1) + '%' + (j.speed && j.speed !== 'Unknown' ? ' · ' + j.speed : '') + (j.eta && j.eta !== 'Unknown' ? ' ETA ' + j.eta : '')
      : j.status === 'done' ? 'Done'
      : j.status === 'error' ? (j.error || 'Error')
      : 'Queued';
    const statusCls = j.status === 'done' ? 'dlj-done' : j.status === 'error' ? 'dlj-err' : '';
    return '<div class="dlj-row">' +
      '<div class="dlj-info">' +
        '<span class="dlj-title" title="' + esc(j.url) + '">' + esc(j.title === j.url ? new URL(j.url).hostname + '/…' : j.title) + '</span>' +
        '<span class="dlj-status ' + statusCls + '">' + esc(statusTx) + '</span>' +
      '</div>' +
      (j.status === 'running' ? '<div class="dlj-bar"><div class="dlj-fill" style="width:' + pct + '%"></div></div>' : '') +
      '<button class="fv-rm" onclick="removeDlJob(\'' + j.id + '\')" title="' + (j.status === 'running' ? 'Cancel' : 'Remove') + '">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
      '</button>' +
    '</div>';
  }).join('');
}

async function removeDlJob(id) {
  await fetch('/api/download/jobs/' + id, { method: 'DELETE' });
  renderDlQueue();
}

async function clearDoneJobs() {
  const jobs = await (await fetch('/api/download/jobs')).json();
  await Promise.all(jobs.filter(j => j.status === 'done' || j.status === 'error').map(j =>
    fetch('/api/download/jobs/' + j.id, { method: 'DELETE' })
  ));
  renderDlQueue();
}
