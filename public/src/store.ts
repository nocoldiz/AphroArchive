import { signal, computed } from '@preact/signals';
import { Video, Folder, Actor, Channel, AppPrefs, ThumbnailGroup } from './types';
import * as api from './api';

// ─── Core State ──────────────────────────────────────────────────────
export const videos = signal<Video[]>([]);
export const allVideos = signal<Video[]>([]); // Full unfiltered list
export const folders = signal<Folder[]>([]);
export const linkTotalCount = signal<number>(0);
export const mediaCounts = signal<{ links: number; audio: number; books: number; photos: number; files: number; pages: number; screenshots: number }>({ links: 0, audio: 0, books: 0, photos: 0, files: 0, pages: 0, screenshots: 0 });
export const actors = signal<Actor[]>([]);
export const channels = signal<Channel[]>([]);
export const appPrefs = signal<Partial<AppPrefs>>({});

// ─── Navigation & View State ──────────────────────────────────────────
export const currentView = signal<string>('hub');
export const currentVideo = signal<Video | null>(null);
export const playerNextUp = signal<Video[]>([]);
export const playerHistory = signal<Video[]>([]);
export const skipNextUpUpdate = signal<boolean>(false);
export const isSidebarOpen = signal<boolean>(false);
// Desktop: collapse the sidebar to a narrow icon-only rail.
export const sidebarCollapsed = signal<boolean>(localStorage.getItem('sidebarCollapsed') === 'true');

if (typeof document !== 'undefined') {
  sidebarCollapsed.subscribe(v => {
    document.body.classList.toggle('sidebar-rail', v);
    localStorage.setItem('sidebarCollapsed', v ? 'true' : 'false');
  });
}

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

export const channelModalState = signal<{
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
  currentFolder: string;
  isVault?: boolean;
}>({
  visible: false,
  vidIds: [],
  linkUrl: null,
  currentFolder: ''
});

export const presetPickerState = signal<{
  visible: boolean;
  mergeMode: boolean;
}>({
  visible: false,
  mergeMode: false
});

export const importModalState = signal<{ visible: boolean }>({ visible: false });

export const subtitleEditorModalState = signal<{
  visible: boolean;
  videoId: string;
  videoName: string;
}>({
  visible: false,
  videoId: '',
  videoName: '',
});

export const currentFolder = signal<string>('');
export const currentTag = signal<string | null>(null);
export const currentTagTerms = signal<string[]>([]);
export const currentPhotoFolder = signal<string>('');
export const currentActor = signal<string | null>(null);
export const currentChannel = signal<string | null>(null);
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
export const favFilter = signal<boolean>(localStorage.getItem('favFilter') === 'true');
export const searchQuery = signal<string>('');
export const visionModalText = signal<string | null>(null);
export const showAddToCollectionModal = signal<boolean>(false);
export const showConnectModal = signal<boolean>(false);
export const galleryFilter = signal<string>(localStorage.getItem('galleryFilter') || '');
export const sourceFilter = signal<string>(localStorage.getItem('sourceFilter') || 'both');
export const ratingFilter = signal<number>(parseInt(localStorage.getItem('ratingFilter') || '0', 10));
export const resolutionFilter = signal<string>(localStorage.getItem('resolutionFilter') || '');
export const notWatchedFilter = signal<boolean>(localStorage.getItem('notWatchedFilter') === 'true');

if (typeof window !== 'undefined') {
  favFilter.subscribe(val => localStorage.setItem('favFilter', val ? 'true' : 'false'));
  galleryFilter.subscribe(val => localStorage.setItem('galleryFilter', val));
  sourceFilter.subscribe(val => localStorage.setItem('sourceFilter', val));
  ratingFilter.subscribe(val => localStorage.setItem('ratingFilter', String(val)));
  resolutionFilter.subscribe(val => localStorage.setItem('resolutionFilter', val));
  notWatchedFilter.subscribe(val => localStorage.setItem('notWatchedFilter', val ? 'true' : 'false'));
}

if (typeof window !== 'undefined') {
  sourceFilter.subscribe(val => {
    (window as any).srcFilter = val;
  });
}

export const cardSize = signal<number>(parseInt(localStorage.getItem('cardSize') || '270', 10));

let _prefsLoaded = false;
let _cardSizeTimer: ReturnType<typeof setTimeout> | null = null;

if (typeof document !== 'undefined') {
  cardSize.subscribe(w => {
    document.documentElement.style.setProperty('--card-min', w + 'px');
    localStorage.setItem('cardSize', w.toString());
    if (_prefsLoaded) {
      if (_cardSizeTimer) clearTimeout(_cardSizeTimer);
      _cardSizeTimer = setTimeout(() => {
        fetch('/api/settings/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cardSize: w }) }).catch(() => {});
      }, 800);
    }
  });
}
export const isLoadingVideos = signal<boolean>(false);
export const sortMode = signal<string>(localStorage.getItem('sortMode') || 'date');
export const isShuffle = signal<boolean>(localStorage.getItem('isShuffle') === 'true');
// Bumped each time shuffle is (re-)enabled — the only thing that should re-roll order
export const shuffleSeed = signal(0);
if (typeof window !== 'undefined') {
  isShuffle.subscribe(val => {
    if (val) shuffleSeed.value++;
    localStorage.setItem('isShuffle', val ? 'true' : 'false');
  });
  sortMode.subscribe(val => localStorage.setItem('sortMode', val));
}
export const gridViewMode = signal<'grid' | 'list'>(localStorage.getItem('gridViewMode') as 'grid' | 'list' || 'grid');
export const groupByYear = signal<'none' | 'year' | 'decade'>(localStorage.getItem('groupByYear') as any || 'none');
if (typeof window !== 'undefined') {
  gridViewMode.subscribe(val => localStorage.setItem('gridViewMode', val));
  groupByYear.subscribe(val => localStorage.setItem('groupByYear', val));
}
export const vaultMode = signal<boolean>(false);
export const isVaultUnlocked = signal<boolean>(false);
export const videoSelMode = signal<boolean>(false);
export const selectedVideoIds = signal<Set<string>>(new Set());
// Ids of library videos currently being encrypted into the Vault — their cards
// render semi-transparent until encryption finishes, then they're removed from
// the grid (no full gallery reload).
export const encryptingVideoIds = signal<Set<string>>(new Set());
export const isMuted = signal<boolean>(localStorage.getItem('isMuted') === 'true');
export const profiles = signal<string[]>(['default']);
export const activeProfile = signal<string>('default');
export const profileModalState = signal<{ visible: boolean }>({ visible: false });
export const dbPendingOpen = signal<{ tab: string; action: 'add' } | null>(null);
export const vaultUnlockModalState = signal<{ visible: boolean; targetProfileAfterUnlock: string | null }>({ visible: false, targetProfileAfterUnlock: null });

// Vault topbar toggle: false = Vault-Only view (default), true = Global view
// (all files from all profiles, allowing import/encryption into the Vault)
export const vaultGlobalView = signal<boolean>(false);

// Runs an action once the vault is unlocked. If the vault is locked, the
// unlock modal opens and the action runs after a successful unlock.
export async function ensureVaultUnlocked(action: () => void) {
  const w = window as any;
  try {
    const status = await fetch('/api/vault/status').then(r => r.json());
    if (!status.configured) {
      w.toast?.('Vault not configured. Set it up first from the Vault view.');
      return;
    }
    if (status.unlocked) {
      isVaultUnlocked.value = true;
      action();
      return;
    }
    vaultUnlockModalState.value = { visible: true, targetProfileAfterUnlock: null };
    const interval = setInterval(async () => {
      const s = await fetch('/api/vault/status').then(r => r.json()).catch(() => null);
      if (s && s.unlocked) {
        clearInterval(interval);
        isVaultUnlocked.value = true;
        action();
      } else if (!vaultUnlockModalState.value.visible) {
        clearInterval(interval); // unlock modal was cancelled
      }
    }, 500);
  } catch {
    w.toast?.('Failed to check vault status');
  }
}
export const thumbBlurMode = signal<string>(localStorage.getItem('thumbBlurMode') || 'show');

export async function loadProfiles() {
  const res = await fetch('/api/profiles');
  const data = await res.json();
  profiles.value = data.profiles;
  activeProfile.value = data.current;
  return data;
}

// Resets navigation/filter state and reloads data for the active profile,
// mirroring App.tsx's initial load — used after a profile switch/create so
// the UI reflects the new profile's database without a full page reload.
export async function reloadAppData() {
  currentVideo.value = null;
  currentView.value = 'hub';
  currentFolder.value = '';
  currentTag.value = null;
  currentTagTerms.value = [];
  currentActor.value = null;
  currentChannel.value = null;
  currentPhotoFolder.value = '';
  searchQuery.value = '';
  encryptingVideoIds.value = new Set();
  vaultGlobalView.value = false;
  if (location.pathname !== '/') history.pushState(null, '', '/');

  // Clear legacy window vault state so stale data from the previous profile
  // isn't visible while the new profile loads.
  const w = window as any;
  w.vaultFiles = []; w.vaultPl = []; w.vaultPlIdx = 0;
  w.vaultPhotos = []; w.vaultPhotoIdx = -1;
  w.vaultFolders = []; w.vaultCurFolder = null;
  w.vaultSel = new Set();

  await Promise.all([loadVideos(), loadFolders(), loadPrefs()]);

  try {
    const s = await (await fetch('/api/vault/status')).json();
    isVaultUnlocked.value = !!s.unlocked;
  } catch {}
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
      profileModalState.value = { visible: false };
      vaultUnlockModalState.value = { visible: true, targetProfileAfterUnlock: name };
      return;
    }
  }

  activeProfile.value = name;
  profileModalState.value = { visible: false };
  await reloadAppData();
}

if (typeof document !== 'undefined') {
  isMuted.subscribe(muted => {
    const mediaElements = document.querySelectorAll('video, audio');
    mediaElements.forEach((el: any) => el.muted = muted);
    localStorage.setItem('isMuted', muted ? 'true' : 'false');
    if (_prefsLoaded) {
      fetch('/api/settings/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isMuted: muted }) }).catch(() => {});
    }
  });
}

(window as any)._foldersSignal = folders;
(window as any)._videosSignal = videos;
(window as any)._currentViewSignal = currentView;

// Compatibility getters/setters for legacy globals
Object.defineProperty(window, 'V', { get() { return videos.value; }, set(v) { videos.value = v; } });
Object.defineProperty(window, 'cats', { get() { return folders.value; }, set(v) { folders.value = v; } });
Object.defineProperty(window, 'sort', { get() { return sortMode.value; }, set(v) { sortMode.value = v; } });
Object.defineProperty(window, 'cat', { get() { return currentFolder.value; }, set(v) { currentFolder.value = v; } });
Object.defineProperty(window, 'q', { get() { return searchQuery.value; }, set(v) { searchQuery.value = v; } });
Object.defineProperty(window, 'galleryFilter', { get() { return galleryFilter.value; }, set(v) { galleryFilter.value = v; } });
Object.defineProperty(window, 'curV', { get() { return currentVideo.value; }, set(v) { currentVideo.value = v; } });
Object.defineProperty(window, 'shuf', { get() { return isShuffle.value; }, set(v) { isShuffle.value = v; } });
Object.defineProperty(window, 'vaultMode', { get() { return vaultMode.value; }, set(v) { vaultMode.value = v; } });
Object.defineProperty(window, 'videoSelMode', { get() { return videoSelMode.value; }, set(v) { videoSelMode.value = v; } });

(window as any).openRen = (id: string, name: string) => {
  renameModalState.value = { visible: true, vidId: id, linkUrl: null, currentName: name };
};
(window as any).openMov = (id: string, name: string, curFolderPath: string) => {
  moveModalState.value = { visible: true, vidIds: [id], linkUrl: null, currentFolder: curFolderPath };
};
(window as any).openBulkMove = (ids: string[]) => {
  moveModalState.value = { visible: true, vidIds: ids, linkUrl: null, currentFolder: '' };
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
w.foldersMode = false;
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
w.channelMode = false;
w.curChannel = null;
w.actorMode = false;
w.curActor = null;
w.thumbMap = {};
w.thumbQueue = [];
w.thumbRunning = 0;
w.thumbObs = null;
w.hoverTimer = null;
w.hoverEl = null;
w.hoverIdx = 0;

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
w.curVChannel = '';
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

// ─── Folder-watch auto-refresh via SSE ───────────────────────────────
// The server broadcasts scan_changed when fs.watch detects a file change.
// We debounce so rapid bursts (e.g. bulk copy) coalesce into one reload.
if (typeof window !== 'undefined' && typeof EventSource !== 'undefined') {
  let _scanRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  const _connectScanSse = () => {
    const es = new EventSource('/api/scan/events');
    es.onmessage = () => {
      if (_scanRefreshTimer) clearTimeout(_scanRefreshTimer);
      _scanRefreshTimer = setTimeout(() => { loadVideos().catch(() => {}); }, 1500);
    };
    es.onerror = () => {
      es.close();
      setTimeout(_connectScanSse, 5000);
    };
  };
  _connectScanSse();
}

// ─── Computed State ──────────────────────────────────────────────────
let _shuffleKeys = new Map<string, number>();
let _shuffleSeedApplied = -1;

function _trigrams(s: string): Set<string> {
  const g = new Set<string>();
  const sl = s.toLowerCase().replace(/\s+/g, '');
  for (let i = 0; i < sl.length - 2; i++) g.add(sl.slice(i, i + 3));
  return g;
}

function _fuzzyMatch(text: string, query: string): boolean {
  if (query.length < 3) return text.toLowerCase().includes(query.toLowerCase());
  const qt = _trigrams(query);
  if (qt.size === 0) return false;
  const tt = _trigrams(text);
  let common = 0;
  for (const g of qt) if (tt.has(g)) common++;
  return common / qt.size >= 0.4;
}

function _videoMatchesSearch(v: Video, tokens: string[]): boolean {
  const name    = v.name.toLowerCase();
  const cat     = (v.category || '').toLowerCase();
  const tags    = (v.tags || []).map(t => t.toLowerCase());
  const actors  = (v.actors || []).map(a => a.toLowerCase());
  const note    = (v.note || '').toLowerCase();
  return tokens.every(token =>
    name.includes(token) ||
    cat.includes(token) ||
    tags.some(t => t.includes(token)) ||
    actors.some(a => a.includes(token)) ||
    note.includes(token)
  );
}

function _resolveResolutionTier(v: Video): string {
  const w = v.width, h = v.height;
  if (!w && !h) return '';
  if ((w && w >= 3840) || (h && h >= 2160)) return '4k';
  if ((w && w >= 1920) || (h && h >= 1080)) return '1080p';
  if ((w && w >= 1280) || (h && h >= 720)) return '720p';
  return 'sd';
}

export const filteredVideos = computed(() => {
  let list = [...videos.value];
  const q = searchQuery.value;

  if (q) {
    list = [...allVideos.value];
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);

    // Exact token match first
    let exact = list.filter(v => _videoMatchesSearch(v, tokens));

    // Fuzzy fallback: if exact yields nothing, use trigram matching on the full query
    if (exact.length === 0) {
      exact = list.filter(v =>
        _fuzzyMatch(v.name, q) ||
        (v.actors || []).some(a => _fuzzyMatch(a, q)) ||
        (v.tags || []).some(t => _fuzzyMatch(t, q))
      );
    }
    list = exact;
  } else {
    if (isRecentMode.value) {
      list = [...recentVideos.value];
    }

    if (currentFolder.value === 'uncategorized') {
      list = list.filter((v: any) => !v.catPath || v.catPath === '' || (v.isLink && v.catPath === 'Links'));
    } else if (currentFolder.value) {
      const cl = currentFolder.value.toLowerCase().replace(/\\/g, '/');
      list = list.filter(v => {
        const vp = (v.catPath || '').toLowerCase().replace(/\\/g, '/');
        return vp === cl || vp.startsWith(cl + '/') || v.category === currentFolder.value;
      });
    }

    if (currentTag.value) {
      const tagLo = currentTag.value.toLowerCase();
      const terms = currentTagTerms.value;
      list = list.filter(v => {
        if (v.tags && (v.tags as string[]).some(t => t.toLowerCase() === tagLo)) return true;
        if (terms.length > 0) {
          const name = (v.name || '').toLowerCase();
          return terms.some(t =>
            new RegExp('(?:^|[^a-z0-9])' + t.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|[^a-z0-9])').test(name)
          );
        }
        return false;
      });
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

  // Rating filter: only show videos with rating >= threshold
  const minRating = ratingFilter.value;
  if (minRating > 0) {
    list = list.filter(v => v.rating != null && v.rating >= minRating);
  }

  // Resolution filter
  const resFlt = resolutionFilter.value;
  if (resFlt) {
    list = list.filter(v => {
      const tier = _resolveResolutionTier(v);
      if (!tier) return true; // unknown resolution passes through
      return tier === resFlt;
    });
  }

  // Not-watched filter: only show videos that have no history entry
  if (notWatchedFilter.value) {
    list = list.filter(v => !v.watched);
  }

  // Apply sorting or shuffle
  if (isShuffle.value) {
    if (shuffleSeed.value !== _shuffleSeedApplied) {
      _shuffleKeys = new Map();
      _shuffleSeedApplied = shuffleSeed.value;
    }
    const keyFor = (v: any) => {
      let k = _shuffleKeys.get(v.id);
      if (k === undefined) { k = Math.random(); _shuffleKeys.set(v.id, k); }
      return k;
    };
    list.sort((a, b) => keyFor(a) - keyFor(b));
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
export function matchLinkFolder(title: string, folderList: any[], explicitFolder?: string): { catPath: string; category: string } {
  if (explicitFolder) {
    const found = folderList.find((c: any) =>
      c.path === explicitFolder ||
      c.name === explicitFolder ||
      (c.displayName && c.displayName === explicitFolder) ||
      c.path === explicitFolder.replace(/\\/g, '/')
    );
    if (found) {
      return { catPath: found.path, category: found.name };
    }
  }

  const norm = (title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const folder of folderList) {
    if (folder.path === 'Links') continue;
    const key = folder.path.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (key && norm.includes(key)) return { catPath: folder.path, category: folder.name };
  }
  return { catPath: '', category: '' };
}

export async function loadVideos() {
  isLoadingVideos.value = true;
  try {
    await loadVideosInner();
  } catch (e) {
    (window as any).toastError?.('Could not load videos — is the server still running? Check the terminal.');
  } finally {
    isLoadingVideos.value = false;
  }
}

// Re-sync every video-derived surface after an encryption (or other removal)
// WITHOUT flashing the loading skeleton, so the grid doesn't visibly reload.
// `allVideos` feeds the grid, search, and most home widgets; the history caches
// feed the Recent view and the recently-watched / continue-watching widgets.
// This catches encryption started from any entry point and keeps other surfaces
// from showing the now-removed video until a restart.
export async function refreshLibraryQuietly() {
  try { await loadVideosInner(); } catch {}
  try {
    const hist = await (await fetch('/api/history')).json();
    if (Array.isArray(hist)) {
      recentVideos.value = hist;
      const { homeHistory } = await import('./home/homeData');
      homeHistory.value = hist;
    }
  } catch {}
}

async function loadVideosInner() {
  const isVaultGlobal = activeProfile.value === 'Vault' && vaultGlobalView.value;
  const videosUrl = isVaultGlobal ? '/api/videos?all=1' : '/api/videos';
  const foldersUrl = isVaultGlobal ? '/api/folders?all=1' : '/api/folders';
  const [res, bRes, cRes, mcRes] = await Promise.all([
    fetch(videosUrl),
    fetch('/api/links/cache?limit=0').catch(() => null),
    fetch(foldersUrl).catch(() => null),
    fetch('/api/media-counts').catch(() => null),
  ]);
  if (!res.ok) throw new Error('Failed to fetch videos');
  const data = await res.json();

  const cats = cRes ? await cRes.json().catch(() => []) : [];
  if (Array.isArray(cats)) folders.value = cats;

  let linksData: any[] = [];
  try {
    if (bRes) {
      const bData = await bRes.json();
      linksData = bData.items || [];
      linkTotalCount.value = bData.total ?? linksData.length;
    }
  } catch (e) {}

  try {
    if (mcRes && mcRes.ok) {
      const mc = await mcRes.json();
      mediaCounts.value = { links: mc.links || 0, audio: mc.audio || 0, books: mc.books || 0, photos: mc.photos || 0, files: mc.files || 0, pages: mc.pages || 0, screenshots: mc.screenshots || 0 };
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
      const { catPath, category } = matchLinkFolder(b.title, cats, b.category);
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

  // Recompute category counts from combined list (local + link videos)
  if (Array.isArray(cats) && cats.length > 0) {
    const countMap = new Map<string, number>();
    let uncategorizedCount = 0;
    for (const v of combined) {
      const cp = (v.catPath as string) || '';
      if (!cp) {
        uncategorizedCount++;
        continue;
      }
      const parts = cp.split('/');
      let cur = '';
      for (const p of parts) {
        cur = cur ? cur + '/' + p : p;
        countMap.set(cur, (countMap.get(cur) || 0) + 1);
      }
    }
    folders.value = cats.map((c: any) => ({ ...c, count: c.path === 'uncategorized' ? uncategorizedCount : (countMap.get(c.path) || 0) }));
  }

  // Don't call syncUrlToState here — it races with routeToPath's async
  // retry subscription. The initial page URL has already been resolved by
  // routeToPath (called in setupRouter), and URL sync is handled entirely
  // by the updateUrl subscriber + popstate listener.

  // Only redirect to links if no videos found from any source (local + external + links)
  if (data.length === 0 && linkVideos.length === 0) {
    const cur = currentView.value;
    if (cur === 'hub' || cur === 'home' || cur === 'browse' || cur === '') {
      currentView.value = 'links';
    }
  }
}

export async function loadFolders() {
  const res = await fetch('/api/folders');
  const data = await res.json();
  folders.value = data;
}

export async function loadPrefs() {
  const res = await fetch('/api/settings/prefs');
  const data = await res.json();
  appPrefs.value = data;
  // Apply per-profile UI settings stored in prefs
  if (data.theme) {
    document.documentElement.setAttribute('data-theme', data.theme);
    localStorage.setItem('theme', data.theme);
  }
  if (data.cardSize && data.cardSize !== cardSize.value) cardSize.value = data.cardSize;
  if (data.isMuted !== undefined && data.isMuted !== isMuted.value) isMuted.value = !!data.isMuted;
  if (data.thumbBlurMode && data.thumbBlurMode !== thumbBlurMode.value) {
    thumbBlurMode.value = data.thumbBlurMode;
    localStorage.setItem('thumbBlurMode', data.thumbBlurMode);
  }
  _prefsLoaded = true;
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
  if (w.stopZapping) w.stopZapping();
  currentView.value = 'hub';
  currentFolder.value = '';
  currentTag.value = null; currentTagTerms.value = [];
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

  // Entering the Vault always starts in Vault-Only view
  if (view === 'vault') vaultGlobalView.value = false;
  
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
    'folders-view', 'chapters-view'
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
    currentFolder.value = '';
    currentTag.value = null; currentTagTerms.value = [];
    return;
  }
  
  let m;
  if ((m = p.match(/^\/video\/([^/]+)$/))) {
    const vidId = m[1];
    const vid = allVideos.value.find(v => v.id === vidId);
    if (vid) {
      currentVideo.value = vid;
      currentView.value = 'player';
    }
  } else if ((m = p.match(/^\/folder\/([^/]+)$/)) || (m = p.match(/^\/cat\/([^/]+)$/))) {
    currentView.value = 'browse';
    currentFolder.value = decodeURIComponent(m[1]);
    currentTag.value = null; currentTagTerms.value = [];
    currentVideo.value = null;
  } else if ((m = p.match(/^\/tag\/([^/]+)$/))) {
    currentView.value = 'browse';
    currentTag.value = decodeURIComponent(m[1]);
    currentFolder.value = '';
    currentVideo.value = null;
  } else if ((m = p.match(/^\/actor\/([^/]+)$/))) {
    currentView.value = 'actors';
    currentActor.value = decodeURIComponent(m[1]);
    currentFolder.value = '';
    currentTag.value = null; currentTagTerms.value = [];
    currentVideo.value = null;
  } else if ((m = p.match(/^\/channel\/([^/]+)$/))) {
    currentView.value = 'channels';
    currentChannel.value = decodeURIComponent(m[1]);
    currentFolder.value = '';
    currentTag.value = null; currentTagTerms.value = [];
    currentVideo.value = null;
  } else {
    // Other views
    const view = p.replace(/^\//, '');
    currentView.value = view;
    currentVideo.value = null;
    currentFolder.value = '';
    currentTag.value = null; currentTagTerms.value = [];
  }
}

let _urlSyncEnabled = false;
export function enableUrlSync() { _urlSyncEnabled = true; }

// While the router is waiting for `allVideos` to load to resolve a
// /video/:id deep link, currentView/currentVideo briefly sit at their
// initial 'hub'/null values. Suppress URL sync during that window so it
// doesn't overwrite the deep-link URL with '/' before the video loads.
let _routeResolving = false;
export function setRouteResolving(v: boolean) { _routeResolving = v; }

let _pendingUrlUpdate: Promise<void> | null = null;

function doUpdateUrl() {
  if (!_urlSyncEnabled || _routeResolving || typeof window === 'undefined') return;
  const view = currentView.value;
  const video = currentVideo.value;
  let path = '/';

  if (view === 'hub' || view === 'home') {
    path = '/';
  } else if (view === 'player' && video) {
    path = `/video/${encodeURIComponent(video.id)}`;
  } else if (view === 'actors' && currentActor.value) {
    path = `/actor/${encodeURIComponent(currentActor.value)}`;
  } else if (view === 'channels' && currentChannel.value) {
    path = `/channel/${encodeURIComponent(currentChannel.value)}`;
  } else if (view === 'browse' && currentFolder.value) {
    path = `/folder/${encodeURIComponent(currentFolder.value)}`;
  } else if (view === 'browse' && currentTag.value) {
    path = `/tag/${encodeURIComponent(currentTag.value)}`;
  } else if (view === 'player') {
    path = '/'; // player without a video — go home
  } else {
    path = `/${view}`;
  }

  if (window.location.pathname !== path) {
    history.pushState(null, '', path);
  }
}

/**
 * Schedule a URL update that coalesces multiple signal changes within the
 * same synchronous task (e.g. setting currentVideo then currentView) into
 * a single history pushState. This prevents intermediate/wrong URLs from
 * polluting the browser history during navigation transitions.
 */
function scheduleUrlUpdate() {
  if (_pendingUrlUpdate) return;
  _pendingUrlUpdate = Promise.resolve().then(() => {
    _pendingUrlUpdate = null;
    doUpdateUrl();
  });
}

if (typeof window !== 'undefined') {
  currentView.subscribe(scheduleUrlUpdate);
  currentFolder.subscribe(scheduleUrlUpdate);
  currentTag.subscribe(scheduleUrlUpdate);
  currentVideo.subscribe(scheduleUrlUpdate);
  // popstate and initial routing are handled by setupRouter() in router.ts
}

// ─── Scroll position memory ──────────────────────────────────────────
// Remember where the grid was scrolled so returning from the player (or any
// other view) lands the user back at the same spot instead of the top.
if (typeof window !== 'undefined') {
  const scrollMem = new Map<string, number>();
  // Views that share the scrolling library grid — keyed together so e.g.
  // browse→player→browse restores, but switching to Settings doesn't leak.
  const scrollKey = () => {
    const v = currentView.value;
    if (v === 'browse' || v === 'hub' || v === 'favourites' || v === 'recent') {
      return `${v}:${currentFolder.value}:${currentTag.value || ''}`;
    }
    return null;
  };
  let prevKey = scrollKey();
  currentView.subscribe(() => {
    // Save the outgoing view's scroll before it unmounts.
    if (prevKey) scrollMem.set(prevKey, window.scrollY);
    const nextKey = scrollKey();
    prevKey = nextKey;
    if (nextKey != null && scrollMem.has(nextKey)) {
      const y = scrollMem.get(nextKey)!;
      // Wait for the new view to render before restoring.
      requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
    }
  });
}

w.loadC = async () => {
  const data = await api.fetchFolders();
  folders.value = data;
  if (w.renCats) w.renCats();
};

w.createFolder = async () => {
  const name = prompt('New folder name:');
  if (!name || !name.trim()) return;
  try {
    const d = await api.createFolder(name.trim());
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
  
  if (w.foldersMode) { closeView('folders-view', 'foldersMode'); closeView('folders-view-sidebar', 'foldersMode'); }
  if (w.recentMode) { closeView('recent-sidebar', 'recentMode'); }
  if (w.vaultMode) { closeView('vault-view', 'vaultMode'); closeView('vault-sidebar', 'vaultMode'); }
  if (w.channelMode) { closeView('channels-view', 'channelMode'); closeView('channel-detail-view', 'channelMode'); closeView('channel-sidebar', 'channelMode'); }
  if (w.actorMode) { closeView('actors-view', 'actorMode'); closeView('actor-detail-view', 'actorMode'); closeView('actor-sidebar', 'actorMode'); }
  
  currentTag.value = null; currentTagTerms.value = [];
  
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

w.openChannel = (name: string) => {
  currentView.value = 'channels';
  currentChannel.value = name;
  history.pushState(null, '', `/channel/${encodeURIComponent(name)}`);
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
  const r = await fetch(`/api/videos/${id}`, { method: 'DELETE' }).catch(() => null);
  if (!r || !r.ok) {
    const err = r ? await r.json().catch(() => ({})) : {};
    (window as any).toastError?.(`Could not delete "${name}" — ${(err as any).error || 'the file may be open in another program or already gone.'}`);
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