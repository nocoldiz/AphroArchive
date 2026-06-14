'use strict';

/* global describe, it, expect, beforeAll, afterAll, beforeEach, vi */

const fs = require('fs');
const path = require('path');
const os = require('os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aphro-plugins-test-'));
const MOCK_PLUGINS_DIR = path.join(TMP, 'plugins');

function injectMock(relPath, exports) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = {
    id: resolved, filename: resolved, loaded: true,
    exports, children: [], paths: [],
  };
}

injectMock('../server/config-server', {
  PLUGINS_DIR: MOCK_PLUGINS_DIR,
  VIDEOS_DIR: path.join(TMP, 'videos'),
  PUBLIC_DIR: TMP,
  STATIC_MIME: {},
  IS_PKG: false,
  MIME: {},
});

// helpers-server only needs config-server; no db-server dependency at load time.
injectMock('../server/db-server', { loadPrefs: vi.fn(() => ({})) });

const plugins = require('../server/plugins-server');

// ── Helpers ────────────────────────────────────────────────────────────

function createPlugin(id, meta) {
  const dir = path.join(MOCK_PLUGINS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta), 'utf-8');
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

beforeAll(() => {
  fs.mkdirSync(MOCK_PLUGINS_DIR, { recursive: true });
});

afterAll(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

beforeEach(() => {
  // Wipe the plugins dir between tests so each test starts clean.
  try { fs.rmSync(MOCK_PLUGINS_DIR, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(MOCK_PLUGINS_DIR, { recursive: true });
});

// ── listPlugins() ─────────────────────────────────────────────────────

describe('listPlugins()', () => {
  it('returns empty array when plugins dir is empty', () => {
    expect(plugins.listPlugins()).toEqual([]);
  });

  it('returns empty array when plugins dir does not exist', () => {
    fs.rmSync(MOCK_PLUGINS_DIR, { recursive: true, force: true });
    expect(plugins.listPlugins()).toEqual([]);
    fs.mkdirSync(MOCK_PLUGINS_DIR, { recursive: true });
  });

  it('returns a plugin from a valid meta.json', () => {
    createPlugin('mosaic', {
      name: 'Mosaic',
      description: 'Grid mosaic view',
      location: 'topbar',
      type: 'toggle',
      toggleAction: 'toggleMosaic',
    });
    const list = plugins.listPlugins();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('mosaic');
    expect(list[0].name).toBe('Mosaic');
    expect(list[0].location).toBe('topbar');
  });

  it('merges id with meta fields', () => {
    createPlugin('reddit', { name: 'Reddit', location: 'sidebar', type: 'view', view: 'reddit' });
    const list = plugins.listPlugins();
    expect(list[0].id).toBe('reddit');
    expect(list[0].view).toBe('reddit');
  });

  it('skips directories without meta.json', () => {
    fs.mkdirSync(path.join(MOCK_PLUGINS_DIR, 'no-meta'), { recursive: true });
    createPlugin('valid', { name: 'Valid', location: 'topbar', type: 'toggle' });
    expect(plugins.listPlugins()).toHaveLength(1);
  });

  it('skips malformed meta.json (invalid JSON)', () => {
    const dir = path.join(MOCK_PLUGINS_DIR, 'bad-json');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'meta.json'), '{ not valid json }');
    expect(plugins.listPlugins()).toHaveLength(0);
  });

  it('skips non-directory entries in plugins dir', () => {
    fs.writeFileSync(path.join(MOCK_PLUGINS_DIR, 'stray-file.txt'), 'ignored');
    createPlugin('real', { name: 'Real', location: 'topbar', type: 'toggle' });
    expect(plugins.listPlugins()).toHaveLength(1);
  });

  it('returns multiple plugins', () => {
    createPlugin('mosaic', { name: 'Mosaic', location: 'topbar', type: 'toggle' });
    createPlugin('reddit', { name: 'Reddit', location: 'sidebar', type: 'view' });
    createPlugin('instagram', { name: 'Instagram', location: 'sidebar', type: 'view' });
    const list = plugins.listPlugins();
    expect(list).toHaveLength(3);
    const ids = list.map(p => p.id);
    expect(ids).toContain('mosaic');
    expect(ids).toContain('reddit');
    expect(ids).toContain('instagram');
  });

  it('includes homeWidget config when present', () => {
    createPlugin('hero', {
      name: 'Hero',
      location: 'home',
      type: 'widget',
      homeWidget: { w: 4, h: 2, singleton: true },
    });
    const list = plugins.listPlugins();
    expect(list[0].homeWidget).toEqual({ w: 4, h: 2, singleton: true });
  });

  it('includes contexts when present', () => {
    createPlugin('mosaic', {
      name: 'Mosaic',
      location: 'topbar',
      type: 'toggle',
      contexts: ['browse', 'player', 'home'],
    });
    const list = plugins.listPlugins();
    expect(list[0].contexts).toEqual(['browse', 'player', 'home']);
  });
});

// ── apiGetPlugins() ───────────────────────────────────────────────────

describe('apiGetPlugins()', () => {
  it('returns plugins wrapped in { plugins: [...] }', () => {
    createPlugin('zapping', { name: 'Zapping', location: 'topbar', type: 'toggle' });
    const res = makeRes();
    plugins.apiGetPlugins({}, res);
    expect(res.jsonBody.plugins).toHaveLength(1);
    expect(res.jsonBody.plugins[0].id).toBe('zapping');
  });

  it('returns empty plugins array when no plugins installed', () => {
    const res = makeRes();
    plugins.apiGetPlugins({}, res);
    expect(res.jsonBody.plugins).toEqual([]);
  });
});
