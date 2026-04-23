// ─── Batch Thumbnail Generator ───

let _genSSE = null;
let _genRunning = false;

function startGenThumbs() {
  if (_genRunning) { stopGenThumbs(); return; }
  fetch('/api/gen-thumbs/start', { method: 'POST' })
    .then(r => r.json())
    .then(d => {
      if (!d.ok) { toast(d.error || 'Already running'); return; }
      _subscribeGenThumbs();
    })
    .catch(() => toast('Failed to start'));
}

function stopGenThumbs() {
  fetch('/api/gen-thumbs/stop', { method: 'POST' }).catch(() => {});
}

function _subscribeGenThumbs() {
  if (_genSSE) { _genSSE.close(); }
  _genSSE = new EventSource('/api/gen-thumbs/status');
  _genSSE.onmessage = e => {
    try { _updateGenThumbsUI(JSON.parse(e.data)); } catch {}
  };
  _genSSE.onerror = () => { _genSSE.close(); _genSSE = null; };
}

function _updateGenThumbsUI(msg) {
  const btn      = document.getElementById('genThumbsBtn');
  const barFill  = document.getElementById('genThumbsBar');
  const statusEl = document.getElementById('genThumbsStatus');
  const progress = document.getElementById('genThumbsProgress');
  if (!btn) return;

  if (msg.type === 'start' || msg.type === 'progress') {
    _genRunning = true;
    btn.textContent = 'Stop';
    if (progress) progress.style.display = '';
    const pct = msg.total > 0 ? Math.round(msg.done / msg.total * 100) : 0;
    if (barFill) barFill.style.width = pct + '%';
    if (statusEl) {
      statusEl.textContent = msg.total > 0
        ? `${msg.done} / ${msg.total} (${pct}%)${msg.current ? ' — ' + msg.current : ''}`
        : 'Scanning…';
    }
  } else if (msg.type === 'done') {
    _genRunning = false;
    btn.textContent = 'Generate All';
    if (barFill) barFill.style.width = '100%';
    const label = msg.failed
      ? `Done — ${msg.done - msg.failed} generated, ${msg.failed} failed`
      : `Done — ${msg.done} generated, ${msg.skipped || 0} already existed`;
    if (statusEl) statusEl.textContent = label;
    toast(label);
    setTimeout(() => {
      if (progress) progress.style.display = 'none';
      if (statusEl) statusEl.textContent = '';
    }, 5000);
  } else if (msg.type === 'idle') {
    _genRunning = false;
    btn.textContent = 'Generate All';
    if (progress) progress.style.display = 'none';
  }
}

// ─── Auto-queue thumbs for all videos in the current filtered view ───
// Called by render() and openTag() so that all visible videos start
// generating in the background, not just those near the viewport.
function queueAllThumbs(vids) {
  if (!vids || !vids.length) return;
  for (const v of vids) {
    if (v && v.id && !(v.id in thumbMap)) queueThumb(v.id);
  }
}
