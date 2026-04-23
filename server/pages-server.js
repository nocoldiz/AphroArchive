'use strict';
// ═══════════════════════════════════════════════════════════════════
//  pages-server.js — local HTML page storage + viewer
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { PAGES_DIR } = require('./config-server');
const { json, readBody, formatBytes } = require('./helpers-server');

function pageToId(filename) { return Buffer.from(filename).toString('base64url'); }
function pageFromId(id)     { return Buffer.from(id, 'base64url').toString('utf-8'); }

const PAGE_EXT = new Set(['.html', '.htm', '.xhtml', '.mhtml']);

// ── Handlers ─────────────────────────────────────────────────────────

function apiPagesList(req, res) {
  fs.mkdirSync(PAGES_DIR, { recursive: true });
  let entries;
  try { entries = fs.readdirSync(PAGES_DIR, { withFileTypes: true }); }
  catch { return json(res, []); }

  const pages = entries
    .filter(e => e.isFile() && PAGE_EXT.has(path.extname(e.name).toLowerCase()))
    .map(e => {
      const fp   = path.join(PAGES_DIR, e.name);
      const stat = fs.statSync(fp);
      return {
        id:    pageToId(e.name),
        name:  path.basename(e.name, path.extname(e.name)),
        file:  e.name,
        size:  stat.size,
        sizeF: formatBytes(stat.size),
        mtime: stat.mtimeMs,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);

  json(res, pages);
}

function apiPageStream(req, res, id) {
  const filename = pageFromId(id);
  // Prevent path traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    res.writeHead(400); res.end(); return;
  }
  const fp = path.join(PAGES_DIR, filename);
  if (!fp.startsWith(PAGES_DIR) || !fs.existsSync(fp)) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  fs.createReadStream(fp).pipe(res);
}

async function apiPageDelete(req, res, id) {
  const filename = pageFromId(id);
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return json(res, { error: 'Invalid id' }, 400);
  }
  const fp = path.join(PAGES_DIR, filename);
  if (!fp.startsWith(PAGES_DIR) || !fs.existsSync(fp)) {
    return json(res, { error: 'Not found' }, 404);
  }
  try { fs.unlinkSync(fp); } catch (e) { return json(res, { error: e.message }, 500); }
  json(res, { ok: true });
}

async function apiPageUpload(req, res) {
  fs.mkdirSync(PAGES_DIR, { recursive: true });
  const rawName = req.headers['x-filename'] || 'page.html';
  const safeName = path.basename(rawName).replace(/[^a-zA-Z0-9._\-\s]/g, '_');
  const ext = path.extname(safeName).toLowerCase() || '.html';
  if (!PAGE_EXT.has(ext)) return json(res, { error: 'Only HTML files allowed' }, 400);

  const dest = path.join(PAGES_DIR, safeName);
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    try {
      fs.writeFileSync(dest, Buffer.concat(chunks));
      const stat = fs.statSync(dest);
      json(res, {
        ok: true,
        id: pageToId(safeName),
        name: path.basename(safeName, ext),
        file: safeName,
        sizeF: formatBytes(stat.size),
        mtime: stat.mtimeMs,
      });
    } catch (e) { json(res, { error: e.message }, 500); }
  });
}

module.exports = { apiPagesList, apiPageStream, apiPageDelete, apiPageUpload };
