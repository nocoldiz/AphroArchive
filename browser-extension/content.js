'use strict';

// ─────────────────────────────────────────────────────────────────────
//  content.js — in-page media detection (videos + photos)
//
//  Runs in every frame. Scans the DOM on load and on mutation, then pushes
//  the discovered media up to the background script, which aggregates the
//  results per tab. HLS/DASH streams that never appear in the DOM are caught
//  separately by the background's webRequest sniffer.
// ─────────────────────────────────────────────────────────────────────

const VIDEO_EXT = ['mp4', 'webm', 'mkv', 'mov', 'm4v', 'ts', 'm3u8', 'mpd', 'flv', 'avi', 'f4v', 'ogv', '3gp', 'wmv'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'jfif'];

// Path/filename hints for images that are decorative, not real content.
const ICON_HINTS = [
  'icon', 'sprite', 'logo', 'avatar', 'spinner', 'favicon', 'emoji',
  'placeholder', 'blank', '1x1', 'pixel', 'transparent', 'badge', 'loader',
  'button', 'arrow', 'flag-', 'star.', 'rating', 'profile_images'
];

// Normalise some hosts to their full-resolution image URL.
function normalizeImageUrl(url) {
  try {
    const u = new URL(url);
    // X.com / Twitter: pbs.twimg.com/media/<id>?format=jpg&name=<size> → name=orig
    if (u.hostname === 'pbs.twimg.com' && u.pathname.startsWith('/media/') && u.searchParams.get('format')) {
      u.searchParams.set('name', 'orig');
      return u.href;
    }
  } catch {}
  return url;
}

function absUrl(raw) {
  try {
    return new URL(raw, location.href).href;
  } catch {
    return null;
  }
}

function extOf(url) {
  try {
    const p = new URL(url).pathname.toLowerCase();
    const m = p.match(/\.([a-z0-9]{2,5})(?:$|\?)/);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

function isHttp(url) {
  return url && (url.startsWith('http://') || url.startsWith('https://'));
}

function guessTitle() {
  const og = document.querySelector('meta[property="og:title"]');
  if (og && og.content) return og.content.trim();
  return (document.title || location.hostname).trim();
}

// ── videos ───────────────────────────────────────────────────────────
function collectVideos() {
  const out = new Map(); // url -> { url, kind, title, page }
  const title = guessTitle();

  function add(url, kind) {
    url = absUrl(url);
    if (!isHttp(url)) return; // skip blob:/data: — not directly downloadable
    if (!out.has(url)) out.set(url, { url, kind: kind || 'video', title, page: location.href });
  }

  for (const v of document.querySelectorAll('video')) {
    if (v.currentSrc) add(v.currentSrc, 'video');
    if (v.src) add(v.src, 'video');
    for (const s of v.querySelectorAll('source')) if (s.src) add(s.src, 'video');
  }
  for (const a of document.querySelectorAll('audio')) {
    if (a.src) add(a.src, 'audio');
    for (const s of a.querySelectorAll('source')) if (s.src) add(s.src, 'audio');
  }
  for (const sel of [
    'meta[property="og:video"]', 'meta[property="og:video:url"]',
    'meta[property="og:video:secure_url"]', 'meta[name="twitter:player:stream"]'
  ]) {
    for (const m of document.querySelectorAll(sel)) if (m.content) add(m.content, 'video');
  }
  for (const a of document.querySelectorAll('a[href]')) {
    const url = absUrl(a.getAttribute('href'));
    if (url && VIDEO_EXT.includes(extOf(url))) add(url, 'video');
  }

  return [...out.values()].map(v => ({ ...v, stream: ['m3u8', 'mpd'].includes(extOf(v.url)) }));
}

// ── photos ───────────────────────────────────────────────────────────
function looksDecorative(url) {
  const lower = url.toLowerCase();
  if (lower.endsWith('.svg') || extOf(url) === 'svg') return true;
  return ICON_HINTS.some(h => lower.includes(h));
}

function largestFromSrcset(srcset) {
  // "a.jpg 1x, b.jpg 2x" or "a.jpg 480w, b.jpg 1024w" → pick highest descriptor.
  let best = null, bestScore = -1;
  for (const part of srcset.split(',')) {
    const [u, d] = part.trim().split(/\s+/);
    if (!u) continue;
    const score = d ? parseFloat(d) || 1 : 1;
    if (score > bestScore) { bestScore = score; best = u; }
  }
  return best;
}

function collectPhotos() {
  const out = new Map(); // url -> { url, w, h }

  function add(url, w, h) {
    url = absUrl(url);
    if (!isHttp(url)) return;
    if (looksDecorative(url)) return;
    url = normalizeImageUrl(url);
    const prev = out.get(url);
    if (!prev) out.set(url, { url, w: w || 0, h: h || 0 });
    else { if (w > prev.w) prev.w = w; if (h > prev.h) prev.h = h; }
  }

  for (const img of document.querySelectorAll('img')) {
    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;
    if (img.currentSrc) add(img.currentSrc, w, h);
    else if (img.src) add(img.src, w, h);
    if (img.srcset) { const big = largestFromSrcset(img.srcset); if (big) add(big, w, h); }
    for (const attr of ['data-src', 'data-original', 'data-lazy-src', 'data-lazy', 'data-url']) {
      const v = img.getAttribute(attr);
      if (v) add(v, w, h);
    }
    const dss = img.getAttribute('data-srcset');
    if (dss) { const big = largestFromSrcset(dss); if (big) add(big, w, h); }
  }

  // Inline-style background images (full computed-style scan is too costly).
  for (const el of document.querySelectorAll('[style*="background"]')) {
    const m = /url\((['"]?)(.*?)\1\)/i.exec(el.style.backgroundImage || '');
    if (m && m[2]) add(m[2], el.clientWidth || 0, el.clientHeight || 0);
  }

  // Direct links to image files.
  for (const a of document.querySelectorAll('a[href]')) {
    const url = absUrl(a.getAttribute('href'));
    if (url && IMAGE_EXT.includes(extOf(url))) add(url, 0, 0);
  }

  return [...out.values()];
}

// What kind of resource is this tab? Used to offer "save to books / send this
// video|photo to library" buttons for direct files opened in the browser.
function pageKind() {
  const ct = (document.contentType || '').toLowerCase();
  if (ct.startsWith('video/')) return 'video';
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('audio/')) return 'audio';
  if (ct && ct !== 'text/html' && ct !== 'application/xhtml+xml' &&
      (ct.startsWith('text/') || ct === 'application/json' || ct === 'application/xml')) return 'text';
  return 'html';
}

// ── reporting ────────────────────────────────────────────────────────
let lastPayload = '';

function report() {
  const videos = collectVideos();
  const photos = collectPhotos();
  const payload = {
    type: 'CONTENT_MEDIA',
    page: location.href,
    title: guessTitle(),
    contentType: (document.contentType || '').toLowerCase(),
    kind: pageKind(),
    videos,
    photos
  };
  const sig = JSON.stringify([videos.map(v => v.url), photos.map(p => p.url), payload.kind]);
  if (sig === lastPayload) return; // nothing changed
  lastPayload = sig;
  try {
    browser.runtime.sendMessage(payload);
  } catch {
    // background may be asleep; it will request a rescan when the popup opens
  }
}

// Allow the popup/background to force a fresh scan, or grab the rendered HTML.
browser.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.type === 'RESCAN') {
    lastPayload = '';
    report();
    return Promise.resolve(true);
  }
  if (msg.type === 'GET_PAGE_HTML') {
    const doctype = document.doctype ? '<!DOCTYPE html>\n' : '';
    return Promise.resolve({
      html: doctype + document.documentElement.outerHTML,
      title: guessTitle(),
      url: location.href
    });
  }
  if (msg.type === 'GET_PAGE_TEXT') {
    return Promise.resolve({
      text: (document.body && document.body.innerText) || '',
      title: guessTitle(),
      url: location.href
    });
  }
});

let scanTimer = null;
function scheduleScan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(report, 400);
}

scheduleScan();
window.addEventListener('load', scheduleScan);

const observer = new MutationObserver(scheduleScan);
observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'href', 'style'] });
