'use strict';
// ═══════════════════════════════════════════════════════════════════
//  gen-whisper-server.js — Whisper subtitle generation queue
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { VIDEOS_DIR, WHISPER_BIN, WHISPER_MODELS_DIR } = require('./config-server');
const { json, safePath } = require('./helpers-server');
const { loadPrefs, setVideoMetaFields } = require('./db-server');

try { fs.mkdirSync(WHISPER_MODELS_DIR, { recursive: true }); } catch {}

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.3gp', '.ogv', '.ts']);
const SUBTITLE_EXT = new Set(['.vtt', '.srt', '.ass', '.ssa', '.sub', '.smi']);

// Common language names whisper outputs → 2-letter codes
const LANG_NAME_TO_CODE = {
  afrikaans: 'af', albanian: 'sq', amharic: 'am', arabic: 'ar', armenian: 'hy',
  azerbaijani: 'az', basque: 'eu', belarusian: 'be', bengali: 'bn', bosnian: 'bs',
  bulgarian: 'bg', catalan: 'ca', chinese: 'zh', croatian: 'hr', czech: 'cs',
  danish: 'da', dutch: 'nl', english: 'en', estonian: 'et', finnish: 'fi',
  french: 'fr', galician: 'gl', georgian: 'ka', german: 'de', greek: 'el',
  gujarati: 'gu', haitian: 'ht', hausa: 'ha', hebrew: 'he', hindi: 'hi',
  hungarian: 'hu', icelandic: 'is', indonesian: 'id', italian: 'it', japanese: 'ja',
  kannada: 'kn', kazakh: 'kk', korean: 'ko', latvian: 'lv', lithuanian: 'lt',
  macedonian: 'mk', malay: 'ms', maltese: 'mt', marathi: 'mr', nepali: 'ne',
  norwegian: 'no', pashto: 'ps', persian: 'fa', polish: 'pl', portuguese: 'pt',
  punjabi: 'pa', romanian: 'ro', russian: 'ru', serbian: 'sr', sinhala: 'si',
  slovak: 'sk', slovenian: 'sl', somali: 'so', spanish: 'es', swahili: 'sw',
  swedish: 'sv', tagalog: 'tl', tamil: 'ta', telugu: 'te', thai: 'th',
  turkish: 'tr', ukrainian: 'uk', urdu: 'ur', uzbek: 'uz', vietnamese: 'vi',
  welsh: 'cy', yoruba: 'yo',
};

function toId(rel) { return Buffer.from(rel).toString('base64url'); }

function fpToId(fp) {
  const resolved = path.resolve(fp);
  const videosResolved = path.resolve(VIDEOS_DIR);
  if (resolved.startsWith(videosResolved + path.sep) || resolved === videosResolved) {
    return toId(path.relative(VIDEOS_DIR, fp).replace(/\\/g, '/'));
  }
  return toId(fp);
}

function parseDetectedLanguage(output) {
  // Whisper outputs: "Detected language 'english' with probability..." or "Detected language: english"
  const m = output.match(/Detected language[':]\s*'?(\w+)/i);
  if (!m) return null;
  const name = m[1].toLowerCase();
  return LANG_NAME_TO_CODE[name] || name;
}

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

// The whisper child process currently running for the batch job (so it can be killed on stop)
let _currentChild = null;

// Returns detected language string or null
function runWhisper(fp, model, language, track = false) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(fp);
    const args = [fp, '--output_format', 'vtt', '--output_dir', dir, '--model', model || 'base', '--model_dir', WHISPER_MODELS_DIR];
    if (language && language !== 'auto') args.push('--language', language);
    const child = execFile(WHISPER_BIN, args, { timeout: 15 * 60 * 1000 }, (err, stdout, stderr) => {
      if (track && _currentChild === child) _currentChild = null;
      if (err) { err.stderr = stderr; reject(err); return; }
      const combined = (stdout || '') + (stderr || '');
      resolve(parseDetectedLanguage(combined));
    });
    if (track) _currentChild = child;
  });
}

// Build a human-readable error message from a failed whisper run
function whisperErrorMessage(e, model) {
  if (e && e.code === 'ENOENT') return 'Whisper is not installed (the "whisper" command was not found). Run: pip install openai-whisper';
  const text = ((e && e.stderr) || '') + '\n' + ((e && e.message) || '');
  if (/No module named ['"]?whisper/i.test(text)) return 'Whisper Python module is not installed. Run: pip install openai-whisper';
  if (/is not a valid model|model .* not found|invalid choice|No such file or directory.*\.pt|Error downloading.*model/i.test(text)) {
    return `Whisper model "${model}" not found or could not be downloaded`;
  }
  if (/CUDA|out of memory|RuntimeError/i.test(text)) {
    const line = text.split('\n').map(s => s.trim()).filter(Boolean).pop();
    return line || 'Whisper failed (runtime error)';
  }
  const line = ((e && e.stderr) || '').split('\n').map(s => s.trim()).filter(Boolean).pop();
  return line || (e && e.message) || 'Whisper failed';
}

// Errors that will recur for every video — abort the whole batch instead of churning through the queue
function isFatalWhisperError(e) {
  if (e && e.code === 'ENOENT') return true;
  const text = ((e && e.stderr) || '') + '\n' + ((e && e.message) || '');
  return /No module named ['"]?whisper/i.test(text) || /is not a valid model|invalid choice|Error downloading.*model/i.test(text);
}

function saveDetectedLanguage(fp, detectedLang) {
  if (!detectedLang) return;
  try {
    const id = fpToId(fp);
    setVideoMetaFields(id, { language: detectedLang });
  } catch (e) {
    console.error('[whisper] Failed to save language for', fp, e.message);
  }
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
  console.log(`[whisper] Batch started — ${pending.length} videos to transcribe (${skipped} already have subtitles), model: ${model}`);
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
      const detectedLang = await runWhisper(item.fp, model, language, true);
      // Only save language if we ran in auto-detect mode
      if (!language || language === 'auto') saveDetectedLanguage(item.fp, detectedLang);
    } catch (e) {
      // User pressed Stop → the child was killed; exit quietly without counting a failure
      if (_job.stop) break;
      const msg = whisperErrorMessage(e, model);
      console.error('[whisper] Failed:', item.fp, msg);
      _job.failed++;
      if (isFatalWhisperError(e)) {
        // Every video would fail the same way — abort and surface the error
        _job.running = false;
        _job.error = msg;
        broadcast({ type: 'error', error: msg, fatal: true, done: _job.done, total: _job.total, failed: _job.failed });
        return;
      }
      broadcast({ type: 'error', error: `${msg} (${_job.current})`, fatal: false, done: _job.done, total: _job.total, failed: _job.failed });
    }
    _job.done++;
    if (_job.done === 1 || _job.done % 5 === 0) console.log(`[whisper] ${_job.done}/${_job.total} — ${_job.current}`);
    broadcast({ type: 'progress', done: _job.done, total: _job.total, current: _job.current });
  }

  _job.running = false;
  if (_job.stop) {
    console.log(`[whisper] Batch stopped — ${_job.done} done, ${_job.failed} failed`);
  } else {
    console.log(`[whisper] Batch done — ${_job.done} transcribed, ${_job.failed} failed`);
  }
  broadcast({ type: _job.stop ? 'stopped' : 'done', done: _job.done, failed: _job.failed, total: all.length, skipped: _job.skipped });
}

// ── Single-video priority queue ───────────────────────────────────────

const _singleQueue = [];

// ── Model download ────────────────────────────────────────────────────

// model -> { model, progress: 0-100, status: 'downloading'|'done'|'error', error }
const _modelDownloads = new Map();
const VALID_MODELS = new Set(['tiny', 'base', 'small', 'medium', 'large', 'turbo']);

// Check if a model is already present in WHISPER_MODELS_DIR.
// Handles both openai-whisper (.pt files) and faster-whisper (subdirectories).
function isModelDownloaded(model) {
  try {
    const entries = fs.readdirSync(WHISPER_MODELS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      const lower = entry.name.toLowerCase();
      if (entry.isFile() && lower.endsWith('.pt')) {
        const nameNoExt = lower.slice(0, -3);
        if (nameNoExt === model) return true;
        if (model === 'turbo' && lower.includes('turbo')) return true;
        if (model === 'large' && lower.startsWith('large') && !lower.includes('turbo')) return true;
      } else if (entry.isDirectory()) {
        if (lower.includes(model)) return true;
        if (model === 'large' && lower.includes('large') && !lower.includes('turbo')) return true;
      }
    }
  } catch {}
  return false;
}

function _lastLine(s) {
  return (s || '').split('\n').map(l => l.trim()).filter(Boolean).pop() || '';
}

// Download a Whisper model into WHISPER_MODELS_DIR via Python, streaming tqdm progress.
// Resolves when the model is ready; rejects with a descriptive error otherwise.
function downloadModel(model) {
  return new Promise((resolve, reject) => {
    try { fs.mkdirSync(WHISPER_MODELS_DIR, { recursive: true }); } catch {}
    // Python downloads regardless of whether the `whisper` command is on PATH.
    const pythonCmds = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
    const script = 'import sys, whisper; whisper.load_model(sys.argv[1], download_root=sys.argv[2])';
    const rec = _modelDownloads.get(model);

    function tryNext(i) {
      if (i >= pythonCmds.length) {
        reject(new Error('Python was not found. Install Python 3.8+ and "pip install openai-whisper".'));
        return;
      }
      let stderr = '';
      let started = false; // true once whisper has loaded and reported any download progress
      let settled = false;
      const child = spawn(pythonCmds[i], ['-c', script, model, WHISPER_MODELS_DIR]);

      child.on('error', (e) => {
        if (settled) return;
        // This python command does not exist → try the next candidate.
        if (e.code === 'ENOENT' && i + 1 < pythonCmds.length) { tryNext(i + 1); settled = true; return; }
        settled = true;
        reject(e);
      });

      child.stderr.on('data', (d) => {
        const s = d.toString();
        stderr += s;
        // tqdm renders e.g. " 45%|████ | 62.0M/139M [00:03<00:04, 18.4MiB/s]"
        const matches = s.match(/(\d{1,3})%/g);
        if (matches && matches.length) {
          started = true;
          const pct = parseInt(matches[matches.length - 1], 10);
          if (!isNaN(pct) && rec) rec.progress = Math.max(rec.progress, Math.min(99, pct));
        }
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        if (code === 0) { if (rec) rec.progress = 100; resolve(); return; }
        if (/No module named ['"]?whisper/i.test(stderr)) {
          reject(new Error('Whisper Python module is not installed. Run: pip install openai-whisper'));
          return;
        }
        // If this interpreter actually started downloading, a non-zero exit is a real failure — don't retry.
        if (!started && i + 1 < pythonCmds.length) { tryNext(i + 1); return; }
        reject(new Error(_lastLine(stderr) || `Model download failed (exit code ${code})`));
      });
    }
    tryNext(0);
  });
}

// ── API Handlers ──────────────────────────────────────────────────────

function apiGenWhisperStart(_req, res) {
  const prefs = loadPrefs();
  if (!(prefs.whisperEnabled ?? true)) return json(res, { ok: false, error: 'Whisper disabled in settings' });
  if (_job && _job.running) return json(res, { ok: false, error: 'Already running' });
  runBatch().catch(console.error);
  json(res, { ok: true });
}

function apiGenWhisperStop(_req, res) {
  if (_job) _job.stop = true;
  // Kill the in-flight whisper process so the batch stops immediately instead of
  // waiting up to 15 minutes for the current video to finish transcribing.
  if (_currentChild) {
    try { _currentChild.kill('SIGKILL'); } catch {}
    _currentChild = null;
  }
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
    } else if (_job.error) {
      res.write('data: ' + JSON.stringify({ type: 'error', error: _job.error, fatal: true, done: _job.done, total: _job.total, failed: _job.failed }) + '\n\n');
    } else {
      res.write('data: ' + JSON.stringify({ type: 'done', done: _job.done, failed: _job.failed, total: _job.total + _job.skipped, skipped: _job.skipped }) + '\n\n');
    }
  } else {
    res.write('data: ' + JSON.stringify({ type: 'idle' }) + '\n\n');
  }
  req.on('close', () => _clients.delete(res));
}

function apiGenWhisperPoll(_req, res) {
  const prefs = loadPrefs();
  const enabled = prefs.whisperEnabled ?? true;
  if (_job) {
    json(res, { running: _job.running, done: _job.done, total: _job.total, failed: _job.failed, skipped: _job.skipped || 0, current: _job.current || '', enabled });
  } else {
    json(res, { running: false, enabled });
  }
}

async function apiWhisperEnqueue(_req, res, id) {
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

let _singleRunning = false;

// Single runner for the priority queue; items with `force: true` overwrite
// existing subtitle files, all others are skipped if a subtitle already exists.
async function processSingleQueue() {
  if (_singleRunning) return;
  _singleRunning = true;
  while (_singleQueue.length) {
    const item = _singleQueue.shift();
    if (!item) continue;
    if (!item.force && hasSubtitle(item.fp)) continue;
    const prefs = loadPrefs();
    const language = prefs.whisperLanguage || 'auto';
    try {
      const detectedLang = await runWhisper(item.fp, prefs.whisperModel || 'base', language);
      if (!language || language === 'auto') saveDetectedLanguage(item.fp, detectedLang);
    } catch (e) {
      console.error('[whisper] Single-video failed:', item.fp, e.message);
    }
  }
  _singleRunning = false;
}

// Force-enqueue ignores hasSubtitle so it overwrites existing subtitle files
function forceEnqueue(fp) {
  if (!_singleQueue.some(q => q.fp === fp)) {
    _singleQueue.unshift({ fp, force: true });
  }
  processSingleQueue().catch(console.error);
}

async function apiWhisperDownloadModel(req, res) {
  const body = await require('./helpers-server').readBody(req);
  const model = body.model;
  if (!VALID_MODELS.has(model)) return json(res, { error: 'Invalid model' }, 400);
  const existing = _modelDownloads.get(model);
  if (existing && existing.status === 'downloading') return json(res, { ok: true, already: true });
  _modelDownloads.set(model, { model, progress: 0, status: 'downloading', error: null });
  try {
    await downloadModel(model);
    const r = _modelDownloads.get(model);
    if (r) { r.status = 'done'; r.progress = 100; }
    // Keep the completed record briefly so the download drawer can show it, then clear.
    setTimeout(() => { const x = _modelDownloads.get(model); if (x && x.status === 'done') _modelDownloads.delete(model); }, 8000);
    json(res, { ok: true });
  } catch (e) {
    const r = _modelDownloads.get(model);
    if (r) { r.status = 'error'; r.error = e.message; }
    setTimeout(() => { const x = _modelDownloads.get(model); if (x && x.status === 'error') _modelDownloads.delete(model); }, 20000);
    json(res, { ok: false, error: e.message }, 500);
  }
}

function apiWhisperDownloadingModels(_req, res) {
  const models = [..._modelDownloads.values()];
  const available = [...VALID_MODELS].filter(m => isModelDownloaded(m));
  json(res, {
    downloading: models.filter(m => m.status === 'downloading').map(m => m.model),
    models,
    available,
  });
}

function apiWhisperAvailableModels(_req, res) {
  const available = [...VALID_MODELS].filter(m => isModelDownloaded(m));
  json(res, { available });
}

module.exports = {
  apiGenWhisperStart, apiGenWhisperStop, apiGenWhisperStatus, apiGenWhisperPoll,
  apiWhisperEnqueue, apiWhisperDownloadModel, apiWhisperDownloadingModels,
  apiWhisperAvailableModels,
  forceEnqueue,
};
