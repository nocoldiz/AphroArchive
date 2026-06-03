'use strict';
// ═══════════════════════════════════════════════════════════════════
//  imagegen-server.js — Local Stable Diffusion image generation
//  Uses imagegen/imagegen.py as a long-running Python subprocess.
//  Supports wildcards (__name__) and combinatorial {a|b} prompts.
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { LINK_DIR, PHOTOS_DIR, DB_DIR } = require('./config-server');
const { json, readBody } = require('./helpers-server');

// ── Config ────────────────────────────────────────────────────────────

const CONFIG_FILE = path.join(LINK_DIR, 'imagegen-config.json');

const DEFAULT_CFG = {
  modelsDir:           path.join(LINK_DIR, 'imagegen', 'models'),
  diffusionModelsDir:  '',
  vaesDir:             path.join(LINK_DIR, 'imagegen', 'vaes'),
  lorasDir:            path.join(LINK_DIR, 'imagegen', 'loras'),
  wildcardsDir:        path.join(DB_DIR, 'wildcards'),
  outputDir:           path.join(PHOTOS_DIR, 'ai-generated'),
  modelType:           'sd15',
  model:               '',
  vae:                 '',
  device:              'auto',  // auto | cpu | cuda | mps  — prefers GPU when available
};

let cfg = { ...DEFAULT_CFG };

function loadCfg() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      cfg = { ...DEFAULT_CFG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) };
    }
  } catch {}
}

function saveCfg() {
  try {
    fs.mkdirSync(LINK_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  } catch {}
}

// ── Python process state ──────────────────────────────────────────────

let pyProc     = null;
let pyReady    = false;
let pyDevice   = 'unknown';
let currentJob = null;
const jobQueue = [];
let status = { state: 'stopped', step: 0, total: 0, pct: 0, message: 'Engine not started', comboIdx: 0, comboTotal: 1 };
const progressListeners = new Set();

function broadcast(data) {
  for (const fn of progressListeners) {
    try { fn(data); } catch {}
  }
}

const PYTHON_SCRIPT = path.join(__dirname, '..', 'imagegen', 'imagegen.py');
const PYTHON_BIN    = process.platform === 'win32' ? 'python' : 'python3';

const log = (...args) => console.log('[imagegen]', ...args);

function startEngine() {
  if (pyProc) return;
  log('Starting Python engine…');
  const devPref = (cfg.device || 'auto').toString().toLowerCase();
  const pyArgs = ['-u', PYTHON_SCRIPT, '--device', (['cpu','cuda','mps'].includes(devPref) ? devPref : 'auto')];
  pyProc = spawn(PYTHON_BIN, pyArgs, {
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });

  let buf = '';
  pyProc.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf-8');
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (t) { try { handleMsg(JSON.parse(t)); } catch {} }
    }
  });

  // Stream Python stderr (diffusers/torch loading output) directly to console
  let stderrBuf = '';
  pyProc.stderr.on('data', (chunk) => {
    stderrBuf += chunk.toString('utf-8');
    const lines = stderrBuf.split('\n');
    stderrBuf = lines.pop();
    for (const line of lines) {
      if (line.trim()) console.error('[imagegen/py]', line);
    }
  });

  pyProc.on('close', (code) => {
    if (stderrBuf.trim()) console.error('[imagegen/py]', stderrBuf);
    log(`Process exited (code ${code ?? '?'})`);
    pyProc = null; pyReady = false;
    status = { state: 'stopped', step: 0, total: 0, pct: 0, message: `Exited (${code ?? '?'})`, comboIdx: 0, comboTotal: 1 };
    if (currentJob) { currentJob.done({ ok: false, error: 'process exited' }); currentJob = null; }
    jobQueue.length = 0;
    broadcast({ type: 'engine_stopped', code });
  });

  pyProc.on('error', (err) => {
    log('Spawn error:', err.message);
    pyProc = null; pyReady = false;
    status = { state: 'error', step: 0, total: 0, pct: 0, message: err.message, comboIdx: 0, comboTotal: 1 };
    if (currentJob) { currentJob.done({ ok: false, error: err.message }); currentJob = null; }
    jobQueue.length = 0;
    broadcast({ type: 'error', message: err.message });
  });
}

function stopEngine() {
  if (!pyProc) return;
  log('Stopping engine…');
  try { pyProc.stdin.write(JSON.stringify({ action: 'quit' }) + '\n'); } catch {}
  setTimeout(() => { if (pyProc) { try { pyProc.kill('SIGKILL'); } catch {} pyProc = null; pyReady = false; } }, 2500);
}

function handleMsg(msg) {
  switch (msg.type) {
    case 'ready':
      pyReady = true; pyDevice = msg.device || 'cpu';
      log(`Engine ready on ${pyDevice}`);
      status = { state: 'idle', step: 0, total: 0, pct: 0, message: `Ready on ${pyDevice}`, comboIdx: 0, comboTotal: 1 };
      broadcast({ ...msg, queueLength: jobQueue.length });
      processQueue();
      break;

    case 'loading':
      log(`Loading model: ${msg.model}`);
      status = { ...status, state: 'loading', message: `Loading ${msg.model}…` };
      broadcast(msg);
      break;

    case 'model_loaded':
      log(`Model loaded: ${msg.model} on ${msg.device}`);
      status.message = `${msg.model} on ${msg.device}`;
      broadcast(msg);
      break;

    case 'progress':
      process.stdout.write(
        `\r[imagegen] Step ${msg.step}/${msg.total} (${msg.pct}%)${(msg.combo_total || 1) > 1 ? ` — combo ${(msg.combo_idx || 0) + 1}/${msg.combo_total}` : ''}   `
      );
      if (msg.step === msg.total) process.stdout.write('\n');
      status = {
        state: 'generating',
        step: msg.step, total: msg.total, pct: msg.pct,
        message: `Step ${msg.step}/${msg.total}${msg.combo_total > 1 ? ` · combo ${msg.combo_idx + 1}/${msg.combo_total}` : ''}`,
        comboIdx: msg.combo_idx || 0, comboTotal: msg.combo_total || 1,
      };
      broadcast(msg);
      break;

    case 'done':
      log(`Done — ${msg.count} image(s) in ${msg.elapsed}s`);
      if (msg.paths && msg.paths.length) log('Saved:', msg.paths.join(', '));
      status = { state: 'idle', step: 0, total: 0, pct: 100, message: `Done in ${msg.elapsed}s`, comboIdx: 0, comboTotal: 1 };
      if (currentJob) { currentJob.done(msg); currentJob = null; }
      broadcast(msg);
      processQueue();
      break;

    case 'cancelled':
      log('Generation cancelled');
      status = { state: 'idle', step: 0, total: 0, pct: 0, message: 'Cancelled', comboIdx: 0, comboTotal: 1 };
      if (currentJob) { currentJob.done({ ok: false, cancelled: true }); currentJob = null; }
      broadcast(msg);
      processQueue();
      break;

    case 'warning':
      log('Warning:', msg.message);
      broadcast(msg);
      break;

    case 'error':
      log('Error:', msg.message);
      if (msg.traceback) console.error('[imagegen/py traceback]\n' + msg.traceback);
      status = { state: 'error', step: 0, total: 0, pct: 0, message: msg.message, comboIdx: 0, comboTotal: 1 };
      if (currentJob) { currentJob.done({ ok: false, error: msg.message }); currentJob = null; }
      broadcast(msg);
      processQueue();
      break;

    default:
      broadcast(msg);
  }
}

function processQueue() {
  if (!pyReady || !pyProc || currentJob || !jobQueue.length) return;
  const job = jobQueue.shift();
  currentJob = job;
  const p = job.params;
  log(`Starting job — model: ${require('path').basename(p.model)}, type: ${p.model_type}, size: ${p.width}x${p.height}, steps: ${p.steps}, seed: ${p.seed}`);
  status = { ...status, state: 'queued', message: 'Starting…' };
  pyProc.stdin.write(JSON.stringify({ action: 'generate', ...job.params }) + '\n');
}

// ── Helpers ───────────────────────────────────────────────────────────

const MODEL_EXTS = new Set(['.safetensors', '.ckpt', '.pt', '.gguf']);
const IMG_EXTS   = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const WC_EXTS    = new Set(['.txt']);

function scanFiles(dir, exts) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const results = [];
    const walk = (d) => {
      for (const f of fs.readdirSync(d)) {
        const fp = path.join(d, f);
        try {
          const st = fs.statSync(fp);
          if (st.isDirectory()) { walk(fp); continue; }
          if (exts.has(path.extname(f).toLowerCase()))
            results.push({ name: path.relative(dir, fp).replace(/\\/g, '/'), size: st.size, mtime: st.mtimeMs });
        } catch {}
      }
    };
    walk(dir);
    return results.sort((a, b) => a.name.localeCompare(b.name));
  } catch { return []; }
}

// Count combinatorial combinations client-side mirror of Python logic
function countCombinations(prompt) {
  let total = 1;
  const re = /\{([^{}]+)\}/g;
  let m;
  while ((m = re.exec(prompt)) !== null) {
    total *= m[1].split('|').length;
  }
  return total;
}

// ── API: config ───────────────────────────────────────────────────────

function apiGetConfig(req, res) {
  json(res, {
    ...cfg,
    engine: { running: !!pyProc, ready: pyReady, device: pyDevice, status },
    queueLength: jobQueue.length,
  });
}

async function apiSetConfig(req, res) {
  const body = await readBody(req);
  const fields = ['modelsDir', 'diffusionModelsDir', 'vaesDir', 'lorasDir', 'wildcardsDir', 'outputDir', 'modelType', 'model', 'vae', 'device'];
  for (const f of fields) if (body[f] !== undefined) cfg[f] = body[f];
  saveCfg();
  json(res, { ok: true });
}

// ── API: assets ───────────────────────────────────────────────────────

function apiGetAssets(req, res) {
  // Wildcards: read each file for line count and preview
  let wildcards = [];
  try {
    fs.mkdirSync(cfg.wildcardsDir, { recursive: true });
    wildcards = fs.readdirSync(cfg.wildcardsDir)
      .filter(f => f.toLowerCase().endsWith('.txt'))
      .map(f => {
        const fp = path.join(cfg.wildcardsDir, f);
        try {
          const lines = fs.readFileSync(fp, 'utf-8')
            .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
          return { name: path.basename(f, '.txt'), file: f, count: lines.length, preview: lines.slice(0, 5) };
        } catch { return { name: path.basename(f, '.txt'), file: f, count: 0, preview: [] }; }
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {}

  const checkpointModels  = scanFiles(cfg.modelsDir, MODEL_EXTS);
  const diffusionModels   = cfg.diffusionModelsDir
    ? scanFiles(cfg.diffusionModelsDir, MODEL_EXTS).map(m => ({ ...m, name: `diffusion_models/${m.name}` }))
    : [];

  json(res, {
    models:    [...checkpointModels, ...diffusionModels],
    vaes:      scanFiles(cfg.vaesDir,   MODEL_EXTS),
    loras:     scanFiles(cfg.lorasDir,  MODEL_EXTS),
    wildcards,
  });
}

// ── API: wildcards CRUD ───────────────────────────────────────────────

function apiGetWildcard(req, res, name) {
  const fp = path.join(cfg.wildcardsDir, path.basename(name) + '.txt');
  try {
    const content = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf-8') : '';
    json(res, { name, content, lines: content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')) });
  } catch (e) { json(res, { error: e.message }, 500); }
}

async function apiSaveWildcard(req, res, name) {
  const body = await readBody(req);
  const safeName = path.basename(name).replace(/[^a-zA-Z0-9_\-]/g, '_');
  if (!safeName) return json(res, { error: 'Invalid name' }, 400);
  try {
    fs.mkdirSync(cfg.wildcardsDir, { recursive: true });
    const fp = path.join(cfg.wildcardsDir, safeName + '.txt');
    fs.writeFileSync(fp, body.content || '', 'utf-8');
    const lines = (body.content || '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    json(res, { ok: true, name: safeName, count: lines.length });
  } catch (e) { json(res, { error: e.message }, 500); }
}

function apiDeleteWildcard(req, res, name) {
  const fp = path.join(cfg.wildcardsDir, path.basename(name) + '.txt');
  try { fs.unlinkSync(fp); } catch {}
  json(res, { ok: true });
}

// ── API: status + engine control ──────────────────────────────────────

function apiGetStatus(req, res) {
  json(res, { running: !!pyProc, ready: pyReady, device: pyDevice, status, queueLength: jobQueue.length });
}

function apiStartEngine(req, res) { startEngine(); json(res, { ok: true }); }
function apiStopEngine(req, res)  { stopEngine();  json(res, { ok: true }); }

function apiCancel(req, res) {
  if (pyProc) { try { pyProc.stdin.write(JSON.stringify({ action: 'cancel' }) + '\n'); } catch {} }
  jobQueue.length = 0;
  json(res, { ok: true });
}

// ── API: generate ─────────────────────────────────────────────────────

async function apiGenerate(req, res) {
  const body = await readBody(req);
  if (!body.model) return json(res, { error: 'No model specified' }, 400);

  let modelPath;
  if (path.isAbsolute(body.model)) {
    modelPath = body.model;
  } else if (body.model.startsWith('diffusion_models/') && cfg.diffusionModelsDir) {
    modelPath = path.join(cfg.diffusionModelsDir, body.model.slice('diffusion_models/'.length));
  } else {
    modelPath = path.join(cfg.modelsDir, body.model);
    // fall back to diffusion_models if not in checkpoints
    if (!fs.existsSync(modelPath) && cfg.diffusionModelsDir) {
      const alt = path.join(cfg.diffusionModelsDir, body.model);
      if (fs.existsSync(alt)) modelPath = alt;
    }
  }
  if (!fs.existsSync(modelPath)) return json(res, { error: `Model not found: ${body.model}` }, 404);

  const vaePath   = body.vae ? (path.isAbsolute(body.vae) ? body.vae : path.join(cfg.vaesDir, body.vae)) : null;
  const loraFiles = (body.loras || []).map(l => path.isAbsolute(l) ? l : path.join(cfg.lorasDir, l));

  fs.mkdirSync(cfg.outputDir, { recursive: true });

  const params = {
    model:          modelPath,
    model_type:     body.model_type || cfg.modelType || 'sd15',
    vae:            vaePath,
    prompt:         body.prompt || '',
    negative:       body.negative || '',
    width:          body.width  || 512,
    height:         body.height || 768,
    steps:          body.steps  || 20,
    cfg:            body.cfg    || 7.5,
    sampler:        body.sampler || 'euler',
    seed:           body.seed != null ? body.seed : -1,
    batch:          body.batch  || 1,
    output_dir:     cfg.outputDir,
    loras:          loraFiles,
    lora_strengths: body.lora_strengths || loraFiles.map(() => 1.0),
    wildcards_dir:  cfg.wildcardsDir,
    combinatorial:  !!body.combinatorial,
  };

  if (!pyProc) startEngine();

  const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const combos = countCombinations(params.prompt);
  log(`Job queued (${jobId}) — model: ${path.basename(modelPath)}, ${combos * params.batch} image(s), queue depth: ${jobQueue.length + 1}`);
  jobQueue.push({ id: jobId, params, done: () => {} });
  broadcast({ type: 'queued', jobId, queueLength: jobQueue.length });
  processQueue();

  json(res, { ok: true, jobId, queuePosition: jobQueue.length, estimatedImages: combos * params.batch });
}

// ── API: gallery ──────────────────────────────────────────────────────

function apiGallery(req, res) {
  const files = scanFiles(cfg.outputDir, IMG_EXTS)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 400);
  json(res, files);
}

function apiServeImage(req, res, filename) {
  const fp = path.join(cfg.outputDir, path.basename(filename));
  if (!fs.existsSync(fp)) return json(res, { error: 'Not found' }, 404);
  const ext  = path.extname(fp).slice(1).toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'max-age=3600' });
  fs.createReadStream(fp).pipe(res);
}

function apiDeleteImage(req, res, filename) {
  const fp = path.join(cfg.outputDir, path.basename(filename));
  try { fs.unlinkSync(fp); } catch {}
  json(res, { ok: true });
}

// ── API: SSE progress ─────────────────────────────────────────────────

function apiProgress(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (data) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send({ type: 'init', running: !!pyProc, ready: pyReady, device: pyDevice, status, queueLength: jobQueue.length });
  progressListeners.add(send);
  req.on('close', () => progressListeners.delete(send));
}

// ── ComfyUI integration ───────────────────────────────────────────────

const COMFYUI_MODEL_DIRS = [
  'audio_encoders', 'checkpoints', 'clip', 'clip_vision', 'configs',
  'controlnet', 'diffusers', 'diffusion_models', 'embeddings', 'gligen',
  'hypernetworks', 'latent_upscale_models', 'loras', 'model_patches',
  'onnx', 'photomaker', 'sams', 'style_models', 'text_encoders',
  'unet', 'ultralytics', 'upscale_models', 'vae', 'vae_approx',
];

function applyComfyuiPath(comfyuiPath) {
  if (comfyuiPath) {
    cfg.modelsDir          = path.join(comfyuiPath, 'models', 'checkpoints');
    cfg.diffusionModelsDir = path.join(comfyuiPath, 'models', 'diffusion_models');
    cfg.vaesDir            = path.join(comfyuiPath, 'models', 'vae');
    cfg.lorasDir           = path.join(comfyuiPath, 'models', 'loras');
    for (const dir of COMFYUI_MODEL_DIRS) {
      try { fs.mkdirSync(path.join(comfyuiPath, 'models', dir), { recursive: true }); } catch {}
    }
  } else {
    cfg.modelsDir = DEFAULT_CFG.modelsDir;
    cfg.vaesDir   = DEFAULT_CFG.vaesDir;
    cfg.lorasDir  = DEFAULT_CFG.lorasDir;
  }
  saveCfg();
}

let comfyProc = null;

function apiStartComfyui(req, res) {
  const { loadPrefs } = require('./db-server');
  const comfyuiPath = (loadPrefs().comfyuiPath || '').trim();
  if (!comfyuiPath) return json(res, { error: 'ComfyUI path not configured in Settings' }, 400);
  if (!fs.existsSync(path.join(comfyuiPath, 'main.py')))
    return json(res, { error: 'main.py not found at the specified ComfyUI path' }, 400);
  if (comfyProc) return json(res, { ok: true, already: true });
  comfyProc = spawn(PYTHON_BIN, ['main.py'], { cwd: comfyuiPath, detached: true, stdio: 'ignore' });
  comfyProc.unref();
  comfyProc.on('exit', () => { comfyProc = null; });
  json(res, { ok: true });
}

// ── API: sync comfyui dirs ────────────────────────────────────────────

function apiSyncComfyui(req, res) {
  const { loadPrefs } = require('./db-server');
  const comfyuiPath = (loadPrefs().comfyuiPath || '').trim();
  if (!comfyuiPath) return json(res, { error: 'ComfyUI path not configured in Settings' }, 400);
  applyComfyuiPath(comfyuiPath);
  json(res, { ok: true, modelsDir: cfg.modelsDir, vaesDir: cfg.vaesDir, lorasDir: cfg.lorasDir });
}

// ── Init ──────────────────────────────────────────────────────────────

loadCfg();

// If dirs are still at defaults, try to sync from comfyuiPath pref
try {
  const { loadPrefs } = require('./db-server');
  const comfyuiPath = (loadPrefs().comfyuiPath || '').trim();
  if (comfyuiPath) {
    applyComfyuiPath(comfyuiPath);
  }
} catch {}

module.exports = {
  apiGetConfig, apiSetConfig,
  apiGetAssets, apiGetStatus,
  apiGetWildcard, apiSaveWildcard, apiDeleteWildcard,
  apiGenerate, apiCancel,
  apiStartEngine, apiStopEngine,
  apiGallery, apiServeImage, apiDeleteImage,
  apiProgress,
  applyComfyuiPath, apiStartComfyui, apiSyncComfyui,
};
