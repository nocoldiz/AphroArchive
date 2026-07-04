'use strict';

/* global describe, it, expect, beforeEach, afterAll, vi */

const fs = require('fs');
const path = require('path');
const os = require('os');
const stream = require('stream');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aphro-settings-test-'));
const MOCK_VIDEOS_DIR = path.join(TMP, 'videos');
const MOCK_CACHE_DIR = path.join(TMP, 'cache');
const MOCK_DB_DIR = path.join(TMP, 'db');
const MOCK_VAULT_DIR = path.join(TMP, 'vault');
const MOCK_PATHS_FILE = path.join(TMP, 'paths.json');

function injectMock(relPath, exports) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = {
    id: resolved, filename: resolved, loaded: true,
    exports, children: [], paths: [],
  };
}

// ── Shared state ───────────────────────────────────────────────────────

const state = {
  prefs: {},
  hidden: [],
  categories: [],
  actors: [],
  channels: [],
  vaultConfig: null,
};

// ── Mocks ──────────────────────────────────────────────────────────────

injectMock('../server/config-server', {
  VIDEOS_DIR: MOCK_VIDEOS_DIR,
  PUBLIC_DIR: TMP,
  CACHE_DIR: MOCK_CACHE_DIR,
  DB_DIR: MOCK_DB_DIR,
  VAULT_DIR: MOCK_VAULT_DIR,
  PATHS_FILE: MOCK_PATHS_FILE,
  DEFAULT_CACHE_DIR: MOCK_CACHE_DIR,
  DEFAULT_DB_DIR: MOCK_DB_DIR,
  DEFAULT_VAULT_DIR: MOCK_VAULT_DIR,
  STATIC_MIME: {},
  IS_PKG: false,
  MIME: {},
});

injectMock('../server/db-server', {
  loadPrefs: vi.fn(() => ({ ...state.prefs })),
  savePrefs: vi.fn((p) => { state.prefs = { ...p }; }),
  loadHidden: vi.fn(() => [...state.hidden]),
  saveHidden: vi.fn((h) => { state.hidden = [...h]; }),
  loadFolderMappings: vi.fn(() => state.categories.map(n => ({ name: n }))),
  loadActors: vi.fn(() => state.actors.map(n => ({ name: n }))),
  loadChannels: vi.fn(() => state.channels.map(n => ({ name: n }))),
  loadVaultConfig: vi.fn(() => state.vaultConfig),
});

injectMock('../server/videos-server', {
  invalidateScanCache: vi.fn(),
});

injectMock('../server/feed-watcher-server', {
  stopWatchers: vi.fn(),
  startWatchers: vi.fn(),
});

// Minimal vault-server mock for apiVerifyVaultPassword
injectMock('../server/vault-server', {
  deriveKeys: vi.fn(async (pw, salt) => ({
    encKey: Buffer.alloc(32),
    verifyHash: pw + ':' + salt + ':verify',
  })),
});

const settings = require('../server/settings-server');

afterAll(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

beforeEach(() => {
  state.prefs = {};
  state.hidden = [];
  state.categories = [];
  state.actors = [];
  state.channels = [];
  state.vaultConfig = null;
  try { fs.unlinkSync(MOCK_PATHS_FILE); } catch {}
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

// ── apiSettingsLists() ────────────────────────────────────────────────

describe('apiSettingsLists()', () => {
  it('returns hidden, categories, actors, channels as newline text', () => {
    state.hidden = ['term1', 'term2'];
    state.categories = ['Action', 'Drama'];
    state.actors = ['Jane Doe', 'John Smith'];
    state.channels = ['Channel A'];

    const res = makeRes();
    settings.apiSettingsLists({}, res);

    expect(res.jsonBody.hidden).toBe('term1\nterm2');
    expect(res.jsonBody.categories).toBe('Action\nDrama');
    expect(res.jsonBody.actors).toBe('Jane Doe\nJohn Smith');
    expect(res.jsonBody.channels).toBe('Channel A');
  });

  it('returns empty strings when lists are empty', () => {
    const res = makeRes();
    settings.apiSettingsLists({}, res);
    expect(res.jsonBody.hidden).toBe('');
    expect(res.jsonBody.categories).toBe('');
  });
});

// ── apiSettingsSave() ─────────────────────────────────────────────────

describe('apiSettingsSave()', () => {
  it('saves hidden terms from content', async () => {
    const res = makeRes();
    await settings.apiSettingsSave(
      makeJsonReq('/save/hidden', { content: 'word1\nword2\nword3' }), res, 'hidden');
    expect(res.jsonBody.ok).toBe(true);
    expect(res.jsonBody.count).toBe(3);
    expect(state.hidden).toEqual(['word1', 'word2', 'word3']);
  });

  it('strips blank lines and whitespace', async () => {
    const res = makeRes();
    await settings.apiSettingsSave(
      makeJsonReq('/save/hidden', { content: '  term1  \n\n  term2  \n' }), res, 'hidden');
    expect(state.hidden).toEqual(['term1', 'term2']);
  });

  it('returns 400 for unknown file type', async () => {
    const res = makeRes();
    await settings.apiSettingsSave(
      makeJsonReq('/save/ratings', { content: 'x' }), res, 'ratings');
    expect(res.statusCode).toBe(400);
  });
});

// ── apiGetPrefs() ─────────────────────────────────────────────────────

describe('apiGetPrefs()', () => {
  it('includes videosDir and videosDirExists', () => {
    const res = makeRes();
    settings.apiGetPrefs({}, res);
    expect(res.jsonBody.videosDir).toBe(MOCK_VIDEOS_DIR);
    expect(typeof res.jsonBody.videosDirExists).toBe('boolean');
  });

  it('includes missingSourceFolders', () => {
    state.prefs = { sourceFolders: ['/nonexistent/path'] };
    const res = makeRes();
    settings.apiGetPrefs({}, res);
    expect(res.jsonBody.missingSourceFolders).toContain('/nonexistent/path');
  });

  it('returns saved prefs merged in', () => {
    state.prefs = { theme: 'dark', cardSize: 3 };
    const res = makeRes();
    settings.apiGetPrefs({}, res);
    expect(res.jsonBody.theme).toBe('dark');
    expect(res.jsonBody.cardSize).toBe(3);
  });
});

// ── apiSavePrefs() ────────────────────────────────────────────────────

describe('apiSavePrefs()', () => {
  it('saves theme', async () => {
    await settings.apiSavePrefs(makeJsonReq('/prefs', { theme: 'light' }), makeRes());
    expect(state.prefs.theme).toBe('light');
  });

  it('saves cardSize as integer', async () => {
    await settings.apiSavePrefs(makeJsonReq('/prefs', { cardSize: '3' }), makeRes());
    expect(state.prefs.cardSize).toBe(3);
  });

  it('rejects invalid cardSize', async () => {
    await settings.apiSavePrefs(makeJsonReq('/prefs', { cardSize: 'abc' }), makeRes());
    expect(state.prefs.cardSize).toBeUndefined();
  });

  it('saves isMuted as boolean', async () => {
    await settings.apiSavePrefs(makeJsonReq('/prefs', { isMuted: true }), makeRes());
    expect(state.prefs.isMuted).toBe(true);
  });

  it('saves vaultTimeoutMinutes within allowed range', async () => {
    await settings.apiSavePrefs(makeJsonReq('/prefs', { vaultTimeoutMinutes: 10 }), makeRes());
    expect(state.prefs.vaultTimeoutMinutes).toBe(10);
  });

  it('clamps vaultTimeoutMinutes at 24 hours', async () => {
    await settings.apiSavePrefs(makeJsonReq('/prefs', { vaultTimeoutMinutes: 9999 }), makeRes());
    expect(state.prefs.vaultTimeoutMinutes).toBe(24 * 60);
  });

  it('rejects invalid chronologyMode', async () => {
    const res = makeRes();
    await settings.apiSavePrefs(
      makeJsonReq('/prefs', { chronologyMode: 'invalid-mode' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('accepts valid chronologyMode values', async () => {
    for (const mode of ['keep', 'delete-on-startup', 'dont-save']) {
      state.prefs = {};
      const res = makeRes();
      await settings.apiSavePrefs(makeJsonReq('/prefs', { chronologyMode: mode }), res);
      expect(res.jsonBody.ok).toBe(true);
      expect(state.prefs.chronologyMode).toBe(mode);
    }
  });

  it('saves anthropicApiKey trimmed', async () => {
    await settings.apiSavePrefs(
      makeJsonReq('/prefs', { anthropicApiKey: '  sk-test-key  ' }), makeRes());
    expect(state.prefs.anthropicApiKey).toBe('sk-test-key');
  });

  it('saves sourceFolders as array', async () => {
    await settings.apiSavePrefs(
      makeJsonReq('/prefs', { sourceFolders: ['/mnt/videos', '/mnt/other'] }), makeRes());
    expect(state.prefs.sourceFolders).toEqual(['/mnt/videos', '/mnt/other']);
  });

  it('ignores non-array sourceFolders', async () => {
    await settings.apiSavePrefs(
      makeJsonReq('/prefs', { sourceFolders: 'not-an-array' }), makeRes());
    expect(state.prefs.sourceFolders).toBeUndefined();
  });

  it('saves disabledPlugins as array of strings', async () => {
    await settings.apiSavePrefs(
      makeJsonReq('/prefs', { disabledPlugins: ['mosaic', 'zapping'] }), makeRes());
    expect(state.prefs.disabledPlugins).toEqual(['mosaic', 'zapping']);
  });

  it('saves thumbBlurMode', async () => {
    await settings.apiSavePrefs(makeJsonReq('/prefs', { thumbBlurMode: 'blur' }), makeRes());
    expect(state.prefs.thumbBlurMode).toBe('blur');
  });

  it('saves homeDashboard as array', async () => {
    const layout = [{ iid: '1', type: 'hero', w: 4, h: 2 }];
    await settings.apiSavePrefs(makeJsonReq('/prefs', { homeDashboard: layout }), makeRes());
    expect(state.prefs.homeDashboard).toEqual(layout);
  });

  it('saves homeDashboard as empty array when non-array provided', async () => {
    await settings.apiSavePrefs(makeJsonReq('/prefs', { homeDashboard: 'bad' }), makeRes());
    expect(state.prefs.homeDashboard).toEqual([]);
  });

  it('multiple fields can be saved in one call', async () => {
    await settings.apiSavePrefs(makeJsonReq('/prefs', {
      theme: 'dark',
      isMuted: false,
      cardSize: 2,
    }), makeRes());
    expect(state.prefs.theme).toBe('dark');
    expect(state.prefs.isMuted).toBe(false);
    expect(state.prefs.cardSize).toBe(2);
  });
});

// ── apiVerifyVaultPassword() ──────────────────────────────────────────

describe('apiVerifyVaultPassword()', () => {
  it('returns ok: false when vault is not configured', async () => {
    const res = makeRes();
    await settings.apiVerifyVaultPassword(makeJsonReq('/verify', { password: 'x' }), res);
    expect(res.jsonBody.ok).toBe(false);
    expect(res.jsonBody.error).toMatch(/not configured/i);
  });

  it('returns ok: false when password is empty', async () => {
    state.vaultConfig = { salt: 'salt', verifyHash: 'hash' };
    const res = makeRes();
    await settings.apiVerifyVaultPassword(makeJsonReq('/verify', { password: '' }), res);
    expect(res.jsonBody.ok).toBe(false);
  });

  it('returns ok: true when derived hash matches stored hash', async () => {
    const pw = 'correct-pw';
    const salt = 'my-salt';
    // Our mock derives: pw + ':' + salt + ':verify'
    const verifyHash = pw + ':' + salt + ':verify';
    state.vaultConfig = { salt, verifyHash };

    const res = makeRes();
    await settings.apiVerifyVaultPassword(makeJsonReq('/verify', { password: pw }), res);
    expect(res.jsonBody.ok).toBe(true);
  });

  it('returns ok: false when password is wrong', async () => {
    const salt = 'my-salt';
    state.vaultConfig = { salt, verifyHash: 'correctpw:my-salt:verify' };

    const res = makeRes();
    await settings.apiVerifyVaultPassword(makeJsonReq('/verify', { password: 'wrongpw' }), res);
    expect(res.jsonBody.ok).toBe(false);
  });
});

// ── apiGetPaths() / apiSavePaths() ────────────────────────────────────

describe('apiGetPaths() / apiSavePaths()', () => {
  it('apiGetPaths returns current path config', () => {
    const res = makeRes();
    settings.apiGetPaths({}, res);
    expect(res.jsonBody.cacheDir).toBe(MOCK_CACHE_DIR);
    expect(res.jsonBody.dbDir).toBe(MOCK_DB_DIR);
    expect(res.jsonBody.vaultDir).toBe(MOCK_VAULT_DIR);
    expect(res.jsonBody.defaults).toBeDefined();
    expect(res.jsonBody.custom).toBeDefined();
  });

  it('apiSavePaths writes paths.json and returns restartRequired', async () => {
    const res = makeRes();
    await settings.apiSavePaths(
      makeJsonReq('/paths', { cacheDir: '/tmp/cache', dbDir: '/tmp/db' }), res);
    expect(res.jsonBody.ok).toBe(true);
    expect(res.jsonBody.restartRequired).toBe(true);
    const written = JSON.parse(fs.readFileSync(MOCK_PATHS_FILE, 'utf-8'));
    expect(written.cacheDir).toBe('/tmp/cache');
    expect(written.dbDir).toBe('/tmp/db');
  });

  it('apiSavePaths removes empty keys so defaults take effect', async () => {
    await settings.apiSavePaths(
      makeJsonReq('/paths', { cacheDir: '/tmp/cache', dbDir: '' }), makeRes());
    const written = JSON.parse(fs.readFileSync(MOCK_PATHS_FILE, 'utf-8'));
    expect(written.cacheDir).toBe('/tmp/cache');
    expect(written.dbDir).toBeUndefined();
  });
});
