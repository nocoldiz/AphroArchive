'use strict';
// ═══════════════════════════════════════════════════════════════════
//  downloads.js — yt-dlp download queue API handlers
// ═══════════════════════════════════════════════════════════════════

const fs              = require('fs');
const path            = require('path');
const { spawn, execFile } = require('child_process');
const { VIDEOS_DIR, YT_DLP_BIN, LINK_DIR } = require('./config-server');
const { json, readBody, toId }            = require('./helpers-server');

// ── Queue state ──────────────────────────────────────────────────────

const downloadJobs = new Map();
let dlRunning = false;

function nextDlId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function enqueueDownload(dlUrl, category) {
  const id = nextDlId();
  downloadJobs.set(id, {
    id, url: dlUrl, title: dlUrl, category: category || '',
    status: 'queued', progress: 0, speed: '', eta: '', error: null,
    addedAt: Date.now(), _kill: null,
  });
  processDownloadQueue();
  return id;
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
      console.log(`[download-conv] Marked link as downloaded: ${url}${localVideoId ? ' → ' + localVideoId : ''}`);

      const { invalidateScanCache, initVideoMeta } = require('./videos-server');
      invalidateScanCache();
      initVideoMeta().catch(err => console.error('initVideoMeta failed after link download:', err));
    }
  } catch (err) {
    console.error('Failed to mark link as downloaded:', err);
  }
}

async function processDownloadQueue() {
  if (dlRunning) return;
  const next = [...downloadJobs.values()].find(j => j.status === 'queued');
  if (!next) return;
  dlRunning    = true;
  next.status  = 'running';
  try {
    await runYtDlp(next);
    next.status   = 'done';
    next.progress = 100;
    if (next.outputPath && fs.existsSync(next.outputPath)) {
      const rel = path.relative(VIDEOS_DIR, next.outputPath);
      next.videoId = toId(rel);
    }
    await handleLinkConversion(next.url, next.videoId);
  } catch (e) {
    if (downloadJobs.has(next.id)) { next.status = 'error'; next.error = e.message; }
  } finally {
    dlRunning = false;
    processDownloadQueue();
  }
}

function runYtDlp(job) {
  return new Promise((resolve, reject) => {
    const cleanCat = (job.category || '').trim();
    const isVirtual = cleanCat.toLowerCase() === 'links' || cleanCat.toLowerCase() === 'uncategorized';
    const physicalCat = isVirtual ? '' : cleanCat;
    const outDir = physicalCat ? path.join(VIDEOS_DIR, physicalCat) : VIDEOS_DIR;
    try { fs.mkdirSync(outDir, { recursive: true }); } catch {}

    const proc = spawn(YT_DLP_BIN, [
      '--no-playlist', '--progress', '--newline',
      '--merge-output-format', 'mp4',
      '-o', path.join(outDir, '%(title)s.%(ext)s'),
      job.url,
    ]);
    job._kill = () => proc.kill('SIGKILL');

    const parseLine = line => {
      const dst = line.match(/\[download\] Destination:\s*(.+)/);
      if (dst) { job.title = path.basename(dst[1].trim()).replace(/\.[^.]+$/, ''); job.outputPath = dst[1].trim(); }
      const merger = line.match(/\[Merger\] Merging formats into "(.+)"/);
      if (merger) job.outputPath = merger[1].trim();
      const already = line.match(/\[download\] (.+) has already been downloaded/);
      if (already) { job.title = path.basename(already[1].trim()).replace(/\.[^.]+$/, ''); job.progress = 100; job.outputPath = already[1].trim(); }
      const prog = line.match(/\[download\]\s+([\d.]+)%.*?at\s+(\S+)\s+ETA\s+(\S+)/);
      if (prog) { job.progress = parseFloat(prog[1]); job.speed = prog[2]; job.eta = prog[3]; }
    };

    let oBuf = '', eBuf = '';
    const feed = (buf, data) => {
      buf += data.toString();
      const lines = buf.split('\n'); buf = lines.pop();
      lines.forEach(parseLine); return buf;
    };
    proc.stdout.on('data', d => { oBuf = feed(oBuf, d); });
    proc.stderr.on('data', d => { eBuf = feed(eBuf, d); });

    proc.on('close', code => {
      if (oBuf) parseLine(oBuf);
      if (eBuf) parseLine(eBuf);
      code === 0 ? resolve() : reject(new Error('yt-dlp exited with code ' + code));
    });
    proc.on('error', err => reject(new Error(
      err.code === 'ENOENT'
        ? 'yt-dlp not found — place yt-dlp.exe next to AphroArchive.exe or add it to PATH'
        : err.message
    )));
  });
}

// ── Download API handlers ────────────────────────────────────────────

async function apiDownloadAdd(req, res) {
  const body = await readBody(req);
  // Per-item category support: { items: [{ url, category }] }
  if (Array.isArray(body.items)) {
    const valid = body.items.filter(i => i?.url);
    if (!valid.length) return json(res, { error: 'No valid items' }, 400);
    const ids = valid.map(i => enqueueDownload(i.url, i.category || ''));
    return json(res, { ok: true, ids });
  }
  const urls = Array.isArray(body.urls) ? body.urls : (body.url ? [body.url] : []);
  if (!urls.length) return json(res, { error: 'URL required' }, 400);
  const category = (body.category || '').trim();
  const ids      = urls.map(u => enqueueDownload(u, category));
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
  if (job.status === 'running' && job._kill) job._kill();
  downloadJobs.delete(id);
  json(res, { ok: true });
}

function apiDownloadCheck(req, res) {
  execFile(YT_DLP_BIN, ['--version'], { timeout: 5000 }, (err, stdout) => {
    if (err) return json(res, { available: false, bin: YT_DLP_BIN });
    json(res, { available: true, version: stdout.trim(), bin: YT_DLP_BIN });
  });
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
  const scriptPath = path.join(__dirname, '..', 'bulkdowloader.py');
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
    console.log('[bulk]', line);
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

  // Split on \r or \n so carriage-return progress lines are captured immediately
  const feedLines = (buf, prefix) => {
    const parts = buf.split(/[\r\n]/);
    const remainder = parts.pop(); // last incomplete chunk
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
    console.log('[bulk] process exited with code', code);
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

module.exports = {
  apiDownloadAdd, apiDownloadJobs, apiDownloadRemove, apiDownloadCheck,
  apiReadDownloadQueue, apiWriteDownloadQueue, apiDownloadQueueAdd, apiDownloadQueueRemove,
  apiBulkDownloadStart, apiBulkDownloadStatus, apiBulkDownloadStop,
};
