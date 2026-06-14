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
  studio?: string;
  actors?: string[];
  isVault?: boolean;
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

export interface Category {
  name: string;
  path: string;
  count: number;
  encrypted?: boolean;
  partial?: boolean;
}

export interface Actor {
  name: string;
  count: number;
  photo?: string;
}

export interface Studio {
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
  videosDir?: string;
  videosDirExists?: boolean;
  openrouterApiKey?: string;
  openrouterModel?: string;
  isMuted?: boolean;
  thumbBlurMode?: string;
  hideEmptyFolders?: boolean;
  comfyuiPath?: string;
  comfyuiUrl?: string;
  comfyuiWorkflowJson?: string;
  comfyuiPositiveNodeId?: string;
  disabledPlugins?: string[];
  homeDashboard?: any[];
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
