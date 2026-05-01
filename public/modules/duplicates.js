// ─── Duplicates ───
let _dupResultsSource = 'quick'; // 'quick' (size) or 'deep' (visual)

function showDups() {
  _dupResultsSource = 'quick';
  showDatabase();
  dbSwitchTab('duplicates');
}

async function loadDups() {
  const container = $('duplicates-content');
  container.html(tpl('loading', { message: 'Scanning for duplicates\u2026' }));
  
  const url = _dupResultsSource === 'deep' ? '/api/duplicates/results' : '/api/duplicates';
  const groups = await (await fetch(url)).json();
  renderDups(groups);
}

function renderDups(groups) {
  const el = $('duplicates-content').el;
  const nBtn = $('duplicates-count').el;
  if (!groups.length) {
    if (nBtn) nBtn.style.display = 'none';
    el.innerHTML = tpl('empty-state', { title: 'No duplicates found', desc: 'All videos appear to be unique' });
    return;
  }
  if (nBtn) {
    nBtn.textContent = groups.length;
    nBtn.style.display = '';
  }
  const totalVids = groups.reduce((s, g) => s + g.length, 0);
  const wasted = groups.reduce((s, g) => s + (g[0].size || 0) * (g.length - 1), 0);
  const cols = ['#e84040','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];
  
  let h = '<div class="duplicate-meta">' + totalVids + ' videos across ' + groups.length + ' groups &mdash; <b>' + (typeof fmtBytes === 'function' ? fmtBytes(wasted) : (wasted/(1024*1024)).toFixed(1) + ' MB') + '</b> potentially wasted</div>';
  
  groups.forEach(group => {
    h += '<div class="duplicate-group">';
    h += '<div class="duplicate-group-header"><span class="duplicate-count">' + group.length + ' copies</span> &nbsp;&bull;&nbsp; ' + (group[0].sizeF || (group[0].size/(1024*1024)).toFixed(1) + ' MB') + ' each</div>';
    h += '<div class="duplicate-cards">';
    group.forEach(v => {
      const c = cols[Math.abs(hsh(v.category || '')) % cols.length];
      const bg = 'linear-gradient(135deg,' + c + '12 0%,' + c + '06 100%)';
      h += '<div class="duplicate-card">';
      h += '<div class="duplicate-thumb" data-vid="' + v.id + '" style="background:' + bg + '" onclick="openVid(\'' + v.id + '\')">';
      h += '<div class="play-overlay"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></div></div>';
      h += '<div class="duplicate-info">';
      h += '<div class="duplicate-name" title="' + escA(v.name) + '">' + esc(v.name) + '</div>';
      h += '<div class="duplicate-category">' + esc(v.rel || '') + '</div>';
      h += '<button class="duplicate-delete" onclick="deleteDuplicate(\'' + v.id + '\', this)">Delete</button>';
      h += '</div></div>';
    });
    h += '</div></div>';
  });
  el.innerHTML = h;
  if (typeof attachThumbs === 'function') attachThumbs();
}

async function deleteDuplicate(id, btn) {
  if (!confirm('Permanently delete this video file?')) return;
  const r = await fetch('/api/videos/' + id, { method: 'DELETE' });
  if (r.ok) {
    const card = btn.closest('.duplicate-card');
    const group = card.closest('.duplicate-group');
    card.remove();
    if (group.querySelectorAll('.duplicate-card').length < 2) group.remove();
    toast('Deleted');
  } else {
    toast('Delete failed');
  }
}

// ─── Deep Scanning ───

let _dupScanES = null;

async function startDuplicateScan() {
  const btn = $('dupScanBtn').el;
  const stopBtn = $('dupStopBtn').el;
  const status = $('dupScanStatus').el;
  const progress = $('dupScanProgress').el;
  const bar = $('dupScanBar').el;
  
  btn.disabled = true;
  if (stopBtn) stopBtn.style.display = 'inline-block';
  status.textContent = 'Starting scan…';
  progress.style.display = 'block';
  bar.style.width = '0%';
  
  await fetch('/api/duplicates/scan', { method: 'POST' });
  
  if (_dupScanES) _dupScanES.close();
  _dupScanES = new EventSource('/api/duplicates/status');
  
  _dupScanES.onmessage = e => {
    const d = JSON.parse(e.data);
    if (d.type === 'progress') {
      const pct = Math.round((d.done / d.total) * 100);
      bar.style.width = pct + '%';
      status.textContent = 'Hashing: ' + d.done + ' / ' + d.total + ' (' + pct + '%)';
      if (!d.running && d.done === d.total) {
        _dupScanComplete();
      }
    } else if (d.type === 'done') {
      _dupScanComplete();
    }
  };
  
  _dupScanES.onerror = () => {
    _dupScanES.close();
    btn.disabled = false;
    if (stopBtn) stopBtn.style.display = 'none';
    status.textContent = 'Scan connection lost.';
  };
}

async function stopDuplicateScan() {
  await fetch('/api/duplicates/stop', { method: 'POST' });
  _dupScanComplete();
}

function _dupScanComplete() {
  if (_dupScanES) _dupScanES.close();
  _dupScanES = null;
  const btn = $('dupScanBtn').el;
  const stopBtn = $('dupStopBtn').el;
  const status = $('dupScanStatus').el;
  if (btn) btn.disabled = false;
  if (stopBtn) stopBtn.style.display = 'none';
  status.innerHTML = 'Scan complete! <a href="#" onclick="showDeepDups();return false" style="color:var(--ac);font-weight:600">View Results</a>';
}

function showDeepDups() {
  _dupResultsSource = 'deep';
  showDatabase();
  dbSwitchTab('duplicates');
}
