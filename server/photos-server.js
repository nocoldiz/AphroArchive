'use strict';
// ═══════════════════════════════════════════════════════════════════
//  photos.js — Photo listing, serving, and deletion
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { PHOTOS_DIR, MIME } = require('./config-server');
const { json, formatBytes } = require('./helpers-server');

const IMAGE_EXT = new Set(['.jpg','.jpeg','.png','.gif','.webp','.avif','.bmp','.heic','.tiff','.tif']);

function photoToId(rel)  { return Buffer.from(rel).toString('base64url'); }
function photoFromId(id) { return Buffer.from(id, 'base64url').toString('utf-8'); }

function scanPhotos(dir, base) {
  if (!base) base = dir;
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...scanPhotos(fp, base));
    } else if (e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase())) {
      const rel  = path.relative(base, fp);
      const stat = fs.statSync(fp);
      out.push({
        id:       photoToId(rel),
        filename: e.name,
        rel,
        ext:      path.extname(e.name).toLowerCase(),
        size:     stat.size,
        sizeF:    formatBytes(stat.size),
        date:     stat.mtimeMs,
      });
    }
  }
  return out;
}

function apiPhotosList(req, res) {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  const photos = scanPhotos(PHOTOS_DIR).sort((a, b) => b.date - a.date);
  json(res, photos);
}

function apiPhotoServe(req, res, id) {
  const rel = photoFromId(id);
  const fp  = path.resolve(path.join(PHOTOS_DIR, rel));
  if (!fp.startsWith(path.resolve(PHOTOS_DIR) + path.sep) && fp !== path.resolve(PHOTOS_DIR)) {
    res.writeHead(403); res.end(); return;
  }
  if (!fs.existsSync(fp)) { res.writeHead(404); res.end(); return; }
  const ext  = path.extname(fp).toLowerCase();
  const ct   = MIME[ext] || (ext === '.avif' ? 'image/avif' : ext === '.heic' ? 'image/heic' : 'image/jpeg');
  const stat = fs.statSync(fp);
  res.writeHead(200, { 'Content-Type': ct, 'Content-Length': stat.size, 'Cache-Control': 'public, max-age=3600' });
  fs.createReadStream(fp).pipe(res);
}

function apiPhotoDelete(req, res, id) {
  const rel = photoFromId(id);
  const fp  = path.resolve(path.join(PHOTOS_DIR, rel));
  if (!fp.startsWith(path.resolve(PHOTOS_DIR) + path.sep)) {
    res.writeHead(403); res.end(); return;
  }
  try { fs.unlinkSync(fp); } catch { json(res, { error: 'Delete failed' }, 500); return; }
  json(res, { ok: true });
}

module.exports = { apiPhotosList, apiPhotoServe, apiPhotoDelete };
