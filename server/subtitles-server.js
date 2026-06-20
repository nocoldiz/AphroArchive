'use strict';
// ═══════════════════════════════════════════════════════════════════
//  subtitles-server.js — Subtitle file management API
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { VIDEOS_DIR } = require('./config-server');
const { json, safePath, readBody } = require('./helpers-server');
const { loadPrefs } = require('./db-server');

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.3gp', '.ogv', '.ts']);
const SUBTITLE_EXT = new Set(['.vtt', '.srt', '.ass', '.ssa', '.sub', '.smi']);

function toId(rel) { return Buffer.from(rel).toString('base64url'); }
function fromId(id) { try { return Buffer.from(id, 'base64url').toString(); } catch { return null; } }

function resolveVideoPath(id) {
  const decoded = fromId(id);
  if (!decoded) return null;
  // Try as relative path inside VIDEOS_DIR first
  const relCandidate = path.join(VIDEOS_DIR, decoded);
  if (fs.existsSync(relCandidate)) return relCandidate;
  // Try as absolute (external folder)
  if (path.isAbsolute(decoded) && fs.existsSync(decoded)) return decoded;
  return null;
}

function findSubtitleFiles(videoFp) {
  const dir = path.dirname(videoFp);
  const base = path.basename(videoFp, path.extname(videoFp));
  const found = [];
  try {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isFile()) continue;
      const ext = path.extname(ent.name).toLowerCase();
      if (!SUBTITLE_EXT.has(ext)) continue;
      const nameNoExt = ent.name.slice(0, -ext.length);
      if (nameNoExt === base || nameNoExt.startsWith(base + '.')) {
        const fp = path.join(dir, ent.name);
        const stat = fs.statSync(fp);
        found.push({ name: ent.name, ext, fp, size: stat.size, mtime: stat.mtimeMs });
      }
    }
  } catch {}
  return found;
}

function scanDir(dir, base, isExternal, results) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'hidden' || e.name === 'Z') continue;
      scanDir(fp, base, isExternal, results);
    } else if (e.isFile() && VIDEO_EXT.has(path.extname(e.name).toLowerCase())) {
      const rel = isExternal ? fp : path.relative(base, fp).replace(/\\/g, '/');
      const id = toId(isExternal ? fp : rel);
      const subtitles = findSubtitleFiles(fp);
      const catPath = isExternal ? '' : path.dirname(rel).replace(/\\/g, '/').replace(/^\./, '');
      results.push({
        id,
        name: path.basename(e.name, path.extname(e.name)),
        filename: e.name,
        catPath: catPath || '',
        fp,
        subtitles,
        hasSubtitle: subtitles.length > 0,
      });
    }
  }
}

function scanAllVideosWithSubtitles() {
  const results = [];
  scanDir(VIDEOS_DIR, VIDEOS_DIR, false, results);
  try {
    const prefs = loadPrefs();
    if (Array.isArray(prefs.sourceFolders)) {
      for (const folder of prefs.sourceFolders) {
        if (fs.existsSync(folder)) scanDir(folder, folder, true, results);
      }
    }
  } catch {}
  return results;
}

// ── API Handlers ──────────────────────────────────────────────────────

function apiSubtitlesList(_req, res) {
  const items = scanAllVideosWithSubtitles();
  json(res, items.map(item => ({
    id: item.id,
    name: item.name,
    filename: item.filename,
    catPath: item.catPath,
    hasSubtitle: item.hasSubtitle,
    subtitles: item.subtitles.map(s => ({
      name: s.name,
      ext: s.ext,
      size: s.size,
      mtime: s.mtime,
    })),
  })));
}

function apiSubtitleContent(req, res, id) {
  const fp = resolveVideoPath(id);
  if (!fp) return json(res, { error: 'Video not found' }, 404);
  const subs = findSubtitleFiles(fp);
  if (!subs.length) return json(res, { error: 'No subtitle file found' }, 404);
  // Prefer VTT, then SRT, then first found
  const preferred = subs.find(s => s.ext === '.vtt') || subs.find(s => s.ext === '.srt') || subs[0];
  try {
    const content = fs.readFileSync(preferred.fp, 'utf8');
    json(res, { content, filename: preferred.name, ext: preferred.ext });
  } catch (e) {
    json(res, { error: 'Could not read subtitle file' }, 500);
  }
}

async function apiSaveSubtitleContent(req, res, id) {
  const fp = resolveVideoPath(id);
  if (!fp) return json(res, { error: 'Video not found' }, 404);
  const body = await readBody(req);
  const { content, ext } = body;
  if (typeof content !== 'string') return json(res, { error: 'content required' }, 400);

  const subs = findSubtitleFiles(fp);
  let targetFp;
  if (subs.length) {
    const preferred = subs.find(s => s.ext === '.vtt') || subs.find(s => s.ext === '.srt') || subs[0];
    targetFp = preferred.fp;
  } else {
    // Create new VTT file alongside the video
    const dir = path.dirname(fp);
    const base = path.basename(fp, path.extname(fp));
    targetFp = path.join(dir, base + (ext || '.vtt'));
  }

  try {
    fs.writeFileSync(targetFp, content, 'utf8');
    json(res, { ok: true, filename: path.basename(targetFp) });
  } catch (e) {
    json(res, { error: 'Could not write subtitle file: ' + e.message }, 500);
  }
}

function apiDeleteSubtitle(req, res, id) {
  const fp = resolveVideoPath(id);
  if (!fp) return json(res, { error: 'Video not found' }, 404);
  const subs = findSubtitleFiles(fp);
  if (!subs.length) return json(res, { error: 'No subtitle file found' }, 404);
  let deleted = 0;
  for (const s of subs) {
    try { fs.unlinkSync(s.fp); deleted++; } catch {}
  }
  json(res, { ok: true, deleted });
}

async function apiRegenerateBulk(req, res) {
  const body = await readBody(req);
  const ids = Array.isArray(body.ids) ? body.ids : [];
  if (!ids.length) return json(res, { error: 'ids required' }, 400);

  // Resolve file paths and delegate to whisper force-enqueue
  const genWhisper = require('./gen-whisper-server');
  let queued = 0;
  for (const id of ids) {
    const fp = resolveVideoPath(id);
    if (!fp) continue;
    genWhisper.forceEnqueue(fp);
    queued++;
  }
  json(res, { ok: true, queued });
}

module.exports = {
  apiSubtitlesList,
  apiSubtitleContent,
  apiSaveSubtitleContent,
  apiDeleteSubtitle,
  apiRegenerateBulk,
};
