'use strict';
// ═══════════════════════════════════════════════════════════════════
//  reencode-server.js — batch H.265/HEVC re-encoding with SSE progress
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { FFMPEG_BIN, FFPROBE_BIN, VIDEOS_DIR } = require('./config-server');
const { json, readBody, fromId } = require('./helpers-server');
const { setVideoMetaFields, loadVideoMeta, loadPrefs, loadVideoIndex } = require('./db-server');
const { detectHevcEncoder, CPU_HEVC } = require('./hwaccel-server');

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.3gp', '.ts']);

// ── Global job state & SSE clients ──────────────────────────────────

let _job = null; // { running, stop, total, done, failed, skipped, current, savedBytes }
const _clients = new Set();
// The ffmpeg child currently transcoding (so Stop can kill it instead of waiting
// up to 3 hours for the current file to finish).
let _currentChild = null;

function broadcast(ev) {
  const line = 'data: ' + JSON.stringify(ev) + '\n\n';
  for (const res of _clients) {
    try { res.write(line); } catch { _clients.delete(res); }
  }
}

// ── Path resolution ─────────────────────────────────────────────────

function resolveFilePath(id) {
  const rel = fromId(id);
  return path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(VIDEOS_DIR, rel);
}

// ── Candidate collection ────────────────────────────────────────────

function buildCandidates(ids, category) {
  const meta  = loadVideoMeta();
  const index = loadVideoIndex() || [];

  if (ids && ids.length > 0) {
    return ids
      .map(id => ({ id, fp: resolveFilePath(id) }))
      .filter(v => fs.existsSync(v.fp) && !v.fp.endsWith('.enc'));
  }

  return index
    .filter(v => {
      if (v.encrypted) return false;
      const vMeta = meta[v.id] || {};
      if (vMeta.reencoded) return false;
      const ext = (v.ext || '').toLowerCase();
      if (!VIDEO_EXT.has(ext)) return false;
      if (category && v.cat_path !== category) return false;
      return true;
    })
    .map(v => ({ id: v.id, fp: resolveFilePath(v.id) }))
    .filter(v => fs.existsSync(v.fp));
}

// ── ffprobe helper ──────────────────────────────────────────────────

function probeVideo(fp) {
  return new Promise(resolve => {
    execFile(FFPROBE_BIN,
      ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', fp],
      { timeout: 15000 },
      (err, out) => {
        if (err) return resolve(null);
        try {
          const data = JSON.parse(out);
          const videoStream = (data.streams || []).find(s => s.codec_type === 'video');
          const codec = videoStream ? videoStream.codec_name : null;
          const duration = parseFloat(data.format?.duration) || null;
          resolve({ codec, duration });
        } catch { resolve(null); }
      });
  });
}

// ── Batch runner ─────────────────────────────────────────────────────

async function runBatch(ids, category) {
  const queue = buildCandidates(ids, category);
  // Files already in H.265 are detected by the per-file probe below and
  // counted as skipped; "all" mode is pre-filtered by the reencoded DB flag.
  const alreadyEncoded = 0;

  // Pick a hardware HEVC encoder (NVENC/QSV/AMF/VAAPI/VideoToolbox) once for
  // the whole batch so jobs aren't CPU-bound; falls back to libx265. Users can
  // force the CPU path (better compression) via the `reencodeHwAccel` pref.
  let enc = CPU_HEVC;
  try {
    const hwDisabled = loadPrefs().reencodeHwAccel === false;
    enc = hwDisabled ? CPU_HEVC : await detectHevcEncoder();
  } catch (e) {
    console.error('[reencode] encoder detection failed, using CPU:', e.message);
  }

  _job = {
    running: true, stop: false,
    total: queue.length, done: 0, failed: 0, skipped: alreadyEncoded,
    current: '', savedBytes: 0, encoder: enc.name,
  };
  console.log(`[Sync] Re-encode H.265: ${queue.length} pending, ${alreadyEncoded} already encoded, encoder=${enc.name}`);
  broadcast({ type: 'start', total: queue.length, skipped: alreadyEncoded, encoder: enc.name });

  if (!queue.length) {
    _job.running = false;
    console.log('[Sync] Re-encode H.265: nothing to do');
    broadcast({ type: 'done', done: 0, failed: 0, skipped: alreadyEncoded, savedBytes: 0 });
    return;
  }

  for (const item of queue) {
    if (_job.stop) break;

    _job.current = path.basename(item.fp);
    broadcast({ type: 'progress', done: _job.done, total: _job.total, current: _job.current, savedBytes: _job.savedBytes });

    const ext  = path.extname(item.fp).toLowerCase();
    const tmpFp = item.fp + '.reencode.tmp' + ext;

    try {
      const probe = await probeVideo(item.fp);
      if (!probe || !probe.duration) {
        _job.failed++;
        _job.done++;
        broadcast({ type: 'progress', done: _job.done, total: _job.total, current: _job.current, savedBytes: _job.savedBytes });
        continue;
      }

      // Already H.265 — mark in DB and skip transcoding
      if (probe.codec === 'hevc' || probe.codec === 'h265') {
        setVideoMetaFields(item.id, { reencoded: 1 });
        _job.skipped++;
        _job.done++;
        broadcast({ type: 'progress', done: _job.done, total: _job.total, current: _job.current, savedBytes: _job.savedBytes });
        continue;
      }

      const origSize = fs.statSync(item.fp).size;

      // Build ffmpeg args depending on container
      const isMp4 = ext === '.mp4' || ext === '.m4v';
      const ffArgs = [
        ...enc.inputArgs,
        '-i', item.fp,
        ...enc.codecArgs,
        '-c:a', 'copy',
        '-c:s', 'copy',
        ...(isMp4 ? ['-tag:v', 'hvc1', '-movflags', '+faststart'] : []),
        '-y',
        tmpFp,
      ];

      const ok = await new Promise(resolve => {
        const child = execFile(FFMPEG_BIN, ffArgs, { timeout: 3 * 60 * 60 * 1000 }, err => {
          if (_currentChild === child) _currentChild = null;
          resolve(!err);
        });
        _currentChild = child;
      });

      // User pressed Stop → the child was killed; clean up the partial temp file
      // and exit the loop without counting it as a failure.
      if (_job.stop) {
        try { fs.unlinkSync(tmpFp); } catch {}
        break;
      }

      if (!ok || !fs.existsSync(tmpFp)) {
        try { fs.unlinkSync(tmpFp); } catch {}
        _job.failed++;
      } else {
        const newSize = fs.statSync(tmpFp).size;
        const saved = origSize - newSize;
        // Hardware encoders (and x265 on already-efficient sources) can produce
        // a *larger* file — keep the original in that case. Either way mark it
        // reencoded so "all" mode doesn't retry it every run.
        if (saved > 0) {
          fs.renameSync(tmpFp, item.fp);
          _job.savedBytes += saved;
        } else {
          try { fs.unlinkSync(tmpFp); } catch {}
          _job.skipped++;
        }
        setVideoMetaFields(item.id, { reencoded: 1 });
      }
    } catch (e) {
      console.error('[reencode] error on', item.fp, e.message);
      try { fs.unlinkSync(tmpFp); } catch {}
      _job.failed++;
    }

    _job.done++;
    broadcast({ type: 'progress', done: _job.done, total: _job.total, current: _job.current, savedBytes: _job.savedBytes });
  }

  _job.running = false;
  console.log(`[Sync] Re-encode H.265 done: ${_job.done} processed, ${_job.failed} failed`);
  broadcast({ type: 'done', done: _job.done, failed: _job.failed, total: _job.total, skipped: _job.skipped, savedBytes: _job.savedBytes });
}

// ── API handlers ─────────────────────────────────────────────────────

async function apiReencodeStart(req, res) {
  if (_job && _job.running) return json(res, { ok: false, error: 'Already running' });
  console.log('[Sync] Starting Re-encode to H.265');
  const body = await readBody(req);
  const ids      = Array.isArray(body.ids) ? body.ids : null;
  const category = body.category || null;
  runBatch(ids, category).catch(console.error);
  json(res, { ok: true });
}

function apiReencodeStop(req, res) {
  if (_job) {
    _job.stop = true;
    console.log('[Sync] Stopping Re-encode to H.265');
  }
  if (_currentChild) {
    try { _currentChild.kill('SIGKILL'); } catch {}
    _currentChild = null;
  }
  json(res, { ok: true });
}

function apiReencodeStatus(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('\n');
  _clients.add(res);

  if (_job) {
    const ev = _job.running
      ? { type: 'progress', done: _job.done, total: _job.total, current: _job.current, savedBytes: _job.savedBytes }
      : { type: 'done', done: _job.done, failed: _job.failed, total: _job.total, skipped: _job.skipped, savedBytes: _job.savedBytes };
    res.write('data: ' + JSON.stringify(ev) + '\n\n');
  } else {
    res.write('data: ' + JSON.stringify({ type: 'idle' }) + '\n\n');
  }

  req.on('close', () => _clients.delete(res));
}

function apiReencodePoll(req, res) {
  if (_job) {
    json(res, {
      running: _job.running,
      done: _job.done,
      total: _job.total,
      failed: _job.failed,
      skipped: _job.skipped || 0,
      current: _job.current || '',
      savedBytes: _job.savedBytes || 0,
      encoder: _job.encoder || '',
    });
  } else {
    json(res, { running: false });
  }
}

module.exports = { apiReencodeStart, apiReencodeStop, apiReencodeStatus, apiReencodePoll };
