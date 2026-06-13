'use strict';
// ═══════════════════════════════════════════════════════════════════
//  veracrypt-server.js — Open VeraCrypt / TrueCrypt volumes
//
//  VeraCrypt containers cannot be read in pure JS (XTS-AES cipher
//  cascades, large PBKDF2 work factors), so this drives the installed
//  VeraCrypt CLI to mount a volume, after which its files are reachable
//  on the filesystem and can be browsed or imported into the vault.
//
//  Everything degrades gracefully when VeraCrypt is not installed.
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { json, readBody } = require('./helpers-server');
const { VIDEOS_DIR, VAULT_DIR } = require('./config-server');

const IS_WIN = process.platform === 'win32';

// Extensions commonly used for VeraCrypt / TrueCrypt containers.
const CONTAINER_EXTS = ['.hc', '.tc', '.vc'];

// Resolve the VeraCrypt binary across common install locations and PATH.
function getVeracryptBin() {
  const candidates = IS_WIN
    ? [
        'C:\\Program Files\\VeraCrypt\\VeraCrypt.exe',
        'C:\\Program Files (x86)\\VeraCrypt\\VeraCrypt.exe',
        'VeraCrypt.exe',
      ]
    : ['/usr/bin/veracrypt', '/usr/local/bin/veracrypt', 'veracrypt'];
  for (const c of candidates) {
    if (c.includes(path.sep)) { if (fs.existsSync(c)) return c; }
    else return c; // bare name → rely on PATH
  }
  return candidates[candidates.length - 1];
}

function _isAvailable() {
  const bin = getVeracryptBin();
  if (bin.includes(path.sep)) return fs.existsSync(bin);
  return true; // on PATH — assume present, mount will surface real errors
}

function _run(args, timeoutMs = 120000) {
  return new Promise((resolve) => {
    execFile(getVeracryptBin(), args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

// Recursively (shallow, depth-limited) find candidate container files.
function _scanContainers(dir, depth, out) {
  if (depth < 0) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (full === VAULT_DIR) continue; // skip the encrypted vault store
      _scanContainers(full, depth - 1, out);
    } else if (CONTAINER_EXTS.includes(path.extname(ent.name).toLowerCase())) {
      try { out.push({ path: full, name: ent.name, size: fs.statSync(full).size }); } catch {}
    }
  }
}

async function apiVeracryptStatus(req, res) {
  const containers = [];
  _scanContainers(VIDEOS_DIR, 3, containers);
  json(res, { available: _isAvailable(), bin: getVeracryptBin(), platform: process.platform, containers });
}

// Mount a container. body: { path, password, letter?, readonly?, pim? }
async function apiVeracryptMount(req, res) {
  if (!_isAvailable()) return json(res, { error: 'VeraCrypt is not installed', available: false }, 400);
  const body = await readBody(req);
  const volPath = body.path ? path.resolve(String(body.path)) : '';
  const password = String(body.password || '');
  if (!volPath || !fs.existsSync(volPath)) return json(res, { error: 'Container not found' }, 404);
  if (!password) return json(res, { error: 'Password required' }, 400);

  // Confine mountable volumes to VIDEOS_DIR.
  if (!volPath.startsWith(path.resolve(VIDEOS_DIR))) {
    return json(res, { error: 'Container must be inside the media directory' }, 403);
  }

  const readonly = !!body.readonly;
  let result, mountPoint;

  if (IS_WIN) {
    const letter = (String(body.letter || '').replace(/[^A-Za-z]/g, '')[0] || 'V').toUpperCase();
    const args = ['/q', '/s', '/v', volPath, '/l', letter, '/p', password, '/a'];
    if (readonly) args.push('/m', 'ro');
    if (body.pim) args.push('/pim', String(parseInt(body.pim, 10) || 0));
    result = await _run(args);
    mountPoint = letter + ':\\';
  } else {
    mountPoint = path.join(VIDEOS_DIR, '.vc-mount-' + Date.now());
    try { fs.mkdirSync(mountPoint, { recursive: true }); } catch {}
    const args = ['--text', '--non-interactive', '--password', password,
      '--pim', String(parseInt(body.pim, 10) || 0), '--keyfiles', '', '--protect-hidden', 'no'];
    if (readonly) args.push('--mount-options', 'ro');
    args.push(volPath, mountPoint);
    result = await _run(args);
  }

  if (result.err) {
    const msg = (result.stderr || result.stdout || result.err.message || '').trim();
    return json(res, { error: 'Mount failed: ' + (msg || 'check password/PIM') }, 400);
  }
  json(res, { ok: true, mountPoint });
}

// Dismount. body: { letter? } (Windows) or { path? } (all).
async function apiVeracryptDismount(req, res) {
  if (!_isAvailable()) return json(res, { error: 'VeraCrypt is not installed' }, 400);
  const body = await readBody(req);
  let args;
  if (IS_WIN) {
    const letter = String(body.letter || '').replace(/[^A-Za-z]/g, '')[0];
    args = letter ? ['/q', '/d', letter.toUpperCase()] : ['/q', '/d'];
  } else {
    args = body.path ? ['--text', '--non-interactive', '--dismount', path.resolve(String(body.path))]
                     : ['--text', '--non-interactive', '--dismount'];
  }
  const result = await _run(args);
  if (result.err) return json(res, { error: 'Dismount failed: ' + (result.stderr || result.err.message) }, 400);
  json(res, { ok: true });
}

// Mount, encrypt every file found into the vault, then dismount.
// body: { path, password, letter?, pim? }
async function apiVeracryptImport(req, res) {
  if (!_isAvailable()) return json(res, { error: 'VeraCrypt is not installed' }, 400);
  const vault = require('./vault-server');
  if (!vault.isUnlocked()) return json(res, { error: 'locked' }, 401);

  const body = await readBody(req);
  const volPath = body.path ? path.resolve(String(body.path)) : '';
  const password = String(body.password || '');
  if (!volPath || !fs.existsSync(volPath)) return json(res, { error: 'Container not found' }, 404);
  if (!volPath.startsWith(path.resolve(VIDEOS_DIR))) return json(res, { error: 'Container must be inside the media directory' }, 403);
  if (!password) return json(res, { error: 'Password required' }, 400);

  let mountPoint, letter;
  if (IS_WIN) {
    letter = (String(body.letter || '').replace(/[^A-Za-z]/g, '')[0] || 'V').toUpperCase();
    const r = await _run(['/q', '/s', '/v', volPath, '/l', letter, '/p', password, '/a', '/m', 'ro']);
    if (r.err) return json(res, { error: 'Mount failed: ' + (r.stderr || r.stdout || 'check password') }, 400);
    mountPoint = letter + ':\\';
  } else {
    mountPoint = path.join(VIDEOS_DIR, '.vc-mount-' + Date.now());
    try { fs.mkdirSync(mountPoint, { recursive: true }); } catch {}
    const r = await _run(['--text', '--non-interactive', '--password', password, '--mount-options', 'ro',
      '--pim', String(parseInt(body.pim, 10) || 0), '--keyfiles', '', '--protect-hidden', 'no', volPath, mountPoint]);
    if (r.err) return json(res, { error: 'Mount failed: ' + (r.stderr || r.err.message) }, 400);
  }

  // Give the OS a moment to expose the mount, then sweep files into the vault.
  const ids = [];
  try {
    await new Promise(r => setTimeout(r, 800));
    const walk = (dir) => {
      let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(full);
        else {
          try {
            const buf = fs.readFileSync(full);
            const id = vault.encryptBufferToVault(buf, ent.name, body.folder || null);
            if (id) ids.push(id);
          } catch {}
        }
      }
    };
    walk(mountPoint);
  } finally {
    if (IS_WIN) await _run(['/q', '/d', letter]);
    else { await _run(['--text', '--non-interactive', '--dismount', mountPoint]); try { fs.rmdirSync(mountPoint); } catch {} }
  }

  json(res, { ok: true, count: ids.length, ids });
}

module.exports = {
  getVeracryptBin, apiVeracryptStatus, apiVeracryptMount, apiVeracryptDismount, apiVeracryptImport,
};
