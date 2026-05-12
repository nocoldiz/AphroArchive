import { signal, computed } from '@preact/signals';
import { Video, Category, Actor, Studio, AppPrefs, ThumbnailGroup } from './types';
import * as api from './api';

// ─── Core State ──────────────────────────────────────────────────────
export const videos = signal<Video[]>([]);
export const allVideos = signal<Video[]>([]); // Full unfiltered list
export const categories = signal<Category[]>([]);
export const actors = signal<Actor[]>([]);
export const studios = signal<Studio[]>([]);
export const appPrefs = signal<Partial<AppPrefs>>({});

// ─── Navigation & View State ──────────────────────────────────────────
export const currentView = signal<string>('home');
export const currentVideo = signal<Video | null>(null);
export const currentCategory = signal<string>('');
export const currentTag = signal<string | null>(null);
export const currentActor = signal<string | null>(null);
export const currentStudio = signal<string | null>(null);

// Bridge for legacy JS
export const searchQuery = signal<string>('');
export const sortMode = signal<string>('date');
export const isShuffle = signal<boolean>(false);
export const vaultMode = signal<boolean>(false);
export const isVaultUnlocked = signal<boolean>(false);
export const videoSelMode = signal<boolean>(false);
export const selectedVideoIds = signal<Set<string>>(new Set());

(window as any)._categoriesSignal = categories;
(window as any)._videosSignal = videos;
(window as any)._currentViewSignal = currentView;

// Compatibility getters/setters for legacy globals
Object.defineProperty(window, 'V', { get() { return videos.value; }, set(v) { videos.value = v; } });
Object.defineProperty(window, 'cats', { get() { return categories.value; }, set(v) { categories.value = v; } });
Object.defineProperty(window, 'sort', { get() { return sortMode.value; }, set(v) { sortMode.value = v; } });
Object.defineProperty(window, 'cat', { get() { return currentCategory.value; }, set(v) { currentCategory.value = v; } });
Object.defineProperty(window, 'q', { get() { return searchQuery.value; }, set(v) { searchQuery.value = v; } });
Object.defineProperty(window, 'curV', { get() { return currentVideo.value; }, set(v) { currentVideo.value = v; } });
Object.defineProperty(window, 'shuf', { get() { return isShuffle.value; }, set(v) { isShuffle.value = v; } });
Object.defineProperty(window, 'vaultMode', { get() { return vaultMode.value; }, set(v) { vaultMode.value = v; } });
Object.defineProperty(window, 'videoSelMode', { get() { return videoSelMode.value; }, set(v) { videoSelMode.value = v; } });

// Other legacy globals from state.js initialized on window
const w = window as any;
w.favM = false;
w.favFilter = false;
w.renId = null;
w.galleryFilter = '';
w._renderLimit = 60;
w._allVideos = [];
w._dbTagTerms = {};
w.srcFilter = 'both';
w.recentMode = false;
w.recentVids = [];
w.movId = null;
w.movCurCat = '';
w.pinnedV = null;
w.pinnedPl = [];
w.pinnedIdx = 0;
w.mosaicOn = false;
w.mosaicTimer = null;
w.mosaicIv = 8;
w.vaultSelMode = false;
w.scraperMode = false;
w.importFavsMode = false;
w.booksMode = false;
w.audioMode = false;
w.photosMode = false;
w.pagesMode = false;
w.categoriesMode = false;
w.remoteMode = false;
w.vaultSel = new Set();
w.videoSel = new Set();
w.shiftKeyPressed = false;
w.vaultFiles = [];
w.vaultPl = [];
w.vaultPlIdx = 0;
w.vaultQ = '';
w.vaultSort = 'mtime';
w.vaultSortDir = 'desc';
w.vaultShuf = false;
w.vaultPhotoIdx = -1;
w.vaultPhotos = [];
w.vaultFolders = [];
w.vaultCurFolder = null;
w.VAULT_IMG_EXTS = new Set(['.jpg','.jpeg','.png','.gif','.webp','.avif','.bmp','.heic']);
w.VAULT_IMAGE_EXTS = new Set(['.jpg','.jpeg','.png','.gif','.webp','.avif','.bmp','.heic']);
w.studioMode = false;
w.curStudio = null;
w.actorMode = false;
w.curActor = null;
w.thumbMap = {};
w.thumbQueue = [];
w.thumbRunning = 0;
w.thumbObs = null;
w.hoverTimer = null;
w.hoverEl = null;
w.hoverIdx = 0;
w.zapOn = false;
w.zapTimer = null;
w.zapIv = 8;
w.zapLock = false;
w.zapNextVid = null;
w.zapNextTime = 0;
w.activePlayer = 'video-player';
w.bookmarkVidIds = new Set();
w.bmMatchedUrls = new Set();
w.collectionsMode = false;
w.curCollection = null;
w.settingsMode = false;
w.aiCommentsEnabled = false;
w.dbMode = false;
w.dbTab = 'actors';
w._dbData = {};
w.curVTags = [];
w.curVAllCategories = [];
w.curVActors = [];
w.curVRating = null;
w.curVStudio = '';
w.mosTileCount = 6;
w.mosHoveredIdx = -1;
w.mosTilesState = [];
w.playlistSkipped = new Set();
w.bmThumbObs = null;
w.acTerms = [];
w._bfCats = [];
w._bfItems = [];
w._bfMatchedCount = 0;
w._bfVisible = [];
w._bfKnownTerms = [];
w._bfViewMode = 'list';
w.dlPoller = null;
w.cvTargetId = null;
w.promptsMode = false;
w.dualMode = false;
w.dualActive = 'left';
w.dualR = { q: '', cat: '', curTag: null };
w._dualTagVids = [];

// ─── Computed State ──────────────────────────────────────────────────
// Example: Automatically filter videos based on search and category
export const filteredVideos = computed(() => {
  let list = videos.value;
  
  if (currentCategory.value) {
    list = list.filter(v => v.category === currentCategory.value);
  }
  
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    list = list.filter(v => v.name.toLowerCase().includes(q));
  }
  
  return list;
});

// ─── Actions (Data Fetching) ──────────────────────────────────────────
export async function loadVideos() {
  const res = await fetch('/api/videos');
  const data = await res.json();
  allVideos.value = data;
  videos.value = data;
}

export async function loadCategories() {
  const res = await fetch('/api/categories');
  const data = await res.json();
  categories.value = data;
}

export async function loadPrefs() {
  const res = await fetch('/api/settings/prefs');
  const data = await res.json();
  appPrefs.value = data;
}

export async function updatePrefs(updates: Partial<AppPrefs>) {
  appPrefs.value = { ...appPrefs.value, ...updates };
  await fetch('/api/settings/prefs', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
}
export const thumbnails = signal<ThumbnailGroup[]>([]);

export async function loadThumbnails() {
  const res = await fetch('/api/thumbnails');
  const data = await res.json();
  thumbnails.value = data;
}

// API Utilities Bridge for legacy code
w.load = async () => {
  const p = new URLSearchParams();
  if (w.q) p.set('q', w.q);
  if (w.cat) p.set('category', w.cat);
  if (w.favFilter) p.set('fav', '1');
  p.set('sort', w.sort);
  const data = await api.fetchVideos(p);
  videos.value = data;
  if (!w.q && !w.cat) w._allVideos = data;
};

w.loadC = async () => {
  const data = await api.fetchCategories();
  categories.value = data;
  if (w.renCats) w.renCats();
};

w.createCategory = async () => {
  const name = prompt('New folder name:');
  if (!name || !name.trim()) return;
  try {
    const d = await api.createCategory(name.trim());
    w.toast('Created folder: ' + d.name);
    await w.loadC();
    w.refresh(true);
  } catch (e: any) {
    w.toast(e.message || 'Failed');
  }
};

w._applySort = (list: any[]) => {
  const out = list.slice();
  if (w.shuf) return out.sort(() => Math.random() - 0.5);
  if (w.sort === 'name')     return out.sort((a, b) => a.name.localeCompare(b.name));
  if (w.sort === 'size')     return out.sort((a, b) => b.size - a.size);
  if (w.sort === 'duration') return out.sort((a, b) => (b.duration || 0) - (a.duration || 0));
  return out.sort((a, b) => b.mtime - a.mtime);
};

w.filterVideosCat = (catFilter: string) => {
  if (!catFilter) return w._applySort(w.favFilter ? w._allVideos.filter((v: any) => v.fav) : w._allVideos);
  return w._applySort(w._allVideos.filter((v: any) => {
    if (w.favFilter && !v.fav) return false;
    if (catFilter === '__uncategorized__' || catFilter === '') return v.catPath === '';
    const vp = v.catPath.toLowerCase().replace(/\\/g, '/');
    const cl = catFilter.toLowerCase().replace(/\\/g, '/');
    return vp === cl || vp.startsWith(cl + '/') || v.category === catFilter;
  }));
};

w.filterVideosByTag = (terms: string[]) => {
  const termsLo = terms.map(t => t.toLowerCase());
  const wordMatch = (name: string, term: string) => {
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('\\b' + esc + '\\b', 'i').test(name);
  };
  return w._applySort(w._allVideos.filter((v: any) => {
    if (w.favFilter && !v.fav) return false;
    const vTagsLo = (v.tags || []).map((t: any) => t.toLowerCase());
    return vTagsLo.some((t: string) => termsLo.includes(t)) || terms.some(t => wordMatch(v.name, t));
  }));
};

w.refresh = async (full = false) => {
  if (w.resetRenderLimit) w.resetRenderLimit();
  
  const closeView = (id: string, modeVar: string) => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('on');
    w[modeVar] = false;
  };
  
  if (w.categoriesMode) { closeView('categories-view', 'categoriesMode'); closeView('categories-view-sidebar', 'categoriesMode'); }
  if (w.recentMode) { closeView('recent-sidebar', 'recentMode'); }
  if (w.vaultMode) { closeView('vault-view', 'vaultMode'); closeView('vault-sidebar', 'vaultMode'); }
  if (w.studioMode) { closeView('studios-view', 'studioMode'); closeView('studio-detail-view', 'studioMode'); closeView('studio-sidebar', 'studioMode'); }
  if (w.actorMode) { closeView('actors-view', 'actorMode'); closeView('actor-detail-view', 'actorMode'); closeView('actor-sidebar', 'actorMode'); }
  
  if (w.curTag) {
    const el = document.getElementById('tag-detail-view');
    if (el) el.classList.remove('on');
    document.querySelectorAll('#tagList .sidebar-item').forEach(el => el.classList.remove('on'));
    w.curTag = null;
  }
  
  const bv = document.getElementById('browse-view');
  if (bv) bv.classList.remove('off');

  const tasks = [w.load()];
  if (full) { 
    tasks.push(w.loadC()); 
    if (w.loadTagSidebar) tasks.push(w.loadTagSidebar()); 
  }
  await Promise.all(tasks);
  if (w.render) w.render();
};

w.openActorFromVideo = (name: string) => {
  currentView.value = 'actors';
  currentActor.value = name;
  history.pushState(null, '', `/actor/${encodeURIComponent(name)}`);
};

w.openActor = (name: string) => {
  currentView.value = 'actors';
  currentActor.value = name;
  history.pushState(null, '', `/actor/${encodeURIComponent(name)}`);
};

w.openStudio = (name: string) => {
  currentView.value = 'studios';
  currentStudio.value = name;
  history.pushState(null, '', `/studio/${encodeURIComponent(name)}`);
};
