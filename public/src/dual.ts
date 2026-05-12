import { signal } from '@preact/signals';
import { allVideos, categories, currentCategory, currentTag } from './store';

// ─── Dual Mode State ───
export const dualMode = signal(false);
export const dualActive = signal<'left' | 'right'>('left');
export const dualR = signal<{ q: string; cat: string; curTag: string | null }>({
  q: '',
  cat: '',
  curTag: null
});

let _dualTagVids: any[] = [];

export function toggleDual() {
  dualMode.value = !dualMode.value;
  document.body.classList.toggle('dual-mode', dualMode.value);
  
  const dualBtn = document.getElementById('dualBtn');
  if (dualBtn) dualBtn.classList.toggle('on', dualMode.value);

  if (dualMode.value) {
    dualR.value = { q: '', cat: currentCategory.value, curTag: currentTag.value };
    _dualTagVids = [];
    
    const titleEl = document.getElementById('dual-section-title');
    if (titleEl) {
      titleEl.textContent = currentTag.value ? currentTag.value
        : currentCategory.value ? (categories.value.find(x => x.path === currentCategory.value)?.name || currentCategory.value) : 'All Videos';
    }
    renderRight();
  } else {
    dualActive.value = 'left';
    document.body.classList.remove('dual-right');
  }
}

// Track which pane the mouse is in
if (typeof window !== 'undefined') {
  window.addEventListener('mousemove', e => {
    if (!dualMode.value) return;
    const rightEl = document.getElementById('dual-pane-right');
    if (!rightEl) return;
    const inRight = e.clientX >= rightEl.getBoundingClientRect().left;
    if (inRight !== (dualActive.value === 'right')) {
      dualActive.value = inRight ? 'right' : 'left';
      document.body.classList.toggle('dual-right', inRight);
    }
  });
}

export function renderRight() {
  const g = document.getElementById('video-grid-right');
  const empty = document.getElementById('empty-placeholder-right');
  if (!g) return;

  const state = dualR.value;
  let vids: any[] = [];

  if (state.q) {
    const lo = state.q.toLowerCase();
    vids = allVideos.value.filter(v =>
      v.name.toLowerCase().includes(lo) || (v.category || '').toLowerCase().includes(lo)
    );
    // TODO: Apply sort if needed, for now just use as is
  } else if (state.curTag) {
    // Fallback or fetch
    vids = _dualTagVids;
  } else {
    vids = allVideos.value.filter(v => v.category === state.cat || v.catPath === state.cat);
  }

  if (!vids.length) {
    g.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  
  if (empty) empty.style.display = 'none';
  
  // Legacy rendering using innerHTML for now
  // In a full migration, this would be a Preact component!
  const cardHtml = (v: any) => `
    <div class="video-card" onclick="openVid('${v.id}')">
      <div class="thumb-wrap">
        <img src="/api/thumbs/${v.id}/0" loading="lazy" />
      </div>
      <div class="card-info">
        <div class="card-title">${v.name}</div>
        <div class="card-meta">${v.category}</div>
      </div>
    </div>
  `;

  g.innerHTML = vids.map(cardHtml).join('');
}

export function dualSelCat(c: string) {
  dualR.value = { ...dualR.value, cat: c, curTag: null, q: '' };
  _dualTagVids = [];
  
  const inp = document.getElementById('search-input-right') as HTMLInputElement;
  if (inp) inp.value = '';
  
  const titleEl = document.getElementById('dual-section-title');
  if (titleEl) titleEl.textContent = c ? (categories.value.find(x => x.path === c)?.name || c) : 'All Videos';
  
  renderRight();
}

export async function dualOpenTag(name: string) {
  dualR.value = { ...dualR.value, curTag: name, cat: '', q: '' };
  const inp = document.getElementById('search-input-right') as HTMLInputElement;
  if (inp) inp.value = '';
  const titleEl = document.getElementById('dual-section-title');
  if (titleEl) titleEl.textContent = name;

  const g = document.getElementById('video-grid-right');
  if (g) g.innerHTML = '<div class="skeleton">Loading...</div>';
  
  try {
    const d = await (await fetch('/api/db-tags/' + encodeURIComponent(name))).json();
    if (!d.error) _dualTagVids = d.videos || [];
  } catch { _dualTagVids = []; }
  
  renderRight();
}

export function onDualSearch(val: string) {
  dualR.value = { ...dualR.value, q: val.trim() };
  const titleEl = document.getElementById('dual-section-title');
  const state = dualR.value;
  if (titleEl) {
    titleEl.textContent = state.q
      ? 'Search: ' + state.q
      : state.curTag
        ? state.curTag
        : state.cat ? (categories.value.find(x => x.path === state.cat)?.name || state.cat) : 'All Videos';
  }
  renderRight();
}

// Bridge to window
if (typeof window !== 'undefined') {
  (window as any).toggleDual = toggleDual;
  (window as any).dualSelCat = dualSelCat;
  (window as any).dualOpenTag = dualOpenTag;
  (window as any).onDualSearch = onDualSearch;
}
