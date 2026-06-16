'use strict';
// ═══════════════════════════════════════════════════════════════════
//  vault-zip-mount-server.js — Mount password-protected ZIP files
//  from VAULT_DIR as virtual read-only folders in the vault.
//
//  ZIP files placed in VAULT_DIR and encrypted with the same
//  password as the vault are scanned on each unlock. Their contents
//  appear as virtual vault folders/files without being extracted.
//  Videos stream directly out of the ZIP with range-request support.
//
//  Supported: WinZip AES-256 (stored/deflate), unencrypted entries,
//             ZipCrypto (deflate fallback, no seeking).
// ═══════════════════════════════════════════════════════════════════

'use strict';
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const { VAULT_DIR, MIME } = require('./config-server');
const { formatBytes: _fmtBytes } = require('./helpers-server');

// ── In-memory mount state (cleared on vault lock) ────────────────────
// _mounts:     { mountId: MountInfo }
// _entryIndex: { entryId: { mountId, entry: EntryInfo } }
let _mounts     = {};
let _entryIndex = {};

// MountInfo shape:
// { zipPath, displayName, password, rootFolderId,
//   entries: EntryInfo[], subFolders: { 'path/in/zip': folderId } }
//
// EntryInfo shape:
// { entryId, filename, ext, size, compressedSize, method,
//   encryption, aes, localOff, dataStart, flags, crc,
//   parentFolderId }

function unmountAll() {
  _mounts     = {};
  _entryIndex = {};
}

// Drop a single mount and purge its entry-index records.
function _removeMount(mountId) {
  const m = _mounts[mountId];
  if (!m) return false;
  for (const e of m.entries) delete _entryIndex[e.entryId];
  delete _mounts[mountId];
  return true;
}

// Resolve any virtual id surfaced by getMountedItems() — a mounted file
// entryId, the archive's root folder id, or a virtual sub-folder id — back to
// its owning mount. Returns null for ids that aren't part of any mount.
// `vaultId` is the backing vault .enc id (null for raw/media-folder zips).
function resolveMount(id) {
  const rec = _entryIndex[id];
  if (rec) {
    const m = _mounts[rec.mountId];
    return { mountId: rec.mountId, vaultId: (m && m.vaultId) || null, isFile: true, isRoot: false };
  }
  for (const [mountId, m] of Object.entries(_mounts)) {
    if (m.rootFolderId === id) {
      return { mountId, vaultId: m.vaultId || null, isFile: false, isRoot: true };
    }
    if (Object.values(m.subFolders).includes(id)) {
      return { mountId, vaultId: m.vaultId || null, isFile: false, isRoot: false };
    }
  }
  return null;
}

// Unmount the archive backed by a given vault .enc id (called after that file
// is deleted so its virtual folders/files vanish from the listing immediately).
function unmountByVaultId(vaultId) {
  for (const [mountId, m] of Object.entries(_mounts)) {
    if (m.vaultId === vaultId) return _removeMount(mountId);
  }
  return false;
}

// ── Minimal ZIP index reader (reads only headers, not file data) ─────

function _parseAesExtra(extra) {
  let p = 0;
  while (p + 4 <= extra.length) {
    const id = extra.readUInt16LE(p);
    const sz = extra.readUInt16LE(p + 2);
    if (id === 0x9901 && p + 4 + sz <= extra.length) {
      return {
        strength:     extra[p + 8],
        actualMethod: extra.readUInt16LE(p + 9),
      };
    }
    p += 4 + sz;
  }
  return null;
}

// Read central directory and local header offsets without loading the
// entire zip data into memory. Returns an array of entry descriptors.
function _readZipIndex(zipPath) {
  const stat     = fs.statSync(zipPath);
  const fileSize = stat.size;
  if (fileSize < 22) throw new Error('File too small to be a ZIP');

  const fd = fs.openSync(zipPath, 'r');
  try {
    // ── Step 1: find EOCD ──────────────────────────────────────────
    const scanLen = Math.min(65557, fileSize);
    const eocdBuf = Buffer.alloc(scanLen);
    fs.readSync(fd, eocdBuf, 0, scanLen, fileSize - scanLen);

    let eocdRel = -1;
    for (let i = scanLen - 22; i >= 0; i--) {
      if (eocdBuf.readUInt32LE(i) === 0x06054b50) { eocdRel = i; break; }
    }
    if (eocdRel < 0) throw new Error('No EOCD record');

    const entryCount = eocdBuf.readUInt16LE(eocdRel + 10);
    const cdSize     = eocdBuf.readUInt32LE(eocdRel + 12);
    const cdOffset   = eocdBuf.readUInt32LE(eocdRel + 16);

    // ── Step 2: read central directory ────────────────────────────
    const cdBuf = Buffer.alloc(cdSize);
    fs.readSync(fd, cdBuf, 0, cdSize, cdOffset);

    const entries = [];
    let p = 0;
    for (let i = 0; i < entryCount; i++) {
      if (p + 46 > cdBuf.length || cdBuf.readUInt32LE(p) !== 0x02014b50) break;
      const flags      = cdBuf.readUInt16LE(p + 8);
      const method     = cdBuf.readUInt16LE(p + 10);
      const crc        = cdBuf.readUInt32LE(p + 16);
      const compSize   = cdBuf.readUInt32LE(p + 20);
      const uncompSize = cdBuf.readUInt32LE(p + 24);
      const nameLen    = cdBuf.readUInt16LE(p + 28);
      const extraLen   = cdBuf.readUInt16LE(p + 30);
      const commentLen = cdBuf.readUInt16LE(p + 32);
      const localOff   = cdBuf.readUInt32LE(p + 42);
      const name       = cdBuf.slice(p + 46, p + 46 + nameLen).toString('utf-8');
      const extra      = cdBuf.slice(p + 46 + nameLen, p + 46 + nameLen + extraLen);

      const encrypted = (flags & 0x0001) !== 0;
      const aes       = method === 99 ? _parseAesExtra(extra) : null;
      const encryption = method === 99 ? 'aes' : (encrypted ? 'zipcrypto' : null);

      entries.push({
        name, isDir: name.endsWith('/'), encrypted,
        encryption, method, crc, size: uncompSize,
        compressedSize: compSize, localOff, flags, aes,
        dataStart: 0, // filled in step 3
      });
      p += 46 + nameLen + extraLen + commentLen;
    }

    // ── Step 3: resolve actual data start from each local header ──
    // We only need 30 bytes per local header to get name+extra lengths.
    const lhBuf = Buffer.alloc(30);
    for (const e of entries) {
      if (e.isDir) continue;
      try {
        fs.readSync(fd, lhBuf, 0, 30, e.localOff);
        const lhNameLen  = lhBuf.readUInt16LE(26);
        const lhExtraLen = lhBuf.readUInt16LE(28);
        e.dataStart = e.localOff + 30 + lhNameLen + lhExtraLen;
      } catch { /* skip corrupt entry */ }
    }

    return entries;
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
}

// ── Password verification for WinZip AES entries ─────────────────────
// Derives the verification bytes and compares without full decryption.
function _verifyAesPassword(zipPath, entry, password) {
  const strength = entry.aes ? entry.aes.strength : 3;
  const saltLen  = strength === 1 ? 8 : strength === 2 ? 12 : 16;
  const keyLen   = strength === 1 ? 16 : strength === 2 ? 24 : 32;

  const fd = fs.openSync(zipPath, 'r');
  try {
    const salt = Buffer.alloc(saltLen);
    fs.readSync(fd, salt, 0, saltLen, entry.dataStart);
    const storedVerif = Buffer.alloc(2);
    fs.readSync(fd, storedVerif, 0, 2, entry.dataStart + saltLen);

    const km    = crypto.pbkdf2Sync(password, salt, 1000, keyLen * 2 + 2, 'sha1');
    const verif = km.slice(keyLen * 2, keyLen * 2 + 2);
    return verif.equals(storedVerif);
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
}

// ── CTR seek helper (WinZip AES-256, little-endian counter from 1) ───
// Decrypts cipherSlice, where startByte is the byte offset of the
// first cipher byte within the full plaintext stream.
function _winzipCtrSlice(encKey, cipherSlice, startByte) {
  if (!cipherSlice.length) return Buffer.alloc(0);
  const startBlock   = Math.floor(startByte / 16);
  const inBlockOff   = startByte % 16;
  const totalBlocks  = Math.ceil((inBlockOff + cipherSlice.length) / 16);
  const ctrBuf       = Buffer.alloc(totalBlocks * 16, 0);
  for (let i = 0; i < totalBlocks; i++) {
    // WinZip counter = block_index + 1, written as 32-bit LE in bytes 0-3
    ctrBuf.writeUInt32LE(startBlock + i + 1, i * 16);
  }
  const ecb = crypto.createCipheriv('aes-' + (encKey.length * 8) + '-ecb', encKey, '');
  ecb.setAutoPadding(false);
  const ks  = Buffer.concat([ecb.update(ctrBuf), ecb.final()]);
  const out = Buffer.allocUnsafe(cipherSlice.length);
  for (let i = 0; i < cipherSlice.length; i++) out[i] = cipherSlice[i] ^ ks[inBlockOff + i];
  return out;
}

// ── Mount a single ZIP file ───────────────────────────────────────────
function _mountZip(zipPath, zipName, password) {
  const rawEntries = _readZipIndex(zipPath);

  // Verify password against first encrypted AES entry (if any)
  const firstAes = rawEntries.find(e => !e.isDir && e.encryption === 'aes');
  if (firstAes) {
    if (!_verifyAesPassword(zipPath, firstAes, password)) {
      throw new Error('Wrong password');
    }
  }
  // Unencrypted zips are mounted without password check (they're public data)

  const mountId     = crypto.randomUUID();
  const displayName = zipName.replace(/\.zip$/i, '');
  const rootFolderId = crypto.randomUUID();

  // ── Build virtual folder tree ──────────────────────────────────────
  const subFolders = {}; // { 'a/b': folderId }

  const dirSet = new Set();
  for (const e of rawEntries) {
    const cleanName = e.name.replace(/\\/g, '/');
    if (e.isDir) {
      const p = cleanName.replace(/\/$/, '');
      if (p) dirSet.add(p);
    } else {
      const parts = cleanName.split('/');
      for (let i = 1; i < parts.length; i++) {
        const d = parts.slice(0, i).join('/');
        if (d) dirSet.add(d);
      }
    }
  }
  for (const dir of dirSet) subFolders[dir] = crypto.randomUUID();

  // ── Build entry list (files only) ─────────────────────────────────
  const mountedEntries = [];
  for (const e of rawEntries) {
    if (e.isDir) continue;
    const cleanName = e.name.replace(/\\/g, '/');
    const parts     = cleanName.split('/');
    const filename  = parts[parts.length - 1];
    if (!filename) continue;

    const ext            = path.extname(filename).toLowerCase();
    const parentDirPath  = parts.length > 1 ? parts.slice(0, -1).join('/') : null;
    const parentFolderId = parentDirPath
      ? (subFolders[parentDirPath] || rootFolderId)
      : rootFolderId;

    const entryId = crypto.randomUUID();
    const entry = {
      entryId, filename, ext,
      size: e.size, compressedSize: e.compressedSize,
      method: e.method, encryption: e.encryption,
      aes: e.aes, localOff: e.localOff, dataStart: e.dataStart,
      flags: e.flags, crc: e.crc, parentFolderId,
    };
    mountedEntries.push(entry);
    _entryIndex[entryId] = { mountId, entry };
  }

  _mounts[mountId] = {
    zipPath, displayName, password,
    rootFolderId, entries: mountedEntries, subFolders,
  };

  console.log(`[vault-zip-mount] mounted ${zipName} (${mountedEntries.length} files)`);
}

// ── Buffer-based mount (for vault .enc ZIPs decrypted into memory) ───
// Called from scanAndMountZips when the vault meta has entries with .zip ext.
function _mountZipBuffer(buf, displayName, password, vaultId) {
  const zipReader = require('./zip-reader-server');
  let rawEntries;
  try { rawEntries = zipReader.listEntries(buf); }
  catch (e) { throw new Error('Not a valid ZIP: ' + e.message); }

  // For AES-encrypted inner entries, verify the password matches
  const firstAes = rawEntries.find(e => !e.isDir && e.encryption === 'aes');
  if (firstAes) {
    try {
      zipReader.extractEntry(buf, firstAes, password);
    } catch (e) {
      if (e.message === 'WRONG_PASSWORD') throw new Error('Wrong password');
      // Any other error (auth fail etc.) also means wrong password — skip silently
      throw e;
    }
  }

  const mountId      = crypto.randomUUID();
  const displayName_ = displayName.replace(/\.(zip|cbz)$/i, '');
  const rootFolderId = crypto.randomUUID();
  const subFolders   = {};

  const dirSet = new Set();
  for (const e of rawEntries) {
    const clean = e.name.replace(/\\/g, '/');
    if (e.isDir) {
      const p = clean.replace(/\/$/, '');
      if (p) dirSet.add(p);
    } else {
      const parts = clean.split('/');
      for (let i = 1; i < parts.length; i++) dirSet.add(parts.slice(0, i).join('/'));
    }
  }
  for (const dir of dirSet) subFolders[dir] = crypto.randomUUID();

  const mountedEntries = [];
  for (const e of rawEntries) {
    if (e.isDir) continue;
    const clean    = e.name.replace(/\\/g, '/');
    const parts    = clean.split('/');
    const filename = parts[parts.length - 1];
    if (!filename) continue;

    const ext          = path.extname(filename).toLowerCase();
    const parentDir    = parts.length > 1 ? parts.slice(0, -1).join('/') : null;
    const parentFolder = parentDir ? (subFolders[parentDir] || rootFolderId) : rootFolderId;

    const entryId = crypto.randomUUID();
    const entry   = {
      entryId, filename, ext,
      size: e.size, compressedSize: e.compressedSize,
      method: e.method, encryption: e.encryption,
      aes: e._aes, _localOff: e._localOff, dataStart: 0,
      flags: e._flags, crc: e.crc, parentFolderId: parentFolder,
    };
    // Resolve dataStart from local header inside the buffer
    try {
      const lo = e._localOff;
      const lhNameLen  = buf.readUInt16LE(lo + 26);
      const lhExtraLen = buf.readUInt16LE(lo + 28);
      entry.dataStart  = lo + 30 + lhNameLen + lhExtraLen;
    } catch {}

    mountedEntries.push(entry);
    _entryIndex[entryId] = { mountId, entry };
  }

  _mounts[mountId] = {
    zipPath: null, zipBuf: buf,  // null zipPath marks buffer-based mount
    displayName: displayName_, password,
    rootFolderId, entries: mountedEntries, subFolders,
    vaultId: vaultId || null,
  };

  console.log(`[vault-zip-mount] mounted ${displayName_} from vault buffer (${mountedEntries.length} files)`);
}

// ── Public API ────────────────────────────────────────────────────────

// decryptFn: vault's decryptToBuffer(id) → { buffer } | null
// vaultMeta: the full vault meta map (already loaded)
function scanAndMountZips(password, decryptFn, vaultMeta) {
  unmountAll();

  // 1. Raw .zip files sitting directly in VAULT_DIR (legacy behaviour)
  if (fs.existsSync(VAULT_DIR)) {
    let files;
    try { files = fs.readdirSync(VAULT_DIR).filter(f => /\.zip$/i.test(f)); } catch { files = []; }
    for (const zipName of files) {
      try { _mountZip(path.join(VAULT_DIR, zipName), zipName, password); }
      catch (e) { console.log(`[vault-zip-mount] skipping raw ${zipName}: ${e.message}`); }
    }
  }

  // 2. Vault .enc entries whose ext is .zip or .cbz
  if (decryptFn && vaultMeta) {
    for (const [id, m] of Object.entries(vaultMeta)) {
      if (m.type === 'folder') continue;
      const ext = (m.ext || '').toLowerCase();
      if (ext !== '.zip' && ext !== '.cbz') continue;
      try {
        const r = decryptFn(id);
        if (!r || !r.buffer) continue;
        const displayName = m.name || (m.originalName || 'archive').replace(/\.(zip|cbz)$/i, '');
        _mountZipBuffer(r.buffer, displayName, password, id);
      } catch (e) {
        console.log(`[vault-zip-mount] skipping vault entry ${id}: ${e.message}`);
      }
    }
  }

  // 3. Encrypted ZIPs from media folders — try the vault password
  try {
    const mediaZip = require('./media-zip-mount-server');
    for (const { zipPath, displayName } of mediaZip.getEncryptedZipPaths()) {
      try { _mountZip(zipPath, displayName + '.zip', password); }
      catch (e) { /* wrong password or not a zip — skip silently */ }
    }
  } catch {}
}

// Returns virtual items (folders + files) merged into the vault listing.
function getMountedItems() {
  const items = [];

  for (const [, mount] of Object.entries(_mounts)) {
    let zipMtime = Date.now();
    if (mount.zipPath) { try { zipMtime = fs.statSync(mount.zipPath).mtimeMs; } catch {} }

    // Top-level folder representing the zip archive.
    // For buffer-based (vault .enc) mounts, honour the vault folder the ZIP was uploaded to.
    let rootParent = null;
    if (mount.vaultId) {
      try {
        const { loadVaultMeta } = require('./db-server');
        const meta = loadVaultMeta();
        rootParent = (meta[mount.vaultId] || {}).folder || null;
      } catch {}
    }
    items.push({
      id: mount.rootFolderId, type: 'folder',
      name: mount.displayName, parent: rootParent,
      mtime: zipMtime, zipMount: true,
    });

    // Virtual sub-folders mirroring the zip's directory tree
    for (const [dirPath, folderId] of Object.entries(mount.subFolders)) {
      const parts          = dirPath.split('/');
      const name           = parts[parts.length - 1];
      const parentDirPath  = parts.length > 1 ? parts.slice(0, -1).join('/') : null;
      const parentFolderId = parentDirPath
        ? (mount.subFolders[parentDirPath] || mount.rootFolderId)
        : mount.rootFolderId;

      items.push({
        id: folderId, type: 'folder',
        name, parent: parentFolderId,
        mtime: zipMtime, zipMount: true,
      });
    }

    // Virtual file entries
    for (const entry of mount.entries) {
      items.push({
        id: entry.entryId,
        originalName: entry.filename,
        name: path.basename(entry.filename, entry.ext),
        ext: entry.ext,
        size: entry.size,
        sizeF: _fmtBytes(entry.size),
        mtime: zipMtime,
        folder: entry.parentFolderId,
        zipMount: true,
        entryId: entry.entryId,
      });
    }
  }

  return items;
}

// ── Streaming ─────────────────────────────────────────────────────────

const NO_CACHE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
};

function streamZipEntry(req, res, entryId) {
  const rec = _entryIndex[entryId];
  if (!rec) { res.writeHead(404); res.end('Not found'); return; }

  const mount = _mounts[rec.mountId];
  if (!mount) { res.writeHead(404); res.end('Mount not found'); return; }

  const entry = rec.entry;
  const ct    = MIME[entry.ext] || 'video/mp4';

  // Buffer-based mounts (vault .enc ZIPs decrypted into memory) always use fallback
  if (mount.zipBuf) {
    _streamFallback(req, res, mount, entry, ct);
    return;
  }

  // AES-stored entries support efficient range requests (file-based only)
  if (entry.encryption === 'aes' && (entry.aes ? entry.aes.actualMethod : entry.method) === 0) {
    try { _streamAesStored(req, res, mount.zipPath, entry, mount.password, ct); }
    catch (e) {
      if (!res.headersSent) { res.writeHead(500); }
      res.end('Stream error: ' + e.message);
    }
    return;
  }

  // Fallback: decrypt + decompress entire entry into memory, then serve range
  _streamFallback(req, res, mount, entry, ct);
}

// Efficient range-capable streaming for STORED WinZip-AES entries.
// Reads only the needed cipher blocks from disk — no full-file load.
function _streamAesStored(req, res, zipPath, entry, password, ct) {
  const strength = entry.aes ? entry.aes.strength : 3;
  const saltLen  = strength === 1 ? 8 : strength === 2 ? 12 : 16;
  const keyLen   = strength === 1 ? 16 : strength === 2 ? 24 : 32;

  const fd = fs.openSync(zipPath, 'r');
  try {
    const salt = Buffer.alloc(saltLen);
    fs.readSync(fd, salt, 0, saltLen, entry.dataStart);

    const km     = crypto.pbkdf2Sync(password, salt, 1000, keyLen * 2 + 2, 'sha1');
    const encKey = km.slice(0, keyLen);

    // Cipher bytes begin after salt(saltLen) + verif(2)
    const cipherDataOffset = entry.dataStart + saltLen + 2;
    const plainSize        = entry.size;

    const rawRange = req.headers.range;
    if (rawRange) {
      const m = rawRange.match(/bytes=(\d+)-(\d*)/);
      if (!m) { res.writeHead(416); res.end(); return; }
      const start = parseInt(m[1], 10);
      const end   = m[2] ? Math.min(parseInt(m[2], 10), plainSize - 1) : plainSize - 1;

      if (start > end || start >= plainSize) {
        res.writeHead(416, { 'Content-Range': `bytes */${plainSize}` });
        res.end(); return;
      }

      // Align to 16-byte CTR blocks
      const blockStart = Math.floor(start / 16) * 16;
      const blockEnd   = Math.min(Math.ceil((end + 1) / 16) * 16, plainSize);
      const readLen    = blockEnd - blockStart;

      const cipherSlice = Buffer.alloc(readLen);
      fs.readSync(fd, cipherSlice, 0, readLen, cipherDataOffset + blockStart);

      const plain = _winzipCtrSlice(encKey, cipherSlice, blockStart);
      const out   = plain.slice(start - blockStart, start - blockStart + (end - start + 1));

      res.writeHead(206, {
        'Content-Range':  `bytes ${start}-${end}/${plainSize}`,
        'Accept-Ranges':  'bytes',
        'Content-Length': out.length,
        'Content-Type':   ct,
        ...NO_CACHE,
      });
      res.end(out);
    } else {
      // Full file — stream in 256 KB chunks to avoid blocking the loop
      res.writeHead(200, {
        'Content-Length': plainSize,
        'Content-Type':   ct,
        'Accept-Ranges':  'bytes',
        ...NO_CACHE,
      });

      const CHUNK = 256 * 1024;
      let pos = 0;
      while (pos < plainSize && !res.writableEnded) {
        const toRead    = Math.min(CHUNK, plainSize - pos);
        const blkStart  = Math.floor(pos / 16) * 16;
        const blkEnd    = Math.min(Math.ceil((pos + toRead) / 16) * 16, plainSize);
        const rl        = blkEnd - blkStart;
        const cs        = Buffer.alloc(rl);
        fs.readSync(fd, cs, 0, rl, cipherDataOffset + blkStart);
        const plain     = _winzipCtrSlice(encKey, cs, blkStart);
        res.write(plain.slice(pos - blkStart, pos - blkStart + toRead));
        pos += toRead;
      }
      res.end();
    }
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
}

// Fallback for compressed (deflate), ZipCrypto, or buffer-based mounts:
// decrypt + decompress the whole entry into memory, then serve the range.
function _streamFallback(req, res, mount, entry, ct) {
  const zipReader = require('./zip-reader-server');
  let buf;
  try {
    buf = mount.zipBuf || fs.readFileSync(mount.zipPath);
  } catch (e) {
    res.writeHead(500); res.end('Cannot read zip: ' + e.message); return;
  }

  let plain;
  try {
    const fakeEntry = {
      name: entry.filename, method: entry.method,
      encryption: entry.encryption, encrypted: !!entry.encryption,
      _aes: entry.aes, compressedSize: entry.compressedSize,
      size: entry.size, _localOff: entry._localOff || entry.localOff,
      crc: entry.crc, _flags: entry._flags || entry.flags,
    };
    plain = zipReader.extractEntry(buf, fakeEntry, mount.password);
  } catch (e) {
    res.writeHead(500); res.end('Extraction failed: ' + e.message); return;
  }

  const rawRange = req.headers.range;
  if (rawRange) {
    const m = rawRange.match(/bytes=(\d+)-(\d*)/);
    if (!m) { res.writeHead(416); res.end(); return; }
    const start = parseInt(m[1], 10);
    const end   = m[2] ? Math.min(parseInt(m[2], 10), plain.length - 1) : plain.length - 1;
    const out   = plain.slice(start, end + 1);
    res.writeHead(206, {
      'Content-Range':  `bytes ${start}-${end}/${plain.length}`,
      'Accept-Ranges':  'bytes',
      'Content-Length': out.length,
      'Content-Type':   ct,
      ...NO_CACHE,
    });
    res.end(out);
  } else {
    res.writeHead(200, {
      'Content-Length': plain.length,
      'Content-Type':   ct,
      'Accept-Ranges':  'bytes',
      ...NO_CACHE,
    });
    res.end(plain);
  }
}

module.exports = { scanAndMountZips, unmountAll, getMountedItems, streamZipEntry, resolveMount, unmountByVaultId };
