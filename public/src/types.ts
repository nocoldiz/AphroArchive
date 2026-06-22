export interface Video {
  id: string;
  name: string;
  path: string;
  relPath: string;
  size: number;
  duration: number;
  durationF?: string;
  mtime: number;
  category: string;
  starred: boolean;
  rating?: number;
  tags?: string[];
  actors?: string[];
  note?: string;
  channel?: string;
  width?: number | null;
  height?: number | null;
  watched?: boolean;
  isVault?: boolean;
  streamUrl?: string;
  reencoded?: boolean;
  catPath?: string;
  fav?: boolean;
  chapters?: any[];
  isExternal?: boolean;
  isLink?: boolean;
  embedUrl?: string;
  linkUrl?: string;
  img?: string;
  hasVideo?: boolean;
  hasEmbed?: boolean;
}

export interface Folder {
  name: string;
  path: string;
  count: number;
  encrypted?: boolean;
  partial?: boolean;
  // Temporarily opened folder (Open button) — not part of the library DB.
  opened?: boolean;
  openedRoot?: string;
  // Virtual folder backed by a ZIP archive (media-zip mount).
  isZipMount?: boolean;
  // Encrypted ZIP archive awaiting a password before its contents are shown.
  locked?: boolean;
}

export interface Actor {
  name: string;
  count: number;
  photo?: string;
}

export interface Channel {
  name: string;
  count: number;
}

export interface AppPrefs {
  theme: string;
  cardSize: number;
  networkEnabled: boolean;
  chronologyMode: 'keep' | 'delete-on-startup' | 'dont-save';
  aiCommentMasterPrompt?: string;
  aiReplyMasterPrompt?: string;
  aiCommentsEnabled?: boolean;
  anthropicApiKey?: string;
  disableSearchTracking?: boolean;
  vaultSelfDestruct?: boolean;
  vaultTimeoutMinutes?: number;
  hiddenTags?: string[];
  sourceFolders?: string[];
  feedFolders?: string[];
  privateFeedFolders?: string[];
  vaultFeedFolder?: string;
  rssFeeds?: { url: string; name?: string; category?: string }[];
  videosDir?: string;
  videosDirExists?: boolean;
  openrouterApiKey?: string;
  openrouterModel?: string;
  isMuted?: boolean;
  thumbBlurMode?: string;
  hideEmptyFolders?: boolean;
  pinnedFolders?: string[];
  pinnedTags?: string[];
  comfyuiUrl?: string;
  comfyuiWorkflowJson?: string;
  comfyuiPositiveNodeId?: string;
  disabledPlugins?: string[];
  homeDashboard?: any[];
  whisperEnabled?: boolean;
  whisperModel?: 'tiny' | 'base' | 'small' | 'medium' | 'large' | 'turbo';
  whisperLanguage?: string;
  autoChapterDetection?: boolean;
  /**
   * Allow the player to transcode unsupported formats (e.g. mkv/HEVC) to HLS
   * on the fly via ffmpeg. When false the player only ever direct-streams the
   * original file. Defaults to enabled.
   */
  hlsTranscode?: boolean;
  /**
   * Per-item bar placement overrides. Maps a movable item id (nav item,
   * plugin id, or the 'folders-filter' / 'tags-filter' blocks) to the bar it
   * should render in. Absent keys fall back to the item's default location.
   */
  itemPlacements?: Record<string, 'topbar' | 'sidebar'>;
  /** Per-section bar placement overrides. Maps 'library'|'media'|'tools' → bar. */
  sectionPlacements?: Record<string, 'topbar' | 'sidebar'>;
  /** Which edge the sidebar docks to. */
  sidebarSide?: 'left' | 'right';
  /** Whether the sidebar stays fixed or only reveals on hover. */
  sidebarReveal?: 'fixed' | 'hover';
}
export interface ThumbnailGroup {
  id: string;
  count: number;
  thumbs: string[];
}

export interface Book {
  id: string;
  title?: string;
  filename: string;
  ext?: string;
  size?: number;
  sizeF?: string;
  date?: number;
  type?: 'fanfiction' | 'url' | 'local';
  chapters?: number;
}

export interface AudioFile {
  id: string;
  title: string;
  ext: string;
  size: number;
  sizeF: string;
  date: number;
}

export interface AlbumTrack {
  trackNumber: number;
  title: string;
  duration: number | null;
}

export interface Album {
  id: string;
  name: string;
  artist: string;
  year?: number | null;
  cover?: string;
  tracks: AlbumTrack[];
}

export interface PhotoFile {
  id: string;
  filename: string;
  folder: string;
  size: number;
  sizeF: string;
  date: number;
  isAi?: boolean;
  aiPrompt?: string;
}

export interface ScreenshotFile {
  id: string;
  filename: string;
  folder: string;
  ext: string;
  size: number;
  sizeF: string;
  date: number;
}

export interface PageItem {
  id: string;
  name: string;
  sizeF: string;
  mtime: string | number;
}
