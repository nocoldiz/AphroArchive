'use strict';

// ─────────────────────────────────────────────────────────────────────
//  background.js
//
//  Three responsibilities:
//   1. Aggregate per-tab media detected by content.js (videos + photos).
//   2. Sniff network traffic for HLS/DASH/media streams that never appear
//      in the DOM (webRequest, observe-only).
//   3. Keep the legacy link-scraper (manual / auto) working.
// ─────────────────────────────────────────────────────────────────────

const LINKS_KEY = 'scrapedLinks';
const MODE_KEY = 'mode'; // 'manual' | 'auto'
const SETTINGS_KEY = 'settings';

const DEFAULT_SETTINGS = {
  includeSubdomains: true,
  defaultFilter: '',                       // regex applied when listing/copying/exporting links
  serverUrl: 'http://localhost:3000',      // AphroArchive base URL
  minPhotoSize: 150                         // px; smaller images are treated as icons/decorations
};

const STREAM_RE = /\.(m3u8|mpd)(?:$|\?)/i;
const MEDIA_RE = /\.(mp4|webm|m4v|mov|mkv|flv|avi)(?:$|\?)/i;
// HLS/DASH chunks — never a complete, directly-downloadable file.
const SEGMENT_RE = /(\.(m4s|ts)(?:$|\?)|[/_-]seg(?:ment)?[-_/0-9])/i;

// tabId -> { page, videos: Map<url,obj>, photos: Map<url,obj> }
const detected = new Map();

function tabStore(tabId) {
  let s = detected.get(tabId);
  if (!s) { s = { page: '', title: '', kind: 'html', contentType: '', videos: new Map(), photos: new Map() }; detected.set(tabId, s); }
  return s;
}

function clearTab(tabId) {
  detected.delete(tabId);
  updateBadge(tabId);
}

function updateBadge(tabId) {
  const s = detected.get(tabId);
  const n = s ? s.videos.size : 0;
  try {
    browser.action.setBadgeText({ tabId, text: n ? String(n) : '' });
    browser.action.setBadgeBackgroundColor({ tabId, color: '#2563eb' });
  } catch {}
}

// ── media aggregation from content.js ────────────────────────────────
function mergeContentMedia(tabId, msg) {
  const s = tabStore(tabId);
  s.page = msg.page || s.page;
  if (msg.title) s.title = msg.title;
  if (msg.kind) s.kind = msg.kind;
  if (msg.contentType) s.contentType = msg.contentType;
  for (const v of msg.videos || []) {
    if (!s.videos.has(v.url)) s.videos.set(v.url, v);
  }
  for (const p of msg.photos || []) {
    const prev = s.photos.get(p.url);
    if (!prev) s.photos.set(p.url, p);
    else { if (p.w > prev.w) prev.w = p.w; if (p.h > prev.h) prev.h = p.h; }
  }
  updateBadge(tabId);
}

function addSniffedVideo(tabId, url, isStream) {
  const s = tabStore(tabId);
  if (s.videos.has(url)) return;
  s.videos.set(url, { url, kind: 'video', title: '', page: s.page, stream: !!isStream, sniffed: true });
  updateBadge(tabId);
}

// ── network sniffing for streams / progressive media ─────────────────
// 1) Match by URL extension (catches obvious .mp4/.m3u8/... early).
browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const url = details.url;
    if (!/^https?:/i.test(url)) return;
    const isStream = STREAM_RE.test(url);
    if (!isStream && !MEDIA_RE.test(url)) return;
    if (!isStream && SEGMENT_RE.test(url)) return;
    addSniffedVideo(details.tabId, url, isStream);
  },
  { urls: ['<all_urls>'] }
);

// 2) Match by response Content-Type — universal: catches video/audio served
//    from extension-less URLs (e.g. X.com / Twitter progressive MP4s) so they
//    can be downloaded directly by the browser even with no server running.
browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const url = details.url;
    if (!/^https?:/i.test(url)) return;
    if (SEGMENT_RE.test(url)) return; // skip HLS/DASH fragments
    const h = (details.responseHeaders || []).find(x => x.name.toLowerCase() === 'content-type');
    const ct = (h && h.value || '').toLowerCase();
    if (ct.startsWith('video/') || ct.startsWith('audio/')) {
      if (ct === 'video/mp2t') return; // transport-stream segment
      const isStream = ct.includes('mpegurl') || ct.includes('dash+xml');
      addSniffedVideo(details.tabId, url, isStream);
    }
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

// ── tab lifecycle ────────────────────────────────────────────────────
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'loading') clearTab(tabId);
});
browser.tabs.onRemoved.addListener(clearTab);

// ─────────────────────────────────────────────────────────────────────
//  Legacy link scraper
// ─────────────────────────────────────────────────────────────────────

// Executed in the page context via scripting.executeScript. Must be
// self-contained (no closures over background.js variables).
function scrapePageLinks(includeSubdomains) {
  function registrableDomain(hostname) {
    const parts = hostname.split('.');
    if (parts.length <= 2) return hostname;
    return parts.slice(-2).join('.');
  }

  const origin = location.origin;
  const baseDomain = registrableDomain(location.hostname);
  const anchors = Array.from(document.querySelectorAll('a[href]'));
  const seen = new Set();
  const links = [];

  for (const a of anchors) {
    let href;
    try { href = new URL(a.getAttribute('href'), location.href).href; } catch { continue; }
    let u;
    try { u = new URL(href); } catch { continue; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;

    const isInternal = includeSubdomains
      ? registrableDomain(u.hostname) === baseDomain
      : u.origin === origin;

    if (!isInternal) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    links.push({ url: href, text: (a.textContent || '').trim().slice(0, 140) });
  }

  return { page: location.href, title: document.title, links };
}

async function getLinks() {
  const { [LINKS_KEY]: links = {} } = await browser.storage.local.get(LINKS_KEY);
  return links;
}

async function addLinks(newLinks, pageInfo) {
  const links = await getLinks();
  let added = 0;
  for (const l of newLinks) {
    if (!links[l.url]) {
      links[l.url] = { url: l.url, text: l.text, sourcePage: pageInfo.page, ts: Date.now() };
      added++;
    }
  }
  await browser.storage.local.set({ [LINKS_KEY]: links });
  return added;
}

async function getSettings() {
  const { [SETTINGS_KEY]: settings = {} } = await browser.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...settings };
}

async function scrapeTab(tabId) {
  const settings = await getSettings();
  const [{ result }] = await browser.scripting.executeScript({
    target: { tabId },
    func: scrapePageLinks,
    args: [settings.includeSubdomains]
  });
  if (result) await addLinks(result.links, result);
  return result;
}

async function activeTabId() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}

// ── messaging ────────────────────────────────────────────────────────
browser.runtime.onMessage.addListener(async (msg, sender) => {
  switch (msg.type) {
    case 'CONTENT_MEDIA': {
      const tabId = sender.tab ? sender.tab.id : await activeTabId();
      if (tabId != null) mergeContentMedia(tabId, msg);
      return true;
    }
    case 'GET_DETECTED': {
      const tabId = await activeTabId();
      const s = tabId != null ? detected.get(tabId) : null;
      return {
        page: s ? s.page : '',
        title: s ? s.title : '',
        kind: s ? s.kind : 'html',
        contentType: s ? s.contentType : '',
        videos: s ? [...s.videos.values()] : [],
        photos: s ? [...s.photos.values()] : []
      };
    }
    case 'RESCAN_ACTIVE': {
      const tabId = await activeTabId();
      if (tabId != null) {
        try { await browser.tabs.sendMessage(tabId, { type: 'RESCAN' }); } catch {}
      }
      return true;
    }
    case 'SCRAPE_TAB': {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url || !tab.url.startsWith('http')) throw new Error('This page cannot be scraped.');
      return scrapeTab(tab.id);
    }
    case 'GET_LINKS':
      return getLinks();
    case 'CLEAR_LINKS':
      await browser.storage.local.set({ [LINKS_KEY]: {} });
      return true;
    case 'REMOVE_LINK': {
      const links = await getLinks();
      delete links[msg.url];
      await browser.storage.local.set({ [LINKS_KEY]: links });
      return true;
    }
    case 'GET_MODE': {
      const { [MODE_KEY]: mode = 'manual' } = await browser.storage.local.get(MODE_KEY);
      return mode;
    }
    case 'SET_MODE':
      await browser.storage.local.set({ [MODE_KEY]: msg.mode });
      return true;
    case 'GET_SETTINGS':
      return getSettings();
    case 'SET_SETTINGS':
      await browser.storage.local.set({ [SETTINGS_KEY]: { ...(await getSettings()), ...msg.settings } });
      return true;
    default:
      return undefined;
  }
});

// Auto mode: re-scrape links whenever a tab finishes navigating.
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || !tab.url.startsWith('http')) return;
  const { [MODE_KEY]: mode = 'manual' } = await browser.storage.local.get(MODE_KEY);
  if (mode !== 'auto') return;
  try { await scrapeTab(tabId); } catch { /* injection not allowed on this page */ }
});
