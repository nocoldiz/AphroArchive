'use strict';
// ═══════════════════════════════════════════════════════════════════
//  backup-server.js — One-click metadata backup / restore.
//
//  Export bundles everything needed to recreate the library on a new
//  machine EXCEPT the binary media files themselves: the SQLite database
//  (videos meta, ratings, history, favourites, collections, links,
//  prompts, prefs, actors/channels/websites) plus the DB_DIR JSON
//  reference files, paths.json and the vault config/meta sidecars.
//
//  Restore overwrites those files and then exits the process so the
//  next start reads the restored database cleanly.
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { json } = require('./helpers-server');
const { buildZip } = require('./vault-zip-server');
const zipReader = require('./zip-reader-server');
const {
  DB_DIR, CACHE_DIR, DATA_DIR, PATHS_FILE,
  VAULT_CONFIG_FILE, VAULT_META_FILE,
} = require('./config-server');
const db = require('./db-server');

const MANIFEST_NAME = 'aphroarchive-backup.json';
const MAX_RESTORE_BYTES = 512 * 1024 * 1024; // 512 MB — metadata only

// Small sidecar files worth carrying alongside the DB, keyed by the folder
// they belong to on restore. Absolute source paths resolved from config.
function _sidecarSources() {
  const out = [];
  const add = (abs, zipName, root) => { if (fs.existsSync(abs)) out.push({ abs, zipName, root }); };
  // Reference JSON in DB_DIR (actors/categories/channels/websites, etc.)
  try {
    for (const f of fs.readdirSync(DB_DIR)) {
      if (f.toLowerCase().endsWith('.json')) add(path.join(DB_DIR, f), 'db/' + f, 'db');
    }
  } catch {}
  add(PATHS_FILE, 'paths.json', 'data');
  add(VAULT_CONFIG_FILE, 'cache/' + path.basename(VAULT_CONFIG_FILE), 'cache');
  add(VAULT_META_FILE, 'cache/' + path.basename(VAULT_META_FILE), 'cache');
  return out;
}

// ── Export ────────────────────────────────────────────────────────────
async function apiBackupExport(req, res) {
  const dbBuf = db.backupDbToBuffer();
  if (!dbBuf) return json(res, { error: 'Database is not yet initialised — nothing to back up.' }, 400);

  const files = [{ name: 'db/db.db', data: dbBuf }];
  for (const s of _sidecarSources()) {
    try { files.push({ name: s.zipName, data: fs.readFileSync(s.abs) }); } catch {}
  }

  const manifest = {
    app: 'AphroArchive',
    kind: 'metadata-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    entries: files.map(f => f.name),
  };
  files.push({ name: MANIFEST_NAME, data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8') });

  let zip;
  try { zip = buildZip(files, null); }
  catch (e) { return json(res, { error: 'ZIP build failed: ' + e.message }, 500); }

  const stamp = new Date().toISOString().slice(0, 10);
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Length': zip.length,
    'Content-Disposition': `attachment; filename="aphroarchive-backup-${stamp}.zip"`,
    'Cache-Control': 'no-store',
  });
  res.end(zip);
}

// ── Restore ───────────────────────────────────────────────────────────
// Body is the raw ZIP bytes (application/zip / octet-stream), not JSON.
function _readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', c => {
      total += c.length;
      if (total > MAX_RESTORE_BYTES) { req.socket?.destroy(); reject(new Error('Backup too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Map a manifest entry name (e.g. "cache/.vault-meta.json") to its absolute
// destination. Only the known roots are writable — anything else is ignored.
function _restoreDest(name) {
  const clean = String(name).replace(/\\/g, '/').replace(/\.\.+/g, '').replace(/^\/+/, '');
  if (clean === MANIFEST_NAME) return null;
  const slash = clean.indexOf('/');
  if (slash < 0) return null;
  const root = clean.slice(0, slash);
  const rel = clean.slice(slash + 1);
  if (!rel || rel.includes('/../')) return null;
  if (root === 'db')    return path.join(DB_DIR, rel);
  if (root === 'cache') return path.join(CACHE_DIR, path.basename(rel));
  if (root === 'data')  return path.join(DATA_DIR, path.basename(rel));
  return null;
}

async function apiBackupRestore(req, res) {
  let buf;
  try { buf = await _readRawBody(req); }
  catch (e) { return json(res, { error: e.message }, 413); }
  if (!buf || buf.length < 22) return json(res, { error: 'Empty or invalid upload' }, 400);

  let entries;
  try { entries = zipReader.extractAll(buf, ''); }
  catch (e) { return json(res, { error: 'Not a readable ZIP: ' + e.message }, 400); }

  const byName = new Map(entries.map(e => [e.name.replace(/\\/g, '/'), e.data]));
  const dbEntry = byName.get('db/db.db');
  if (!dbEntry) return json(res, { error: 'Backup does not contain a database (db/db.db missing).' }, 400);

  // Write sidecars first (DB handle still open is fine — these are plain files).
  let restored = 0;
  for (const [name, data] of byName) {
    if (name === 'db/db.db') continue;
    const dest = _restoreDest(name);
    if (!dest) continue;
    try { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, data); restored++; }
    catch (e) { console.error('[restore] failed', name, e.message); }
  }

  // Replace the live DB last: closes the handle and drops stale WAL/SHM.
  try { db.restoreDbFromBuffer(dbEntry); restored++; }
  catch (e) { return json(res, { error: 'Failed to write database: ' + e.message }, 500); }

  json(res, { ok: true, restored, restartRequired: true });

  // The DB handle is now closed; the process must restart to reopen it cleanly.
  console.log('\n\x1b[1;33m↻  Backup restored — restarting to load the new database…\x1b[0m\n');
  setTimeout(() => process.exit(0), 400);
}

module.exports = { apiBackupExport, apiBackupRestore };
