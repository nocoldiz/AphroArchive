import { signal } from '@preact/signals';
import { allVideos, currentCategory, bookmarkVidIds, currentView, currentVideo } from './store';

// ─── Zapping Mode State ───
export const zapOn = signal(false);
export const zapLock = signal(false);
export const zapIv = signal(10); // Default interval

let zapTimer: any = null;
let zapNextVid: any = null;
let zapNextTime = 0;
let activePlayer = 'video-player';

const $ = (id: string) => {
  const el = document.getElementById(id);
  return {
    el,
    add: (cls: string) => el?.classList.add(cls),
    remove: (cls: string) => el?.classList.remove(cls),
    text: (txt: string) => { if (el) el.textContent = txt; },
    html: (html: string) => { if (el) el.innerHTML = html; },
    val: (v: any) => { if (el) (el as HTMLInputElement).value = v; },
    show: (show: boolean) => { if (el) el.style.display = show ? '' : 'none'; }
  };
};

const toast = (msg: string) => {
  const w = window as any;
  if (w.toast) w.toast(msg);
};

export function toggleZapping() {
  if (zapOn.value) {
    stopZapping();
  } else {
    // Stop mosaic if running
    const w = window as any;
    if (w.mosaicOn && w.stopMosaic) w.stopMosaic();
    
    const firstVid = getRandomVidForZapping();
    if (!firstVid) {
      toast('No videos found for zapping');
      return;
    }
    
    currentVideo.value = firstVid;
    currentView.value = 'player';
    
    zapOn.value = true;
    zapLock.value = false;
    
    const zapUi = document.getElementById('zap-ui');
    if (zapUi) zapUi.style.display = 'flex';
    
    $('zap-lock-btn').text('Lock to Current');
    
    setTimeout(startZapping, 300); // Wait for PlayerView to mount
  }
}

export function stopZapping() {
  zapOn.value = false;
  clearTimeout(zapTimer);
  
  const zapUi = document.getElementById('zap-ui');
  if (zapUi) zapUi.style.display = 'none';
  
  $('video-player').show(true);
  $('video-player-zap').show(false);
  activePlayer = 'video-player';
  
  currentView.value = 'home';
}

export function setZapIv(delta: number) {
  zapIv.value = Math.max(2, zapIv.value + delta);
  $('zap-interval').text(zapIv.value + 's');
}

export function toggleZapLock() {
  zapLock.value = !zapLock.value;
  $('zap-lock-btn').text(zapLock.value ? 'Unlock (Resume Zapping)' : 'Lock to Current');
  
  if (!zapLock.value) {
    zapTimer = setTimeout(doZapSwitch, zapIv.value * 1000);
  } else {
    clearTimeout(zapTimer);
  }
}

function getRandomVidForZapping() {
  const cat = currentCategory.value;
  const V = allVideos.value;
  const bms = bookmarkVidIds.value;
  
  let list = cat ? V.filter(v => v.category === cat || v.catPath === cat) : V;
  list = list.filter(v => !bms.has(v.id));
  
  if (!list.length) list = V.filter(v => !bms.has(v.id));
  if (!list.length) list = V;
  if (!list.length) return null;
  
  return list[Math.floor(Math.random() * list.length)];
}

export async function startZapping() {
  await prepareNextZap();
  doZapSwitch();
}

export async function prepareNextZap() {
  if (zapLock.value) return;
  
  zapNextVid = getRandomVidForZapping();
  if (!zapNextVid) return;
  
  const d = await (await fetch('/api/videos/' + zapNextVid.id)).json();
  const duration = d.video.duration || 60;
  zapNextTime = Math.random() * Math.max(0, duration - zapIv.value);
  
  const nextPlayerId = activePlayer === 'video-player' ? 'video-player-zap' : 'video-player';
  const vpNext = document.getElementById(nextPlayerId) as HTMLVideoElement;
  if (vpNext) {
    vpNext.src = '/api/stream/' + zapNextVid.id + '#t=' + zapNextTime;
    vpNext.load();
    vpNext.pause();
  }
}

export async function doZapSwitch() {
  if (!zapOn.value || zapLock.value) return;
  if (!zapNextVid) await prepareNextZap();
  if (!zapNextVid) return;

  const nextPlayerId = activePlayer === 'video-player' ? 'video-player-zap' : 'video-player';
  const currPlayerId = activePlayer;
  const vpNext = document.getElementById(nextPlayerId) as HTMLVideoElement;
  const vpCurr = document.getElementById(currPlayerId) as HTMLVideoElement;

  if (vpNext) {
    vpNext.style.display = '';
    vpNext.currentTime = zapNextTime;
    vpNext.play().catch(e => console.log('Autoplay prevented:', e));
  }
  
  if (vpCurr) {
    vpCurr.pause();
    vpCurr.style.display = 'none';
  }
  
  activePlayer = nextPlayerId;

  // Update current video in store!
  const v = allVideos.value.find(x => x.id === zapNextVid.id);
  if (v) {
    (window as any).curV = v; // Bridge for now
    currentVideo.value = v; // Update Preact state!
  }
  
  $('player-title').text(zapNextVid.name);
  const pCat = document.getElementById('player-category');
  if (pCat) pCat.textContent = zapNextVid.category;

  prepareNextZap();
  zapTimer = setTimeout(doZapSwitch, zapIv.value * 1000);
}

// Bridge to window
if (typeof window !== 'undefined') {
  (window as any).toggleZapping = toggleZapping;
  (window as any).stopZapping = stopZapping;
  (window as any).setZapIv = setZapIv;
  (window as any).toggleZapLock = toggleZapLock;
  (window as any).startZapping = startZapping;
}
