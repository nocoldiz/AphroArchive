// ─── Global State ───
let V = [], cats = [], sort = 'date', cat = '', q = '', favM = false, curV = null, renId = null;
let _allVideos = []; // full unfiltered video list for local filtering
let _dbTagTerms = {}; // displayName → terms[], populated by loadTagSidebar
let srcFilter = 'both'; // 'both' | 'local' | 'remote'
let recentMode = false, recentVids = [];
let movId = null, movCurCat = '', shuf = false;
let pinnedV = null, pinnedPl = [], pinnedIdx = 0;
let mosaicOn = false, mosaicTimer = null, mosaicIv = 8;
let vaultMode = false, vaultSelMode = false, scraperMode = false, importFavsMode = false, booksMode = false, audioMode = false, photosMode = false, categoriesMode = false;
let remoteMode = false;
const vaultSel = new Set();
let vaultFiles = [], vaultPl = [], vaultPlIdx = 0, vaultQ = '', vaultSort = 'mtime', vaultSortDir = 'desc', vaultShuf = false, vaultPhotoIdx = -1, vaultPhotos = [];
let vaultFolders = [], vaultCurFolder = null; // null = root
const VAULT_IMG_EXTS = new Set(['.jpg','.jpeg','.png','.gif','.webp','.avif','.bmp','.heic']);
const VAULT_IMAGE_EXTS = new Set(['.jpg','.jpeg','.png','.gif','.webp','.avif','.bmp','.heic']);
let studioMode = false, curStudio = null;
let actorMode = false, curActor = null;
let curTag = null;
const thumbMap = {}, thumbQueue = [];
let thumbRunning = 0, thumbObs = null, hoverTimer = null, hoverEl = null, hoverIdx = 0;
let zapOn = false, zapTimer = null, zapIv = 8, zapLock = false;
let zapNextVid = null, zapNextTime = 0;
let activePlayer = 'video-player';
const bookmarkVidIds = new Set();
const bmMatchedUrls = new Set();
let collectionsMode = false, curCollection = null;
let settingsMode = false;
let aiCommentsEnabled = false;
let dbMode = false, dbTab = 'actors', _dbData = {};
let curVTags = [], curVAllCategories = [], curVActors = [];
let curVRating = null;
let curVStudio = '';
let mosTileCount = 6, mosHoveredIdx = -1, mosTilesState = [];
const playlistSkipped = new Set();
let bmThumbObs = null;
let acTerms = [];
let _bfCats = [];
let _bfItems = [], _bfMatchedCount = 0, _bfVisible = [], _bfKnownTerms = [];
let _bfViewMode = 'list';
let dlPoller = null;
let cvTargetId = null;
let promptsMode = false;
let dualMode = false;
let dualActive = 'left'; // 'left' | 'right'
let dualR = { q: '', cat: '', curTag: null };
let _dualTagVids = []; // server-fetched tag vids for right pane slow path
