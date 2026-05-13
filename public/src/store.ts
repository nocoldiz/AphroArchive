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

export const contextMenuState = signal<{
  visible: boolean;
  x: number;
  y: number;
  type: string;
  data: any;
}>({
  visible: false,
  x: 0,
  y: 0,
  type: '',
  data: null
});

export const tagModalState = signal<{
  visible: boolean;
  vidId: string | null;
  bmUrl: string | null;
}>({
  visible: false,
  vidId: null,
  bmUrl: null
});

export const renameModalState = signal<{
  visible: boolean;
  vidId: string | null;
  bmUrl: string | null;
  currentName: string;
}>({
  visible: false,
  vidId: null,
  bmUrl: null,
  currentName: ''
});

export const moveModalState = signal<{
  visible: boolean;
  vidIds: string[];
  bmUrl: string | null;
  currentCategory: string;
}>({
  visible: false,
  vidIds: [],
  bmUrl: null,
  currentCategory: ''
});

export const presetPickerState = signal<{
  visible: boolean;
  mergeMode: boolean;
}>({
  visible: false,
  mergeMode: false
});

export const currentCategory = signal<string>('');
export const currentTag = signal<string | null>(null);
export const currentActor = signal<string | null>(null);
export const currentStudio = signal<string | null>(null);
export const bookmarkVidIds = signal<Set<string>>(new Set());

export function rebuildBookmarkVidIds(items: any[]) {
  const set = new Set<string>();
  const vids = (window as any).V || []; // Fallback to global V if videos signal is not populated yet
  for (const v of vids) {
    const vname = v.name.toLowerCase().replace(/\.[^.]+$/, '');
    for (const it of items) {
      if (it.url.toLowerCase().includes(vname)) {
        set.add(v.id);
      }
    }
  }
  bookmarkVidIds.value = set;
}

// Bridge for legacy JS
export const searchQuery = signal<string>('');
export const galleryFilter = signal<string>('');
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
Object.defineProperty(window, 'galleryFilter', { get() { return galleryFilter.value; }, set(v) { galleryFilter.value = v; } });
Object.defineProperty(window, 'curV', { get() { return currentVideo.value; }, set(v) { currentVideo.value = v; } });
Object.defineProperty(window, 'shuf', { get() { return isShuffle.value; }, set(v) { isShuffle.value = v; } });
Object.defineProperty(window, 'vaultMode', { get() { return vaultMode.value; }, set(v) { vaultMode.value = v; } });
Object.defineProperty(window, 'videoSelMode', { get() { return videoSelMode.value; }, set(v) { videoSelMode.value = v; } });

(window as any).openRen = (id: string, name: string) => {
  renameModalState.value = { visible: true, vidId: id, bmUrl: null, currentName: name };
};
(window as any).openMov = (id: string, name: string, curCatPath: string) => {
  moveModalState.value = { visible: true, vidIds: [id], bmUrl: null, currentCategory: curCatPath };
};
(window as any).openBulkMove = (ids: string[]) => {
  moveModalState.value = { visible: true, vidIds: ids, bmUrl: null, currentCategory: '' };
};

(window as any).openPresetPickerManual = () => {
  presetPickerState.value = { visible: true, mergeMode: true };
};
(window as any).checkAndShowPresetPicker = async () => {
  const res = await fetch('/api/presets');
  const data = await res.json();
  if (data.needed) {
    presetPickerState.value = { visible: true, mergeMode: false };
  }
};

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
Object.defineProperty(w, 'videoSel', {
  get() { return selectedVideoIds.value; },
  set(v) { selectedVideoIds.value = v; }
});
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

Object.defineProperty(w, 'bookmarkVidIds', {
  get() { return bookmarkVidIds.value; },
  set(v) { bookmarkVidIds.value = v; }
});

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

  if (galleryFilter.value) {
    const gf = galleryFilter.value.toLowerCase();
    list = list.filter(v => 
      v.name.toLowerCase().includes(gf) || 
      (v.category && v.category.toLowerCase().includes(gf)) ||
      (v.tags && v.tags.some(t => t.toLowerCase().includes(gf)))
    );
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

// Navigation Bridge
w.showHome = () => {
  currentView.value = 'home';
  if (location.pathname !== '/') history.pushState(null, '', '/');
};

w.goHome = () => {
  if (w.playlistSkipped) w.playlistSkipped.clear();
  if (w.mosaicOn && w.stopMosaic) w.stopMosaic();
  if (w.zapOn) {
    w.zapOn = false;
    clearTimeout(w.zapTimer);
    const zui = document.getElementById('zap-ui');
    if (zui) zui.style.display = 'none';
    const vp = document.getElementById('video-player');
    if (vp) vp.style.display = 'block';
    const vpz = document.getElementById('video-player-zap');
    if (vpz) vpz.style.display = 'none';
    w.activePlayer = 'video-player';
  }
  currentView.value = 'home';
  currentCategory.value = '';
  currentTag.value = null;
  searchQuery.value = '';
  if (location.pathname !== '/') history.pushState(null, '', '/');
  if (w.refresh) w.refresh();
};

w.showBooks = () => { currentView.value = 'books'; };
w.showPages = () => { currentView.value = 'pages'; };
w.showAudio = () => { currentView.value = 'audio'; };
w.showSearchSites = () => { currentView.value = 'search'; };
w.showPrompts = () => { currentView.value = 'prompts'; };

// Subscriber to handle legacy view visibility
currentView.subscribe(view => {
  const legacyViews = [
    'home-view', 'vault-view', 'scraper-view', 'collections-view',
    'books-view', 'audio-view', 'photos-view', 'thumbnails-view', 'pages-view',
    'prompts-view', 'search-sites-view', 'settings-view', 'database-view',
    'categories-view', 'chapters-view'
  ];
  legacyViews.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('on');
  });
  
  const browseView = document.getElementById('browse-view');
  
  if (view === 'home') {
    document.getElementById('home-view')?.classList.add('on');
    browseView?.classList.add('off');
  } else if (view === 'scraper') {
    document.getElementById('scraper-view')?.classList.add('on');
    browseView?.classList.add('off');
  } else {
    // For Preact views, we usually show browse-view
    browseView?.classList.remove('off');
    // And show the specific view if it's legacy
    document.getElementById(view + '-view')?.classList.add('on');
  }
});


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

w.showImportFavs = () => {
  currentView.value = 'bookmarks';
  history.pushState(null, '', '/bookmarks');
};

w.openVid = (id: string) => {
  const v = allVideos.value.find(x => x.id === id);
  if (v) {
    currentVideo.value = v;
    currentView.value = 'player';
    history.pushState(null, '', `/video/${id}`);
  }
};

(window as any).showContextMenu = (e: MouseEvent, type: string, data: any) => {
  e.preventDefault();
  e.stopPropagation();
  contextMenuState.value = {
    visible: true,
    x: e.clientX,
    y: e.clientY,
    type,
    data
  };
};

(window as any).applyTheme = (name: string) => {
  if (name) document.documentElement.setAttribute('data-theme', name);
  else document.documentElement.removeAttribute('data-theme');
  localStorage.setItem('theme', name);
  document.querySelectorAll('.theme-btn').forEach(btn => {
    const b = btn as HTMLElement;
    b.classList.toggle('active', b.dataset.theme === name);
  });
};

(window as any).togglePan = () => {
  const on = document.body.classList.toggle('pan');
  const btn = document.getElementById('panBtn');
  if (btn) btn.classList.toggle('on', on);
  localStorage.setItem('pan', on ? '1' : '');
};
