'use strict';
// ═══════════════════════════════════════════════════════════════════
//  zip-reader-server.js — Pure-Node ZIP reader / extractor
//
//  Supports, with no external dependencies:
//    • Stored (method 0) and Deflate (method 8)  — via zlib
//    • Traditional PKWARE ZipCrypto encryption    — password protected
//    • WinZip AES-128/192/256 (AE-1 / AE-2)       — password protected
//
//  This is the read counterpart to vault-zip-server.js (which writes
//  WinZip AES-256 archives). Returns decrypted, decompressed buffers.
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const zlib = require('zlib');

// ── CRC-32 (unsigned table, used by ZipCrypto and integrity checks) ──
const _CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = _CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── WinZip AES (AE-1/AE-2): CTR mode, little-endian counter from 1 ────
// Matches the writer in vault-zip-server.js. CTR is symmetric, so the same
// routine both encrypts and decrypts.
function _winzipCtr(key, data) {
  if (!data.length) return Buffer.alloc(0);
  const blocks = Math.ceil(data.length / 16);
  const ctrBuf = Buffer.alloc(blocks * 16, 0);
  for (let i = 0; i < blocks; i++) ctrBuf.writeUInt32LE(i + 1, i * 16);
  const ecb = crypto.createCipheriv('aes-' + (key.length * 8) + '-ecb', key, '');
  ecb.setAutoPadding(false);
  const ks = Buffer.concat([ecb.update(ctrBuf), ecb.final()]);
  const out = Buffer.allocUnsafe(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ ks[i];
  return out;
}

// AES strength → [saltLen, keyLen]
const _AES_PARAMS = { 1: [8, 16], 2: [12, 24], 3: [16, 32] };

function _decryptWinzipAes(payload, password, strength) {
  const [saltLen, keyLen] = _AES_PARAMS[strength] || _AES_PARAMS[3];
  if (payload.length < saltLen + 2 + 10) throw new Error('AES entry too small');
  const salt    = payload.slice(0, saltLen);
  const pwVerif = payload.slice(saltLen, saltLen + 2);
  const cipher  = payload.slice(saltLen + 2, payload.length - 10);
  const auth    = payload.slice(payload.length - 10);

  const km      = crypto.pbkdf2Sync(password, salt, 1000, keyLen * 2 + 2, 'sha1');
  const encKey  = km.slice(0, keyLen);
  const hmacKey = km.slice(keyLen, keyLen * 2);
  const verif   = km.slice(keyLen * 2, keyLen * 2 + 2);

  if (!verif.equals(pwVerif)) throw new Error('WRONG_PASSWORD');

  const expectedAuth = crypto.createHmac('sha1', hmacKey).update(cipher).digest().slice(0, 10);
  if (!expectedAuth.equals(auth)) throw new Error('AES auth failed (corrupt or wrong password)');

  return _winzipCtr(encKey, cipher);
}

// ── Traditional PKWARE ZipCrypto ──────────────────────────────────────
function _zipCryptoDecrypt(data, password, checkByte) {
  let k0 = 0x12345678, k1 = 0x23456789, k2 = 0x34567890;
  const upd = (b) => {
    k0 = (_CRC[(k0 ^ b) & 0xFF] ^ (k0 >>> 8)) >>> 0;
    k1 = (k1 + (k0 & 0xFF)) >>> 0;
    k1 = (Math.imul(k1, 134775813) + 1) >>> 0;
    k2 = (_CRC[(k2 ^ (k1 >>> 24)) & 0xFF] ^ (k2 >>> 8)) >>> 0;
  };
  const decByte = () => {
    const t = (k2 | 2) & 0xFFFF;
    return ((t * (t ^ 1)) >>> 8) & 0xFF;
  };
  for (const b of Buffer.from(password, 'utf-8')) upd(b);

  const out = Buffer.allocUnsafe(data.length);
  for (let i = 0; i < data.length; i++) {
    const c = (data[i] ^ decByte()) & 0xFF;
    out[i] = c;
    upd(c);
  }
  // First 12 bytes are the encryption header; the last verifies the password.
  if (out.length < 12) throw new Error('ZipCrypto entry too small');
  if (out[11] !== (checkByte & 0xFF)) throw new Error('WRONG_PASSWORD');
  return out.slice(12);
}

// ── EOCD / central directory parsing ─────────────────────────────────
function _findEOCD(buf) {
  // EOCD is 22 bytes minimum; comment can extend it up to 65535 bytes.
  const min = 22;
  const maxBack = Math.min(buf.length, min + 0xFFFF);
  for (let i = buf.length - min; i >= buf.length - maxBack; i--) {
    if (i < 0) break;
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function _parseAesExtra(extra) {
  // Walk extra fields looking for header id 0x9901.
  let p = 0;
  while (p + 4 <= extra.length) {
    const id = extra.readUInt16LE(p);
    const sz = extra.readUInt16LE(p + 2);
    if (id === 0x9901 && p + 4 + sz <= extra.length) {
      return {
        strength: extra[p + 8],                  // 1/2/3 = 128/192/256
        actualMethod: extra.readUInt16LE(p + 9), // real compression method
      };
    }
    p += 4 + sz;
  }
  return null;
}

/**
 * List the entries of a ZIP without decrypting payloads.
 * Returns: [{ name, isDir, encrypted, encryption, method, size, compressedSize }]
 */
function listEntries(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('Not a ZIP file');
  const eocd = _findEOCD(buf);
  if (eocd < 0) throw new Error('Not a valid ZIP (no EOCD record)');

  const count    = buf.readUInt16LE(eocd + 10);
  let cdOffset   = buf.readUInt32LE(eocd + 16);
  const entries  = [];

  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const flags     = buf.readUInt16LE(p + 8);
    const method    = buf.readUInt16LE(p + 10);
    const crc       = buf.readUInt32LE(p + 16);
    const compSize  = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen   = buf.readUInt16LE(p + 28);
    const extraLen  = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff  = buf.readUInt32LE(p + 42);
    const name      = buf.slice(p + 46, p + 46 + nameLen).toString('utf-8');
    const extra     = buf.slice(p + 46 + nameLen, p + 46 + nameLen + extraLen);

    const encrypted = (flags & 0x0001) !== 0;
    let encryption = encrypted ? 'zipcrypto' : null;
    let aes = null;
    if (method === 99) { aes = _parseAesExtra(extra); encryption = 'aes'; }

    entries.push({
      name, isDir: name.endsWith('/'), encrypted,
      encryption, method, crc, size: uncompSize, compressedSize: compSize,
      _localOff: localOff, _flags: flags, _aes: aes,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Read the raw stored bytes of a single entry from its local header offset. */
function _readEntryData(buf, entry) {
  const lo = entry._localOff;
  if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('Bad local header for ' + entry.name);
  const nameLen  = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const dataStart = lo + 30 + nameLen + extraLen;
  return buf.slice(dataStart, dataStart + entry.compressedSize);
}

function _inflate(data, method) {
  if (method === 0) return data;        // stored
  if (method === 8) return zlib.inflateRawSync(data);
  if (method === 9) return zlib.inflateRawSync(data); // deflate64 best-effort
  throw new Error('Unsupported compression method: ' + method);
}

/**
 * Extract one entry to a decrypted, decompressed Buffer.
 * Throws Error('WRONG_PASSWORD') when the password is required/incorrect.
 */
function extractEntry(buf, entry, password) {
  let data = _readEntryData(buf, entry);
  let method = entry.method;

  if (entry.encryption === 'aes') {
    if (!password) throw new Error('WRONG_PASSWORD');
    const strength = entry._aes ? entry._aes.strength : 3;
    data = _decryptWinzipAes(data, password, strength);
    method = entry._aes ? entry._aes.actualMethod : 0;
  } else if (entry.encryption === 'zipcrypto') {
    if (!password) throw new Error('WRONG_PASSWORD');
    // For data-descriptor entries (flag bit 3) the check byte is the high
    // byte of the mod-time; otherwise it is the high byte of the CRC.
    const checkByte = (entry._flags & 0x0008) ? 0 : ((entry.crc >>> 24) & 0xFF);
    data = _zipCryptoDecrypt(data, password, checkByte);
  }

  const out = _inflate(data, method);
  return out;
}

/**
 * Extract every file entry. Returns [{ name, data }]. Directories are skipped.
 * Throws Error('WRONG_PASSWORD') if any entry needs a password not supplied.
 */
function extractAll(buf, password) {
  const entries = listEntries(buf);
  const files = [];
  for (const e of entries) {
    if (e.isDir) continue;
    files.push({ name: e.name, data: extractEntry(buf, e, password) });
  }
  return files;
}

/** True if the archive contains at least one encrypted entry. */
function isEncrypted(buf) {
  try { return listEntries(buf).some(e => e.encrypted); } catch { return false; }
}

module.exports = { listEntries, extractEntry, extractAll, isEncrypted, crc32 };
