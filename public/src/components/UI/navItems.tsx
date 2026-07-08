import type { ComponentChildren, VNode } from 'preact';
import {
  currentView, isSidebarOpen, currentFolder, currentPhotoFolder,
  allVideos, mediaCounts, showConnectModal, sourceFilter,
  appPrefs, updatePrefs, currentActor, currentChannel,
} from '../../store';
import type { PluginMeta } from '../../plugins';

export type NavSection = 'library' | 'media' | 'tools';
export type BarLocation = 'topbar' | 'sidebar';

export interface NavItem {
  id: string;
  label: string;
  section: NavSection;
  /** Where the item lives when the user hasn't overridden it. */
  defaultLoc: BarLocation;
  /** Inner SVG content; wrapped at the requested size by the caller. */
  paths: ComponentChildren;
  onClick: () => void;
  isActive: boolean;
  badge?: number;
}

// The two filter blocks are movable too, but rendered specially (folder/tag
// trees in the sidebar; dropdown menus in the topbar), so they're not NavItems.
export const FILTER_IDS = { folders: 'folders-filter', tags: 'tags-filter', links: 'links-filter' } as const;

const setView = (view: string, legacyFn?: string) => {
  // Clear detail-scoped selections so a top-level nav click lands on the list
  // view (e.g. /actors) rather than re-emitting a stale /actor/<name> URL.
  currentActor.value = null;
  currentChannel.value = null;
  currentView.value = view;
  isSidebarOpen.value = false;
  if (legacyFn && (window as any)[legacyFn]) (window as any)[legacyFn]();
};

/** Resolve the effective bar for a movable item id given its default. */
export function placementFor(id: string, defaultLoc: BarLocation): BarLocation {
  return appPrefs.value.itemPlacements?.[id] ?? defaultLoc;
}

export const PLUGINS_GROUP_ID = 'plugins-group';

/** Effective location for a plugin.
 *  - 'home': home-dashboard widget (never moved)
 *  - 'topbar': standalone icon button in the topbar (default for location:'topbar' plugins)
 *  - 'sidebar': labeled link in the sidebar (default for location:'sidebar' plugins)
 */
export function pluginLocation(p: PluginMeta): 'home' | 'topbar' | 'sidebar' {
  if (p.location === 'home') return 'home';
  const override = appPrefs.value.itemPlacements?.[p.id];
  if (override === 'topbar') return 'topbar';
  if (override === 'sidebar') return 'sidebar';
  return p.location as 'topbar' | 'sidebar';
}

/**
 * Effective bar for the grouped Plugins dropdown — the bucket that holds every
 * plugin the user hasn't individually pinned somewhere. Defaults to the topbar.
 */
export function pluginGroupLocation(): BarLocation {
  return (appPrefs.value.itemPlacements?.[PLUGINS_GROUP_ID] as BarLocation) ?? 'topbar';
}

/**
 * Whether a plugin belongs to the grouped Plugins dropdown rather than rendering
 * standalone. Home-dashboard widgets never group; a per-item placement override
 * pulls a plugin out of the group into its own icon/entry.
 */
export function pluginInGroup(p: PluginMeta): boolean {
  return p.location !== 'home' && !appPrefs.value.itemPlacements?.[p.id];
}

export async function setItemPlacement(id: string, loc: BarLocation) {
  const next = { ...(appPrefs.value.itemPlacements || {}) };
  next[id] = loc;
  await updatePrefs({ itemPlacements: next });
}

export function sectionPlacementFor(section: NavSection): BarLocation {
  return (appPrefs.value.sectionPlacements?.[section] as BarLocation) ?? 'topbar';
}

export async function setSectionPlacement(section: NavSection, loc: BarLocation) {
  const next = { ...(appPrefs.value.sectionPlacements || {}) };
  next[section] = loc;
  await updatePrefs({ sectionPlacements: next });
}

/** Whether a topbar dropdown button is collapsed to icon-only. */
export function isDropdownShrunken(id: string): boolean {
  return ((appPrefs.value as any).collapsedDropdowns || []).includes(id);
}

export async function toggleDropdownShrunken(id: string) {
  const curr: string[] = (appPrefs.value as any).collapsedDropdowns || [];
  const next = curr.includes(id) ? curr.filter((x: string) => x !== id) : [...curr, id];
  await updatePrefs({ collapsedDropdowns: next } as any);
}

/**
 * Open the move context menu for any movable item.
 * location: 'sidebar' | 'topbar' = block-level moves (whole dropdown/filter block)
 * location: 'topbar-dropdown' = item inside a topbar section/plugins dropdown (can go to icon or sidebar)
 * location: 'topbar-icon' = standalone icon in topbar (can go to sidebar or reset)
 */
export function openMoveMenu(e: any, id: string, label: string, location: BarLocation | 'topbar-dropdown' | 'topbar-icon', extra?: any) {
  (window as any).showContextMenu?.(e, 'navitem', { id, label, location, ...extra });
}

export function openSectionMoveMenu(e: any, section: NavSection, label: string, location: BarLocation) {
  (window as any).showContextMenu?.(e, 'navsection', { section, label, location });
}

export type NavOrderKey = `sidebar_${NavSection}` | 'topbar' | 'sidebar_plugins';

export function getNavOrder(key: NavOrderKey): string[] {
  return ((appPrefs.value as any).navOrder)?.[key] ?? [];
}

export async function setNavOrder(key: NavOrderKey, ids: string[]) {
  const curr = ((appPrefs.value as any).navOrder) ?? {};
  await updatePrefs({ navOrder: { ...curr, [key]: ids } } as any);
}

export function sortByOrder(items: NavItem[], key: NavOrderKey): NavItem[] {
  const order = getNavOrder(key);
  if (!order.length) return items;
  const rank = (id: string) => { const i = order.indexOf(id); return i === -1 ? 9999 : i; };
  return [...items].sort((a, b) => rank(a.id) - rank(b.id));
}

/** Shared drag state so Sidebar and Topbar can coordinate cross-bar drops. */
export const activeDrag: { id: string; fromLoc: BarLocation | '' } = { id: '', fromLoc: '' };

/** Wrap stored icon paths in an svg at the given size. */
export function navIcon(paths: ComponentChildren, size: number, style?: any): VNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={style}>
      {paths}
    </svg>
  );
}

/**
 * The full registry of movable navigation items. Reads signals on each call so
 * badges/active state stay reactive — call it from within a component render.
 */
export function getNavItems(): NavItem[] {
  const view = currentView.value;
  const vids = allVideos.value;
  const mc = mediaCounts.value;

  return [
    // ── Library ─────────────────────────────────────────────
    {
      id: 'home-sidebar', label: 'Home', section: 'library', defaultLoc: 'sidebar',
      paths: <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></>,
      onClick: () => setView('hub'), isActive: view === 'hub',
    },
    {
      id: 'fBtn', label: 'Favourites', section: 'library', defaultLoc: 'sidebar',
      paths: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />,
      onClick: () => setView('favourites', 'toggleFav'), isActive: view === 'favourites',
    },
    {
      id: 'recent-sidebar', label: 'Recently Watched', section: 'library', defaultLoc: 'sidebar',
      paths: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
      onClick: () => setView('recent', 'showRecent'), isActive: view === 'recent',
    },
    {
      id: 'playlists-sidebar', label: 'Playlist', section: 'library', defaultLoc: 'sidebar',
      paths: <><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /></>,
      onClick: () => setView('playlists', 'showPlaylists'), isActive: view === 'playlists',
    },
    {
      id: 'actor-sidebar', label: 'Actors', section: 'library', defaultLoc: 'sidebar',
      paths: <><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" /></>,
      onClick: () => setView('actors', 'showActors'), isActive: view === 'actors',
    },
    {
      id: 'series-sidebar', label: 'Series', section: 'library', defaultLoc: 'sidebar',
      paths: <><rect x="2" y="7" width="20" height="15" rx="2" /><polyline points="17 2 12 7 7 2" /></>,
      onClick: () => setView('series'), isActive: view === 'series',
    },
    {
      id: 'chapters-sidebar', label: 'Chapters', section: 'library', defaultLoc: 'sidebar',
      paths: <><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></>,
      onClick: () => setView('chapters', 'showChaptersView'), isActive: view === 'chapters',
    },
    {
      id: 'download-queue-sidebar', label: 'Download Queue', section: 'library', defaultLoc: 'sidebar',
      paths: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>,
      onClick: () => setView('download-queue'), isActive: view === 'download-queue',
    },
    {
      id: 'database-sidebar', label: 'Database', section: 'library', defaultLoc: 'sidebar',
      paths: <><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></>,
      onClick: () => setView('database', 'showDatabase'), isActive: view === 'database',
    },
    {
      id: 'settings-sidebar', label: 'Settings', section: 'library', defaultLoc: 'sidebar',
      paths: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
      onClick: () => setView('settings', 'showSettings'), isActive: view === 'settings',
    },
    {
      id: 'guide-sidebar', label: 'Guide', section: 'library', defaultLoc: 'sidebar',
      paths: <><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></>,
      onClick: () => setView('guide'), isActive: view === 'guide',
    },

    // ── Media ───────────────────────────────────────────────
    {
      id: 'categories-view-sidebar', label: 'Folders', section: 'library', defaultLoc: 'sidebar',
      paths: <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
      onClick: () => setView('folders', 'showCategoriesView'), isActive: view === 'folders',
    },
    {
      id: 'channel-sidebar', label: 'Channels', section: 'library', defaultLoc: 'sidebar',
      paths: <><rect x="2" y="7" width="20" height="15" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /><line x1="12" y1="12" x2="12" y2="16" /><line x1="10" y1="14" x2="14" y2="14" /></>,
      onClick: () => setView('channels', 'showChannels'), isActive: view === 'channels',
    },
    {
      id: 'videos-media-sidebar', label: 'Videos', section: 'media', defaultLoc: 'sidebar',
      paths: <path d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9A2.25 2.25 0 0 0 13.5 5.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />,
      onClick: () => { sourceFilter.value = 'local'; setView('browse'); }, isActive: view === 'browse',
      badge: vids.filter(v => !(v as any).isLink).length || undefined,
    },
    {
      id: 'photos-sidebar', label: 'Photos', section: 'media', defaultLoc: 'sidebar',
      paths: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></>,
      onClick: () => { currentPhotoFolder.value = ''; setView('photos', 'showPhotos'); },
      isActive: view === 'photos' && !currentPhotoFolder.value,
      badge: mc.photos || undefined,
    },
    {
      id: 'screenshots-sidebar', label: 'Screenshots', section: 'media', defaultLoc: 'sidebar',
      paths: <><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>,
      onClick: () => setView('screenshots'), isActive: view === 'screenshots',
      badge: mc.screenshots || undefined,
    },
    {
      id: 'audio-sidebar', label: 'Audio', section: 'media', defaultLoc: 'sidebar',
      paths: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
      onClick: () => setView('audio', 'showAudio'), isActive: view === 'audio',
      badge: mc.audio || undefined,
    },
    {
      id: 'books-sidebar', label: 'Books', section: 'media', defaultLoc: 'sidebar',
      paths: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>,
      onClick: () => setView('books', 'showBooks'), isActive: view === 'books',
      badge: mc.books || undefined,
    },
    {
      id: 'files-sidebar', label: 'Files', section: 'media', defaultLoc: 'sidebar',
      paths: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>,
      onClick: () => setView('files'), isActive: view === 'files',
      badge: mc.files || undefined,
    },
    {
      id: 'pages-sidebar', label: 'Pages', section: 'media', defaultLoc: 'sidebar',
      paths: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></>,
      onClick: () => setView('pages', 'showPages'), isActive: view === 'pages',
      badge: mc.pages || undefined,
    },
    {
      id: 'thumbnails-sidebar', label: 'Thumbnails', section: 'media', defaultLoc: 'sidebar',
      paths: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></>,
      onClick: () => setView('thumbnails'), isActive: view === 'thumbnails',
    },

    // ── Tools ───────────────────────────────────────────────
    {
      id: 'rss-sidebar', label: 'RSS', section: 'tools', defaultLoc: 'sidebar',
      paths: <><path d="M4 11a9 9 0 0 1 9 9" /><path d="M4 4a16 16 0 0 1 16 16" /><circle cx="5" cy="19" r="1" /></>,
      onClick: () => setView('rss'), isActive: view === 'rss',
    },
    {
      id: 'search-sites-sidebar', label: 'Search', section: 'tools', defaultLoc: 'sidebar',
      paths: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /><path d="M11 8v6M8 11h6" /></>,
      onClick: () => setView('search', 'showSearchSites'), isActive: view === 'search',
    },
    {
      id: 'prompts-sidebar', label: 'AI Prompts', section: 'tools', defaultLoc: 'sidebar',
      paths: <><path d="M12 2a10 10 0 1 0 10 10" /><path d="M12 8v4l3 3" /><path d="M18 2v4h4" /></>,
      onClick: () => setView('prompts'), isActive: view === 'prompts',
    },
    {
      id: 'subtitles-sidebar', label: 'Subtitles', section: 'tools', defaultLoc: 'sidebar',
      paths: <><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M6 11h4" /><path d="M6 15h8" /><path d="M16 3l-4-2-4 2" /></>,
      onClick: () => setView('subtitles'), isActive: view === 'subtitles',
    },
    {
      id: 'categorizer-sidebar', label: 'Categorizer', section: 'tools', defaultLoc: 'sidebar',
      paths: <><rect x="3" y="3" width="8" height="8" rx="1" /><rect x="13" y="3" width="8" height="8" rx="1" /><rect x="3" y="13" width="8" height="8" rx="1" /><rect x="13" y="13" width="8" height="8" rx="1" /></>,
      onClick: () => setView('categorizer'), isActive: view === 'categorizer',
    },
    {
      id: 'renamer-sidebar', label: 'Renamer', section: 'tools', defaultLoc: 'sidebar',
      paths: <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
      onClick: () => setView('renamer'), isActive: view === 'renamer',
    },
    {
      id: 'duplicates-sidebar', label: 'Duplicates', section: 'tools', defaultLoc: 'sidebar',
      paths: <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
      onClick: () => setView('duplicates'), isActive: view === 'duplicates',
    },
    {
      id: 'corrupted-sidebar', label: 'Corrupted', section: 'tools', defaultLoc: 'sidebar',
      paths: <><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>,
      onClick: () => setView('corrupted'), isActive: view === 'corrupted',
    },
    {
      id: 'connect-sidebar', label: 'Connect', section: 'tools', defaultLoc: 'sidebar',
      paths: <><path d="M5 12.55a11 11 0 0 1 14.08 0" /><path d="M1.42 9a16 16 0 0 1 21.16 0" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><circle cx="12" cy="20" r="1" fill="currentColor" /></>,
      onClick: () => { showConnectModal.value = true; isSidebarOpen.value = false; }, isActive: false,
    },
    {
      id: 'assistantBtn', label: 'Assistant', section: 'tools', defaultLoc: 'topbar',
      paths: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
      onClick: () => setView('assistant'), isActive: view === 'assistant',
    },
  ];
}
