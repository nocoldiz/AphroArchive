'use strict';

/* global describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi */

// ── Dependency mocking for a CommonJS module under vitest ────────────
// vault-server.js loads its deps with CJS require(). In this vitest 4
// setup the .cjs test file runs through Node's native CommonJS loader,
// so vi.mock() factories are NOT applied to those require() calls.
// The reliable, framework-independent technique is to pre-seed
// require.cache with fake modules BEFORE vault-server is first required.
// Every later require() of the same resolved path — whether from the
// test, vault-server, or the real helpers-server — receives the fake.

const fs = require('fs');
const path = require('path');
const os = require('os');
const stream = require('stream');

// Isolate all filesystem effects in an OS temp dir so the real
// cache/ and videos/hidden are never touched.
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aphro-vault-test-'));
const MOCK_VAULT_DIR = path.join(TMP_ROOT, 'vault');
const MOCK_PROCESS_DIR = path.join(TMP_ROOT, 'process');
const MOCK_VIDEOS_DIR = path.join(TMP_ROOT, 'videos');
const MOCK_VAULT_CONFIG_FILE = path.join(TMP_ROOT, 'vault-config.json');
const MOCK_VAULT_META_FILE = path.join(TMP_ROOT, 'vault-meta.json');

const MOCK_MIME = {
  '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf',
  '.txt': 'text/plain', '.md': 'text/markdown', '.html': 'text/html',
};

// Shared state object — fake db functions read/write through this reference.
const state = {
  hidden: [], vaultConfig: null, vaultMeta: {}, reEncryptSqlite: null, prefs: {},
  links: [],  // public links list
};

/** Replace a module in require.cache with a fake before it is ever loaded. */
function injectMock(relPath, exports) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = {
    id: resolved, filename: resolved, loaded: true,
    exports, children: [], paths: [],
  };
}

// config-server: include every field the real helpers-server also reads
// (PUBLIC_DIR, STATIC_MIME, IS_PKG) so the genuine helpers module loads.
injectMock('../server/config-server', {
  VAULT_DIR: MOCK_VAULT_DIR,
  VAULT_CONFIG_FILE: MOCK_VAULT_CONFIG_FILE,
  VAULT_META_FILE: MOCK_VAULT_META_FILE,
  PROCESS_DIR: MOCK_PROCESS_DIR,
  VIDEOS_DIR: MOCK_VIDEOS_DIR,
  PUBLIC_DIR: TMP_ROOT,
  STATIC_MIME: {},
  IS_PKG: false,
  MIME: MOCK_MIME,
});

injectMock('../server/db-server', {
  loadHidden: vi.fn(() => state.hidden),
  loadVaultConfig: vi.fn(() => state.vaultConfig),
  saveVaultConfig: vi.fn((c) => { state.vaultConfig = c; }),
  loadVaultMeta: vi.fn(() => ({ ...state.vaultMeta })),
  saveVaultMeta: vi.fn((m) => { state.vaultMeta = { ...m }; }),
  loadPrefs: vi.fn(() => state.prefs || {}),
  setVaultKey: vi.fn(() => {}),
  reEncryptVaultSqlite: vi.fn((o, n) => { state.reEncryptSqlite = { o, n }; }),
  loadLinksCache: vi.fn(() => ({ items: state.links })),
  deleteLink: vi.fn((url) => { state.links = state.links.filter(l => l.url !== url); }),
  upsertLink: vi.fn((link) => { state.links.push(link); }),
});

injectMock('../server/feed-watcher-server', {
  processPendingPrivateFeed: vi.fn(),
});

let vault;

/** Create a Readable stream request that real readBody() can consume */
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

/** Create a readable stream for file upload */
function makeStreamReq(filename, content) {
  const req = new stream.Readable({ read() {} });
  req.headers = { 'x-filename': filename };
  if (content) req.push(content);
  req.push(null);
  return req;
}

function makeRes() {
  const chunks = [];
  let sc = 200, hdrs = {}, hdrsSent = false;
  return {
    writeHead: vi.fn((s, h) => { sc = s; if (h) hdrs = { ...hdrs, ...h }; hdrsSent = true; }),
    write: vi.fn((c) => { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); }),
    end: vi.fn((c) => { if (c) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); }),
    get headersSent() { return hdrsSent; },
    get statusCode() { return sc; },
    get body() { return Buffer.concat(chunks).toString(); },
    get jsonBody() { try { return JSON.parse(this.body); } catch { return null; } },
  };
}

function cleanup() {
  for (const dir of [MOCK_VAULT_DIR, MOCK_PROCESS_DIR]) {
    try { if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  for (const f of [MOCK_VAULT_CONFIG_FILE, MOCK_VAULT_META_FILE]) try { fs.unlinkSync(f); } catch {}
}

function resetAll() {
  state.hidden = [];
  state.vaultConfig = null;
  state.vaultMeta = {};
  state.reEncryptSqlite = null;
  state.prefs = {};
  state.links = [];
  cleanup();
  for (const d of [MOCK_VAULT_DIR, MOCK_PROCESS_DIR]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  // Fully reset module-internal state (key + failed-attempt counters)
  try { vault.__resetForTest(); } catch { try { vault.apiVaultLock({}, makeRes()); } catch {} }
}

beforeAll(() => {
  for (const d of [MOCK_VAULT_DIR, MOCK_PROCESS_DIR]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  // require.cache is pre-seeded above, so the real vault-server picks up the fakes.
  vault = require('../server/vault-server');
});

afterAll(() => {
  try { vault && vault.__stopTimers && vault.__stopTimers(); } catch {}
  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch {}
});

beforeEach(resetAll);
afterEach(cleanup);

// ============ TESTS ============

describe('deriveKeys()', () => {
  it('derives 32-byte key and 64-char hash', async () => {
    const r = await vault.deriveKeys('pw', 'salt');
    expect(r.encKey).toBeInstanceOf(Buffer);
    expect(r.encKey.length).toBe(32);
    expect(r.verifyHash.length).toBe(64);
  });

  it('is deterministic', async () => {
    const [a, b] = await Promise.all([vault.deriveKeys('p', 's'), vault.deriveKeys('p', 's')]);
    expect(a.encKey.toString('hex')).toBe(b.encKey.toString('hex'));
  });
});

describe('apiVaultStatus()', () => {
  it('shows not configured by default', () => {
    const res = makeRes();
    vault.apiVaultStatus({ url: '/' }, res);
    expect(res.jsonBody.configured).toBe(false);
    expect(res.jsonBody.unlocked).toBe(false);
  });

  it('shows configured when config set', () => {
    state.vaultConfig = { salt: 'x', verifyHash: 'y' };
    const res = makeRes();
    vault.apiVaultStatus({ url: '/' }, res);
    expect(res.jsonBody.configured).toBe(true);
  });
});

describe('apiVaultSetup()', () => {
  it('rejects when already configured', async () => {
    state.vaultConfig = { salt: 'x', verifyHash: 'y' };
    const res = makeRes();
    await vault.apiVaultSetup(makeJsonReq('/setup', { password: 'test123!' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects short password', async () => {
    const res = makeRes();
    await vault.apiVaultSetup(makeJsonReq('/setup', { password: '12345' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('configures vault with valid password', async () => {
    const res = makeRes();
    await vault.apiVaultSetup(makeJsonReq('/setup', { password: 'test123!' }), res);
    expect(res.jsonBody.ok).toBe(true);
    expect(state.vaultConfig).not.toBeNull();
  });

  it('creates vault directory if missing', async () => {
    try { fs.rmSync(MOCK_VAULT_DIR, { recursive: true, force: true }); } catch {}
    await vault.apiVaultSetup(makeJsonReq('/setup', { password: 'test123!' }), makeRes());
    expect(fs.existsSync(MOCK_VAULT_DIR)).toBe(true);
  });

  it('unlocks vault on success', async () => {
    await vault.apiVaultSetup(makeJsonReq('/setup', { password: 'test123!' }), makeRes());
    expect(vault.isUnlocked()).toBe(true);
  });
});

describe('apiVaultLock()', () => {
  it('locks and clears key', async () => {
    await vault.apiVaultSetup(makeJsonReq('/setup', { password: 'pw1234' }), makeRes());
    expect(vault.isUnlocked()).toBe(true);
    vault.apiVaultLock({}, makeRes());
    expect(vault.isUnlocked()).toBe(false);
    expect(vault.getVaultKey()).toBeNull();
  });
});

describe('apiVaultUnlock()', () => {
  it('rejects when not configured', async () => {
    const res = makeRes();
    await vault.apiVaultUnlock(makeJsonReq('/unlock', { password: 'x' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('unlocks with correct password', async () => {
    await vault.apiVaultSetup(makeJsonReq('/setup', { password: 'pw1234' }), makeRes());
    vault.apiVaultLock({}, makeRes());
    const res = makeRes();
    await vault.apiVaultUnlock(makeJsonReq('/unlock', { password: 'pw1234' }), res);
    expect(res.jsonBody.ok).toBe(true);
    expect(vault.isUnlocked()).toBe(true);
  });

  it('rejects wrong password', async () => {
    await vault.apiVaultSetup(makeJsonReq('/setup', { password: 'pw1234' }), makeRes());
    vault.apiVaultLock({}, makeRes());
    const res = makeRes();
    await vault.apiVaultUnlock(makeJsonReq('/unlock', { password: 'wrong' }), res);
    expect(res.statusCode).toBe(401);
  });
});

describe('Vault File Ops', () => {
  const PW = 'p1234!';

  beforeEach(async () => {
    await vault.apiVaultSetup(makeJsonReq('/setup', { password: PW }), makeRes());
  });

  it('refuses add when locked', async () => {
    vault.apiVaultLock({}, makeRes());
    const res = makeRes();
    await vault.apiVaultAdd(makeStreamReq('x.mp4'), res);
    expect(res.jsonBody.error).toBe('locked');
  });

  it('encrypts and stores a file', async () => {
    const content = Buffer.from('hello vault');
    const res = makeRes();
    await vault.apiVaultAdd(makeStreamReq('test.mp4', content), res);
    expect(res.jsonBody.ok).toBe(true);
    expect(res.jsonBody.id).toBeDefined();
    const ep = path.join(MOCK_VAULT_DIR, res.jsonBody.id + '.enc');
    expect(fs.existsSync(ep)).toBe(true);
    expect(fs.statSync(ep).size).toBeGreaterThan(content.length);
  });

  it('stores metadata', async () => {
    const res = makeRes();
    await vault.apiVaultAdd(makeStreamReq('vid.mp4', Buffer.from('data')), res);
    expect(state.vaultMeta[res.jsonBody.id].originalName).toBe('vid.mp4');
    expect(state.vaultMeta[res.jsonBody.id].ext).toBe('.mp4');
  });

  it('lists files sorted by mtime desc', async () => {
    await vault.apiVaultAdd(makeStreamReq('a.mp4', Buffer.from('a')), makeRes());
    await new Promise(r => setTimeout(r, 10));
    await vault.apiVaultAdd(makeStreamReq('b.mp4', Buffer.from('b')), makeRes());
    const res = makeRes();
    vault.apiVaultFiles({ url: '/' }, res);
    expect(res.jsonBody[0].originalName).toBe('b.mp4');
    expect(res.jsonBody[1].originalName).toBe('a.mp4');
  });

  it('deletes a file and removes metadata', async () => {
    const addRes = makeRes();
    await vault.apiVaultAdd(makeStreamReq('del.mp4', Buffer.from('x')), addRes);
    const id = addRes.jsonBody.id;
    expect(fs.existsSync(path.join(MOCK_VAULT_DIR, id + '.enc'))).toBe(true);
    vault.apiVaultDelete({ url: '/' }, makeRes(), id);
    expect(fs.existsSync(path.join(MOCK_VAULT_DIR, id + '.enc'))).toBe(false);
    expect(state.vaultMeta[id]).toBeUndefined();
  });

  it('creates a text file', async () => {
    const res = makeRes();
    await vault.apiVaultCreateTextFile(makeJsonReq('/text', { name: 'n.txt', content: 'hi' }), res);
    expect(res.jsonBody.ok).toBe(true);
    expect(state.vaultMeta[res.jsonBody.id].ext).toBe('.txt');
  });

  it('creates a folder', async () => {
    const res = makeRes();
    await vault.apiVaultCreateFolder(makeJsonReq('/folders', { name: 'MyVids' }), res);
    expect(res.jsonBody.ok).toBe(true);
    expect(state.vaultMeta[res.jsonBody.id].type).toBe('folder');
  });
});

describe('apiVaultChangePassword()', () => {
  const OLD = 'oldpw123!';

  beforeEach(async () => {
    await vault.apiVaultSetup(makeJsonReq('/setup', { password: OLD }), makeRes());
  });

  it('rejects wrong old password', async () => {
    const res = makeRes();
    await vault.apiVaultChangePassword(makeJsonReq('/change', { oldPassword: 'wrong', newPassword: 'n' }), res);
    expect(res.statusCode).toBe(401);
  });

  it('re-encrypts files on password change', async () => {
    await vault.apiVaultAdd(makeStreamReq('k.mp4', Buffer.from('data')), makeRes());
    const res = makeRes();
    await vault.apiVaultChangePassword(makeJsonReq('/change', { oldPassword: OLD, newPassword: 'new456!' }), res);
    expect(res.jsonBody.ok).toBe(true);
    expect(state.reEncryptSqlite).not.toBeNull();
  });
});

describe('apiVaultDeleteVault()', () => {
  beforeEach(async () => {
    await vault.apiVaultSetup(makeJsonReq('/setup', { password: 'pw1234' }), makeRes());
    await vault.apiVaultAdd(makeStreamReq('g.mp4', Buffer.from('x')), makeRes());
  });

  it('clears all vault state', async () => {
    const res = makeRes();
    await vault.apiVaultDeleteVault(makeJsonReq('/api/vault/delete-vault', { confirm: 'DELETE_VAULT' }), res);
    expect(res.jsonBody.ok).toBe(true);
    expect(vault.isUnlocked()).toBe(false);
  });
});

describe('Misc', () => {
  beforeEach(async () => {
    await vault.apiVaultSetup(makeJsonReq('/setup', { password: 'pw1234' }), makeRes());
  });

  it('getFileMeta returns null for missing', () => {
    expect(vault.getFileMeta('nonexist')).toBeNull();
  });

  it('getFileMeta returns metadata', async () => {
    const addRes = makeRes();
    await vault.apiVaultAdd(makeStreamReq('m.mp4', Buffer.from('x')), addRes);
    expect(vault.getFileMeta(addRes.jsonBody.id).originalName).toBe('m.mp4');
  });

  it('decryptToBuffer decrypts a file', async () => {
    const addRes = makeRes();
    await vault.apiVaultAdd(makeStreamReq('img.jpg', Buffer.from('pic')), addRes);
    const r = vault.decryptToBuffer(addRes.jsonBody.id);
    expect(r).not.toBeNull();
    expect(r.buffer.toString()).toBe('pic');
  });

  it('apiVaultAiTag marks file as AI-tagged', async () => {
    const addRes = makeRes();
    await vault.apiVaultAdd(makeStreamReq('t.mp4', Buffer.from('x')), addRes);
    vault.apiVaultAiTag({ url: '/' }, makeRes(), addRes.jsonBody.id);
    expect(state.vaultMeta[addRes.jsonBody.id].aiTagged).toBe(true);
  });
});

describe('Duress / self-destruct password', () => {
  const REAL = 'realpw123';
  const DURESS = 'duress456';

  beforeEach(async () => {
    await vault.apiVaultSetup(makeJsonReq('/setup', { password: REAL, duressPassword: DURESS }), makeRes());
  });

  it('stores an independent duress hash in the config', () => {
    expect(state.vaultConfig.duressHash).toBeDefined();
    expect(state.vaultConfig.duressSalt).toBeDefined();
    expect(state.vaultConfig.duressHash).not.toBe(state.vaultConfig.verifyHash);
  });

  it('unlocks normally with the real password', async () => {
    vault.apiVaultLock({}, makeRes());
    const res = makeRes();
    await vault.apiVaultUnlock(makeJsonReq('/unlock', { password: REAL }), res);
    expect(res.jsonBody.ok).toBe(true);
    expect(vault.isUnlocked()).toBe(true);
  });

  it('wipes the vault and reports a generic error on duress unlock', async () => {
    // Put a file in the vault, then trigger duress.
    const addRes = makeRes();
    await vault.apiVaultAdd(makeStreamReq('secret.mp4', Buffer.from('data')), addRes);
    const encPath = path.join(MOCK_VAULT_DIR, addRes.jsonBody.id + '.enc');
    expect(fs.existsSync(encPath)).toBe(true);

    vault.apiVaultLock({}, makeRes());
    const res = makeRes();
    await vault.apiVaultUnlock(makeJsonReq('/unlock', { password: DURESS }), res);

    // Looks like an ordinary wrong-password failure...
    expect(res.statusCode).toBe(401);
    expect(res.jsonBody.error).toBe('Wrong password');
    // ...but the encrypted data is gone and the vault is locked.
    expect(vault.isUnlocked()).toBe(false);
    expect(fs.existsSync(encPath)).toBe(false);
    expect(fs.existsSync(MOCK_VAULT_DIR)).toBe(false);
  });

  it('does not wipe on an ordinary wrong password', async () => {
    const addRes = makeRes();
    await vault.apiVaultAdd(makeStreamReq('keep.mp4', Buffer.from('data')), addRes);
    const encPath = path.join(MOCK_VAULT_DIR, addRes.jsonBody.id + '.enc');

    vault.apiVaultLock({}, makeRes());
    const res = makeRes();
    await vault.apiVaultUnlock(makeJsonReq('/unlock', { password: 'totallywrong' }), res);
    expect(res.statusCode).toBe(401);
    expect(fs.existsSync(encPath)).toBe(true); // data survives
  });
});

describe('Configurable auto-lock timeout', () => {
  it('auto-locks after the configured timeout elapses', async () => {
    state.prefs = { vaultTimeoutMs: 40 };
    await vault.apiVaultSetup(makeJsonReq('/setup', { password: 'timeout123' }), makeRes());
    expect(vault.isUnlocked()).toBe(true);
    await new Promise(r => setTimeout(r, 90));
    expect(vault.isUnlocked()).toBe(false);
  });

  it('never auto-locks when timeout is 0', async () => {
    state.prefs = { vaultTimeoutMs: 0 };
    await vault.apiVaultSetup(makeJsonReq('/setup', { password: 'timeout123' }), makeRes());
    await new Promise(r => setTimeout(r, 60));
    expect(vault.isUnlocked()).toBe(true);
  });

  it('accepts a timeout expressed in minutes', async () => {
    state.prefs = { vaultTimeoutMinutes: 1 };
    await vault.apiVaultSetup(makeJsonReq('/setup', { password: 'timeout123' }), makeRes());
    // 1 minute → still unlocked shortly after setup.
    await new Promise(r => setTimeout(r, 30));
    expect(vault.isUnlocked()).toBe(true);
  });
});

// ── NEW: encryptBufferToVault ────────────────────────────────────────

describe('encryptBufferToVault()', () => {
  const PW = 'bufpw123!';

  beforeEach(async () => {
    await vault.apiVaultSetup(makeJsonReq('/setup', { password: PW }), makeRes());
  });

  it('returns null when vault is locked', () => {
    vault.apiVaultLock({}, makeRes());
    expect(vault.encryptBufferToVault(Buffer.from('x'), 'test.jpg')).toBeNull();
  });

  it('encrypts a buffer and returns an id', () => {
    const id = vault.encryptBufferToVault(Buffer.from('image data'), 'photo.jpg');
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(MOCK_VAULT_DIR, id + '.enc'))).toBe(true);
  });

  it('stores correct metadata', () => {
    const id = vault.encryptBufferToVault(Buffer.from('pdf content'), 'doc.pdf');
    expect(state.vaultMeta[id].originalName).toBe('doc.pdf');
    expect(state.vaultMeta[id].ext).toBe('.pdf');
    expect(state.vaultMeta[id].size).toBe(11); // 'pdf content'.length
  });

  it('stores file in a folder when folder param is given', () => {
    const content = Buffer.from('x');
    const id = vault.encryptBufferToVault(content, 'shot.jpg', 'folder-uuid');
    expect(state.vaultMeta[id].folder).toBe('folder-uuid');
  });

  it('decryptToBuffer round-trips the encrypted content', () => {
    const original = Buffer.from('round-trip payload');
    const id = vault.encryptBufferToVault(original, 'clip.mp4');
    const result = vault.decryptToBuffer(id);
    expect(result).not.toBeNull();
    expect(result.buffer.equals(original)).toBe(true);
  });
});

// ── NEW: Vault Favourites ────────────────────────────────────────────

describe('apiVaultFavsGet() / apiVaultFavsToggle()', () => {
  const PW = 'favspw123!';

  beforeEach(async () => {
    await vault.apiVaultSetup(makeJsonReq('/setup', { password: PW }), makeRes());
  });

  it('returns locked error when vault is locked', () => {
    vault.apiVaultLock({}, makeRes());
    const res = makeRes();
    vault.apiVaultFavsGet({}, res);
    expect(res.statusCode).toBe(401);
  });

  it('returns empty array when no favs', () => {
    const res = makeRes();
    vault.apiVaultFavsGet({}, res);
    expect(res.jsonBody).toEqual([]);
  });

  it('toggles a fav on', () => {
    const res = makeRes();
    vault.apiVaultFavsToggle({}, res, 'abc123');
    expect(res.jsonBody.ok).toBe(true);
    expect(res.jsonBody.fav).toBe(true);
    const listRes = makeRes();
    vault.apiVaultFavsGet({}, listRes);
    expect(listRes.jsonBody).toContain('abc123');
  });

  it('toggles a fav off when already set', () => {
    vault.apiVaultFavsToggle({}, makeRes(), 'abc123');
    const res = makeRes();
    vault.apiVaultFavsToggle({}, res, 'abc123');
    expect(res.jsonBody.fav).toBe(false);
    const listRes = makeRes();
    vault.apiVaultFavsGet({}, listRes);
    expect(listRes.jsonBody).not.toContain('abc123');
  });

  it('persists favs across get calls', () => {
    vault.apiVaultFavsToggle({}, makeRes(), 'id1');
    vault.apiVaultFavsToggle({}, makeRes(), 'id2');
    const res = makeRes();
    vault.apiVaultFavsGet({}, res);
    expect(res.jsonBody).toHaveLength(2);
    expect(res.jsonBody).toContain('id1');
    expect(res.jsonBody).toContain('id2');
  });
});

// ── NEW: Vault Links ─────────────────────────────────────────────────

describe('Vault Links (apiVaultGetLinks / apiVaultImportLinks / apiVaultLinkFav / apiVaultRestoreLink)', () => {
  const PW = 'linkspw123!';

  beforeEach(async () => {
    await vault.apiVaultSetup(makeJsonReq('/setup', { password: PW }), makeRes());
  });

  it('apiVaultGetLinks returns locked error when vault is locked', async () => {
    vault.apiVaultLock({}, makeRes());
    const res = makeRes();
    await vault.apiVaultGetLinks({}, res);
    expect(res.statusCode).toBe(401);
  });

  it('apiVaultGetLinks returns empty array initially', async () => {
    const res = makeRes();
    await vault.apiVaultGetLinks({}, res);
    expect(res.jsonBody).toEqual([]);
  });

  it('apiVaultImportLinks adds URLs', async () => {
    const res = makeRes();
    await vault.apiVaultImportLinks(
      makeJsonReq('/import', { urls: ['https://a.com', 'https://b.com'] }), res);
    expect(res.jsonBody.ok).toBe(true);
    expect(res.jsonBody.added).toBe(2);
    const listRes = makeRes();
    await vault.apiVaultGetLinks({}, listRes);
    expect(listRes.jsonBody).toHaveLength(2);
  });

  it('apiVaultImportLinks skips duplicate URLs', async () => {
    await vault.apiVaultImportLinks(
      makeJsonReq('/import', { urls: ['https://a.com'] }), makeRes());
    const res = makeRes();
    await vault.apiVaultImportLinks(
      makeJsonReq('/import', { urls: ['https://a.com', 'https://b.com'] }), res);
    expect(res.jsonBody.added).toBe(1);
    expect(res.jsonBody.skipped).toBe(1);
  });

  it('apiVaultImportLinks rejects empty URL list', async () => {
    const res = makeRes();
    await vault.apiVaultImportLinks(makeJsonReq('/import', { urls: [] }), res);
    expect(res.statusCode).toBe(400);
  });

  it('apiVaultLinkFav toggles favourite on a vault link', async () => {
    await vault.apiVaultImportLinks(
      makeJsonReq('/import', { urls: ['https://fav.com'] }), makeRes());
    const res = makeRes();
    await vault.apiVaultLinkFav(
      makeJsonReq('/fav', { url: 'https://fav.com' }), res);
    expect(res.jsonBody.ok).toBe(true);
    expect(res.jsonBody.fav).toBe(true);
  });

  it('apiVaultLinkFav returns 404 for unknown URL', async () => {
    const res = makeRes();
    await vault.apiVaultLinkFav(
      makeJsonReq('/fav', { url: 'https://nope.com' }), res);
    expect(res.statusCode).toBe(404);
  });

  it('apiVaultRestoreLink moves a link back to public list', async () => {
    await vault.apiVaultImportLinks(
      makeJsonReq('/import', { urls: ['https://restore.com'] }), makeRes());

    const res = makeRes();
    await vault.apiVaultRestoreLink(
      makeJsonReq('/restore', { url: 'https://restore.com' }), res);
    expect(res.jsonBody.ok).toBe(true);

    // No longer in vault links
    const listRes = makeRes();
    await vault.apiVaultGetLinks({}, listRes);
    expect(listRes.jsonBody.find(l => l.url === 'https://restore.com')).toBeUndefined();

    // Moved to public links via upsertLink
    expect(state.links.find(l => l.url === 'https://restore.com')).toBeDefined();
  });

  it('apiVaultRestoreLink returns 404 for unknown URL', async () => {
    const res = makeRes();
    await vault.apiVaultRestoreLink(
      makeJsonReq('/restore', { url: 'https://ghost.com' }), res);
    expect(res.statusCode).toBe(404);
  });
});

// ── NEW: File rename ─────────────────────────────────────────────────

describe('apiVaultRename()', () => {
  const PW = 'renamepw123!';

  beforeEach(async () => {
    await vault.apiVaultSetup(makeJsonReq('/setup', { password: PW }), makeRes());
  });

  it('renames a file display name', async () => {
    const addRes = makeRes();
    await vault.apiVaultAdd(makeStreamReq('original.mp4', Buffer.from('x')), addRes);
    const id = addRes.jsonBody.id;

    const res = makeRes();
    await vault.apiVaultRename(makeJsonReq('/rename', { name: 'renamed' }), res, id);
    expect(res.jsonBody.ok).toBe(true);
    expect(state.vaultMeta[id].name).toBe('renamed');
  });

  it('rejects rename of non-existent file', async () => {
    const res = makeRes();
    await vault.apiVaultRename(makeJsonReq('/rename', { name: 'x' }), res, 'ghost-id');
    expect(res.statusCode).toBe(404);
  });

  it('rejects empty name', async () => {
    const addRes = makeRes();
    await vault.apiVaultAdd(makeStreamReq('f.mp4', Buffer.from('x')), addRes);
    const res = makeRes();
    await vault.apiVaultRename(makeJsonReq('/rename', { name: '' }), res, addRes.jsonBody.id);
    expect(res.statusCode).toBe(400);
  });

  it('returns locked error when vault is locked', async () => {
    vault.apiVaultLock({}, makeRes());
    const res = makeRes();
    await vault.apiVaultRename(makeJsonReq('/rename', { name: 'x' }), res, 'id');
    expect(res.statusCode).toBe(401);
  });
});

// ── NEW: Folder operations ───────────────────────────────────────────

describe('Folder operations (delete / rename / move)', () => {
  const PW = 'folderpw123!';
  let folderId;

  beforeEach(async () => {
    await vault.apiVaultSetup(makeJsonReq('/setup', { password: PW }), makeRes());
    const r = makeRes();
    await vault.apiVaultCreateFolder(makeJsonReq('/folders', { name: 'TestFolder' }), r);
    folderId = r.jsonBody.id;
  });

  it('apiVaultDeleteFolder removes the folder', async () => {
    const res = makeRes();
    await vault.apiVaultDeleteFolder({}, res, folderId);
    expect(res.jsonBody.ok).toBe(true);
    expect(state.vaultMeta[folderId]).toBeUndefined();
  });

  it('apiVaultDeleteFolder returns 404 for missing folder', async () => {
    const res = makeRes();
    await vault.apiVaultDeleteFolder({}, res, 'ghost-id');
    expect(res.statusCode).toBe(404);
  });

  it('apiVaultDeleteFolder re-parents child files to grandparent', async () => {
    // Add a file inside TestFolder
    const addRes = makeRes();
    await vault.apiVaultAdd(makeStreamReq('child.mp4', Buffer.from('x')), addRes);
    const fileId = addRes.jsonBody.id;
    // Move file into the folder
    await vault.apiVaultMoveFile(makeJsonReq('/move', { folder: folderId }), makeRes(), fileId);

    // Delete the folder
    await vault.apiVaultDeleteFolder({}, makeRes(), folderId);

    // File should now be in root (folder: null)
    expect(state.vaultMeta[fileId].folder).toBeNull();
  });

  it('apiVaultRenameFolder renames a folder', async () => {
    const res = makeRes();
    await vault.apiVaultRenameFolder(
      makeJsonReq('/rename', { name: 'Renamed' }), res, folderId);
    expect(res.jsonBody.ok).toBe(true);
    expect(state.vaultMeta[folderId].name).toBe('Renamed');
  });

  it('apiVaultRenameFolder returns 404 for non-folder id', async () => {
    const addRes = makeRes();
    await vault.apiVaultAdd(makeStreamReq('f.mp4', Buffer.from('x')), addRes);
    const res = makeRes();
    await vault.apiVaultRenameFolder(
      makeJsonReq('/rename', { name: 'x' }), res, addRes.jsonBody.id);
    expect(res.statusCode).toBe(404);
  });

  it('apiVaultMoveFolder moves a folder to a new parent', async () => {
    // Create a second folder to be the new parent
    const parentRes = makeRes();
    await vault.apiVaultCreateFolder(makeJsonReq('/folders', { name: 'Parent' }), parentRes);
    const parentId = parentRes.jsonBody.id;

    const res = makeRes();
    await vault.apiVaultMoveFolder(
      makeJsonReq('/move', { parent: parentId }), res, folderId);
    expect(res.jsonBody.ok).toBe(true);
    expect(state.vaultMeta[folderId].parent).toBe(parentId);
  });

  it('apiVaultMoveFolder rejects moving into own descendant', async () => {
    // TestFolder → child folder
    const childRes = makeRes();
    await vault.apiVaultCreateFolder(
      makeJsonReq('/folders', { name: 'Child', parent: folderId }), childRes);
    const childId = childRes.jsonBody.id;

    // Try to move TestFolder into its own child
    const res = makeRes();
    await vault.apiVaultMoveFolder(
      makeJsonReq('/move', { parent: childId }), res, folderId);
    expect(res.statusCode).toBe(400);
  });
});

// ── NEW: Move file ───────────────────────────────────────────────────

describe('apiVaultMoveFile()', () => {
  const PW = 'movepw123!';
  let fileId, folderId;

  beforeEach(async () => {
    await vault.apiVaultSetup(makeJsonReq('/setup', { password: PW }), makeRes());
    const addRes = makeRes();
    await vault.apiVaultAdd(makeStreamReq('mv.mp4', Buffer.from('x')), addRes);
    fileId = addRes.jsonBody.id;

    const folderRes = makeRes();
    await vault.apiVaultCreateFolder(makeJsonReq('/folders', { name: 'Dest' }), folderRes);
    folderId = folderRes.jsonBody.id;
  });

  it('moves a file into a folder', async () => {
    const res = makeRes();
    await vault.apiVaultMoveFile(makeJsonReq('/move', { folder: folderId }), res, fileId);
    expect(res.jsonBody.ok).toBe(true);
    expect(state.vaultMeta[fileId].folder).toBe(folderId);
  });

  it('moves a file to root (null folder)', async () => {
    await vault.apiVaultMoveFile(makeJsonReq('/move', { folder: folderId }), makeRes(), fileId);
    const res = makeRes();
    await vault.apiVaultMoveFile(makeJsonReq('/move', { folder: null }), res, fileId);
    expect(res.jsonBody.ok).toBe(true);
    expect(state.vaultMeta[fileId].folder).toBeNull();
  });

  it('returns 404 for a folder id that does not exist', async () => {
    const res = makeRes();
    await vault.apiVaultMoveFile(makeJsonReq('/move', { folder: 'ghost' }), res, fileId);
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for an unknown file id', async () => {
    const res = makeRes();
    await vault.apiVaultMoveFile(makeJsonReq('/move', { folder: null }), res, 'ghost-id');
    expect(res.statusCode).toBe(404);
  });
});

// ── NEW: Restore file ────────────────────────────────────────────────

describe('apiVaultRestoreFile()', () => {
  const PW = 'restorepw123!';
  let fileId;

  beforeEach(async () => {
    await vault.apiVaultSetup(makeJsonReq('/setup', { password: PW }), makeRes());
    if (!fs.existsSync(MOCK_VIDEOS_DIR)) fs.mkdirSync(MOCK_VIDEOS_DIR, { recursive: true });
    const addRes = makeRes();
    await vault.apiVaultAdd(makeStreamReq('restore-me.mp4', Buffer.from('restore payload')), addRes);
    fileId = addRes.jsonBody.id;
  });

  it('decrypts and writes file to destDir', async () => {
    const res = makeRes();
    await vault.apiVaultRestoreFile(
      makeJsonReq('/restore', { destDir: MOCK_VIDEOS_DIR }), res, fileId);
    expect(res.jsonBody.ok).toBe(true);
    const written = path.join(MOCK_VIDEOS_DIR, res.jsonBody.name);
    expect(fs.existsSync(written)).toBe(true);
    expect(fs.readFileSync(written).toString()).toBe('restore payload');
  });

  it('removes encrypted file after restore', async () => {
    const encPath = path.join(MOCK_VAULT_DIR, fileId + '.enc');
    expect(fs.existsSync(encPath)).toBe(true);
    await vault.apiVaultRestoreFile(
      makeJsonReq('/restore', { destDir: MOCK_VIDEOS_DIR }), makeRes(), fileId);
    expect(fs.existsSync(encPath)).toBe(false);
  });

  it('removes metadata after restore', async () => {
    await vault.apiVaultRestoreFile(
      makeJsonReq('/restore', { destDir: MOCK_VIDEOS_DIR }), makeRes(), fileId);
    expect(state.vaultMeta[fileId]).toBeUndefined();
  });

  it('returns 404 for unknown id', async () => {
    const res = makeRes();
    await vault.apiVaultRestoreFile(
      makeJsonReq('/restore', { destDir: MOCK_VIDEOS_DIR }), res, 'ghost-id');
    expect(res.statusCode).toBe(404);
  });

  it('returns locked error when vault is locked', async () => {
    vault.apiVaultLock({}, makeRes());
    const res = makeRes();
    await vault.apiVaultRestoreFile(
      makeJsonReq('/restore', { destDir: MOCK_VIDEOS_DIR }), res, fileId);
    expect(res.statusCode).toBe(401);
  });
});

// ── NEW: Text file update ────────────────────────────────────────────

describe('apiVaultUpdateTextFile()', () => {
  const PW = 'txtpw123!';
  let txtId;

  beforeEach(async () => {
    await vault.apiVaultSetup(makeJsonReq('/setup', { password: PW }), makeRes());
    const r = makeRes();
    await vault.apiVaultCreateTextFile(makeJsonReq('/text', { name: 'note.txt', content: 'initial' }), r);
    txtId = r.jsonBody.id;
  });

  it('updates text file content', async () => {
    const res = makeRes();
    await vault.apiVaultUpdateTextFile(makeJsonReq('/update', { content: 'updated' }), res, txtId);
    expect(res.jsonBody.ok).toBe(true);
    const dec = vault.decryptToBuffer(txtId);
    expect(dec.buffer.toString()).toBe('updated');
  });

  it('rejects update on non-text files', async () => {
    const addRes = makeRes();
    await vault.apiVaultAdd(makeStreamReq('vid.mp4', Buffer.from('x')), addRes);
    const res = makeRes();
    await vault.apiVaultUpdateTextFile(makeJsonReq('/update', { content: 'x' }), res, addRes.jsonBody.id);
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for missing id', async () => {
    const res = makeRes();
    await vault.apiVaultUpdateTextFile(makeJsonReq('/update', { content: 'x' }), res, 'ghost');
    expect(res.statusCode).toBe(404);
  });
});
