'use strict';

// ─────────────────────────────────────────────────────────────────────
//  aphro.js — thin client for the AphroArchive HTTP API.
//
//  Loaded as a plain script in popup.html before popup.js; exposes a global
//  `Aphro`. The server is CORS-open (Access-Control-Allow-Origin: *), so the
//  extension can call it directly from the popup.
// ─────────────────────────────────────────────────────────────────────

const Aphro = (() => {
  let base = 'http://localhost:3000';

  const setBase = (url) => { base = (url || '').replace(/\/+$/, '') || 'http://localhost:3000'; };
  const getBase = () => base;

  async function checkServer() {
    const res = await fetch(base + '/api/download/check', { signal: AbortSignal.timeout(3500) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json(); // { available, version, bin }
  }

  // Downloads are left uncategorized — the server saves them in videos/downloads.
  async function addDownloads(urls) {
    const res = await fetch(base + '/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls, category: '', pendingCategory: '' })
    });
    if (!res.ok) throw new Error(await res.text().catch(() => 'HTTP ' + res.status));
    return res.json(); // { ok, ids }
  }

  async function getJobs() {
    const res = await fetch(base + '/api/download/jobs', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function importLinks(urls) {
    const res = await fetch(base + '/api/links/import-urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls })
    });
    if (!res.ok) throw new Error(await res.text().catch(() => 'HTTP ' + res.status));
    return res.json();
  }

  async function uploadPhoto(blob, filename) {
    const res = await fetch(base + '/api/photos/upload', {
      method: 'POST',
      headers: { 'X-Filename': filename, 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob
    });
    if (!res.ok) throw new Error(await res.text().catch(() => 'HTTP ' + res.status));
    return res.json(); // { ok, file }
  }

  async function savePage(filename, html) {
    const res = await fetch(base + '/api/pages/upload', {
      method: 'POST',
      headers: { 'X-Filename': filename, 'Content-Type': 'text/html' },
      body: html
    });
    if (!res.ok) throw new Error(await res.text().catch(() => 'HTTP ' + res.status));
    return res.json();
  }

  async function saveBook(filename, blob) {
    const res = await fetch(base + '/api/books/upload', {
      method: 'POST',
      headers: { 'X-Filename': filename, 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob
    });
    if (!res.ok) throw new Error(await res.text().catch(() => 'HTTP ' + res.status));
    return res.json();
  }

  async function addWebsite(name, url) {
    const res = await fetch(base + '/api/db/websites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data: { url, description: 'Added from browser extension' } })
    });
    if (!res.ok) throw new Error(await res.text().catch(() => 'HTTP ' + res.status));
    return res.json();
  }

  return { setBase, getBase, checkServer, addDownloads, getJobs, importLinks, uploadPhoto, savePage, saveBook, addWebsite };
})();
