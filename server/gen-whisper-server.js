'use strict';
// ═══════════════════════════════════════════════════════════════════
//  gen-whisper-server.js — Whisper subtitle generation queue
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { VIDEOS_DIR, WHISPER_BIN } = require('./config-server');
const { json, safePath } = require('./helpers-server');
const { loadPrefs } = require('./db-server');

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.3gp', '.ogv', '.ts']);
const SUBTITLE_EXT = new Set(['.vtt', '.srt', '.ass', '.ssa', '.sub', '.smi']);

function toId(rel) { return Buffer.from(rel).toString('base64url'); }

function scanVideos(dir, base, isExternal = false) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'hidden' || e.name === 'Z') continue;
      out.push(...scanVideos(fp, base, isExternal));
    } else if (e.isFile() && VIDEO_EXT.has(path.extname(e.name).toLowerCase())) {
      const id = isExternal ? toId(fp) : toId(path.relative(base, fp));
      out.push({ fp, id });
    }
  }
  return out;
}

function scanAllVideos() {
  const all = scanVideos(VIDEOS_DIR, VIDEOS_DIR);
  try {
    const prefs = loadPrefs();
    if (Array.isArray(prefs.sourceFolders)) {
      for (const folder of prefs.sourceFolders) {
        if (fs.existsSync(folder)) all.push(...scanVideos(folder, folder, true));
      }
    }
  } catch {}
  return all;
}

function hasSubtitle(fp) {
  const dir = path.dirname(fp);
  const base = path.basename(fp, path.extname(fp));
  try {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isFile()) continue;
      const ext = path.extname(ent.name).toLowerCase();
      if (!SUBTITLE_EXT.has(ext)) continue;
      const nameNoExt = ent.name.slice(0, -ext.length);
      if (nameNoExt === base || nameNoExt.startsWith(base + '.')) return true;
    }
  } catch {}
  return false;
}

function runWhisper(fp, model, language) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(fp);
    const args = [fp, '--output_format', 'vtt', '--output_dir', dir, '--model', model || 'base'];
    if (language && language !== 'auto') args.push('--language', language);
    execFile(WHISPER_BIN, args, { timeout: 15 * 60 * 1000 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ── Global batch job state & SSE clients ─────────────────────────────

let _job = null;
const _clients = new Set();

function broadcast(ev) {
  const line = 'data: ' + JSON.stringify(ev) + '\n\n';
  for (const res of _clients) {
    try { res.write(line); } catch { _clients.delete(res); }
  }
}

// ── Batch runner ──────────────────────────────────────────────────────

async function runBatch() {
  const prefs = loadPrefs();
  const model = prefs.whisperModel || 'base';
  const language = prefs.whisperLanguage || 'auto';

  const all = scanAllVideos();
  const pending = all.filter(v => !hasSubtitle(v.fp));
  const skipped = all.length - pending.length;

  _job = { running: true, stop: false, total: pending.length, done: 0, failed: 0, skipped, current: '' };
  broadcast({ type: 'start', total: pending.length, skipped });

  if (!pending.length) {
    _job.running = false;
    broadcast({ type: 'done', done: 0, failed: 0, total: all.length, skipped });
    return;
  }

  for (const item of pending) {
    if (_job.stop) break;
    _job.current = path.basename(item.fp);
    broadcast({ type: 'progress', done: _job.done, total: _job.total, current: _job.current });
    try {
      await runWhisper(item.fp, model, language);
    } catch (e) {
      console.error('[whisper] Failed:', item.fp, e.message);
      _job.failed++;
    }
    _job.done++;
    broadcast({ type: 'progress', done: _job.done, total: _job.total, current: _job.current });
  }

  _job.running = false;
  broadcast({ type: 'done', done: _job.done, failed: _job.failed, total: all.length, skipped: _job.skipped });
}

// ── Single-video priority queue ───────────────────────────────────────

const _singleQueue = [];
let _singleRunning = false;

async function processSingleQueue() {
  if (_singleRunning) return;
  _singleRunning = true;
  while (_singleQueue.length) {
    const { fp } = _singleQueue.shift();
    if (hasSubtitle(fp)) continue;
    const prefs = loadPrefs();
    try {
      await runWhisper(fp, prefs.whisperModel || 'base', prefs.whisperLanguage || 'auto');
    } catch (e) {
      console.error('[whisper] Single-video failed:', fp, e.message);
    }
  }
  _singleRunning = false;
}

// ── API Handlers ──────────────────────────────────────────────────────

function apiGenWhisperStart(req, res) {
  const prefs = loadPrefs();
  if (!(prefs.whisperEnabled ?? true)) return json(res, { ok: false, error: 'Whisper disabled in settings' });
  if (_job && _job.running) return json(res, { ok: false, error: 'Already running' });
  runBatch().catch(console.error);
  json(res, { ok: true });
}

function apiGenWhisperStop(req, res) {
  if (_job) _job.stop = true;
  json(res, { ok: true });
}

function apiGenWhisperStatus(req, res) {
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

function apiGenWhisperPoll(req, res) {
  const prefs = loadPrefs();
  const enabled = prefs.whisperEnabled ?? true;
  if (_job) {
    json(res, { running: _job.running, done: _job.done, total: _job.total, failed: _job.failed, skipped: _job.skipped || 0, current: _job.current || '', enabled });
  } else {
    json(res, { running: false, enabled });
  }
}

async function apiWhisperEnqueue(req, res, id) {
  const prefs = loadPrefs();
  if (!(prefs.whisperEnabled ?? true)) return json(res, { ok: false, skipped: 'disabled' });
  const fp = safePath(id);
  if (!fp) return json(res, { ok: false, error: 'Not found' }, 404);
  if (hasSubtitle(fp)) return json(res, { ok: true, skipped: 'has_subtitle' });
  if (!_singleQueue.some(q => q.fp === fp)) {
    _singleQueue.unshift({ fp });
  }
  processSingleQueue().catch(console.error);
  json(res, { ok: true, queued: true });
}

module.exports = { apiGenWhisperStart, apiGenWhisperStop, apiGenWhisperStatus, apiGenWhisperPoll, apiWhisperEnqueue };
