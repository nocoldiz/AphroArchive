'use strict';

/* global describe, it, expect, beforeAll, afterAll, vi */

const fs = require('fs');
const path = require('path');
const os = require('os');
const stream = require('stream');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aphro-helpers-test-'));
const MOCK_VIDEOS_DIR = path.join(TMP, 'videos');
const MOCK_PUBLIC_DIR = path.join(TMP, 'public');

function injectMock(relPath, exports) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = {
    id: resolved, filename: resolved, loaded: true,
    exports, children: [], paths: [],
  };
}

// Must be injected before helpers-server is required (it reads VIDEOS_DIR at load time).
injectMock('../server/config-server', {
  VIDEOS_DIR: MOCK_VIDEOS_DIR,
  PUBLIC_DIR: MOCK_PUBLIC_DIR,
  STATIC_MIME: { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8' },
  IS_PKG: false,
  MIME: {},
});

// db-server is required lazily inside safePath(); provide a stub.
injectMock('../server/db-server', {
  loadPrefs: vi.fn(() => ({})),
});

const helpers = require('../server/helpers-server');

beforeAll(() => {
  fs.mkdirSync(MOCK_VIDEOS_DIR, { recursive: true });
  fs.mkdirSync(MOCK_PUBLIC_DIR, { recursive: true });
});

afterAll(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

// ─── formatBytes() ───────────────────────────────────────────────────

describe('formatBytes()', () => {
  it('formats 0 bytes', () => expect(helpers.formatBytes(0)).toBe('0 B'));
  it('formats sub-KB values', () => expect(helpers.formatBytes(512)).toBe('512.0 B'));
  it('formats exactly 1 KB', () => expect(helpers.formatBytes(1024)).toBe('1.0 KB'));
  it('formats MB', () => expect(helpers.formatBytes(1024 * 1024)).toBe('1.0 MB'));
  it('formats GB', () => expect(helpers.formatBytes(1024 ** 3)).toBe('1.0 GB'));
  it('formats fractional MB', () => {
    const result = helpers.formatBytes(1.5 * 1024 * 1024);
    expect(result).toBe('1.5 MB');
  });
});

// ─── formatDuration() ────────────────────────────────────────────────

describe('formatDuration()', () => {
  it('returns empty string for 0', () => expect(helpers.formatDuration(0)).toBe(''));
  it('returns empty string for null', () => expect(helpers.formatDuration(null)).toBe(''));
  it('returns empty string for negative', () => expect(helpers.formatDuration(-5)).toBe(''));
  it('formats seconds only', () => expect(helpers.formatDuration(45)).toBe('0:45'));
  it('pads single-digit seconds', () => expect(helpers.formatDuration(61)).toBe('1:01'));
  it('formats minutes and seconds', () => expect(helpers.formatDuration(125)).toBe('2:05'));
  it('formats exactly 1 hour', () => expect(helpers.formatDuration(3600)).toBe('1:00:00'));
  it('formats hours with padded minutes and seconds', () => {
    expect(helpers.formatDuration(3661)).toBe('1:01:01');
  });
  it('pads minutes in hour format', () => {
    expect(helpers.formatDuration(3600 + 5 * 60 + 3)).toBe('1:05:03');
  });
});

// ─── toId() / fromId() ───────────────────────────────────────────────

describe('toId() / fromId()', () => {
  it('round-trips a simple path', () => {
    const p = 'Category/video.mp4';
    expect(helpers.fromId(helpers.toId(p))).toBe(p);
  });

  it('round-trips a path with spaces', () => {
    const p = 'My Videos/some file.mp4';
    expect(helpers.fromId(helpers.toId(p))).toBe(p);
  });

  it('uses base64url encoding (no + / = characters)', () => {
    const id = helpers.toId('any/path/here.mp4');
    expect(id).not.toMatch(/[+/=]/);
  });

  it('handles unicode filenames', () => {
    const p = 'Ünïcödé/fïlé.mp4';
    expect(helpers.fromId(helpers.toId(p))).toBe(p);
  });

  it('handles deeply nested paths', () => {
    const p = 'a/b/c/d/e/file.mkv';
    expect(helpers.fromId(helpers.toId(p))).toBe(p);
  });
});

// ─── wordMatch() ────────────────────────────────────────────────────

describe('wordMatch()', () => {
  it('matches whole word (case-insensitive)', () => {
    expect(helpers.wordMatch('Hello World', 'hello')).toBe(true);
    expect(helpers.wordMatch('Hello World', 'WORLD')).toBe(true);
  });

  it('does not match a substring that is not a whole word', () => {
    expect(helpers.wordMatch('foobar', 'foo')).toBe(false);
    expect(helpers.wordMatch('testing', 'test')).toBe(false);
  });

  it('returns false when term is absent', () => {
    expect(helpers.wordMatch('Hello World', 'xyz')).toBe(false);
  });

  it('matches a single-word string', () => {
    expect(helpers.wordMatch('title', 'title')).toBe(true);
  });

  it('caches results without corrupting subsequent lookups', () => {
    helpers.wordMatch('abc', 'abc');
    expect(helpers.wordMatch('abcdef', 'abc')).toBe(false);
    expect(helpers.wordMatch('abc def', 'abc')).toBe(true);
  });
});

// ─── wordMatchAny() ─────────────────────────────────────────────────

describe('wordMatchAny()', () => {
  it('returns true when any term matches', () => {
    expect(helpers.wordMatchAny('Hello World', ['xyz', 'world'])).toBe(true);
  });

  it('returns false when no term matches', () => {
    expect(helpers.wordMatchAny('Hello World', ['abc', 'xyz'])).toBe(false);
  });

  it('returns false for empty term list', () => {
    expect(helpers.wordMatchAny('Hello', [])).toBe(false);
  });
});

// ─── channelMatchAny() ───────────────────────────────────────────────

describe('channelMatchAny()', () => {
  it('matches via whole-word', () => {
    expect(helpers.channelMatchAny('Brazzers Network', ['Brazzers'])).toBe(true);
  });

  it('matches after stripping spaces and dashes', () => {
    expect(helpers.channelMatchAny('Fake-Studio-Name', ['FakeStudioName'])).toBe(true);
  });

  it('matches underscore-separated term', () => {
    expect(helpers.channelMatchAny('FakeStudio', ['Fake_Studio'])).toBe(true);
  });

  it('does not match via normalised substring when term is ≤2 chars and not a whole word', () => {
    // 'xy' is 2 chars; 'xystudio' has no word boundary around 'xy', so wordMatch
    // returns false. The normalised substring guard (normT.length > 2) then also
    // prevents a match — total result is false.
    expect(helpers.channelMatchAny('xystudio', ['xy'])).toBe(false);
  });

  it('returns false when nothing matches', () => {
    expect(helpers.channelMatchAny('Alpha Studio', ['Beta', 'Gamma'])).toBe(false);
  });
});

// ─── actorMatches() ─────────────────────────────────────────────────

describe('actorMatches()', () => {
  it('matches when full actor name appears in video name', () => {
    expect(helpers.actorMatches('Jane Doe Hot Scene', 'Jane Doe')).toBe(true);
  });

  it('matches when actor name appears as substring', () => {
    expect(helpers.actorMatches('janedoe compilation', 'jane doe')).toBe(true);
  });

  it('matches all individual words of a multi-word actor name', () => {
    expect(helpers.actorMatches('video with jane and doe together', 'jane doe')).toBe(true);
  });

  it('does not match when only one word of multi-word actor is present', () => {
    // 'Jane Smith' — video has 'Jane' but not 'Smith'
    expect(helpers.actorMatches('video with jane here', 'Jane Smith')).toBe(false);
  });

  it('returns false for null / non-string inputs', () => {
    expect(helpers.actorMatches(null, 'Jane')).toBe(false);
    expect(helpers.actorMatches('Jane', null)).toBe(false);
    expect(helpers.actorMatches(123, 'Jane')).toBe(false);
  });
});

// ─── actorMatchesAny() ──────────────────────────────────────────────

describe('actorMatchesAny()', () => {
  it('returns true when any actor in the list matches', () => {
    expect(helpers.actorMatchesAny('Jane Doe video', ['John Smith', 'Jane Doe'])).toBe(true);
  });

  it('returns false when no actor matches', () => {
    expect(helpers.actorMatchesAny('some video', ['John Smith', 'Alice Bob'])).toBe(false);
  });

  it('returns false for empty list', () => {
    expect(helpers.actorMatchesAny('Jane Doe video', [])).toBe(false);
  });
});

// ─── json() ─────────────────────────────────────────────────────────

describe('json()', () => {
  function makeRes() {
    const chunks = [];
    let sc = 200, hdrs = {};
    return {
      writeHead: vi.fn((s, h) => { sc = s; hdrs = { ...hdrs, ...(h || {}) }; }),
      end: vi.fn((b) => { if (b) chunks.push(Buffer.isBuffer(b) ? b : Buffer.from(b)); }),
      get statusCode() { return sc; },
      get headers() { return hdrs; },
      get body() { return Buffer.concat(chunks).toString(); },
      get jsonBody() { try { return JSON.parse(this.body); } catch { return null; } },
    };
  }

  it('writes a 200 response with JSON body by default', () => {
    const res = makeRes();
    helpers.json(res, { ok: true });
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ ok: true });
  });

  it('respects a custom status code', () => {
    const res = makeRes();
    helpers.json(res, { error: 'bad' }, 400);
    expect(res.statusCode).toBe(400);
  });

  it('sets Content-Type: application/json', () => {
    const res = makeRes();
    helpers.json(res, {});
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ 'Content-Type': 'application/json' }),
    );
  });

  it('serialises arrays correctly', () => {
    const res = makeRes();
    helpers.json(res, [1, 2, 3]);
    expect(res.jsonBody).toEqual([1, 2, 3]);
  });
});

// ─── readBody() ─────────────────────────────────────────────────────

describe('readBody()', () => {
  function makeJsonStream(body) {
    const buf = Buffer.from(JSON.stringify(body));
    const req = new stream.Readable({ read() {} });
    req.push(buf);
    req.push(null);
    return req;
  }

  it('parses a JSON body', async () => {
    const result = await helpers.readBody(makeJsonStream({ hello: 'world' }));
    expect(result).toEqual({ hello: 'world' });
  });

  it('parses a nested JSON body', async () => {
    const payload = { a: { b: [1, 2, 3] } };
    const result = await helpers.readBody(makeJsonStream(payload));
    expect(result).toEqual(payload);
  });

  it('returns empty object for invalid JSON', async () => {
    const req = new stream.Readable({ read() {} });
    req.push(Buffer.from('not valid json {{'));
    req.push(null);
    const result = await helpers.readBody(req);
    expect(result).toEqual({});
  });

  it('returns empty object for an empty body', async () => {
    const req = new stream.Readable({ read() {} });
    req.push(null);
    const result = await helpers.readBody(req);
    expect(result).toEqual({});
  });
});

// ─── safePath() ─────────────────────────────────────────────────────

describe('safePath()', () => {
  it('returns null for a path outside VIDEOS_DIR with no source folders', () => {
    const id = helpers.toId('/etc/passwd');
    expect(helpers.safePath(id)).toBeNull();
  });

  it('returns a valid path for a file inside VIDEOS_DIR', () => {
    const filename = 'test-video.mp4';
    const fullPath = path.join(MOCK_VIDEOS_DIR, filename);
    fs.writeFileSync(fullPath, 'data');
    const id = helpers.toId(filename);
    const result = helpers.safePath(id);
    expect(result).toBe(fullPath);
    fs.unlinkSync(fullPath);
  });

  it('returns null when the file does not exist', () => {
    const id = helpers.toId('nonexistent.mp4');
    expect(helpers.safePath(id)).toBeNull();
  });
});
