import { signal } from '@preact/signals';
import { allVideos, currentCategory, linkVidIds, currentView, currentVideo } from './store';

export const zapOn = signal(false);
export const zapLock = signal(false);
export const zapIv = signal(10);
export const zapStartTime = signal(0);

let zapTimer: any = null;
let zapNextVid: any = null;
let zapNextTime = 0;
let _preparing = false;

const toast = (msg: string) => {
  const w = window as any;
  if (w.toast) w.toast(msg);
};

function getRandomVidForZapping() {
  const cat = currentCategory.value;
  const V = allVideos.value;
  const bms = linkVidIds.value;
  const isStreamable = (v: any) => !v.isLink && !bms.has(v.id);

  let list = cat ? V.filter(v => {
    const cl = cat.toLowerCase().replace(/\\/g, '/');
    const vp = (v.catPath || '').toLowerCase().replace(/\\/g, '/');
    return isStreamable(v) && (vp === cl || vp.startsWith(cl + '/') || v.category === cat);
  }) : V.filter(isStreamable);

  if (!list.length) list = V.filter(isStreamable);
  if (!list.length) list = V.filter(v => !v.isLink);
  if (!list.length) return null;

  return list[Math.floor(Math.random() * list.length)];
}

export async function prepareNextZap() {
  if (zapLock.value || _preparing) return;
  _preparing = true;

  try {
    const vid = getRandomVidForZapping();
    if (!vid) return;

    const d = await fetch('/api/videos/' + vid.id).then(r => r.json()).catch(() => null);
    if (!d) return;

    const duration = d.video?.duration || 60;
    const startTime = Math.random() * Math.max(0, duration - zapIv.value);

    zapNextVid = vid;
    zapNextTime = startTime;

    const preload = document.getElementById('zap-preload') as HTMLVideoElement;
    if (preload) {
      preload.src = '/api/stream/' + vid.id;
      preload.load();
    }
  } finally {
    _preparing = false;
  }
}

export async function doZapSwitch() {
  if (!zapOn.value || zapLock.value) return;

  if (!zapNextVid) await prepareNextZap();
  if (!zapNextVid) return;

  const nextVid = zapNextVid;
  const nextTime = zapNextTime;
  zapNextVid = null;
  zapNextTime = 0;

  const v = allVideos.value.find(x => x.id === nextVid.id) || nextVid;
  zapStartTime.value = nextTime;
  currentVideo.value = v;

  prepareNextZap();
  zapTimer = setTimeout(doZapSwitch, zapIv.value * 1000);
}

export async function startZapping() {
  await prepareNextZap();
  doZapSwitch();
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
  currentVideo.value = firstVid;
  currentView.value = 'player';

  zapOn.value = true;
  zapLock.value = false;

  setTimeout(startZapping, 300);
}

export function stopZapping() {
  zapOn.value = false;
  clearTimeout(zapTimer);
  zapNextVid = null;
  zapNextTime = 0;
  zapStartTime.value = 0;

  const preload = document.getElementById('zap-preload') as HTMLVideoElement;
  if (preload) {
    preload.removeAttribute('src');
    preload.load();
  }

  currentView.value = 'hub';
}

export function setZapIv(delta: number) {
  zapIv.value = Math.max(2, zapIv.value + delta);
}

export function toggleZapLock() {
  zapLock.value = !zapLock.value;

  if (!zapLock.value) {
    zapTimer = setTimeout(doZapSwitch, zapIv.value * 1000);
  } else {
    clearTimeout(zapTimer);
  }
}

if (typeof window !== 'undefined') {
  (window as any).toggleZapping = toggleZapping;
  (window as any).stopZapping = stopZapping;
  (window as any).setZapIv = setZapIv;
  (window as any).toggleZapLock = toggleZapLock;
  (window as any).startZapping = startZapping;
}
