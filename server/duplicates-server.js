'use strict';

const fs = require('fs');
const { execFile } = require('child_process');
const { THUMBS_DIR, FFMPEG_BIN, VIDEOS_DIR } = require('./config-server');
const { json, fromId } = require('./helpers-server');
const { loadVisualHashes, setVisualHash, saveVisualHashes, loadThumbsCache } = require('./db-server');
const path = require('path');

let _job = null;
const _clients = new Set();

function broadcast(ev) {
  const line = 'data: ' + JSON.stringify(ev) + '\n\n';
  for (const res of _clients) {
    try { res.write(line); } catch { _clients.delete(res); }
  }
}

async function getVisualHash(videoId) {
  const thumbPath = path.join(THUMBS_DIR, videoId, '2.jpg');
  if (!fs.existsSync(thumbPath)) return null;

  return new Promise(resolve => {
    execFile(FFMPEG_BIN, ['-i', thumbPath, '-vf', 'scale=8:8,format=gray', '-f', 'rawvideo', '-'],
      { encoding: 'buffer', timeout: 5000 }, (err, stdout) => {
        if (err || !stdout || stdout.length !== 64) return resolve(null);
        resolve(stdout.toString('hex'));
      });
  });
}

function calculateSimilarity(h1, h2) {
  if (h1 === h2) return 1.0;
  if (!h1 || !h2 || h1.length !== h2.length) return 0;

  let diff = 0;
  for (let i = 0; i < h1.length; i += 2) {
    const v1 = parseInt(h1.substr(i, 2), 16);
    const v2 = parseInt(h2.substr(i, 2), 16);
    diff += Math.abs(v1 - v2);
  }
  return 1 - (diff / (255 * 32 * 2));
}

async function runScan(allVideos) {
  _job = { running: true, stop: false, total: allVideos.length, done: 0, groups: [] };
  broadcast({ type: 'start', total: allVideos.length });

  const hashes = loadVisualHashes();
  const activeIds = new Set(allVideos.map(v => v.id));

  const list = [];
  for (const v of allVideos) {
    if (_job.stop) break;

    // Skip files that no longer exist on disk (stale scan cache)
    const rel = fromId(v.id);
    const fp = path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(VIDEOS_DIR, rel);
    if (!fs.existsSync(fp)) {
      delete hashes[v.id];
      _job.done++;
      if (_job.done % 20 === 0) broadcast({ type: 'progress', done: _job.done, total: _job.total });
      continue;
    }

    let hash = hashes[v.id];
    if (!hash) {
      hash = await getVisualHash(v.id);
      if (hash) {
        hashes[v.id] = hash;
        setVisualHash(v.id, hash);
      }
    }
    if (hash) list.push({ ...v, hash });
    _job.done++;
    if (_job.done % 20 === 0) broadcast({ type: 'progress', done: _job.done, total: _job.total });
  }

  // Prune hashes for IDs no longer in the video library
  for (const id of Object.keys(hashes)) {
    if (!activeIds.has(id)) delete hashes[id];
  }
  saveVisualHashes(hashes);

  if (_job.stop) {
    _job.running = false;
    broadcast({ type: 'done', groups: [] });
    return;
  }

  // Grouping
  const groups = [];
  const used = new Set();

  for (let i = 0; i < list.length; i++) {
    if (used.has(list[i].id)) continue;
    const group = [list[i]];
    for (let j = i + 1; j < list.length; j++) {
      if (used.has(list[j].id)) continue;
      
      const sim = calculateSimilarity(list[i].hash, list[j].hash);
      const nameSim = list[i].name.toLowerCase() === list[j].name.toLowerCase();
      const sizeSim = Math.abs(list[i].size - list[j].size) < 1024 * 1024; // 1MB diff
      
      // Heuristic: very high visual similarity, or high similarity + name/size match
      if (sim > 0.97 || (sim > 0.90 && (nameSim || sizeSim))) {
        group.push(list[j]);
        used.add(list[j].id);
      }
    }
    if (group.length > 1) {
      groups.push(group);
      used.add(list[i].id);
    }
  }

  _job.groups = groups;
  _job.running = false;
  broadcast({ type: 'done', groups });
}

function apiDuplicatesScan(req, res, allVideos) {
  if (_job && _job.running) return json(res, { error: 'Already running' }, 400);
  runScan(allVideos).catch(console.error);
  json(res, { ok: true });
}

function apiDuplicatesStatus(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  _clients.add(res);
  if (_job) res.write('data: ' + JSON.stringify({ type: 'progress', done: _job.done, total: _job.total, running: _job.running }) + '\n\n');
  req.on('close', () => _clients.delete(res));
}

function apiDuplicatesResults(req, res) {
  if (!_job) return json(res, []);
  const thumbs = loadThumbsCache();
  const enriched = _job.groups.map(g =>
    g.map(v => {
      const th = thumbs[v.id] || {};
      return { ...v, width: th.width || null, height: th.height || null };
    })
  );
  json(res, enriched);
}

function apiDuplicatesStop(req, res) {
  if (_job) _job.stop = true;
  json(res, { ok: true });
}

module.exports = { apiDuplicatesScan, apiDuplicatesStop, apiDuplicatesStatus, apiDuplicatesResults };
