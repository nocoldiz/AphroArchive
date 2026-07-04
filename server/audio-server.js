'use strict';
// ═══════════════════════════════════════════════════════════════════
//  audio.js — Audio listing, upload, streaming, deletion
//
//  All audio now derives from the unified media_index (auto-sorted by
//  extension during the main scan). Files are identified by toId(absPath).
//  The legacy audio_meta table is consulted only to recover user titles.
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { MEDIA_DIR, AUDIO_EXT, MIME } = require('./config-server');
const { json, formatBytes, toId, fromId, isAllowedMediaPath } = require('./helpers-server');
const { loadAudioMeta, saveAudioMeta, loadMediaIndex } = require('./db-server');

function _invalidate() { try { require('./videos-server').invalidateScanCache(); } catch {} }

function apiAudioList(req, res) {
  // Legacy titles keyed by filename (uploads before the media_index unification).
  let legacy = {};
  try { legacy = loadAudioMeta(); } catch {}
  const files = loadMediaIndex('audio').map(m => ({
    id:       m.id,
    filename: m.filename,
    title:    m.title || (legacy[m.filename] && legacy[m.filename].title) || m.name,
    ext:      m.ext,
    size:     m.size,
    sizeF:    m.sizeF,
    date:     m.mtime,
    folder:   m.catPath || '',
    isExternal: true,
  }));
  files.sort((a, b) => b.date - a.date);
  json(res, files);
}

async function apiAudioUpload(req, res) {
  const filename     = decodeURIComponent(req.headers['x-filename'] || 'audio.mp3');
  const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9.\-_ ()]/g, '_');
  const ext          = path.extname(safeFilename).toLowerCase();
  if (!AUDIO_EXT.has(ext)) return json(res, { error: 'Unsupported type. Allowed: mp3, flac, wav, ogg, aac, m4a, wma, opus, aiff' }, 400);

  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  let outName = safeFilename, counter = 1;
  while (fs.existsSync(path.join(MEDIA_DIR, outName))) {
    outName = path.basename(safeFilename, ext) + ` (${counter++})` + ext;
  }

  const chunks = [];
  await new Promise((resolve, reject) => { req.on('data', c => chunks.push(c)); req.on('end', resolve); req.on('error', reject); });
  const data = Buffer.concat(chunks);
  const absPath = path.join(MEDIA_DIR, outName);
  fs.writeFileSync(absPath, data);

  // Persist the user-chosen title; the scan will index the file itself.
  const meta = loadAudioMeta();
  meta[outName] = { title: path.basename(outName, ext), ext, size: data.length, sizeF: formatBytes(data.length), date: Date.now() };
  saveAudioMeta(meta);
  _invalidate();
  json(res, { ok: true, id: toId(absPath) });
}

function apiAudioStream(req, res, id) {
  const fp = fromId(id);
  if (!fp || !isAllowedMediaPath(fp)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(fp)) { res.writeHead(404); res.end(); return; }

  const stat  = fs.statSync(fp);
  const size  = stat.size;
  const ext   = path.extname(fp).toLowerCase();
  const ct    = MIME[ext] || 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    let start = parseInt(startStr, 10);
    let end   = endStr ? parseInt(endStr, 10) : size - 1;
    if (Number.isNaN(start)) start = 0;
    if (Number.isNaN(end)) end = size - 1;
    if (start < 0 || end >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': ct });
    const rs = fs.createReadStream(fp, { start, end });
    rs.on('error', () => { try { res.destroy(); } catch {} });
    res.on('close', () => { try { rs.destroy(); } catch {} });
    rs.pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': size, 'Content-Type': ct, 'Accept-Ranges': 'bytes' });
    const rs = fs.createReadStream(fp);
    rs.on('error', () => { try { res.destroy(); } catch {} });
    res.on('close', () => { try { rs.destroy(); } catch {} });
    rs.pipe(res);
  }
}

function apiAudioDelete(req, res, id) {
  const fp = fromId(id);
  if (!fp || !isAllowedMediaPath(fp)) return json(res, { error: 'Invalid path' }, 403);
  try { fs.unlinkSync(fp); } catch {}
  const meta = loadAudioMeta();
  delete meta[path.basename(fp)];
  saveAudioMeta(meta);
  _invalidate();
  json(res, { ok: true });
}

module.exports = { apiAudioList, apiAudioUpload, apiAudioStream, apiAudioDelete };
