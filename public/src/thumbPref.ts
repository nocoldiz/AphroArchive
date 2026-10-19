// Per-video preferred thumbnail index. The server always generates 5
// thumbnails (indices 0–4); by default cards show index 0. This lets the user
// pick a different frame as the card image. Stored client-side so it needs no
// server schema change.
const LS_KEY = 'thumbPref';

// Parsed once and kept in memory: every grid card reads this on mount, so
// re-parsing the localStorage blob per card was O(cards × prefs).
let _cache: Record<string, number> | null = null;

function load(): Record<string, number> {
  if (_cache) return _cache;
  try { _cache = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch { _cache = {}; }
  return _cache!;
}

// Another tab changed the prefs — drop the cache so the next read re-parses.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => { if (e.key === LS_KEY || e.key === null) _cache = null; });
}

export function getThumbPref(videoId: string): number {
  const v = load()[videoId];
  return typeof v === 'number' ? v : 0;
}

export function setThumbPref(videoId: string, idx: number) {
  const map = load();
  if (idx === 0) delete map[videoId];
  else map[videoId] = idx;
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)); } catch {}
  // Let any mounted cards refresh their image.
  window.dispatchEvent(new CustomEvent('thumbpref-changed', { detail: { videoId, idx } }));
}
