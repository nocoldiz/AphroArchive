'use strict';
// ═══════════════════════════════════════════════════════════════════
//  media-zip-mount-server.js — Virtual folder view for ZIP archives
//  found in any media root (VIDEOS_DIR + sourceFolders).
//
//  Unencrypted ZIPs → categories in sidebar + videos in library.
//  Encrypted ZIPs   → hidden from normal view; vault mounts them
//                     via vault-zip-mount-server when the password
//                     matches (see getEncryptedZipPaths()).
//
//  Files are streamed on-demand; nothing is extracted to disk.
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { VIDEOS_DIR, MIME } = require('./config-server');
const { formatBytes: _fmtBytes } = require('./helpers-server');

// ── State ──────────────────────────────────────────────────────────
let _mounts     = {}; // mountId → MountInfo
let _entryIndex = {}; // entryId → { mountId, entry }
let _scanned    = false;
let _lastScanMs = 0;
const _SCAN_COOLDOWN_MS = 2000; // prevent rapid re-scans from fs.watch bursts

// MountInfo: { zipPath, displayName, basePath, rootFolderId,
//              entries: EntryInfo[], subFolders: { dirPath: folderId },
//              encrypted, mtime }
//
// EntryInfo: { entryId, filename, inZipDir, ext, size, compressedSize,
//              method, encryption, _aes, _localOff, _flags, crc,
//              parentFolderId }

function _clear() { _mounts = {}; _entryIndex = {}; }

// ── Walk dirs for ZIPs ─────────────────────────────────────────────
function _walkForZips(dir, base, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of ents) {
    const fp = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      _walkForZips(fp, base, out);
    } else if (ent.isFile() && /\.(zip|cbz)$/i.test(ent.name)) {
      const rel     = path.relative(base, fp).replace(/\\/g, '/');
      const parts   = rel.split('/');
      const catPath = parts.slice(0, -1).join('/'); // parent dir relative to base
      out.push({ zipPath: fp, zipName: ent.name, catPath, base });
    }
  }
}

// ── Index a single ZIP (reads structure, not content) ─────────────
function _indexZip(zipPath, zipName, catPath) {
  const zipReader  = require('./zip-reader-server');
  const rawEntries = zipReader.listEntriesFromPath(zipPath);

  const isEnc      = rawEntries.some(e => e.encrypted);
  const mountId    = crypto.randomUUID();
  const rootId     = crypto.randomUUID();
  const displayName = zipName.replace(/\.(zip|cbz)$/i, '');
  const basePath   = catPath ? catPath + '/' + displayName : displayName;

  // Collect unique directory paths within the ZIP
  const dirSet = new Set();
  for (const e of rawEntries) {
    const clean = e.name.replace(/\\/g, '/');
    if (e.isDir) {
      const p = clean.replace(/\/$/, '');
      if (p) dirSet.add(p);
    } else {
      const segs = clean.split('/');
      for (let i = 1; i < segs.length; i++) dirSet.add(segs.slice(0, i).join('/'));
    }
  }
  const subFolders = {};
  for (const dir of dirSet) subFolders[dir] = crypto.randomUUID();

  const entries = [];
  for (const e of rawEntries) {
    if (e.isDir) continue;
    const clean    = e.name.replace(/\\/g, '/');
    const segs     = clean.split('/');
    const filename = segs[segs.length - 1];
    if (!filename) continue;

    const inZipDir     = segs.length > 1 ? segs.slice(0, -1).join('/') : '';
    const ext          = path.extname(filename).toLowerCase();
    const parentFolder = inZipDir ? (subFolders[inZipDir] || rootId) : rootId;
    const entryId      = crypto.randomUUID();

    const entry = {
      entryId, filename, inZipDir, ext,
      size: e.size, compressedSize: e.compressedSize,
      method: e.method, encryption: e.encryption,
      _aes: e._aes, _localOff: e._localOff, _flags: e._flags, crc: e.crc,
      parentFolderId: parentFolder,
    };
    entries.push(entry);
    _entryIndex[entryId] = { mountId, entry };
  }

  let mtime = Date.now();
  try { mtime = fs.statSync(zipPath).mtimeMs; } catch {}

  _mounts[mountId] = { zipPath, displayName, catPath, basePath, rootFolderId: rootId, entries, subFolders, encrypted: isEnc, password: null, mtime };
  return mountId;
}

// ── Public: (re)scan all media roots ──────────────────────────────
function scanMediaZips() {
  _clear();
  _scanned = true;
  _lastScanMs = Date.now();

  const roots = [VIDEOS_DIR];
  try {
    const { loadPrefs } = require('./db-server');
    const prefs = loadPrefs();
    for (const sf of (prefs.sourceFolders || [])) {
      if (fs.existsSync(sf)) roots.push(sf);
    }
  } catch {}
  // Temporarily "opened" folders (Open folder button) — surface their ZIPs too.
  try {
    const { getOpenedRoots } = require('./opened-folders-server');
    for (const r of getOpenedRoots()) {
      if (!roots.includes(r) && fs.existsSync(r)) roots.push(r);
    }
  } catch {}

  const found = [];
  for (const root of roots) _walkForZips(root, root, found);

  // Deduplicate by absolute zip path
  const seen = new Set();
  for (const { zipPath, zipName, catPath } of found) {
    if (seen.has(zipPath)) continue;
    seen.add(zipPath);
    try { _indexZip(zipPath, zipName, catPath); }
    catch (e) { console.log(`[media-zip] skipping ${zipName}: ${e.message}`); }
  }

  console.log(`[media-zip] scanned ${seen.size} archive(s), ${Object.keys(_mounts).length} mounted`);
}

function ensureScanned() {
  if (!_scanned && Date.now() - _lastScanMs >= _SCAN_COOLDOWN_MS) scanMediaZips();
}

function invalidate() { _clear(); _scanned = false; }

// ── Categories ─────────────────────────────────────────────────────
// Returns { name, path, count, isZipMount } for each unencrypted ZIP
// and each of its in-zip subdirectories.
function getVirtualCategories() {
  ensureScanned();
  const out = [];
  for (const mount of Object.values(_mounts)) {
    if (mount.encrypted && !mount.password) {
      // Locked archive — a single clickable node that triggers a password prompt.
      out.push({ name: mount.displayName, path: mount.basePath, count: mount.entries.length, isZipMount: true, locked: true });
      continue;
    }
    // Root-level folder for the archive
    out.push({ name: mount.displayName, path: mount.basePath, count: mount.entries.length, isZipMount: true });
    // One entry per unique in-zip subdirectory
    for (const dirPath of Object.keys(mount.subFolders)) {
      const parts    = dirPath.split('/');
      const dirName  = parts[parts.length - 1];
      const subPath  = mount.basePath + '/' + dirPath;
      const subCount = mount.entries.filter(e => e.inZipDir === dirPath || e.inZipDir.startsWith(dirPath + '/')).length;
      out.push({ name: dirName, path: subPath, count: subCount, isZipMount: true });
    }
  }
  return out;
}

// ── Virtual videos ─────────────────────────────────────────────────
// catPathFilter: restrict to this category path (or null for all).
function getVirtualVideos(catPathFilter) {
  ensureScanned();
  const out = [];
  const filter = catPathFilter ? catPathFilter.toLowerCase() : null;

  for (const mount of Object.values(_mounts)) {
    if (mount.encrypted && !mount.password) continue; // locked — needs unlock first

    for (const entry of mount.entries) {
      const entryPath = entry.inZipDir ? mount.basePath + '/' + entry.inZipDir : mount.basePath;
      const epLo      = entryPath.toLowerCase();

      if (filter && epLo !== filter && !epLo.startsWith(filter + '/')) continue;

      out.push({
        id:           entry.entryId,
        name:         path.basename(entry.filename, entry.ext),
        originalName: entry.filename,
        ext:          entry.ext,
        size:         entry.size || 0,
        sizeF:        _fmtBytes(entry.size || 0),
        catPath:      entryPath,
        category:     mount.displayName,
        rel:          '',
        mtime:        mount.mtime,
        isZipMount:   true,
        streamUrl:    `/api/media-zip-stream/${entry.entryId}`,
        encrypted:    false,
        dur:          null,
        durFmt:       null,
        tags:         [],
      });
    }
  }
  return out;
}

// ── Encrypted ZIP paths (for vault integration) ────────────────────
// Returns [{ zipPath, displayName, catPath }] for encrypted ZIPs.
// Called by vault-zip-mount-server on unlock to try the vault password.
function getEncryptedZipPaths() {
  ensureScanned();
  return Object.values(_mounts)
    .filter(m => m.encrypted)
    .map(m => ({ zipPath: m.zipPath, displayName: m.displayName, catPath: m.catPath }));
}

// ── Streaming ──────────────────────────────────────────────────────
const _NC = { 'Cache-Control': 'no-store, no-cache, must-revalidate', Pragma: 'no-cache', Expires: '0' };

function _serveRange(req, res, plain, ct) {
  const raw = req.headers.range;
  if (raw) {
    const m = raw.match(/bytes=(\d+)-(\d*)/);
    if (!m) { res.writeHead(416); res.end(); return; }
    const start = parseInt(m[1], 10);
    const end   = m[2] ? Math.min(parseInt(m[2], 10), plain.length - 1) : plain.length - 1;
    if (start > end || start >= plain.length) { res.writeHead(416, { 'Content-Range': `bytes */${plain.length}` }); res.end(); return; }
    const chunk = plain.slice(start, end + 1);
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${plain.length}`, 'Accept-Ranges': 'bytes', 'Content-Length': chunk.length, 'Content-Type': ct, ..._NC });
    res.end(chunk);
  } else {
    res.writeHead(200, { 'Content-Length': plain.length, 'Content-Type': ct, 'Accept-Ranges': 'bytes', ..._NC });
    res.end(plain);
  }
}

function streamMediaZipEntry(req, res, entryId) {
  ensureScanned();
  const rec = _entryIndex[entryId];
  if (!rec) { res.writeHead(404); res.end('Not found'); return; }

  const mount = _mounts[rec.mountId];
  if (!mount) { res.writeHead(404); res.end('Mount gone'); return; }

  const entry = rec.entry;
  const ct    = MIME[entry.ext] || 'application/octet-stream';

  // Encrypted entry: only streamable once the archive has been unlocked with
  // the right password (held in-memory on the mount). Decrypt + decompress the
  // whole entry via the pure-Node zip reader, then serve the requested range.
  if (entry.encryption) {
    if (!mount.password) { res.writeHead(403); res.end('Encrypted archive — unlock first'); return; }
    let zbuf;
    try { zbuf = fs.readFileSync(mount.zipPath); }
    catch (e) { res.writeHead(500); res.end('Cannot read zip: ' + e.message); return; }
    let plainEnc;
    try {
      plainEnc = require('./zip-reader-server').extractEntry(zbuf, {
        name: entry.filename, method: entry.method, encryption: entry.encryption,
        encrypted: true, _aes: entry._aes, compressedSize: entry.compressedSize,
        size: entry.size, _localOff: entry._localOff, crc: entry.crc, _flags: entry._flags,
      }, mount.password);
    } catch (e) { res.writeHead(500); res.end('Decrypt failed: ' + e.message); return; }
    _serveRange(req, res, plainEnc, ct);
    return;
  }

  let buf;
  try { buf = fs.readFileSync(mount.zipPath); }
  catch (e) { res.writeHead(500); res.end('Cannot read zip: ' + e.message); return; }

  const lo = entry._localOff;
  if (!buf || buf.readUInt32LE(lo) !== 0x04034b50) { res.writeHead(500); res.end('Bad local header'); return; }
  const dataStart = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
  const rawData   = buf.slice(dataStart, dataStart + entry.compressedSize);

  let plain;
  try {
    plain = entry.method === 0 ? rawData : zlib.inflateRawSync(rawData);
  } catch (e) { res.writeHead(500); res.end('Decompression failed: ' + e.message); return; }

  _serveRange(req, res, plain, ct);
}

// ── Unlock an encrypted archive with a user-supplied password ──────
// Verifies the password against the smallest encrypted entry (cheap), then
// stores it on the mount so getVirtualCategories/Videos surface its contents
// and streamMediaZipEntry can decrypt on demand.
function unlockZip(basePath, password) {
  ensureScanned();
  const target = (basePath || '').toLowerCase();
  const mount = Object.values(_mounts).find(m => m.encrypted && m.basePath.toLowerCase() === target);
  if (!mount) return { error: 'Archive not found' };

  let buf;
  try { buf = fs.readFileSync(mount.zipPath); }
  catch { return { error: 'Cannot read archive' }; }

  const zipReader = require('./zip-reader-server');
  let entries;
  try { entries = zipReader.listEntries(buf); }
  catch { return { error: 'Invalid ZIP' }; }

  const enc = entries.filter(e => !e.isDir && e.encrypted).sort((a, b) => a.compressedSize - b.compressedSize);
  if (enc.length) {
    try { zipReader.extractEntry(buf, enc[0], password); }
    catch { return { error: 'Wrong password' }; }
  }
  mount.password = password;
  return { ok: true, path: mount.basePath };
}

async function apiMediaZipUnlock(req, res) {
  const { readBody, json } = require('./helpers-server');
  const body = await readBody(req);
  const target = (body.path || '').trim();
  if (!target) return json(res, { error: 'path required' }, 400);
  const r = unlockZip(target, body.password || '');
  if (r.error) return json(res, r, r.error === 'Wrong password' ? 401 : 400);
  // Notify clients so they reload and the now-unlocked archive appears.
  try { require('./videos-server').broadcastScanChange(); } catch {}
  json(res, r);
}

module.exports = { scanMediaZips, invalidate, getVirtualCategories, getVirtualVideos, getEncryptedZipPaths, streamMediaZipEntry, unlockZip, apiMediaZipUnlock };
