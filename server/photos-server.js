'use strict';
// ═══════════════════════════════════════════════════════════════════
//  photos.js — Photo listing, serving, and deletion
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { PHOTOS_DIR, VIDEOS_DIR, VAULT_DIR, IGNORED_DIR, MIME } = require('./config-server');
const { json, formatBytes } = require('./helpers-server');

const IMAGE_EXT = new Set(['.jpg','.jpeg','.png','.gif','.webp','.avif','.bmp','.heic','.tiff','.tif']);

function photoToId(rootType, rel) { 
  return rootType + ':' + Buffer.from(rel).toString('base64url'); 
}
function photoFromId(id) { 
  const parts = id.split(':');
  if (parts.length === 1) return { rootType: 'p', rel: Buffer.from(id, 'base64url').toString('utf-8') };
  return { rootType: parts[0], rel: Buffer.from(parts[1], 'base64url').toString('utf-8') };
}

function scanPhotos(dir, base, rootType) {
  if (!base) base = dir;
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (rootType === 'v') {
        if (path.resolve(fp) === path.resolve(VAULT_DIR) || path.resolve(fp) === path.resolve(IGNORED_DIR)) continue;
      }
      out.push(...scanPhotos(fp, base, rootType));
    } else if (e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase())) {
      const rel  = path.relative(base, fp);
      const stat = fs.statSync(fp);
      out.push({
        id:       photoToId(rootType, rel),
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
  const photosP = scanPhotos(PHOTOS_DIR, PHOTOS_DIR, 'p');
  const photosV = scanPhotos(VIDEOS_DIR, VIDEOS_DIR, 'v');
  const photos  = [...photosP, ...photosV].sort((a, b) => b.date - a.date);
  json(res, photos);
}

function _getFp(id) {
  const { rootType, rel } = photoFromId(id);
  const root = rootType === 'v' ? VIDEOS_DIR : PHOTOS_DIR;
  const fp   = path.resolve(path.join(root, rel));
  if (!fp.startsWith(path.resolve(root) + path.sep) && fp !== path.resolve(root)) return null;
  return fp;
}

function apiPhotoServe(req, res, id) {
  const fp = _getFp(id);
  if (!fp || !fs.existsSync(fp)) { res.writeHead(404); res.end(); return; }
  const ext  = path.extname(fp).toLowerCase();
  const ct   = MIME[ext] || (ext === '.avif' ? 'image/avif' : ext === '.heic' ? 'image/heic' : 'image/jpeg');
  const stat = fs.statSync(fp);
  res.writeHead(200, { 'Content-Type': ct, 'Content-Length': stat.size, 'Cache-Control': 'public, max-age=3600' });
  fs.createReadStream(fp).pipe(res);
}

function apiPhotoDelete(req, res, id) {
  const fp = _getFp(id);
  if (!fp) { res.writeHead(403); res.end(); return; }
  try { fs.unlinkSync(fp); } catch { json(res, { error: 'Delete failed' }, 500); return; }
  json(res, { ok: true });
}

function apiPhotoDownload(req, res, id) {
  const fp = _getFp(id);
  if (!fp || !fs.existsSync(fp)) { res.writeHead(404); res.end(); return; }
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

module.exports = { apiPhotosList, apiPhotoServe, apiPhotoDelete, apiPhotoDownload };
