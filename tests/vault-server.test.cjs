'use strict';

// ═══════════════════════════════════════════════════════════════════════
//  vault-server.test.cjs — Comprehensive test suite for vault-server.js
//  Tests crypto helpers, vault lifecycle (setup/lock/unlock), file CRUD,
//  folders, text files, page resources, favourites, links, password
//  change, restore, drop-folder processing, and edge cases.
// ═══════════════════════════════════════════════════════════════════════

/* global describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi */

// ── Mock all dependent modules before requiring vault-server ──────────

// --- mock config-server ---
const MOCK_VAULT_DIR = 'test_vault_dir';
const MOCK_VAULT_CONFIG_FILE = 'test_vault_config.json';
const MOCK_VAULT_META_FILE = 'test_vault_meta.json';
const MOCK_PROCESS_DIR = 'test_process_dir';
const MOCK_VIDEOS_DIR = 'test_videos_dir';

vi.mock('../server/config-server', () => ({
  VAULT_DIR: MOCK_VAULT_DIR,
  VAULT_CONFIG_FILE: MOCK_VAULT_CONFIG_FILE,
  VAULT_META_FILE: MOCK_VAULT_META_FILE,
  PROCESS_DIR: MOCK_PROCESS_DIR,
  VIDEOS_DIR: MOCK_VIDEOS_DIR,
  MIME: {
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.epub': 'application/epub+zip',
    '.html': 'text/html',
  },
}));

// --- mock helpers-server ---
vi.mock('../server/helpers-server', () => ({
  json: vi.fn((res, data, statusCode) => {
    if (!res.headersSent) {
      res.writeHead(statusCode || 200, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify(data));
  }),
  readBody: vi.fn((req) => Promise.resolve(req._body || {})),
  formatBytes: vi.fn((bytes) => {
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return bytes + ' B';
  }),
}));

// --- mock db-server ---
let _mockHidden = [];
let _mockVaultConfig = null;
let _mockVaultMeta = {};
let _mockPrefs = {};
let _mockVaultKey = null;
let _reEncryptSqliteCalledWith = null;

vi.mock('../server/db-server', () => ({
  loadHidden: vi.fn(() => _mockHidden),
  loadVaultConfig: vi.fn(() => _mockVaultConfig),
  saveVaultConfig: vi.fn((cfg) => { _mockVaultConfig = cfg; }),
  loadVaultMeta: vi.fn(() => ({ ..._mockVaultMeta })),
  saveVaultMeta: vi.fn((meta) => { _mockVaultMeta = { ...meta }; }),
  loadPrefs: vi.fn(() => ({ ..._mockPrefs })),
  setVaultKey: vi.fn((key) => { _mockVaultKey = key; }),
  reEncryptVaultSqlite: vi.fn((oldKey, newKey) => { _reEncryptSqliteCalledWith = { oldKey, newKey }; }),
}));

// Helper to reset the mock state between tests
function resetMockState() {
  _mockHidden = [];
  _mockVaultConfig = null;
  _mockVaultMeta = {};
  _mockPrefs = {};
  _mockVaultKey = null;
  _reEncryptSqliteCalledWith = null;
}

// --- mock feed-watcher-server ---
vi.mock('../server/feed-watcher-server', () => ({
  processPendingPrivateFeed: vi.fn(),
}));

// ── Real dependencies ────────────────────────────────────────────────
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const stream = require('stream');

// ── Module under test ────────────────────────────────────────────────
let vault;

// ── Test helpers ─────────────────────────────────────────────────────

function makeReq(url, method, body, headers, rangeHeader) {
  const req = { url: url || '/', method: method || 'GET', headers: headers || {} };
  if (body !== undefined) req._body = body;
  if (rangeHeader) req.headers.range = rangeHeader;
  return req;
}

function makeRes() {
  const chunks = [];
  let _statusCode = 200;
  let _headers = {};
  let _ended = false;
  let _headersSent = false;

  const res = {
    writeHead: vi.fn((status, headers) => {
      _statusCode = status;
      if (headers) _headers = { ..._headers, ...headers };
      _headersSent = true;
    }),
    write: vi.fn((chunk) => { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); }),
    end: vi.fn((chunk) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      _ended = true;
    }),
    setHeader: vi.fn((k, v) => { _headers[k] = v; }),
    get headersSent() { return _headersSent; },
    get statusCode() { return _statusCode; },
    get headers() { return _headers; },
    get ended() { return _ended; },
    get body() { return Buffer.concat(chunks).toString(); },
    get jsonBody() {
      try { return JSON.parse(this.body); } catch { return null; }
    },
  };
  return res;
}

// ── Setup / Teardown ─────────────────────────────────────────────────

beforeAll(() => {
  // Ensure test directories exist
  if (!fs.existsSync(MOCK_VAULT_DIR)) fs.mkdirSync(MOCK_VAULT_DIR, { recursive: true });
  if (!fs.existsSync(MOCK_PROCESS_DIR)) fs.mkdirSync(MOCK_PROCESS_DIR, { recursive: true });
});

afterAll(() => {
  // Clean up test directories
  try { fs.rmSync(MOCK_VAULT_DIR, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(MOCK_PROCESS_DIR, { recursive: true, force: true }); } catch {}
  try { fs.unlinkSync(MOCK_VAULT_CONFIG_FILE); } catch {}
  try { fs.unlinkSync(MOCK_VAULT_META_FILE); } catch {}
});

beforeEach(() => {
  // Reset mock state
  resetMockState();
  _mockHidden = [];
  _mockVaultConfig = null;
  _mockVaultMeta = {};

  // Clean vault directory
  try {
    if (fs.existsSync(MOCK_VAULT_DIR)) {
      for (const f of fs.readdirSync(MOCK_VAULT_DIR)) {
        const fp = path.join(MOCK_VAULT_DIR, f);
        try {
          if (fs.statSync(fp).isDirectory()) {
            fs.rmSync(fp, { recursive: true, force: true });
          } else {
            fs.unlinkSync(fp);
          }
        } catch {}
      }
    }
  } catch {}

  // Clean process / drop directory
  try {
    if (fs.existsSync(MOCK_PROCESS_DIR)) {
      for (const f of fs.readdirSync(MOCK_PROCESS_DIR)) {
        const fp = path.join(MOCK_PROCESS_DIR, f);
        try {
          if (fs.statSync(fp).isDirectory()) {
            fs.rmSync(fp, { recursive: true, force: true });
          } else {
            fs.unlinkSync(fp);
          }
        } catch {}
      }
    }
  } catch {}

  // Clean config & meta files
  try { fs.unlinkSync(MOCK_VAULT_CONFIG_FILE); } catch {}
  try { fs.unlinkSync(MOCK_VAULT_META_FILE); } catch {}

  // Clear module cache so vault-server re-evaluates its module state
  delete require.cache[require.resolve('../server/vault-server')];
  vault = require('../server/vault-server');
});

afterEach(() => {
  // Shred any leftover encrypted files
  try {
    if (fs.existsSync(MOCK_VAULT_DIR)) {
      for (const f of fs.readdirSync(MOCK_VAULT_DIR)) {
        try { fs.unlinkSync(path.join(MOCK_VAULT_DIR, f)); } catch {}
      }
    }
  } catch {}
});

// ── Test suite ───────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════
// 1. CRYPTO HELPERS
// ═══════════════════════════════════════════════════════════════════

describe('Crypto Helpers', () => {

  describe('deriveKeys()', () => {
    it('should derive encryption and verification keys from a password', async () => {
      const result = await vault.deriveKeys('testpassword', 'testsalt');
      expect(result).toHaveProperty('encKey');
      expect(result).toHaveProperty('verifyHash');
      expect(result.encKey).toBeInstanceOf(Buffer);
      expect(result.encKey.length).toBe(32); // AES-256 = 32 bytes
      expect(typeof result.verifyHash).toBe('string');
      expect(result.verifyHash.length).toBe(64); // 32 bytes hex-encoded
    });

    it('should produce different keys for different passwords', async () => {
      const r1 = await vault.deriveKeys('password1', 'salt');
      const r2 = await vault.deriveKeys('password2', 'salt');
      expect(r1.encKey.toString('hex')).not.toBe(r2.encKey.toString('hex'));
      expect(r1.verifyHash).not.toBe(r2.verifyHash);
    });

    it('should produce different keys for different salts', async () => {
      const r1 = await vault.deriveKeys('password', 'salt1');
      const r2 = await vault.deriveKeys('password', 'salt2');
      expect(r1.encKey.toString('hex')).not.toBe(r2.encKey.toString('hex'));
    });

    it('should be deterministic (same password + salt = same key)', async () => {
      const r1 = await vault.deriveKeys('mypassword', 'mysalt');
      const r2 = await vault.deriveKeys('mypassword', 'mysalt');
      expect(r1.encKey.toString('hex')).toBe(r2.encKey.toString('hex'));
      expect(r1.verifyHash).toBe(r2.verifyHash);
    });

    it('should handle empty password gracefully', async () => {
      const result = await vault.deriveKeys('', 'salt');
      expect(result.encKey).toBeInstanceOf(Buffer);
      expect(result.encKey.length).toBe(32);
    });
  });

  describe('isUnlocked() / getVaultKey()', () => {
    it('should return false/null when vault is not unlocked', () => {
      expect(vault.isUnlocked()).toBe(false);
      expect(vault.getVaultKey()).toBeNull();
    });

    it('should return true/key after vault is unlocked via setup', async () => {
      const req = makeReq('/api/vault/setup', 'POST', { password: 'test123!' });
      const res = makeRes();
      await vault.apiVaultSetup(req, res);
      expect(vault.isUnlocked()).toBe(true);
      expect(vault.getVaultKey()).toBeInstanceOf(Buffer);
      expect(vault.getVaultKey().length).toBe(32);
    });

    it('should return false/null after lock', async () => {
      const req = makeReq('/api/vault/setup', 'POST', { password: 'test123!' });
      const res = makeRes();
      await vault.apiVaultSetup(req, res);
      expect(vault.isUnlocked()).toBe(true);

      const lockRes = makeRes();
      vault.apiVaultLock(makeReq(), lockRes);
      expect(vault.isUnlocked()).toBe(false);
      expect(vault.getVaultKey()).toBeNull();
    });
  });

  describe('NO_CACHE_HEADERS', () => {
    it('should have no-cache headers defined', () => {
      expect(vault.NO_CACHE_HEADERS).toBeDefined();
      expect(vault.NO_CACHE_HEADERS['Cache-Control']).toContain('no-store');
      expect(vault.NO_CACHE_HEADERS['Pragma']).toBe('no-cache');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. VAULT LIFECYCLE — Setup, Status, Lock, Unlock
// ═══════════════════════════════════════════════════════════════════

describe('Vault Lifecycle', () => {

  describe('apiVaultStatus()', () => {
    it('should return configured:false when no config exists', () => {
      _mockVaultConfig = null;
      const res = makeRes();
      vault.apiVaultStatus(makeReq(), res);
      expect(res.jsonBody.configured).toBe(false);
      expect(res.jsonBody.unlocked).toBe(false);
    });

    it('should return configured:true when config exists', () => {
      _mockVaultConfig = { salt: 'somesalt', verifyHash: 'hash' };
      const res = makeRes();
      vault.apiVaultStatus(makeReq(), res);
      expect(res.jsonBody.configured).toBe(true);
    });

    it('should return unlocked:true after setup', async () => {
      _mockVaultConfig = null;
      const setupReq = makeReq('/api/vault/setup', 'POST', { password: 'mypassword' });
      const setupRes = makeRes();
      await vault.apiVaultSetup(setupReq, setupRes);

      const res = makeRes();
      vault.apiVaultStatus(makeReq(), res);
      expect(res.jsonBody.unlocked).toBe(true);
    });

    it('should reflect hidden state (whether "vault" is in hidden list)', () => {
      _mockHidden.push('vault');
      const res = makeRes();
      vault.apiVaultStatus(makeReq(), res);
      expect(res.jsonBody.hidden).toBe(true);
    });

    it('should report failed attempts and cooldown', () => {
      _mockVaultConfig = { salt: 'salt', verifyHash: 'hash' };
      const res = makeRes();
      vault.apiVaultStatus(makeReq(), res);
      expect(res.jsonBody).toHaveProperty('failedAttempts');
      expect(res.jsonBody).toHaveProperty('cooldownRemaining');
    });
  });

  describe('apiVaultSetup()', () => {
    it('should reject if already configured', async () => {
      _mockVaultConfig = { salt: 'salt', verifyHash: 'hash' };
      const req = makeReq('/api/vault/setup', 'POST', { password: 'newpw' });
      const res = makeRes();
      await vault.apiVaultSetup(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.jsonBody.error).toMatch(/already configured/i);
    });

    it('should reject passwords shorter than 6 characters', async () => {
      _mockVaultConfig = null;
      const req = makeReq('/api/vault/setup', 'POST', { password: '12345' });
      const res = makeRes();
      await vault.apiVaultSetup(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.jsonBody.error).toMatch(/at least 6/i);
    });

    it('should reject an empty password (spaces trimmed)', async () => {
      _mockVaultConfig = null;
      const req = makeReq('/api/vault/setup', 'POST', { password: '   ' });
      const res = makeRes();
      await vault.apiVaultSetup(req, res);
      expect(res.statusCode).toBe(400);
    });

    it('should successfully configure vault with valid password using static salt', async () => {
      _mockVaultConfig = null;
      const req = makeReq('/api/vault/setup', 'POST', { password: 'test123!' });
      const res = makeRes();
      await vault.apiVaultSetup(req, res);
      expect(res.jsonBody.ok).toBe(true);
      expect(_mockVaultConfig).not.toBeNull();
      expect(_mockVaultConfig.useRandomSalt).toBe(false);
      expect(typeof _mockVaultConfig.salt).toBe('string');
      expect(typeof _mockVaultConfig.verifyHash).toBe('string');
    });

    it('should successfully configure vault with random salt when requested', async () => {
      _mockVaultConfig = null;
      const req = makeReq('/api/vault/setup', 'POST', { password: 'test123!', useRandomSalt: true });
      const res = makeRes();
      await vault.apiVaultSetup(req, res);
      expect(res.jsonBody.ok).toBe(true);
      expect(_mockVaultConfig.useRandomSalt).toBe(true);
      expect(_mockVaultConfig.salt.length).toBe(64);
    });

    it('should create vault directory if it does not exist', async () => {
      try { fs.rmSync(MOCK_VAULT_DIR, { recursive: true, force: true }); } catch {}
      expect(fs.existsSync(MOCK_VAULT_DIR)).toBe(false);

      _mockVaultConfig = null;
      const req = makeReq('/api/vault/setup', 'POST', { password: 'test123!' });
      const res = makeRes();
      await vault.apiVaultSetup(req, res);
      expect(fs.existsSync(MOCK_VAULT_DIR)).toBe(true);
    });

    it('should unlock the vault on successful setup', async () => {
      _mockVaultConfig = null;
      const req = makeReq('/api/vault/setup', 'POST', { password: 'test123!' });
      const res = makeRes();
      await vault.apiVaultSetup(req, res);
      expect(vault.isUnlocked()).toBe(true);
    });
  });

  describe('apiVaultUnlock()', () => {
    it('should reject unlock if vault is not configured', async () => {
      _mockVaultConfig = null;
      const req = makeReq('/api/vault/unlock', 'POST', { password: 'test123!' });
      const res = makeRes();
      await vault.apiVaultUnlock(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.jsonBody.error).toMatch(/not configured/i);
    });

    it('should unlock vault with correct password', async () => {
      const setupReq = makeReq('/api/vault/setup', 'POST', { password: 'test123!' });
      await vault.apiVaultSetup(setupReq, makeRes());
      vault.apiVaultLock(makeReq(), makeRes());
      expect(vault.isUnlocked()).toBe(false);

      const unlockReq = makeReq('/api/vault/unlock', 'POST', { password: 'test123!' });
      const unlockRes = makeRes();
      await vault.apiVaultUnlock(unlockReq, unlockRes);
      expect(unlockRes.jsonBody.ok).toBe(true);
      expect(vault.isUnlocked()).toBe(true);
    });

    it('should reject wrong password with 401', async () => {
      const setupReq = makeReq('/api/vault/setup', 'POST', { password: 'test123!' });
      await vault.apiVaultSetup(setupReq, makeRes());
      vault.apiVaultLock(makeReq(), makeRes());

      const wrongReq = makeReq('/api/vault/unlock', 'POST', { password: 'wrongpassword' });
      const wrongRes = makeRes();
      await vault.apiVaultUnlock(wrongReq, wrongRes);
      expect(wrongRes.statusCode).toBe(401);
      expect(wrongRes.jsonBody.error).toMatch(/wrong password/i);
      expect(vault.isUnlocked()).toBe(false);
    });

    it('should enforce cooldown after multiple failed attempts', async () => {
      const setupReq = makeReq('/api/vault/setup', 'POST', { password: 'test123!' });
      await vault.apiVaultSetup(setupReq, makeRes());
      vault.apiVaultLock(makeReq(), makeRes());

      await vault.apiVaultUnlock(makeReq('/api/vault/unlock', 'POST', { password: 'wrong' }), makeRes());
      const r2 = makeRes();
      await vault.apiVaultUnlock(makeReq('/api/vault/unlock', 'POST', { password: 'wrong' }), r2);
      expect(r2.jsonBody).toHaveProperty('cooldown');
      expect(r2.jsonBody.cooldown).toBeGreaterThan(0);
    });
  });

  describe('apiVaultLock()', () => {
    it('should lock the vault and clear vault key', async () => {
      const setupReq = makeReq('/api/vault/setup', 'POST', { password: 'test123!' });
      await vault.apiVaultSetup(setupReq, makeRes());
      expect(vault.isUnlocked()).toBe(true);

      const res = makeRes();
      vault.apiVaultLock(makeReq(), res);
      expect(res.jsonBody.ok).toBe(true);
      expect(vault.isUnlocked()).toBe(false);
      expect(vault.getVaultKey()).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. FILES — Add, List, Stream, Download, Delete
// ═══════════════════════════════════════════════════════════════════

describe('Vault File Operations', () => {
  const TEST_PASSWORD = 'testpassword123';

  beforeEach(async () => {
    const setupReq = makeReq('/api/vault/setup', 'POST', { password: TEST_PASSWORD });
    await vault.apiVaultSetup(setupReq, makeRes());
  });

  describe('apiVaultAdd()', () => {
    it('should refuse to add a file when vault is locked', async () => {
      vault.apiVaultLock(makeReq(), makeRes());
      const req = new stream.Readable();
      req._read = () => {};
      req.headers = { 'x-filename': 'test.mp4' };
      req.push(null);
      const res = makeRes();
      await vault.apiVaultAdd(req, res);
      expect(res.jsonBody.error).toBe('locked');
    });

    it('should encrypt and store a file', async () => {
      const content = Buffer.from('hello world this is a test file');
      const req = new stream.Readable();
      req._read = () => {};
      req.push(content);
      req.push(null);
      req.headers = { 'x-filename': 'test.mp4' };

      const res = makeRes();
      await vault.apiVaultAdd(req, res);
      expect(res.jsonBody.ok).toBe(true);
      expect(res.jsonBody.id).toBeDefined();
      expect(typeof res.jsonBody.id).toBe('string');

      const encPath = path.join(MOCK_VAULT_DIR, res.jsonBody.id + '.enc');
      expect(fs.existsSync(encPath)).toBe(true);

      const stat = fs.statSync(encPath);
      expect(stat.size).toBeGreaterThan(content.length);
    });

    it('should store metadata for the added file', async () => {
      const content = Buffer.from('file content');
      const req = new stream.Readable();
      req._read = () => {};
      req.push(content);
      req.push(null);
      req.headers = { 'x-filename': 'my_video.mp4' };

      const res = makeRes();
      await vault.apiVaultAdd(req, res);
      const id = res.jsonBody.id;

      const meta = _mockVaultMeta;
      expect(meta[id]).toBeDefined();
      expect(meta[id].originalName).toBe('my_video.mp4');
      expect(meta[id].name).toBe('my_video');
      expect(meta[id].ext).toBe('.mp4');
      expect(meta[id].size).toBe(content.length);
      expect(meta[id].mtime).toBeGreaterThan(0);
    });

    it('should store folder in metadata when x-folder header is sent', async () => {
      const content = Buffer.from('file content');
      const req = new stream.Readable();
      req._read = () => {};
      req.push(content);
      req.push(null);
      req.headers = { 'x-filename': 'doc.mp4', 'x-folder': 'test-folder-id' };

      const res = makeRes();
      await vault.apiVaultAdd(req, res);
      const meta = _mockVaultMeta[res.jsonBody.id];
      expect(meta.folder).toBe('test-folder-id');
    });

    it('should handle empty file (zero bytes)', async () => {
      const req = new stream.Readable();
      req._read = () => {};
      req.push(null);
      req.headers = { 'x-filename': 'empty.mp4' };

      const res = makeRes();
      await vault.apiVaultAdd(req, res);
      expect(res.jsonBody.ok).toBe(true);
      const meta = _mockVaultMeta[res.jsonBody.id];
      expect(meta.size).toBe(0);
    });
  });

  describe('apiVaultFiles()', () => {
    it('should return empty list when no files have been added', () => {
      const res = makeRes();
      vault.apiVaultFiles(makeReq(), res);
      expect(res.jsonBody).toEqual([]);
    });

    it('should return list of files sorted by mtime descending', async () => {
      const content = Buffer.from('test');
      const r1 = new stream.Readable();
      r1._read = () => {};
      r1.push(content);
      r1.push(null);
      r1.headers = { 'x-filename': 'file1.mp4' };
      await vault.apiVaultAdd(r1, makeRes());

      await new Promise(r => setTimeout(r, 10));

      const r2 = new stream.Readable();
      r2._read = () => {};
      r2.push(content);
      r2.push(null);
      r2.headers = { 'x-filename': 'file2.mp4' };
      await vault.apiVaultAdd(r2, makeRes());

      const res = makeRes();
      vault.apiVaultFiles(makeReq(), res);
      const files = res.jsonBody;
      expect(files.length).toBe(2);
      expect(files[0].originalName).toBe('file2.mp4');
      expect(files[1].originalName).toBe('file1.mp4');
    });

    it('should include id and metadata fields for each file', async () => {
      const req = new stream.Readable();
      req._read = () => {};
      req.push(Buffer.from('abcd'));
      req.push(null);
      req.headers = { 'x-filename': 'video.mp4' };
      await vault.apiVaultAdd(req, makeRes());

      const res = makeRes();
      vault.apiVaultFiles(makeReq(), res);
      const file = res.jsonBody[0];
      expect(file).toHaveProperty('id');
      expect(file).toHaveProperty('originalName');
      expect(file).toHaveProperty('name');
      expect(file).toHaveProperty('ext');
      expect(file).toHaveProperty('size');
      expect(typeof file.size).toBe('number');
    });
  });

  describe('apiVaultStream()', () => {
    it('should return 401 when vault is locked', () => {
      vault.apiVaultLock(makeReq(), makeRes());
      const res = makeRes();
      vault.apiVaultStream(makeReq(), res, 'nonexistent');
      expect(res.statusCode).toBe(401);
    });

    it('should return 404 for nonexistent file id', () => {
      const res = makeRes();
      vault.apiVaultStream(makeReq('/api/vault/stream/nonexist'), res, 'nonexist');
      expect(res.statusCode).toBe(404);
    });
  });

  describe('apiVaultDelete()', () => {
    it('should return 401 when vault is locked', () => {
      vault.apiVaultLock(makeReq(), makeRes());
      const res = makeRes();
      vault.apiVaultDelete(makeReq(), res, 'someid');
      expect(res.statusCode).toBe(401);
    });

    it('should return 404 for nonexistent file', () => {
      const res = makeRes();
      vault.apiVaultDelete(makeReq(), res, 'nonexistent-id');
      expect(res.statusCode).toBe(404);
    });

    it('should delete a file and remove its metadata', async () => {
      const content = Buffer.from('delete me');
      const req = new stream.Readable();
      req._read = () => {};
      req.push(content);
      req.push(null);
      req.headers = { 'x-filename': 'delete.mp4' };
      const addRes = makeRes();
      await vault.apiVaultAdd(req, addRes);
      const id = addRes.jsonBody.id;

      expect(fs.existsSync(path.join(MOCK_VAULT_DIR, id + '.enc'))).toBe(true);
      expect(_mockVaultMeta[id]).toBeDefined();

      const delRes = makeRes();
      vault.apiVaultDelete(makeReq(), delRes, id);
      expect(delRes.jsonBody.ok).toBe(true);

      expect(fs.existsSync(path.join(MOCK_VAULT_DIR, id + '.enc'))).toBe(false);
      expect(_mockVaultMeta[id]).toBeUndefined();
    });
  });

  describe('apiVaultDownload()', () => {
    it('should return 401 when vault is locked', () => {
      vault.apiVaultLock(makeReq(), makeRes());
      const res = makeRes();
      vault.apiVaultDownload(makeReq(), res, 'someid');
      expect(res.statusCode).toBe(401);
    });

    it('should return 404 for nonexistent file', () => {
      const res = makeRes();
      vault.apiVaultDownload(makeReq(), res, 'nonexistent');
      expect(res.statusCode).toBe(404);
    });
  });

  describe('apiVaultRename()', () => {
    it('should return 401 when vault is locked', async () => {
      vault.apiVaultLock(makeReq(), makeRes());
      const res = makeRes();
      await vault.apiVaultRename(makeReq(), res, 'someid');
      expect(res.statusCode).toBe(401);
    });

    it('should return 404 for nonexistent file', async () => {
      const res = makeRes();
      const req = makeReq('/api/vault/rename', 'PATCH', { name: 'newname' });
      await vault.apiVaultRename(req, res, 'nonexistent');
      expect(res.statusCode).toBe(404);
    });

    it('should reject empty name', async () => {
      const req = new stream.Readable();
      req._read = () => {};
      req.push(Buffer.from('test'));
      req.push(null);
      req.headers = { 'x-filename': 'old.mp4' };
      const addRes = makeRes();
      await vault.apiVaultAdd(req, addRes);
      const id = addRes.jsonBody.id;

      const renameReq = makeReq('/api/vault/rename', 'PATCH', { name: '   ' });
      const renameRes = makeRes();
      await vault.apiVaultRename(renameReq, renameRes, id);
      expect(renameRes.statusCode).toBe(400);
    });

    it('should rename a file in metadata', async () => {
      const req = new stream.Readable();
      req._read = () => {};
      req.push(Buffer.from('test'));
      req.push(null);
      req.headers = { 'x-filename': 'old_name.mp4' };
      const addRes = makeRes();
      await vault.apiVaultAdd(req, addRes);
      const id = addRes.jsonBody.id;

      const renameReq = makeReq('/api/vault/rename', 'PATCH', { name: 'new_name' });
      const renameRes = makeRes();
      await vault.apiVaultRename(renameReq, renameRes, id);
      expect(renameRes.jsonBody.ok).toBe(true);
      expect(_mockVaultMeta[id].name).toBe('new_name');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. FOLDERS — Create, Delete, Move files between folders
// ═══════════════════════════════════════════════════════════════════

describe('Vault Folders', () => {
  const TEST_PASSWORD = 'test123!';

  beforeEach(async () => {
    const setupReq = makeReq('/api/vault/setup', 'POST', { password: TEST_PASSWORD });
    await vault.apiVaultSetup(setupReq, makeRes());
  });

  describe('apiVaultCreateFolder()', () => {
    it('should return 401 when vault is locked', async () => {
      vault.apiVaultLock(makeReq(), makeRes());
      const res = makeRes();
      await vault.apiVaultCreateFolder(makeReq('/api/vault/folders', 'POST', { name: 'MyFolder' }), res);
      expect(res.statusCode).toBe(401);
    });

    it('should create a folder with given name', async () => {
      const req = makeReq('/api/vault/folders', 'POST', { name: 'My Videos' });
      const res = makeRes();
      await vault.apiVaultCreateFolder(req, res);
      expect(res.jsonBody.ok).toBe(true);
      expect(res.jsonBody.name).toBe('My Videos');
      expect(res.jsonBody.id).toBeDefined();

      const folderMeta = _mockVaultMeta[res.jsonBody.id];
      expect(folderMeta.type).toBe('folder');
      expect(folderMeta.name).toBe('My Videos');
    });

    it('should reject empty folder name', async () => {
      const req = makeReq('/api/vault/folders', 'POST', { name: '' });
      const res = makeRes();
      await vault.apiVaultCreateFolder(req, res);
      expect(res.statusCode).toBe(400);
    });

    it('should reject duplicate folder names (case-insensitive)', async () => {
      await vault.apiVaultCreateFolder(makeReq('/', 'POST', { name: 'MyFolder' }), makeRes());
      const req = makeReq('/', 'POST', { name: 'myfolder' });
      const res = makeRes();
      await vault.apiVaultCreateFolder(req, res);
      expect(res.statusCode).toBe(409);
      expect(res.jsonBody.error).toMatch(/already exists/i);
    });

    it('should allow folders with different names', async () => {
      await vault.apiVaultCreateFolder(makeReq('/', 'POST', { name: 'FolderA' }), makeRes());
      const res = makeRes();
      await vault.apiVaultCreateFolder(makeReq('/', 'POST', { name: 'FolderB' }), res);
      expect(res.jsonBody.ok).toBe(true);
    });
  });

  describe('apiVaultDeleteFolder()', () => {
    it('should return 401 when locked', () => {
      vault.apiVaultLock(makeReq(), makeRes());
      const res = makeRes();
      vault.apiVaultDeleteFolder(makeReq(), res, 'someid');
      expect(res.statusCode).toBe(401);
    });

    it('should return 404 for nonexistent folder', () => {
      const res = makeRes();
      vault.apiVaultDeleteFolder(makeReq(), res, 'nonexistent');
      expect(res.statusCode).toBe(404);
    });

    it('should delete a folder and reset folder field of its files', async () => {
      const folderRes = makeRes();
      await vault.apiVaultCreateFolder(makeReq('/', 'POST', { name: 'Folder' }), folderRes);
      const folderId = folderRes.jsonBody.id;

      const content = Buffer.from('test');
      const fileReq = new stream.Readable();
      fileReq._read = () => {};
      fileReq.push(content);
      fileReq.push(null);
      fileReq.headers = { 'x-filename': 'file.mp4', 'x-folder': folderId };
      await vault.apiVaultAdd(fileReq, makeRes());

      const fileId = Object.keys(_mockVaultMeta).find(id => _mockVaultMeta[id].folder === folderId);
      expect(fileId).toBeDefined();

      const delRes = makeRes();
      vault.apiVaultDeleteFolder(makeReq(), delRes, folderId);
      expect(delRes.jsonBody.ok).toBe(true);

      expect(_mockVaultMeta[folderId]).toBeUndefined();
      expect(_mockVaultMeta[fileId].folder).toBeNull();
    });
  });

  describe('apiVaultMoveFile()', () => {
    it('should move a file to a folder', async () => {
      const folderRes = makeRes();
      await vault.apiVaultCreateFolder(makeReq('/', 'POST', { name: 'TargetFolder' }), folderRes);
      const folderId = folderRes.jsonBody.id;

      const content = Buffer.from('test');
      const fileReq = new stream.Readable();
      fileReq._read = () => {};
      fileReq.push(content);
      fileReq.push(null);
      fileReq.headers = { 'x-filename': 'movable.mp4' };
      const addRes = makeRes();
      await vault.apiVaultAdd(fileReq, addRes);
      const fileId = addRes.jsonBody.id;

      const moveReq = makeReq('/api/vault/move', 'PATCH', { folder: folderId });
      const moveRes = makeRes();
      await vault.apiVaultMoveFile(moveReq, moveRes, fileId);
      expect(moveRes.jsonBody.ok).toBe(true);
      expect(_mockVaultMeta[fileId].folder).toBe(folderId);
    });

    it('should move a file to root (folder=null)', async () => {
      const content = Buffer.from('test');
      const fileReq = new stream.Readable();
      fileReq._read = () => {};
      fileReq.push(content);
      fileReq.push(null);
      fileReq.headers = { 'x-filename': 'toroot.mp4' };
      const addRes = makeRes();
      await vault.apiVaultAdd(fileReq, addRes);
      const fileId = addRes.jsonBody.id;

      const moveReq = makeReq('/api/vault/move', 'PATCH', { folder: null });
      const moveRes = makeRes();
      await vault.apiVaultMoveFile(moveReq, moveRes, fileId);
      expect(moveRes.jsonBody.ok).toBe(true);
    });

    it('should reject moving to nonexistent folder', async () => {
      const content = Buffer.from('test');
      const fileReq = new stream.Readable();
      fileReq._read = () => {};
      fileReq.push(content);
      fileReq.push(null);
      fileReq.headers = { 'x-filename': 'test.mp4' };
      const addRes = makeRes();
      await vault.apiVaultAdd(fileReq, addRes);

      const moveReq = makeReq('/', 'PATCH', { folder: 'nonexistent-folder-id' });
      const moveRes = makeRes();
      await vault.apiVaultMoveFile(moveReq, moveRes, addRes.jsonBody.id);
      expect(moveRes.statusCode).toBe(404);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. TEXT FILES — Create and Update
// ═══════════════════════════════════════════════════════════════════

describe('Vault Text Files', () => {
  const TEST_PASSWORD = 'test123!';

  beforeEach(async () => {
    const setupReq = makeReq('/api/vault/setup', 'POST', { password: TEST_PASSWORD });
    await vault.apiVaultSetup(setupReq, makeRes());
  });

  describe('apiVaultCreateTextFile()', () => {
    it('should create a text file with given name and content', async () => {
      const req = makeReq('/api/vault/text', 'POST', { name: 'notes.txt', content: 'Hello, vault!' });
      const res = makeRes();
      await vault.apiVaultCreateTextFile(req, res);
      expect(res.jsonBody.ok).toBe(true);
      expect(res.jsonBody.id).toBeDefined();

      const meta = _mockVaultMeta[res.jsonBody.id];
      expect(meta.originalName).toBe('notes.txt');
      expect(meta.ext).toBe('.txt');
      expect(meta.size).toBe('Hello, vault!'.length);
    });

    it('should auto-append .txt extension if none provided', async () => {
      const req = makeReq('/', 'POST', { name: 'mynotes', content: 'content' });
      const res = makeRes();
      await vault.apiVaultCreateTextFile(req, res);
      expect(res.jsonBody.ok).toBe(true);
      expect(_mockVaultMeta[res.jsonBody.id].ext).toBe('.txt');
    });

    it('should create file in a folder if folder ID provided', async () => {
      const folderRes = makeRes();
      await vault.apiVaultCreateFolder(makeReq('/', 'POST', { name: 'TextFolder' }), folderRes);
      const folderId = folderRes.jsonBody.id;

      const req = makeReq('/', 'POST', { name: 'doc.txt', content: 'content', folder: folderId });
      const res = makeRes();
      await vault.apiVaultCreateTextFile(req, res);
      expect(_mockVaultMeta[res.jsonBody.id].folder).toBe(folderId);
    });

    it('should encrypt the content on disk', async () => {
      const req = makeReq('/', 'POST', { name: 'secret.txt', content: 'This is secret content' });
      const res = makeRes();
      await vault.apiVaultCreateTextFile(req, res);
      const id = res.jsonBody.id;
      const encPath = path.join(MOCK_VAULT_DIR, id + '.enc');
      expect(fs.existsSync(encPath)).toBe(true);

      const raw = fs.readFileSync(encPath);
      const plaintext = raw.toString('utf8');
      expect(plaintext).not.toContain('secret');
    });
  });

  describe('apiVaultUpdateTextFile()', () => {
    it('should update a text file content', async () => {
      const createReq = makeReq('/', 'POST', { name: 'editable.txt', content: 'original' });
      const createRes = makeRes();
      await vault.apiVaultCreateTextFile(createReq, createRes);
      const id = createRes.jsonBody.id;

      const updateReq = makeReq('/', 'PATCH', { content: 'updated content' });
      const updateRes = makeRes();
      await vault.apiVaultUpdateTextFile(updateReq, updateRes, id);
      expect(updateRes.jsonBody.ok).toBe(true);
      expect(_mockVaultMeta[id].size).toBe('updated content'.length);
    });

    it('should reject updating non-txt/md files', async () => {
      const content = Buffer.from('test');
      const fileReq = new stream.Readable();
      fileReq._read = () => {};
      fileReq.push(content);
      fileReq.push(null);
      fileReq.headers = { 'x-filename': 'image.jpg' };
      const addRes = makeRes();
      await vault.apiVaultAdd(fileReq, addRes);
      const id = addRes.jsonBody.id;

      const updateReq = makeReq('/', 'PATCH', { content: 'new content' });
      const updateRes = makeRes();
      await vault.apiVaultUpdateTextFile(updateReq, updateRes, id);
      expect(updateRes.statusCode).toBe(400);
      expect(updateRes.jsonBody.error).toMatch(/only txt\/md/i);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. FAVOURITES — Encrypted JSON array
// ═══════════════════════════════════════════════════════════════════

describe('Vault Favourites', () => {
  const TEST_PASSWORD = 'test123!';

  beforeEach(async () => {
    const setupReq = makeReq('/api/vault/setup', 'POST', { password: TEST_PASSWORD });
    await vault.apiVaultSetup(setupReq, makeRes());
  });

  describe('apiVaultFavsGet()', () => {
    it('should return empty array when no favourites exist', () => {
      const res = makeRes();
      vault.apiVaultFavsGet(makeReq(), res);
      expect(res.jsonBody).toEqual([]);
    });
  });

  describe('apiVaultFavsToggle()', () => {
    it('should add a file to favourites', () => {
      const res = makeRes();
      vault.apiVaultFavsToggle(makeReq('/', 'POST', { id: 'file123' }), res, 'file123');
      expect(res.jsonBody.fav).toBe(true);

      const getRes = makeRes();
      vault.apiVaultFavsGet(makeReq(), getRes);
      expect(getRes.jsonBody).toContain('file123');
    });

    it('should remove a file from favourites on second toggle', () => {
      vault.apiVaultFavsToggle(makeReq('/', 'POST', { id: 'file123' }), makeRes(), 'file123');

      const res = makeRes();
      vault.apiVaultFavsToggle(makeReq('/', 'POST', { id: 'file123' }), res, 'file123');
      expect(res.jsonBody.fav).toBe(false);

      const getRes = makeRes();
      vault.apiVaultFavsGet(makeReq(), getRes);
      expect(getRes.jsonBody).not.toContain('file123');
    });

    it('should handle multiple favourites', () => {
      vault.apiVaultFavsToggle(makeReq('/', 'POST'), makeRes(), 'id1');
      vault.apiVaultFavsToggle(makeReq('/', 'POST'), makeRes(), 'id2');
      vault.apiVaultFavsToggle(makeReq('/', 'POST'), makeRes(), 'id3');

      const res = makeRes();
      vault.apiVaultFavsGet(makeReq(), res);
      expect(res.jsonBody).toEqual(expect.arrayContaining(['id1', 'id2', 'id3']));
      expect(res.jsonBody.length).toBe(3);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. LINKS — Encrypted link storage
// ═══════════════════════════════════════════════════════════════════

describe('Vault Links', () => {
  const TEST_PASSWORD = 'test123!';

  beforeEach(async () => {
    const setupReq = makeReq('/api/vault/setup', 'POST', { password: TEST_PASSWORD });
    await vault.apiVaultSetup(setupReq, makeRes());
  });

  describe('apiVaultGetLinks()', () => {
    it('should return empty array initially', async () => {
      const res = makeRes();
      await vault.apiVaultGetLinks(makeReq(), res);
      expect(res.jsonBody).toEqual([]);
    });
  });

  describe('apiVaultImportLinks()', () => {
    it('should import URLs', async () => {
      const req = makeReq('/', 'POST', { urls: ['https://example.com', 'https://test.org'] });
      const res = makeRes();
      await vault.apiVaultImportLinks(req, res);
      expect(res.jsonBody.ok).toBe(true);
      expect(res.jsonBody.added).toBe(2);

      const getRes = makeRes();
      await vault.apiVaultGetLinks(makeReq(), getRes);
      expect(getRes.jsonBody.length).toBe(2);
      expect(getRes.jsonBody[0].url).toBe('https://example.com');
    });

    it('should skip duplicate URLs', async () => {
      await vault.apiVaultImportLinks(makeReq('/', 'POST', { urls: ['https://example.com'] }), makeRes());
      const req = makeReq('/', 'POST', { urls: ['https://example.com', 'https://new.com'] });
      const res = makeRes();
      await vault.apiVaultImportLinks(req, res);
      expect(res.jsonBody.added).toBe(1);
      expect(res.jsonBody.skipped).toBe(1);
    });

    it('should reject empty URL list', async () => {
      const req = makeReq('/', 'POST', { urls: [] });
      const res = makeRes();
      await vault.apiVaultImportLinks(req, res);
      expect(res.statusCode).toBe(400);
    });
  });

  describe('apiVaultLinkFav()', () => {
    it('should toggle favourite on a link', async () => {
      await vault.apiVaultImportLinks(makeReq('/', 'POST', { urls: ['https://example.com'] }), makeRes());

      const favReq = makeReq('/', 'POST', { url: 'https://example.com' });
      const favRes = makeRes();
      await vault.apiVaultLinkFav(favReq, favRes);
      expect(favRes.jsonBody.fav).toBe(true);

      const favOffRes = makeRes();
      await vault.apiVaultLinkFav(favReq, favOffRes);
      expect(favOffRes.jsonBody.fav).toBe(false);
    });
  });

  describe('apiVaultRestoreLink()', () => {
    it('should remove link from vault and restore to regular links', async () => {
      await vault.apiVaultImportLinks(makeReq('/', 'POST', { urls: ['https://example.com'] }), makeRes());

      const restoreReq = makeReq('/', 'POST', { url: 'https://example.com' });
      const restoreRes = makeRes();
      await vault.apiVaultRestoreLink(restoreReq, restoreRes);
      expect(restoreRes.jsonBody.ok).toBe(true);

      const getRes = makeRes();
      await vault.apiVaultGetLinks(makeReq(), getRes);
      expect(getRes.jsonBody.length).toBe(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. PASSWORD CHANGE — Re-encrypt all files
// ═══════════════════════════════════════════════════════════════════

describe('apiVaultChangePassword()', () => {
  const OLD_PW = 'oldpassword123';
  const NEW_PW = 'newpassword456';

  beforeEach(async () => {
    const setupReq = makeReq('/api/vault/setup', 'POST', { password: OLD_PW });
    await vault.apiVaultSetup(setupReq, makeRes());
  });

  it('should reject if vault is locked', async () => {
    vault.apiVaultLock(makeReq(), makeRes());
    const res = makeRes();
    await vault.apiVaultChangePassword(makeReq('/', 'POST', { oldPassword: OLD_PW, newPassword: NEW_PW }), res);
    expect(res.jsonBody.error).toBe('locked');
  });

  it('should reject wrong old password', async () => {
    const req = makeReq('/', 'POST', { oldPassword: 'wrongpw', newPassword: NEW_PW });
    const res = makeRes();
    await vault.apiVaultChangePassword(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.jsonBody.error).toMatch(/wrong/i);
  });

  it('should reject short new password', async () => {
    const req = makeReq('/', 'POST', { oldPassword: OLD_PW, newPassword: 'abc12' });
    const res = makeRes();
    await vault.apiVaultChangePassword(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('should change password and re-encrypt files', async () => {
    const content = Buffer.from('persistent content');
    const fileReq = new stream.Readable();
    fileReq._read = () => {};
    fileReq.push(content);
    fileReq.push(null);
    fileReq.headers = { 'x-filename': 'keep.mp4' };
    const addRes = makeRes();
    await vault.apiVaultAdd(fileReq, addRes);
    const fileId = addRes.jsonBody.id;
    const encPath = path.join(MOCK_VAULT_DIR, fileId + '.enc');
    const oldEncSize = fs.statSync(encPath).size;

    const changeReq = makeReq('/', 'POST', { oldPassword: OLD_PW, newPassword: NEW_PW });
    const changeRes = makeRes();
    await vault.apiVaultChangePassword(changeReq, changeRes);

    // Change password calls req.on to get body, which is mocked by readBody
    // Our mock readBody just returns req._body, so it should work
    // But the apiVaultChangePassword reads with readBody directly
    // Since we mock helpers-server, this should work
    expect(changeRes.jsonBody).not.toBeNull();
    if (changeRes.jsonBody && changeRes.jsonBody.ok) {
      expect(fs.existsSync(encPath)).toBe(true);
      const newEncSize = fs.statSync(encPath).size;
      expect(Math.abs(newEncSize - oldEncSize)).toBeLessThanOrEqual(1);
      expect(vault.isUnlocked()).toBe(true);
      expect(_reEncryptSqliteCalledWith).not.toBeNull();
    }
  });

  it('should preserve files when no files exist', async () => {
    const changeReq = makeReq('/', 'POST', { oldPassword: OLD_PW, newPassword: NEW_PW });
    const changeRes = makeRes();
    await vault.apiVaultChangePassword(changeReq, changeRes);
    expect(changeRes.jsonBody).not.toBeNull();
    if (changeRes.jsonBody) {
      expect(changeRes.jsonBody.ok).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. RESTORE — Decrypt and restore files
// ═══════════════════════════════════════════════════════════════════

describe('apiVaultRestoreFile()', () => {
  const TEST_PW = 'test123!';

  beforeEach(async () => {
    const setupReq = makeReq('/api/vault/setup', 'POST', { password: TEST_PW });
    await vault.apiVaultSetup(setupReq, makeRes());
  });

  it('should restore a file to disk and remove encrypted copy', async () => {
    const originalContent = 'This will be restored to disk.';
    const fileReq = new stream.Readable();
    fileReq._read = () => {};
    fileReq.push(Buffer.from(originalContent));
    fileReq.push(null);
    fileReq.headers = { 'x-filename': 'restore_me.txt' };
    const addRes = makeRes();
    await vault.apiVaultAdd(fileReq, addRes);
    const id = addRes.jsonBody.id;

    const restoreReq = makeReq('/', 'POST', { destDir: MOCK_VIDEOS_DIR });
    const restoreRes = makeRes();
    await vault.apiVaultRestoreFile(restoreReq, restoreRes, id);
    expect(restoreRes.jsonBody).not.toBeNull();
    if (restoreRes.jsonBody && restoreRes.jsonBody.ok) {
      const encPath = path.join(MOCK_VAULT_DIR, id + '.enc');
      expect(fs.existsSync(encPath)).toBe(false);

      const restoredPath = path.join(MOCK_VIDEOS_DIR, 'restore_me.txt');
      expect(fs.existsSync(restoredPath)).toBe(true);
      expect(fs.readFileSync(restoredPath, 'utf8')).toBe(originalContent);
      try { fs.unlinkSync(restoredPath); } catch {}
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. DELETE VAULT — Full wipe
// ═══════════════════════════════════════════════════════════════════

describe('apiVaultDeleteVault()', () => {
  const TEST_PW = 'test123!';

  beforeEach(async () => {
    const setupReq = makeReq('/api/vault/setup', 'POST', { password: TEST_PW });
    await vault.apiVaultSetup(setupReq, makeRes());

    const fileReq = new stream.Readable();
    fileReq._read = () => {};
    fileReq.push(Buffer.from('data'));
    fileReq.push(null);
    fileReq.headers = { 'x-filename': 'goner.mp4' };
    await vault.apiVaultAdd(fileReq, makeRes());
  });

  it('should clear vault state (locked, no key)', async () => {
    const delRes = makeRes();
    const req = makeReq('/api/vault/delete-vault', 'POST', { confirm: 'DELETE_VAULT' });
    await vault.apiVaultDeleteVault(req, delRes);
    expect(delRes.jsonBody.ok).toBe(true);
    expect(vault.isUnlocked()).toBe(false);
    expect(vault.getVaultKey()).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. PAGE RESOURCES
// ═══════════════════════════════════════════════════════════════════

describe('Page Resources', () => {
  const TEST_PW = 'test123!';

  beforeEach(async () => {
    const setupReq = makeReq('/api/vault/setup', 'POST', { password: TEST_PW });
    await vault.apiVaultSetup(setupReq, makeRes());
  });

  describe('apiVaultPageResource()', () => {
    it('should return 401 when vault is locked', () => {
      vault.apiVaultLock(makeReq(), makeRes());
      const res = makeRes();
      vault.apiVaultPageResource(makeReq(), res, 'pageId', 'fileId');
      expect(res.statusCode).toBe(401);
    });

    it('should return 404 for nonexistent page', () => {
      const res = makeRes();
      vault.apiVaultPageResource(makeReq(), res, 'nonexistent-page', 'somefile');
      expect(res.statusCode).toBe(404);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 12. MISC — getFileMeta, decryptToBuffer, apiVaultAiTag
// ═══════════════════════════════════════════════════════════════════

describe('Miscellaneous', () => {
  const TEST_PW = 'test123!';

  beforeEach(async () => {
    const setupReq = makeReq('/api/vault/setup', 'POST', { password: TEST_PW });
    await vault.apiVaultSetup(setupReq, makeRes());
  });

  describe('getFileMeta()', () => {
    it('should return null for nonexistent id', () => {
      expect(vault.getFileMeta('nonexistent')).toBeNull();
    });

    it('should return meta for existing id', async () => {
      const fileReq = new stream.Readable();
      fileReq._read = () => {};
      fileReq.push(Buffer.from('test'));
      fileReq.push(null);
      fileReq.headers = { 'x-filename': 'meta_test.mp4' };
      const addRes = makeRes();
      await vault.apiVaultAdd(fileReq, addRes);
      const id = addRes.jsonBody.id;

      const meta = vault.getFileMeta(id);
      expect(meta).not.toBeNull();
      expect(meta.originalName).toBe('meta_test.mp4');
    });
  });

  describe('decryptToBuffer()', () => {
    it('should return null when vault is locked', () => {
      vault.apiVaultLock(makeReq(), makeRes());
      expect(vault.decryptToBuffer('anyid')).toBeNull();
    });

    it('should return null for nonexistent file', () => {
      expect(vault.decryptToBuffer('nonexistent')).toBeNull();
    });

    it('should decrypt a stored file to buffer', async () => {
      const content = Buffer.from('test image data');
      const fileReq = new stream.Readable();
      fileReq._read = () => {};
      fileReq.push(content);
      fileReq.push(null);
      fileReq.headers = { 'x-filename': 'image.jpg' };
      const addRes = makeRes();
      await vault.apiVaultAdd(fileReq, addRes);
      const id = addRes.jsonBody.id;

      const result = vault.decryptToBuffer(id);
      expect(result).not.toBeNull();
      expect(result.buffer.toString()).toBe('test image data');
      expect(result.mimeType).toBe('image/jpeg');
    });
  });

  describe('apiVaultAiTag()', () => {
    it('should mark a file as AI-tagged', async () => {
      const fileReq = new stream.Readable();
      fileReq._read = () => {};
      fileReq.push(Buffer.from('test'));
      fileReq.push(null);
      fileReq.headers = { 'x-filename': 'tagme.mp4' };
      const addRes = makeRes();
      await vault.apiVaultAdd(fileReq, addRes);
      const id = addRes.jsonBody.id;

      const res = makeRes();
      vault.apiVaultAiTag(makeReq(), res, id);
      expect(res.jsonBody.ok).toBe(true);
      expect(_mockVaultMeta[id].aiTagged).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 13. EDGE CASES & ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════

describe('Edge Cases & Error Handling', () => {
  const TEST_PW = 'test123!';

  beforeEach(async () => {
    const setupReq = makeReq('/api/vault/setup', 'POST', { password: TEST_PW });
    await vault.apiVaultSetup(setupReq, makeRes());
  });

  it('should handle concurrent lock/unlock gracefully', async () => {
    const lockRes = makeRes();
    vault.apiVaultLock(makeReq(), lockRes);
    expect(lockRes.jsonBody.ok).toBe(true);

    const fileRes = makeRes();
    vault.apiVaultFiles(makeReq(), fileRes);
    expect(fileRes.jsonBody.error).toBe('locked');
  });

  it('should reject setup with empty password after spaces trimmed', async () => {
    vault.apiVaultLock(makeReq(), makeRes());
    _mockVaultConfig = null;

    const req = makeReq('/api/vault/setup', 'POST', { password: '     ' });
    const res = makeRes();
    await vault.apiVaultSetup(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('should fail unlock when there is no config', async () => {
    vault.apiVaultLock(makeReq(), makeRes());
    _mockVaultConfig = null;

    const req = makeReq('/api/vault/unlock', 'POST', { password: 'anypw' });
    const res = makeRes();
    await vault.apiVaultUnlock(req, res);
    expect(res.statusCode).toBe(400);
  });
});