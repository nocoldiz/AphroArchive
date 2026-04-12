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
        'Accept': 'application/json, text/html',
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
};

module.exports = methods;
