'use strict';
// ═══════════════════════════════════════════════════════════════════
//  gen-thumbs-server.js — batch thumbnail pre-generation with SSE progress
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { THUMBS_DIR, FFMPEG_BIN, FFPROBE_BIN, VIDEOS_DIR } = require('./config-server');
const { json } = require('./helpers-server');
const { loadThumbsCache, saveThumbsCache } = require('./db-server');

const VIDEO_EXT = new Set(['.mp4','.mkv','.avi','.mov','.wmv','.flv','.webm','.m4v','.mpg','.mpeg','.3gp','.ogv','.ts']);
const THUMB_PCT = [0.1, 0.25, 0.5, 0.75, 0.9];
const CONCURRENCY = 2;

function toId(rel) { return Buffer.from(rel).toString('base64url'); }

function scanVideos(dir, base) {
  if (!base) base = dir;
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'hidden' || e.name === 'Z') continue;
      out.push(...scanVideos(fp, base));
    } else if (e.isFile() && VIDEO_EXT.has(path.extname(e.name).toLowerCase())) {
      const rel = path.relative(base, fp);
      out.push({ fp, rel, id: toId(rel) });
    }
  }
  return out;
}

function isComplete(id) {
  const dir = path.join(THUMBS_DIR, id);
  if (!fs.existsSync(dir)) return false;
  for (let i = 0; i < THUMB_PCT.length; i++) {
    if (!fs.existsSync(path.join(dir, `${i}.jpg`))) return false;
  }
  return true;
}

// ── Global job state & SSE clients ──────────────────────────────────

let _job = null;  // { running, stop, total, done, failed, skipped, current }
const _clients = new Set();

function broadcast(ev) {
  const line = 'data: ' + JSON.stringify(ev) + '\n\n';
  for (const res of _clients) {
    try { res.write(line); } catch { _clients.delete(res); }
  }
}

// ── Batch runner ─────────────────────────────────────────────────────

async function runBatch() {
  const all     = scanVideos(VIDEOS_DIR);
  const pending = all.filter(v => !isComplete(v.id));
  const skipped = all.length - pending.length;

  _job = { running: true, stop: false, total: pending.length, done: 0, failed: 0, skipped, current: '' };
  broadcast({ type: 'start', total: pending.length, skipped });

  if (!pending.length) {
    _job.running = false;
    broadcast({ type: 'done', done: 0, failed: 0, total: all.length, skipped });
    return;
  }

  const cache = loadThumbsCache();
  const queue = [...pending];

  async function worker() {
    while (queue.length && !_job.stop) {
      const item = queue.shift();
      _job.current = path.basename(item.fp);
      broadcast({ type: 'progress', done: _job.done, total: _job.total, current: _job.current });

      try {
        const dur = await new Promise(resolve => {
          execFile(FFPROBE_BIN, ['-v','quiet','-print_format','json','-show_format', item.fp],
            { timeout: 15000 },
            (err, out) => {
              if (err) return resolve(null);
              try { resolve(parseFloat(JSON.parse(out).format.duration) || null); } catch { resolve(null); }
            });
        });

        if (!dur) { _job.failed++; _job.done++; broadcast({ type: 'progress', done: _job.done, total: _job.total, current: _job.current }); continue; }

        const dir = path.join(THUMBS_DIR, item.id);
        fs.mkdirSync(dir, { recursive: true });
        const times = THUMB_PCT.map(p => (dur * p).toFixed(2));
        let n = 0;
        await Promise.all(times.map((t, i) => new Promise(resolve => {
          execFile(FFMPEG_BIN,
            ['-ss', t, '-i', item.fp, '-vframes', '1', '-vf', 'scale=480:-1', '-q:v', '3', '-y', path.join(dir, `${i}.jpg`)],
            { timeout: 30000 }, err => { if (!err) n++; resolve(); });
        })));

        try {
          const stat = fs.statSync(item.fp);
          cache[item.id] = { mtime: stat.mtimeMs, count: n, duration: dur };
        } catch {}
        if (n === 0) _job.failed++;
      } catch { _job.failed++; }

      _job.done++;
      broadcast({ type: 'progress', done: _job.done, total: _job.total, current: _job.current });
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  saveThumbsCache(cache);
  _job.running = false;
  broadcast({ type: 'done', done: _job.done, failed: _job.failed, total: all.length, skipped: _job.skipped });
}

// ── API handlers ─────────────────────────────────────────────────────

function apiGenThumbsStart(req, res) {
  if (_job && _job.running) return json(res, { ok: false, error: 'Already running' });
  runBatch().catch(console.error);
  json(res, { ok: true });
}

function apiGenThumbsStop(req, res) {
  if (_job) _job.stop = true;
  json(res, { ok: true });
}

function apiGenThumbsStatus(req, res) {
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

module.exports = { apiGenThumbsStart, apiGenThumbsStop, apiGenThumbsStatus };
