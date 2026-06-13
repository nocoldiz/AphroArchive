'use strict';
// ═══════════════════════════════════════════════════════════════════
//  downloads.js — yt-dlp download queue API handlers
// ═══════════════════════════════════════════════════════════════════

const fs              = require('fs');
const path            = require('path');
const http            = require('http');
const https           = require('https');
const { spawn, execFile } = require('child_process');
const {
  VIDEOS_DIR, YT_DLP_BIN, LINK_DIR,
  AUDIO_DIR, BOOKS_DIR, PHOTOS_DIR, FILES_DIR,
  VIDEO_EXT, AUDIO_EXT, BOOK_EXT, IMAGE_EXT,
} = require('./config-server');
const { json, readBody, toId, fromId }      = require('./helpers-server');
const { getDefaultWriteRoot } = require('./db-server');

// ── Persistence ──────────────────────────────────────────────────────

const JOBS_FILE   = path.join(LINK_DIR, 'downloads.json');
const CONFIG_FILE = path.join(LINK_DIR, 'download-config.json');

function saveJobs() {
  try {
    fs.mkdirSync(LINK_DIR, { recursive: true });
    const jobs = [...downloadJobs.values()].map(({ _kill, ...j }) => j);
    fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2), 'utf-8');
  } catch {}
}

function loadJobs() {
  try {
    if (!fs.existsSync(JOBS_FILE)) return;
    const saved = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
    for (const j of saved) {
      if (j.status === 'running') j.status = 'queued'; // restart interrupted downloads
      downloadJobs.set(j.id, { ...j, _kill: null });
    }
  } catch {}
}

// ── Config ───────────────────────────────────────────────────────────

let maxDlConcurrent = 3;

function loadDlConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      if (c.maxParallelDownloads >= 1) maxDlConcurrent = c.maxParallelDownloads;
    }
  } catch {}
}

function saveDlConfig() {
  try {
    fs.mkdirSync(LINK_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ maxParallelDownloads: maxDlConcurrent }, null, 2), 'utf-8');
  } catch {}
}

// ── Queue state ──────────────────────────────────────────────────────

const downloadJobs = new Map();
let dlActive = 0;

function nextDlId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function enqueueDownload(dlUrl, category, pendingCategory) {
  const id = nextDlId();
  downloadJobs.set(id, {
    id, url: dlUrl, title: dlUrl,
    category: category || '',
    pendingCategory: pendingCategory || category || '',
    status: 'queued', progress: 0, speed: '', eta: '', error: null,
    addedAt: Date.now(), outputPath: null, videoId: null, _kill: null,
    kind: 'video', mediaType: null,
  });
  saveJobs();
  processDownloadQueue();
  return id;
}

async function autoMoveVideo(videoId, pendingCategory) {
  try {
    const cleanCat = (pendingCategory || '').trim();
    if (!cleanCat) return;
    const isVirtual = cleanCat.toLowerCase() === 'links' || cleanCat.toLowerCase() === 'uncategorized';
    if (isVirtual) return;
    const writeRoot = getDefaultWriteRoot();
    const rel = fromId(videoId);
    let src = rel;
    if (!path.isAbsolute(src)) {
      src = path.join(VIDEOS_DIR, rel);
      if (!fs.existsSync(src)) {
        src = path.join(writeRoot, rel);
      }
    }
    if (!fs.existsSync(src)) return;
    const destDir = path.join(writeRoot, cleanCat);
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, path.basename(src));
    if (src !== dest) fs.renameSync(src, dest);
  } catch (err) {
    console.error('[download] auto-move failed:', err.message);
  }
}

async function handleLinkConversion(url, localVideoId) {
  try {
    const { loadLinksCache, saveLinksCache } = require('./db-server');
    const cache = loadLinksCache();
    const items = cache.items || [];
    const item = items.find(it => it.url === url);
    if (item) {
      item.downloaded = true;
      if (localVideoId) item.localVideoId = localVideoId;
      saveLinksCache({ items });
      const { invalidateScanCache, initVideoMeta } = require('./videos-server');
      invalidateScanCache();
      initVideoMeta().catch(err => console.error('initVideoMeta failed after link download:', err));
    }
  } catch (err) {
    console.error('Failed to mark link as downloaded:', err);
  }
}

async function processDownloadQueue() {
  while (dlActive < maxDlConcurrent) {
    const next = [...downloadJobs.values()].find(j => j.status === 'queued');
    if (!next) break;
    dlActive++;
    next.status = 'running';
    saveJobs();
    runJob(next);
  }
}

// Classify a download URL by its file extension so we know whether to hand
// it to yt-dlp (video/page) or download it directly and sort it into the
// matching media folder.
function classifyUrl(url) {
  let ext = '';
  try { ext = path.extname(new URL(url).pathname).toLowerCase(); } catch {}
  if (!ext || VIDEO_EXT.has(ext)) return { kind: 'video' };
  if (AUDIO_EXT.has(ext)) return { kind: 'file', mediaType: 'audio', dir: AUDIO_DIR, ext };
  if (BOOK_EXT.has(ext))  return { kind: 'file', mediaType: 'book',  dir: BOOKS_DIR, ext };
  if (IMAGE_EXT.has(ext)) return { kind: 'file', mediaType: 'photo', dir: PHOTOS_DIR, ext };
  return { kind: 'file', mediaType: 'file', dir: FILES_DIR, ext };
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || !isFinite(bytesPerSec)) return '';
  if (bytesPerSec >= 1024 * 1024) return (bytesPerSec / (1024 * 1024)).toFixed(1) + 'MB/s';
  return (bytesPerSec / 1024).toFixed(1) + 'KB/s';
}

// Direct HTTP(S) download for non-video files (audio/books/photos/misc),
// following redirects and sorted straight into the matching media folder.
function runDirectFileDownload(job, target, url = job.url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));

    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const nextUrl = new URL(res.headers.location, url).toString();
        return runDirectFileDownload(job, target, nextUrl, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      }

      fs.mkdirSync(target.dir, { recursive: true });

      let filename = '';
      try {
        filename = decodeURIComponent(path.basename(new URL(url).pathname));
      } catch {}
      if (!filename) filename = 'download-' + job.id;
      if (!path.extname(filename)) filename += target.ext;

      let destPath = path.join(target.dir, filename);
      if (fs.existsSync(destPath)) {
        const base = path.basename(filename, path.extname(filename));
        destPath = path.join(target.dir, `${base}-${job.id}${path.extname(filename)}`);
      }

      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      let lastTick = Date.now();
      let lastBytes = 0;

      const out = fs.createWriteStream(destPath);
      job._kill = () => { req.destroy(); out.destroy(); };

      res.on('data', chunk => {
        received += chunk.length;
        if (total > 0) job.progress = Math.min(100, (received / total) * 100);
        const now = Date.now();
        if (now - lastTick >= 1000) {
          job.speed = formatSpeed((received - lastBytes) / ((now - lastTick) / 1000));
          lastTick = now;
          lastBytes = received;
        }
      });

      res.pipe(out);
      out.on('finish', () => {
        job.outputPath = destPath;
        job.title = path.basename(destPath, path.extname(destPath));
        job.kind = target.kind || 'file';
        job.mediaType = target.mediaType;
        job.progress = 100;
        resolve();
      });
      out.on('error', reject);
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

async function runJob(next) {
  const classified = classifyUrl(next.url);
  if (classified.kind === 'file') {
    next.kind = 'file';
    next.mediaType = classified.mediaType;
    try {
      await runDirectFileDownload(next, classified);
      next.status   = 'done';
      next.progress = 100;
    } catch (e) {
      if (downloadJobs.has(next.id) && next.status !== 'paused') { next.status = 'error'; next.error = e.message; }
    } finally {
      dlActive--;
      saveJobs();
      processDownloadQueue();
    }
    return;
  }
  try {
    await runUniversal(next);
    next.status   = 'done';
    next.progress = 100;
    const writeRoot = getDefaultWriteRoot();
    if (next.outputPath && fs.existsSync(next.outputPath)) {
      const outRes = path.resolve(next.outputPath);
      if (outRes.startsWith(path.resolve(VIDEOS_DIR))) {
        const rel = path.relative(VIDEOS_DIR, next.outputPath).replace(/\\/g, '/');
        next.videoId = toId(rel);
      } else {
        next.videoId = toId(next.outputPath);
      }
    }
    if (next.pendingCategory && next.videoId) {
      await autoMoveVideo(next.videoId, next.pendingCategory);
      // Update videoId after move
      const cleanCat = next.pendingCategory.trim();
      const isVirtual = cleanCat.toLowerCase() === 'links' || cleanCat.toLowerCase() === 'uncategorized';
      if (!isVirtual && next.outputPath) {
        const newPath = path.join(writeRoot, cleanCat, path.basename(next.outputPath));
        if (fs.existsSync(newPath)) {
          const npRes = path.resolve(newPath);
          next.videoId = npRes.startsWith(path.resolve(VIDEOS_DIR))
            ? toId( path.relative(VIDEOS_DIR, newPath).replace(/\\/g, '/') )
            : toId(newPath);
        }
      }
    }
    await handleLinkConversion(next.url, next.videoId);
  } catch (e) {
    if (downloadJobs.has(next.id) && next.status !== 'paused') { next.status = 'error'; next.error = e.message; }
  } finally {
    dlActive--;
    saveJobs();
    processDownloadQueue();
  }
}

// Primary downloader: hand the URL to bulkdownloader.py in single-URL mode.
// It runs yt-dlp's native + generic extractors and, failing that, scrapes
// the page for video in any way possible (Open Graph, JSON-LD, <video>/
// <source>, JWPlayer/HLS/DASH configs, iframe recursion, direct stream) and
// reports the saved file via a `RESULT_FILE:` line.
function runUniversal(job) {
  return new Promise((resolve, reject) => {
    const cleanCat = (job.category || '').trim();
    const isVirtual = cleanCat.toLowerCase() === 'links' || cleanCat.toLowerCase() === 'uncategorized';
    const writeRoot = getDefaultWriteRoot();
    const physicalCat = isVirtual ? '' : cleanCat;
    const outDir = physicalCat ? path.join(writeRoot, physicalCat) : path.join(writeRoot, 'downloads');
    try { fs.mkdirSync(outDir, { recursive: true }); } catch {}

    const pythonBin  = process.platform === 'win32' ? 'python' : 'python3';
    const scriptPath = path.join(__dirname, '..', 'Bulkdownloader', 'bulkdownloader.py');

    const proc = spawn(pythonBin, [
      '-u', scriptPath,
      '--url', job.url,
      '--out-dir', outDir,
      '--out-tmpl', '%(title)s.%(ext)s',
    ], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    job._kill = () => proc.kill('SIGKILL');

    let resultFile = null;
    const parseLine = line => {
      const res = line.match(/^RESULT_FILE:\s*(.+)/);
      if (res) { resultFile = res[1].trim(); job.outputPath = resultFile; job.title = path.basename(resultFile).replace(/\.[^.]+$/, ''); }
      const prog = line.match(/\[download\]\s+([\d.]+)%/);
      if (prog) job.progress = parseFloat(prog[1]);
    };

    let oBuf = '', eBuf = '';
    const feed = (buf, data) => {
      buf += data.toString();
      const lines = buf.split(/[\r\n]/); buf = lines.pop();
      lines.forEach(l => { if (l.trim()) parseLine(l); }); return buf;
    };
    proc.stdout.on('data', d => { oBuf = feed(oBuf, d); });
    proc.stderr.on('data', d => { eBuf = feed(eBuf, d); });

    proc.on('close', code => {
      if (oBuf) parseLine(oBuf);
      if (eBuf) parseLine(eBuf);
      if (resultFile && fs.existsSync(resultFile)) return resolve();
      reject(new Error('bulkdownloader.py found no downloadable video (exit code ' + code + ')'));
    });
    proc.on('error', err => reject(new Error(
      err.code === 'ENOENT'
        ? 'Python not found — install Python 3 to enable universal page scraping'
        : err.message
    )));
  });
}

// ── Download API handlers ────────────────────────────────────────────

async function apiDownloadAdd(req, res) {
  const body = await readBody(req);
  if (Array.isArray(body.items)) {
    const valid = body.items.filter(i => i?.url);
    if (!valid.length) return json(res, { error: 'No valid items' }, 400);
    const ids = valid.map(i => enqueueDownload(i.url, i.category || '', i.pendingCategory || i.category || ''));
    return json(res, { ok: true, ids });
  }
  const urls = Array.isArray(body.urls) ? body.urls : (body.url ? [body.url] : []);
  if (!urls.length) return json(res, { error: 'URL required' }, 400);
  const category        = (body.category || '').trim();
  const pendingCategory = (body.pendingCategory || category).trim();
  const ids             = urls.map(u => enqueueDownload(u, category, pendingCategory));
  json(res, { ok: true, ids });
}

function apiDownloadJobs(req, res) {
  const jobs = [...downloadJobs.values()]
    .sort((a, b) => a.addedAt - b.addedAt)
    .map(({ _kill, ...rest }) => rest);
  json(res, jobs);
}

function apiDownloadRemove(req, res, id) {
  const job = downloadJobs.get(id);
  if (!job) return json(res, { error: 'Not found' }, 404);
  if (job.status === 'running' && job._kill) { job._kill(); dlActive = Math.max(0, dlActive - 1); }
  downloadJobs.delete(id);
  saveJobs();
  json(res, { ok: true });
}

function apiDownloadCancelAll(req, res) {
  for (const [id, job] of downloadJobs.entries()) {
    if (job.status === 'running' || job.status === 'queued') {
      if (job._kill) job._kill();
      downloadJobs.delete(id);
    }
  }
  dlActive = 0;
  saveJobs();
  json(res, { ok: true });
}

function apiDownloadRemoveAll(req, res) {
  for (const job of downloadJobs.values()) {
    if (job.status === 'running' && job._kill) job._kill();
  }
  downloadJobs.clear();
  dlActive = 0;
  saveJobs();
  json(res, { ok: true });
}

async function apiDownloadUpdateJob(req, res, id) {
  const job = downloadJobs.get(id);
  if (!job) return json(res, { error: 'Not found' }, 404);
  const body = await readBody(req);
  if (body.pendingCategory !== undefined) job.pendingCategory = body.pendingCategory;
  saveJobs();
  json(res, { ok: true });
}

function apiDownloadRestartJob(req, res, id) {
  const job = downloadJobs.get(id);
  if (!job) return json(res, { error: 'Not found' }, 404);
  if (job.status === 'running') return json(res, { error: 'Already running' }, 409);
  job.status   = 'queued';
  job.progress = 0;
  job.speed    = '';
  job.eta      = '';
  job.error    = null;
  saveJobs();
  processDownloadQueue();
  json(res, { ok: true });
}

// Pause a running job: kills the underlying process but keeps the partial
// output on disk so yt-dlp/bulkdownloader.py can resume from the .part file.
function apiDownloadPauseJob(req, res, id) {
  const job = downloadJobs.get(id);
  if (!job) return json(res, { error: 'Not found' }, 404);
  if (job.status !== 'running') return json(res, { error: 'Job is not running' }, 409);
  job.status = 'paused';
  job.speed  = '';
  job.eta    = '';
  if (job._kill) job._kill();
  saveJobs();
  json(res, { ok: true });
}

function apiDownloadResumeJob(req, res, id) {
  const job = downloadJobs.get(id);
  if (!job) return json(res, { error: 'Not found' }, 404);
  if (job.status !== 'paused') return json(res, { error: 'Job is not paused' }, 409);
  job.status = 'queued';
  job.error  = null;
  saveJobs();
  processDownloadQueue();
  json(res, { ok: true });
}

function apiDownloadCheck(req, res) {
  execFile(YT_DLP_BIN, ['--version'], { timeout: 5000 }, (err, stdout) => {
    if (err) return json(res, { available: false, bin: YT_DLP_BIN });
    json(res, { available: true, version: stdout.trim(), bin: YT_DLP_BIN });
  });
}

function apiDownloadGetConfig(req, res) {
  json(res, { maxParallelDownloads: maxDlConcurrent });
}

async function apiDownloadSetConfig(req, res) {
  const body = await readBody(req);
  const n = parseInt(body.maxParallelDownloads, 10);
  if (!n || n < 1 || n > 10) return json(res, { error: 'maxParallelDownloads must be 1–10' }, 400);
  maxDlConcurrent = n;
  saveDlConfig();
  processDownloadQueue();
  json(res, { ok: true, maxParallelDownloads: maxDlConcurrent });
}

// ── Persistent download queue (txt file) ────────────────────────────

function apiReadDownloadQueue(req, res) {
  try {
    const queuePath = path.join(LINK_DIR, 'download_queue.txt');
    const content   = fs.existsSync(queuePath) ? fs.readFileSync(queuePath, 'utf-8') : '';
    const urls      = content.split('\n').map(l => l.trim()).filter(Boolean);
    json(res, { urls });
  } catch (e) { json(res, { error: e.message }, 500); }
}

async function apiWriteDownloadQueue(req, res) {
  const body = await readBody(req);
  const urls = Array.isArray(body.urls) ? body.urls.filter(u => typeof u === 'string' && u) : [];
  try {
    fs.mkdirSync(LINK_DIR, { recursive: true });
    fs.writeFileSync(path.join(LINK_DIR, 'download_queue.txt'), urls.join('\n') + (urls.length ? '\n' : ''), 'utf-8');
    json(res, { ok: true, count: urls.length });
  } catch (e) { json(res, { error: e.message }, 500); }
}

async function apiDownloadQueueAdd(req, res) {
  const body    = await readBody(req);
  const dlUrl   = typeof body.url === 'string' ? body.url.trim() : '';
  if (!dlUrl) return json(res, { error: 'No URL provided' }, 400);
  try {
    fs.mkdirSync(LINK_DIR, { recursive: true });
    const queuePath = path.join(LINK_DIR, 'download_queue.txt');
    const existing  = fs.existsSync(queuePath)
      ? fs.readFileSync(queuePath, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean)
      : [];
    if (!existing.includes(dlUrl)) fs.appendFileSync(queuePath, dlUrl + '\n', 'utf-8');
    json(res, { ok: true });
  } catch (e) { json(res, { error: e.message }, 500); }
}

async function apiDownloadQueueRemove(req, res) {
  const body  = await readBody(req);
  const dlUrl = typeof body.url === 'string' ? body.url.trim() : '';
  if (!dlUrl) return json(res, { error: 'No URL provided' }, 400);
  try {
    const queuePath = path.join(LINK_DIR, 'download_queue.txt');
    if (!fs.existsSync(queuePath)) return json(res, { ok: true });
    const lines = fs.readFileSync(queuePath, 'utf-8').split('\n').map(l => l.trim()).filter(l => l && l !== dlUrl);
    fs.writeFileSync(queuePath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf-8');
    json(res, { ok: true });
  } catch (e) { json(res, { error: e.message }, 500); }
}

// ── Bulk downloader (Python script) ─────────────────────────────────

let bulkProc = null;
let bulkLog = [];
let bulkStatus = { running: false, log: [], done: 0, total: 0, current: '' };

async function apiBulkDownloadStart(req, res) {
  const body = await readBody(req);
  const urls = Array.isArray(body.urls) ? body.urls.filter(u => typeof u === 'string' && u.startsWith('http')) : [];
  if (!urls.length) return json(res, { error: 'No URLs provided' }, 400);
  if (bulkStatus.running) return json(res, { error: 'Already running' }, 409);

  bulkLog = [];
  bulkStatus = { running: true, log: [], done: 0, total: urls.length, current: '' };

  const pythonBin = process.platform === 'win32' ? 'python' : 'python3';
  const scriptPath = path.join(__dirname, '..', 'Bulkdownloader', 'bulkdownloader.py');
  const projectRoot = path.join(__dirname, '..');

  try {
    bulkProc = spawn(pythonBin, ['-u', scriptPath], {
      cwd: projectRoot,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
  } catch (e) {
    bulkStatus.running = false;
    return json(res, { error: e.message }, 500);
  }

  bulkProc.stdin.write(urls.join('\n') + '\ndone\n');
  bulkProc.stdin.end();

  const addLog = line => {
    bulkLog.push(line);
    if (bulkLog.length > 300) bulkLog.shift();
    bulkStatus.log = [...bulkLog];
    const m = line.match(/\[(\d+)\/(\d+)\]\s*Processing:/);
    if (m) {
      bulkStatus.done = parseInt(m[1]) - 1;
      bulkStatus.total = parseInt(m[2]);
      bulkStatus.current = line.replace(/^\[\d+\/\d+\]\s*/, '').trim();
    }
  };

  const feedLines = (buf, prefix) => {
    const parts = buf.split(/[\r\n]/);
    const remainder = parts.pop();
    for (const l of parts) { if (l.trim()) addLog(prefix + l.trim()); }
    return remainder;
  };

  let outBuf = '', errBuf = '';
  bulkProc.stdout.on('data', d => { outBuf = feedLines(outBuf + d.toString('utf8'), ''); });
  bulkProc.stderr.on('data', d => { errBuf = feedLines(errBuf + d.toString('utf8'), '[err] '); });

  bulkProc.on('error', err => {
    console.error('[bulk] spawn error:', err.message);
    bulkStatus.running = false;
    bulkStatus.log = [...bulkLog, '[error] ' + err.message];
    bulkProc = null;
  });

  bulkProc.on('close', code => {
    if (outBuf.trim()) addLog(outBuf.trim());
    if (errBuf.trim()) addLog('[err] ' + errBuf.trim());
    bulkStatus.running = false;
    bulkStatus.done = bulkStatus.total;
    bulkProc = null;
  });

  json(res, { ok: true, total: urls.length });
}

function apiBulkDownloadStatus(req, res) {
  json(res, bulkStatus);
}

function apiBulkDownloadStop(req, res) {
  if (bulkProc) { bulkProc.kill('SIGKILL'); bulkProc = null; }
  bulkStatus.running = false;
  json(res, { ok: true });
}

// ── Initialise on load ───────────────────────────────────────────────

loadDlConfig();
loadJobs();
processDownloadQueue();

module.exports = {
  apiDownloadAdd, apiDownloadJobs, apiDownloadRemove, apiDownloadRemoveAll, apiDownloadCancelAll, apiDownloadCheck,
  apiDownloadUpdateJob, apiDownloadRestartJob, apiDownloadPauseJob, apiDownloadResumeJob,
  apiDownloadGetConfig, apiDownloadSetConfig,
  apiReadDownloadQueue, apiWriteDownloadQueue, apiDownloadQueueAdd, apiDownloadQueueRemove,
  apiBulkDownloadStart, apiBulkDownloadStatus, apiBulkDownloadStop,
};
