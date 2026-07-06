'use strict';
// ═══════════════════════════════════════════════════════════════════
//  imports-server.js — Import library metadata from other players and
//  read/write Kodi-standard .nfo sidecars.
//
//  All importers match external records to library videos by FILENAME
//  (basename, case-insensitive) — the one identifier every player shares
//  with AphroArchive's file-based library. Ratings, watch state, titles,
//  tags, actors, plot and year are merged into the existing video meta;
//  nothing is overwritten with blanks.
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { VIDEOS_DIR, VIDEO_EXT } = require('./config-server');
const { json, readBody } = require('./helpers-server');
const {
  loadHistory, saveHistory,
  loadVideoMeta, setVideoMetaFields,
} = require('./db-server');

// ── Shared: build a basename → video map from the current library ─────
async function _videoByFilename() {
  const videos = require('./videos-server');
  const all = await videos.allVideos();
  const map = new Map();
  for (const v of all) {
    if (v.isLink) continue;
    const fn = (v.filename || path.basename(v.rel || '') || '').toLowerCase();
    if (fn && !map.has(fn)) map.set(fn, v);
    // also index by name (basename without extension) as a fallback key
    const nm = (v.name || '').toLowerCase();
    if (nm && !map.has('name:' + nm)) map.set('name:' + nm, v);
  }
  return map;
}

// Match a source file path / title to a library video.
function _matchVideo(map, filePath, title) {
  if (filePath) {
    const base = path.basename(String(filePath).replace(/\\/g, '/')).toLowerCase();
    if (map.has(base)) return map.get(base);
    const noExt = base.replace(/\.[^.]+$/, '');
    if (map.has('name:' + noExt)) return map.get('name:' + noExt);
  }
  if (title) {
    const t = String(title).trim().toLowerCase();
    if (map.has('name:' + t)) return map.get('name:' + t);
  }
  return null;
}

// Apply a normalised metadata record to a video. Only sets fields that carry
// real values so an import never clobbers existing meta with empties.
function _applyMeta(video, rec, historyIds) {
  const existing = loadVideoMeta()[video.id] || {};
  const fields = {};
  if (Number.isFinite(rec.rating) && rec.rating >= 1 && rec.rating <= 5) fields.rating = rec.rating;
  if (rec.title && !existing.title) fields.title = rec.title;
  if (rec.note && !existing.note) fields.note = rec.note;
  if (rec.date && !existing.date) fields.date = rec.date;
  if (rec.channel && !existing.channel) fields.channel = rec.channel;
  if (Array.isArray(rec.tags) && rec.tags.length) {
    fields.tags = [...new Set([...(existing.tags || []), ...rec.tags])];
  }
  if (Array.isArray(rec.actors) && rec.actors.length) {
    fields.actors = [...new Set([...(existing.actors || []), ...rec.actors])];
  }
  if (Object.keys(fields).length) setVideoMetaFields(video.id, fields);
  if (rec.watched && historyIds) historyIds.push({ id: video.id, at: rec.watchedAt || 0 });
  return Object.keys(fields).length > 0 || !!rec.watched;
}

// Merge collected watched ids into the history list (most-recent first).
function _mergeHistory(historyIds) {
  if (!historyIds.length) return;
  historyIds.sort((a, b) => (b.at || 0) - (a.at || 0));
  const seen = new Set();
  const fresh = [];
  for (const h of historyIds) { if (!seen.has(h.id)) { seen.add(h.id); fresh.push(h.id); } }
  const existing = loadHistory().filter(id => !seen.has(id));
  let merged = [...fresh, ...existing];
  if (merged.length > 100) merged = merged.slice(0, 100);
  saveHistory(merged);
}

// ═══════════════════════════════════════════════════════════════════
//  PLEX — read com.plexapp.plugins.library.db (ratings + watch state)
// ═══════════════════════════════════════════════════════════════════

async function apiImportPlex(req, res) {
  const body = await readBody(req);
  const dbPath = String(body.dbPath || '').trim();
  if (!dbPath) return json(res, { error: 'Plex database path required' }, 400);
  if (!fs.existsSync(dbPath)) return json(res, { error: 'Database file not found' }, 400);

  // Open a temp copy read-only so a running Plex instance is never disturbed
  // and its WAL locks don't block us.
  let tmp = null;
  let pdb = null;
  try {
    const os = require('os');
    tmp = path.join(os.tmpdir(), 'plex-import-' + process.pid + '.db');
    fs.copyFileSync(dbPath, tmp);
    // Carry the WAL/SHM sidecars so recent, un-checkpointed writes are visible.
    // Opened read-write (on the throwaway copy) so SQLite can checkpoint the WAL
    // itself — read-only opens of a WAL database can fail to attach the log.
    for (const ext of ['-wal', '-shm']) { try { if (fs.existsSync(dbPath + ext)) fs.copyFileSync(dbPath + ext, tmp + ext); } catch {} }
    const { DatabaseSync } = eval("require('node:sqlite')");
    pdb = new DatabaseSync(tmp);

    const rows = pdb.prepare(`
      SELECT mp.file AS file,
             mi.user_rating AS user_rating,
             mi.view_count  AS view_count,
             mi.last_viewed_at AS last_viewed_at,
             mi.title AS title,
             mi.originally_available_at AS available,
             mi.summary AS summary
      FROM media_parts mp
      JOIN media_items    m  ON mp.media_item_id  = m.id
      JOIN metadata_items mi ON m.metadata_item_id = mi.id
      WHERE mp.file IS NOT NULL
    `).all();

    const map = await _videoByFilename();
    const historyIds = [];
    let matched = 0, ratings = 0, watched = 0;

    for (const r of rows) {
      const v = _matchVideo(map, r.file, r.title);
      if (!v) continue;
      matched++;
      const rec = {
        title: r.title || '',
        note: r.summary || '',
        date: r.available ? String(r.available).slice(0, 10) : '',
        rating: r.user_rating != null ? Math.max(1, Math.min(5, Math.round(r.user_rating / 2))) : null,
        watched: r.view_count > 0,
        watchedAt: r.last_viewed_at ? Date.parse(r.last_viewed_at) || 0 : 0,
      };
      if (rec.rating) ratings++;
      if (rec.watched) watched++;
      _applyMeta(v, rec, historyIds);
    }
    _mergeHistory(historyIds);

    try { require('./videos-server').broadcastScanChange(); } catch {}
    json(res, { ok: true, total: rows.length, matched, ratings, watched });
  } catch (e) {
    json(res, { error: 'Plex import failed: ' + e.message }, 500);
  } finally {
    try { if (pdb) pdb.close(); } catch {}
    if (tmp) { for (const ext of ['', '-wal', '-shm']) { try { fs.rmSync(tmp + ext, { force: true }); } catch {} } }
  }
}

// ═══════════════════════════════════════════════════════════════════
//  NFO — parse Kodi/Jellyfin .nfo sidecars (shared XML schema)
// ═══════════════════════════════════════════════════════════════════

function _xmlText(xml, tag) {
  const m = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i').exec(xml);
  return m ? _unescapeXml(m[1].trim()) : '';
}
function _xmlAll(xml, tag) {
  const out = [];
  const re = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'ig');
  let m;
  while ((m = re.exec(xml)) !== null) { const t = _unescapeXml(m[1].trim()); if (t) out.push(t); }
  return out;
}
function _unescapeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function _escapeXml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Convert one .nfo document into a normalised metadata record.
function _parseNfo(xml) {
  const title = _xmlText(xml, 'title') || _xmlText(xml, 'originaltitle');
  const note = _xmlText(xml, 'plot') || _xmlText(xml, 'outline');
  const premiered = _xmlText(xml, 'premiered') || _xmlText(xml, 'aired');
  const year = _xmlText(xml, 'year');
  const date = premiered || (year ? year : '');
  const channel = _xmlText(xml, 'studio');

  // Rating: prefer <userrating> (0-10), fall back to <rating> (0-10 float).
  let ratingRaw = _xmlText(xml, 'userrating');
  if (!ratingRaw) ratingRaw = _xmlText(xml, 'rating');
  let rating = null;
  const rn = parseFloat(ratingRaw);
  if (Number.isFinite(rn) && rn > 0) rating = Math.max(1, Math.min(5, Math.round(rn / 2)));

  const tags = [..._xmlAll(xml, 'genre'), ..._xmlAll(xml, 'tag')];
  // Actor names live in <actor><name>…</name></actor>; pull each block's name.
  const actors = [];
  const actorRe = /<actor\b[^>]*>([\s\S]*?)<\/actor>/ig;
  let am;
  while ((am = actorRe.exec(xml)) !== null) {
    const nm = _xmlText(am[1], 'name');
    if (nm) actors.push(nm);
  }

  const playcount = parseInt(_xmlText(xml, 'playcount'), 10);
  const watchedTag = _xmlText(xml, 'watched').toLowerCase();
  const lastplayed = _xmlText(xml, 'lastplayed');
  const watched = (Number.isFinite(playcount) && playcount > 0) || watchedTag === 'true';

  return {
    title, note, date, channel, rating,
    tags: [...new Set(tags)], actors: [...new Set(actors)],
    watched, watchedAt: lastplayed ? Date.parse(lastplayed) || 0 : 0,
  };
}

// Recursively collect .nfo files under a root (bounded to avoid runaways).
function _findNfos(root, out, budget) {
  if (out.length >= budget.max) return;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (out.length >= budget.max) return;
    const full = path.join(root, ent.name);
    if (ent.isDirectory()) { _findNfos(full, out, budget); }
    else if (ent.isFile() && ent.name.toLowerCase().endsWith('.nfo')) out.push(full);
  }
}

// For a .nfo path, find the sibling video's basename (foo.nfo → foo.mkv), or
// null for library/season nfos with no single companion.
function _siblingVideoFilename(nfoPath) {
  const dir = path.dirname(nfoPath);
  const base = path.basename(nfoPath, path.extname(nfoPath)); // strip .nfo
  const lower = base.toLowerCase();
  if (lower === 'movie' || lower === 'tvshow' || lower === 'season' || lower === 'index') return null;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f === path.basename(nfoPath)) continue;
      const ext = path.extname(f).toLowerCase();
      if (VIDEO_EXT.has(ext) && path.basename(f, path.extname(f)).toLowerCase() === lower) return f;
    }
  } catch {}
  return null;
}

// Shared handler for Jellyfin/Kodi NFO folder imports.
async function _importNfoFolder(res, folderPath, label) {
  if (!folderPath) return json(res, { error: 'Folder path required' }, 400);
  if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
    return json(res, { error: 'Folder not found' }, 400);
  }

  const nfos = [];
  _findNfos(folderPath, nfos, { max: 20000 });

  const map = await _videoByFilename();
  const historyIds = [];
  let matched = 0, applied = 0, ratings = 0, watched = 0;

  for (const nfoPath of nfos) {
    let xml;
    try { xml = fs.readFileSync(nfoPath, 'utf-8'); } catch { continue; }
    const rec = _parseNfo(xml);
    const sibling = _siblingVideoFilename(nfoPath);
    const v = _matchVideo(map, sibling || nfoPath, rec.title);
    if (!v) continue;
    matched++;
    if (rec.rating) ratings++;
    if (rec.watched) watched++;
    if (_applyMeta(v, rec, historyIds)) applied++;
  }
  _mergeHistory(historyIds);

  try { require('./videos-server').broadcastScanChange(); } catch {}
  json(res, { ok: true, source: label, nfoFiles: nfos.length, matched, applied, ratings, watched });
}

async function apiImportJellyfin(req, res) {
  const body = await readBody(req);
  await _importNfoFolder(res, String(body.path || '').trim(), 'jellyfin');
}

async function apiImportKodiNfo(req, res) {
  const body = await readBody(req);
  await _importNfoFolder(res, String(body.path || '').trim(), 'kodi');
}

// ═══════════════════════════════════════════════════════════════════
//  NFO EXPORT — write Kodi-standard <movie>.nfo sidecars next to files
// ═══════════════════════════════════════════════════════════════════

function _buildNfo(video, meta) {
  const L = [];
  L.push('<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>');
  L.push('<movie>');
  L.push('  <title>' + _escapeXml(meta.title || video.name || '') + '</title>');
  if (meta.note) L.push('  <plot>' + _escapeXml(meta.note) + '</plot>');
  if (meta.rating) L.push('  <userrating>' + (meta.rating * 2) + '</userrating>');
  if (meta.date) {
    const y = /^\d{4}/.exec(String(meta.date));
    if (/^\d{4}-\d{2}-\d{2}/.test(String(meta.date))) L.push('  <premiered>' + _escapeXml(meta.date) + '</premiered>');
    if (y) L.push('  <year>' + y[0] + '</year>');
  }
  if (meta.channel) L.push('  <studio>' + _escapeXml(meta.channel) + '</studio>');
  for (const g of (meta.tags || [])) L.push('  <genre>' + _escapeXml(g) + '</genre>');
  for (const a of (meta.actors || [])) {
    L.push('  <actor>');
    L.push('    <name>' + _escapeXml(a) + '</name>');
    L.push('  </actor>');
  }
  L.push('  <playcount>' + (meta.watched ? 1 : 0) + '</playcount>');
  if (meta.watched) L.push('  <watched>true</watched>');
  L.push('</movie>');
  return L.join('\n');
}

async function apiExportNfo(req, res) {
  const videos = require('./videos-server');
  const all = await videos.allVideos();
  const metaAll = loadVideoMeta();
  let written = 0, skipped = 0;
  const errors = [];

  for (const v of all) {
    if (v.isLink) continue;
    const meta = metaAll[v.id];
    // Only write sidecars for videos that actually carry metadata worth keeping.
    if (!meta || !(meta.title || meta.note || meta.rating || (meta.tags || []).length ||
        (meta.actors || []).length || meta.channel || meta.date)) { skipped++; continue; }

    const abs = v.isExternal ? v.rel : path.join(VIDEOS_DIR, v.rel);
    if (!fs.existsSync(abs)) { skipped++; continue; }
    const nfoPath = abs.replace(/\.[^.\\/]+$/, '') + '.nfo';
    try {
      fs.writeFileSync(nfoPath, _buildNfo(v, meta), 'utf-8');
      written++;
    } catch (e) { errors.push({ file: path.basename(abs), error: e.message }); }
  }

  json(res, { ok: true, written, skipped, errors: errors.slice(0, 20) });
}

module.exports = {
  apiImportPlex, apiImportJellyfin, apiImportKodiNfo, apiExportNfo,
};
