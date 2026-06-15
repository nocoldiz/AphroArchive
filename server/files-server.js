'use strict';
// ═══════════════════════════════════════════════════════════════════
//  files.js — Generic file listing, upload, streaming, deletion,
//              and virtual folder management
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { FILES_DIR, VIDEOS_DIR, MIME } = require('./config-server');
const { json, formatBytes, toId, fromId } = require('./helpers-server');
const {
  loadFilesMeta, upsertFileMeta, deleteFileMeta,
  loadFileVirtualFolders, setFileVirtualFolder,
  renameFileVirtualFolder, deleteFileVirtualFolder, listFileVirtualFolderNames,
  loadMediaIndex, loadPrefs,
} = require('./db-server');

function fileIdFromAbs(absPath) { return toId(absPath); }

// ── Helpers ───────────────────────────────────────────────────────

function _isAllowedPath(fp) {
  const resolved = path.resolve(fp);
  if (resolved.startsWith(path.resolve(FILES_DIR) + path.sep)) return true;
  if (resolved.startsWith(path.resolve(VIDEOS_DIR) + path.sep)) return true;
  try {
    const prefs = loadPrefs();
    for (const sf of (prefs.sourceFolders || [])) {
      if (resolved.startsWith(path.resolve(sf) + path.sep)) return true;
    }
  } catch {}
  return false;
}

function _buildFileList() {
  const virtualFolders = loadFileVirtualFolders();

  // 1. Files uploaded to FILES_DIR (stored in files_meta)
  const dbFiles = loadFilesMeta().map(f => ({
    ...f,
    folder: virtualFolders[f.id] || '',
    source: 'upload',
  }));

  // 2. Unrecognized files discovered via unified media scan (media_index type='file')
  const scannedFiles = (() => {
    try {
      const prefs = loadPrefs();
      const available = new Set([VIDEOS_DIR]);
      for (const sf of (prefs.sourceFolders || [])) {
        if (fs.existsSync(sf)) available.add(sf);
      }
      return loadMediaIndex('file')
        .filter(m => available.has(m.sourcePath))
        .map(m => ({
          id:       m.id,
          filename: m.filename,
          title:    m.name,
          ext:      m.ext,
          size:     m.size,
          sizeF:    m.sizeF,
          date:     m.mtime,
          absPath:  m.absPath,
          folder:   virtualFolders[m.id] || '',
          source:   'scan',
        }));
    } catch { return []; }
  })();

  // Merge — db files first, then scanned; dedup by id
  const seen = new Set();
  const out = [];
  for (const f of [...dbFiles, ...scannedFiles]) {
    if (!seen.has(f.id)) { seen.add(f.id); out.push(f); }
  }
  return out.sort((a, b) => b.date - a.date);
}

// ── API handlers ─────────────────────────────────────────────────

function apiFilesList(req, res) {
  json(res, _buildFileList());
}

function apiFileFolders(req, res) {
  json(res, listFileVirtualFolderNames());
}

async function apiFilesUpload(req, res) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
  const rawName   = decodeURIComponent(req.headers['x-filename'] || 'file');
  const safeName  = path.basename(rawName).replace(/[^a-zA-Z0-9.\-_ ()]/g, '_');
  const ext       = path.extname(safeName).toLowerCase();

  let outName = safeName, counter = 1;
  while (fs.existsSync(path.join(FILES_DIR, outName))) {
    outName = path.basename(safeName, ext) + ` (${counter++})` + ext;
  }

  const chunks = [];
  await new Promise((resolve, reject) => { req.on('data', c => chunks.push(c)); req.on('end', resolve); req.on('error', reject); });
  const data = Buffer.concat(chunks);
  const absPath = path.join(FILES_DIR, outName);
  fs.writeFileSync(absPath, data);

  const item = {
    id: fileIdFromAbs(absPath),
    filename: outName,
    title: path.basename(outName, ext),
    ext,
    size: data.length,
    sizeF: formatBytes(data.length),
    date: Date.now(),
    absPath,
  };
  upsertFileMeta(item);
  json(res, { ok: true, id: item.id });
}

function apiFileStream(req, res, id) {
  const absPath = fromId(id);
  if (!absPath || !_isAllowedPath(absPath)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(absPath)) { res.writeHead(404); res.end(); return; }

  const stat  = fs.statSync(absPath);
  const size  = stat.size;
  const ext   = path.extname(absPath).toLowerCase();
  const ct    = MIME[ext] || 'application/octet-stream';
  const range = req.headers.range;

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end   = endStr ? parseInt(endStr, 10) : size - 1;
    res.writeHead(206, {
      'Content-Range':  `bytes ${start}-${end}/${size}`,
      'Accept-Ranges':  'bytes',
      'Content-Length': end - start + 1,
      'Content-Type':   ct,
    });
    fs.createReadStream(absPath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': size, 'Content-Type': ct, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(absPath).pipe(res);
  }
}

function apiFileDownload(req, res, id) {
  const absPath = fromId(id);
  if (!absPath || !_isAllowedPath(absPath)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(absPath)) { res.writeHead(404); res.end(); return; }
  const stat = fs.statSync(absPath);
  const ext  = path.extname(absPath).toLowerCase();
  const ct   = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type':        ct,
    'Content-Length':      stat.size,
    'Content-Disposition': `attachment; filename="${path.basename(absPath).replace(/"/g, '')}"`,
  });
  fs.createReadStream(absPath).pipe(res);
}

function apiFileDelete(req, res, id) {
  const absPath = fromId(id);
  if (!absPath || !_isAllowedPath(absPath)) { res.writeHead(403); res.end(); return; }
  try { fs.unlinkSync(absPath); } catch {}
  deleteFileMeta(id);
  setFileVirtualFolder(id, null);
  json(res, { ok: true });
}

async function apiFileFolderSet(req, res) {
  const body = await _readBody(req);
  const { id, folder } = body;
  if (!id) return json(res, { error: 'id required' }, 400);
  setFileVirtualFolder(id, folder || null);
  json(res, { ok: true });
}

async function apiFileFolderRename(req, res) {
  const body = await _readBody(req);
  const { oldName, newName } = body;
  if (!oldName || !newName) return json(res, { error: 'oldName and newName required' }, 400);
  renameFileVirtualFolder(oldName, newName);
  json(res, { ok: true });
}

async function apiFileFolderDelete(req, res) {
  const body = await _readBody(req);
  const { name } = body;
  if (!name) return json(res, { error: 'name required' }, 400);
  deleteFileVirtualFolder(name);
  json(res, { ok: true });
}

function _readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

module.exports = {
  apiFilesList,
  apiFileFolders,
  apiFilesUpload,
  apiFileStream,
  apiFileDownload,
  apiFileDelete,
  apiFileFolderSet,
  apiFileFolderRename,
  apiFileFolderDelete,
};
