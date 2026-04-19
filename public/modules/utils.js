// ─── DOM helpers ───
const _$null = { el: null };
['add','remove','toggle','text','html','show','val'].forEach(m => _$null[m] = () => _$null);

const $ = id => {
  const e = document.getElementById(id);
  if (!e) return _$null;
  const w = {
    el:     e,
    add:    (...c) => (e.classList.add(...c),               w),
    remove: (...c) => (e.classList.remove(...c),            w),
    toggle: (c, f) => (e.classList.toggle(c, f),            w),
    text:   v      => (e.textContent = v,                   w),
    html:   v      => (e.innerHTML   = v,                   w),
    show:   (v=true) => (e.style.display = v ? '' : 'none', w),
    val:    v      => (e.value = v,                         w),
  };
  return w;
};

// ─── Template engine ───
const _tpl = {};
async function loadTemplates() {
  const names = ['loading', 'skeleton', 'empty-state', 'video-card', 'bookmark-card'];
  await Promise.all(names.map(n =>
    fetch('/templates/' + n + '.html')
      .then(r => r.text())
      .then(t => { _tpl[n] = t.trim(); })
  ));
}
function tpl(name, data = {}) {
  return (_tpl[name] || '').replace(/\{\{(\w+)\}\}/g, (_, k) => data[k] ?? '');
}

// ─── Utilities ───
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function escA(s) { return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }
function hsh(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; } return h; }
function toast(m, ms = 2500) { const e = $('toast').el; e.textContent = m; e.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => e.classList.remove('show'), ms); }
function fmtBytes(b) {
  if (!b) return '0 B';
  const k = 1024, s = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(1) + ' ' + s[i];
}

// ─── Collapsible sections ───
function toggleSection(name) {
  const sec = $(name + 'Section').el;
  const h = $('sh3-' + name).el;
  const closed = sec.classList.toggle('closed');
  h.classList.toggle('closed', closed);
  localStorage.setItem('sc_' + name, closed ? '1' : '');
}

// ─── Vision modal ───
function showVisionModal(text) {
  const modal = document.getElementById('visionModal');
  const body  = document.getElementById('visionModalBody');
  if (!modal || !body) return;
  body.textContent = text;
  modal.classList.add('on');
}

function closeVisionModal() {
  document.getElementById('visionModal')?.classList.remove('on');
}

async function describeVideoThumb(videoId) {
  showVisionModal('Analyzing thumbnail\u2026');
  const r = await fetch('/api/vision/describe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'thumb', id: videoId, thumbIdx: 0 })
  }).then(r => r.json()).catch(() => null);
  showVisionModal(r ? (r.description || r.error || 'No description returned') : 'Request failed');
}
