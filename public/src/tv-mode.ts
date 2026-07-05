import { signal } from '@preact/signals';
import { Video } from './types';
import { currentVideo, currentView, allVideos, folders } from './store';
import { zapOn, stopZapping } from './zap';

export interface TVChannel {
  id: string;
  name: string;
  type: 'folder' | 'tag' | 'collection';
  videos: Video[];
}

export const isTVMode = signal<boolean>(false);
export const tvChannels = signal<TVChannel[]>([]);
export const tvCurrentChannelIdx = signal<number>(0);
export const tvCurrentVideoIdx = signal<number>(0);
// Seek target for the next video load (consumed once by AdvancedPlayer via startTime prop)
export const tvStartTime = signal<number>(0);
// Ticks once per second while on air so the channel list can refresh "now playing".
export const tvTick = signal<number>(0);

function readTVFavs(): Set<string> {
  try {
    const arr = JSON.parse(localStorage.getItem('tvFavChannels') || '[]');
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}

export const tvFavChannels = signal<Set<string>>(readTVFavs());

export function toggleTVFav(channelId: string) {
  const next = new Set(tvFavChannels.value);
  if (next.has(channelId)) next.delete(channelId); else next.add(channelId);
  tvFavChannels.value = next;
  try { localStorage.setItem('tvFavChannels', JSON.stringify([...next])); } catch {}
}

// Every channel shares a single broadcast epoch, so they all "transmit" in
// parallel: channel N's live position is always (now - epoch) into its own
// looping schedule, whether or not you've ever tuned in. Tuning away and back
// therefore returns you to a stream that advanced by exactly the wall-clock
// time you were gone.
let tvEpoch = 0;
let tickTimer: any = null;

function getBroadcastClock(): number {
  return (Date.now() - tvEpoch) / 1000;
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function setBodyTV(on: boolean) {
  if (typeof document === 'undefined') return;
  document.body.classList.toggle('tv-active', on);
}

export async function initTVMode(): Promise<boolean> {
  const folderList = folders.value;
  const videos = allVideos.value;
  const channels: TVChannel[] = [];

  for (const folder of folderList) {
    if (folder.encrypted || folder.opened) continue;
    const vids = videos.filter(v => !v.isLink && (v.catPath === folder.path || v.category === folder.path));
    if (vids.length > 0) {
      channels.push({ id: `folder:${folder.path}`, name: folder.name, type: 'folder', videos: shuffle(vids) });
    }
  }

  // Tag channels — only tags with more than 10 videos
  const tagMap = new Map<string, Video[]>();
  for (const v of videos) {
    if (v.isLink) continue;
    for (const tag of (v.tags || [])) {
      const arr = tagMap.get(tag) || [];
      arr.push(v);
      tagMap.set(tag, arr);
    }
  }
  for (const [tag, vids] of tagMap) {
    if (vids.length > 10) {
      channels.push({ id: `tag:${tag}`, name: `#${tag}`, type: 'tag', videos: shuffle(vids) });
    }
  }

  // Playlist (collection) channels — curated order is preserved so the playlist
  // plays in sequence, just time-shifted like every other channel.
  try {
    const cols = await fetch('/api/collections').then(r => r.json());
    if (Array.isArray(cols)) {
      for (const col of cols) {
        const vids = (col.ids || [])
          .map((id: string) => videos.find(v => v.id === id))
          .filter((v: Video | undefined): v is Video => !!v && !v.isLink);
        if (vids.length > 0) {
          channels.push({ id: `collection:${col.name}`, name: col.name, type: 'collection', videos: vids });
        }
      }
    }
  } catch {}

  if (channels.length === 0) {
    (window as any).toast?.('No TV channels available — add folders, a playlist, or tag 10+ videos with a common tag');
    return false;
  }

  tvChannels.value = shuffle(channels);
  // Seed the broadcast clock in the past so tuning in — even the very first
  // channel — lands mid-stream, never at a video's start. Modulo in
  // resolveEntry keeps the offset valid for every channel's schedule length.
  tvEpoch = Date.now() - Math.floor(Math.random() * 3600) * 1000;
  return true;
}

// Resolve which video and seek-to position corresponds to the current broadcast
// clock for a channel. Pure — depends only on the shared epoch.
function resolveEntry(idx: number): { videoIdx: number; seekTo: number } {
  const channel = tvChannels.value[idx];
  if (!channel || channel.videos.length === 0) return { videoIdx: 0, seekTo: 0 };

  const totalDur = channel.videos.reduce((a, v) => a + (v.duration || 300), 0);
  if (totalDur === 0) return { videoIdx: 0, seekTo: 0 };

  let pos = getBroadcastClock() % totalDur;
  for (let i = 0; i < channel.videos.length; i++) {
    const dur = channel.videos[i].duration || 300;
    if (pos < dur) return { videoIdx: i, seekTo: pos };
    pos -= dur;
  }
  return { videoIdx: 0, seekTo: 0 };
}

// The video currently "on air" for a channel — used by the side channel list.
export function channelNowPlaying(idx: number): Video | null {
  const channel = tvChannels.value[idx];
  if (!channel || channel.videos.length === 0) return null;
  return channel.videos[resolveEntry(idx).videoIdx] || null;
}

export function playChannel(idx: number) {
  const channel = tvChannels.value[idx];
  if (!channel || channel.videos.length === 0) return;
  tvCurrentChannelIdx.value = idx;
  const { videoIdx, seekTo } = resolveEntry(idx);
  tvCurrentVideoIdx.value = videoIdx;
  tvStartTime.value = seekTo;
  currentVideo.value = channel.videos[videoIdx];
  currentView.value = 'player';
}

export function nextTVChannel() {
  const total = tvChannels.value.length;
  if (total === 0) return;
  playChannel((tvCurrentChannelIdx.value + 1) % total);
}

export function prevTVChannel() {
  const total = tvChannels.value.length;
  if (total === 0) return;
  playChannel((tvCurrentChannelIdx.value - 1 + total) % total);
}

// Called when the current video ends — advance to whatever the broadcast clock
// now points at (normally the next video from its start). Guards against float
// drift resolving back to the same slot by forcing the next one.
export function nextVideoInChannel() {
  const idx = tvCurrentChannelIdx.value;
  const channel = tvChannels.value[idx];
  if (!channel || channel.videos.length === 0) return;
  const { videoIdx, seekTo } = resolveEntry(idx);
  let nextIdx = videoIdx;
  let seek = seekTo;
  if (nextIdx === tvCurrentVideoIdx.value) {
    nextIdx = (tvCurrentVideoIdx.value + 1) % channel.videos.length;
    seek = 0;
  }
  tvCurrentVideoIdx.value = nextIdx;
  tvStartTime.value = seek;
  currentVideo.value = channel.videos[nextIdx];
  currentView.value = 'player';
}

export function stopTVMode() {
  isTVMode.value = false;
  tvChannels.value = [];
  tvStartTime.value = 0;
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  setBodyTV(false);
}

export async function toggleTVMode() {
  if (isTVMode.value) {
    stopTVMode();
    return;
  }
  // Stop zapping if active
  if (zapOn.value) stopZapping();

  const ok = await initTVMode();
  if (!ok) return;

  isTVMode.value = true;
  setBodyTV(true);
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(() => { tvTick.value = tvTick.value + 1; }, 1000);
  playChannel(0);
}

if (typeof window !== 'undefined') {
  (window as any).toggleTVMode = toggleTVMode;
  (window as any).tvNextChannel = nextTVChannel;
  (window as any).tvPrevChannel = prevTVChannel;
}
