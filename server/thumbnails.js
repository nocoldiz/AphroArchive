'use strict';
// ═══════════════════════════════════════════════════════════════════
//  thumbnails.js — ffmpeg thumbnail generation and serving
// ═══════════════════════════════════════════════════════════════════

const fs                = require('fs');
const path              = require('path');
const { execFile }      = require('child_process');
const { THUMBS_DIR, FFMPEG_BIN, FFPROBE_BIN } = require('./config');
const { json, safePath }               = require('./helpers');
const { loadThumbsCache, saveThumbsCache } = require('./db');

// ── ffprobe helper ───────────────────────────────────────────────────

function ffprobeDuration(fp) {
  return new Promise(resolve => {
    execFile(FFPROBE_BIN, ['-v','quiet','-print_format','json','-show_format', fp],
      { timeout: 15000 },
      (err, out) => {
        if (err) return resolve(null);
        try { resolve(parseFloat(JSON.parse(out).format.duration) || null); } catch { resolve(null); }
      });
  });
}

// ── Thumbnail generation ─────────────────────────────────────────────

const genLock = new Set();

async function genThumbs(id, fp) {
  const dir = path.join(THUMBS_DIR, id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const dur = await ffprobeDuration(fp);
  if (!dur) return { count: 0, duration: null };
  const times = [0.1, 0.25, 0.5, 0.75, 0.9].map(p => (dur * p).toFixed(2));
  let n = 0;
  await Promise.all(times.map((t, i) => new Promise(resolve => {
    execFile(FFMPEG_BIN, ['-ss', t, '-i', fp, '-vframes', '1', '-vf', 'scale=480:-1', '-q:v', '3', '-y', path.join(dir, `${i}.jpg`)],
      { timeout: 30000 },
      err => { if (!err) n++; resolve(); });
  })));
  return { count: n, duration: dur };
}

// ── Thumbnail API handlers ────────────────────────────────────────────

async function apiThumbGen(req, res, id) {
  const fp = safePath(id);
  if (!fp) return json(res, { error: 'Not found' }, 404);
  const cache = loadThumbsCache();
  const stat  = fs.statSync(fp);
  if (cache[id] && cache[id].mtime === stat.mtimeMs && cache[id].count > 0)
    return json(res, { count: cache[id].count, duration: cache[id].duration || null });
  if (genLock.has(id)) return json(res, { count: 0, busy: true });
  genLock.add(id);
  try {
    const { count, duration } = await genThumbs(id, fp);
    const c = loadThumbsCache();
    c[id]   = { mtime: stat.mtimeMs, count, duration };
    saveThumbsCache(c);
    json(res, { count, duration });
  } catch { json(res, { count: 0 }); } finally { genLock.delete(id); }
}

function apiThumbImg(req, res, id, idx) {
  const fp = path.resolve(path.join(THUMBS_DIR, id, `${idx}.jpg`));
  if (!fp.startsWith(path.resolve(THUMBS_DIR))) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(fp)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=604800' });
  fs.createReadStream(fp).pipe(res);
}

module.exports = { apiThumbGen, apiThumbImg };
