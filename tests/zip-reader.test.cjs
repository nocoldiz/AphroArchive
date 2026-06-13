'use strict';
/* global describe, it, expect */

const zlib = require('zlib');
const reader = require('../server/zip-reader-server');
// The writer produces WinZip AES-256 (AE-2) and plain stored archives.
const writer = require('../server/vault-zip-server');

// ── Minimal helpers to build a "stored" + "deflate" plain ZIP by hand ──
// (Just enough to exercise the reader's compression paths independent of
//  the writer, which only emits stored/AES.)
function leUInt16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n >>> 0); return b; }
function leUInt32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }

function buildPlainZip(files) {
  // files: [{ name, data, method }] method 0=stored 8=deflate
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf-8');
    const crc = reader.crc32(f.data);
    const comp = f.method === 8 ? zlib.deflateRawSync(f.data) : f.data;
    const local = Buffer.concat([
      leUInt32(0x04034b50), leUInt16(20), leUInt16(0), leUInt16(f.method),
      leUInt32(0), leUInt32(crc), leUInt32(comp.length), leUInt32(f.data.length),
      leUInt16(nameBuf.length), leUInt16(0), nameBuf,
    ]);
    parts.push(local, comp);
    const cen = Buffer.concat([
      leUInt32(0x02014b50), leUInt16(20), leUInt16(20), leUInt16(0), leUInt16(f.method),
      leUInt32(0), leUInt32(crc), leUInt32(comp.length), leUInt32(f.data.length),
      leUInt16(nameBuf.length), leUInt16(0), leUInt16(0), leUInt16(0), leUInt16(0),
      leUInt32(0), leUInt32(offset), nameBuf,
    ]);
    central.push(cen);
    offset += local.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.concat([
    leUInt32(0x06054b50), leUInt16(0), leUInt16(0),
    leUInt16(files.length), leUInt16(files.length),
    leUInt32(cd.length), leUInt32(offset), leUInt16(0),
  ]);
  return Buffer.concat([...parts, cd, eocd]);
}

describe('zip-reader: plain archives', () => {
  it('reads a stored entry', () => {
    const data = Buffer.from('hello stored world');
    const zip = buildPlainZip([{ name: 'a.txt', data, method: 0 }]);
    const out = reader.extractAll(zip);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('a.txt');
    expect(out[0].data.toString()).toBe('hello stored world');
  });

  it('reads a deflated entry', () => {
    const data = Buffer.from('x'.repeat(5000) + 'compress me');
    const zip = buildPlainZip([{ name: 'big.txt', data, method: 8 }]);
    const out = reader.extractAll(zip);
    expect(out[0].data.equals(data)).toBe(true);
  });

  it('lists entries and reports directories', () => {
    const zip = buildPlainZip([
      { name: 'dir/', data: Buffer.alloc(0), method: 0 },
      { name: 'dir/f.bin', data: Buffer.from('z'), method: 0 },
    ]);
    const entries = reader.listEntries(zip);
    expect(entries.find(e => e.name === 'dir/').isDir).toBe(true);
    expect(entries.find(e => e.name === 'dir/f.bin').encrypted).toBe(false);
  });

  it('throws on non-zip input', () => {
    expect(() => reader.listEntries(Buffer.from('not a zip'))).toThrow();
  });
});

// ── Build a traditional PKWARE ZipCrypto archive (stored) ─────────────
function buildZipCryptoZip(name, plain, password) {
  const CRC = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[i] = c >>> 0; } return t; })();
  let k0 = 0x12345678, k1 = 0x23456789, k2 = 0x34567890;
  const upd = (b) => { k0 = (CRC[(k0 ^ b) & 0xFF] ^ (k0 >>> 8)) >>> 0; k1 = (k1 + (k0 & 0xFF)) >>> 0; k1 = (Math.imul(k1, 134775813) + 1) >>> 0; k2 = (CRC[(k2 ^ (k1 >>> 24)) & 0xFF] ^ (k2 >>> 8)) >>> 0; };
  const decByte = () => { const t = (k2 | 2) & 0xFFFF; return ((t * (t ^ 1)) >>> 8) & 0xFF; };
  for (const b of Buffer.from(password, 'utf-8')) upd(b);

  const crc = reader.crc32(plain);
  const header = Buffer.alloc(12);
  for (let i = 0; i < 11; i++) header[i] = (i * 37 + 5) & 0xFF;
  header[11] = (crc >>> 24) & 0xFF; // check byte

  const full = Buffer.concat([header, plain]);
  const cipher = Buffer.allocUnsafe(full.length);
  for (let i = 0; i < full.length; i++) { const K = decByte(); cipher[i] = full[i] ^ K; upd(full[i]); }

  const nameBuf = Buffer.from(name, 'utf-8');
  const flags = 0x0001; // encrypted
  const local = Buffer.concat([
    leUInt32(0x04034b50), leUInt16(20), leUInt16(flags), leUInt16(0),
    leUInt32(0), leUInt32(crc), leUInt32(cipher.length), leUInt32(plain.length),
    leUInt16(nameBuf.length), leUInt16(0), nameBuf,
  ]);
  const offset = 0;
  const cen = Buffer.concat([
    leUInt32(0x02014b50), leUInt16(20), leUInt16(20), leUInt16(flags), leUInt16(0),
    leUInt32(0), leUInt32(crc), leUInt32(cipher.length), leUInt32(plain.length),
    leUInt16(nameBuf.length), leUInt16(0), leUInt16(0), leUInt16(0), leUInt16(0),
    leUInt32(0), leUInt32(offset), nameBuf,
  ]);
  const body = Buffer.concat([local, cipher]);
  const eocd = Buffer.concat([
    leUInt32(0x06054b50), leUInt16(0), leUInt16(0), leUInt16(1), leUInt16(1),
    leUInt32(cen.length), leUInt32(body.length), leUInt16(0),
  ]);
  return Buffer.concat([body, cen, eocd]);
}

describe('zip-reader: traditional ZipCrypto', () => {
  it('decrypts a ZipCrypto entry with the right password', () => {
    const zip = buildZipCryptoZip('note.txt', Buffer.from('classic zipcrypto payload'), 'hunter2');
    expect(reader.isEncrypted(zip)).toBe(true);
    const out = reader.extractAll(zip, 'hunter2');
    expect(out[0].data.toString()).toBe('classic zipcrypto payload');
  });

  it('rejects the wrong ZipCrypto password', () => {
    const zip = buildZipCryptoZip('note.txt', Buffer.from('secret'), 'hunter2');
    expect(() => reader.extractAll(zip, 'nope')).toThrow(/WRONG_PASSWORD/);
  });
});

describe('zip-reader: WinZip AES (round-trip with writer)', () => {
  it('decrypts an AES-256 archive with the correct password', () => {
    const files = [
      { name: 'secret.txt', data: Buffer.from('top secret data 123') },
      { name: 'b.bin', data: Buffer.from([0, 1, 2, 3, 255, 254]) },
    ];
    const zip = writer.buildZip(files, 'CorrectHorse');
    expect(reader.isEncrypted(zip)).toBe(true);

    const out = reader.extractAll(zip, 'CorrectHorse');
    expect(out).toHaveLength(2);
    expect(out.find(f => f.name === 'secret.txt').data.toString()).toBe('top secret data 123');
    expect(out.find(f => f.name === 'b.bin').data.equals(files[1].data)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const zip = writer.buildZip([{ name: 'x.txt', data: Buffer.from('hi') }], 'rightpw');
    expect(() => reader.extractAll(zip, 'wrongpw')).toThrow(/WRONG_PASSWORD/);
  });

  it('requires a password for encrypted entries', () => {
    const zip = writer.buildZip([{ name: 'x.txt', data: Buffer.from('hi') }], 'pw');
    expect(() => reader.extractAll(zip)).toThrow(/WRONG_PASSWORD/);
  });
});
