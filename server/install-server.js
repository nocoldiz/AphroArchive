'use strict';
// ═══════════════════════════════════════════════════════════════════
//  install-server.js — Link / unlink an existing installation on disk
//
//  Linking stores `installDir` in the app's own paths.json; from the next
//  start every data path (db, cache, media, feeds…) resolves inside that
//  folder (see config-server.js). Both actions restart the server so the
//  new paths take effect.
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { APP_DIR, APP_PATHS_FILE, DATA_DIR, LINKED_INSTALL_DIR, DB_DIR, MEDIA_DIR } = require('./config-server');
const { json, readBody } = require('./helpers-server');

let _restart = null;
// server.js registers how to restart (close the listener, relaunch, exit).
function setRestartHandler(fn) { _restart = fn; }

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// Does `dir` hold an AphroArchive installation? Looks for its SQLite
// database, honouring the installation's own paths.json dbDir override.
function inspectInstall(dir) {
  const root = path.resolve(String(dir || '').trim());
  if (!dir || !isDir(root)) return { valid: false, reason: 'Folder not found' };
  const cfg = readJson(path.join(root, 'paths.json'));
  const dbDirs = [cfg.dbDir && path.resolve(cfg.dbDir), path.join(root, 'db')].filter(d => d && isDir(d));
  let dbFile = '';
  for (const d of dbDirs) {
    const f = ['db.db', 'aphroarchive_default.db'].map(n => path.join(d, n)).find(f => fs.existsSync(f))
      || fs.readdirSync(d).filter(n => n.endsWith('.db')).map(n => path.join(d, n))[0];
    if (f) { dbFile = f; break; }
  }
  if (!dbFile) return { valid: false, reason: 'No AphroArchive database (db folder with .db files) in this folder' };
  const mediaDir = [cfg.mediaDir, cfg.videosDir].filter(Boolean).map(p => path.resolve(p)).find(isDir)
    || ['media', 'videos'].map(n => path.join(root, n)).find(isDir) || '';
  return { valid: true, path: root, dbFile, mediaDir };
}

function writeLink(installDir) {
  const cfg = readJson(APP_PATHS_FILE);
  if (installDir) cfg.installDir = installDir; else delete cfg.installDir;
  fs.writeFileSync(APP_PATHS_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

function restartSoon() {
  // Let the response flush first.
  setTimeout(() => { if (_restart) _restart(); }, 300);
}

// GET /api/install
function apiStatus(req, res) {
  json(res, {
    linked: !!LINKED_INSTALL_DIR,
    installDir: LINKED_INSTALL_DIR,
    appDir: APP_DIR,
    dataDir: DATA_DIR,
    dbDir: DB_DIR,
    mediaDir: MEDIA_DIR,
    canRestart: !!_restart,
  });
}

// GET /api/install/check?path=
function apiCheck(req, res, params) {
  json(res, inspectInstall(params.get('path')));
}

// POST /api/install/link { path }
async function apiLink(req, res) {
  const body = await readBody(req);
  const info = inspectInstall(body.path);
  if (!info.valid) return json(res, { ok: false, error: info.reason }, 400);
  // Linking the app's own folder is the same as not linking at all.
  const target = info.path === path.resolve(APP_DIR) ? '' : info.path;
  try {
    writeLink(target);
  } catch (e) {
    return json(res, { ok: false, error: 'Could not save the link: ' + e.message }, 500);
  }
  json(res, { ok: true, installDir: info.path, linked: !!target, restarting: !!_restart });
  restartSoon();
}

// POST /api/install/unlink
async function apiUnlink(req, res) {
  try { writeLink(''); }
  catch (e) { return json(res, { ok: false, error: 'Could not remove the link: ' + e.message }, 500); }
  json(res, { ok: true, restarting: !!_restart });
  restartSoon();
}

module.exports = { setRestartHandler, inspectInstall, apiStatus, apiCheck, apiLink, apiUnlink };
