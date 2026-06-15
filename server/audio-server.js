'use strict';
// ═══════════════════════════════════════════════════════════════════
//  audio.js — Audio file listing, upload, streaming, deletion
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { AUDIO_DIR, VIDEOS_DIR, AUDIO_EXT, MIME } = require('./config-server');
const { json, formatBytes }                       = require('./helpers-server');
const { loadAudioMeta, saveAudioMeta, loadMediaIndex, loadPrefs } = require('./db-server');

function audioToId(n)   { return Buffer.from(n).toString('base64url'); }
function audioFromId(id) { return Buffer.from(id, 'base64url').toString(); }

function scanAudio(dir, base) {
  const out = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const fp = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        out.push(...scanAudio(fp, base));
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (AUDIO_EXT.has(ext)) {
          const stat = fs.statSync(fp);
          out.push({
            id: audioToId(fp),
            filename: ent.name,
            title: path.basename(ent.name, ext),
            ext,
            size: stat.size,
            sizeF: formatBytes(stat.size),
            date: stat.mtimeMs,
            isExternal: true
          });
        }
      }
    }
  } catch (e) {
    // Ignore
  }
  return out;
}

function apiAudioList(req, res) {
  const meta  = loadAudioMeta();
  const files = Object.entries(meta)
    .map(([filename, m]) => ({ id: audioToId(filename), filename, ...m }));

  // Include audio discovered in VIDEOS_DIR and sourceFolders by the unified scan
  try {
    const prefs = loadPrefs();
    const available = new Set([VIDEOS_DIR]);
    for (const sf of (prefs.sourceFolders || [])) {
      if (fs.existsSync(sf)) available.add(sf);
    }
    for (const m of loadMediaIndex('audio')) {
      if (!available.has(m.sourcePath)) continue;
      files.push({
        id: audioToId(m.absPath),
        filename: m.filename,
        title: m.name,
        ext: m.ext,
        size: m.size,
        sizeF: m.sizeF,
        date: m.mtime,
        isExternal: true,
      });
    }
  } catch (e) {
    console.error('Failed to load scanned audio from media index:', e);
  }

  files.sort((a, b) => b.date - a.date);
  json(res, files);
}

async function apiAudioUpload(req, res) {
  const filename     = decodeURIComponent(req.headers['x-filename'] || 'audio.mp3');
  const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9.\-_ ()]/g, '_');
  const ext          = path.extname(safeFilename).toLowerCase();
  if (!AUDIO_EXT.has(ext)) return json(res, { error: 'Unsupported type. Allowed: mp3, flac, wav, ogg, aac, m4a, wma, opus, aiff' }, 400);

  let outName = safeFilename, counter = 1;
  while (fs.existsSync(path.join(AUDIO_DIR, outName))) {
    outName = path.basename(safeFilename, ext) + ` (${counter++})` + ext;
  }

  const chunks = [];
  await new Promise((resolve, reject) => { req.on('data', c => chunks.push(c)); req.on('end', resolve); req.on('error', reject); });
  const data = Buffer.concat(chunks);
  fs.writeFileSync(path.join(AUDIO_DIR, outName), data);

  const meta = loadAudioMeta();
  meta[outName] = { title: path.basename(outName, ext), ext, size: data.length, sizeF: formatBytes(data.length), date: Date.now() };
  saveAudioMeta(meta);
  json(res, { ok: true, id: audioToId(outName) });
}

function apiAudioStream(req, res, id) {
  const filename = audioFromId(id);
  let fp;
  
  if (path.isAbsolute(filename)) {
    fp = filename;
    let allowed = fp.startsWith(path.resolve(VIDEOS_DIR) + path.sep) || fp.startsWith(path.resolve(VIDEOS_DIR) + '/');
    if (!allowed) {
      try {
        const prefs = loadPrefs();
        for (const folder of (prefs.sourceFolders || [])) {
          if (fp.startsWith(path.resolve(folder))) { allowed = true; break; }
        }
      } catch (e) {}
    }
    if (!allowed) { res.writeHead(403); res.end(); return; }
  } else {
    fp = path.join(AUDIO_DIR, path.basename(filename));
    if (!fp.startsWith(path.resolve(AUDIO_DIR) + path.sep)) { res.writeHead(403); res.end(); return; }
  }

  if (!fs.existsSync(fp)) { res.writeHead(404); res.end(); return; }
  const stat  = fs.statSync(fp);
  const size  = stat.size;
  const ext   = path.extname(fp).toLowerCase();
  const ct    = MIME[ext] || 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end   = endStr ? parseInt(endStr, 10) : size - 1;
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': ct });
    fs.createReadStream(fp, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': size, 'Content-Type': ct, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(fp).pipe(res);
  }
}

function apiAudioDelete(req, res, id) {
  const filename = audioFromId(id);
  const fp       = path.join(AUDIO_DIR, path.basename(filename));
  if (!fp.startsWith(path.resolve(AUDIO_DIR) + path.sep)) return json(res, { error: 'Invalid path' }, 400);
  try { fs.unlinkSync(fp); } catch {}
  const meta = loadAudioMeta();
  delete meta[filename];
  saveAudioMeta(meta);
  json(res, { ok: true });
}

module.exports = { apiAudioList, apiAudioUpload, apiAudioStream, apiAudioDelete };
