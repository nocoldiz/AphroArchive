// ─── Scrape Methods ──────────────────────────────────────────────────
// Each method receives a query string and returns an array of:
//   { title, url, thumb, source }
'use strict';
const https = require('https');
const http = require('http');

function httpGet(rawUrl, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(rawUrl);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.get(rawUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AphroArchive/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        ...opts.headers,
      },
      timeout: 10000,
    }, res => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location, opts).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

const methods = {
  'archive-org': async (query) => {
    const apiUrl =
      'https://archive.org/advancedsearch.php?q=' +
      encodeURIComponent(query) +
      '+AND+mediatype:(movies)' +
      '&fl[]=identifier&fl[]=title&fl[]=description&fl[]=downloads' +
      '&rows=24&output=json&sort[]=downloads+desc';
    const raw = await httpGet(apiUrl);
    const data = JSON.parse(raw);
    const docs = (data.response && data.response.docs) || [];
    return docs
      .filter(doc => doc.identifier)
      .map(doc => ({
        title: doc.title || doc.identifier,
        url: 'https://archive.org/details/' + encodeURIComponent(doc.identifier),
        thumb: 'https://archive.org/services/img/' + encodeURIComponent(doc.identifier),
        source: 'Archive.org',
      }));
  },

  // New method for XVideos
  'xvideos': async (query) => {
    // Build search URL (k = keyword)
    const searchUrl = `https://www.xvideos.com/?k=${encodeURIComponent(query)}`;

    const rawHtml = await httpGet(searchUrl);

    // Simple regex-based parsing (XVideos loads results in <div class="thumb-block">)
    // This is fragile and may break if XVideos changes their HTML structure.
    const results = [];

    // Match each video block
    const blockRegex = /<div class="thumb-block[^>]*>[\s\S]*?<\/div>/gi;
    let match;

    while ((match = blockRegex.exec(rawHtml)) !== null) {
      const block = match[0];

      // Extract title
      const titleMatch = block.match(/title="([^"]+)"/i);
      const title = titleMatch ? titleMatch[1].trim() : 'Untitled';

      // Extract video URL (relative -> absolute)
      const urlMatch = block.match(/href="([^"]+)"/i);
      let url = urlMatch ? urlMatch[1] : '';
      if (url && !url.startsWith('http')) {
        url = 'https://www.xvideos.com' + (url.startsWith('/') ? '' : '/') + url;
      }

      // Extract thumbnail
      const thumbMatch = block.match(/data-src="([^"]+)"|src="([^"]+)"/i);
      let thumb = '';
      if (thumbMatch) {
        thumb = thumbMatch[1] || thumbMatch[2] || '';
        if (thumb && !thumb.startsWith('http')) {
          thumb = 'https:' + thumb;
        }
      }

      if (url && title) {
        results.push({
          title: title.replace(/&amp;/g, '&').replace(/&#039;/g, "'"), // basic HTML decode
          url: url,
          thumb: thumb || '',
          source: 'XVideos',
        });
      }
    }

    // Limit to ~24 results like archive-org
    return results.slice(0, 24);
  },
};

module.exports = methods;