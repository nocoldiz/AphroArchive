// ─── Utilities ───
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function escA(s) { return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }
function hsh(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; } return h; }
function toast(m) { const e = document.getElementById('tst'); e.textContent = m; e.classList.add('show'); setTimeout(() => e.classList.remove('show'), 2500); }
function fmtBytes(b) {
  if (!b) return '0 B';
  const k = 1024, s = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(1) + ' ' + s[i];
}

// ─── Collapsible sections ───
function toggleSection(name) {
  const sec = document.getElementById(name + 'Section');
  const h = document.getElementById('sh3-' + name);
  const closed = sec.classList.toggle('closed');
  h.classList.toggle('closed', closed);
  localStorage.setItem('sc_' + name, closed ? '1' : '');
}
