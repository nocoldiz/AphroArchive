'use strict';
// ═══════════════════════════════════════════════════════════════════
//  rss-server.js — Remote RSS/Atom feeds → bookmark links
//
//  Feeds are configured per-profile in prefs.rssFeeds:
//    [{ url, name, category }]
//  refreshFeeds() fetches each feed, parses items, and upserts them
//  into the links table so they show up in the Links / RSS section.
//  It runs:
//    • as the first step of the background worker, and
//    • on demand when the RSS section is opened (POST /api/rss/refresh).
// ═══════════════════════════════════════════════════════════════════

const http  = require('http');
const https = require('https');
const { json, readBody } = require('./helpers-server');
const { loadPrefs, savePrefs, upsertLink, getLink } = require('./db-server');

let _refreshing = false;
let _lastRefresh = { at: 0, feeds: 0, imported: 0 };

function loadRssFeeds() {
  const prefs = loadPrefs();
  return Array.isArray(prefs.rssFeeds) ? prefs.rssFeeds : [];
}

function saveRssFeeds(feeds) {
  const prefs = loadPrefs();
  prefs.rssFeeds = (Array.isArray(feeds) ? feeds : [])
    .filter(f => f && f.url)
    .map(f => ({
      url: String(f.url).trim(),
      name: String(f.name || '').trim(),
      category: String(f.category || '').trim(),
    }))
    .slice(0, 200);
  savePrefs(prefs);
  return prefs.rssFeeds;
}

// Fetch a URL as text, following a few redirects. Resolves '' on failure.
function fetchText(url, redirects = 0) {
  return new Promise(resolve => {
    if (redirects > 4) return resolve('');
    let lib;
    try { lib = url.startsWith('https') ? https : http; } catch { return resolve(''); }
    let req;
    try {
      req = lib.get(url, {
        headers: {
          'User-Agent': 'AphroArchive/1.0 (+rss)',
          'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        },
        timeout: 15000,
      }, res => {
        const loc = res.headers.location;
        if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
          res.resume();
          let next;
          try { next = new URL(loc, url).toString(); } catch { return resolve(''); }
          return resolve(fetchText(next, redirects + 1));
        }
        if (res.statusCode !== 200) { res.resume(); return resolve(''); }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', c => { data += c; if (data.length > 5_000_000) { req.destroy(); resolve(data); } });
        res.on('end', () => resolve(data));
      });
    } catch { return resolve(''); }
    req.on('timeout', () => { req.destroy(); resolve(''); });
    req.on('error', () => resolve(''));
  });
}

function _decode(s) {
  if (!s) return '';
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .trim();
}

function _firstMatch(block, re) {
  const m = block.match(re);
  return m ? m[1] : '';
}

// Parse RSS <item> or Atom <entry> blocks into { title, link }.
function parseFeed(xml) {
  if (!xml) return [];
  const items = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  for (const block of blocks) {
    const title = _decode(_firstMatch(block, /<title[^>]*>([\s\S]*?)<\/title>/i));
    // RSS: <link>url</link>; Atom: <link href="url" .../>
    let link = _decode(_firstMatch(block, /<link[^>]*>([\s\S]*?)<\/link>/i));
    if (!link) {
      const href = _firstMatch(block, /<link[^>]*\bhref=["']([^"']+)["']/i);
      if (href) link = href.trim();
    }
    if (!link) {
      const guid = _firstMatch(block, /<guid[^>]*>([\s\S]*?)<\/guid>/i);
      if (/^https?:\/\//i.test(guid)) link = _decode(guid);
    }
    if (link && /^https?:\/\//i.test(link)) items.push({ title: title || link, link });
  }
  return items;
}

// Fetch + convert all configured feeds into links. Returns counts.
async function refreshFeeds() {
  if (_refreshing) return _lastRefresh;
  _refreshing = true;
  let imported = 0;
  const feeds = loadRssFeeds();
  try {
    for (const feed of feeds) {
      const xml = await fetchText(feed.url);
      const items = parseFeed(xml);
      for (const it of items) {
        // Don't clobber a link the user may have edited / downloaded.
        if (getLink(it.link)) continue;
        upsertLink({
          url: it.link,
          title: it.title,
          category: feed.category || 'RSS',
          hasVideo: true,
          tags: ['rss', feed.name || 'feed'].filter(Boolean),
          addedAt: Date.now(),
        });
        imported++;
      }
    }
  } catch (e) {
    console.error('[rss] refresh error:', e.message);
  } finally {
    _lastRefresh = { at: Date.now(), feeds: feeds.length, imported };
    _refreshing = false;
  }
  if (imported) console.log(`[rss] imported ${imported} items from ${feeds.length} feed(s)`);
  return _lastRefresh;
}

// ── API handlers ────────────────────────────────────────────────────
function apiGetRssFeeds(req, res) {
  json(res, { feeds: loadRssFeeds(), lastRefresh: _lastRefresh, refreshing: _refreshing });
}

async function apiSaveRssFeeds(req, res) {
  const body = await readBody(req);
  const feeds = saveRssFeeds(body.feeds);
  json(res, { ok: true, feeds });
}

async function apiRefreshRss(req, res) {
  const result = await refreshFeeds();
  json(res, { ok: true, ...result });
}

module.exports = { loadRssFeeds, saveRssFeeds, parseFeed, refreshFeeds, apiGetRssFeeds, apiSaveRssFeeds, apiRefreshRss };
