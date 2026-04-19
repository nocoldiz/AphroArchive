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

module.exports = { apiVaultDownloadZip };
