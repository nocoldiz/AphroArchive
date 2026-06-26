'use strict';

/* global describe, it, expect, vi */

// Unit tests for parseRange — the HTTP Range header parser shared by the video
// streaming endpoint (apiStream) for both encrypted and plain files. Correct
// range handling is what lets the player seek and progressively stream a file
// straight off disk instead of downloading it whole.

const path = require('path');

function injectMock(relPath, exports) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = {
    id: resolved, filename: resolved, loaded: true,
    exports, children: [], paths: [],
  };
}

// helpers-server reads VIDEOS_DIR from config-server at load time; stub the deps.
injectMock('../server/config-server', {
  VIDEOS_DIR: path.join(__dirname, '__mock_videos'),
  PUBLIC_DIR: path.join(__dirname, '__mock_public'),
  STATIC_MIME: {},
  IS_PKG: false,
  MIME: {},
});
injectMock('../server/db-server', { loadPrefs: vi.fn(() => ({})) });

const { parseRange } = require('../server/helpers-server');

const SIZE = 1000;

describe('parseRange — no/invalid headers', () => {
  it('returns null when there is no Range header', () => {
    expect(parseRange(undefined, SIZE)).toBeNull();
    expect(parseRange('', SIZE)).toBeNull();
    expect(parseRange(null, SIZE)).toBeNull();
  });

  it('returns null for unparseable headers (caller serves the whole body)', () => {
    expect(parseRange('bytes=abc-def', SIZE)).toBeNull();
    expect(parseRange('items=0-10', SIZE)).toBeNull();
    expect(parseRange('0-10', SIZE)).toBeNull();
    expect(parseRange('bytes=', SIZE)).toBeNull();
  });
});

describe('parseRange — standard ranges', () => {
  it('parses an open-ended range to the end of the file', () => {
    expect(parseRange('bytes=0-', SIZE)).toEqual({ start: 0, end: 999 });
    expect(parseRange('bytes=500-', SIZE)).toEqual({ start: 500, end: 999 });
  });

  it('parses a closed range inclusively', () => {
    expect(parseRange('bytes=0-99', SIZE)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=200-399', SIZE)).toEqual({ start: 200, end: 399 });
  });

  it('allows a single final byte', () => {
    expect(parseRange('bytes=999-999', SIZE)).toEqual({ start: 999, end: 999 });
    expect(parseRange('bytes=999-', SIZE)).toEqual({ start: 999, end: 999 });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseRange('  bytes=10-20 ', SIZE)).toEqual({ start: 10, end: 20 });
  });
});

describe('parseRange — suffix ranges', () => {
  it('serves the last N bytes', () => {
    expect(parseRange('bytes=-100', SIZE)).toEqual({ start: 900, end: 999 });
  });

  it('clamps a suffix larger than the file to the whole file', () => {
    expect(parseRange('bytes=-5000', SIZE)).toEqual({ start: 0, end: 999 });
  });

  it('rejects a zero-length suffix', () => {
    expect(parseRange('bytes=-0', SIZE)).toEqual({ invalid: true });
  });
});

describe('parseRange — unsatisfiable ranges (→ 416)', () => {
  it('flags a start at/beyond the file size', () => {
    expect(parseRange('bytes=1000-1001', SIZE)).toEqual({ invalid: true });
    expect(parseRange('bytes=1000-', SIZE)).toEqual({ invalid: true });
  });

  it('flags an end beyond the file size', () => {
    expect(parseRange('bytes=0-1000', SIZE)).toEqual({ invalid: true });
  });

  it('flags a reversed range', () => {
    expect(parseRange('bytes=500-100', SIZE)).toEqual({ invalid: true });
  });
});
