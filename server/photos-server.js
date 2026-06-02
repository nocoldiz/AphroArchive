'use strict';
// ═══════════════════════════════════════════════════════════════════
//  photos.js — Photo listing, serving, and deletion
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { PHOTOS_DIR, VIDEOS_DIR, VAULT_DIR, IGNORED_DIR, MIME } = require('./config-server');
const { json, formatBytes } = require('./helpers-server');

const IMAGE_EXT = new Set(['.jpg','.jpeg','.png','.gif','.webp','.avif','.bmp','.heic','.tiff','.tif']);

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
          if (keyword === 'parameters') {
            const text = data.toString('utf-8', nullIdx + 1);
            return text; // This is the prompt and metadata!
          }
        }
      }
      offset += 12 + len; // 4 (len) + 4 (type) + len + 4 (crc)
    }
  } catch (e) {
    // Ignore errors
  }
  return null;
}

function photoToId(rootType, rel) { 
  return rootType + ':' + Buffer.from(rel).toString('base64url'); 
}
function photoFromId(id) { 
  const parts = id.split(':');
  if (parts.length === 1) return { rootType: 'p', rel: Buffer.from(id, 'base64url').toString('utf-8') };
  return { rootType: parts[0], rel: Buffer.from(parts[1], 'base64url').toString('utf-8') };
}

function scanPhotos(dir, base, rootType, folderPath) {
  if (!base) base = dir;
  if (folderPath === undefined) folderPath = '';
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
      const childFolder = folderPath ? folderPath + '/' + e.name : e.name;
      out.push(...scanPhotos(fp, base, rootType, childFolder));
    } else if (e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase())) {
      const rel  = rootType === 's' ? fp : path.relative(base, fp);
      const stat = fs.statSync(fp);
      const ext  = path.extname(e.name).toLowerCase();

      let isAi = false;
      let aiPrompt = '';
      if (ext === '.png') {
        const meta = readPngMetadata(fp);
        if (meta) {
          isAi = true;
          aiPrompt = meta;
        }
      }

      out.push({
        id:       photoToId(rootType, rel),
        filename: e.name,
        folder:   folderPath,
        rel,
        ext,
        size:     stat.size,
        sizeF:    formatBytes(stat.size),
        date:     stat.mtimeMs,
        isAi,
        aiPrompt,
      });
    }
  }
  return out;
}

function apiPhotoFolders(req, res) {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  const photos = [
    ...scanPhotos(PHOTOS_DIR, PHOTOS_DIR, 'p'),
    ...scanPhotos(VIDEOS_DIR, VIDEOS_DIR, 'v'),
  ];
  try {
    const { loadPrefs } = require('./db-server');
    const prefs = loadPrefs();
    if (prefs.sourceFolders) {
      for (const folder of prefs.sourceFolders) {
        if (fs.existsSync(folder)) photos.push(...scanPhotos(folder, folder, 's'));
      }
    }
  } catch (e) {}

  const folderSet = new Map();
  for (const p of photos) {
    if (!p.folder) continue;
    const parts = p.folder.split('/');
    let cur = '';
    for (const part of parts) {
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
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  const photosP = scanPhotos(PHOTOS_DIR, PHOTOS_DIR, 'p');
  const photosV = scanPhotos(VIDEOS_DIR, VIDEOS_DIR, 'v');
  
  let photosS = [];
  try {
    const { loadPrefs } = require('./db-server');
    const prefs = loadPrefs();
    if (prefs.sourceFolders) {
      for (const folder of prefs.sourceFolders) {
        if (fs.existsSync(folder)) {
          photosS.push(...scanPhotos(folder, folder, 's'));
        }
      }
    }
  } catch (e) {
    console.error('Failed to scan external photo folders:', e);
  }
  
  const photos  = [...photosP, ...photosV, ...photosS].sort((a, b) => b.date - a.date);
  json(res, photos);
}

function _getFp(id) {
  const { rootType, rel } = photoFromId(id);
  
  if (rootType === 's') {
    const fp = path.resolve(rel);
    try {
      const { loadPrefs } = require('./db-server');
      const prefs = loadPrefs();
      if (prefs.sourceFolders) {
        for (const folder of prefs.sourceFolders) {
          if (fp.startsWith(path.resolve(folder))) {
            if (fs.existsSync(fp)) return fp;
          }
        }
      }
    } catch (e) {
      // Ignore
    }
    return null;
  }
  
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

function apiPhotosUpload(req, res) {
  const { PHOTOS_DIR } = require('./config-server');
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  const rawName = req.headers['x-filename'] || 'photo.jpg';
  const safeName = path.basename(rawName).replace(/[^a-zA-Z0-9._\-\s]/g, '_');
  
  const dest = path.join(PHOTOS_DIR, safeName);
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    try {
      fs.writeFileSync(dest, Buffer.concat(chunks));
      json(res, { ok: true, file: safeName });
    } catch (e) { json(res, { error: e.message }, 500); }
  });
}

module.exports = { apiPhotosList, apiPhotoFolders, apiPhotoServe, apiPhotoDelete, apiPhotoDownload, apiPhotosUpload };
