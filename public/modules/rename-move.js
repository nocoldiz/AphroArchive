// ─── Rename ───
let _renBmUrl = null;

function openRen(id, name) {
  renId = id; _renBmUrl = null;
  $('rename-input').val(name);
  $('rename-error').show(false);
  $('rename-modal').add('on');
  setTimeout(() => $('rename-input').el.focus(), 50);
}

function openBmRen(url, title) {
  _renBmUrl = url; renId = null;
  $('rename-input').val(title);
  $('rename-error').show(false);
  $('rename-modal').add('on');
  setTimeout(() => $('rename-input').el.focus(), 50);
}

function openRenP() { if (curV) openRen(curV.id, curV.name); }

function closeRen() { $('rename-modal').remove('on'); renId = null; _renBmUrl = null; }

async function doRen() {
  const n = $('rename-input').el.value.trim();
  if (!n) return;

  if (_renBmUrl) {
    const item = _bfItems.find(it => it.url === _renBmUrl);
    if (item) { item.title = n; bfSaveCache(); }
    closeRen();
    toast('Renamed');
    render();
    return;
  }

  const r = await fetch('/api/videos/' + renId + '/rename', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newName: n })
  });
  const d = await r.json();
  if (!r.ok) {
    const e = $('rename-error').el;
    e.textContent = d.error || 'Failed';
    e.style.display = 'block';
    return;
  }
  closeRen();
  toast('Renamed successfully');
  if (curV && curV.id === renId) {
    curV.id = d.newId;
    curV.name = n;
    $('player-title').text(n);
    const p = $('video-player').el, t = p.currentTime;
    p.src = '/api/stream/' + d.newId;
    p.currentTime = t;
  }
  await refresh();
}

// ─── Extract Actor Names ───
function extractActorNames(title, knownActors = []) {
  const found = new Set(knownActors);

  let t = title.replace(/\.[a-z0-9]{2,5}$/i, '').trim();

  t.replace(/\b([A-Za-z]+_[A-Za-z]+(?:_[A-Za-z]+)*)\b/g, (_, g) => { found.add(g.replace(/_/g, ' ')); });
  t = t.replace(/_/g, ' ');

  (t.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g) || []).forEach(w => found.add(w));

  const stop = new Set([
    'video','the','a','an','in','on','at','to','for','of','or','but',
    'makes','make','takes','take','adores','adore','loves','love',
    'watches','watch','shopping','fitting','room','night','romantic',
    'amend','cry','him','her','them','from','by','hot','sexy',
    'goes','going','wants','gets','got','part','episode','scene',
    'compilation','vol','ft','feat','his','their','our','your','my',
    'he','she','they','we','you','i','tv','rfc'
  ]);

  function capSeqs(text) {
    const results = [], words = text.split(/\s+/);
    let cur = [];
    for (const w of words) {
      const c = w.replace(/[^a-zA-Z]/g, '');
      if (c.length > 1 && /^[A-Z][a-z]/.test(c) && !stop.has(c.toLowerCase())) {
        cur.push(c);
      } else {
        if (cur.length) { results.push(cur.join(' ')); cur = []; }
      }
    }
    if (cur.length) results.push(cur.join(' '));
    return results;
  }

  const verbPat = /\b(makes?\s+\w+(?:\s+\w+)?\s+for|adores?|loves?|takes?\b|watches?|goes?\s+\w+|and)\b/i;
  const dashSegs = t.split(/\s*[–—]\s*/);

  for (const seg of dashSegs) {
    const vm = seg.match(verbPat);
    if (vm) {
      const vi = seg.search(verbPat);
      const before = seg.slice(0, vi).trim();
      const after  = seg.slice(vi + vm[0].length).trim();
      capSeqs(before).forEach(n => found.add(n));
      const afterSeqs = capSeqs(after);
      if (afterSeqs.length) found.add(afterSeqs[0]);
    }

    const wm = seg.match(/\bwith\s+([A-Z][^–—]+?)(?=\s*$|\s*[,–—]|$)/);
    if (wm) {
      (wm[1] + ',' + seg.slice(seg.indexOf(wm[0]) + wm[0].length))
        .split(/,\s*/).forEach(p => capSeqs(p.trim()).forEach(n => found.add(n)));
    }
    const wm2 = seg.match(/\bwith\s+(.+)/i);
    if (wm2) wm2[1].split(/,\s*/).forEach(p => capSeqs(p.trim()).forEach(n => found.add(n)));

    const fm = seg.match(/\b(?:featuring|feat\.?)\s+([A-Z][^,–—]+)/i);
    if (fm) capSeqs(fm[1].trim()).forEach(n => found.add(n));

    const andRe = /\band\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/g;
    let am;
    while ((am = andRe.exec(seg)) !== null) capSeqs(am[1]).forEach(n => found.add(n));
  }

  if (dashSegs.length > 1) {
    const first = dashSegs[0].trim();
    const words = first.split(/\s+/);
    if (words.length === 1) {
      if (/^[A-Z][a-zA-Z]+$/.test(first) && !/^[A-Z]{2,}$/.test(first)) found.add(first);
    } else if (!verbPat.test(first)) {
      first.split(/,\s*/).forEach(p => capSeqs(p.trim()).forEach(n => found.add(n)));
    }
  }

  return [...found].filter(n => n && n.length > 1 && !stop.has(n.toLowerCase()));
}

// ─── Move ───
let _movBmUrl = null;
let _bulkMoveIds = [];

async function openBulkMove(ids) {
  _bulkMoveIds = ids;
  movId = null; 
  _movBmUrl = null;
  
  $('move-info').text('Moving ' + ids.length + ' videos');
  $('move-error').show(false);
  $('move-new-input').val('');
  
  const mainCats = await (await fetch('/api/main-categories')).json();
  const list = $('move-list').el;
  list.innerHTML = mainCats.map(c => {
    return '<div class="move-item" data-cat="' + esc(c.path) + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' +
      '<span>' + esc(c.name) + '</span></div>';
  }).join('');
  
  list.querySelectorAll('.move-item').forEach(el => {
    el.addEventListener('click', () => doBulkMove(el.dataset.cat));
  });
  
  $('move-modal').add('on');
}

async function doBulkMove(targetCat) {
  if (!_bulkMoveIds.length) return;
  
  toast('Moving ' + _bulkMoveIds.length + ' videos\u2026');
  
  for (const id of _bulkMoveIds) {
    try {
      await fetch('/api/videos/' + id + '/move', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: targetCat })
      });
    } catch (err) { console.error('Failed to move ' + id, err); }
  }
  
  closeMov();
  toast('Moved ' + _bulkMoveIds.length + ' videos to ' + (targetCat || 'Uncategorized'));
  _bulkMoveIds = [];
  
  if (window.clearVideoSelection) window.clearVideoSelection();
  await refresh();
}

async function openMov(id, name, curCatPath) {
  movId = id; _movBmUrl = null;
  movCurCat = curCatPath;
  $('move-info').text('Moving: ' + name);
  $('move-error').show(false);
  $('move-new-input').val('');
  const norm = p => p.replace(/\\/g, '/');
  const mainCats = await (await fetch('/api/main-categories')).json();
  const list = $('move-list').el;
  list.innerHTML = mainCats.map(c => {
    const isCur = norm(c.path) === norm(curCatPath);
    return '<div class="move-item' + (isCur ? ' cur' : '') + '" data-cat="' + esc(c.path) + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' +
      '<span>' + esc(c.name) + '</span></div>';
  }).join('');
  list.querySelectorAll('.move-item:not(.cur)').forEach(el => {
    el.addEventListener('click', () => doMove(el.dataset.cat));
  });
  $('move-modal').add('on');
}

async function openBmMov(url, title, curCatPath) {
  await openMov(null, title, curCatPath);
  _movBmUrl = url; // set after openMov so it doesn't get cleared
}

function openMovP() { if (curV) openMov(curV.id, curV.name, curV.catPath || ''); }
function closeMov() { $('move-modal').remove('on'); movId = null; _movBmUrl = null; _bulkMoveIds = []; }

async function doMove(targetCat) {
  if (_movBmUrl) {
    const item = _bfItems.find(it => it.url === _movBmUrl);
    if (item) { item.category = targetCat; bfSaveCache(); }
    closeMov();
    toast('Moved to ' + (targetCat || 'Uncategorized'));
    render();
    return;
  }
  if (!movId) return;
  const r = await fetch('/api/videos/' + movId + '/move', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: targetCat })
  });
  const d = await r.json();
  if (!r.ok) {
    const e = $('move-error').el;
    e.textContent = d.error || 'Move failed';
    e.style.display = 'block';
    return;
  }
  closeMov();
  toast('Moved to ' + (targetCat || 'Uncategorized'));
  if (curV && curV.id === movId) {
    curV.id = d.newId;
    curV.catPath = targetCat;
    curV.category = targetCat || 'Uncategorized';
    $('player-category').text(curV.category);
    const p = $('video-player').el, t = p.currentTime;
    p.src = '/api/stream/' + d.newId;
    p.currentTime = t;
  }
  await refresh();
}

async function doMoveNew() {
  const name = $('move-new-input').el.value.trim();
  if (!name) return;
  const safe = name.replace(/[<>:"|?*]/g, '_');
  if (_bulkMoveIds.length) await doBulkMove(safe);
  else await doMove(safe);
}

// ─── Drag-drop Move ───
async function dropMoveVideo(id, catPath) {
  const r = await fetch('/api/videos/' + id + '/move', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: catPath })
  });
  const d = await r.json();
  if (!r.ok) { toast(d.error || 'Move failed'); return; }
  toast('Moved to ' + (catPath || 'Uncategorized'));
  if (curV && curV.id === id) {
    curV.id = d.newId;
    curV.catPath = catPath;
    curV.category = catPath || 'Uncategorized';
    $('player-category').text(curV.category);
    const p = $('video-player').el, t = p.currentTime;
    p.src = '/api/stream/' + d.newId;
    p.currentTime = t;
  }
  await refresh();
}

// ─── Delete Video ───
async function delVideo(id) {
  if (!confirm('Permanently delete this video file?')) return;
  const r = await fetch('/api/videos/' + id, { method: 'DELETE' });
  const d = await r.json();
  if (!r.ok) { toast(d.error || 'Delete failed'); return; }
  delete thumbMap[id];
  toast('Deleted');
  if (dbMode && dbTab === 'duplicates') loadDups(); else { V = V.filter(v => v.id !== id); render(); }
}

// ─── Modal Close Handlers ───
$('rename-modal').el.addEventListener('click', e => { if (e.target === $('rename-modal').el) closeRen(); });
$('move-modal').el.addEventListener('click', e => { if (e.target === $('move-modal').el) closeMov(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeRen(); closeMov(); if (mosaicOn) stopMosaic(); closeBfIframe(); }
  if (e.key === 'Enter' && renId) doRen();
});
