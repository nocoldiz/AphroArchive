import { signal, computed } from '@preact/signals';
import { allVideos } from './store';
import { Video } from './types';

export interface DbEpisode {
  season: number;
  episode: number;
  name: string | null;
  duration: number | null;
  videoId: string | null;
}

export interface DbSeriesEntry {
  key: string;
  name: string;
  cover: string;
  episodes: DbEpisode[];
}

export const dbSeriesList = signal<DbSeriesEntry[]>([]);

export async function loadDbSeries() {
  try {
    const r = await fetch('/api/db/series');
    const d = await r.json();
    dbSeriesList.value = d.series || [];
  } catch {}
}

export interface Episode {
  video: Video;
  season: number;
  episode: number;
}

export interface SeriesEntry {
  name: string;          // display name (e.g. "Breaking Bad")
  key: string;           // lowercase grouping key
  episodes: Episode[];   // sorted by season then episode
  seasons: number[];     // distinct seasons, ascending
  cover: string;         // video id used for the cover thumbnail
}

// Strip extension, normalise separators, trim trailing/leading dashes & spaces
function clean(s: string): string {
  return s
    .replace(/[._]+/g, ' ')
    .replace(/[\s\-–—]+$/, '')
    .replace(/^[\s\-–—]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Parse a filename into { series, season, episode } when it matches a known
// TV-episode naming pattern (S01E02 / 1x02 / Season 1 Episode 2). null otherwise.
export function parseEpisode(name: string): { series: string; season: number; episode: number } | null {
  const base = name.replace(/\.[^.]+$/, '');
  let m;
  // S01E02 / s1e2
  if ((m = base.match(/^(.*?)[\s._-]*[Ss](\d{1,2})[\s._-]*[Ee](\d{1,3})\b/))) {
    return { series: clean(m[1]), season: +m[2], episode: +m[3] };
  }
  // 1x02 (separator required before the season number to avoid resolutions like 1920x1080)
  if ((m = base.match(/^(.*?)[\s._-]+(\d{1,2})[xX](\d{1,3})\b/))) {
    return { series: clean(m[1]), season: +m[2], episode: +m[3] };
  }
  // Season 1 Episode 2
  if ((m = base.match(/^(.*?)[\s._-]*Season[\s._-]*(\d{1,2})[\s._-]*Episode[\s._-]*(\d{1,3})\b/i))) {
    return { series: clean(m[1]), season: +m[2], episode: +m[3] };
  }
  return null;
}

// All recognised series, grouped from the full (local) video list. A group must
// contain at least 2 episodes to be considered a series.
export const seriesList = computed<SeriesEntry[]>(() => {
  const map = new Map<string, SeriesEntry>();
  for (const v of allVideos.value) {
    if ((v as any).isLink) continue;
    const p = parseEpisode(v.name);
    if (!p || !p.series) continue;
    const key = p.series.toLowerCase();
    let s = map.get(key);
    if (!s) { s = { name: p.series, key, episodes: [], seasons: [], cover: v.id }; map.set(key, s); }
    s.episodes.push({ video: v, season: p.season, episode: p.episode });
  }
  const out: SeriesEntry[] = [];
  for (const s of map.values()) {
    if (s.episodes.length < 2) continue;
    s.episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
    s.seasons = [...new Set(s.episodes.map(e => e.season))].sort((a, b) => a - b);
    s.cover = s.episodes[0].video.id;
    out.push(s);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
});

// When a player session was launched from the Series screen, these hold the
// active series and the season whose episodes fill the Next Up playlist.
export const playerSeries = signal<SeriesEntry | null>(null);
export const playerSeason = signal<number | null>(null);

// Combined list: auto-detected series with actual files, plus DB-only series
// (those in the DB whose key doesn't match any auto-detected series).
// DB-only entries carry no real Video objects — episodes.length === 0 but
// dbEpisodes is populated for display.
export const mergedSeriesList = computed<(SeriesEntry & { dbEpisodes?: DbEpisode[] })[]>(() => {
  const auto = seriesList.value;
  const db = dbSeriesList.value;
  if (db.length === 0) return auto;

  const autoKeys = new Set(auto.map(s => s.key));
  const dbOnly = db
    .filter(s => !autoKeys.has(s.key))
    .map(s => ({
      name: s.name,
      key: s.key,
      episodes: [] as Episode[],
      seasons: [...new Set(s.episodes.map(e => e.season))].sort((a, b) => a - b),
      cover: s.cover || '',
      dbEpisodes: s.episodes,
    }));

  return [...auto, ...dbOnly].sort((a, b) => a.name.localeCompare(b.name));
});
