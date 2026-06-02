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
export const currentView = signal<string>('hub');
export const currentVideo = signal<Video | null>(null);
export const playerNextUp = signal<Video[]>([]);
export const skipNextUpUpdate = signal<boolean>(false);
export const isSidebarOpen = signal<boolean>(false);

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
  linkUrl: string | null;
}>({
  visible: false,
  vidId: null,
  linkUrl: null
});

export const actorModalState = signal<{
  visible: boolean;
  vidId: string | null;
}>({
  visible: false,
  vidId: null
});

export const studioModalState = signal<{
  visible: boolean;
  vidId: string | null;
}>({
  visible: false,
  vidId: null
});

export const vaultZipModalState = signal<{
  visible: boolean;
  ids: string[];
}>({
  visible: false,
  ids: []
});

export const linkIframeModalState = signal<{
  visible: boolean;
  url: string;
  title: string;
}>({
  visible: false,
  url: '',
  title: ''
});

export const renameModalState = signal<{
  visible: boolean;
  vidId: string | null;
  linkUrl: string | null;
  currentName: string;
}>({
  visible: false,
  vidId: null,
  linkUrl: null,
  currentName: ''
});

export const moveModalState = signal<{
  visible: boolean;
  vidIds: string[];
  linkUrl: string | null;
  currentCategory: string;
}>({
  visible: false,
  vidIds: [],
  linkUrl: null,
  currentCategory: ''
});

export const presetPickerState = signal<{
  visible: boolean;
  mergeMode: boolean;
}>({
  visible: false,
  mergeMode: false
});

export const importModalState = signal<{ visible: boolean }>({ visible: false });

export const currentCategory = signal<string>('');
export const currentTag = signal<string | null>(null);
export const currentPhotoFolder = signal<string>('');
export const currentActor = signal<string | null>(null);
export const currentStudio = signal<string | null>(null);
export const linkVidIds = signal<Set<string>>(new Set());

export function rebuildLinkVidIds(items: any[]) {
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
  linkVidIds.value = set;
}

// Bridge for legacy JS
export const isRecentMode = signal<boolean>(false);
export const recentVideos = signal<Video[]>([]);
export const favFilter = signal<boolean>(false);
export const searchQuery = signal<string>('');
export const visionModalText = signal<string | null>(null);
export const showAddToCollectionModal = signal<boolean>(false);
export const showConnectModal = signal<boolean>(false);
export const galleryFilter = signal<string>('');
export const sourceFilter = signal<string>('both');

if (typeof window !== 'undefined') {
  sourceFilter.subscribe(val => {
    (window as any).srcFilter = val;
  });
}

export const cardSize = signal<number>(parseInt(localStorage.getItem('cardSize') || '270', 10));

if (typeof document !== 'undefined') {
  cardSize.subscribe(w => {
    document.documentElement.style.setProperty('--card-min', w + 'px');
    localStorage.setItem('cardSize', w.toString());
  });
}
export const isLoadingVideos = signal<boolean>(false);
export const sortMode = signal<string>('date');
export const isShuffle = signal<boolean>(false);
export const vaultMode = signal<boolean>(false);
export const isVaultUnlocked = signal<boolean>(false);
export const categoryMasterPassword = signal<string | null>(null);
export const videoSelMode = signal<boolean>(false);
export const selectedVideoIds = signal<Set<string>>(new Set());
export const isMuted = signal<boolean>(localStorage.getItem('isMuted') === 'true');
export const profiles = signal<string[]>(['default']);
export const activeProfile = signal<string>('default');
export const profileModalState = signal<{ visible: boolean }>({ visible: false });
export const vaultUnlockModalState = signal<{ visible: boolean; targetProfileAfterUnlock: string | null }>({ visible: false, targetProfileAfterUnlock: null });
export const thumbBlurMode = signal<string>(localStorage.getItem('thumbBlurMode') || 'show');

export async function loadProfiles() {
  const res = await fetch('/api/profiles');
  const data = await res.json();
  profiles.value = data.profiles;
  activeProfile.value = data.current;
}

export async function switchProfile(name: string) {
  const res = await fetch('/api/profiles/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: name })
  });
  
  if (res.status === 401) {
    const data = await res.json();
    if (data.locked) {
      vaultUnlockModalState.value = { visible: true, targetProfileAfterUnlock: name };
      return;
    }
  }
  
  activeProfile.value = name;
  window.location.reload();
}

if (typeof document !== 'undefined') {
  isMuted.subscribe(muted => {
    const mediaElements = document.querySelectorAll('video, audio');
    mediaElements.forEach((el: any) => el.muted = muted);
    localStorage.setItem('isMuted', muted ? 'true' : 'false');
  });
}

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
  renameModalState.value = { visible: true, vidId: id, linkUrl: null, currentName: name };
};
(window as any).openMov = (id: string, name: string, curCatPath: string) => {
  moveModalState.value = { visible: true, vidIds: [id], linkUrl: null, currentCategory: curCatPath };
};
(window as any).openBulkMove = (ids: string[]) => {
  moveModalState.value = { visible: true, vidIds: ids, linkUrl: null, currentCategory: '' };
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

Object.defineProperty(w, 'linkVidIds', {
  get() { return linkVidIds.value; },
  set(v) { linkVidIds.value = v; }
});

w.linkMatchedUrls = new Set();
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
w.linkThumbObs = null;
w.acTerms = [];
w._lfCats = [];
w._lfItems = [];
w._lfMatchedCount = 0;
w._lfVisible = [];
w._lfKnownTerms = [];
w._lfViewMode = 'list';
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
  let list = [...videos.value];
  
  if (searchQuery.value) {
    list = [...allVideos.value];
    const q = searchQuery.value.toLowerCase();
    list = list.filter(v => v.name.toLowerCase().includes(q));
  } else {
    if (isRecentMode.value) {
      list = [...recentVideos.value];
    }
    
    if (currentCategory.value === 'uncategorized') {
      list = list.filter((v: any) => !v.catPath || v.catPath === '' || (v.isLink && v.catPath === 'Links'));
    } else if (currentCategory.value) {
      const cl = currentCategory.value.toLowerCase().replace(/\\/g, '/');
      list = list.filter(v => {
        const vp = (v.catPath || '').toLowerCase().replace(/\\/g, '/');
        return vp === cl || vp.startsWith(cl + '/') || v.category === currentCategory.value;
      });
    }

    if (currentTag.value) {
      const tagLo = currentTag.value.toLowerCase();
      list = list.filter(v => v.tags && (v.tags as string[]).some(t => t.toLowerCase() === tagLo));
    }

    if (currentView.value === 'favourites' || favFilter.value) {
      list = list.filter(v => v.starred || v.fav);
    }
  }
  
  if (galleryFilter.value) {
    const gf = galleryFilter.value.toLowerCase();
    list = list.filter(v => 
      v.name.toLowerCase().includes(gf) || 
      (v.category && v.category.toLowerCase().includes(gf)) ||
      (v.tags && v.tags.some(t => t.toLowerCase().includes(gf)))
    );
  }

  if (sourceFilter.value === 'local') {
    list = list.filter(v => !v.isLink);
  } else if (sourceFilter.value === 'remote') {
    list = list.filter(v => !!v.isLink);
  }

  // Apply sorting or shuffle
  if (isShuffle.value) {
    list.sort(() => Math.random() - 0.5);
  } else {
    if (sortMode.value === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortMode.value === 'size') {
      list.sort((a, b) => b.size - a.size);
    } else if (sortMode.value === 'duration') {
      list.sort((a, b) => (b.duration || 0) - (a.duration || 0));
    } else {
      list.sort((a, b) => b.mtime - a.mtime);
    }
  }
  
  return list;
});

// ─── Actions (Data Fetching) ──────────────────────────────────────────
export function matchLinkCat(title: string, cats: any[], explicitCategory?: string): { catPath: string; category: string } {
  if (explicitCategory) {
    const found = cats.find((c: any) =>
      c.path === explicitCategory ||
      c.name === explicitCategory ||
      (c.displayName && c.displayName === explicitCategory) ||
      c.path === explicitCategory.replace(/\\/g, '/')
    );
    if (found) {
      return { catPath: found.path, category: found.name };
    }
  }

  const norm = (title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const cat of cats) {
    if (cat.path === 'Links') continue;
    const key = cat.path.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (key && norm.includes(key)) return { catPath: cat.path, category: cat.name };
  }
  return { catPath: '', category: '' };
}

export async function loadVideos() {
  isLoadingVideos.value = true;
  const [res, bRes, cRes] = await Promise.all([
    fetch('/api/videos'),
    fetch('/api/links/cache?limit=0').catch(() => null),
    fetch('/api/categories').catch(() => null),
  ]);
  const data = await res.json();

  const cats = cRes ? await cRes.json().catch(() => []) : [];
  if (Array.isArray(cats)) categories.value = cats;

  let linksData: any[] = [];
  try {
    if (bRes) {
      const bData = await bRes.json();
      linksData = bData.items || [];
    }
  } catch (e) {}

  // Build map: localVideoId → original page URL for links that were downloaded
  const downloadedLinkMap = new Map<string, string>();
  for (const b of linksData) {
    if (b.downloaded && b.localVideoId && b.url) {
      downloadedLinkMap.set(b.localVideoId, b.url);
    }
  }

  const linkVideos = linksData
    .filter((b: any) => b.url && !b.downloaded)
    .map((b: any) => {
      const { catPath, category } = matchLinkCat(b.title, cats, b.category);
      return {
        id: btoa(b.url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
        name: b.title || b.url,
        path: b.scrapedVideoUrl || '',
        relPath: b.url,
        catPath,
        category,
        isLink: true,
        isExternal: true,
        embedUrl: b.embedUrl,
        linkUrl: b.url,
        img: b.img,
        tags: b.tags || [],
        hasVideo: !!b.scrapedVideoUrl,
        hasEmbed: !!b.embedUrl,
        size: 0,
        duration: 0,
        mtime: b.addedAt || Date.now()
      };
    });

  // Annotate local videos that came from a downloaded link with the original page URL
  const localVideos = downloadedLinkMap.size > 0
    ? (data as any[]).map((v: any) => {
        const origUrl = downloadedLinkMap.get(v.id);
        return origUrl ? { ...v, linkUrl: origUrl } : v;
      })
    : data;

  const combined = [...localVideos, ...linkVideos];

  allVideos.value = combined;
  videos.value = combined;
  isLoadingVideos.value = false;

  // Recompute category counts from combined list (local + link videos)
  if (Array.isArray(cats) && cats.length > 0) {
    const countMap = new Map<string, number>();
    for (const v of combined) {
      if (!v.catPath) continue;
      const parts = (v.catPath as string).split('/');
      let cur = '';
      for (const p of parts) {
        cur = cur ? cur + '/' + p : p;
        countMap.set(cur, (countMap.get(cur) || 0) + 1);
      }
    }
    categories.value = cats.map((c: any) => ({ ...c, count: countMap.get(c.path) || 0 }));
  }
  syncUrlToState();

  // Only redirect to links if no videos found from any source (local + external + links)
  if (data.length === 0 && linkVideos.length === 0) {
    const cur = currentView.value;
    if (cur === 'hub' || cur === 'home' || cur === 'browse' || cur === '') {
      currentView.value = 'links';
    }
  }
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
  currentView.value = 'hub';
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
  currentView.value = 'hub';
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
  isRecentMode.value = (view === 'recent');
  
  const topbarEl = document.getElementById('topbar-root');
  const sidebarEl = document.getElementById('side');
  if (topbarEl) topbarEl.style.display = (view === 'instagram' || view === 'reddit') ? 'none' : '';
  if (sidebarEl) sidebarEl.style.display = (view === 'reddit') ? 'none' : '';
  
  if (view === 'recent') {
    fetch('/api/history')
      .then(r => r.json())
      .then(data => {
        recentVideos.value = data;
      })
      .catch(() => {});
  }
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

export function syncUrlToState() {
  if (typeof window === 'undefined') return;
  const p = window.location.pathname;
  if (p === '/' || p === '/hub' || p === '/home') {
    currentView.value = 'hub';
    currentVideo.value = null;
    currentCategory.value = '';
    currentTag.value = null;
    return;
  }
  
  let m;
  if ((m = p.match(/^\/video\/([^/]+)$/))) {
    const vidId = m[1];
    const vid = videos.value.find(v => v.id === vidId);
    if (vid) {
      currentVideo.value = vid;
      // We might need to set a view that shows the video player!
      // If it's a modal, it will open automatically if currentVideo is set!
    }
  } else if ((m = p.match(/^\/cat\/([^/]+)$/))) {
    currentView.value = 'browse';
    currentCategory.value = decodeURIComponent(m[1]);
    currentTag.value = null;
    currentVideo.value = null;
  } else if ((m = p.match(/^\/tag\/([^/]+)$/))) {
    currentView.value = 'browse';
    currentTag.value = decodeURIComponent(m[1]);
    currentCategory.value = '';
    currentVideo.value = null;
  } else if ((m = p.match(/^\/actor\/([^/]+)$/))) {
    currentView.value = 'actors';
    currentActor.value = decodeURIComponent(m[1]);
    currentCategory.value = '';
    currentTag.value = null;
    currentVideo.value = null;
  } else if ((m = p.match(/^\/studio\/([^/]+)$/))) {
    currentView.value = 'studios';
    currentStudio.value = decodeURIComponent(m[1]);
    currentCategory.value = '';
    currentTag.value = null;
    currentVideo.value = null;
  } else {
    // Other views
    const view = p.replace(/^\//, '');
    currentView.value = view;
    currentVideo.value = null;
    currentCategory.value = '';
    currentTag.value = null;
  }
}

export function updateUrl() {
  if (typeof window === 'undefined') return;
  const view = currentView.value;
  let path = '/';
  
  if (view === 'hub' || view === 'home') {
    path = '/';
  } else if (currentVideo.value) {
    path = `/video/${currentVideo.value.id}`;
  } else if (currentCategory.value) {
    path = `/cat/${encodeURIComponent(currentCategory.value)}`;
  } else if (currentTag.value) {
    path = `/tag/${encodeURIComponent(currentTag.value)}`;
  } else if (view === 'browse') {
    path = '/browse';
  } else {
    path = `/${view}`;
  }
  
  if (window.location.pathname !== path) {
    history.pushState(null, '', path);
  }
}

if (typeof window !== 'undefined') {
  // Subscribe to signals
  currentView.subscribe(updateUrl);
  currentCategory.subscribe(updateUrl);
  currentTag.subscribe(updateUrl);
  currentVideo.subscribe(updateUrl);

  // Listen for popstate
  window.addEventListener('popstate', syncUrlToState);

  // Run on load
  setTimeout(syncUrlToState, 100);
}

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
    if (w.srcFilter === 'remote' && !v.isLink) return false;
    if (w.srcFilter === 'local' && v.isLink) return false;
    if (catFilter === 'uncategorized' || catFilter === '__uncategorized__' || catFilter === '') return !v.catPath || v.catPath === '' || (v.isLink && v.catPath === 'Links');
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
    if (w.srcFilter === 'remote' && !v.isLink) return false;
    if (w.srcFilter === 'local' && v.isLink) return false;
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
  
  currentTag.value = null;
  
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
  currentView.value = 'links';
  history.pushState(null, '', '/links');
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

export async function deleteVideo(id: string, name: string) {
  if (!confirm(`Delete "${name}"?\nThis cannot be undone.`)) return;
  const r = await fetch(`/api/videos/${id}`, { method: 'DELETE' });
  if (!r.ok) {
    const w = window as any;
    if (w.toast) w.toast('Delete failed');
    return;
  }
  videos.value = videos.value.filter(v => v.id !== id);
  const w = window as any;
  if (w.toast) w.toast('Deleted');
}

export async function describeVideoThumb(videoId: string) {
  visionModalText.value = 'Analyzing thumbnail…';
  try {
    const r = await fetch('/api/vision/describe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'thumb', id: videoId, thumbIdx: 0 })
    }).then(r => r.json());
    
    visionModalText.value = r ? (r.description || r.error || 'No description returned') : 'Request failed';
  } catch (e) {
    visionModalText.value = 'Request failed';
  }
}
