'use strict';
// ═══════════════════════════════════════════════════════════════════
//  hls-server.js — On-the-fly HLS transcoding via ffmpeg
//  GET /api/hls/:id/index.m3u8  → virtual playlist (per-segment approach)
//  GET /api/hls/:id/seg:N.ts    → ffmpeg transcodes that 10-second window
// ═══════════════════════════════════════════════════════════════════

const { execFile, spawn } = require('child_process');
const { FFMPEG_BIN, FFPROBE_BIN } = require('./config-server');
const { safePath } = require('./helpers-server');
const { loadThumbsCache } = require('./db-server');

const SEG_DUR = 10; // seconds per segment

// In-memory duration cache (cleared on server restart)
const _durCache = new Map();

function _getDuration(id, filePath) {
  return new Promise(resolve => {
    // thumbs_cache stores duration after first thumbnail generation
    try {
      const cache = loadThumbsCache();
      if (cache[id] && cache[id].duration) return resolve(cache[id].duration);
    } catch {}
    if (_durCache.has(id)) return resolve(_durCache.get(id));
    execFile(FFPROBE_BIN, [
      '-v', 'quiet', '-print_format', 'json', '-show_format', filePath
    ], { timeout: 15000 }, (err, out) => {
      if (err) return resolve(null);
      try {
        const dur = parseFloat(JSON.parse(out).format?.duration) || null;
        if (dur) _durCache.set(id, dur);
        resolve(dur);
      } catch { resolve(null); }
    });
  });
}

async function apiHlsPlaylist(req, res, id) {
  const filePath = safePath(id);
  if (!filePath) { res.writeHead(404); res.end('Not found'); return; }

  const duration = await _getDuration(id, filePath);
  if (!duration) { res.writeHead(500); res.end('Could not determine video duration'); return; }

  const qs = new URL(req.url, 'http://localhost').searchParams;
  const audio = qs.get('audio');
  const audioSuffix = audio ? `?audio=${encodeURIComponent(audio)}` : '';

  const segCount = Math.ceil(duration / SEG_DUR);
  let m3u8 = '#EXTM3U\n#EXT-X-VERSION:3\n';
  m3u8 += `#EXT-X-TARGETDURATION:${SEG_DUR}\n#EXT-X-MEDIA-SEQUENCE:0\n`;
  for (let i = 0; i < segCount; i++) {
    const segDur = i === segCount - 1 ? duration - i * SEG_DUR : SEG_DUR;
    m3u8 += `#EXTINF:${segDur.toFixed(3)},\n`;
    m3u8 += `/api/hls/${encodeURIComponent(id)}/seg${String(i).padStart(5, '0')}.ts${audioSuffix}\n`;
  }
  m3u8 += '#EXT-X-ENDLIST\n';

  res.writeHead(200, {
    'Content-Type': 'application/vnd.apple.mpegurl',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(m3u8);
}

// Global cap: at most 3 concurrent ffmpeg segment transcodes (mirrors the
// thumbnail semaphore). hls.js prefetches segments aggressively; without a
// cap every prefetch spawns its own ffmpeg, saturating the CPU while all six
// browser connections sit occupied waiting on transcodes.
const MAX_CONCURRENT_SEGS = 3;
let _activeSegs = 0;
const _segWaiters = [];

function _acquireSegSlot() {
  if (_activeSegs < MAX_CONCURRENT_SEGS) {
    _activeSegs++;
    return Promise.resolve();
  }
  return new Promise(r => _segWaiters.push(r));
}

function _releaseSegSlot() {
  _activeSegs--;
  if (_segWaiters.length) {
    _activeSegs++;
    _segWaiters.shift()();
  }
}

async function apiHlsSegment(req, res, id, seg) {
  const filePath = safePath(id);
  if (!filePath) { res.writeHead(404); res.end(); return; }

  const n = parseInt(seg.replace(/\D/g, ''), 10);
  if (isNaN(n) || n < 0) { res.writeHead(400); res.end('Bad segment index'); return; }

  const startTime = n * SEG_DUR;

  const audioTrack = parseInt(new URL(req.url, 'http://localhost').searchParams.get('audio') || '0', 10);
  const mapArgs = audioTrack > 0
    ? ['-map', '0:v:0', '-map', `0:a:${audioTrack}`]
    : [];

  await _acquireSegSlot();
  // Client may have given up while queued (seek away) — don't transcode.
  if (res.writableEnded || res.destroyed) { _releaseSegSlot(); return; }

  const proc = spawn(FFMPEG_BIN, [
    '-ss', String(startTime),
    '-i', filePath,
    '-t', String(SEG_DUR),
    ...mapArgs,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', 'frag_keyframe',
    '-f', 'mpegts',
    'pipe:1'
  ], { stdio: ['ignore', 'pipe', 'ignore'] });

  res.writeHead(200, {
    'Content-Type': 'video/MP2T',
    'Cache-Control': 'public, max-age=3600'
  });

  let released = false;
  const release = () => { if (!released) { released = true; _releaseSegSlot(); } };

  proc.stdout.pipe(res);
  res.on('close', () => { release(); try { proc.kill('SIGTERM'); } catch {} });
  proc.on('error', () => { release(); try { res.end(); } catch {} });
  proc.on('exit', (code) => {
    release();
    // Non-zero exit after headers — end the (possibly truncated) response so
    // the client can retry the segment instead of waiting on a dead pipe.
    if (code !== 0) { try { res.end(); } catch {} }
  });
}

module.exports = { apiHlsPlaylist, apiHlsSegment };
