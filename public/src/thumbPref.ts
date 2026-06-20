// Per-video preferred thumbnail index. The server always generates 5
// thumbnails (indices 0–4); by default cards show index 0. This lets the user
// pick a different frame as the card image. Stored client-side so it needs no
// server schema change.
const LS_KEY = 'thumbPref';

function load(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
}

export function getThumbPref(videoId: string): number {
  const v = load()[videoId];
  return typeof v === 'number' ? v : 0;
}

export function setThumbPref(videoId: string, idx: number) {
  const map = load();
  if (idx === 0) delete map[videoId];
  else map[videoId] = idx;
  localStorage.setItem(LS_KEY, JSON.stringify(map));
  // Let any mounted cards refresh their image.
  window.dispatchEvent(new CustomEvent('thumbpref-changed', { detail: { videoId, idx } }));
}
