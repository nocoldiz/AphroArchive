'use strict';

/* global describe, it, expect, beforeAll, afterAll, vi */

// Regression tests for the first-load performance fixes:
//  - json() gzips large payloads when the client accepts gzip
//  - serveStatic() emits caching headers (immutable for hashed assets, ETag
//    revalidation with 304s for everything else) and gzips text assets
// These are what turn repeat page loads into a handful of tiny 304s instead
// of a full re-download of the bundle + a multi-megabyte /api/videos body.

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const stream = require('stream');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aphro-static-test-'));
const PUBLIC_DIR = path.join(TMP, 'public');
fs.mkdirSync(path.join(PUBLIC_DIR, 'assets'), { recursive: true });

function injectMock(relPath, exports) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = {
    id: resolved, filename: resolved, loaded: true,
    exports, children: [], paths: [],
  };
}

injectMock('../server/config-server', {
  VIDEOS_DIR: path.join(TMP, 'videos'),
  PUBLIC_DIR,
  STATIC_MIME: { '.js': 'application/javascript', '.html': 'text/html; charset=utf-8', '.png': 'image/png' },
  IS_PKG: false,
  MIME: {},
});
injectMock('../server/db-server', { loadPrefs: vi.fn(() => ({})) });

const helpers = require('../server/helpers-server');

function makeRes(reqHeaders = {}) {
  const chunks = [];
  let sc = 200, hdrs = {};
  const res = new stream.Writable({
    write(c, _e, cb) { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); cb(); },
  });
  res.writeHead = (s, h) => { sc = s; if (h) hdrs = { ...hdrs, ...h }; };
  res.req = { headers: reqHeaders };
  Object.defineProperty(res, 'status', { get: () => sc });
  Object.defineProperty(res, 'headers', { get: () => hdrs });
  Object.defineProperty(res, 'bodyBuffer', { get: () => Buffer.concat(chunks) });
  res.waitEnd = () => new Promise(r => { if (res.writableEnded) r(); res.on('finish', r); res.on('close', r); });
  return res;
}

// ─── json() compression ───────────────────────────────────────────────

describe('json() gzip', () => {
  it('gzips payloads over 1KB when the client accepts gzip', async () => {
    const res = makeRes({ 'accept-encoding': 'gzip, deflate, br' });
    const big = { items: Array(200).fill({ name: 'video', tags: ['a', 'b'] }) };
    helpers.json(res, big);
    await res.waitEnd();
    expect(res.headers['Content-Encoding']).toBe('gzip');
    const decoded = JSON.parse(zlib.gunzipSync(res.bodyBuffer).toString());
    expect(decoded.items.length).toBe(200);
  });

  it('does not gzip small payloads', async () => {
    const res = makeRes({ 'accept-encoding': 'gzip' });
    helpers.json(res, { ok: true });
    await res.waitEnd();
    expect(res.headers['Content-Encoding']).toBeUndefined();
    expect(JSON.parse(res.bodyBuffer.toString())).toEqual({ ok: true });
  });

  it('does not gzip when the client does not accept gzip', async () => {
    const res = makeRes({});
    const big = { items: Array(200).fill({ name: 'video' }) };
    helpers.json(res, big);
    await res.waitEnd();
    expect(res.headers['Content-Encoding']).toBeUndefined();
    expect(JSON.parse(res.bodyBuffer.toString()).items.length).toBe(200);
  });

  it('stays safe with a mock res that has no paired req', async () => {
    const res = makeRes({});
    delete res.req;
    helpers.json(res, { fine: 1 });
    await res.waitEnd();
    expect(JSON.parse(res.bodyBuffer.toString())).toEqual({ fine: 1 });
  });
});

// ─── serveStatic() caching + compression ─────────────────────────────

describe('serveStatic() caching headers', () => {
  const HASHED = path.join('assets', 'index-Dk3aXf9z.js');
  const jsBody = '// bundle\n' + 'x'.repeat(4096);

  beforeAll(() => {
    fs.writeFileSync(path.join(PUBLIC_DIR, HASHED), jsBody);
    fs.writeFileSync(path.join(PUBLIC_DIR, 'index.html'), '<!doctype html><html></html>');
    fs.writeFileSync(path.join(PUBLIC_DIR, 'logo.png'), Buffer.alloc(2048, 7));
  });

  afterAll(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

  it('marks hashed assets immutable and gzips them', async () => {
    const res = makeRes();
    helpers.serveStatic({ headers: { 'accept-encoding': 'gzip' } }, res, HASHED);
    await res.waitEnd();
    expect(res.headers['Cache-Control']).toContain('immutable');
    expect(res.headers['Content-Encoding']).toBe('gzip');
    expect(zlib.gunzipSync(res.bodyBuffer).toString()).toBe(jsBody);
  });

  it('serves index.html with an ETag and answers 304 on revalidation', async () => {
    const first = makeRes();
    helpers.serveStatic({ headers: {} }, first, 'index.html');
    await first.waitEnd();
    const etag = first.headers['ETag'];
    expect(etag).toBeTruthy();
    expect(first.headers['Cache-Control']).toBe('no-cache');

    const second = makeRes();
    helpers.serveStatic({ headers: { 'if-none-match': etag } }, second, 'index.html');
    await second.waitEnd();
    expect(second.status).toBe(304);
    expect(second.bodyBuffer.length).toBe(0);
  });

  it('falls back to index.html for SPA routes', async () => {
    const res = makeRes();
    helpers.serveStatic({ headers: {} }, res, 'video/some-id');
    await res.waitEnd();
    expect(res.status).toBe(200);
    expect(res.bodyBuffer.toString()).toContain('<!doctype html>');
  });

  it('does not compress already-compressed formats', async () => {
    const res = makeRes();
    helpers.serveStatic({ headers: { 'accept-encoding': 'gzip' } }, res, 'logo.png');
    await res.waitEnd();
    expect(res.headers['Content-Encoding']).toBeUndefined();
    expect(res.bodyBuffer.length).toBe(2048);
  });

  it('still refuses path traversal', async () => {
    const res = makeRes();
    helpers.serveStatic({ headers: {} }, res, '../../etc/passwd');
    await res.waitEnd();
    expect(res.status).toBe(403);
  });
});
