'use strict';
// ═══════════════════════════════════════════════════════════════════
//  thumbnails.js — ffmpeg thumbnail generation and serving
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { THUMBS_DIR, FFMPEG_BIN, FFPROBE_BIN, VIDEOS_DIR } = require('./config-server');
const { json, safePath, fromId } = require('./helpers-server');
const { loadThumbsCache, saveThumbsCache, loadPrefs } = require('./db-server');
const crypto = require('crypto');

// ── ffprobe helper ───────────────────────────────────────────────────

function ffprobeInfo(fp) {
  return new Promise(resolve => {
    try {
      execFile(FFPROBE_BIN, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', fp],
        { timeout: 15000 },
        (err, out) => {
          if (err) return resolve({ duration: null, width: null, height: null });
          try {
            const d = JSON.parse(out);
            const duration = parseFloat(d.format?.duration) || null;
            const vs = (d.streams || []).find(s => s.codec_type === 'video');
            const width = vs?.width || null;
            const height = vs?.height || null;
            resolve({ duration, width, height });
          } catch { resolve({ duration: null, width: null, height: null }); }
        });
    } catch { resolve({ duration: null, width: null, height: null }); }
  });
}

// ── Alt thumb dir (source-folder parent cache) ───────────────────────

function findAltThumbDir(videoFp, id) {
  try {
    const prefs = loadPrefs();
    for (const sf of (prefs.sourceFolders || [])) {
      const resolvedSf = path.resolve(sf);
      if (videoFp.startsWith(resolvedSf + path.sep)) {
        const altDir = path.join(path.dirname(resolvedSf), 'cache', '.AphroArchive-thumbs', id);
        if (fs.existsSync(altDir)) return altDir;
      }
    }
  } catch {}
  return null;
}

function videoFpFromId(id) {
  const rel = fromId(id);
  return path.isAbsolute(rel) ? rel : path.join(VIDEOS_DIR, rel);
}

// ── Thumbnail generation ─────────────────────────────────────────────

const genLock = new Set();

async function genThumbs(id, fp) {
  const dir = path.join(THUMBS_DIR, id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const { duration: dur, width, height } = await ffprobeInfo(fp);
  if (!dur) return { count: 0, duration: null, width: null, height: null };
  const times = [0.1, 0.25, 0.5, 0.75, 0.9].map(p => (dur * p).toFixed(2));
  let n = 0;
  await Promise.all(times.map((t, i) => new Promise(resolve => {
    try {
      execFile(FFMPEG_BIN, ['-ss', t, '-i', fp, '-vframes', '1', '-vf', 'scale=480:-1', '-q:v', '3', '-y', path.join(dir, `${i}.jpg`)],
        { timeout: 30000 },
        err => { if (!err) n++; resolve(); });
    } catch { resolve(); }
  })));
  return { count: n, duration: dur, width, height };
}

// ── Thumbnail API handlers ────────────────────────────────────────────

async function apiThumbGen(req, res, id) {
  const fp = safePath(id);
  if (!fp) return json(res, { error: 'Not found' }, 404);
  const cache = loadThumbsCache();
  const stat = fs.statSync(fp);
  if (cache[id] && cache[id].mtime === stat.mtimeMs && cache[id].count > 0)
    return json(res, { count: cache[id].count, duration: cache[id].duration || null, width: cache[id].width || null, height: cache[id].height || null });
  if (genLock.has(id)) return json(res, { count: 0, busy: true });

  const altDir = findAltThumbDir(fp, id);
  if (altDir) {
    const jpgs = fs.readdirSync(altDir).filter(f => /^\d+\.jpg$/.test(f));
    if (jpgs.length > 0) {
      const c = loadThumbsCache();
      const duration = (c[id] && c[id].duration) || null;
      const width = (c[id] && c[id].width) || null;
      const height = (c[id] && c[id].height) || null;
      c[id] = { mtime: stat.mtimeMs, count: jpgs.length, duration, width, height };
      saveThumbsCache(c);
      return json(res, { count: jpgs.length, duration, width, height });
    }
  }

  genLock.add(id);
  try {
    const { count, duration, width, height } = await genThumbs(id, fp);
    const c = loadThumbsCache();
    c[id] = { mtime: stat.mtimeMs, count, duration, width, height };
    saveThumbsCache(c);
    json(res, { count, duration, width, height });
  } catch { json(res, { count: 0 }); } finally { genLock.delete(id); }
}

async function genChapterThumb(id, fp, time, chapterId) {
  const dir = path.join(THUMBS_DIR, id, 'chapters');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, `${chapterId}.jpg`);
  return new Promise(resolve => {
    execFile(FFMPEG_BIN, ['-ss', time, '-i', fp, '-vframes', '1', '-vf', 'scale=480:-1', '-q:v', '3', '-y', outPath],
      { timeout: 30000 },
      err => resolve(!err));
  });
}

async function apiThumbImg(req, res, id, idx) {
  const { allVideos, getUnlockedCategoryKey } = require('./videos-server');
  const v = (await allVideos()).find(v => v.id === id);
  let fp = path.resolve(path.join(THUMBS_DIR, id, `${idx}.jpg`));
  if (!fp.startsWith(path.resolve(THUMBS_DIR))) { res.writeHead(403); res.end(); return; }

  const encFp = fp + '.enc';
  if (v && v.encrypted && fs.existsSync(encFp)) {
    const key = getUnlockedCategoryKey(v.catPath);
    if (!key) { res.writeHead(401); res.end(); return; }
    try {
      const dec = decryptBuffer(fs.readFileSync(encFp), key);
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=604800' });
      res.end(dec);
      return;
    } catch (e) { res.writeHead(500); res.end(); return; }
  }

  if (!fs.existsSync(fp)) {
    const altDir = findAltThumbDir(videoFpFromId(id), id);
    if (altDir) {
      const altFp = path.join(altDir, `${idx}.jpg`);
      if (fs.existsSync(altFp)) {
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=604800' });
        fs.createReadStream(altFp).pipe(res);
        return;
      }
    }
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=604800' });
  fs.createReadStream(fp).pipe(res);
}

function decryptBuffer(raw, key) {
  const ivLen = 12, tagLen = 16;
  const iv = raw.slice(0, ivLen);
  const tag = raw.slice(raw.length - tagLen);
  const ct = raw.slice(ivLen, raw.length - tagLen);
  const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(ct), dec.final()]);
}

async function apiChapterThumbImg(req, res, id, chapterId) {
  const { allVideos, getUnlockedCategoryKey } = require('./videos-server');
  const v = (await allVideos()).find(v => v.id === id);
  let fp = path.resolve(path.join(THUMBS_DIR, id, 'chapters', `${chapterId}.jpg`));
  if (!fp.startsWith(path.resolve(THUMBS_DIR))) { res.writeHead(403); res.end(); return; }

  const encFp = fp + '.enc';
  if (v && v.encrypted && fs.existsSync(encFp)) {
    const key = getUnlockedCategoryKey(v.catPath);
    if (!key) { res.writeHead(401); res.end(); return; }
    try {
      const dec = decryptBuffer(fs.readFileSync(encFp), key);
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=604800' });
      res.end(dec);
      return;
    } catch (e) { res.writeHead(500); res.end(); return; }
  }

  if (!fs.existsSync(fp)) {
    const altDir = findAltThumbDir(videoFpFromId(id), id);
    if (altDir) {
      const altFp = path.join(altDir, 'chapters', `${chapterId}.jpg`);
      if (fs.existsSync(altFp)) {
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=604800' });
        fs.createReadStream(altFp).pipe(res);
        return;
      }
    }
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=604800' });
  fs.createReadStream(fp).pipe(res);
}

async function apiThumbnailsList(req, res) {
  try {
    if (!fs.existsSync(THUMBS_DIR)) return json(res, []);
    const dirs = fs.readdirSync(THUMBS_DIR).filter(d => !d.startsWith('.'));
    const results = [];
    for (const id of dirs) {
      const dirPath = path.join(THUMBS_DIR, id);
      if (!fs.statSync(dirPath).isDirectory()) continue;
      const files = fs.readdirSync(dirPath).filter(f => (f.endsWith('.jpg') || f.endsWith('.jpg.enc')) && !isNaN(parseInt(f)));
      if (files.length > 0) {
        results.push({
          id,
          count: files.length,
          thumbs: files.sort((a, b) => parseInt(a, 10) - parseInt(b, 10)).map(f => `/api/thumbs/${id}/${parseInt(f, 10)}`)
        });
      }
    }
    json(res, results);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

module.exports = { apiThumbGen, apiThumbImg, genChapterThumb, apiChapterThumbImg, apiThumbnailsList, genThumbs };
