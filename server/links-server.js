'use strict';
// ═══════════════════════════════════════════════════════════════════
//  links.js — Websites, browser-favs import, OG thumbnails,
//                 links cache, and scrape proxy
// ═══════════════════════════════════════════════════════════════════

const fs    = require('fs');
const path  = require('path');
const http  = require('http');
const https = require('https');
const os    = require('os');
const url   = require('url');
const { LINK_DIR, LINK_THUMBS_DIR, EDGE_BIN, YT_DLP_BIN } = require('./config-server');
const { json, readBody, serveStatic }   = require('./helpers-server');
const { loadWebsites, saveWebsites, loadLinksCache, saveLinksCache, upsertLink, deleteLink, loadOgThumbCache, saveOgThumbCache, loadCategories, loadEnabledCategories, loadAllVideoTags } = require('./db-server');
const { wordMatchAny, wordMatch } = require('./helpers-server');
const { execFile } = require('child_process');
const scrapeMethods        = require('./scrapeMethods-server');

// ── OG thumbnail cache ───────────────────────────────────────────────

const _ogCache = loadOgThumbCache();
const OG_TTL   = 1000 * 60 * 60 * 24 * 7; // 7 days

function fetchOgImage(targetUrl) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(targetUrl);
      const lib    = parsed.protocol === 'https:' ? https : http;
      const opts   = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AphroArchive/1.0)', 'Accept': 'text/html' },
        timeout: 8000,
      };
      const req = lib.request(opts, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchOgImage(res.headers.location).then(resolve).catch(() => resolve(null));
        }
        let data = '';
        res.on('data', chunk => { data += chunk; if (data.length > 200000) req.destroy(); });
        res.on('end', () => {
          const m = data.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
                 || data.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
          resolve(m ? m[1] : null);
        });
        res.on('error', () => resolve(null));
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end();
    } catch { resolve(null); }
  });
}

async function apiOgThumb(req, res) {
  const qs        = new URL('http://x' + req.url).searchParams;
  const targetUrl = qs.get('url');
  if (!targetUrl) return json(res, { error: 'No URL' }, 400);

  // Check if we have a generated thumb first
  const thumbId = Buffer.from(targetUrl).toString('base64url');
  const fpPng = path.join(LINK_THUMBS_DIR, thumbId + '.png');
  const fpJpg = path.join(LINK_THUMBS_DIR, thumbId + '.jpg');
  if (fs.existsSync(fpPng) || fs.existsSync(fpJpg)) {
    return json(res, { img: '/api/links/thumbs/' + thumbId });
  }

  const now    = Date.now();
  const cached = _ogCache.get(targetUrl);
  if (cached && now - cached.ts < OG_TTL) return json(res, { img: cached.img });
  const img = await fetchOgImage(targetUrl);
  _ogCache.set(targetUrl, { img, ts: now });
  saveOgThumbCache(_ogCache);
  json(res, { img });
}

// ── Link Thumbnail Generation (Edge headless) ────────────────────

let _bmJob = null; // { running, stop, total, done, failed, current }
const _bmClients = new Set();

function broadcastBm(ev) {
  const line = 'data: ' + JSON.stringify(ev) + '\n\n';
  for (const res of _bmClients) {
    try { res.write(line); } catch { _bmClients.delete(res); }
  }
}

async function takeScreenshot(url, outPath) {
  if (!fs.existsSync(EDGE_BIN)) throw new Error('Edge browser not found at ' + EDGE_BIN);
  return new Promise((resolve, reject) => {
    // Edge headless screenshot command
    const args = [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--window-size=1280,720',
      '--screenshot=' + outPath,
      url
    ];
    execFile(EDGE_BIN, args, { timeout: 30000 }, (err) => {
      if (err) return reject(err);
      if (fs.existsSync(outPath)) {
        // Optionally resize/convert to jpg if Edge saves as png
        resolve();
      } else {
        reject(new Error('Screenshot failed - file not created'));
      }
    });
  });
}

function getYtDlpThumbnail(targetUrl) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(YT_DLP_BIN)) return reject(new Error('yt-dlp not found'));
    execFile(YT_DLP_BIN, ['--get-thumbnail', targetUrl], (err, stdout) => {
      if (err) return reject(err);
      const url = stdout.trim();
      if (url && url.startsWith('http')) resolve(url);
      else reject(new Error('No thumbnail URL returned'));
    });
  });
}

async function downloadImage(imageUrl, outPath) {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Failed to download image: ${res.statusText}`);
  const buffer = await res.arrayBuffer();
  fs.writeFileSync(outPath, Buffer.from(buffer));
}

async function takeScreenshotWithBannerRemoval(targetUrl, outPath) {
  const res = await fetch(targetUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  if (!res.ok) throw new Error(`Failed to fetch page: ${res.statusText}`);
  let html = await res.text();

  // Inject <base> tag so relative assets resolve
  const baseTag = `<base href="${targetUrl}">`;
  if (/<head>/i.test(html)) {
    html = html.replace(/<head>/i, `<head>${baseTag}`);
  } else {
    html = baseTag + html;
  }

  // CSS: nuke every common consent/overlay pattern
  const styleTag = `
    <style>
      .cookie-banner, .cookie-consent, .cc-banner, .cc-window, .consent-banner,
      #cookie-banner, #cookie-consent, #consent-popup,
      [class*="cookie-banner"], [id*="cookie-banner"],
      [class*="consent-banner"], [id*="consent-banner"],
      [class*="cookie-popup"], [id*="cookie-popup"],
      [class*="cookie-notice"], [id*="cookie-notice"],
      [class*="gdpr"], [id*="gdpr"],
      #onetrust-banner-sdk, #qc-cmp2-container, #consent-manager, .cmp-container,
      .fc-consent-root, .sp-message-container, #usercentrics-root,
      [class*="consent-wall"], [class*="paywall"], [id*="paywall"] {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
      /* Restore scrolling that banners often lock */
      html, body { overflow: auto !important; }
    </style>
  `;

  // JS: try clicking "Accept / Close / Agree" buttons before paint
  const scriptTag = `
    <script>
      (function() {
        var ACCEPT = ['accept all', 'accept cookies', 'accept', 'agree', 'i agree',
                      'allow all', 'allow cookies', 'allow', 'ok', 'got it',
                      'close', 'dismiss', 'continue', 'proceed'];
        function tryDismiss() {
          var els = document.querySelectorAll(
            'button, a[role="button"], [role="button"], input[type="button"], input[type="submit"]'
          );
          for (var i = 0; i < els.length; i++) {
            var t = (els[i].textContent || els[i].value || '').toLowerCase().trim();
            if (ACCEPT.some(function(k){ return t === k || t.startsWith(k); })) {
              try { els[i].click(); } catch(e) {}
            }
          }
          /* Also remove elements with consent-related aria labels */
          var overlays = document.querySelectorAll(
            '[id*="cookie"],[id*="consent"],[id*="gdpr"],[id*="banner"],' +
            '[class*="cookie"],[class*="consent"],[class*="gdpr"]'
          );
          for (var j = 0; j < overlays.length; j++) {
            overlays[j].style.cssText = 'display:none!important';
          }
        }
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', tryDismiss);
        } else {
          tryDismiss();
        }
      })();
    </script>
  `;

  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `${styleTag}${scriptTag}</head>`);
  } else {
    html += styleTag + scriptTag;
  }

  const tmpFile = path.join(os.tmpdir(), `aphro_thumb_${Date.now()}.html`);
  fs.writeFileSync(tmpFile, html);

  try {
    await takeScreenshot(`file://${tmpFile}`, outPath);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

async function generateSmartThumbnail(targetUrl, outPath) {
  // 1. Try yt-dlp
  try {
    const thumbUrl = await getYtDlpThumbnail(targetUrl);
    if (thumbUrl) {
      await downloadImage(thumbUrl, outPath);
      console.log('[smart-thumb] Used yt-dlp for:', targetUrl);
      return;
    }
  } catch (e) {
    console.log('[smart-thumb] yt-dlp failed or not found for:', targetUrl, e.message);
  }

  // 2. Fallback to Edge with cookie banner removal
  try {
    await takeScreenshotWithBannerRemoval(targetUrl, outPath);
    console.log('[smart-thumb] Used Edge with banner removal for:', targetUrl);
  } catch (e) {
    console.error('[smart-thumb] Banner removal failed, trying direct screenshot:', e.message);
    // If even that fails, try the original takeScreenshot as last resort
    await takeScreenshot(targetUrl, outPath);
  }
}

function apiLinkThumbImg(req, res, id) {
  const fpPng = path.join(LINK_THUMBS_DIR, id + '.png');
  const fpJpg = path.join(LINK_THUMBS_DIR, id + '.jpg');
  const fp = fs.existsSync(fpPng) ? fpPng : (fs.existsSync(fpJpg) ? fpJpg : null);

  if (!fp) {
    res.writeHead(404);
    return res.end('Not found');
  }

  const ext = path.extname(fp).toLowerCase();
  const ct  = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[ext] || 'image/png';
  res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400' });
  fs.createReadStream(fp).pipe(res);
}

async function apiGenerateLinkThumb(req, res) {
  const body = await readBody(req);
  const url = body.url;
  if (!url) return json(res, { error: 'url required' }, 400);

  const id = Buffer.from(url).toString('base64url');
  const outPath = path.join(LINK_THUMBS_DIR, id + '.png'); // Edge uses png

  try {
    await generateSmartThumbnail(url, outPath);
    json(res, { ok: true, img: '/api/links/thumbs/' + id });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

async function apiGenerateAllLinkThumbs(req, res) {
  if (_bmJob && _bmJob.running) return json(res, { error: 'Already running' });

  const links = loadLinksCache().items || [];
  if (!links.length) return json(res, { error: 'No links to process' });

  _bmJob = { running: true, stop: false, total: links.length, done: 0, failed: 0, current: '' };
  broadcastBm({ type: 'start', total: links.length });

  (async () => {
    for (const item of links) {
      if (_bmJob.stop) break;
      _bmJob.current = item.title || item.url;
      broadcastBm({ type: 'progress', done: _bmJob.done, total: _bmJob.total, current: _bmJob.current });

      const id = Buffer.from(item.url).toString('base64url');
      const outPath = path.join(LINK_THUMBS_DIR, id + '.png');

      if (!fs.existsSync(outPath)) {
        try {
          await generateSmartThumbnail(item.url, outPath);
        } catch (e) {
          console.error('BM Thumb Gen Failed:', item.url, e.message);
          _bmJob.failed++;
        }
      }
      _bmJob.done++;
    }
    _bmJob.running = false;
    broadcastBm({ type: 'done', done: _bmJob.done, failed: _bmJob.failed, total: _bmJob.total });
  })();

  json(res, { ok: true });
}

function apiLinkGenerationStatus(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('\n');
  _bmClients.add(res);

  if (_bmJob) {
    res.write('data: ' + JSON.stringify(_bmJob) + '\n\n');
  } else {
    res.write('data: ' + JSON.stringify({ running: false }) + '\n\n');
  }

  req.on('close', () => _bmClients.delete(res));
}

// ── Links cache ───────────────────────────────────────────────────

// ── Links Scraper Worker ──────────────────────────────────────────

let _scrapeJob = null; // { running, stop, total, done, failed, current }

// Known video embed host patterns — used to filter iframes
const EMBED_HOSTS = [
  'youtube.com', 'youtu.be', 'vimeo.com', 'dailymotion.com',
  'streamtape.com', 'doodstream.com', 'streamlare.com', 'mixdrop.co',
  'vidoza.net', 'upstream.to', 'fembed.com', 'uqload.com',
  'myvi.ru', 'ok.ru', 'rutube.ru',
  'xvideos.com', 'xhamster.com', 'pornhub.com', 'redtube.com',
  'tube8.com', 'youporn.com', 'spankbang.com', 'xnxx.com',
];

function extractEmbedUrl(pageUrl) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(pageUrl);
      const lib = parsed.protocol === 'https:' ? https : http;
      const opts = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html' },
        timeout: 10000,
      };
      const req = lib.request(opts, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return extractEmbedUrl(res.headers.location).then(resolve);
        }
        let data = '';
        res.on('data', chunk => { data += chunk; if (data.length > 300000) req.destroy(); });
        res.on('end', () => {
          const iframeRe = /<iframe[^>]+src=["']([^"']+)["']/gi;
          let match;
          while ((match = iframeRe.exec(data)) !== null) {
            const src = match[1];
            try {
              const srcHost = new URL(src.startsWith('//') ? 'https:' + src : src).hostname;
              if (EMBED_HOSTS.some(h => srcHost === h || srcHost.endsWith('.' + h))) {
                return resolve(src.startsWith('//') ? 'https:' + src : src);
              }
            } catch {}
          }
          resolve(null);
        });
        res.on('error', () => resolve(null));
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end();
    } catch { resolve(null); }
  });
}

function scrapeLink(pageUrl) {
  return new Promise((resolve) => {
    const ytdlpAvailable = fs.existsSync(YT_DLP_BIN);
    if (!ytdlpAvailable) {
      // No yt-dlp: fall back to embed extraction only
      extractEmbedUrl(pageUrl).then(embedUrl => resolve({ thumbUrl: null, videoUrl: null, embedUrl }));
      return;
    }
    execFile(YT_DLP_BIN, ['-j', pageUrl], { timeout: 30000 }, async (err, stdout) => {
      if (err) {
        // yt-dlp failed — try embed extraction as fallback
        const embedUrl = await extractEmbedUrl(pageUrl);
        return resolve({ thumbUrl: null, videoUrl: null, embedUrl });
      }
      try {
        const data = JSON.parse(stdout);
        const embedUrl = await extractEmbedUrl(pageUrl);
        resolve({ thumbUrl: data.thumbnail, videoUrl: data.url, embedUrl });
      } catch {
        const embedUrl = await extractEmbedUrl(pageUrl);
        resolve({ thumbUrl: null, videoUrl: null, embedUrl });
      }
    });
  });
}

function autoCategorizeLinks(items) {
  const cats = loadCategories();
  const allTags = loadAllVideoTags();
  const enabledPaths = loadEnabledCategories();
  const enabledSet = new Set(enabledPaths.map(p => p.toLowerCase()));

  for (const item of items) {
    const title = item.title || '';
    const searchText = title + ' ' + (item.url || '');

    // Fill in tags for items that have none yet
    if (!item.tags || item.tags.length === 0) {
      item.tags = allTags.filter(tag => tag.length >= 2 && wordMatch(searchText, tag));
    }

    if (item.category) continue; // don't overwrite manual assignments
    for (const cat of cats) {
      const isEnabled = enabledSet.size === 0 || enabledSet.has(cat.name.toLowerCase());
      if (!isEnabled) continue;
      if (wordMatchAny(title, cat.terms)) {
        item.category = cat.displayName;
        break;
      }
    }
  }
}

function startScrapingWorker({ reset = false } = {}) {
  if (_scrapeJob && _scrapeJob.running) return;

  const cache = loadLinksCache();
  const allItems = cache.items || [];

  if (reset) {
    for (const item of allItems) {
      item.scrapedVideoUrl = null;
      item.hasVideo = false;
      item.embedUrl = null;
      item.hasEmbed = false;
      upsertLink(item);
    }
    console.log('[scrape] reset — cleared scraped data from', allItems.length, 'links');
  }

  const toProcess = allItems.filter(b => !b.scrapedVideoUrl);
  if (!toProcess.length) {
    console.log('[scrape] nothing to process');
    return;
  }

  _scrapeJob = { running: true, stop: false, total: toProcess.length, done: 0, failed: 0, current: '' };
  console.log('[scrape] starting —', toProcess.length, 'links to process');

  (async () => {
    for (const item of toProcess) {
      if (_scrapeJob.stop) { console.log('[scrape] stopped by user'); break; }
      _scrapeJob.current = item.title || item.url;
      console.log(`[scrape] (${_scrapeJob.done + 1}/${_scrapeJob.total}) ${item.title || item.url}`);

      try {
        const result = await scrapeLink(item.url);
        if (result.videoUrl) {
          item.scrapedVideoUrl = result.videoUrl;
          item.hasVideo = true;
          console.log(`[scrape]   video: ${result.videoUrl}`);
        }
        if (result.embedUrl) {
          item.embedUrl = result.embedUrl;
          item.hasEmbed = true;
          console.log(`[scrape]   embed: ${result.embedUrl}`);
        }
        if (result.thumbUrl && !item.img) {
          const id = Buffer.from(item.url).toString('base64url');
          const outPath = path.join(LINK_THUMBS_DIR, id + '.png');
          try { await downloadImage(result.thumbUrl, outPath); } catch {}
          item.img = '/api/links/thumbs/' + id;
          console.log(`[scrape]   thumb: ${result.thumbUrl}`);
        }
        if (!result.videoUrl && !result.embedUrl) {
          console.log('[scrape]   no result');
        }

        // Screenshot fallback: if still no preview, take a page screenshot
        if (!item.img) {
          const id = Buffer.from(item.url).toString('base64url');
          const outPath = path.join(LINK_THUMBS_DIR, id + '.png');
          if (!fs.existsSync(outPath)) {
            try {
              console.log('[scrape]   no thumb — taking screenshot fallback');
              await takeScreenshotWithBannerRemoval(item.url, outPath);
              item.img = '/api/links/thumbs/' + id;
              console.log('[scrape]   screenshot saved');
            } catch (e) {
              console.log('[scrape]   screenshot fallback failed:', e.message);
            }
          } else {
            item.img = '/api/links/thumbs/' + id;
          }
        }

        // Persist scraped data for this item immediately — no full-replace
        upsertLink(item);
        _scrapeJob.done++;
      } catch (e) {
        console.error('[scrape]   error:', item.url, e.message);
        _scrapeJob.failed++;
      }
    }
    // Auto-categorise any remaining un-tagged items at the end
    const finalCache = loadLinksCache();
    autoCategorizeLinks(finalCache.items || []);
    saveLinksCache(finalCache);
    console.log(`[scrape] done — ${_scrapeJob.done} ok, ${_scrapeJob.failed} failed`);
    _scrapeJob.running = false;
  })();
}

function apiScrapeStatus(req, res) {
  json(res, _scrapeJob || { running: false });
}

function apiStopScraping(req, res) {
  if (_scrapeJob && _scrapeJob.running) _scrapeJob.stop = true;
  json(res, { ok: true });
}

function apiLinkThumbStatus(req, res) {
  json(res, _bmJob || { running: false });
}

function apiStopLinkThumbs(req, res) {
  if (_bmJob && _bmJob.running) _bmJob.stop = true;
  json(res, { ok: true });
}

function apiGetLinksCache(req, res) {
  const urlObj = new URL(req.url, 'http://localhost');
  const params = urlObj.searchParams;
  const rawLimit = parseInt(params.get('limit'));
  const all = rawLimit === 0;
  const limit = all ? Infinity : (rawLimit || 50);
  const page = parseInt(params.get('page')) || 1;
  const query = params.get('q') || '';

  const cache = loadLinksCache();
  let items = cache.items || [];

  const enabledPaths = loadEnabledCategories();
  if (enabledPaths.length > 0) {
    const enabledSet = new Set(enabledPaths.map(p => p.toLowerCase()));
    items = items.filter(item => {
      if (!item.category) return true;
      const catLo = item.category.toLowerCase();
      return enabledSet.size === 0 || Array.from(enabledSet).some(ep => catLo === ep || catLo.startsWith(ep + '/'));
    });
  }

  if (query) {
    const term = query.toLowerCase();
    items = items.filter(item =>
      (item.title && item.title.toLowerCase().includes(term)) ||
      (item.url && item.url.toLowerCase().includes(term))
    );
  }

  if (all) {
    json(res, { items, total: items.length, page: 1, limit: items.length, hasMore: false });
    return;
  }

  const start = (page - 1) * limit;
  const end = start + limit;
  json(res, {
    items: items.slice(start, end),
    total: items.length,
    page,
    limit,
    hasMore: end < items.length
  });
}

async function apiSaveLinksCache(req, res) {
  const body  = await readBody(req);
  const items = Array.isArray(body.items) ? body.items : [];
  try {
    if (_scrapeJob && _scrapeJob.running) {
      _scrapeJob.stop = true;
    }
    autoCategorizeLinks(items);
    saveLinksCache({ items });
    json(res, { ok: true, count: items.length });
  } catch (e) { json(res, { error: e.message }, 500); }
}

function apiStartScraping(req, res) {
  startScrapingWorker();
  json(res, { ok: true });
}

function apiRescrapeAll(_req, res) {
  if (_scrapeJob && _scrapeJob.running) {
    _scrapeJob.stop = true;
    // give the loop one tick to notice the stop flag before reset
    setImmediate(() => { startScrapingWorker({ reset: true }); });
  } else {
    startScrapingWorker({ reset: true });
  }
  json(res, { ok: true });
}

// ── Websites ──────────────────────────────────────────────────────────

async function apiWebsiteAdd(req, res) {
  const body = await readBody(req);
  if (!body.url) return json(res, { error: 'url required' }, 400);
  const sites = loadWebsites();
  sites.push({
    name: body.name || body.url,
    url: body.url,
    searchURL: body.searchURL || '',
    scrapeMethod: body.scrapeMethod || '',
    tags: body.tags || [],
    description: body.description || '',
  });
  saveWebsites(sites);
  json(res, { ok: true, index: sites.length - 1 });
}

async function apiWebsiteDelete(req, res, index) {
  const sites = loadWebsites();
  if (index < 0 || index >= sites.length) return json(res, { error: 'Not found' }, 404);
  sites.splice(index, 1);
  saveWebsites(sites);
  json(res, { ok: true });
}

async function apiWebsiteUpdate(req, res, index) {
  const body  = await readBody(req);
  const sites = loadWebsites();
  if (index < 0 || index >= sites.length) return json(res, { error: 'Not found' }, 404);
  sites[index] = { ...sites[index], ...body };
  saveWebsites(sites);
  json(res, { ok: true });
}

// ── Scrape proxy ──────────────────────────────────────────────────────

async function apiScrape(req, res) {
  const params = new URLSearchParams(req.url.split('?')[1] || '');
  const method = (params.get('method') || '').trim();
  const q      = (params.get('q') || '').trim();
  if (!method) return json(res, { error: 'method required' }, 400);
  if (!q)      return json(res, { error: 'q required' }, 400);
  if (!scrapeMethods[method]) return json(res, { error: 'Unknown scrape method: ' + method }, 400);
  try {
    const results = await scrapeMethods[method](q);
    json(res, { results });
  } catch (e) { json(res, { error: e.message }, 500); }
}

// ── Browser favourites ────────────────────────────────────────────────

function loadWhitelist() {
  const sites = loadWebsites();
  if (sites.length) return sites.map(s => { try { return new URL(s.url).hostname; } catch { return s.url; } });
  try {
    const { BROWSER_WHITELIST_FILE } = require('./config-server');
    return fs.readFileSync(BROWSER_WHITELIST_FILE, 'utf-8')
      .split('\n').map(l => l.trim()).filter(l => l.length > 0);
  } catch { return []; }
}

function matchesWhitelist(urlStr, whitelist) {
  try {
    const hostname = new URL(urlStr).hostname;
    return whitelist.some(entry => hostname.includes(entry));
  } catch { return false; }
}

// LZ4 block decompressor for Firefox mozlz4 link backups
function decompressLz4Block(src, uncompressedSize) {
  const dst = Buffer.allocUnsafe(uncompressedSize);
  let si = 0, di = 0;
  while (si < src.length) {
    const token = src[si++];
    let litLen = (token >> 4) & 0xF;
    if (litLen === 15) { let x; do { x = src[si++]; litLen += x; } while (x === 255); }
    src.copy(dst, di, si, si + litLen);
    si += litLen; di += litLen;
    if (si >= src.length) break;
    const offset = src.readUInt16LE(si); si += 2;
    let matchLen = (token & 0xF);
    if (matchLen === 15) { let x; do { x = src[si++]; matchLen += x; } while (x === 255); }
    matchLen += 4;
    let mp = di - offset;
    for (let i = 0; i < matchLen; i++) dst[di++] = dst[mp++];
  }
  return dst.slice(0, di);
}

function readMozlz4(filePath) {
  const raw   = fs.readFileSync(filePath);
  const MAGIC = Buffer.from('mozLz40\0');
  if (!raw.slice(0, 8).equals(MAGIC)) throw new Error('Not a mozlz4 file');
  const uncompressedSize = raw.readUInt32LE(8);
  return JSON.parse(decompressLz4Block(raw.slice(12), uncompressedSize).toString('utf-8'));
}

function extractChromeLinks(node, results) {
  if (node.type === 'url' && node.url) results.push({ title: node.name || node.url, url: node.url });
  if (node.children) for (const c of node.children) extractChromeLinks(c, results);
}

function extractFirefoxLinks(node, results) {
  if (node.type === 'text/x-moz-place' && node.uri) results.push({ title: node.title || node.uri, url: node.uri });
  if (node.children) for (const c of node.children) extractFirefoxLinks(c, results);
}

function getChromeLinkPaths() {
  const home       = os.homedir();
  const candidates = [];
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    candidates.push(
      path.join(local, 'Google', 'Chrome', 'User Data', 'Default', 'Links'),
      path.join(local, 'Microsoft', 'Edge', 'User Data', 'Default', 'Links'),
      path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data', 'Default', 'Links'),
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Links'),
      path.join(home, 'Library', 'Application Support', 'Microsoft Edge', 'Default', 'Links'),
    );
  } else {
    candidates.push(
      path.join(home, '.config', 'google-chrome', 'Default', 'Links'),
      path.join(home, '.config', 'chromium', 'Default', 'Links'),
    );
  }
  return candidates.filter(p => fs.existsSync(p));
}

function getFirefoxLinkPaths() {
  const home = os.homedir();
  let profilesRoot;
  if (process.platform === 'win32') {
    profilesRoot = path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Mozilla', 'Firefox', 'Profiles');
  } else if (process.platform === 'darwin') {
    profilesRoot = path.join(home, 'Library', 'Application Support', 'Firefox', 'Profiles');
  } else {
    profilesRoot = path.join(home, '.mozilla', 'firefox');
  }
  if (!fs.existsSync(profilesRoot)) return [];
  const results = [];
  for (const profileDir of fs.readdirSync(profilesRoot)) {
    const backupsDir = path.join(profilesRoot, profileDir, 'linkbackups');
    if (!fs.existsSync(backupsDir)) continue;
    const files = fs.readdirSync(backupsDir)
      .filter(f => f.endsWith('.jsonlz4') || f.endsWith('.json'))
      .map(f => ({ p: path.join(backupsDir, f), m: fs.statSync(path.join(backupsDir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    if (files.length) results.push(files[0].p);
  }
  return results;
}

function apiBrowserFavs(req, res) {
  try {
    const urlObj    = new URL(req.url, 'http://localhost');
    const qs        = urlObj.searchParams;
    const browser   = qs.get('browser') || 'chrome';
    const whitelist = loadWhitelist();
    if (!whitelist.length) return json(res, { whitelist_empty: true, items: [] });

    const all = [];
    if (browser === 'chrome') {
      const paths = getChromeLinkPaths();
      if (!paths.length) return json(res, { error: 'Chrome/Edge links file not found. Make sure Chrome or Edge is installed and has been opened at least once.', items: [] }, 404);
      for (const p of paths) {
        try {
          const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
          for (const root of Object.values(data.roots || {})) {
            if (root && typeof root === 'object') extractChromeLinks(root, all);
          }
        } catch (e) { console.error('Links read error:', p, e.message); }
      }
    } else if (browser === 'firefox') {
      const paths = getFirefoxLinkPaths();
      if (!paths.length) return json(res, { error: 'Firefox link backups not found. Make sure Firefox is installed and has been opened at least once.', items: [] }, 404);
      for (const p of paths) {
        try {
          const data = p.endsWith('.jsonlz4') ? readMozlz4(p) : JSON.parse(fs.readFileSync(p, 'utf-8'));
          extractFirefoxLinks(data, all);
        } catch (e) { console.error('Firefox links read error:', p, e.message); }
      }
    } else {
      return json(res, { error: 'Unknown browser' }, 400);
    }

    json(res, { items: all.filter(b => matchesWhitelist(b.url, whitelist)) });
  } catch (e) {
    console.error('apiBrowserFavs error:', e);
    json(res, { error: e.message, items: [] }, 500);
  }
}

async function apiBrowserFavsFile(req, res) {
  try {
    const body     = await readBody(req);
    const { data, filename, browser } = body;
    if (!data) return json(res, { error: 'No file data' }, 400);
    const whitelist = loadWhitelist();
    if (!whitelist.length) return json(res, { whitelist_empty: true, items: [] });

    const buf         = Buffer.from(data, 'base64');
    const MOZILLA_MAGIC = Buffer.from('mozLz40\0');
    const all         = [];

    if (browser === 'firefox' || buf.slice(0, 8).equals(MOZILLA_MAGIC)) {
      let parsed;
      if (buf.slice(0, 8).equals(MOZILLA_MAGIC)) {
        const uncompressedSize = buf.readUInt32LE(8);
        parsed = JSON.parse(decompressLz4Block(buf.slice(12), uncompressedSize).toString('utf-8'));
      } else {
        parsed = JSON.parse(buf.toString('utf-8'));
      }
      extractFirefoxLinks(parsed, all);
    } else {
      const parsed = JSON.parse(buf.toString('utf-8'));
      for (const root of Object.values(parsed.roots || {})) {
        if (root && typeof root === 'object') extractChromeLinks(root, all);
      }
    }

    json(res, { items: all.filter(b => matchesWhitelist(b.url, whitelist)) });
  } catch (e) {
    console.error('apiBrowserFavsFile error:', e);
    json(res, { error: e.message, items: [] }, 500);
  }
}

// ── URL-paste import ─────────────────────────────────────────────────

function deriveTitleFromUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const segments = u.pathname.split('/').filter(Boolean);
    // Try last path segment first, then second-to-last
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = decodeURIComponent(segments[i]).replace(/\.[^.]+$/, ''); // strip extension
      const cleaned = seg.replace(/[-_+.]/g, ' ').replace(/\s+/g, ' ').trim();
      if (cleaned.length >= 3) return cleaned;
    }
    return u.hostname.replace(/^www\./, '');
  } catch { return rawUrl; }
}

async function apiImportLinks(req, res) {
  const body = await readBody(req);
  const rawUrls = Array.isArray(body.urls)
    ? body.urls.filter(u => typeof u === 'string' && u.startsWith('http'))
    : [];
  if (!rawUrls.length) return json(res, { error: 'No URLs provided' }, 400);

  const cache = loadLinksCache();
  const existingUrls = new Set((cache.items || []).map(i => i.url));
  const existingNames = new Set((cache.items || []).map(i => (i.title || '').trim().toLowerCase()).filter(Boolean));
  const cats = loadCategories();
  const allTags = loadAllVideoTags();

  let added = 0, skipped = 0;
  const newItems = [];

  for (const rawUrl of rawUrls) {
    if (existingUrls.has(rawUrl)) { skipped++; continue; }

    const title = deriveTitleFromUrl(rawUrl);
    const nm = (title || '').trim().toLowerCase();
    if (nm && existingNames.has(nm)) { skipped++; continue; }

    const searchText = title + ' ' + rawUrl;

    // Category: first match from categories DB
    let category = '';
    for (const cat of cats) {
      if (wordMatchAny(title, cat.terms)) { category = cat.displayName; break; }
    }

    // Tags: match known video tags against title + URL path
    const matchedTags = allTags.filter(tag => tag.length >= 2 && wordMatch(searchText, tag));

    newItems.push({ url: rawUrl, title, category, tags: matchedTags, addedAt: Date.now() });
    existingUrls.add(rawUrl);
    if (nm) existingNames.add(nm);
    added++;
  }

  if (newItems.length) {
    autoCategorizeLinks(newItems);
    for (const it of newItems) upsertLink(it);
  }

  json(res, { ok: true, added, skipped });
}

// ── Export / Import JSON ─────────────────────────────────────────────

function apiExportLinksJson(req, res) {
  const cache = loadLinksCache();
  const items = cache.items || [];
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    count: items.length,
    items,
  };
  const filename = `aphroarchive-links-${new Date().toISOString().slice(0, 10)}.json`;
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
  res.end(JSON.stringify(payload, null, 2));
}

async function apiImportLinksJson(req, res) {
  const body = await readBody(req);

  // Accept: full export format, { items: [...] }, or plain array
  let incoming = [];
  if (Array.isArray(body)) {
    incoming = body;
  } else if (Array.isArray(body.items)) {
    incoming = body.items;
  } else {
    return json(res, { error: 'Invalid format: expected { items: [...] } or an array' }, 400);
  }

  const cache    = loadLinksCache();
  const existingUrls = new Set((cache.items || []).map(it => it.url));
  const existingNames = new Set((cache.items || []).map(it => (it.title || '').trim().toLowerCase()).filter(Boolean));

  let added = 0, skipped = 0;
  const VALID_FIELDS = ['url','title','category','img','scrapedVideoUrl','hasVideo','embedUrl','hasEmbed','addedAt','tags','downloaded','localVideoId','fav'];

  for (const item of incoming) {
    if (!item.url || typeof item.url !== 'string') continue;

    // Sanitise: only allow known fields
    const clean = {};
    for (const f of VALID_FIELDS) if (item[f] !== undefined) clean[f] = item[f];
    if (!clean.url) continue;

    const nm = (clean.title || '').trim().toLowerCase();
    if (existingUrls.has(clean.url) || (nm && existingNames.has(nm))) {
      skipped++;
    } else {
      clean.addedAt = clean.addedAt || Date.now();
      clean.tags    = Array.isArray(clean.tags) ? clean.tags : [];
      upsertLink(clean);
      existingUrls.add(clean.url);
      if (nm) existingNames.add(nm);
      added++;
    }
  }

  const total = existingUrls.size;
  json(res, { ok: true, added, skipped, total });
}

module.exports = {
  apiOgThumb,
  apiGetLinksCache, apiSaveLinksCache,
  apiWebsiteAdd, apiWebsiteDelete, apiWebsiteUpdate,
  apiScrape,
  apiBrowserFavs, apiBrowserFavsFile,
  apiLinkThumbImg,
  apiGenerateLinkThumb,
  apiGenerateAllLinkThumbs,
  apiLinkGenerationStatus,
  apiScrapeStatus, apiStopScraping,
  apiLinkThumbStatus, apiStopLinkThumbs,
  apiStartScraping,
  apiRescrapeAll,
  apiImportLinks,
  apiExportLinksJson, apiImportLinksJson,
};
