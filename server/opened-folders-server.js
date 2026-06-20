'use strict';
// ═══════════════════════════════════════════════════════════════════
//  opened-folders.js — Temporary "Open folder" feature
//
//  Lets the user open an arbitrary folder from disk and browse its
//  media WITHOUT importing it into the library database. Opened folders
//  are scanned in-memory only; the list of opened paths is remembered in
//  prefs so they survive a restart (and reuse any thumbnails already
//  generated on disk, keyed by file id). Files from an opened folder are
//  never written to the video index — they can only be *copied* into a
//  real physical folder via the normal Move flow.
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { VIDEO_EXT, IMAGE_EXT, AUDIO_EXT, BOOK_EXT } = require('./config-server');
const { toId, json, readBody, formatBytes } = require('./helpers-server');
const { loadPrefs, savePrefs } = require('./db-server');

// rootPath(resolved) -> { path, name, items: [...] }
const _opened = new Map();
let _loaded = false;

function mediaTypeFor(ext) {
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (BOOK_EXT.has(ext))  return 'book';
  if (IMAGE_EXT.has(ext)) return 'photo';
  return null;
}

// Recursively collect every supported media file under `root`.
function scanRootSync(root) {
  const rootResolved = path.resolve(root);
  const rootName = path.basename(rootResolved) || rootResolved;
  const items = [];

  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const fp = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(fp); continue; }
      if (!ent.isFile()) continue;
      const ext = path.extname(ent.name).toLowerCase();
      const mediaType = mediaTypeFor(ext);
      if (!mediaType) continue;
      let st;
      try { st = fs.statSync(fp); } catch { continue; }
      const relDir = path.relative(rootResolved, path.dirname(fp)).replace(/\\/g, '/');
      const catPath = relDir && relDir !== '.' ? `${rootName}/${relDir}` : rootName;
      items.push({
        id: toId(fp),
        name: path.basename(ent.name, ext),
        filename: ent.name,
        ext,
        rel: fp,
        path: fp,
        category: catPath.replace(/\//g, ' / '),
        catPath,
        mediaType,
        size: st.size,
        sizeF: formatBytes(st.size),
        modified: st.mtime.toISOString(),
        mtime: st.mtimeMs,
        isExternal: true,
        isOpened: true,
        openedRoot: rootResolved,
      });
    }
  };

  walk(rootResolved);
  // Sort: videos first, then by name — a sensible default browse order.
  items.sort((a, b) => a.name.localeCompare(b.name));
  return { path: rootResolved, name: rootName, items };
}

// Re-scan any opened paths persisted in prefs on first access (post-restart).
function ensureLoaded() {
  if (_loaded) return;
  _loaded = true;
  let prefs;
  try { prefs = loadPrefs(); } catch { prefs = {}; }
  const paths = Array.isArray(prefs.openedFolders) ? prefs.openedFolders : [];
  for (const p of paths) {
    const resolved = path.resolve(p);
    if (_opened.has(resolved)) continue;
    if (!fs.existsSync(resolved)) continue;
    try { _opened.set(resolved, scanRootSync(resolved)); } catch {}
  }
}

function persist() {
  try {
    const prefs = loadPrefs();
    prefs.openedFolders = [..._opened.keys()];
    savePrefs(prefs);
  } catch {}
}

// ── Public accessors (synchronous — used inside safePath etc.) ─────────

function getOpenedRoots() {
  ensureLoaded();
  return [..._opened.keys()];
}

function isOpenedPath(fp) {
  ensureLoaded();
  const resolved = path.resolve(fp);
  for (const root of _opened.keys()) {
    if (resolved === root || resolved.startsWith(root + path.sep)) return true;
  }
  return false;
}

function getOpenedItems() {
  ensureLoaded();
  const out = [];
  for (const o of _opened.values()) out.push(...o.items);
  return out;
}

// Folder entries (including nested subfolders) for the sidebar folder list.
function getOpenedFolderEntries() {
  ensureLoaded();
  const map = new Map(); // path -> { name, path, count, opened, openedRoot }
  for (const o of _opened.values()) {
    // Always surface the root folder, even if it currently has no media.
    if (!map.has(o.name)) {
      map.set(o.name, { name: o.name, path: o.name, count: 0, opened: true, openedRoot: o.path });
    }
    for (const it of o.items) {
      const parts = it.catPath.split('/');
      let cur = '';
      for (const part of parts) {
        cur = cur ? `${cur}/${part}` : part;
        if (!map.has(cur)) {
          map.set(cur, { name: cur.replace(/\//g, ' / '), path: cur, count: 0, opened: true, openedRoot: o.path });
        }
        map.get(cur).count++;
      }
    }
  }
  return [...map.values()];
}

// ── API handlers ──────────────────────────────────────────────────────

async function apiOpenedOpen(req, res) {
  const body = await readBody(req);
  const target = (body.path || '').trim();
  if (!target) return json(res, { error: 'path required' }, 400);
  const resolved = path.resolve(target);
  let stat;
  try { stat = fs.statSync(resolved); } catch { return json(res, { error: 'Folder not found' }, 404); }
  if (!stat.isDirectory()) return json(res, { error: 'Not a folder' }, 400);

  ensureLoaded();
  const scanned = scanRootSync(resolved);
  _opened.set(resolved, scanned);
  persist();
  // Re-index ZIP archives so any in this newly opened folder are surfaced.
  try { require('./media-zip-mount-server').invalidate(); } catch {}
  // New file ids are now streamable/thumbnailable (safePath allows opened roots).
  try { require('./videos-server').broadcastScanChange(); } catch {}
  json(res, { ok: true, folder: { name: scanned.name, path: scanned.name, openedRoot: resolved }, count: scanned.items.length });
}

function apiOpenedList(req, res) {
  ensureLoaded();
  json(res, { folders: getOpenedFolderEntries(), items: getOpenedItems() });
}

async function apiOpenedClose(req, res) {
  const body = await readBody(req);
  const target = (body.path || '').trim();
  if (!target) return json(res, { error: 'path required' }, 400);
  const resolved = path.resolve(target);
  ensureLoaded();
  const existed = _opened.delete(resolved);
  if (existed) persist();
  try { require('./media-zip-mount-server').invalidate(); } catch {}
  try { require('./videos-server').broadcastScanChange(); } catch {}
  json(res, { ok: true, closed: existed });
}

module.exports = {
  getOpenedRoots,
  isOpenedPath,
  getOpenedItems,
  getOpenedFolderEntries,
  apiOpenedOpen,
  apiOpenedList,
  apiOpenedClose,
};
