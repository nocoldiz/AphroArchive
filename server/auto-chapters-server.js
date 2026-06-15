'use strict';
// ═══════════════════════════════════════════════════════════════════
//  auto-chapters-server.js — ffmpeg scene-change chapter detection
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { CACHE_DIR, FFMPEG_BIN, VIDEOS_DIR } = require('./config-server');
const { json, safePath, fromId } = require('./helpers-server');

const AUTO_CHAPTERS_FILE = path.join(CACHE_DIR, '.AphroArchive-auto-chapters.json');
const SCENE_THRESHOLD = 0.4;
const MIN_GAP_SECONDS = 8;   // collapse scenes closer than this
const MAX_CHAPTERS = 60;
const CONCURRENCY = 1;       // ffmpeg is CPU-heavy; keep at 1

// ── Cache I/O ─────────────────────────────────────────────────────────

function loadAutoChaptersCache() {
  try {
    if (fs.existsSync(AUTO_CHAPTERS_FILE))
      return JSON.parse(fs.readFileSync(AUTO_CHAPTERS_FILE, 'utf8'));
  } catch {}
  return {};
}

function saveAutoChaptersCache(cache) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(AUTO_CHAPTERS_FILE, JSON.stringify(cache), 'utf8');
  } catch {}
}

// ── ffmpeg parsing ────────────────────────────────────────────────────

function parseShowinfo(output) {
  const times = [];
  const re = /pts_time:(\d+\.?\d*)/g;
  let m;
  while ((m = re.exec(output)) !== null) {
    const t = parseFloat(m[1]);
    if (Number.isFinite(t)) times.push(t);
  }
  return times;
}

function buildChapters(rawTimes) {
  const sorted = rawTimes.slice().sort((a, b) => a - b);
  const filtered = [];
  let last = -MIN_GAP_SECONDS;
  for (const t of sorted) {
    if (t < 2) continue; // skip near-start
    if (t - last >= MIN_GAP_SECONDS) {
      filtered.push(t);
      last = t;
    }
  }
  const capped = filtered.slice(0, MAX_CHAPTERS);
  return capped.map((t, i) => ({
    id: `auto_${Math.round(t * 1000)}`,
    time: Math.round(t * 100) / 100,
    title: `Scene ${i + 1}`,
  }));
}

// ── Detection ─────────────────────────────────────────────────────────

function detectAutoChaptersForVideo(id, fp) {
  return new Promise(resolve => {
    const args = [
      '-i', fp,
      '-vf', `select='gt(scene,${SCENE_THRESHOLD})',showinfo`,
      '-vsync', 'drop',
      '-an', '-f', 'null', '-',
    ];
    execFile(FFMPEG_BIN, args,
      { timeout: 180000, maxBuffer: 20 * 1024 * 1024 },
      (_err, stdout, stderr) => {
        const combined = (stderr || '') + (stdout || '');
        resolve(buildChapters(parseShowinfo(combined)));
      });
  });
}

// ── Single-video API ──────────────────────────────────────────────────

function apiGetAutoChapters(req, res, id) {
  const cache = loadAutoChaptersCache();
  const entry = cache[id];
  json(res, entry ? { chapters: entry.chapters, detectedAt: entry.detectedAt } : { chapters: null });
}

async function apiDetectAutoChapters(req, res, id) {
  const fp = safePath(id);
  if (!fp) return json(res, { error: 'Not found' }, 404);
  if (_job && _job.running) return json(res, { error: 'Batch detection in progress' }, 409);

  try {
    const chapters = await detectAutoChaptersForVideo(id, fp);
    const cache = loadAutoChaptersCache();
    cache[id] = { chapters, detectedAt: Date.now() };
    saveAutoChaptersCache(cache);
    json(res, { ok: true, chapters });
  } catch (e) {
    json(res, { error: String(e) }, 500);
  }
}

// ── Batch processing ──────────────────────────────────────────────────

function videoFpFromId(id) {
  const rel = fromId(id);
  return path.isAbsolute(rel) ? rel : path.join(VIDEOS_DIR, rel);
}

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.3gp', '.ogv', '.ts']);

function scanAllVideos() {
  const { loadPrefs } = require('./db-server');
  const out = [];
  function scan(dir, base, isExternal) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'hidden' || e.name === 'Z') continue;
        scan(fp, base, isExternal);
      } else if (e.isFile() && VIDEO_EXT.has(path.extname(e.name).toLowerCase())) {
        const id = isExternal
          ? Buffer.from(fp).toString('base64url')
          : Buffer.from(path.relative(base, fp)).toString('base64url');
        out.push({ fp, id });
      }
    }
  }
  scan(VIDEOS_DIR, VIDEOS_DIR, false);
  try {
    const prefs = loadPrefs();
    for (const folder of (prefs.sourceFolders || [])) {
      if (fs.existsSync(folder)) scan(folder, folder, true);
    }
  } catch {}
  return out;
}

let _job = null;
const _clients = new Set();

function broadcast(ev) {
  const line = 'data: ' + JSON.stringify(ev) + '\n\n';
  for (const r of _clients) {
    try { r.write(line); } catch { _clients.delete(r); }
  }
}

async function runBatch() {
  const cache = loadAutoChaptersCache();
  const all = scanAllVideos();
  const pending = all.filter(v => !cache[v.id]);
  const skipped = all.length - pending.length;

  _job = { running: true, stop: false, total: pending.length, done: 0, failed: 0, skipped, current: '' };
  broadcast({ type: 'start', total: pending.length, skipped });

  if (!pending.length) {
    _job.running = false;
    broadcast({ type: 'done', done: 0, failed: 0, total: all.length, skipped });
    return;
  }

  const queue = [...pending];

  async function worker() {
    while (queue.length && !_job.stop) {
      const item = queue.shift();
      _job.current = path.basename(item.fp);
      broadcast({ type: 'progress', done: _job.done, total: _job.total, current: _job.current });
      try {
        const chapters = await detectAutoChaptersForVideo(item.id, item.fp);
        cache[item.id] = { chapters, detectedAt: Date.now() };
      } catch {
        _job.failed++;
      }
      _job.done++;
      broadcast({ type: 'progress', done: _job.done, total: _job.total, current: _job.current });
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  saveAutoChaptersCache(cache);
  _job.running = false;
  broadcast({ type: 'done', done: _job.done, failed: _job.failed, total: all.length, skipped: _job.skipped });
}

// ── Batch API ─────────────────────────────────────────────────────────

function apiGenChaptersStart(req, res) {
  if (_job && _job.running) return json(res, { ok: false, error: 'Already running' });
  runBatch().catch(console.error);
  json(res, { ok: true });
}

function apiGenChaptersStop(req, res) {
  if (_job) _job.stop = true;
  json(res, { ok: true });
}

function apiGenChaptersStatus(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('\n');
  _clients.add(res);

  if (_job) {
    if (_job.running) {
      res.write('data: ' + JSON.stringify({ type: 'progress', done: _job.done, total: _job.total, current: _job.current }) + '\n\n');
    } else {
      res.write('data: ' + JSON.stringify({ type: 'done', done: _job.done, failed: _job.failed, total: _job.total + _job.skipped, skipped: _job.skipped }) + '\n\n');
    }
  } else {
    res.write('data: ' + JSON.stringify({ type: 'idle' }) + '\n\n');
  }

  req.on('close', () => _clients.delete(res));
}

function apiGenChaptersPoll(req, res) {
  if (_job) {
    json(res, { running: _job.running, done: _job.done, total: _job.total, failed: _job.failed, skipped: _job.skipped || 0, current: _job.current || '' });
  } else {
    json(res, { running: false });
  }
}

module.exports = {
  apiGetAutoChapters,
  apiDetectAutoChapters,
  apiGenChaptersStart,
  apiGenChaptersStop,
  apiGenChaptersStatus,
  apiGenChaptersPoll,
};
