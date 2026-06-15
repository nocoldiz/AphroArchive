'use strict';
// ═══════════════════════════════════════════════════════════════════
//  vault-zip.js — Download vault files as (optionally encrypted) ZIP
//  Encryption: WinZip AES-256 (AE-2) — compatible with 7-zip, WinZip
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { json, readBody } = require('./helpers-server');

// ── CRC-32 ──────────────────────────────────────────────────────────
const _CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function _crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = _CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// ── WinZip AES-256 CTR (little-endian counter, starts at 1) ─────────
// Node.js aes-256-ctr is big-endian; we use ECB+XOR to match WinZip spec.
function _winzipCtr(key, data) {
  if (!data.length) return Buffer.alloc(0);
  const blocks = Math.ceil(data.length / 16);
  const ctrBuf = Buffer.alloc(blocks * 16, 0);
  for (let i = 0; i < blocks; i++) ctrBuf.writeUInt32LE(i + 1, i * 16);
  const ecb = crypto.createCipheriv('aes-256-ecb', key, '');
  ecb.setAutoPadding(false);
  const ks = Buffer.concat([ecb.update(ctrBuf), ecb.final()]);
  const out = Buffer.allocUnsafe(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ ks[i];
  return out;
}

// ── AES-256 entry encryption ────────────────────────────────────────
function _encryptEntry(plaintext, password) {
  const salt    = crypto.randomBytes(16);
  const km      = crypto.pbkdf2Sync(password, salt, 1000, 66, 'sha1');
  const encKey  = km.slice(0, 32);
  const hmacKey = km.slice(32, 64);
  const verif   = km.slice(64, 66);
  const cipher  = _winzipCtr(encKey, plaintext);
  const auth    = crypto.createHmac('sha1', hmacKey).update(cipher).digest().slice(0, 10);
  return { salt, verif, cipher, auth };
}

// ── AES extra field (11 bytes) ───────────────────────────────────────
function _aesExtra(actualCompression) {
  const buf = Buffer.alloc(11);
  buf.writeUInt16LE(0x9901, 0); // header id
  buf.writeUInt16LE(7,      2); // data size
  buf.writeUInt16LE(2,      4); // AE-2 (no CRC)
  buf[6] = 0x41; buf[7] = 0x45; // 'AE'
  buf[8] = 3;                   // AES-256
  buf.writeUInt16LE(actualCompression, 9);
  return buf;
}

// ── Local file header ────────────────────────────────────────────────
function _localHeader(nameBuf, compressedSize, uncompressedSize, crc, encrypted) {
  const extraLen = encrypted ? 11 : 0;
  const buf = Buffer.alloc(30 + nameBuf.length + extraLen);
  let p = 0;
  buf.writeUInt32LE(0x04034b50, p); p += 4; // signature
  buf.writeUInt16LE(encrypted ? 45 : 20, p); p += 2; // version needed
  buf.writeUInt16LE(encrypted ? 0x0001 : 0, p); p += 2; // GP flags
  buf.writeUInt16LE(encrypted ? 99 : 0, p); p += 2; // compression (99=AES)
  buf.writeUInt32LE(0, p); p += 4; // mod time+date (zeroed)
  buf.writeUInt32LE(encrypted ? 0 : crc, p); p += 4; // CRC (AE-2 = 0)
  buf.writeUInt32LE(compressedSize, p); p += 4;
  buf.writeUInt32LE(uncompressedSize, p); p += 4;
  buf.writeUInt16LE(nameBuf.length, p); p += 2;
  buf.writeUInt16LE(extraLen, p); p += 2;
  nameBuf.copy(buf, p); p += nameBuf.length;
  if (encrypted) _aesExtra(0).copy(buf, p);
  return buf;
}

// ── Central directory header ─────────────────────────────────────────
function _centralHeader(nameBuf, compressedSize, uncompressedSize, crc, localOffset, encrypted) {
  const extraLen = encrypted ? 11 : 0;
  const buf = Buffer.alloc(46 + nameBuf.length + extraLen);
  let p = 0;
  buf.writeUInt32LE(0x02014b50, p); p += 4;
  buf.writeUInt16LE(0x031F, p); p += 2; // version made by (Windows 3.1)
  buf.writeUInt16LE(encrypted ? 45 : 20, p); p += 2;
  buf.writeUInt16LE(encrypted ? 0x0001 : 0, p); p += 2;
  buf.writeUInt16LE(encrypted ? 99 : 0, p); p += 2;
  buf.writeUInt32LE(0, p); p += 4; // mod time+date
  buf.writeUInt32LE(encrypted ? 0 : crc, p); p += 4;
  buf.writeUInt32LE(compressedSize, p); p += 4;
  buf.writeUInt32LE(uncompressedSize, p); p += 4;
  buf.writeUInt16LE(nameBuf.length, p); p += 2;
  buf.writeUInt16LE(extraLen, p); p += 2;
  buf.writeUInt16LE(0, p); p += 2; // comment length
  buf.writeUInt16LE(0, p); p += 2; // disk start
  buf.writeUInt16LE(0, p); p += 2; // internal attrs
  buf.writeUInt32LE(0, p); p += 4; // external attrs
  buf.writeUInt32LE(localOffset, p); p += 4;
  nameBuf.copy(buf, p); p += nameBuf.length;
  if (encrypted) _aesExtra(0).copy(buf, p);
  return buf;
}

// ── EOCD ─────────────────────────────────────────────────────────────
function _eocd(count, cdSize, cdOffset) {
  const buf = Buffer.alloc(22);
  buf.writeUInt32LE(0x06054b50, 0);
  buf.writeUInt16LE(0, 4);  // disk
  buf.writeUInt16LE(0, 6);  // start disk
  buf.writeUInt16LE(count, 8);
  buf.writeUInt16LE(count, 10);
  buf.writeUInt32LE(cdSize, 12);
  buf.writeUInt32LE(cdOffset, 16);
  buf.writeUInt16LE(0, 20); // comment length
  return buf;
}

// ── Build ZIP buffer ─────────────────────────────────────────────────
function buildZip(files, password) {
  // files: Array of { name: string, data: Buffer }
  const parts = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf-8');

    if (password) {
      const enc = _encryptEntry(file.data, password);
      // Encrypted payload: salt(16) + verif(2) + ciphertext + auth(10)
      const payload = Buffer.concat([enc.salt, enc.verif, enc.cipher, enc.auth]);
      const lh = _localHeader(nameBuf, payload.length, file.data.length, 0, true);
      const ch = _centralHeader(nameBuf, payload.length, file.data.length, 0, offset, true);
      centralHeaders.push(ch);
      parts.push(lh, payload);
      offset += lh.length + payload.length;
    } else {
      const crc = _crc32(file.data);
      const lh  = _localHeader(nameBuf, file.data.length, file.data.length, crc, false);
      const ch  = _centralHeader(nameBuf, file.data.length, file.data.length, crc, offset, false);
      centralHeaders.push(ch);
      parts.push(lh, file.data);
      offset += lh.length + file.data.length;
    }
  }

  const cd    = Buffer.concat(centralHeaders);
  const eocd  = _eocd(files.length, cd.length, offset);
  parts.push(cd, eocd);
  return Buffer.concat(parts);
}

// ── API handler ──────────────────────────────────────────────────────
async function apiVaultDownloadZip(req, res) {
  const body     = await readBody(req);
  const ids      = Array.isArray(body.ids) ? body.ids : [];
  const password = typeof body.password === 'string' ? body.password.trim() : '';

  if (!ids.length) return json(res, { error: 'No files selected' }, 400);
  if (ids.length > 200) return json(res, { error: 'Too many files (max 200)' }, 400);

  const vault = require('./vault-server');
  const files = [];

  for (const id of ids) {
    const result = vault.decryptToBuffer(id);
    if (!result) {
      return json(res, { error: 'Vault locked or file not found: ' + id }, 400);
    }
    // Derive filename from vault meta via id (meta has originalName)
    const meta = vault.getFileMeta ? vault.getFileMeta(id) : null;
    const name = (meta && meta.originalName) ? meta.originalName : id + '.bin';
    // Deduplicate names
    let safeName = name;
    let n = 1;
    while (files.some(f => f.name === safeName)) safeName = name.replace(/(\.[^.]+)?$/, `_${n++}$1`);
    files.push({ name: safeName, data: result.buffer });
  }

  let zip;
  try {
    zip = buildZip(files, password || null);
  } catch (e) {
    return json(res, { error: 'ZIP build failed: ' + e.message }, 500);
  }

  const filename = 'vault-export-' + Date.now() + '.zip';
  res.writeHead(200, {
    'Content-Type':        'application/zip',
    'Content-Length':      zip.length,
    'Content-Disposition': 'attachment; filename="' + filename + '"',
    'Cache-Control':       'no-store',
  });
  res.end(zip);
}

async function apiFolderDownloadZip(req, res) {
  const body     = await readBody(req);
  const folder   = typeof body.category === 'string' ? body.category.trim() : '';
  const password = typeof body.password === 'string' ? body.password.trim() : '';

  if (!folder) return json(res, { error: 'Category required' }, 400);

  const videos = require('./videos-server');
  const allVids = await videos.allVideos();

  let list = allVids;
  if (folder === 'uncategorized' || folder === '__uncategorized__' || folder === '') {
    const { loadFolderMappings } = require('./db-server');
    const defined = loadFolderMappings();
    list = list.filter(v => v.catPath === '' && !defined.some(e => require('./helpers-server').wordMatchAny(v.name, e.terms)));
  } else {
    const { loadFolderMappings } = require('./db-server');
    const defined = loadFolderMappings();
    const catLo = folder.toLowerCase();
    const matchingEntry = defined.find(e => e.name.toLowerCase() === catLo);
    const cl = folder.toLowerCase().replace(/\\/g, '/');
    list = list.filter(v => {
      const vp = v.catPath.toLowerCase().replace(/\\/g, '/');
      const isChild = vp === cl || vp.startsWith(cl + '/');
      return isChild || v.category === folder || (matchingEntry && v.catPath === '' && require('./helpers-server').wordMatchAny(v.name, matchingEntry.terms));
    });
  }

  if (!list.length) return json(res, { error: 'No files in category' }, 400);
  if (list.length > 200) return json(res, { error: 'Too many files (max 200)' }, 400);

  let totalSize = 0;
  const files = [];
  const { VIDEOS_DIR } = require('./config-server');
  const path = require('path');
  const fs = require('fs');

  for (const v of list) {
    const fp = path.join(VIDEOS_DIR, v.rel);
    if (!fs.existsSync(fp)) continue;

    const stat = fs.statSync(fp);
    totalSize += stat.size;
    if (totalSize > 500 * 1024 * 1024) {
      return json(res, { error: 'Category too large for ZIP (max 500MB)' }, 400);
    }

    const data = fs.readFileSync(fp);
    files.push({ name: path.basename(v.rel), data });
  }

  let zip;
  try {
    zip = buildZip(files, password || null);
  } catch (e) {
    return json(res, { error: 'ZIP build failed: ' + e.message }, 500);
  }

  const filename = 'folder-' + folder.replace(/[^a-zA-Z0-9_-]/g, '_') + '-' + Date.now() + '.zip';
  res.writeHead(200, {
    'Content-Type':        'application/zip',
    'Content-Length':      zip.length,
    'Content-Disposition': 'attachment; filename="' + filename + '"',
    'Cache-Control':       'no-store',
  });
  res.end(zip);
}

// ═══════════════════════════════════════════════════════════════════
//  ZIP IMPORT — read (optionally password-protected) archives and either
//  extract them to a folder under VIDEOS_DIR or encrypt their contents
//  straight into the vault.
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const zipReader = require('./zip-reader-server');
const { VIDEOS_DIR, PROCESS_DIR } = require('./config-server');

// Resolve the source ZIP bytes from either a vault file id or a path that is
// constrained to VIDEOS_DIR / PROCESS_DIR (prevents reading arbitrary files).
function _resolveZipBuffer(body) {
  const vault = require('./vault-server');
  if (body.id) {
    const r = vault.decryptToBuffer(body.id);
    if (!r) return { error: 'Vault locked or file not found', code: 400 };
    return { buf: r.buffer, name: (vault.getFileMeta(body.id) || {}).originalName || 'archive.zip' };
  }
  if (body.path) {
    const roots = [VIDEOS_DIR, PROCESS_DIR].filter(Boolean).map(r => path.resolve(r));
    const abs = path.resolve(body.path);
    if (!roots.some(root => abs === root || abs.startsWith(root + path.sep))) {
      return { error: 'Path outside allowed directories', code: 403 };
    }
    if (!fs.existsSync(abs)) return { error: 'File not found', code: 404 };
    return { buf: fs.readFileSync(abs), name: path.basename(abs), srcPath: abs };
  }
  return { error: 'Provide a vault file id or a path', code: 400 };
}

// Normalise an entry name to a safe relative path (defeats Zip-Slip).
function _safeEntryPath(name) {
  const cleaned = String(name).replace(/\\/g, '/').replace(/^[a-zA-Z]:/, '').replace(/^\/+/, '');
  const parts = cleaned.split('/').filter(p => p && p !== '.' && p !== '..');
  return parts.join('/');
}

// Preview the entries of a ZIP (names/sizes/encryption) without extracting.
async function apiVaultZipEntries(req, res) {
  const body = await readBody(req);
  const src = _resolveZipBuffer(body);
  if (src.error) return json(res, { error: src.error }, src.code || 400);
  try {
    const entries = zipReader.listEntries(src.buf).map(e => ({
      name: e.name, isDir: e.isDir, encrypted: e.encrypted,
      encryption: e.encryption, size: e.size,
    }));
    json(res, { ok: true, name: src.name, encrypted: entries.some(e => e.encrypted), entries });
  } catch (e) {
    json(res, { error: 'Failed to read ZIP: ' + e.message }, 400);
  }
}

// Import a ZIP. mode 'extract' writes decrypted files under VIDEOS_DIR;
// mode 'vault' encrypts each file into the vault (requires it unlocked).
async function apiVaultImportZip(req, res) {
  const body = await readBody(req);
  const mode = body.mode === 'extract' ? 'extract' : 'vault';
  const password = typeof body.password === 'string' ? body.password : '';

  const src = _resolveZipBuffer(body);
  if (src.error) return json(res, { error: src.error }, src.code || 400);

  const vault = require('./vault-server');
  if (mode === 'vault' && !vault.isUnlocked()) return json(res, { error: 'locked' }, 401);

  let files;
  try {
    files = zipReader.extractAll(src.buf, password);
  } catch (e) {
    if (e.message === 'WRONG_PASSWORD') return json(res, { error: 'Password required or incorrect', needPassword: true }, 401);
    return json(res, { error: 'Extraction failed: ' + e.message }, 400);
  }

  if (mode === 'extract') {
    // Destination folder under VIDEOS_DIR, defaulting to the archive's name.
    const folderName = _safeEntryPath(body.destFolder || src.name.replace(/\.zip$/i, '')) || 'imported';
    const destRoot = path.resolve(path.join(VIDEOS_DIR, folderName));
    if (destRoot !== path.resolve(VIDEOS_DIR) && !destRoot.startsWith(path.resolve(VIDEOS_DIR) + path.sep)) {
      return json(res, { error: 'Invalid destination' }, 400);
    }
    let written = 0;
    for (const f of files) {
      const rel = _safeEntryPath(f.name);
      if (!rel) continue;
      const outPath = path.join(destRoot, rel);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, f.data);
      written++;
    }
    return json(res, { ok: true, mode, folder: folderName, count: written });
  }

  // mode === 'vault'
  const folder = body.folder || null;
  const ids = [];
  for (const f of files) {
    const baseName = _safeEntryPath(f.name).split('/').pop() || 'file';
    const id = vault.encryptBufferToVault(f.data, baseName, folder);
    if (id) ids.push(id);
  }
  json(res, { ok: true, mode, count: ids.length, ids });
}

module.exports = {
  apiVaultDownloadZip, apiFolderDownloadZip,
  apiVaultZipEntries, apiVaultImportZip,
  buildZip,
};
