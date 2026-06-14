'use strict';
// ═══════════════════════════════════════════════════════════════════
//  gen-whisper-server.js — Whisper subtitle generation queue
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { VIDEOS_DIR, WHISPER_BIN } = require('./config-server');
const { json, safePath } = require('./helpers-server');
const { loadPrefs, setVideoMetaFields } = require('./db-server');

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

// Returns detected language string or null
function runWhisper(fp, model, language) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(fp);
    const args = [fp, '--output_format', 'vtt', '--output_dir', dir, '--model', model || 'base'];
    if (language && language !== 'auto') args.push('--language', language);
    execFile(WHISPER_BIN, args, { timeout: 15 * 60 * 1000 }, (err, stdout, stderr) => {
      if (err) { reject(err); return; }
      const combined = (stdout || '') + (stderr || '');
      resolve(parseDetectedLanguage(combined));
    });
  });
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
      const detectedLang = await runWhisper(item.fp, model, language);
      // Only save language if we ran in auto-detect mode
      if (!language || language === 'auto') saveDetectedLanguage(item.fp, detectedLang);
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
    const language = prefs.whisperLanguage || 'auto';
    try {
      const detectedLang = await runWhisper(fp, prefs.whisperModel || 'base', language);
      if (!language || language === 'auto') saveDetectedLanguage(fp, detectedLang);
    } catch (e) {
      console.error('[whisper] Single-video failed:', fp, e.message);
    }
  }
  _singleRunning = false;
}

// ── Model download ────────────────────────────────────────────────────

const _downloadingModels = new Set();
const VALID_MODELS = new Set(['tiny', 'base', 'small', 'medium', 'large', 'turbo']);

function downloadModel(model) {
  return new Promise((resolve) => {
    // Use Python to download (works regardless of PATH for whisper command)
    const pythonCmds = process.platform === 'win32' ? ['python'] : ['python3', 'python'];
    const code = `import whisper; whisper.load_model('${model}')`;

    function tryNext(i) {
      if (i >= pythonCmds.length) {
        // Fall back to running whisper CLI — it will download the model on demand
        execFile(WHISPER_BIN, ['--help'], { timeout: 60 * 1000 }, () => resolve());
        return;
      }
      execFile(pythonCmds[i], ['-c', code], { timeout: 20 * 60 * 1000 }, (err) => {
        if (err) tryNext(i + 1);
        else resolve();
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

async function apiWhisperDownloadModel(req, res) {
  const body = await require('./helpers-server').readBody(req);
  const model = body.model;
  if (!VALID_MODELS.has(model)) return json(res, { error: 'Invalid model' }, 400);
  if (_downloadingModels.has(model)) return json(res, { ok: true, already: true });
  _downloadingModels.add(model);
  try {
    await downloadModel(model);
    json(res, { ok: true });
  } catch (e) {
    json(res, { ok: false, error: e.message }, 500);
  } finally {
    _downloadingModels.delete(model);
  }
}

function apiWhisperDownloadingModels(_req, res) {
  json(res, { downloading: [..._downloadingModels] });
}

module.exports = {
  apiGenWhisperStart, apiGenWhisperStop, apiGenWhisperStatus, apiGenWhisperPoll,
  apiWhisperEnqueue, apiWhisperDownloadModel, apiWhisperDownloadingModels,
};
