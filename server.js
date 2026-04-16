#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
//  AphroArchive — Zero-dependency local video site
//  Usage:  node server.js [videos_folder] [port]
//  Example: node server.js ~/Movies 8080
//  Default: ./videos on port 3000
// ═══════════════════════════════════════════════════════════════════

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');
const { exec } = require('child_process');

const cfg = require('./server/config-server');
const { PORT, IS_PKG, VIDEOS_DIR, AUDIO_DIR, BOOKS_DIR, PHOTOS_DIR, CACHE_DIR,
        WEBSITES_JSON, BM_DIR, BM_CACHE_FILE,
        BROWSER_WHITELIST_FILE, HIDDEN_FILE, RATINGS_FILE } = cfg;

const { json, serveStatic, readBody } = require('./server/helpers-server');
const { loadPrefs, saveHistory, loadWebsites, saveWebsites, loadStarredSites, saveStarredSites } = require('./server/db-server');
const { initVideoMeta }        = require('./server/videos-server');
const { getLocalIPs, getLocalIP } = require('./server/config-server');

// ── Modules ──────────────────────────────────────────────────────────

const videos      = require('./server/videos-server');
const actors      = require('./server/actors-server');
const vault       = require('./server/vault-server');
const thumbnails  = require('./server/thumbnails-server');
const collections = require('./server/collections-server');
const downloads   = require('./server/downloads-server');
const bookmarks   = require('./server/bookmarks-server');
const books       = require('./server/books-server');
const audio       = require('./server/audio-server');
const photos      = require('./server/photos-server');
const database    = require('./server/database-server');
const remote      = require('./server/remote-server');
const settings    = require('./server/settings-server');
const prompts     = require('./server/prompts-server');
const comments    = require('./server/comments-server');

// ── Startup: create required directories ─────────────────────────────

fs.mkdirSync(CACHE_DIR,   { recursive: true });
fs.mkdirSync(VIDEOS_DIR,  { recursive: true });
fs.mkdirSync(AUDIO_DIR,   { recursive: true });
fs.mkdirSync(BOOKS_DIR,   { recursive: true });
fs.mkdirSync(PHOTOS_DIR,  { recursive: true });
fs.mkdirSync(path.dirname(BM_CACHE_FILE), { recursive: true });
fs.mkdirSync(path.join(process.cwd(), 'models'), { recursive: true });

(async () => { await comments.initCommentsModel(); })();

// ── Seed default category folders ────────────────────────────────────

const DEFAULT_CATEGORIES = ['Straight', 'Gay', 'Lesbian', 'Bisexual', 'Transgender'];
for (const name of DEFAULT_CATEGORIES) {
  fs.mkdirSync(path.join(VIDEOS_DIR, name), { recursive: true });
}

// ── Migration: bookmarks_cache.json old location ─────────────────────

(function migrateBookmarksCache() {
  const oldPath = path.join(BM_DIR, 'bookmarks_cache.json');
  if (fs.existsSync(oldPath) && !fs.existsSync(BM_CACHE_FILE)) {
    try {
      fs.mkdirSync(path.dirname(BM_CACHE_FILE), { recursive: true });
      fs.copyFileSync(oldPath, BM_CACHE_FILE);
      fs.unlinkSync(oldPath);
    } catch {}
  }
})();

// ── Migration: whitelist.txt → websites.json ─────────────────────────

(function migrateWhitelist() {
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

// ── HTTP server ───────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const p      = parsed.pathname;
  const params = new URLSearchParams(parsed.search || '');

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Filename');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  let m;

  // ── Video routes ────────────────────────────────────────────────────
  if (p === '/api/videos' && req.method === 'GET') return videos.apiVideos(req, res, params);
  if (p === '/api/categories' && req.method === 'GET') return videos.apiCategories(req, res);
  if (p === '/api/categories-overview' && req.method === 'GET') return videos.apiCategoriesOverview(req, res);
  if (p === '/api/main-categories' && req.method === 'GET') return videos.apiMainCategories(req, res);
  if (p === '/api/main-categories' && req.method === 'POST') return videos.apiCreateCategory(req, res);
  if (p === '/api/open-folder' && req.method === 'POST') return videos.apiOpenFolder(req, res);
  if (p === '/api/favourites' && req.method === 'GET') return videos.apiFavourites(req, res);
  if (p === '/api/history' && req.method === 'GET') return videos.apiGetHistory(req, res);
  if (p === '/api/history' && req.method === 'DELETE') return videos.apiClearHistory(req, res);
  if (p === '/api/duplicates' && req.method === 'GET') return videos.apiDuplicates(req, res);
  if (p === '/api/auto-sort' && req.method === 'POST') return videos.apiAutoSort(req, res);
  if (p === '/api/import' && req.method === 'POST') return videos.apiImport(req, res);

  if ((m = p.match(/^\/api\/videos\/([^/]+)$/)) && req.method === 'GET') return videos.apiVideoDetail(req, res, m[1]);
  if ((m = p.match(/^\/api\/videos\/([^/]+)$/)) && req.method === 'DELETE') return videos.apiDelete(req, res, m[1]);
  if ((m = p.match(/^\/api\/stream\/([^/]+)$/)) && req.method === 'GET') return videos.apiStream(req, res, m[1]);
  if ((m = p.match(/^\/api\/favourites\/([^/]+)$/)) && req.method === 'POST') return videos.apiToggleFav(req, res, m[1]);
  if ((m = p.match(/^\/api\/history\/([^/]+)$/)) && req.method === 'POST') return videos.apiAddHistory(req, res, m[1]);
  if ((m = p.match(/^\/api\/ratings\/([^/]+)$/)) && req.method === 'POST') return videos.apiSetRating(req, res, decodeURIComponent(m[1]));
  if ((m = p.match(/^\/api\/ratings\/([^/]+)$/)) && req.method === 'DELETE') return videos.apiDeleteRating(req, res, decodeURIComponent(m[1]));
  if ((m = p.match(/^\/api\/videos\/([^/]+)\/rename$/)) && req.method === 'PATCH') return videos.apiRename(req, res, m[1]);
  if ((m = p.match(/^\/api\/videos\/([^/]+)\/move$/)) && req.method === 'PATCH') return videos.apiMove(req, res, m[1]);
  if ((m = p.match(/^\/api\/videos\/([^/]+)\/meta$/)) && req.method === 'PATCH') return videos.apiUpdateVideoMeta(req, res, m[1]);
  if ((m = p.match(/^\/api\/subtitles\/([^/]+)$/)) && req.method === 'GET') return videos.apiSubtitles(req, res, m[1]);
  if ((m = p.match(/^\/api\/subtitle-file\/([^/]+)\/(.+)$/)) && req.method === 'GET') return videos.apiSubtitleFile(req, res, m[1], decodeURIComponent(m[2]));

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

  // ── Thumbnails ───────────────────────────────────────────────────────
  if ((m = p.match(/^\/api\/thumbs\/([^/]+)\/generate$/)) && req.method === 'POST') return thumbnails.apiThumbGen(req, res, m[1]);
  if ((m = p.match(/^\/api\/thumbs\/([^/]+)\/(\d+)$/)) && req.method === 'GET') return thumbnails.apiThumbImg(req, res, m[1], parseInt(m[2], 10));

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
  if (p === '/api/download/check' && req.method === 'GET') return downloads.apiDownloadCheck(req, res);
  if ((m = p.match(/^\/api\/download\/jobs\/([^/]+)$/)) && req.method === 'DELETE') return downloads.apiDownloadRemove(req, res, m[1]);
  if (p === '/api/download-queue' && req.method === 'GET') return downloads.apiReadDownloadQueue(req, res);
  if (p === '/api/download-queue' && req.method === 'POST') return downloads.apiWriteDownloadQueue(req, res);
  if (p === '/api/download-queue/add' && req.method === 'POST') return downloads.apiDownloadQueueAdd(req, res);
  if (p === '/api/download-queue/remove' && req.method === 'POST') return downloads.apiDownloadQueueRemove(req, res);

  // ── Bookmarks / Websites ─────────────────────────────────────────────
  if (p === '/api/websites' && req.method === 'GET') return json(res, loadWebsites());
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
  if (p === '/api/websites' && req.method === 'POST') return bookmarks.apiWebsiteAdd(req, res);
  if ((m = p.match(/^\/api\/websites\/(\d+)$/)) && req.method === 'DELETE') return bookmarks.apiWebsiteDelete(req, res, parseInt(m[1]));
  if ((m = p.match(/^\/api\/websites\/(\d+)$/)) && req.method === 'PUT') return bookmarks.apiWebsiteUpdate(req, res, parseInt(m[1]));
  if (p === '/api/scrape' && req.method === 'GET') return bookmarks.apiScrape(req, res);
  if (p === '/api/og-thumb' && req.method === 'GET') return bookmarks.apiOgThumb(req, res);
  if (p === '/api/bookmarks/cache' && req.method === 'GET') return bookmarks.apiGetBookmarksCache(req, res);
  if (p === '/api/bookmarks/cache' && req.method === 'POST') return bookmarks.apiSaveBookmarksCache(req, res);
  if (p === '/api/browser-favs' && req.method === 'GET') return bookmarks.apiBrowserFavs(req, res);
  if (p === '/api/browser-favs/file' && req.method === 'POST') return bookmarks.apiBrowserFavsFile(req, res);

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
  if (p === '/api/vault/folders' && req.method === 'POST') return vault.apiVaultCreateFolder(req, res);
  if ((m = p.match(/^\/api\/vault\/folders\/([^/]+)$/)) && req.method === 'DELETE') return vault.apiVaultDeleteFolder(req, res, m[1]);

  // ── Database ─────────────────────────────────────────────────────────
  if ((m = p.match(/^\/api\/db\/(actors|categories|studios|websites)$/)) && req.method === 'GET') return database.apiDbGet(req, res, m[1]);
  if ((m = p.match(/^\/api\/db\/(actors|categories|studios|websites)$/)) && req.method === 'POST') return database.apiDbUpsert(req, res, m[1]);
  if ((m = p.match(/^\/api\/db\/(actors|categories|studios|websites)\/(.+)$/)) && req.method === 'DELETE') return database.apiDbDelete(req, res, m[1], decodeURIComponent(m[2]));
  if (p === '/api/db/import' && req.method === 'POST') return database.apiDbImport(req, res);

  // ── Books ────────────────────────────────────────────────────────────
  if (p === '/api/books' && req.method === 'GET') return books.apiBooksList(req, res);
  if (p === '/api/books/upload' && req.method === 'POST') return books.apiBooksUpload(req, res);
  if (p === '/api/books/import-url' && req.method === 'POST') return books.apiBooksImportUrl(req, res);
  if ((m = p.match(/^\/api\/books\/read\/([^/]+)$/)) && req.method === 'GET') return books.apiBooksRead(req, res, m[1]);
  if ((m = p.match(/^\/api\/books\/([^/]+)$/)) && req.method === 'DELETE') return books.apiBooksDelete(req, res, m[1]);

  // ── Audio ────────────────────────────────────────────────────────────
  if (p === '/api/audio' && req.method === 'GET') return audio.apiAudioList(req, res);
  if (p === '/api/audio/upload' && req.method === 'POST') return audio.apiAudioUpload(req, res);
  if ((m = p.match(/^\/api\/audio\/([^/]+)\/stream$/)) && req.method === 'GET') return audio.apiAudioStream(req, res, m[1]);
  if ((m = p.match(/^\/api\/audio\/([^/]+)$/)) && req.method === 'DELETE') return audio.apiAudioDelete(req, res, m[1]);

  // ── Photos ───────────────────────────────────────────────────────────
  if (p === '/api/photos' && req.method === 'GET') return photos.apiPhotosList(req, res);
  if ((m = p.match(/^\/api\/photos\/([^/]+)\/img$/)) && req.method === 'GET') return photos.apiPhotoServe(req, res, m[1]);
  if ((m = p.match(/^\/api\/photos\/([^/]+)$/)) && req.method === 'DELETE') return photos.apiPhotoDelete(req, res, m[1]);

  // ── Prompts ──────────────────────────────────────────────────────────
  if (p === '/api/prompts' && req.method === 'GET')    return prompts.apiGetPrompts(req, res);
  if (p === '/api/prompts' && req.method === 'POST')   return prompts.apiAddPrompt(req, res);
  if ((m = p.match(/^\/api\/prompts\/([^/]+)$/)) && req.method === 'PATCH')  return prompts.apiUpdatePrompt(req, res, m[1]);
  if ((m = p.match(/^\/api\/prompts\/([^/]+)$/)) && req.method === 'DELETE') return prompts.apiDeletePrompt(req, res, m[1]);
  if (p === '/api/comfyui/status'    && req.method === 'GET')  return prompts.apiComfyStatus(req, res);
  if (p === '/api/comfyui/workflows' && req.method === 'GET')  return prompts.apiComfyWorkflows(req, res);
  if (p === '/api/comfyui/send'      && req.method === 'POST') return prompts.apiComfySend(req, res);

  // ── Remote control ───────────────────────────────────────────────────
  if (p === '/api/remote/events' && req.method === 'GET') return remote.apiRemoteEvents(req, res);
  if (p === '/api/remote/command' && req.method === 'POST') return remote.apiRemoteCommand(req, res);

  // ── Settings / Prefs ─────────────────────────────────────────────────
  if (p === '/api/settings/lists' && req.method === 'GET') return settings.apiSettingsLists(req, res);
  if ((m = p.match(/^\/api\/settings\/(hidden|whitelist)$/)) && req.method === 'PUT') return settings.apiSettingsSave(req, res, m[1]);
  if (p === '/api/settings/prefs' && req.method === 'GET') return settings.apiGetPrefs(req, res);
  if (p === '/api/settings/prefs' && req.method === 'PUT') return settings.apiSavePrefs(req, res);

  // ── AI Comments ──────────────────────────────────────────────────────
  if (p === '/api/comments/generate' && req.method === 'POST') return comments.apiGenerateComments(req, res);

  // ── Local IP ─────────────────────────────────────────────────────────
  if (p === '/api/local-ip' && req.method === 'GET') {
    const ips  = getLocalIPs();
    const best = ips[0] || null;
    return json(res, {
      ip: best ? best.ip : null,
      port: PORT,
      url: best ? `http://${best.ip}:${PORT}` : null,
      all: ips.map(e => ({ ip: e.ip, name: e.name, url: `http://${e.ip}:${PORT}` })),
    });
  }

  // ── Static / SPA ─────────────────────────────────────────────────────
  const filePath  = p === '/' ? 'index.html' : p.replace(/^\//, '');
  if (p === '/instagram') return serveStatic(req, res, 'instagram.html');
  const spaRoutes = /^\/(bookmarks|duplicates|vault|recent|collections|scraper|settings|database|actors|studios|books|audio|search|favourites|video\/|tag\/|cat\/|actor\/|studio\/|collection\/)/;
  if (spaRoutes.test(p)) return serveStatic(req, res, 'index.html');
  serveStatic(req, res, filePath);
});

// ── Listen ───────────────────────────────────────────────────────────

server.listen(PORT, () => {
  if (loadPrefs().chronologyMode === 'delete-on-startup') saveHistory([]);
  initVideoMeta();
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
