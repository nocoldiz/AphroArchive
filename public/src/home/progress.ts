// ─── Playback progress tracking ──────────────────────────────────────
// Lightweight resume-position store kept entirely client-side in
// localStorage. Powers the "Continue Watching" home widget and the
// auto-resume seek in AdvancedPlayer. One JSON blob, id → {t,d,ts}.

const KEY = 'videoProgress';
const MAX_ENTRIES = 120;

export interface Progress {
  t: number;  // last position in seconds
  d: number;  // duration in seconds
  ts: number; // last updated (epoch ms)
}

type ProgressMap = Record<string, Progress>;

function read(): ProgressMap {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function write(m: ProgressMap) {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {}
}

export function getAllProgress(): ProgressMap {
  return read();
}

export function getProgress(id: string): Progress | null {
  return read()[id] || null;
}

// Persist a position. Drops entries that are basically unwatched (< 3s) or
// effectively finished (> 97%) so they don't clutter Continue Watching.
export function setProgress(id: string, t: number, d: number) {
  if (!id || !isFinite(t) || !isFinite(d) || d <= 0) return;
  const m = read();
  if (t < 3 || t >= d * 0.97) {
    if (!m[id]) return;
    delete m[id];
  } else {
    m[id] = { t, d, ts: Date.now() };
  }
  const ids = Object.keys(m);
  if (ids.length > MAX_ENTRIES) {
    ids.sort((a, b) => m[a].ts - m[b].ts)
       .slice(0, ids.length - MAX_ENTRIES)
       .forEach(k => delete m[k]);
  }
  write(m);
}

export function clearProgress(id: string) {
  const m = read();
  if (m[id]) {
    delete m[id];
    write(m);
  }
}

// Carry a resume position from one id to another. Used when a file op (rename /
// move) changes a video's id so the player resumes where it was instead of
// restarting from the beginning after the remount.
export function moveProgress(oldId: string, newId: string) {
  if (!oldId || !newId || oldId === newId) return;
  const m = read();
  if (!m[oldId]) return;
  m[newId] = m[oldId];
  delete m[oldId];
  write(m);
}
