'use strict';

/* global describe, it, expect, beforeEach, afterAll, vi */

const fs = require('fs');
const path = require('path');
const os = require('os');
const stream = require('stream');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aphro-collections-test-'));

function injectMock(relPath, exports) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = {
    id: resolved, filename: resolved, loaded: true,
    exports, children: [], paths: [],
  };
}

// ── Mocks ─────────────────────────────────────────────────────────────

const state = {
  collections: [],
  videos: [],
  favs: [],
};

injectMock('../server/config-server', {
  VIDEOS_DIR: path.join(TMP, 'videos'),
  PUBLIC_DIR: TMP,
  STATIC_MIME: {},
  IS_PKG: false,
  MIME: {},
});

injectMock('../server/db-server', {
  loadCollections: vi.fn(() => state.collections.map(c => ({ ...c, ids: [...c.ids] }))),
  saveCollections: vi.fn((c) => { state.collections = c.map(col => ({ ...col, ids: [...col.ids] })); }),
  loadFavs: vi.fn(() => [...state.favs]),
});

injectMock('../server/videos-server', {
  allVideos: vi.fn(async () => state.videos.map(v => ({ ...v }))),
});

const cols = require('../server/collections-server');

afterAll(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

beforeEach(() => {
  state.collections = [];
  state.videos = [];
  state.favs = [];
});

// ── Helpers ────────────────────────────────────────────────────────────

function makeJsonReq(url, body) {
  const buf = Buffer.from(JSON.stringify(body || {}));
  const req = new stream.Readable({ read() {} });
  req.push(buf);
  req.push(null);
  req.url = url || '/';
  req.method = 'POST';
  req.headers = { 'content-type': 'application/json', 'content-length': String(buf.length) };
  return req;
}

function makeRes() {
  const chunks = [];
  let sc = 200;
  return {
    writeHead: vi.fn((s) => { sc = s; }),
    end: vi.fn((b) => { if (b) chunks.push(Buffer.isBuffer(b) ? b : Buffer.from(b)); }),
    get statusCode() { return sc; },
    get body() { return Buffer.concat(chunks).toString(); },
    get jsonBody() { try { return JSON.parse(this.body); } catch { return null; } },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('apiCollectionCreate()', () => {
  it('creates a new collection', async () => {
    const res = makeRes();
    await cols.apiCollectionCreate(makeJsonReq('/create', { name: 'Favourites' }), res);
    expect(res.jsonBody.ok).toBe(true);
    expect(res.jsonBody.name).toBe('Favourites');
    expect(state.collections).toHaveLength(1);
    expect(state.collections[0].name).toBe('Favourites');
    expect(state.collections[0].ids).toEqual([]);
  });

  it('rejects empty name', async () => {
    const res = makeRes();
    await cols.apiCollectionCreate(makeJsonReq('/create', { name: '   ' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects duplicate name', async () => {
    await cols.apiCollectionCreate(makeJsonReq('/create', { name: 'Dups' }), makeRes());
    const res = makeRes();
    await cols.apiCollectionCreate(makeJsonReq('/create', { name: 'Dups' }), res);
    expect(res.statusCode).toBe(400);
    expect(state.collections).toHaveLength(1);
  });

  it('trims whitespace from name', async () => {
    const res = makeRes();
    await cols.apiCollectionCreate(makeJsonReq('/create', { name: '  Trimmed  ' }), res);
    expect(res.jsonBody.name).toBe('Trimmed');
  });
});

describe('apiCollectionDelete()', () => {
  beforeEach(async () => {
    await cols.apiCollectionCreate(makeJsonReq('/create', { name: 'ToDelete' }), makeRes());
  });

  it('deletes an existing collection', async () => {
    const res = makeRes();
    await cols.apiCollectionDelete({}, res, 'ToDelete');
    expect(res.jsonBody.ok).toBe(true);
    expect(state.collections).toHaveLength(0);
  });

  it('returns 404 for non-existent collection', async () => {
    const res = makeRes();
    await cols.apiCollectionDelete({}, res, 'Ghost');
    expect(res.statusCode).toBe(404);
  });

  it('does not affect other collections', async () => {
    await cols.apiCollectionCreate(makeJsonReq('/create', { name: 'Keep' }), makeRes());
    await cols.apiCollectionDelete({}, makeRes(), 'ToDelete');
    expect(state.collections.map(c => c.name)).toEqual(['Keep']);
  });
});

describe('apiCollectionAddVideo()', () => {
  beforeEach(async () => {
    await cols.apiCollectionCreate(makeJsonReq('/create', { name: 'MyList' }), makeRes());
  });

  it('adds a video id to a collection', async () => {
    const res = makeRes();
    await cols.apiCollectionAddVideo(makeJsonReq('/add', { id: 'vid001' }), res, 'MyList');
    expect(res.jsonBody.ok).toBe(true);
    expect(state.collections[0].ids).toContain('vid001');
  });

  it('does not add the same id twice', async () => {
    await cols.apiCollectionAddVideo(makeJsonReq('/add', { id: 'vid001' }), makeRes(), 'MyList');
    await cols.apiCollectionAddVideo(makeJsonReq('/add', { id: 'vid001' }), makeRes(), 'MyList');
    expect(state.collections[0].ids).toHaveLength(1);
  });

  it('returns 400 when id is missing', async () => {
    const res = makeRes();
    await cols.apiCollectionAddVideo(makeJsonReq('/add', {}), res, 'MyList');
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for unknown collection', async () => {
    const res = makeRes();
    await cols.apiCollectionAddVideo(makeJsonReq('/add', { id: 'v1' }), res, 'Ghost');
    expect(res.statusCode).toBe(404);
  });
});

describe('apiCollectionRemoveVideo()', () => {
  beforeEach(async () => {
    await cols.apiCollectionCreate(makeJsonReq('/create', { name: 'List' }), makeRes());
    await cols.apiCollectionAddVideo(makeJsonReq('/add', { id: 'vid001' }), makeRes(), 'List');
    await cols.apiCollectionAddVideo(makeJsonReq('/add', { id: 'vid002' }), makeRes(), 'List');
  });

  it('removes a video from a collection', async () => {
    const res = makeRes();
    await cols.apiCollectionRemoveVideo({}, res, 'List', 'vid001');
    expect(res.jsonBody.ok).toBe(true);
    expect(state.collections[0].ids).not.toContain('vid001');
    expect(state.collections[0].ids).toContain('vid002');
  });

  it('is a no-op when video id is not present', async () => {
    const res = makeRes();
    await cols.apiCollectionRemoveVideo({}, res, 'List', 'ghost-id');
    expect(res.jsonBody.ok).toBe(true);
    expect(state.collections[0].ids).toHaveLength(2);
  });

  it('returns 404 for unknown collection', async () => {
    const res = makeRes();
    await cols.apiCollectionRemoveVideo({}, res, 'Ghost', 'vid001');
    expect(res.statusCode).toBe(404);
  });
});

describe('apiCollectionVideos()', () => {
  beforeEach(async () => {
    state.videos = [
      { id: 'vid001', name: 'Alpha' },
      { id: 'vid002', name: 'Beta' },
    ];
    await cols.apiCollectionCreate(makeJsonReq('/create', { name: 'MyVids' }), makeRes());
    await cols.apiCollectionAddVideo(makeJsonReq('/add', { id: 'vid001' }), makeRes(), 'MyVids');
    await cols.apiCollectionAddVideo(makeJsonReq('/add', { id: 'vid002' }), makeRes(), 'MyVids');
  });

  it('returns all videos in a collection', async () => {
    const req = makeJsonReq('/');
    req.url = '/api/collections/MyVids/videos';
    const res = makeRes();
    await cols.apiCollectionVideos(req, res, 'MyVids');
    expect(res.jsonBody).toHaveLength(2);
    const ids = res.jsonBody.map(v => v.id);
    expect(ids).toContain('vid001');
    expect(ids).toContain('vid002');
  });

  it('marks favourited videos', async () => {
    state.favs = ['vid001'];
    const req = makeJsonReq('/');
    req.url = '/api/collections/MyVids/videos';
    const res = makeRes();
    await cols.apiCollectionVideos(req, res, 'MyVids');
    const v1 = res.jsonBody.find(v => v.id === 'vid001');
    const v2 = res.jsonBody.find(v => v.id === 'vid002');
    expect(v1.fav).toBe(true);
    expect(v2.fav).toBe(false);
  });

  it('filters to only favs when ?fav=1 is set', async () => {
    state.favs = ['vid001'];
    const req = makeJsonReq('/');
    req.url = '/api/collections/MyVids/videos?fav=1';
    const res = makeRes();
    await cols.apiCollectionVideos(req, res, 'MyVids');
    expect(res.jsonBody).toHaveLength(1);
    expect(res.jsonBody[0].id).toBe('vid001');
  });

  it('silently skips video ids that no longer exist', async () => {
    await cols.apiCollectionAddVideo(makeJsonReq('/add', { id: 'ghost-id' }), makeRes(), 'MyVids');
    const req = makeJsonReq('/');
    req.url = '/api/collections/MyVids/videos';
    const res = makeRes();
    await cols.apiCollectionVideos(req, res, 'MyVids');
    expect(res.jsonBody).toHaveLength(2); // ghost-id is filtered out
  });

  it('returns 404 for unknown collection', async () => {
    const req = makeJsonReq('/');
    req.url = '/api/collections/Ghost/videos';
    const res = makeRes();
    await cols.apiCollectionVideos(req, res, 'Ghost');
    expect(res.statusCode).toBe(404);
  });
});

describe('apiCollections()', () => {
  beforeEach(async () => {
    state.videos = [{ id: 'vid001', name: 'Alpha' }];
    await cols.apiCollectionCreate(makeJsonReq('/create', { name: 'A' }), makeRes());
    await cols.apiCollectionCreate(makeJsonReq('/create', { name: 'B' }), makeRes());
    await cols.apiCollectionAddVideo(makeJsonReq('/add', { id: 'vid001' }), makeRes(), 'A');
  });

  it('returns all collections with their count', async () => {
    const req = makeJsonReq('/');
    req.url = '/api/collections';
    const res = makeRes();
    await cols.apiCollections(req, res);
    expect(res.jsonBody).toHaveLength(2);
    const a = res.jsonBody.find(c => c.name === 'A');
    const b = res.jsonBody.find(c => c.name === 'B');
    expect(a.count).toBe(1);
    expect(b.count).toBe(0);
  });

  it('includes a thumb from first valid video', async () => {
    const req = makeJsonReq('/');
    req.url = '/api/collections';
    const res = makeRes();
    await cols.apiCollections(req, res);
    const a = res.jsonBody.find(c => c.name === 'A');
    expect(a.thumb).not.toBeNull();
    expect(a.thumb.id).toBe('vid001');
  });

  it('returns null thumb for empty collection', async () => {
    const req = makeJsonReq('/');
    req.url = '/api/collections';
    const res = makeRes();
    await cols.apiCollections(req, res);
    const b = res.jsonBody.find(c => c.name === 'B');
    expect(b.thumb).toBeNull();
  });
});
