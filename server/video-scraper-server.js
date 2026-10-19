'use strict';
// ═══════════════════════════════════════════════════════════════════
//  video-scraper-server.js — Online video metadata scraper fallback
//  Searches supported video tube/archive platforms (Eporner, XVideos,
//  Pornhub, SpankBang, Archive.org, and optional yt-dlp) by clean title
//  when StashDB API key is not configured or for unmatched videos.
//  Extracts scene title, studio/channel, performers/actors, tags,
//  duration, thumbnails, and canonical source URL.
// ═══════════════════════════════════════════════════════════════════

const https = require('https');
const http = require('http');
const { execFile } = require('child_process');
const { YT_DLP_BIN } = require('./config-server');

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ── Title Cleaning ───────────────────────────────────────────────────

function cleanSearchQuery(rawName) {
  if (!rawName) return '';
  let name = String(rawName);

  // Strip file extension if present
  name = name.replace(/\.[a-z0-9]{2,5}$/i, '');

  // Strip common tags inside brackets / parentheses
  name = name.replace(/\[[^\]]*\]/g, ' ');
  name = name.replace(/\([^)]*(?:1080p|720p|4k|2160p|hevc|x265|x264|dvdrip|web-?dl|bluray)[^)]*\)/gi, ' ');

  // Replace separators with spaces first so word boundaries work properly
  name = name.replace(/[._\-+~]/g, ' ');

  // Strip quality and codec keywords
  name = name.replace(/\b(2160p|4k|1080p|1080i|720p|480p|360p|uhd|fhd|hd|sd)\b/gi, ' ');
  name = name.replace(/\b(hevc|x265|x264|h264|h\.264|avc|aac|mp3|dts|flac)\b/gi, ' ');
  name = name.replace(/\b(dvdrip|webrip|web-dl|webdl|bluray|bdrip|hdrip|brrip|remux)\b/gi, ' ');
  name = name.replace(/\b(xxx|porn|full-?movie|scene|clip)\b/gi, ' ');
  name = name.replace(/\b(rarbg|tgx|yts|eztv|ettv|sparks|fgt|vxt)\b/gi, ' ');

  // Normalize spaces
  name = name.replace(/\s+/g, ' ').trim();
  return name;
}

// ── HTTP Fetch with Timeout & Redirects ──────────────────────────────

function httpGet(rawUrl, customHeaders = {}, hops = 0) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(rawUrl); } catch (e) { return reject(e); }
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.get(rawUrl, {
      headers: { ...DEFAULT_HEADERS, ...customHeaders },
      timeout: 10000,
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (hops >= 4) return reject(new Error('Too many redirects'));
        let next;
        try { next = new URL(res.headers.location, rawUrl).href; } catch (e) { return reject(e); }
        return httpGet(next, customHeaders, hops + 1).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

function parseDurationSec(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const parts = s.split(':').map(p => parseInt(p, 10));
  if (parts.some(isNaN)) {
    const minM = s.match(/(\d+)\s*(?:min|m)/i);
    const secM = s.match(/(\d+)\s*(?:sec|s)/i);
    if (minM || secM) {
      return (minM ? parseInt(minM[1], 10) * 60 : 0) + (secM ? parseInt(secM[1], 10) : 0);
    }
    return null;
  }
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function decodeHtml(html) {
  if (!html) return '';
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// ── Search Providers ─────────────────────────────────────────────────

// 1. Eporner JSON API (official REST API, rich pornstars + tags)
async function searchEporner(query) {
  try {
    const url = `https://www.eporner.com/api/v2/video/search/?query=${encodeURIComponent(query)}&per_page=10`;
    const res = await httpGet(url);
    if (res.status !== 200) return [];
    const data = JSON.parse(res.body);
    const list = Array.isArray(data.videos) ? data.videos : [];
    return list.map(v => {
      const performers = Array.isArray(v.pornstars)
        ? v.pornstars.filter(Boolean)
        : (typeof v.pornstars === 'string' ? v.pornstars.split(',').map(s => s.trim()).filter(Boolean) : []);
      const tags = typeof v.keywords === 'string'
        ? v.keywords.split(',').map(s => s.trim()).filter(Boolean)
        : [];
      const image = v.default_thumb ? (v.default_thumb.src || '') : '';
      return {
        id: `eporner:${v.id || v.url}`,
        title: decodeHtml(v.title || ''),
        code: String(v.id || ''),
        date: v.added ? v.added.slice(0, 10) : '',
        duration: v.length_sec || null,
        studio: (v.sources && v.sources[0]) || 'Eporner',
        parentStudio: '',
        performers,
        tags,
        url: v.url || '',
        image,
        matchedBy: 'web-scraper',
        distance: 0,
        durationDiff: null,
      };
    });
  } catch {
    return [];
  }
}

// 2. XVideos search scraper
async function searchXVideos(query) {
  try {
    const url = `https://www.xvideos.com/?k=${encodeURIComponent(query)}`;
    const res = await httpGet(url);
    if (res.status !== 200) return [];
    const results = [];
    const blockRegex = /<div class="thumb-block[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi;
    let match;
    while ((match = blockRegex.exec(res.body)) !== null) {
      const block = match[0];
      const titleM = block.match(/title="([^"]+)"/i) || block.match(/<p class="title">\s*<a[^>]*>([^<]+)<\/a>/i);
      const title = titleM ? decodeHtml(titleM[1].trim()) : '';
      const hrefM = block.match(/href="([^"]+)"/i);
      let href = hrefM ? hrefM[1] : '';
      if (!href || href.includes('javascript:') || !title) continue;
      if (!href.startsWith('http')) href = 'https://www.xvideos.com' + (href.startsWith('/') ? '' : '/') + href;

      const thumbM = block.match(/data-src="([^"]+)"/i) || block.match(/src="([^"]+)"/i);
      let thumb = thumbM ? (thumbM[1] || thumbM[2] || '') : '';
      if (thumb && !thumb.startsWith('http')) thumb = 'https:' + thumb;

      const durM = block.match(/<span class="duration">([^<]+)<\/span>/i);
      const duration = durM ? parseDurationSec(durM[1]) : null;

      // Extract uploader / performer
      const uploaderM = block.match(/<span class="name">([^<]+)<\/span>/i) || block.match(/<a class="name"[^>]*>([^<]+)<\/a>/i);
      const uploader = uploaderM ? decodeHtml(uploaderM[1].trim()) : '';

      results.push({
        id: `xvideos:${href}`,
        title,
        code: '',
        date: '',
        duration,
        studio: uploader || 'XVideos',
        parentStudio: '',
        performers: uploader ? [uploader] : [],
        tags: [],
        url: href,
        image: thumb,
        matchedBy: 'web-scraper',
        distance: 0,
        durationDiff: null,
      });
      if (results.length >= 8) break;
    }
    return results;
  } catch {
    return [];
  }
}

// 3. SpankBang search scraper
async function searchSpankBang(query) {
  try {
    const url = `https://spankbang.com/s/${encodeURIComponent(query)}/`;
    const res = await httpGet(url);
    if (res.status !== 200) return [];
    const results = [];
    const itemRegex = /<div class="video-item[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi;
    let match;
    while ((match = itemRegex.exec(res.body)) !== null) {
      const block = match[0];
      const titleM = block.match(/<a class="thumb"[^>]*title="([^"]+)"/i) || block.match(/title="([^"]+)"/i);
      const title = titleM ? decodeHtml(titleM[1].trim()) : '';
      const hrefM = block.match(/href="(\/[^"]+)"/i);
      let href = hrefM ? hrefM[1] : '';
      if (!href || !title) continue;
      if (!href.startsWith('http')) href = 'https://spankbang.com' + href;

      const imgM = block.match(/data-src="([^"]+)"/i) || block.match(/src="([^"]+)"/i);
      let thumb = imgM ? imgM[1] : '';
      if (thumb && !thumb.startsWith('http')) thumb = 'https:' + thumb;

      const durM = block.match(/<span class="l">([^<]+)<\/span>/i);
      const duration = durM ? parseDurationSec(durM[1]) : null;

      const uploaderM = block.match(/<a class="author"[^>]*>([^<]+)<\/a>/i);
      const uploader = uploaderM ? decodeHtml(uploaderM[1].trim()) : '';

      results.push({
        id: `spankbang:${href}`,
        title,
        code: '',
        date: '',
        duration,
        studio: uploader || 'SpankBang',
        parentStudio: '',
        performers: uploader ? [uploader] : [],
        tags: [],
        url: href,
        image: thumb,
        matchedBy: 'web-scraper',
        distance: 0,
        durationDiff: null,
      });
      if (results.length >= 8) break;
    }
    return results;
  } catch {
    return [];
  }
}

// 4. Archive.org search
async function searchArchiveOrg(query) {
  try {
    const apiUrl =
      'https://archive.org/advancedsearch.php?q=' +
      encodeURIComponent(query) +
      '+AND+mediatype:(movies)&fl[]=identifier&fl[]=title&fl[]=description&fl[]=creator&rows=6&output=json';
    const res = await httpGet(apiUrl);
    if (res.status !== 200) return [];
    const data = JSON.parse(res.body);
    const docs = (data.response && data.response.docs) || [];
    return docs.filter(doc => doc.identifier).map(doc => ({
      id: `archive:${doc.identifier}`,
      title: decodeHtml(doc.title || doc.identifier),
      code: doc.identifier,
      date: '',
      duration: null,
      studio: doc.creator || 'Archive.org',
      parentStudio: '',
      performers: doc.creator ? [doc.creator] : [],
      tags: [],
      url: `https://archive.org/details/${encodeURIComponent(doc.identifier)}`,
      image: `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`,
      matchedBy: 'web-scraper',
      distance: 0,
      durationDiff: null,
    }));
  } catch {
    return [];
  }
}

// 5. yt-dlp search fallback (if binary exists)
async function searchYtDlp(query) {
  if (!YT_DLP_BIN) return [];
  return new Promise(resolve => {
    // Search top 3 results via generic yt-dlp search
    execFile(YT_DLP_BIN, [
      `ytsearch3:${query}`,
      '--dump-single-json',
      '--flat-playlist',
      '--skip-download',
      '--no-warnings',
    ], { timeout: 15000 }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      try {
        const data = JSON.parse(stdout);
        const entries = Array.isArray(data.entries) ? data.entries : (data.title ? [data] : []);
        const results = entries.map(e => ({
          id: `ytdlp:${e.id || e.url}`,
          title: decodeHtml(e.title || ''),
          code: e.id || '',
          date: e.upload_date ? `${e.upload_date.slice(0, 4)}-${e.upload_date.slice(4, 6)}-${e.upload_date.slice(6, 8)}` : '',
          duration: e.duration || null,
          studio: e.uploader || e.channel || 'Online',
          parentStudio: '',
          performers: e.uploader ? [e.uploader] : [],
          tags: Array.isArray(e.tags) ? e.tags : (Array.isArray(e.categories) ? e.categories : []),
          url: e.webpage_url || e.url || '',
          image: e.thumbnail || (Array.isArray(e.thumbnails) && e.thumbnails[0] ? e.thumbnails[0].url : ''),
          matchedBy: 'web-scraper',
          distance: 0,
          durationDiff: null,
        }));
        resolve(results);
      } catch {
        resolve([]);
      }
    });
  });
}

// ── Scoring & Ranking ────────────────────────────────────────────────

function textSimilarityScore(str1, str2) {
  if (!str1 || !str2) return 0;
  const words1 = new Set(str1.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(str2.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length > 2));
  if (!words1.size || !words2.size) return 0;
  let matches = 0;
  for (const w of words1) {
    if (words2.has(w)) matches++;
  }
  return (2 * matches) / (words1.size + words2.size);
}

// Main entry point: searches online platforms for the video title
async function searchOnlineVideoMetadata(rawTitle, targetDuration = null) {
  const clean = cleanSearchQuery(rawTitle);
  if (!clean || clean.length < 2) return [];

  // Run all supported scrapers concurrently
  const scraperPromises = [
    searchEporner(clean),
    searchXVideos(clean),
    searchSpankBang(clean),
    searchArchiveOrg(clean),
  ];

  const settled = await Promise.allSettled(scraperPromises);
  let allCandidates = [];
  for (const res of settled) {
    if (res.status === 'fulfilled' && Array.isArray(res.value)) {
      allCandidates.push(...res.value);
    }
  }

  // If few results and yt-dlp is available, try yt-dlp
  if (allCandidates.length < 2 && YT_DLP_BIN) {
    try {
      const ytdlpResults = await searchYtDlp(clean);
      allCandidates.push(...ytdlpResults);
    } catch {}
  }

  // Deduplicate by URL and Title
  const seenUrls = new Set();
  const deduped = [];
  for (const c of allCandidates) {
    const key = (c.url || c.title).toLowerCase();
    if (!key || seenUrls.has(key)) continue;
    seenUrls.add(key);

    const durDiff = (targetDuration && c.duration) ? Math.abs(c.duration - targetDuration) : null;
    const simScore = textSimilarityScore(clean, c.title);
    c.durationDiff = durDiff;
    c._simScore = simScore;
    deduped.push(c);
  }

  // Sort best match first
  deduped.sort((a, b) => {
    // Higher title similarity score first
    if (Math.abs(b._simScore - a._simScore) > 0.15) {
      return b._simScore - a._simScore;
    }
    // Closer duration difference
    if (a.durationDiff !== null && b.durationDiff !== null) {
      return a.durationDiff - b.durationDiff;
    }
    return b._simScore - a._simScore;
  });

  return deduped.slice(0, 8);
}

module.exports = {
  cleanSearchQuery,
  searchOnlineVideoMetadata,
};
