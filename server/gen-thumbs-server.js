'use strict';
// ═══════════════════════════════════════════════════════════════════
//  gen-thumbs-server.js — batch thumbnail pre-generation with SSE progress
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { THUMBS_DIR, VIDEOS_DIR, VIDEO_EXT } = require('./config-server');
const { json, toId } = require('./helpers-server');
const { setThumbCacheEntry, loadPrefs } = require('./db-server');
// Same generator as on-demand thumbs: shares the global ffmpeg slot cap, so a
// batch run no longer stacks 2 jobs × 5 parallel ffmpeg on top of grid requests.
const { genThumbs } = require('./thumbnails-server');

const THUMB_COUNT = 5;   // genThumbs extracts 5 frames (0..4.jpg)
const CONCURRENCY = 2;

function scanVideos(dir, base, isExternal = false) {
  if (!base) base = dir;
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'hidden' || e.name === 'Z') continue;
      out.push(...scanVideos(fp, base, isExternal));
    } else if (e.isFile() && VIDEO_EXT.has(path.extname(e.name).toLowerCase())) {
      // External files use their absolute path as ID (matching cachedScan in videos-server)
      const id = isExternal ? toId(fp) : toId(path.relative(base, fp));
      out.push({ fp, id });
    }
  }
  return out;
}

function scanAllVideos() {
  const all = scanVideos(VIDEOS_DIR);
  try {
    const prefs = loadPrefs();
    if (prefs.sourceFolders) {
      for (const folder of prefs.sourceFolders) {
        if (fs.existsSync(folder)) {
          all.push(...scanVideos(folder, folder, true));
        }
      }
    }
  } catch (e) {}
  return all;
}

function isComplete(id) {
  const dir = path.join(THUMBS_DIR, id);
  if (!fs.existsSync(dir)) return false;
  for (let i = 0; i < THUMB_COUNT; i++) {
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
  const all = scanAllVideos();
  const pending = all.filter(v => !isComplete(v.id));
  const skipped = all.length - pending.length;
  console.log(`[Sync] Video Thumbnails: ${all.length} total, ${pending.length} pending, ${skipped} already done`);

  _job = { running: true, stop: false, total: pending.length, done: 0, failed: 0, skipped, current: '' };
  broadcast({ type: 'start', total: pending.length, skipped });

  if (!pending.length) {
    _job.running = false;
    console.log('[Sync] Video Thumbnails: nothing to do');
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
        const r = await genThumbs(item.id, item.fp);
        if (!r.duration || r.count === 0) _job.failed++;
        if (r.duration) {
          // Persist per item (row upsert): the old end-of-run saveThumbsCache()
          // rewrote the whole table from a snapshot taken at start, dropping
          // entries written meanwhile and losing everything on a stop/crash.
          try { setThumbCacheEntry(item.id, { mtime: fs.statSync(item.fp).mtimeMs, ...r }); } catch { }
        }
      } catch { _job.failed++; }

      _job.done++;
      broadcast({ type: 'progress', done: _job.done, total: _job.total, current: _job.current });
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  _job.running = false;
  console.log(`[Sync] Video Thumbnails done: ${_job.done} generated, ${_job.failed} failed`);
  broadcast({ type: 'done', done: _job.done, failed: _job.failed, total: all.length, skipped: _job.skipped });
}

// ── API handlers ─────────────────────────────────────────────────────

function apiGenThumbsStart(req, res) {
  if (_job && _job.running) return json(res, { ok: false, error: 'Already running' });
  console.log('[Sync] Starting Video Thumbnails generation');
  runBatch().catch(console.error);
  json(res, { ok: true });
}

function apiGenThumbsStop(req, res) {
  if (_job) {
    _job.stop = true;
    console.log('[Sync] Stopping Video Thumbnails generation');
  }
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

function apiGenThumbsStatusPoll(req, res) {
  if (_job) {
    json(res, { running: _job.running, done: _job.done, total: _job.total, failed: _job.failed, skipped: _job.skipped || 0, current: _job.current || '' });
  } else {
    json(res, { running: false });
  }
}

module.exports = { apiGenThumbsStart, apiGenThumbsStop, apiGenThumbsStatus, apiGenThumbsStatusPoll };
