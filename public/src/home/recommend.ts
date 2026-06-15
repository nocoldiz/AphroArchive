// ─── On-device recommendation scoring ────────────────────────────────
// Pure client-side scoring used by the "Recommended For You" and
// "What to Watch Tonight" widgets. Builds a taste profile from watch
// history (categories / tags / actors / channels) and scores unwatched
// videos by overlap. No network, no model.

import { Video } from '../types';

interface TasteProfile {
  cats: Map<string, number>;
  tags: Map<string, number>;
  actors: Map<string, number>;
  channels: Map<string, number>;
  watched: Set<string>;
}

function bump(m: Map<string, number>, key: string | undefined, weight: number) {
  if (!key) return;
  m.set(key, (m.get(key) || 0) + weight);
}

export function buildTaste(history: Video[]): TasteProfile {
  const p: TasteProfile = {
    cats: new Map(), tags: new Map(), actors: new Map(),
    channels: new Map(), watched: new Set(),
  };
  // Most recent history first → earlier entries weigh slightly more.
  history.forEach((v, i) => {
    if (!v) return;
    p.watched.add(v.id);
    const recency = Math.max(0.3, 1 - i * 0.04);
    bump(p.cats, v.catPath || v.category, recency);
    (v.tags || []).forEach(t => bump(p.tags, t.toLowerCase(), recency));
    (v.actors || []).forEach(a => bump(p.actors, a, recency * 1.5));
    bump(p.channels, v.channel, recency);
  });
  return p;
}

export function scoreVideo(v: Video, p: TasteProfile): number {
  let s = 0;
  s += (p.cats.get(v.catPath || v.category) || 0) * 3;
  (v.tags || []).forEach(t => { s += (p.tags.get(t.toLowerCase()) || 0) * 2; });
  (v.actors || []).forEach(a => { s += (p.actors.get(a) || 0) * 4; });
  s += (p.channels.get(v.channel || '') || 0) * 2;
  return s;
}

// Returns up to `limit` unwatched local videos ranked by taste overlap.
// Falls back to most-recent when there's no usable history signal.
export function recommend(all: Video[], history: Video[], limit = 20): Video[] {
  const p = buildTaste(history);
  const pool = all.filter(v => !v.isLink && !p.watched.has(v.id));
  const hasSignal = p.cats.size || p.tags.size || p.actors.size;

  if (!hasSignal) {
    return [...pool].sort((a, b) => b.mtime - a.mtime).slice(0, limit);
  }

  return pool
    .map(v => ({ v, s: scoreVideo(v, p) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || b.v.mtime - a.v.mtime)
    .slice(0, limit)
    .map(x => x.v);
}
