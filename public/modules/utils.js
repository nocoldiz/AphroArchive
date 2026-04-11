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

// ─── Utilities ───
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function escA(s) { return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }
function hsh(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; } return h; }
function toast(m) { const e = $('tst').el; e.textContent = m; e.classList.add('show'); setTimeout(() => e.classList.remove('show'), 2500); }
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
