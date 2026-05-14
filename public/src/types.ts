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
  catPath?: string;
  fav?: boolean;
  chapters?: any[];
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
  ollamaUrl?: string;
  ollamaVisionModel?: string;
  anthropicApiKey?: string;
  visionProvider?: string;
  disableSearchTracking?: boolean;
  vaultSelfDestruct?: boolean;
  hiddenTags?: string[];
  sourceFolders?: string[];
}
export interface ThumbnailGroup {
  id: string;
  count: number;
  thumbs: string[];
}
