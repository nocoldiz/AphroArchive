// ─── Thumbnails ───
function initThumbObs() {
  if (thumbObs) return;
  thumbObs = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const id = e.target.dataset.vid;
      if (id in thumbMap) continue;
      thumbObs.unobserve(e.target);
      queueThumb(id);
    }
  }, { rootMargin: '300px' });
}

function attachThumbs() {
  initThumbObs();
  document.querySelectorAll('.ct[data-vid], .dup-th[data-vid]').forEach(el => {
    const id = el.dataset.vid, v = thumbMap[id];
    if (v && v.length) { applyThumb(el, v[0]); return; }
    if (!(id in thumbMap)) thumbObs.observe(el);
  });
}

function queueThumb(id) {
  thumbMap[id] = null;
  thumbQueue.push(id);
  runThumbQ();
}

async function runThumbQ() {
  if (thumbRunning >= 3 || !thumbQueue.length) return;
  thumbRunning++;
  const id = thumbQueue.shift();
  try {
    const d = await (await fetch('/api/thumbs/' + id + '/generate', { method: 'POST' })).json();
    thumbMap[id] = d.count > 0 ? Array.from({ length: d.count }, (_, i) => '/api/thumbs/' + id + '/' + i) : [];
    if (thumbMap[id].length) {
      thumbMap[id].forEach(u => { const i = new Image(); i.src = u; });
      const el = document.querySelector('.ct[data-vid="' + id + '"]');
      if (el) applyThumb(el, thumbMap[id][0]);
    }
  } catch { thumbMap[id] = []; }
  thumbRunning--;
  runThumbQ();
}

function applyThumb(el, url) {
  el.style.background = 'url(' + url + ') center/cover no-repeat';
  el.classList.add('has-thumb');
}

// ─── Hover Preview ───
document.addEventListener('mouseenter', e => {
  const ct = e.target.closest?.('.ct[data-vid], .dup-th[data-vid]');
  if (!ct) return;
  clearTimeout(hoverTimer);
  hoverEl = ct;
  hoverTimer = setTimeout(() => {
    if (ct !== hoverEl || ct.querySelector('.ct-preview')) return;
    const vid = document.createElement('video');
    vid.className = 'ct-preview';
    vid.muted = true;
    vid.playsInline = true;
    vid.preload = 'metadata';
    vid.src = '/api/stream/' + ct.dataset.vid;
    vid.addEventListener('loadedmetadata', () => {
      vid.currentTime = vid.duration > 0 ? vid.duration / 2 : 0;
    });
    vid.addEventListener('seeked', function onSeeked() {
      vid.removeEventListener('seeked', onSeeked);
      vid.play().catch(() => {});
      vid._stop = setTimeout(() => vid.pause(), 10000);
    });
    ct.appendChild(vid);
  }, 250);
}, true);

document.addEventListener('mouseleave', e => {
  const ct = e.target.closest?.('.ct[data-vid], .dup-th[data-vid]');
  if (!ct || ct !== hoverEl) return;
  clearTimeout(hoverTimer);
  hoverEl = null;
  const vid = ct.querySelector('.ct-preview');
  if (vid) { clearTimeout(vid._stop); vid.pause(); vid.src = ''; vid.remove(); }
}, true);
