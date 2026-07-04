'use strict';

/* global describe, it, expect, beforeAll, afterAll, beforeEach, vi */

// ─────────────────────────────────────────────────────────────────────
//  File-operation handlers in videos-server.js
//
//  Exercises the real handlers (apiMove / apiDelete / apiRename and the
//  physical folder CRUD) against a temp filesystem, so we know that a move
//  actually relocates the file on disk, a delete removes it, a rename keeps
//  sidecars in sync, and that the favourites / metadata records are migrated
//  to the new id. config-server and db-server are mocked the same way the
//  other *-server tests mock them.
// ─────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const os = require('os');
const stream = require('stream');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aphro-fileops-test-'));
const MOCK_VIDEOS_DIR = path.join(TMP, 'videos');
const MOCK_THUMBS_DIR = path.join(TMP, 'thumbs');
const MOCK_PUBLIC_DIR = path.join(TMP, 'public');

// The videos directory must exist before videos-server is required: the module
// calls fs.watch(VIDEOS_DIR) at load time.
fs.mkdirSync(MOCK_VIDEOS_DIR, { recursive: true });
fs.mkdirSync(MOCK_THUMBS_DIR, { recursive: true });
fs.mkdirSync(MOCK_PUBLIC_DIR, { recursive: true });

function injectMock(relPath, exports) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = {
    id: resolved, filename: resolved, loaded: true,
    exports, children: [], paths: [],
  };
}

const SET = (arr) => new Set(arr);

injectMock('../server/config-server', {
  VIDEOS_DIR: MOCK_VIDEOS_DIR,
  VAULT_DIR: path.join(MOCK_VIDEOS_DIR, '.vault'),
  IGNORED_DIR: path.join(MOCK_VIDEOS_DIR, '.ignored'),
  THUMBS_DIR: MOCK_THUMBS_DIR,
  CACHE_DIR: path.join(TMP, 'cache'),
  ROOT_DIR: TMP,
  PUBLIC_DIR: MOCK_PUBLIC_DIR,
  AUDIO_DIR: path.join(TMP, 'audio'),
  BOOKS_DIR: path.join(TMP, 'books'),
  PHOTOS_DIR: path.join(TMP, 'photos'),
  FILES_DIR: path.join(TMP, 'files'),
  VIDEO_EXT: SET(['.mp4', '.mkv', '.webm', '.avi', '.mov']),
  AUDIO_EXT: SET(['.mp3', '.flac', '.wav', '.m4a']),
  BOOK_EXT: SET(['.pdf', '.epub']),
  IMAGE_EXT: SET(['.jpg', '.jpeg', '.png', '.webp']),
  MIME: {},
  STATIC_MIME: {},
  IS_PKG: false,
  FFMPEG_BIN: 'ffmpeg',
  FFPROBE_BIN: 'ffprobe',
  YT_DLP_BIN: 'yt-dlp',
});

// db-server is a write-through cache layer; back it with plain in-memory state.
// A Proxy supplies a no-op for any other db function videos-server touches at
// load time or in code paths we don't assert on (index/scan persistence, etc.).
const dbState = { favs: [], meta: {}, thumbs: {} };
const dbImpl = {
  loadFavs: () => dbState.favs,
  saveFavs: (v) => { dbState.favs = v.slice(); },
  loadVideoMeta: () => dbState.meta,
  saveVideoMeta: (v) => { dbState.meta = v; },
  loadThumbsCache: () => dbState.thumbs,
  saveThumbsCache: (v) => { dbState.thumbs = v; },
  getDefaultWriteRoot: () => MOCK_VIDEOS_DIR,
  resolveCategoryPhysicalPath: (p) => (p ? path.join(MOCK_VIDEOS_DIR, p) : MOCK_VIDEOS_DIR),
  getCurrentProfile: () => 'default',
  loadPrefs: () => ({}),
  deleteVideoMetaEverywhere: (id) => { delete dbState.meta[id]; },
};
injectMock('../server/db-server', new Proxy(dbImpl, {
  get(target, prop) {
    if (prop in target) return target[prop];
    return () => undefined;
  },
}));

const helpers = require('../server/helpers-server');
const vids = require('../server/videos-server');
const { toId, fromId } = helpers;

// ─── tiny req/res doubles ─────────────────────────────────────────────

function makeReq(body) {
  const req = new stream.Readable({ read() {} });
  req.push(Buffer.from(JSON.stringify(body == null ? {} : body)));
  req.push(null);
  return req;
}

function makeRes() {
  const chunks = [];
  let sc = 200, hdrs = {};
  return {
    writeHead(s, h) { sc = s; hdrs = { ...hdrs, ...(h || {}) }; return this; },
    setHeader(k, v) { hdrs[k] = v; },
    end(b) { if (b) chunks.push(Buffer.isBuffer(b) ? b : Buffer.from(String(b))); },
    get statusCode() { return sc; },
    get headers() { return hdrs; },
    get body() { return Buffer.concat(chunks).toString(); },
    get jsonBody() { try { return JSON.parse(this.body); } catch { return null; } },
  };
}

// Write a placeholder file, creating parent dirs as needed.
function touch(relPath, content = 'data') {
  const full = path.join(MOCK_VIDEOS_DIR, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

function exists(relPath) {
  return fs.existsSync(path.join(MOCK_VIDEOS_DIR, relPath));
}

function wipeVideos() {
  for (const ent of fs.readdirSync(MOCK_VIDEOS_DIR)) {
    fs.rmSync(path.join(MOCK_VIDEOS_DIR, ent), { recursive: true, force: true });
  }
}

beforeEach(() => {
  wipeVideos();
  dbState.favs = [];
  dbState.meta = {};
  dbState.thumbs = {};
});

afterAll(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

// ─── apiMove() ───────────────────────────────────────────────────────

describe('apiMove()', () => {
  it('relocates the file on disk into the target category, creating it', async () => {
    touch('Cat1/clip.mp4');
    const id = toId('Cat1/clip.mp4');
    const res = makeRes();
    await vids.apiMove(makeReq({ category: 'Cat2' }), res, id);

    expect(res.jsonBody.ok).toBe(true);
    expect(exists('Cat1/clip.mp4')).toBe(false);
    expect(exists('Cat2/clip.mp4')).toBe(true);
    // Returned id decodes to the new location.
    expect(fromId(res.jsonBody.newId).replace(/\\/g, '/')).toBe('Cat2/clip.mp4');
  });

  it('moves into a freshly created nested category path', async () => {
    touch('clip.mp4');
    const id = toId('clip.mp4');
    const res = makeRes();
    await vids.apiMove(makeReq({ category: 'A/B/C' }), res, id);

    expect(res.jsonBody.ok).toBe(true);
    expect(exists('A/B/C/clip.mp4')).toBe(true);
  });

  it('migrates the favourite + metadata records to the new id', async () => {
    touch('Cat1/clip.mp4');
    const id = toId('Cat1/clip.mp4');
    dbState.favs = [id];
    dbState.meta = { [id]: { title: 'clip', rating: 5 } };

    const res = makeRes();
    await vids.apiMove(makeReq({ category: 'Cat2' }), res, id);
    const newId = res.jsonBody.newId;

    expect(dbState.favs).toContain(newId);
    expect(dbState.favs).not.toContain(id);
    expect(dbState.meta[newId]).toBeTruthy();
    expect(dbState.meta[newId].rating).toBe(5);
    expect(dbState.meta[newId].category).toBe('Cat2');
    expect(dbState.meta[id]).toBeUndefined();
  });

  it('carries subtitle sidecars along with the video', async () => {
    touch('Cat1/clip.mp4');
    touch('Cat1/clip.srt', 'subs');
    touch('Cat1/clip.en.vtt', 'vtt subs');
    const id = toId('Cat1/clip.mp4');

    const res = makeRes();
    await vids.apiMove(makeReq({ category: 'Cat2' }), res, id);

    expect(res.jsonBody.ok).toBe(true);
    expect(exists('Cat2/clip.srt')).toBe(true);
    expect(exists('Cat2/clip.en.vtt')).toBe(true);
    expect(exists('Cat1/clip.srt')).toBe(false);
  });

  it('moves a categorised file back to the library root', async () => {
    touch('Cat1/clip.mp4');
    const id = toId('Cat1/clip.mp4');
    const res = makeRes();
    await vids.apiMove(makeReq({ category: '' }), res, id);

    expect(res.jsonBody.ok).toBe(true);
    expect(exists('clip.mp4')).toBe(true);
    expect(exists('Cat1/clip.mp4')).toBe(false);
  });

  it('refuses when a file with the same name already exists in the target (409)', async () => {
    touch('Cat1/clip.mp4');
    touch('Cat2/clip.mp4', 'other');
    const id = toId('Cat1/clip.mp4');
    const res = makeRes();
    await vids.apiMove(makeReq({ category: 'Cat2' }), res, id);

    expect(res.statusCode).toBe(409);
    expect(exists('Cat1/clip.mp4')).toBe(true); // original untouched
  });

  it('rejects moving into the same category (400)', async () => {
    touch('Cat1/clip.mp4');
    const id = toId('Cat1/clip.mp4');
    const res = makeRes();
    await vids.apiMove(makeReq({ category: 'Cat1' }), res, id);

    expect(res.statusCode).toBe(400);
    expect(exists('Cat1/clip.mp4')).toBe(true);
  });

  it('returns 404 for a file that does not exist', async () => {
    const id = toId('ghost/missing.mp4');
    const res = makeRes();
    await vids.apiMove(makeReq({ category: 'Cat2' }), res, id);
    expect(res.statusCode).toBe(404);
  });
});

// ─── apiDelete() ─────────────────────────────────────────────────────

describe('apiDelete()', () => {
  it('removes the file from disk', () => {
    touch('Cat1/clip.mp4');
    const id = toId('Cat1/clip.mp4');
    const res = makeRes();
    vids.apiDelete(makeReq(), res, id);

    expect(res.jsonBody.ok).toBe(true);
    expect(exists('Cat1/clip.mp4')).toBe(false);
  });

  it('purges favourite, thumbnail-cache and metadata records', () => {
    touch('clip.mp4');
    const id = toId('clip.mp4');
    dbState.favs = [id];
    dbState.meta = { [id]: { title: 'clip' } };
    dbState.thumbs = { [id]: { duration: 12 } };

    const res = makeRes();
    vids.apiDelete(makeReq(), res, id);

    expect(dbState.favs).not.toContain(id);
    expect(dbState.meta[id]).toBeUndefined();
    expect(dbState.thumbs[id]).toBeUndefined();
  });

  it('treats a missing file as a stale entry and cleans up gracefully', () => {
    const id = toId('never/existed.mp4');
    const res = makeRes();
    vids.apiDelete(makeReq(), res, id);

    expect(res.jsonBody.ok).toBe(true);
    expect(res.jsonBody.stale).toBe(true);
  });
});

// ─── apiRename() ─────────────────────────────────────────────────────

describe('apiRename()', () => {
  it('renames the file in place, returns the new id, and migrates metadata', async () => {
    touch('Cat1/old.mp4');
    const id = toId('Cat1/old.mp4');
    dbState.meta = { [id]: { title: 'old', rating: 3 } };
    const res = makeRes();
    await vids.apiRename(makeReq({ newName: 'brand new' }), res, id);

    expect(res.jsonBody.ok).toBe(true);
    expect(exists('Cat1/old.mp4')).toBe(false);
    expect(exists('Cat1/brand new.mp4')).toBe(true);
    // Metadata follows the file and the title is updated to the new name.
    const newMeta = dbState.meta[res.jsonBody.newId];
    expect(newMeta.title).toBe('brand new');
    expect(newMeta.rating).toBe(3);
    expect(dbState.meta[id]).toBeUndefined();
  });

  it('renames matching subtitle sidecars too', async () => {
    touch('Cat1/old.mp4');
    touch('Cat1/old.srt', 'subs');
    touch('Cat1/old.en.vtt', 'vtt');
    const id = toId('Cat1/old.mp4');
    const res = makeRes();
    await vids.apiRename(makeReq({ newName: 'fresh' }), res, id);

    expect(exists('Cat1/fresh.srt')).toBe(true);
    expect(exists('Cat1/fresh.en.vtt')).toBe(true);
    expect(exists('Cat1/old.srt')).toBe(false);
  });

  it('strips filesystem-unsafe characters from the new name', async () => {
    touch('clip.mp4');
    const id = toId('clip.mp4');
    const res = makeRes();
    await vids.apiRename(makeReq({ newName: 'a/b:c*?d' }), res, id);

    expect(res.jsonBody.ok).toBe(true);
    expect(exists('a_b_c__d.mp4')).toBe(true);
  });

  it('rejects an empty name (400)', async () => {
    touch('clip.mp4');
    const id = toId('clip.mp4');
    const res = makeRes();
    await vids.apiRename(makeReq({ newName: '   ' }), res, id);
    expect(res.statusCode).toBe(400);
  });

  it('refuses to overwrite an existing name (409)', async () => {
    touch('a.mp4');
    touch('b.mp4');
    const id = toId('a.mp4');
    const res = makeRes();
    await vids.apiRename(makeReq({ newName: 'b' }), res, id);

    expect(res.statusCode).toBe(409);
    expect(exists('a.mp4')).toBe(true);
  });
});

// ─── apiCreateFolder() / apiFolderCreate() ───────────────────────────

describe('apiCreateFolder()', () => {
  it('creates a top-level folder', async () => {
    const res = makeRes();
    await vids.apiCreateFolder(makeReq({ name: 'New Folder' }), res);
    expect(res.jsonBody.ok).toBe(true);
    expect(fs.existsSync(path.join(MOCK_VIDEOS_DIR, 'New Folder'))).toBe(true);
  });

  it('rejects an empty name (400)', async () => {
    const res = makeRes();
    await vids.apiCreateFolder(makeReq({ name: '' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('reports a conflict when the folder already exists (409)', async () => {
    fs.mkdirSync(path.join(MOCK_VIDEOS_DIR, 'Dup'));
    const res = makeRes();
    await vids.apiCreateFolder(makeReq({ name: 'Dup' }), res);
    expect(res.statusCode).toBe(409);
  });
});

describe('apiFolderCreate()', () => {
  it('creates a nested folder under a parent path', async () => {
    fs.mkdirSync(path.join(MOCK_VIDEOS_DIR, 'Parent'));
    const res = makeRes();
    await vids.apiFolderCreate(makeReq({ parentPath: 'Parent', name: 'Child' }), res);
    expect(res.jsonBody.ok).toBe(true);
    expect(exists('Parent/Child')).toBe(true);
  });

  it('rejects a conflict (409)', async () => {
    fs.mkdirSync(path.join(MOCK_VIDEOS_DIR, 'X'));
    const res = makeRes();
    await vids.apiFolderCreate(makeReq({ name: 'X' }), res);
    expect(res.statusCode).toBe(409);
  });
});

// ─── apiFolderRename() ───────────────────────────────────────────────

describe('apiFolderRename()', () => {
  it('renames a folder on disk, keeping its contents', async () => {
    touch('OldName/inside.mp4');
    const res = makeRes();
    await vids.apiFolderRename(makeReq({ path: 'OldName', newName: 'NewName' }), res);

    expect(res.jsonBody.ok).toBe(true);
    expect(exists('NewName/inside.mp4')).toBe(true);
    expect(exists('OldName')).toBe(false);
  });

  it('returns 404 when the source folder is missing', async () => {
    const res = makeRes();
    await vids.apiFolderRename(makeReq({ path: 'Nope', newName: 'Whatever' }), res);
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 when the target name already exists', async () => {
    fs.mkdirSync(path.join(MOCK_VIDEOS_DIR, 'A'));
    fs.mkdirSync(path.join(MOCK_VIDEOS_DIR, 'B'));
    const res = makeRes();
    await vids.apiFolderRename(makeReq({ path: 'A', newName: 'B' }), res);
    expect(res.statusCode).toBe(409);
  });
});

// ─── apiFolderDelete() ───────────────────────────────────────────────

describe('apiFolderDelete()', () => {
  it('removes the folder and lifts its contents into the parent', async () => {
    touch('Doomed/keep.mp4');
    const res = makeRes();
    await vids.apiFolderDelete(makeReq({ path: 'Doomed' }), res);

    expect(res.jsonBody.ok).toBe(true);
    expect(exists('Doomed')).toBe(false);
    expect(exists('keep.mp4')).toBe(true);
  });

  it('de-duplicates filenames that already exist in the parent', async () => {
    touch('keep.mp4', 'root copy');
    touch('Doomed/keep.mp4', 'nested copy');
    const res = makeRes();
    await vids.apiFolderDelete(makeReq({ path: 'Doomed' }), res);

    expect(res.jsonBody.ok).toBe(true);
    expect(exists('keep.mp4')).toBe(true);
    expect(exists('keep(1).mp4')).toBe(true);
  });

  it('returns 404 for a missing folder', async () => {
    const res = makeRes();
    await vids.apiFolderDelete(makeReq({ path: 'Ghost' }), res);
    expect(res.statusCode).toBe(404);
  });
});

// ─── apiFolderMove() ─────────────────────────────────────────────────

describe('apiFolderMove()', () => {
  it('moves a folder under a new parent', async () => {
    touch('Mover/file.mp4');
    fs.mkdirSync(path.join(MOCK_VIDEOS_DIR, 'Dest'));
    const res = makeRes();
    await vids.apiFolderMove(makeReq({ fromPath: 'Mover', toParentPath: 'Dest' }), res);

    expect(res.jsonBody.ok).toBe(true);
    expect(exists('Dest/Mover/file.mp4')).toBe(true);
    expect(exists('Mover')).toBe(false);
  });

  it('refuses to move a folder into itself (400)', async () => {
    fs.mkdirSync(path.join(MOCK_VIDEOS_DIR, 'Self'));
    const res = makeRes();
    await vids.apiFolderMove(makeReq({ fromPath: 'Self', toParentPath: 'Self' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 409 when the target already exists', async () => {
    fs.mkdirSync(path.join(MOCK_VIDEOS_DIR, 'Move2'));
    fs.mkdirSync(path.join(MOCK_VIDEOS_DIR, 'Target'), { recursive: true });
    fs.mkdirSync(path.join(MOCK_VIDEOS_DIR, 'Target', 'Move2'), { recursive: true });
    const res = makeRes();
    await vids.apiFolderMove(makeReq({ fromPath: 'Move2', toParentPath: 'Target' }), res);
    expect(res.statusCode).toBe(409);
  });

  it('returns 404 when the source folder is missing', async () => {
    const res = makeRes();
    await vids.apiFolderMove(makeReq({ fromPath: 'Vanished', toParentPath: '' }), res);
    expect(res.statusCode).toBe(404);
  });
});

// ─── apiVideos() pagination / slim mode ───────────────────────────────
// Regression tests for the first-load fixes: ?offset&limit returns
// {total, items} (client paints page 1 instantly), ?slim=1 strips the
// heavyweight per-video fields, and the favs Set refactor keeps the same
// fav flags as the old favs.includes() path.

describe('apiVideos() pagination and slim mode', () => {
  const mkParams = (qs) => new URLSearchParams(qs);
  // The scan derives ids from OS-native relative paths (backslashes on
  // Windows), so build test ids the same way instead of hardcoding '/'.
  const scanId = (...parts) => toId(path.join(...parts));

  beforeEach(() => {
    // Three videos across two categories; invalidate so the scan re-runs.
    touch('CatA/one.mp4');
    touch('CatA/two.mp4');
    touch('CatB/three.mp4');
    vids.invalidateScanCache();
  });

  it('returns the legacy full array when no paging params are given', async () => {
    const res = makeRes();
    await vids.apiVideos({ headers: {} }, res, mkParams(''));
    const body = res.jsonBody;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(3);
    // Full mode keeps the heavyweight fields.
    expect(body[0]).toHaveProperty('actors');
    expect(body[0]).toHaveProperty('note');
    expect(body[0]).toHaveProperty('chapters');
  });

  it('returns {total, items} with correct slices in paged mode', async () => {
    const page1 = makeRes();
    await vids.apiVideos({ headers: {} }, page1, mkParams('limit=2&offset=0'));
    expect(page1.jsonBody.total).toBe(3);
    expect(page1.jsonBody.items.length).toBe(2);

    const page2 = makeRes();
    await vids.apiVideos({ headers: {} }, page2, mkParams('limit=2&offset=2'));
    expect(page2.jsonBody.total).toBe(3);
    expect(page2.jsonBody.items.length).toBe(1);

    // Pages don't overlap and cover the whole list.
    const ids = [...page1.jsonBody.items, ...page2.jsonBody.items].map(v => v.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('strips chapters/note/actors in slim mode but keeps grid fields', async () => {
    const id = scanId('CatA', 'one.mp4');
    dbState.meta[id] = { title: 'one', actors: ['A'], tags: ['t'], note: 'n', chapters: [{ id: 1 }], rating: 4 };

    const res = makeRes();
    await vids.apiVideos({ headers: {} }, res, mkParams('limit=10&slim=1'));
    const item = res.jsonBody.items.find(v => v.id === id);
    expect(item).toBeTruthy();
    expect(item).not.toHaveProperty('actors');
    expect(item).not.toHaveProperty('note');
    expect(item).not.toHaveProperty('chapters');
    // Grid-rendered fields survive.
    expect(item.rating).toBe(4);
    expect(item.tags).toEqual(['t']);
    expect(item).toHaveProperty('fav');
  });

  it('fav flags via the Set lookup match the favourites list', async () => {
    const favId = scanId('CatB', 'three.mp4');
    dbState.favs = [favId];

    const res = makeRes();
    await vids.apiVideos({ headers: {} }, res, mkParams(''));
    const flags = Object.fromEntries(res.jsonBody.map(v => [v.id, v.fav]));
    expect(flags[favId]).toBe(true);
    expect(flags[scanId('CatA', 'one.mp4')]).toBe(false);
    expect(flags[scanId('CatA', 'two.mp4')]).toBe(false);
  });
});
