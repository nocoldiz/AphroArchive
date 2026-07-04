'use strict';
// ═══════════════════════════════════════════════════════════════════
//  pages-server.js — local HTML page storage + viewer
//
//  Pages now derive from the unified media_index (media_type='page'),
//  auto-sorted by extension during the main scan. Files are identified
//  by toId(absPath) and may live anywhere under MEDIA_DIR.
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { MEDIA_DIR, PAGE_EXT } = require('./config-server');
const { json, formatBytes, toId, fromId, isAllowedMediaPath } = require('./helpers-server');
const { loadMediaIndex } = require('./db-server');

function _invalidate() { try { require('./videos-server').invalidateScanCache(); } catch {} }

// ── Handlers ─────────────────────────────────────────────────────────

function apiPagesList(req, res) {
  const pages = loadMediaIndex('page').map(m => ({
    id:     m.id,
    name:   m.title || m.name,
    file:   m.filename,
    size:   m.size,
    sizeF:  m.sizeF,
    mtime:  m.mtime,
    folder: m.catPath || '',
  })).sort((a, b) => b.mtime - a.mtime);
  json(res, pages);
}

function apiPageStream(req, res, id) {
  const fp = fromId(id);
  if (!fp || !isAllowedMediaPath(fp) || !fs.existsSync(fp)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  fs.createReadStream(fp).pipe(res);
}

async function apiPageDelete(req, res, id) {
  const fp = fromId(id);
  if (!fp || !isAllowedMediaPath(fp)) return json(res, { error: 'Invalid id' }, 403);
  if (!fs.existsSync(fp)) return json(res, { error: 'Not found' }, 404);
  try { fs.unlinkSync(fp); } catch (e) { return json(res, { error: e.message }, 500); }
  _invalidate();
  json(res, { ok: true });
}

async function apiPageUpload(req, res) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const rawName = req.headers['x-filename'] || 'page.html';
  const safeName = path.basename(rawName).replace(/[^a-zA-Z0-9._\-\s]/g, '_');
  const ext = path.extname(safeName).toLowerCase() || '.html';
  if (!PAGE_EXT.has(ext)) return json(res, { error: 'Only HTML files allowed' }, 400);

  let outName = safeName, counter = 1;
  while (fs.existsSync(path.join(MEDIA_DIR, outName))) {
    outName = path.basename(safeName, ext) + ` (${counter++})` + ext;
  }
  const dest = path.join(MEDIA_DIR, outName);
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    try {
      fs.writeFileSync(dest, Buffer.concat(chunks));
      const stat = fs.statSync(dest);
      _invalidate();
      json(res, {
        ok: true,
        id: toId(dest),
        name: path.basename(outName, ext),
        file: outName,
        sizeF: formatBytes(stat.size),
        mtime: stat.mtimeMs,
      });
    } catch (e) { json(res, { error: e.message }, 500); }
  });
}

module.exports = { apiPagesList, apiPageStream, apiPageDelete, apiPageUpload };
