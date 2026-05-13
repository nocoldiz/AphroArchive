import { signal } from '@preact/signals';
import { allVideos, currentVideo } from './store';

// ─── Playlist State ───
export const playlistSkipped = signal<Set<string>>(new Set());
export const pinnedV = signal<any>(null);
export const pinnedPl = signal<any[]>([]);
export let pinnedIdx = 0;

const $ = (id: string) => {
  const el = document.getElementById(id);
  return {
    el,
    add: (cls: string) => el?.classList.add(cls),
    remove: (cls: string) => el?.classList.remove(cls),
    text: (txt: string) => { if (el) el.textContent = txt; },
    html: (html: string) => { if (el) el.innerHTML = html; },
    val: (v: any) => { if (el) (el as HTMLInputElement).value = v; }
  };
};

const esc = (s: string) => s ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
const escA = (s: string) => s ? s.replace(/'/g, '&#39;').replace(/"/g, '&quot;') : '';
const hsh = (s: string) => {
  let h = 0;
  if (!s) return h;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h;
};

export function buildPl() {
  const curV = currentVideo.value;
  const V = allVideos.value;
  if (!curV || !V.length) return [];
  const skipped = playlistSkipped.value;
  return V.filter(v => !skipped.has(v.id));
}

export function renderPlaylist() {
  const pl = buildPl();
  const cols = ['#e84040','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];
  $('playlist-count').text(pl.length + ' video' + (pl.length !== 1 ? 's' : ''));
  const listEl = $('playlist-list').el;
  if (!listEl) return;

  if (!pl.length) {
    listEl.innerHTML = '<div class="playlist-empty">Nothing up next</div>';
    return;
  }

  const curV = currentVideo.value;
  listEl.innerHTML = pl.map((v, i) => {
    const c = cols[Math.abs(hsh(v.category)) % cols.length];
    const isCur = curV && v.id === curV.id;
    return '<div class="playlist-item' + (isCur ? ' cur' : '') + '" id="ppl-' + v.id + '" onclick="openVid(\'' + escA(v.id) + '\')">' +
      '<div class="card-thumb playlist-thumb" data-vid="' + v.id + '" style="background:linear-gradient(135deg,' + c + '12 0%,' + c + '06 100%)">' +
        '<div class="play-overlay" style="transform:translate(-50%,-50%) scale(0.6)"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></div>' +
        (v.durationF ? '<span class="duration-badge">' + v.durationF + '</span>' : '') +
        (v.rating ? '<div class="rating-badge"><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' + v.rating + '</div>' : '') +
      '</div>' +
      '<div class="playlist-info">' +
        '<span class="playlist-num">' + (i + 1) + '</span>' +
        '<span class="playlist-name">' + esc(v.name) + '</span>' +
        '<span class="playlist-category">' + esc(v.category) + '</span>' +
      '</div>' +
      '<button class="playlist-remove" onclick="event.stopPropagation();skipFromPlaylist(\'' + escA(v.id) + '\')" title="Remove from playlist">' +
        '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
      '</button>' +
      '</div>';
  }).join('');

  if (curV) {
    const curEl = document.getElementById('ppl-' + curV.id);
    if (curEl) setTimeout(() => curEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
  }
}

export function skipFromPlaylist(id: string) {
  const s = new Set(playlistSkipped.value);
  s.add(id);
  playlistSkipped.value = s;
  renderPlaylist();
}

export function toggleCardPlaylist(id: string, btn: HTMLElement) {
  const s = new Set(playlistSkipped.value);
  if (s.has(id)) {
    s.delete(id);
    btn.classList.remove('pl-off');
    btn.title = 'Remove from playlist';
    const w = window as any;
    if (w.toast) w.toast('Added to playlist', 900);
  } else {
    s.add(id);
    btn.classList.add('pl-off');
    btn.title = 'Add to playlist';
    const w = window as any;
    if (w.toast) w.toast('Removed from playlist', 900);
  }
  playlistSkipped.value = s;
  if (currentVideo.value) renderPlaylist();
}

export function playNext() {
  const curV = currentVideo.value;
  if (!curV) return;

  const pl = buildPl();
  if (pl.length < 2) return;
  const idx = pl.findIndex(v => v.id === curV.id);
  const nextVid = pl[(idx + 1) % pl.length];
  
  const w = window as any;
  if (w.openVid) w.openVid(nextVid.id);
}

export function playPrev() {
  const curV = currentVideo.value;
  if (!curV) return;

  const pl = buildPl();
  if (pl.length < 2) return;
  const idx = pl.findIndex(v => v.id === curV.id);
  const prevVid = pl[(idx - 1 + pl.length) % pl.length];
  
  const w = window as any;
  if (w.openVid) w.openVid(prevVid.id);
}

// ─── Pin (Dual Play) ───
export function togglePin() {
  if (pinnedV.value) unpinVideo(); else pinVideo();
}

export function pinVideo() {
  const curV = currentVideo.value;
  if (!curV) return;
  
  pinnedV.value = curV;
  pinnedPl.value = buildPl().slice();
  pinnedIdx = pinnedPl.value.findIndex(v => v.id === curV.id);
  if (pinnedIdx < 0) pinnedIdx = 0;
  
  const mainVid = document.getElementById('video-player') as HTMLVideoElement;
  const syncTime = mainVid ? mainVid.currentTime : 0;
  
  const vPin = document.getElementById('vPin') as HTMLVideoElement;
  if (vPin) {
    vPin.src = '/api/stream/' + curV.id;
    if (syncTime > 0) {
      vPin.addEventListener('loadedmetadata', function onMeta() {
        vPin.removeEventListener('loadedmetadata', onMeta);
        vPin.currentTime = syncTime;
      });
    }
  }
  
  $('pinTitle').text(curV.name);
  renderPinPlaylist();
  $('pinPanel').add('on');
  $('pinBtn').add('on');
  
  const pinBtnSpan = document.querySelector('#pinBtn span');
  if (pinBtnSpan) pinBtnSpan.textContent = 'Unpin';
}

export function unpinVideo() {
  pinnedV.value = null;
  pinnedPl.value = [];
  pinnedIdx = 0;
  
  const vPin = document.getElementById('vPin') as HTMLVideoElement;
  if (vPin) { vPin.pause(); vPin.src = ''; }
  
  $('pinPanel').remove('on');
  $('pinBtn').remove('on');
  
  const pinBtnSpan = document.querySelector('#pinBtn span');
  if (pinBtnSpan) pinBtnSpan.textContent = 'Pin';
}

export function renderPinPlaylist() {
  const listEl = $('pinList').el;
  if (!listEl) return;
  
  const cols = ['#e84040','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];
  const pl = pinnedPl.value;
  const pV = pinnedV.value;
  
  if (!pl.length) { listEl.innerHTML = ''; return; }
  
  listEl.innerHTML = pl.map((v, i) => {
    const c = cols[Math.abs(hsh(v.category)) % cols.length];
    const isCur = pV && v.id === pV.id;
    return '<div class="playlist-item' + (isCur ? ' cur' : '') + '" id="pinpl-' + v.id + '" onclick="pinJump(' + i + ')">' +
      '<div class="playlist-thumb card-thumb" data-vid="' + v.id + '" style="background:linear-gradient(135deg,' + c + '12 0%,' + c + '06 100%)">' +
        '<div class="play-overlay" style="transform:translate(-50%,-50%) scale(0.6)"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></div>' +
        (v.durationF ? '<span class="duration-badge">' + v.durationF + '</span>' : '') +
      '</div>' +
      '<div class="playlist-info">' +
        '<span class="playlist-num">' + (i + 1) + '</span>' +
        '<span class="playlist-name">' + esc(v.name) + '</span>' +
      '</div>' +
      '</div>';
  }).join('');
  
  if (pV) {
    const curEl = document.getElementById('pinpl-' + pV.id);
    if (curEl) setTimeout(() => curEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
  }
}

export function pinJump(idx: number) {
  const pl = pinnedPl.value;
  if (idx < 0 || idx >= pl.length) return;
  pinnedIdx = idx;
  const v = pl[idx];
  pinnedV.value = v;
  
  const vPin = document.getElementById('vPin') as HTMLVideoElement;
  if (vPin) vPin.src = '/api/stream/' + v.id;
  
  $('pinTitle').text(v.name);
  renderPinPlaylist();
}

export function pinNext() {
  const pl = pinnedPl.value;
  if (!pl.length) return;
  pinJump((pinnedIdx + 1) % pl.length);
}

export function pinPrev() {
  const pl = pinnedPl.value;
  if (!pl.length) return;
  pinJump((pinnedIdx - 1 + pl.length) % pl.length);
}

// Bridge to window
if (typeof window !== 'undefined') {
  (window as any).buildPl = buildPl;
  (window as any).renderPlaylist = renderPlaylist;
  (window as any).skipFromPlaylist = skipFromPlaylist;
  (window as any).toggleCardPlaylist = toggleCardPlaylist;
  (window as any).playNext = playNext;
  (window as any).playPrev = playPrev;
  (window as any).togglePin = togglePin;
  (window as any).pinJump = pinJump;
  (window as any).pinNext = pinNext;
  (window as any).pinPrev = pinPrev;
  
  // Event listeners
  document.addEventListener('DOMContentLoaded', () => {
    const vp = document.getElementById('video-player');
    if (vp) vp.addEventListener('ended', playNext);
    
    const vpPin = document.getElementById('vPin');
    if (vpPin) vpPin.addEventListener('ended', pinNext);
  });
}
