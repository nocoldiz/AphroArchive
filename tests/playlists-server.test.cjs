'use strict';

/* global describe, it, expect, beforeEach, afterAll, vi */

const fs = require('fs');
const path = require('path');
const os = require('os');
const stream = require('stream');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aphro-playlists-test-'));

function injectMock(relPath, exports) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = {
    id: resolved, filename: resolved, loaded: true,
    exports, children: [], paths: [],
  };
}

// ── Mocks ─────────────────────────────────────────────────────────────

const state = {
  playlists: [],
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
  loadPlaylists: vi.fn(() => state.playlists.map(c => ({ ...c, ids: [...c.ids] }))),
  savePlaylists: vi.fn((c) => { state.playlists = c.map(pl => ({ ...pl, ids: [...pl.ids] })); }),
  loadFavs: vi.fn(() => [...state.favs]),
});

injectMock('../server/videos-server', {
  allVideos: vi.fn(async () => state.videos.map(v => ({ ...v }))),
});

const pls = require('../server/playlists-server');

afterAll(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

beforeEach(() => {
  state.playlists = [];
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

describe('apiPlaylistCreate()', () => {
  it('creates a new playlist', async () => {
    const res = makeRes();
    await pls.apiPlaylistCreate(makeJsonReq('/create', { name: 'Favourites' }), res);
    expect(res.jsonBody.ok).toBe(true);
    expect(res.jsonBody.name).toBe('Favourites');
    expect(state.playlists).toHaveLength(1);
    expect(state.playlists[0].name).toBe('Favourites');
    expect(state.playlists[0].ids).toEqual([]);
  });

  it('rejects empty name', async () => {
    const res = makeRes();
    await pls.apiPlaylistCreate(makeJsonReq('/create', { name: '   ' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects duplicate name', async () => {
    await pls.apiPlaylistCreate(makeJsonReq('/create', { name: 'Dups' }), makeRes());
    const res = makeRes();
    await pls.apiPlaylistCreate(makeJsonReq('/create', { name: 'Dups' }), res);
    expect(res.statusCode).toBe(400);
    expect(state.playlists).toHaveLength(1);
  });

  it('trims whitespace from name', async () => {
    const res = makeRes();
    await pls.apiPlaylistCreate(makeJsonReq('/create', { name: '  Trimmed  ' }), res);
    expect(res.jsonBody.name).toBe('Trimmed');
  });
});

describe('apiPlaylistDelete()', () => {
  beforeEach(async () => {
    await pls.apiPlaylistCreate(makeJsonReq('/create', { name: 'ToDelete' }), makeRes());
  });

  it('deletes an existing playlist', async () => {
    const res = makeRes();
    await pls.apiPlaylistDelete({}, res, 'ToDelete');
    expect(res.jsonBody.ok).toBe(true);
    expect(state.playlists).toHaveLength(0);
  });

  it('returns 404 for non-existent playlist', async () => {
    const res = makeRes();
    await pls.apiPlaylistDelete({}, res, 'Ghost');
    expect(res.statusCode).toBe(404);
  });

  it('does not affect other playlists', async () => {
    await pls.apiPlaylistCreate(makeJsonReq('/create', { name: 'Keep' }), makeRes());
    await pls.apiPlaylistDelete({}, makeRes(), 'ToDelete');
    expect(state.playlists.map(c => c.name)).toEqual(['Keep']);
  });
});

describe('apiPlaylistAddVideo()', () => {
  beforeEach(async () => {
    await pls.apiPlaylistCreate(makeJsonReq('/create', { name: 'MyList' }), makeRes());
  });

  it('adds a video id to a playlist', async () => {
    const res = makeRes();
    await pls.apiPlaylistAddVideo(makeJsonReq('/add', { id: 'vid001' }), res, 'MyList');
    expect(res.jsonBody.ok).toBe(true);
    expect(state.playlists[0].ids).toContain('vid001');
  });

  it('does not add the same id twice', async () => {
    await pls.apiPlaylistAddVideo(makeJsonReq('/add', { id: 'vid001' }), makeRes(), 'MyList');
    await pls.apiPlaylistAddVideo(makeJsonReq('/add', { id: 'vid001' }), makeRes(), 'MyList');
    expect(state.playlists[0].ids).toHaveLength(1);
  });

  it('returns 400 when id is missing', async () => {
    const res = makeRes();
    await pls.apiPlaylistAddVideo(makeJsonReq('/add', {}), res, 'MyList');
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for unknown playlist', async () => {
    const res = makeRes();
    await pls.apiPlaylistAddVideo(makeJsonReq('/add', { id: 'v1' }), res, 'Ghost');
    expect(res.statusCode).toBe(404);
  });
});

describe('apiPlaylistRemoveVideo()', () => {
  beforeEach(async () => {
    await pls.apiPlaylistCreate(makeJsonReq('/create', { name: 'List' }), makeRes());
    await pls.apiPlaylistAddVideo(makeJsonReq('/add', { id: 'vid001' }), makeRes(), 'List');
    await pls.apiPlaylistAddVideo(makeJsonReq('/add', { id: 'vid002' }), makeRes(), 'List');
  });

  it('removes a video from a playlist', async () => {
    const res = makeRes();
    await pls.apiPlaylistRemoveVideo({}, res, 'List', 'vid001');
    expect(res.jsonBody.ok).toBe(true);
    expect(state.playlists[0].ids).not.toContain('vid001');
    expect(state.playlists[0].ids).toContain('vid002');
  });

  it('is a no-op when video id is not present', async () => {
    const res = makeRes();
    await pls.apiPlaylistRemoveVideo({}, res, 'List', 'ghost-id');
    expect(res.jsonBody.ok).toBe(true);
    expect(state.playlists[0].ids).toHaveLength(2);
  });

  it('returns 404 for unknown playlist', async () => {
    const res = makeRes();
    await pls.apiPlaylistRemoveVideo({}, res, 'Ghost', 'vid001');
    expect(res.statusCode).toBe(404);
  });
});

describe('apiPlaylistVideos()', () => {
  beforeEach(async () => {
    state.videos = [
      { id: 'vid001', name: 'Alpha' },
      { id: 'vid002', name: 'Beta' },
    ];
    await pls.apiPlaylistCreate(makeJsonReq('/create', { name: 'MyVids' }), makeRes());
    await pls.apiPlaylistAddVideo(makeJsonReq('/add', { id: 'vid001' }), makeRes(), 'MyVids');
    await pls.apiPlaylistAddVideo(makeJsonReq('/add', { id: 'vid002' }), makeRes(), 'MyVids');
  });

  it('returns all videos in a playlist', async () => {
    const req = makeJsonReq('/');
    req.url = '/api/playlists/MyVids/videos';
    const res = makeRes();
    await pls.apiPlaylistVideos(req, res, 'MyVids');
    expect(res.jsonBody).toHaveLength(2);
    const ids = res.jsonBody.map(v => v.id);
    expect(ids).toContain('vid001');
    expect(ids).toContain('vid002');
  });

  it('marks favourited videos', async () => {
    state.favs = ['vid001'];
    const req = makeJsonReq('/');
    req.url = '/api/playlists/MyVids/videos';
    const res = makeRes();
    await pls.apiPlaylistVideos(req, res, 'MyVids');
    const v1 = res.jsonBody.find(v => v.id === 'vid001');
    const v2 = res.jsonBody.find(v => v.id === 'vid002');
    expect(v1.fav).toBe(true);
    expect(v2.fav).toBe(false);
  });

  it('filters to only favs when ?fav=1 is set', async () => {
    state.favs = ['vid001'];
    const req = makeJsonReq('/');
    req.url = '/api/playlists/MyVids/videos?fav=1';
    const res = makeRes();
    await pls.apiPlaylistVideos(req, res, 'MyVids');
    expect(res.jsonBody).toHaveLength(1);
    expect(res.jsonBody[0].id).toBe('vid001');
  });

  it('silently skips video ids that no longer exist', async () => {
    await pls.apiPlaylistAddVideo(makeJsonReq('/add', { id: 'ghost-id' }), makeRes(), 'MyVids');
    const req = makeJsonReq('/');
    req.url = '/api/playlists/MyVids/videos';
    const res = makeRes();
    await pls.apiPlaylistVideos(req, res, 'MyVids');
    expect(res.jsonBody).toHaveLength(2); // ghost-id is filtered out
  });

  it('returns 404 for unknown playlist', async () => {
    const req = makeJsonReq('/');
    req.url = '/api/playlists/Ghost/videos';
    const res = makeRes();
    await pls.apiPlaylistVideos(req, res, 'Ghost');
    expect(res.statusCode).toBe(404);
  });
});

describe('apiPlaylists()', () => {
  beforeEach(async () => {
    state.videos = [{ id: 'vid001', name: 'Alpha' }];
    await pls.apiPlaylistCreate(makeJsonReq('/create', { name: 'A' }), makeRes());
    await pls.apiPlaylistCreate(makeJsonReq('/create', { name: 'B' }), makeRes());
    await pls.apiPlaylistAddVideo(makeJsonReq('/add', { id: 'vid001' }), makeRes(), 'A');
  });

  it('returns all playlists with their count', async () => {
    const req = makeJsonReq('/');
    req.url = '/api/playlists';
    const res = makeRes();
    await pls.apiPlaylists(req, res);
    expect(res.jsonBody).toHaveLength(2);
    const a = res.jsonBody.find(c => c.name === 'A');
    const b = res.jsonBody.find(c => c.name === 'B');
    expect(a.count).toBe(1);
    expect(b.count).toBe(0);
  });

  it('includes a thumb from first valid video', async () => {
    const req = makeJsonReq('/');
    req.url = '/api/playlists';
    const res = makeRes();
    await pls.apiPlaylists(req, res);
    const a = res.jsonBody.find(c => c.name === 'A');
    expect(a.thumb).not.toBeNull();
    expect(a.thumb.id).toBe('vid001');
  });

  it('returns null thumb for empty playlist', async () => {
    const req = makeJsonReq('/');
    req.url = '/api/playlists';
    const res = makeRes();
    await pls.apiPlaylists(req, res);
    const b = res.jsonBody.find(c => c.name === 'B');
    expect(b.thumb).toBeNull();
  });
});
