'use strict';
// ═══════════════════════════════════════════════════════════════════
//  screenshots-server.js — Screenshot listing, serving, and deletion
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { SCREENSHOTS_DIR, MIME } = require('./config-server');
const { json, formatBytes } = require('./helpers-server');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

function screenshotToId(rel) {
  return Buffer.from(rel).toString('base64url');
}
function screenshotFromId(id) {
  return Buffer.from(id, 'base64url').toString('utf-8');
}

function _getFp(id) {
  const rel = screenshotFromId(id);
  const fp  = path.resolve(path.join(SCREENSHOTS_DIR, rel));
  if (!fp.startsWith(path.resolve(SCREENSHOTS_DIR) + path.sep)) return null;
  return fp;
}

function apiScreenshotsList(req, res) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  let entries;
  try { entries = fs.readdirSync(SCREENSHOTS_DIR, { withFileTypes: true }); }
  catch { entries = []; }

  const screenshots = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (!IMAGE_EXT.has(ext)) continue;
    const fp   = path.join(SCREENSHOTS_DIR, e.name);
    const stat = fs.statSync(fp);
    screenshots.push({
      id:       screenshotToId(e.name),
      filename: e.name,
      folder:   '',
      ext,
      size:     stat.size,
      sizeF:    formatBytes(stat.size),
      date:     stat.mtimeMs,
    });
  }
  screenshots.sort((a, b) => b.date - a.date);
  json(res, screenshots);
}

function apiScreenshotServe(req, res, id) {
  const fp = _getFp(id);
  if (!fp || !fs.existsSync(fp)) { res.writeHead(404); res.end(); return; }
  const ext  = path.extname(fp).toLowerCase();
  const ct   = MIME[ext] || 'image/jpeg';
  const stat = fs.statSync(fp);
  res.writeHead(200, { 'Content-Type': ct, 'Content-Length': stat.size, 'Cache-Control': 'public, max-age=3600' });
  fs.createReadStream(fp).pipe(res);
}

function apiScreenshotDelete(req, res, id) {
  const fp = _getFp(id);
  if (!fp) { res.writeHead(403); res.end(); return; }
  try { fs.unlinkSync(fp); } catch { json(res, { error: 'Delete failed' }, 500); return; }
  json(res, { ok: true });
}

function apiScreenshotDownload(req, res, id) {
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

function apiScreenshotsUpload(req, res) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const rawName  = req.headers['x-filename'] || 'screenshot.jpg';
  const safeName = path.basename(rawName).replace(/[^a-zA-Z0-9._\-\s]/g, '_');

  const dest = path.join(SCREENSHOTS_DIR, safeName);
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    try {
      fs.writeFileSync(dest, Buffer.concat(chunks));
      json(res, { ok: true, file: safeName });
    } catch (e) { json(res, { error: e.message }, 500); }
  });
}

module.exports = {
  apiScreenshotsList, apiScreenshotServe, apiScreenshotDelete,
  apiScreenshotDownload, apiScreenshotsUpload,
};
