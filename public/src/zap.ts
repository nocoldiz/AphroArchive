import { signal } from '@preact/signals';
import { allVideos, currentFolder, linkVidIds, currentView, currentVideo } from './store';

// When non-null, refillZapQueue picks from this pool instead of using currentFolder.
export const zapFilteredPool = signal<any[] | null>(null);

export interface ZapQueueItem {
  video: any;
  startTime: number;
}

export const zapOn = signal(false);
export const zapLock = signal(false);
export const zapMinIv = signal(parseInt(localStorage.getItem('zapMinIv') || '5', 10));
export const zapMaxIv = signal(parseInt(localStorage.getItem('zapMaxIv') || '20', 10));
export const zapStartTime = signal(0);
export const zapRemaining = signal(0);
export const zapTotalIv = signal(0);
export const zapQueue = signal<ZapQueueItem[]>([]);
export const zapHistory = signal<any[]>([]);

const QUEUE_SIZE = 6;
const HISTORY_LIMIT = 25;

let zapTimer: any = null;
let zapTickTimer: any = null;
let zapDeadline = 0;

const toast = (msg: string) => {
  const w = window as any;
  if (w.toast) w.toast(msg);
};

function getRandomVidForZapping(excludeIds?: Set<string>) {
  const pool = zapFilteredPool.value;
  const bms = linkVidIds.value;

  if (pool !== null) {
    const candidates = pool.filter(v => !v.isLink && !bms.has(v.id) && (!excludeIds || !excludeIds.has(v.id)));
    if (!candidates.length) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  const cat = currentFolder.value;
  const V = allVideos.value;
  const isStreamable = (v: any) => !v.isLink && !bms.has(v.id) && (!excludeIds || !excludeIds.has(v.id));

  let list = cat ? V.filter(v => {
    const cl = cat.toLowerCase().replace(/\\/g, '/');
    const vp = (v.catPath || '').toLowerCase().replace(/\\/g, '/');
    return isStreamable(v) && (vp === cl || vp.startsWith(cl + '/') || v.category === cat);
  }) : V.filter(isStreamable);

  if (!list.length) list = V.filter(v => !v.isLink && !bms.has(v.id));
  if (!list.length) list = V.filter(v => !v.isLink);
  if (!list.length) return null;

  return list[Math.floor(Math.random() * list.length)];
}

function randomZapInterval() {
  const min = Math.max(1, Math.min(zapMinIv.value, zapMaxIv.value));
  const max = Math.max(min, zapMaxIv.value);
  return min + Math.random() * (max - min);
}

export function pickStartTime(vid: any) {
  const duration = vid.duration || 60;
  const cap = Math.max(zapMinIv.value, zapMaxIv.value);
  return Math.random() * Math.max(0, duration - cap);
}

function buildQueueItem(excludeIds: Set<string>): ZapQueueItem | null {
  const vid = getRandomVidForZapping(excludeIds);
  if (!vid) return null;
  return { video: vid, startTime: pickStartTime(vid) };
}

function preloadZapItem(item: ZapQueueItem | undefined) {
  if (!item) return;
  const preload = document.getElementById('zap-preload') as HTMLVideoElement;
  if (!preload) return;
  const src = item.video.isVault ? '/api/vault/stream/' + item.video.id : '/api/stream/' + item.video.id;
  if (preload.dataset.vid === item.video.id) return;
  preload.dataset.vid = item.video.id;
  preload.src = src;
  preload.load();
}

export function refillZapQueue() {
  const q = [...zapQueue.value];
  const excludeIds = new Set<string>(q.map(i => i.video.id));
  if (currentVideo.value) excludeIds.add(currentVideo.value.id);

  while (q.length < QUEUE_SIZE) {
    const item = buildQueueItem(excludeIds);
    if (!item) break;
    excludeIds.add(item.video.id);
    q.push(item);
  }

  zapQueue.value = q;
  preloadZapItem(q[0]);
}

export function setZapQueueFromList(videos: any[]) {
  const shuffled = [...videos].sort(() => Math.random() - 0.5);
  const bms = linkVidIds.value;
  const streamable = shuffled.filter(v => !v.isLink && !bms.has(v.id));
  const items: ZapQueueItem[] = streamable.slice(0, QUEUE_SIZE).map(v => ({
    video: v,
    startTime: pickStartTime(v),
  }));
  zapQueue.value = items;
  preloadZapItem(items[0]);
}

function clearZapTimers() {
  clearTimeout(zapTimer);
  clearInterval(zapTickTimer);
}

export function startZapTimer() {
  clearZapTimers();
  if (!zapOn.value || zapLock.value) return;

  const ivSec = randomZapInterval();
  zapDeadline = Date.now() + ivSec * 1000;
  zapRemaining.value = ivSec;
  zapTotalIv.value = ivSec;

  zapTickTimer = setInterval(() => {
    zapRemaining.value = Math.max(0, (zapDeadline - Date.now()) / 1000);
  }, 100);

  zapTimer = setTimeout(() => doZapSwitch(), ivSec * 1000);
}

function applyQueueItem(item: ZapQueueItem) {
  if (currentVideo.value) {
    zapHistory.value = [...zapHistory.value, currentVideo.value].slice(-HISTORY_LIMIT);
  }
  zapStartTime.value = item.startTime;
  currentVideo.value = item.video;
  refillZapQueue();
  startZapTimer();
}

export function doZapSwitch() {
  if (!zapOn.value) return;

  const q = zapQueue.value;
  if (!q.length) {
    refillZapQueue();
    const retry = zapQueue.value;
    if (!retry.length) return;
    const [next, ...rest] = retry;
    zapQueue.value = rest;
    applyQueueItem(next);
    return;
  }

  const [next, ...rest] = q;
  zapQueue.value = rest;
  applyQueueItem(next);
}

export function jumpToZapVideo(item: ZapQueueItem) {
  if (!zapOn.value) return;
  const q = zapQueue.value;
  const idx = q.findIndex(i => i.video.id === item.video.id);
  zapQueue.value = idx !== -1 ? [...q.slice(0, idx), ...q.slice(idx + 1)] : q;
  applyQueueItem(item);
}

export function jumpToPrevZap() {
  if (!zapOn.value) return;
  const hist = zapHistory.value;
  if (!hist.length) return;

  const prev = hist[hist.length - 1];
  zapHistory.value = hist.slice(0, -1);

  if (currentVideo.value) {
    zapQueue.value = [{ video: currentVideo.value, startTime: 0 }, ...zapQueue.value].slice(0, QUEUE_SIZE);
  }

  zapStartTime.value = 0;
  currentVideo.value = prev;
  startZapTimer();
}

export async function startZapping() {
  refillZapQueue();
  startZapTimer();
}

export function toggleZapping() {
  if (zapOn.value) {
    stopZapping();
    return;
  }

  const w = window as any;
  if (w.mosaicOn && w.stopMosaic) w.stopMosaic();

  const firstVid = getRandomVidForZapping();
  if (!firstVid) {
    toast('No videos found for zapping');
    return;
  }

  zapStartTime.value = 0;
  zapHistory.value = [];
  zapQueue.value = [];
  currentVideo.value = firstVid;
  currentView.value = 'player';

  zapOn.value = true;
  zapLock.value = false;

  setTimeout(startZapping, 300);
}

function cleanupZap() {
  clearZapTimers();
  zapOn.value = false;
  zapQueue.value = [];
  zapHistory.value = [];
  zapStartTime.value = 0;
  zapRemaining.value = 0;
  zapFilteredPool.value = null;

  const preload = document.getElementById('zap-preload') as HTMLVideoElement;
  if (preload) {
    delete preload.dataset.vid;
    preload.removeAttribute('src');
    preload.load();
  }
}

export function stopZapping() {
  cleanupZap();
  currentView.value = 'hub';
}

export function openAndStopZapping() {
  cleanupZap();
  // Keep currentVideo and currentView='player' → PlayerView renders normally
}

export function setZapMinIv(val: number) {
  const v = Math.max(1, Math.min(120, Math.round(val)));
  zapMinIv.value = v;
  if (zapMaxIv.value < v) zapMaxIv.value = v;
  localStorage.setItem('zapMinIv', String(zapMinIv.value));
  localStorage.setItem('zapMaxIv', String(zapMaxIv.value));
  if (zapOn.value && !zapLock.value) startZapTimer();
}

export function setZapMaxIv(val: number) {
  const v = Math.max(1, Math.min(180, Math.round(val)));
  zapMaxIv.value = v;
  if (zapMinIv.value > v) zapMinIv.value = v;
  localStorage.setItem('zapMinIv', String(zapMinIv.value));
  localStorage.setItem('zapMaxIv', String(zapMaxIv.value));
  if (zapOn.value && !zapLock.value) startZapTimer();
}

export function toggleZapLock() {
  zapLock.value = !zapLock.value;

  if (!zapLock.value) {
    startZapTimer();
  } else {
    clearZapTimers();
    zapRemaining.value = 0;
    zapTotalIv.value = 0;
  }
}

if (typeof window !== 'undefined') {
  (window as any).toggleZapping = toggleZapping;
  (window as any).stopZapping = stopZapping;
  (window as any).openAndStopZapping = openAndStopZapping;
  (window as any).setZapMinIv = setZapMinIv;
  (window as any).setZapMaxIv = setZapMaxIv;
  (window as any).toggleZapLock = toggleZapLock;
  (window as any).startZapping = startZapping;
}
