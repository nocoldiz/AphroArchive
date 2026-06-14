'use strict';
// ═══════════════════════════════════════════════════════════════════
//  library-health-server.js — scan library for broken/missing entries
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { VIDEOS_DIR, THUMBS_DIR } = require('./config-server');
const { json, fromId } = require('./helpers-server');
const { loadVideoIndex, loadVideoMeta, loadThumbsCache, deleteVideoMetaEverywhere } = require('./db-server');

const THUMB_COUNT = 5; // expected number of thumbnails per video

// ── Issue types ──────────────────────────────────────────────────────
//  missing_file  — in index but file not on disk
//  zero_duration — in thumbs cache with duration 0 or null
//  missing_thumbs — file exists but has no complete thumbnail set
//  orphaned_meta — entry in `videos` table with no video_index entry

// ── Global scan state ────────────────────────────────────────────────

let _scan = null; // { running, done, total, results }
const _clients = new Set();

function broadcast(ev) {
  const line = 'data: ' + JSON.stringify(ev) + '\n\n';
  for (const res of _clients) {
    try { res.write(line); } catch { _clients.delete(res); }
  }
}

function resolveFilePath(id) {
  const rel = fromId(id);
  return path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(VIDEOS_DIR, rel);
}

function hasCompleteThumbs(id) {
  const dir = path.join(THUMBS_DIR, id);
  if (!fs.existsSync(dir)) return false;
  for (let i = 0; i < THUMB_COUNT; i++) {
    if (!fs.existsSync(path.join(dir, `${i}.jpg`))) return false;
  }
  return true;
}

async function runScan() {
  _scan = { running: true, done: 0, total: 0, results: [] };
  broadcast({ type: 'start' });

  const index  = loadVideoIndex() || [];
  const meta   = loadVideoMeta();
  const thumbs = loadThumbsCache();

  const indexIds = new Set(index.map(v => v.id));

  // Check 1: orphaned metadata (in videos table but not in index)
  const orphanedMeta = Object.keys(meta).filter(id => !indexIds.has(id));

  _scan.total = index.length + orphanedMeta.length;
  broadcast({ type: 'progress', done: 0, total: _scan.total });

  const results = [];

  // Check index entries
  for (const v of index) {
    if (v.encrypted) { _scan.done++; continue; } // skip vault files

    const fp = resolveFilePath(v.id);

    // missing_file
    if (!fs.existsSync(fp)) {
      results.push({ type: 'missing_file', id: v.id, name: v.name, path: fp, catPath: v.cat_path || '' });
      _scan.done++;
      broadcast({ type: 'progress', done: _scan.done, total: _scan.total });
      continue;
    }

    // zero_duration
    const cached = thumbs[v.id];
    if (cached && (cached.duration === 0 || cached.duration === null)) {
      results.push({ type: 'zero_duration', id: v.id, name: v.name, path: fp, catPath: v.cat_path || '' });
    }

    // missing_thumbs (only for non-encrypted files that exist)
    if (!hasCompleteThumbs(v.id)) {
      results.push({ type: 'missing_thumbs', id: v.id, name: v.name, path: fp, catPath: v.cat_path || '' });
    }

    _scan.done++;
    if (_scan.done % 50 === 0) {
      broadcast({ type: 'progress', done: _scan.done, total: _scan.total });
    }
  }

  // Check orphaned metadata entries
  for (const id of orphanedMeta) {
    const vMeta = meta[id] || {};
    results.push({ type: 'orphaned_meta', id, name: vMeta.title || id, path: null, catPath: vMeta.category || '' });
    _scan.done++;
  }

  _scan.results = results;
  _scan.running = false;

  const summary = {
    missing_file:   results.filter(r => r.type === 'missing_file').length,
    zero_duration:  results.filter(r => r.type === 'zero_duration').length,
    missing_thumbs: results.filter(r => r.type === 'missing_thumbs').length,
    orphaned_meta:  results.filter(r => r.type === 'orphaned_meta').length,
  };

  broadcast({ type: 'done', total: _scan.total, issues: results.length, summary });
}

// ── API handlers ─────────────────────────────────────────────────────

function apiHealthScan(req, res) {
  if (_scan && _scan.running) return json(res, { ok: false, error: 'Scan already running' });
  runScan().catch(console.error);
  json(res, { ok: true });
}

function apiHealthStatus(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('\n');
  _clients.add(res);

  if (_scan) {
    const ev = _scan.running
      ? { type: 'progress', done: _scan.done, total: _scan.total }
      : { type: 'done', total: _scan.total, issues: _scan.results.length };
    res.write('data: ' + JSON.stringify(ev) + '\n\n');
  } else {
    res.write('data: ' + JSON.stringify({ type: 'idle' }) + '\n\n');
  }

  req.on('close', () => _clients.delete(res));
}

function apiHealthResults(req, res) {
  if (!_scan || _scan.running) return json(res, { running: !!(_scan && _scan.running), results: [] });
  json(res, { running: false, results: _scan.results });
}

async function apiHealthFix(req, res) {
  let body = {};
  try {
    body = await new Promise((resolve, reject) => {
      let d = '';
      req.on('data', c => d += c);
      req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
      req.on('error', reject);
    });
  } catch {}

  const { action, ids } = body;
  if (!action || !Array.isArray(ids)) return json(res, { error: 'action and ids required' }, 400);

  let fixed = 0;

  if (action === 'delete_orphaned_meta') {
    for (const id of ids) {
      try { deleteVideoMetaEverywhere(id); fixed++; } catch (e) { console.error('[health] delete meta', id, e.message); }
    }
    // Update in-memory results
    if (_scan) _scan.results = _scan.results.filter(r => !ids.includes(r.id) || r.type !== 'orphaned_meta');
  }

  if (action === 'delete_missing_files') {
    // Remove from index (invalidate cache) and clean up meta
    const { invalidateScanCache } = require('./videos-server');
    for (const id of ids) {
      try { deleteVideoMetaEverywhere(id); fixed++; } catch {}
    }
    try { invalidateScanCache(); } catch {}
    if (_scan) _scan.results = _scan.results.filter(r => !ids.includes(r.id) || r.type !== 'missing_file');
  }

  json(res, { ok: true, fixed });
}

module.exports = { apiHealthScan, apiHealthStatus, apiHealthResults, apiHealthFix };
