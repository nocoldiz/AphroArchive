#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
//  AphroArchive — Zero-dependency local video site
//  Usage:  node server.js [videos_folder] [port]
//  Example: node server.js ~/Movies 8080
//  Default: ./videos on port 3000
// ═══════════════════════════════════════════════════════════════════

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { exec } = require('child_process');

const cfg = require('./server/config-server');
const { PORT, IS_PKG, VIDEOS_DIR, AUDIO_DIR, BOOKS_DIR, PHOTOS_DIR, PAGES_DIR, CACHE_DIR,
  WEBSITES_JSON, CATEGORIES_JSON, LINK_DIR, BM_CACHE_FILE,
  BROWSER_WHITELIST_FILE, HIDDEN_FILE, RATINGS_FILE } = cfg;

const { json, serveStatic, readBody } = require('./server/helpers-server');
const { loadPrefs, saveHistory, loadWebsites, saveWebsites, loadStarredSites, saveStarredSites } = require('./server/db-server');
const { initVideoMeta } = require('./server/videos-server');
const { getLocalIPs, getLocalIP } = require('./server/config-server');

// ── Modules ──────────────────────────────────────────────────────────

const videos = require('./server/videos-server');
const actors = require('./server/actors-server');
const vault = require('./server/vault-server');
const thumbnails = require('./server/thumbnails-server');
const genThumbs = require('./server/gen-thumbs-server');
const collections = require('./server/collections-server');
const downloads = require('./server/downloads-server');
const links = require('./server/links-server');
const books = require('./server/books-server');
const audio = require('./server/audio-server');
const photos = require('./server/photos-server');
const database = require('./server/database-server');
const profiles = require('./server/profiles-server');
const remote = require('./server/remote-server');
const settings = require('./server/settings-server');
const prompts = require('./server/prompts-server');
const comments = require('./server/comments-server');
const vision = require('./server/vision-server');
const vaultZip = require('./server/vault-zip-server');
const pages = require('./server/pages-server');
const duplicates = require('./server/duplicates-server');
const { startBackgroundWorker } = require('./server/background-worker-server');
const feedWatcher = require('./server/feed-watcher-server');
const imagegen    = require('./server/imagegen-server');
const assistant   = require('./server/assistant-server');

// ── Startup: create required directories ─────────────────────────────

function ensureDirSync(dirPath) {
  try {
    const stats = fs.lstatSync(dirPath);
    if (stats.isSymbolicLink() && !fs.existsSync(dirPath)) {
      console.warn(`\x1b[33m⚠️  Warning: '${dirPath}' is a broken symlink (target is missing). Unlinking and creating a local directory...\x1b[0m`);
      fs.unlinkSync(dirPath);
    }
  } catch (err) {
    // If the path doesn't exist, lstatSync will throw, which is expected.
  }
  fs.mkdirSync(dirPath, { recursive: true });
}

ensureDirSync(CACHE_DIR);
ensureDirSync(VIDEOS_DIR);
ensureDirSync(AUDIO_DIR);
ensureDirSync(BOOKS_DIR);
ensureDirSync(PHOTOS_DIR);
ensureDirSync(PAGES_DIR);
ensureDirSync(cfg.LINK_THUMBS_DIR);
ensureDirSync(path.dirname(BM_CACHE_FILE));
ensureDirSync(path.join(process.cwd(), 'models'));

// Model loading is deferred — initiated on first use via reinitIfNeeded()

// ── Seed default category folders ────────────────────────────────────

const DEFAULT_CATEGORIES = [];
for (const name of DEFAULT_CATEGORIES) {
  fs.mkdirSync(path.join(VIDEOS_DIR, name), { recursive: true });
}

// ── Migration: whitelist.txt → websites.json ─────────────────────────
// Only run if the DB has already been initialised via the preset picker
// (categories.json exists). On a fresh install the preset picker handles
// writing all DB files — we don't want to pre-create websites.json and
// interfere with that flow.

(function migrateWhitelist() {
  if (!fs.existsSync(CATEGORIES_JSON)) return; // wait for preset picker
  if (fs.existsSync(WEBSITES_JSON)) return;
  let entries = [];
  if (fs.existsSync(BROWSER_WHITELIST_FILE)) {
    const lines = fs.readFileSync(BROWSER_WHITELIST_FILE, 'utf-8')
      .split('\n').map(l => l.trim()).filter(Boolean);
    entries = lines.map(line => ({
      name: line, url: line.startsWith('http') ? line : 'https://' + line,
      searchURL: '', scrapeMethod: '', tags: [], description: '',
    }));
  }
  fs.writeFileSync(WEBSITES_JSON, JSON.stringify(entries, null, 2));
})();

// ── Network access guard ─────────────────────────────────────────────

function isLocalhost(req) {
  const addr = req.socket?.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

// ── HTTP server ───────────────────────────────────────────────────────

let _serverReady = false;

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const p = urlObj.pathname;
  const params = urlObj.searchParams;

  // Block remote connections unless network access is explicitly enabled
  if (!isLocalhost(req) && !loadPrefs().networkEnabled) {
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:3rem;color:#555"><h2>Network access is disabled</h2><p>Enable it from the <b>Connect</b> menu on the main device.</p></body></html>');
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Filename');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  let m;

  // ── Video routes ────────────────────────────────────────────────────
  if (p === '/api/videos/rescan' && req.method === 'POST') return videos.apiRescan(req, res);
  if (p === '/api/videos/auto-categorize' && req.method === 'POST') return videos.apiAutoCategorizeUncategorized(req, res);
  if (p === '/api/videos/recategorize-all' && req.method === 'POST') return videos.apiRecategorizeAll(req, res);
  if (p === '/api/videos/categorize-plan' && req.method === 'POST') return videos.apiCategorizePlan(req, res);
  if (p === '/api/videos/categorize-execute' && req.method === 'POST') return videos.apiCategorizeExecute(req, res);
  if (p === '/api/videos/recategorize-all' && req.method === 'POST') return videos.apiRecategorizeAll(req, res);
  if (p === '/api/videos' && req.method === 'GET') return videos.apiVideos(req, res, params);
  if (p === '/api/categories' && req.method === 'GET') return videos.apiCategories(req, res);
  if (p === '/api/categories-overview' && req.method === 'GET') return videos.apiCategoriesOverview(req, res);
  if (p === '/api/all-categories' && req.method === 'GET') return videos.apiGetAllCategories(req, res);
  if (p === '/api/enabled-categories' && req.method === 'POST') return videos.apiSetEnabledCategories(req, res);
  if (p === '/api/main-categories' && req.method === 'GET') return videos.apiMainCategories(req, res);
  if (p === '/api/main-categories' && req.method === 'POST') return videos.apiCreateCategory(req, res);
  if (p === '/api/open-folder' && req.method === 'POST') return videos.apiOpenFolder(req, res);
  if (p === '/api/open-category-folder' && req.method === 'POST') return videos.apiOpenCategoryFolder(req, res);
  if (p === '/api/favourites' && req.method === 'GET') return videos.apiFavourites(req, res);
  if (p === '/api/history' && req.method === 'GET') return videos.apiGetHistory(req, res);
  if (p === '/api/history' && req.method === 'DELETE') return videos.apiClearHistory(req, res);
  if (p === '/api/duplicates' && req.method === 'GET') return videos.apiDuplicates(req, res);
  if (p === '/api/duplicates/scan' && req.method === 'POST') return duplicates.apiDuplicatesScan(req, res, await videos.cachedScan());
  if (p === '/api/duplicates/stop' && req.method === 'POST') return duplicates.apiDuplicatesStop(req, res);
  if (p === '/api/duplicates/status' && req.method === 'GET') return duplicates.apiDuplicatesStatus(req, res);
  if (p === '/api/duplicates/results' && req.method === 'GET') return duplicates.apiDuplicatesResults(req, res);
  if (p === '/api/auto-sort' && req.method === 'POST') return videos.apiAutoSort(req, res);
  if (p === '/api/import' && req.method === 'POST') return videos.apiImport(req, res);
  if (p === '/api/categories/rename' && req.method === 'PATCH') return videos.apiRenameCategory(req, res);
  if (p === '/api/categories/delete' && req.method === 'DELETE') return videos.apiDeleteCategory(req, res);
  if (p === '/api/categories/hide' && req.method === 'POST') return videos.apiHideCategory(req, res);
  if (p === '/api/categories/encrypt' && req.method === 'POST') return videos.apiEncryptCategory(req, res);
  if (p === '/api/categories/unlock' && req.method === 'POST') return videos.apiUnlockCategory(req, res);
  if (p === '/api/categories/decrypt' && req.method === 'POST') return videos.apiDecryptCategory(req, res);
  if (p === '/api/categories/encrypt-all' && req.method === 'POST') return videos.apiEncryptAllCategories(req, res);
  if (p === '/api/categories/compress' && req.method === 'POST') return videos.apiCompressCategory(req, res);
  if (p === '/api/encryption/status' && req.method === 'GET') return videos.apiEncryptionStatus(req, res);
  if (p === '/api/encryption/stop' && req.method === 'POST') return videos.apiEncryptionStop(req, res);

  if ((m = p.match(/^\/api\/videos\/([^/]+)$/)) && req.method === 'GET') return videos.apiVideoDetail(req, res, m[1]);
  if ((m = p.match(/^\/api\/videos\/([^/]+)$/)) && req.method === 'DELETE') return videos.apiDelete(req, res, m[1]);
  if ((m = p.match(/^\/api\/videos\/([^/]+)\/encrypt$/)) && req.method === 'POST') return videos.apiEncryptVideo(req, res, m[1]);
  if ((m = p.match(/^\/api\/stream\/([^/]+)$/)) && req.method === 'GET') return videos.apiStream(req, res, m[1]);
  if ((m = p.match(/^\/api\/favourites\/([^/]+)$/)) && req.method === 'POST') return videos.apiToggleFav(req, res, m[1]);
  if ((m = p.match(/^\/api\/history\/([^/]+)$/)) && req.method === 'POST') return videos.apiAddHistory(req, res, m[1]);
  if ((m = p.match(/^\/api\/ratings\/([^/]+)$/)) && req.method === 'POST') return videos.apiSetRating(req, res, decodeURIComponent(m[1]));
  if ((m = p.match(/^\/api\/ratings\/([^/]+)$/)) && req.method === 'DELETE') return videos.apiDeleteRating(req, res, decodeURIComponent(m[1]));
  if ((m = p.match(/^\/api\/videos\/([^/]+)\/rename$/)) && req.method === 'PATCH') return videos.apiRename(req, res, m[1]);
  if ((m = p.match(/^\/api\/videos\/([^/]+)\/move$/)) && req.method === 'PATCH') return videos.apiMove(req, res, m[1]);
  if ((m = p.match(/^\/api\/videos\/([^/]+)\/meta$/)) && req.method === 'PATCH') return videos.apiUpdateVideoMeta(req, res, m[1]);
  if ((m = p.match(/^\/api\/subtitles\/([^/]+)$/)) && req.method === 'GET') return videos.apiSubtitles(req, res, m[1]);
  if ((m = p.match(/^\/api\/subtitles\/([^/]+)$/)) && req.method === 'POST') return videos.apiSaveSubtitles(req, res, m[1]);
  if ((m = p.match(/^\/api\/subtitle-file\/([^/]+)\/(.+)$/)) && req.method === 'GET') return videos.apiSubtitleFile(req, res, m[1], decodeURIComponent(m[2]));
  if ((m = p.match(/^\/api\/videos\/([^/]+)\/chapters$/)) && req.method === 'POST') return videos.apiAddChapter(req, res, m[1]);
  if ((m = p.match(/^\/api\/videos\/([^/]+)\/chapters\/([^/]+)$/)) && req.method === 'DELETE') return videos.apiDeleteChapter(req, res, m[1], m[2]);

  // ── Tags / Studios ───────────────────────────────────────────────────
  if (p === '/api/tags' && req.method === 'GET') return videos.apiTags(req, res);
  if (p === '/api/db-tags' && req.method === 'GET') return videos.apiDbTags(req, res);
  if (p === '/api/tag-suggestions' && req.method === 'GET') return videos.apiTagSuggestions(req, res);
  if ((m = p.match(/^\/api\/videos\/([^/]+)\/tags$/)) && req.method === 'GET') return videos.apiVideoTags(req, res, m[1]);
  if ((m = p.match(/^\/api\/db-tags\/(.+)$/)) && req.method === 'GET') return videos.apiDbTagVideos(req, res, decodeURIComponent(m[1]));
  if ((m = p.match(/^\/api\/tags\/(.+)$/)) && req.method === 'GET') return videos.apiTagVideos(req, res, decodeURIComponent(m[1]));
  if (p === '/api/studios' && req.method === 'GET') return videos.apiStudios(req, res);
  if ((m = p.match(/^\/api\/studios\/(.+)$/)) && req.method === 'GET') return videos.apiStudioVideos(req, res, decodeURIComponent(m[1]));

  // ── Actors ───────────────────────────────────────────────────────────
  if (p === '/api/actors' && req.method === 'GET') return actors.apiActors(req, res);
  if ((m = p.match(/^\/api\/actors\/(.+)$/)) && req.method === 'GET') return actors.apiActorVideos(req, res, decodeURIComponent(m[1]));
  if (p === '/api/actor-photos' && req.method === 'GET') return actors.apiActorPhotos(req, res);
  if ((m = p.match(/^\/api\/actor-photos\/(.+)\/scrape$/)) && req.method === 'POST') return actors.apiActorPhotoScrape(req, res, decodeURIComponent(m[1]));
  if ((m = p.match(/^\/api\/actor-photos\/(.+)\/img$/)) && req.method === 'GET') return actors.apiActorPhotoImg(req, res, decodeURIComponent(m[1]));
  if (p === '/api/actors/scrape-missing' && req.method === 'POST') return actors.apiActorsScrapeMissing(req, res);

  // ── Thumbnails ───────────────────────────────────────────────────────
  if ((m = p.match(/^\/api\/thumbs\/([^/]+)\/generate$/)) && req.method === 'POST') return thumbnails.apiThumbGen(req, res, m[1]);
  if ((m = p.match(/^\/api\/thumbs\/([^/]+)\/(\d+)$/)) && req.method === 'GET') return thumbnails.apiThumbImg(req, res, m[1], parseInt(m[2], 10));
  if (p === '/api/thumbnails' && req.method === 'GET') return thumbnails.apiThumbnailsList(req, res);
  if ((m = p.match(/^\/api\/thumbs\/([^/]+)\/chapter\/([^/]+)$/)) && req.method === 'GET') return thumbnails.apiChapterThumbImg(req, res, m[1], m[2]);
  if (p === '/api/gen-thumbs/start' && req.method === 'POST') return genThumbs.apiGenThumbsStart(req, res);
  if (p === '/api/gen-thumbs/stop' && req.method === 'POST') return genThumbs.apiGenThumbsStop(req, res);
  if (p === '/api/gen-thumbs/status' && req.method === 'GET') return genThumbs.apiGenThumbsStatus(req, res);
  if (p === '/api/gen-thumbs/poll' && req.method === 'GET') return genThumbs.apiGenThumbsStatusPoll(req, res);

  // ── Collections ──────────────────────────────────────────────────────
  if (p === '/api/collections' && req.method === 'GET') return collections.apiCollections(req, res);
  if (p === '/api/collections' && req.method === 'POST') return collections.apiCollectionCreate(req, res);
  if ((m = p.match(/^\/api\/collections\/([^/]+)$/)) && req.method === 'DELETE') return collections.apiCollectionDelete(req, res, decodeURIComponent(m[1]));
  if ((m = p.match(/^\/api\/collections\/([^/]+)\/videos$/)) && req.method === 'GET') return collections.apiCollectionVideos(req, res, decodeURIComponent(m[1]));
  if ((m = p.match(/^\/api\/collections\/([^/]+)\/videos$/)) && req.method === 'POST') return collections.apiCollectionAddVideo(req, res, decodeURIComponent(m[1]));
  if ((m = p.match(/^\/api\/collections\/([^/]+)\/videos\/([^/]+)$/)) && req.method === 'DELETE') return collections.apiCollectionRemoveVideo(req, res, decodeURIComponent(m[1]), decodeURIComponent(m[2]));

  // ── Downloads ────────────────────────────────────────────────────────
  if (p === '/api/download' && req.method === 'POST') return downloads.apiDownloadAdd(req, res);
  if (p === '/api/download/jobs' && req.method === 'GET') return downloads.apiDownloadJobs(req, res);
  if (p === '/api/download/cancel-all' && req.method === 'POST') return downloads.apiDownloadCancelAll(req, res);
  if (p === '/api/download/check' && req.method === 'GET') return downloads.apiDownloadCheck(req, res);
  if ((m = p.match(/^\/api\/download\/jobs\/([^/]+)$/)) && req.method === 'DELETE') return downloads.apiDownloadRemove(req, res, m[1]);
  if (p === '/api/download-queue' && req.method === 'GET') return downloads.apiReadDownloadQueue(req, res);
  if (p === '/api/download-queue' && req.method === 'POST') return downloads.apiWriteDownloadQueue(req, res);
  if (p === '/api/download-queue/add' && req.method === 'POST') return downloads.apiDownloadQueueAdd(req, res);
  if (p === '/api/download-queue/remove' && req.method === 'POST') return downloads.apiDownloadQueueRemove(req, res);
  if (p === '/api/bulk-download/start' && req.method === 'POST') return downloads.apiBulkDownloadStart(req, res);
  if (p === '/api/bulk-download/status' && req.method === 'GET') return downloads.apiBulkDownloadStatus(req, res);
  if (p === '/api/bulk-download/stop' && req.method === 'POST') return downloads.apiBulkDownloadStop(req, res);

  // ── Image Generation ──────────────────────────────────────────────────
  if (p === '/api/imagegen/config'        && req.method === 'GET')  return imagegen.apiGetConfig(req, res);
  if (p === '/api/imagegen/config'        && req.method === 'PUT')  return imagegen.apiSetConfig(req, res);
  if (p === '/api/imagegen/assets'        && req.method === 'GET')  return imagegen.apiGetAssets(req, res);
  if (p === '/api/imagegen/status'        && req.method === 'GET')  return imagegen.apiGetStatus(req, res);
  if (p === '/api/imagegen/generate'      && req.method === 'POST') return imagegen.apiGenerate(req, res);
  if (p === '/api/imagegen/cancel'        && req.method === 'POST') return imagegen.apiCancel(req, res);
  if (p === '/api/imagegen/engine/start'  && req.method === 'POST') return imagegen.apiStartEngine(req, res);
  if (p === '/api/imagegen/engine/stop'   && req.method === 'POST') return imagegen.apiStopEngine(req, res);
  if (p === '/api/imagegen/gallery'       && req.method === 'GET')  return imagegen.apiGallery(req, res);
  if (p === '/api/imagegen/progress'      && req.method === 'GET')  return imagegen.apiProgress(req, res);
  if ((m = p.match(/^\/api\/imagegen\/wildcards\/([^/]+)$/)) && req.method === 'GET')    return imagegen.apiGetWildcard(req, res, m[1]);
  if ((m = p.match(/^\/api\/imagegen\/wildcards\/([^/]+)$/)) && req.method === 'PUT')    return imagegen.apiSaveWildcard(req, res, m[1]);
  if ((m = p.match(/^\/api\/imagegen\/wildcards\/([^/]+)$/)) && req.method === 'DELETE') return imagegen.apiDeleteWildcard(req, res, m[1]);
  if ((m = p.match(/^\/api\/imagegen\/image\/([^/]+)$/))     && req.method === 'GET')    return imagegen.apiServeImage(req, res, m[1]);
  if ((m = p.match(/^\/api\/imagegen\/image\/([^/]+)$/))     && req.method === 'DELETE') return imagegen.apiDeleteImage(req, res, m[1]);
  if (p === '/api/imagegen/comfyui/start'                    && req.method === 'POST')   return imagegen.apiStartComfyui(req, res);
  if (p === '/api/imagegen/comfyui/sync'                     && req.method === 'POST')   return imagegen.apiSyncComfyui(req, res);
  if (p === '/api/imagegen/upload'                           && req.method === 'POST')   return imagegen.apiUploadImage(req, res);
  if (p === '/api/imagegen/encrypt-generated'                && req.method === 'POST')   return imagegen.apiEncryptGenerated(req, res);

  // ── Links / Websites ─────────────────────────────────────────────
  if (p === '/api/websites' && req.method === 'GET') return json(res, loadWebsites());
  if (p === '/api/links/save-to-db' && req.method === 'POST') {
    const body = await readBody(req);
    const result = require('./server/db-server').saveLinksToDb(body.items || []);
    return json(res, result);
  }
  if (p === '/api/websites/starred' && req.method === 'GET') return json(res, loadStarredSites());
  if (p === '/api/websites/star' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.url) return json(res, { error: 'url required' }, 400);
    const starred = loadStarredSites();
    const idx = starred.indexOf(body.url);
    if (idx >= 0) starred.splice(idx, 1); else starred.push(body.url);
    saveStarredSites(starred);
    return json(res, { starred: idx < 0, urls: starred });
  }
  if (p === '/api/websites' && req.method === 'POST') return links.apiWebsiteAdd(req, res);
  if (p === '/api/websites/from-links' && req.method === 'GET') return links.apiWebsitesFromLinks(req, res);
  if (p === '/api/websites/bulk-add' && req.method === 'POST') return links.apiWebsitesBulkAdd(req, res);
  if ((m = p.match(/^\/api\/websites\/(\d+)$/)) && req.method === 'DELETE') return links.apiWebsiteDelete(req, res, parseInt(m[1]));
  if ((m = p.match(/^\/api\/websites\/(\d+)$/)) && req.method === 'PUT') return links.apiWebsiteUpdate(req, res, parseInt(m[1]));
  if (p === '/api/scrape' && req.method === 'GET') return links.apiScrape(req, res);
  if (p === '/api/og-thumb' && req.method === 'GET') return links.apiOgThumb(req, res);
  if (p === '/api/links/generate-thumb' && req.method === 'POST') return links.apiGenerateLinkThumb(req, res);
  if (p === '/api/links/generate-all' && req.method === 'POST') return links.apiGenerateAllLinkThumbs(req, res);
  if (p === '/api/links/generation-status' && req.method === 'GET') return links.apiLinkGenerationStatus(req, res);
  if (p === '/api/links/scrape-status' && req.method === 'GET') return links.apiScrapeStatus(req, res);
  if (p === '/api/links/stop-scraping' && req.method === 'POST') return links.apiStopScraping(req, res);
  if (p === '/api/links/thumb-status' && req.method === 'GET') return links.apiLinkThumbStatus(req, res);
  if (p === '/api/links/stop-generating' && req.method === 'POST') return links.apiStopLinkThumbs(req, res);
  if (p === '/api/links/start-scraping' && req.method === 'POST') return links.apiStartScraping(req, res);
  if (p === '/api/links/rescrape-all' && req.method === 'POST') return links.apiRescrapeAll(req, res);
  if ((m = p.match(/^\/api\/links\/thumbs\/(.+)$/)) && req.method === 'GET') return links.apiLinkThumbImg(req, res, m[1]);
  if (p === '/api/links/cache' && req.method === 'GET') return links.apiGetLinksCache(req, res);
  if (p === '/api/links/cache' && req.method === 'POST') return links.apiSaveLinksCache(req, res);
  if (p === '/api/links/import-urls' && req.method === 'POST') return links.apiImportLinks(req, res);
  if (p === '/api/links/export'      && req.method === 'GET')  return links.apiExportLinksJson(req, res);
  if (p === '/api/links/import-json' && req.method === 'POST') return links.apiImportLinksJson(req, res);
  if (p === '/api/links/move'        && req.method === 'PATCH') return links.apiLinkMove(req, res);
  if (p === '/api/browser-favs' && req.method === 'GET') return links.apiBrowserFavs(req, res);
  if (p === '/api/browser-favs/file' && req.method === 'POST') return links.apiBrowserFavsFile(req, res);

  // ── Vault ────────────────────────────────────────────────────────────
  if (p === '/api/vault/status' && req.method === 'GET') return vault.apiVaultStatus(req, res);
  if (p === '/api/vault/setup' && req.method === 'POST') return vault.apiVaultSetup(req, res);
  if (p === '/api/vault/unlock' && req.method === 'POST') return vault.apiVaultUnlock(req, res);
  if (p === '/api/vault/lock' && req.method === 'POST') return vault.apiVaultLock(req, res);
  if (p === '/api/vault/files' && req.method === 'GET') return vault.apiVaultFiles(req, res);
  if (p === '/api/vault/add' && req.method === 'POST') return vault.apiVaultAdd(req, res);
  if ((m = p.match(/^\/api\/vault\/stream\/([^/]+)$/)) && req.method === 'GET') return vault.apiVaultStream(req, res, m[1]);
  if ((m = p.match(/^\/api\/vault\/files\/([^/]+)$/)) && req.method === 'DELETE') return vault.apiVaultDelete(req, res, m[1]);
  if ((m = p.match(/^\/api\/vault\/files\/([^/]+)$/)) && req.method === 'PATCH') return vault.apiVaultMoveFile(req, res, m[1]);
  if ((m = p.match(/^\/api\/vault\/download\/([^/]+)$/)) && req.method === 'GET') return vault.apiVaultDownload(req, res, m[1]);
  if ((m = p.match(/^\/api\/vault\/files\/([^/]+)\/ai-tag$/)) && req.method === 'POST') return vault.apiVaultAiTag(req, res, m[1]);
  if ((m = p.match(/^\/api\/vault\/files\/([^/]+)\/rename$/)) && req.method === 'PUT') return vault.apiVaultRename(req, res, m[1]);
  if (p === '/api/vault/download-zip' && req.method === 'POST') return vaultZip.apiVaultDownloadZip(req, res);
  if (p === '/api/category/download-zip' && req.method === 'POST') return vaultZip.apiCategoryDownloadZip(req, res);
  if (p === '/api/vault/folders' && req.method === 'POST') return vault.apiVaultCreateFolder(req, res);
  if ((m = p.match(/^\/api\/vault\/folders\/([^/]+)$/)) && req.method === 'DELETE') return vault.apiVaultDeleteFolder(req, res, m[1]);
  if (p === '/api/vault/favs' && req.method === 'GET') return vault.apiVaultFavsGet(req, res);
  if ((m = p.match(/^\/api\/vault\/favs\/([^/]+)$/)) && req.method === 'POST') return vault.apiVaultFavsToggle(req, res, m[1]);
  if (p === '/api/vault/change-password' && req.method === 'POST') return vault.apiVaultChangePassword(req, res);
  if ((p === '/api/vault' && req.method === 'DELETE') || (p === '/api/vault/delete-vault' && req.method === 'POST')) return vault.apiVaultDeleteVault(req, res);
  if (p === '/api/vault/read-book' && req.method === 'GET') return vault.apiVaultReadBook(req, res, params.get('id'));
  if ((m = p.match(/^\/api\/vault\/stream-page\/([^/]+)$/)) && req.method === 'GET') return vault.apiVaultStreamPage(req, res, m[1]);
  if ((m = p.match(/^\/api\/vault\/page-resource\/([^/]+)\/([^/]+)$/)) && req.method === 'GET') return vault.apiVaultPageResource(req, res, m[1], m[2]);
  if ((m = p.match(/^\/api\/vault\/text\/([^/]+)$/)) && req.method === 'PUT') return vault.apiVaultUpdateTextFile(req, res, m[1]);
  if (p === '/api/vault/import-drop' && req.method === 'POST') return vault.apiVaultImportDrop(req, res);
  if ((m = p.match(/^\/api\/vault\/files\/([^/]+)\/restore$/)) && req.method === 'POST') return vault.apiVaultRestoreFile(req, res, m[1]);
  if ((m = p.match(/^\/api\/vault\/files\/([^/]+)\/restore-to-origin$/)) && req.method === 'POST') return vault.apiVaultRestoreToOrigin(req, res, m[1]);
  if (p === '/api/vault/links' && req.method === 'GET') return vault.apiVaultGetLinks(req, res);
  if (p === '/api/vault/import-links' && req.method === 'POST') return vault.apiVaultImportLinks(req, res);
  if (p === '/api/vault/move-links' && req.method === 'POST') return vault.apiVaultMoveLinks(req, res);
  if (p === '/api/vault/restore-link' && req.method === 'POST') return vault.apiVaultRestoreLink(req, res);

  // ── Presets ──────────────────────────────────────────────────────────
  if (p === '/api/presets' && req.method === 'GET') return profiles.apiGetPresets(req, res);
  if (p === '/api/presets/apply' && req.method === 'POST') return profiles.apiApplyPreset(req, res);
  
  // ── Profiles ─────────────────────────────────────────────────────────
  if (p === '/api/profiles' && req.method === 'GET') return profiles.apiGetProfiles(req, res);
  if (p === '/api/profiles/switch' && req.method === 'POST') return profiles.apiSwitchProfile(req, res);
  if (p === '/api/profiles/create' && req.method === 'POST') return profiles.apiCreateProfile(req, res);
  if (p === '/api/profiles/rename' && req.method === 'POST') return profiles.apiRenameProfile(req, res);
  if (p === '/api/profiles/delete' && req.method === 'POST') return profiles.apiDeleteProfile(req, res);
  if (p === '/api/profiles/clone' && req.method === 'POST') return profiles.apiCloneProfile(req, res);

  // ── Database ─────────────────────────────────────────────────────────
  if (p === '/api/db/category-tags' && req.method === 'GET') return database.apiGetCategoryTags(req, res);
  if (p === '/api/db/category-tags' && req.method === 'POST') return database.apiUpdateCategoryTags(req, res);
  if ((m = p.match(/^\/api\/db\/(actors|categories|studios|websites)\/export$/)) && req.method === 'GET') return database.apiDbExportJson(req, res, m[1]);
  if ((m = p.match(/^\/api\/db\/(actors|categories|studios|websites)\/import$/)) && req.method === 'POST') return database.apiDbImportJson(req, res, m[1]);
  if ((m = p.match(/^\/api\/db\/(actors|categories|studios|websites)$/)) && req.method === 'GET') return database.apiDbGet(req, res, m[1]);
  if ((m = p.match(/^\/api\/db\/(actors|categories|studios|websites)$/)) && req.method === 'POST') return database.apiDbUpsert(req, res, m[1]);
  if ((m = p.match(/^\/api\/db\/(actors|categories|studios|websites)\/(.+)$/)) && req.method === 'DELETE') return database.apiDbDelete(req, res, m[1], decodeURIComponent(m[2]));
  if (p === '/api/db/import' && req.method === 'POST') return database.apiDbImport(req, res);

  // ── Books ────────────────────────────────────────────────────────────
  if (p === '/api/books' && req.method === 'GET') return books.apiBooksList(req, res);
  if (p === '/api/books/upload' && req.method === 'POST') return books.apiBooksUpload(req, res);
  if (p === '/api/books/import-url' && req.method === 'POST') return books.apiBooksImportUrl(req, res);
  if ((m = p.match(/^\/api\/books\/read\/([^/]+)$/)) && req.method === 'GET') return books.apiBooksRead(req, res, m[1]);
  if ((m = p.match(/^\/api\/books\/([^/]+)$/)) && req.method === 'PUT') return books.apiBooksWrite(req, res, m[1]);
  if ((m = p.match(/^\/api\/books\/([^/]+)$/)) && req.method === 'DELETE') return books.apiBooksDelete(req, res, m[1]);
  if ((m = p.match(/^\/api\/books\/cbz\/([^/]+)\/files$/)) && req.method === 'GET') return books.apiBooksCbzFiles(req, res, m[1]);
  if ((m = p.match(/^\/api\/books\/cbz\/([^/]+)\/file\/(.+)$/)) && req.method === 'GET') return books.apiBooksCbzFile(req, res, m[1], m[2]);

  // ── Audio ────────────────────────────────────────────────────────────
  if (p === '/api/audio' && req.method === 'GET') return audio.apiAudioList(req, res);
  if (p === '/api/audio/upload' && req.method === 'POST') return audio.apiAudioUpload(req, res);
  if ((m = p.match(/^\/api\/audio\/([^/]+)\/stream$/)) && req.method === 'GET') return audio.apiAudioStream(req, res, m[1]);
  if ((m = p.match(/^\/api\/audio\/([^/]+)$/)) && req.method === 'DELETE') return audio.apiAudioDelete(req, res, m[1]);

  // ── Photos ───────────────────────────────────────────────────────────
  if (p === '/api/videos/upload' && req.method === 'POST') return videos.apiVideosUpload(req, res);
  if (p === '/api/photos' && req.method === 'GET') return photos.apiPhotosList(req, res);
  if (p === '/api/photos/folders' && req.method === 'GET') return photos.apiPhotoFolders(req, res);
  if (p === '/api/photos/upload' && req.method === 'POST') return photos.apiPhotosUpload(req, res);
  if ((m = p.match(/^\/api\/photos\/([^/]+)\/img$/)) && req.method === 'GET') return photos.apiPhotoServe(req, res, m[1]);
  if ((m = p.match(/^\/api\/photos\/([^/]+)\/download$/)) && req.method === 'GET') return photos.apiPhotoDownload(req, res, m[1]);
  if ((m = p.match(/^\/api\/photos\/([^/]+)$/)) && req.method === 'DELETE') return photos.apiPhotoDelete(req, res, m[1]);

  // ── Pages ────────────────────────────────────────────────────────────
  if (p === '/api/pages' && req.method === 'GET') return pages.apiPagesList(req, res);
  if (p === '/api/pages/upload' && req.method === 'POST') return pages.apiPageUpload(req, res);
  if ((m = p.match(/^\/api\/pages\/([^/]+)\/stream$/)) && req.method === 'GET') return pages.apiPageStream(req, res, m[1]);
  if ((m = p.match(/^\/api\/pages\/([^/]+)$/)) && req.method === 'DELETE') return pages.apiPageDelete(req, res, m[1]);

  // ── Vision ───────────────────────────────────────────────────────────
  if (p === '/api/vision/describe' && req.method === 'POST') return vision.apiVisionDescribe(req, res);
  if (p === '/api/assistant/chat'  && req.method === 'POST') return assistant.apiAssistantChat(req, res);

  // ── Prompts ──────────────────────────────────────────────────────────
  if (p === '/api/prompts/run-local' && req.method === 'POST') return prompts.apiRunLocal(req, res);
  if (p === '/api/prompts' && req.method === 'GET') return prompts.apiGetPrompts(req, res);
  if (p === '/api/prompts' && req.method === 'POST') return prompts.apiAddPrompt(req, res);
  if (p === '/api/prompts/all' && req.method === 'DELETE') return prompts.apiDeleteAllPrompts(req, res);
  if ((m = p.match(/^\/api\/prompts\/([^/]+)$/)) && req.method === 'PATCH') return prompts.apiUpdatePrompt(req, res, m[1]);
  if ((m = p.match(/^\/api\/prompts\/([^/]+)$/)) && req.method === 'DELETE') return prompts.apiDeletePrompt(req, res, m[1]);
  if (p === '/api/comfyui/status' && req.method === 'GET') return prompts.apiComfyStatus(req, res);
  if (p === '/api/comfyui/workflows' && req.method === 'GET') return prompts.apiComfyWorkflows(req, res);
  if (p === '/api/comfyui/send' && req.method === 'POST') return prompts.apiComfySend(req, res);

  // ── Panic Button ─────────────────────────────────────────────────────
  if (p === '/api/panic' && req.method === 'POST') {
    console.log('\n\x1b[1;31m⚠️  PANIC BUTTON TRIGGERED — shutting down\x1b[0m\n');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!DOCTYPE html><html><head><title></title><style>body{background:#000;margin:0;padding:0}</style></head><body></body></html>');
    // Use a short timeout to let the response be sent before exiting
    setTimeout(() => {
      process.exit(0);
    }, 100);
    return;
  }

  // ── Remote control ───────────────────────────────────────────────────
  if (p === '/api/remote/events' && req.method === 'GET') return remote.apiRemoteEvents(req, res);
  if (p === '/api/remote/command' && req.method === 'POST') return remote.apiRemoteCommand(req, res);

  // ── Settings / Prefs ─────────────────────────────────────────────────
  if (p === '/api/settings/lists' && req.method === 'GET') return settings.apiSettingsLists(req, res);
  if ((m = p.match(/^\/api\/settings\/(hidden|whitelist)$/)) && req.method === 'PUT') return settings.apiSettingsSave(req, res, m[1]);
  if (p === '/api/settings/prefs' && req.method === 'GET') return settings.apiGetPrefs(req, res);
  if (p === '/api/settings/prefs' && req.method === 'PUT') return settings.apiSavePrefs(req, res);
  if (p === '/api/browse-folders' && req.method === 'GET') return settings.apiBrowseFolders(req, res, params);
  if (p === '/api/browse-folders-native' && req.method === 'GET') return settings.apiBrowseFoldersNative(req, res);
  if (p === '/api/feed-folders/verify-vault' && req.method === 'POST') return settings.apiVerifyVaultPassword(req, res);

  // ── AI Comments ──────────────────────────────────────────────────────
  if (p === '/api/comments/clear-all' && req.method === 'DELETE') return comments.apiClearAllComments(req, res);
  if (p === '/api/comments/generate' && req.method === 'POST') return comments.apiGenerateComments(req, res);
  if (p === '/api/comments/reply' && req.method === 'POST') return comments.apiReplyToComment(req, res);
  if (p === '/api/comments/model/status' && req.method === 'GET') return comments.apiModelStatus(req, res);
  if (p === '/api/comments/model/download' && req.method === 'POST') return comments.apiDownloadModel(req, res);
  if (p === '/api/comments/model/download' && req.method === 'DELETE') return comments.apiCancelDownload(req, res);
  {
    const m = p.match(/^\/api\/comments\/([^/]+)\/add$/);
    if (m && req.method === 'POST') return comments.apiAddComment(req, res, decodeURIComponent(m[1]));
  }
  {
    const m = p.match(/^\/api\/comments\/([^/]+)$/);
    if (m && req.method === 'GET') return comments.apiGetComments(req, res, decodeURIComponent(m[1]));
  }

  // ── Local IP ─────────────────────────────────────────────────────────
  if (p === '/api/local-ip' && req.method === 'GET') {
    const ips = getLocalIPs();
    const best = ips[0] || null;
    return json(res, {
      ip: best ? best.ip : null,
      port: PORT,
      url: best ? `http://${best.ip}:${PORT}` : null,
      all: ips.map(e => ({ ip: e.ip, name: e.name, url: `http://${e.ip}:${PORT}` })),
    });
  }

  // ── Ping / connect verification (lightweight status) ─────────────────
  if (p === '/api/ping' && req.method === 'GET') {
    const prefs = loadPrefs();
    return json(res, { ok: true, app: 'AphroArchive', networkEnabled: !!prefs.networkEnabled });
  }

  // ── Ready signal from frontend — deferred heavy work ─────────────────
  if (p === '/api/ready' && req.method === 'POST') {
    json(res, { ok: true });
    if (!_serverReady) {
      _serverReady = true;
      initVideoMeta().catch(() => {});
      startBackgroundWorker();
    }
    return;
  }

  // ── Static / SPA ─────────────────────────────────────────────────────
  const filePath = p === '/' ? 'index.html' : p.replace(/^\//, '');
  const spaRoutes = /^\/(thumbnails|links|duplicates|vault|recent|collections|scraper|settings|database|actors|studios|books|audio|photos|pages|search|favourites|video\/|tag\/|cat\/|actor\/|studio\/|collection\/)/;
  if (spaRoutes.test(p)) return serveStatic(req, res, 'index.html');
  serveStatic(req, res, filePath);
});

// ── Listen ───────────────────────────────────────────────────────────

server.listen(PORT, () => {
  if (loadPrefs().chronologyMode === 'delete-on-startup') saveHistory([]);
  feedWatcher.startWatchers(loadPrefs());
  const localIP = getLocalIP();
  console.log(`\n  \x1b[1;31m▶\x1b[0m  \x1b[1mAphroArchive\x1b[0m running at \x1b[4mhttp://localhost:${PORT}\x1b[0m`);
  if (localIP) console.log(`  \x1b[1;36m📡\x1b[0m  Network:  \x1b[4mhttp://${localIP}:${PORT}\x1b[0m`);
  console.log(`  \x1b[90m📁  Videos: ${VIDEOS_DIR}\x1b[0m`);
  console.log(`  \x1b[90m📂  Public: ${path.join(__dirname, 'public')}\x1b[0m\n`);
  if (IS_PKG) {
    const openCmd = process.platform === 'win32' ? `start http://localhost:${PORT}`
      : process.platform === 'darwin' ? `open http://localhost:${PORT}`
        : `xdg-open http://localhost:${PORT}`;
    exec(openCmd);
  }
});
