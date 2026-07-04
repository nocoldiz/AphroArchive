'use strict';
// ═══════════════════════════════════════════════════════════════════
//  photos.js — Photo listing, serving, and deletion
//
//  All photos now derive from the unified media_index (media_type='photo'),
//  auto-sorted by extension during the main scan. Files are identified by
//  toId(absPath) and may live anywhere under MEDIA_DIR (or a sourceFolder).
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { MEDIA_DIR, MIME } = require('./config-server');
const { json, toId, fromId, isAllowedMediaPath } = require('./helpers-server');
const { loadMediaIndex } = require('./db-server');

function _invalidate() { try { require('./videos-server').invalidateScanCache(); } catch {} }

// Stable-Diffusion / ComfyUI write the generation prompt into a PNG `parameters`
// text chunk. Read it lazily (only for .png rows) when listing.
function readPngMetadata(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(8);
    fs.readSync(fd, header, 0, 8, 0);
    if (!header.equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) {
      fs.closeSync(fd);
      return null; // Not a PNG
    }
    const buf = Buffer.alloc(8192); // Read 8KB
    const bytesRead = fs.readSync(fd, buf, 0, 8192, 8);
    fs.closeSync(fd);

    let offset = 0;
    while (offset < bytesRead - 8) {
      const len = buf.readUInt32BE(offset);
      const type = buf.toString('ascii', offset + 4, offset + 8);
      if (type === 'tEXt' || type === 'iTXt') {
        const data = buf.slice(offset + 8, Math.min(bytesRead, offset + 8 + len));
        const nullIdx = data.indexOf(0);
        if (nullIdx !== -1) {
          const keyword = data.toString('ascii', 0, nullIdx);
          if (keyword === 'parameters') return data.toString('utf-8', nullIdx + 1);
        }
      }
      offset += 12 + len; // 4 (len) + 4 (type) + len + 4 (crc)
    }
  } catch (e) { /* ignore */ }
  return null;
}

function _listPhotos() {
  return loadMediaIndex('photo').map(m => {
    let isAi = false, aiPrompt = '';
    if (m.ext === '.png') {
      const meta = readPngMetadata(m.absPath);
      if (meta) { isAi = true; aiPrompt = meta; }
    }
    return {
      id:       m.id,
      filename: m.filename,
      folder:   m.catPath || '',
      rel:      m.absPath,
      ext:      m.ext,
      size:     m.size,
      sizeF:    m.sizeF,
      date:     m.mtime,
      isAi,
      aiPrompt,
    };
  });
}

function apiPhotoFolders(req, res) {
  const folderSet = new Map();
  for (const m of loadMediaIndex('photo')) {
    if (!m.catPath) continue;
    let cur = '';
    for (const part of m.catPath.split('/')) {
      cur = cur ? cur + '/' + part : part;
      if (!folderSet.has(cur)) folderSet.set(cur, cur.replace(/\//g, ' / '));
    }
  }
  const folders = [...folderSet.entries()]
    .map(([p, name]) => ({ path: p, name }))
    .sort((a, b) => a.path.localeCompare(b.path));
  json(res, folders);
}

function apiPhotosList(req, res) {
  json(res, _listPhotos().sort((a, b) => b.date - a.date));
}

// Resolve a photo id to an on-disk path, guarded to allowed media roots.
function getPhotoPath(id) {
  const fp = fromId(id);
  if (!fp || !isAllowedMediaPath(fp) || !fs.existsSync(fp)) return null;
  return fp;
}

function apiPhotoServe(req, res, id) {
  const fp = getPhotoPath(id);
  if (!fp) { res.writeHead(404); res.end(); return; }
  const ext  = path.extname(fp).toLowerCase();
  const ct   = MIME[ext] || (ext === '.avif' ? 'image/avif' : ext === '.heic' ? 'image/heic' : 'image/jpeg');
  const stat = fs.statSync(fp);
  res.writeHead(200, { 'Content-Type': ct, 'Content-Length': stat.size, 'Cache-Control': 'public, max-age=3600' });
  fs.createReadStream(fp).pipe(res);
}

function apiPhotoDelete(req, res, id) {
  const fp = fromId(id);
  if (!fp || !isAllowedMediaPath(fp)) { res.writeHead(403); res.end(); return; }
  try { fs.unlinkSync(fp); } catch { json(res, { error: 'Delete failed' }, 500); return; }
  _invalidate();
  json(res, { ok: true });
}

function apiPhotoDownload(req, res, id) {
  const fp = getPhotoPath(id);
  if (!fp) { res.writeHead(404); res.end(); return; }
  const ext      = path.extname(fp).toLowerCase();
  const ct       = MIME[ext] || 'application/octet-stream';
  const stat     = fs.statSync(fp);
  const filename = path.basename(fp).replace(/"/g, '');
  res.writeHead(200, {
    'Content-Type':        ct,
    'Content-Length':      stat.size,
    'Content-Disposition': 'attachment; filename="' + filename + '"',
  });
  fs.createReadStream(fp).pipe(res);
}

function apiPhotosUpload(req, res) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const rawName = req.headers['x-filename'] || 'photo.jpg';
  const safeName = path.basename(rawName).replace(/[^a-zA-Z0-9._\-\s]/g, '_');
  const ext = path.extname(safeName).toLowerCase();

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
      _invalidate();
      json(res, { ok: true, file: outName, id: toId(dest) });
    } catch (e) { json(res, { error: e.message }, 500); }
  });
}

module.exports = { apiPhotosList, apiPhotoFolders, apiPhotoServe, apiPhotoDelete, apiPhotoDownload, apiPhotosUpload, getPhotoPath };
