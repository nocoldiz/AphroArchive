import { signal } from '@preact/signals';
import { Video } from './types';
import { currentVideo, currentView, allVideos, folders } from './store';

export interface TVChannel {
  id: string;
  name: string;
  type: 'folder' | 'tag';
  videos: Video[];
}

export const isTVMode = signal<boolean>(false);
export const tvChannels = signal<TVChannel[]>([]);
export const tvCurrentChannelIdx = signal<number>(0);
export const tvCurrentVideoIdx = signal<number>(0);
// Seek target for the next video load (consumed once by AdvancedPlayer via startTime prop)
export const tvStartTime = signal<number>(0);

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

// Per-channel time-shift state: stream position in seconds at last pause, and wall clock then.
// getEffectiveStreamPos(idx) returns current virtual "broadcast clock" position.
const _channelStates = new Map<number, { streamPos: number; lastTime: number }>();

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function initTVMode(): boolean {
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

  if (channels.length === 0) {
    (window as any).toast?.('No TV channels available — add folders or tag 10+ videos with a common tag');
    return false;
  }

  tvChannels.value = shuffle(channels);
  _channelStates.clear();
  return true;
}

function getEffectiveStreamPos(idx: number): number {
  const s = _channelStates.get(idx);
  if (!s) return 0;
  return s.streamPos + (Date.now() - s.lastTime) / 1000;
}

// Resolve which video and seek-to position corresponds to the current broadcast clock
function resolveEntry(idx: number): { videoIdx: number; seekTo: number } {
  const channel = tvChannels.value[idx];
  if (!channel || channel.videos.length === 0) return { videoIdx: 0, seekTo: 0 };

  const streamPos = getEffectiveStreamPos(idx);
  _channelStates.set(idx, { streamPos, lastTime: Date.now() });

  const totalDur = channel.videos.reduce((a, v) => a + (v.duration || 300), 0);
  if (totalDur === 0) return { videoIdx: 0, seekTo: 0 };

  let pos = streamPos % totalDur;
  for (let i = 0; i < channel.videos.length; i++) {
    const dur = channel.videos[i].duration || 300;
    if (pos < dur) return { videoIdx: i, seekTo: pos };
    pos -= dur;
  }
  return { videoIdx: 0, seekTo: 0 };
}

function snapshotCurrentChannel() {
  const idx = tvCurrentChannelIdx.value;
  const pos = getEffectiveStreamPos(idx);
  _channelStates.set(idx, { streamPos: pos, lastTime: Date.now() });
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
  snapshotCurrentChannel();
  const total = tvChannels.value.length;
  if (total === 0) return;
  playChannel((tvCurrentChannelIdx.value + 1) % total);
}

export function prevTVChannel() {
  snapshotCurrentChannel();
  const total = tvChannels.value.length;
  if (total === 0) return;
  playChannel((tvCurrentChannelIdx.value - 1 + total) % total);
}

// Called when the current video ends — advance within the same channel
export function nextVideoInChannel() {
  const idx = tvCurrentChannelIdx.value;
  const channel = tvChannels.value[idx];
  if (!channel || channel.videos.length === 0) return;
  const nextVideoIdx = (tvCurrentVideoIdx.value + 1) % channel.videos.length;
  tvCurrentVideoIdx.value = nextVideoIdx;
  tvStartTime.value = 0;
  currentVideo.value = channel.videos[nextVideoIdx];
  currentView.value = 'player';
  // Keep the clock ticking — don't reset streamPos since we're still "on air"
}

export function stopTVMode() {
  isTVMode.value = false;
  tvChannels.value = [];
  _channelStates.clear();
  tvStartTime.value = 0;
}

export function toggleTVMode() {
  if (isTVMode.value) {
    stopTVMode();
    return;
  }
  // Stop zapping if active
  const w = window as any;
  if (w.zapOn?.value && w.stopZapping) w.stopZapping();

  const ok = initTVMode();
  if (!ok) return;

  isTVMode.value = true;
  playChannel(0);
}

if (typeof window !== 'undefined') {
  (window as any).toggleTVMode = toggleTVMode;
  (window as any).tvNextChannel = nextTVChannel;
  (window as any).tvPrevChannel = prevTVChannel;
}
