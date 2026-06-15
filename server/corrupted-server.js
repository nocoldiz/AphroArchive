'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { FFPROBE_BIN, VIDEOS_DIR, VAULT_DIR } = require('./config-server');
const { json, fromId } = require('./helpers-server');

// ── Video scan ────────────────────────────────────────────────────────

let _job = null;
const _clients = new Set();

function broadcast(ev) {
  const line = 'data: ' + JSON.stringify(ev) + '\n\n';
  for (const res of _clients) {
    try { res.write(line); } catch { _clients.delete(res); }
  }
}

function probeVideo(filePath) {
  return new Promise(resolve => {
    execFile(FFPROBE_BIN, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_type:format=duration',
      '-of', 'json',
      filePath,
    ], { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, error: stderr?.trim() || err.message || 'ffprobe failed' });
      try {
        const data = JSON.parse(stdout);
        const streams = data.streams || [];
        const hasVideo = streams.length > 0;
        const duration = parseFloat((data.format || {}).duration || '0');
        if (!hasVideo) return resolve({ ok: false, error: 'No video stream found' });
        if (!duration || duration <= 0) return resolve({ ok: false, error: 'Zero or unknown duration' });
        resolve({ ok: true });
      } catch {
        resolve({ ok: false, error: 'Could not parse ffprobe output' });
      }
    });
  });
}

async function runScan(allVideos) {
  _job = { running: true, stop: false, total: allVideos.length, done: 0, results: [] };
  broadcast({ type: 'start', total: allVideos.length });

  for (const v of allVideos) {
    if (_job.stop) break;

    const rel = fromId(v.id);
    const fp = path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(VIDEOS_DIR, rel);

    if (!fs.existsSync(fp)) {
      _job.results.push({ id: v.id, name: v.name, category: v.category, size: v.size, error: 'File not found on disk' });
    } else {
      const probe = await probeVideo(fp);
      if (!probe.ok) {
        _job.results.push({ id: v.id, name: v.name, category: v.category, size: v.size, error: probe.error });
      }
    }

    _job.done++;
    if (_job.done % 10 === 0 || _job.done === _job.total) {
      broadcast({ type: 'progress', done: _job.done, total: _job.total });
    }
  }

  _job.running = false;
  broadcast({ type: 'done', results: _job.results });
}

function apiCorruptedScan(req, res, allVideos) {
  if (_job && _job.running) return json(res, { error: 'Already running' }, 400);
  runScan(allVideos).catch(console.error);
  json(res, { ok: true });
}

function apiCorruptedStatus(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  _clients.add(res);
  if (_job) {
    const ev = _job.running
      ? { type: 'progress', done: _job.done, total: _job.total }
      : { type: 'done', results: _job.results };
    res.write('data: ' + JSON.stringify(ev) + '\n\n');
  }
  req.on('close', () => _clients.delete(res));
}

function apiCorruptedResults(req, res) {
  json(res, _job ? _job.results : []);
}

function apiCorruptedStop(req, res) {
  if (_job) _job.stop = true;
  json(res, { ok: true });
}

// ── Vault scan ────────────────────────────────────────────────────────

let _vaultJob = null;
const _vaultClients = new Set();

function broadcastVault(ev) {
  const line = 'data: ' + JSON.stringify(ev) + '\n\n';
  for (const res of _vaultClients) {
    try { res.write(line); } catch { _vaultClients.delete(res); }
  }
}

// Files ≤ this size get a full AES-GCM auth-tag check; larger files only get
// a size + meta check (AES-GCM requires full ciphertext read to verify).
const FULL_VERIFY_LIMIT = 100 * 1024 * 1024; // 100 MB

function checkVaultFile(id, key) {
  return new Promise(resolve => {
    const encPath = path.join(VAULT_DIR, id + '.enc');
    let stat;
    try { stat = fs.statSync(encPath); } catch (e) {
      return resolve({ ok: false, error: 'File missing from disk' });
    }
    const total = stat.size;
    if (total < 28) {
      return resolve({ ok: false, error: 'File too small — header is corrupted' });
    }
    if (total > FULL_VERIFY_LIMIT) {
      // Can't fully verify large files without reading everything; report as unchecked.
      return resolve({ ok: true, skipped: true });
    }

    let fd;
    try {
      fd = fs.openSync(encPath, 'r');
      const iv = Buffer.alloc(12);
      const tag = Buffer.alloc(16);
      fs.readSync(fd, iv, 0, 12, 0);
      fs.readSync(fd, tag, 0, 16, total - 16);
      fs.closeSync(fd);
      fd = null;

      const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
      dec.setAuthTag(tag);

      const src = fs.createReadStream(encPath, { start: 12, end: total - 17 });
      src.pipe(dec);
      dec.on('data', () => {});
      dec.on('finish', () => resolve({ ok: true }));
      dec.on('error', () => resolve({ ok: false, error: 'Decryption failed — wrong key or corrupted data' }));
      src.on('error', e => resolve({ ok: false, error: 'Cannot read file: ' + e.message }));
    } catch (e) {
      if (fd != null) try { fs.closeSync(fd); } catch {}
      resolve({ ok: false, error: e.message });
    }
  });
}

async function runVaultScan(key, meta) {
  let encFiles;
  try {
    encFiles = fs.readdirSync(VAULT_DIR).filter(f => f.endsWith('.enc'));
  } catch (e) {
    broadcastVault({ type: 'done', results: [] });
    return;
  }

  _vaultJob = { running: true, stop: false, total: encFiles.length, done: 0, results: [], skipped: 0 };
  broadcastVault({ type: 'start', total: encFiles.length });

  for (const fname of encFiles) {
    if (_vaultJob.stop) break;

    const id = fname.slice(0, -4); // strip .enc
    const entry = meta[id];

    if (!entry || entry.type === 'folder') {
      // Orphaned .enc file — no meta entry
      _vaultJob.results.push({ id, name: fname, error: 'No metadata — orphaned file' });
      _vaultJob.done++;
      broadcastVault({ type: 'progress', done: _vaultJob.done, total: _vaultJob.total });
      continue;
    }

    const result = await checkVaultFile(id, key);
    if (result.skipped) {
      _vaultJob.skipped++;
    } else if (!result.ok) {
      _vaultJob.results.push({
        id,
        name: entry.originalName || entry.name || fname,
        folder: entry.folder || null,
        size: entry.size || 0,
        error: result.error,
      });
    }

    _vaultJob.done++;
    if (_vaultJob.done % 5 === 0 || _vaultJob.done === _vaultJob.total) {
      broadcastVault({ type: 'progress', done: _vaultJob.done, total: _vaultJob.total });
    }
  }

  _vaultJob.running = false;
  broadcastVault({ type: 'done', results: _vaultJob.results, skipped: _vaultJob.skipped });
}

function apiCorruptedVaultScan(req, res, key, meta) {
  if (_vaultJob && _vaultJob.running) return json(res, { error: 'Already running' }, 400);
  runVaultScan(key, meta).catch(console.error);
  json(res, { ok: true });
}

function apiCorruptedVaultStatus(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  _vaultClients.add(res);
  if (_vaultJob) {
    const ev = _vaultJob.running
      ? { type: 'progress', done: _vaultJob.done, total: _vaultJob.total }
      : { type: 'done', results: _vaultJob.results, skipped: _vaultJob.skipped };
    res.write('data: ' + JSON.stringify(ev) + '\n\n');
  }
  req.on('close', () => _vaultClients.delete(res));
}

function apiCorruptedVaultResults(req, res) {
  json(res, _vaultJob ? { results: _vaultJob.results, skipped: _vaultJob.skipped } : { results: [], skipped: 0 });
}

function apiCorruptedVaultStop(req, res) {
  if (_vaultJob) _vaultJob.stop = true;
  json(res, { ok: true });
}

module.exports = {
  apiCorruptedScan, apiCorruptedStop, apiCorruptedStatus, apiCorruptedResults,
  apiCorruptedVaultScan, apiCorruptedVaultStop, apiCorruptedVaultStatus, apiCorruptedVaultResults,
};
