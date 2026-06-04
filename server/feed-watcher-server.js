'use strict';
// ═══════════════════════════════════════════════════════════════════
//  feed-watcher-server.js — Monitor feed folders and auto-ingest videos
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { VIDEO_EXT, VIDEOS_DIR, AUDIO_EXT, AUDIO_DIR, BOOK_EXT, BOOKS_DIR, IMAGE_EXT, PHOTOS_DIR } = require('./config-server');
const { loadPrefs } = require('./db-server');

const pendingPrivate = new Set();
const watchers = new Map();
const debounceTimers = new Map();

function _isSupported(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return VIDEO_EXT.has(ext) || AUDIO_EXT.has(ext) || BOOK_EXT.has(ext) || IMAGE_EXT.has(ext);
}

function _getDestDir(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (AUDIO_EXT.has(ext)) return AUDIO_DIR;
  if (BOOK_EXT.has(ext))  return BOOKS_DIR;
  if (IMAGE_EXT.has(ext)) return PHOTOS_DIR;
  return VIDEOS_DIR;
}

// Wait until the file size stops changing (guards against in-progress copies)
async function _waitStable(filePath) {
  try {
    const size1 = fs.statSync(filePath).size;
    await new Promise(r => setTimeout(r, 500));
    if (!fs.existsSync(filePath)) return false;
    const size2 = fs.statSync(filePath).size;
    return size1 === size2 && size1 > 0;
  } catch { return false; }
}

function _nonCollidingDest(destDir, filename) {
  let dest = path.join(destDir, filename);
  if (!fs.existsSync(dest)) return dest;
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let n = 1;
  do { dest = path.join(destDir, `${base} (${n++})${ext}`); } while (fs.existsSync(dest));
  return dest;
}

async function _processRegular(filePath) {
  if (!fs.existsSync(filePath) || !_isSupported(filePath)) return;
  try {
    if (!await _waitStable(filePath)) return;
    const destDir = _getDestDir(filePath);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const dest = _nonCollidingDest(destDir, path.basename(filePath));
    fs.renameSync(filePath, dest);
    const ext = path.extname(filePath).toLowerCase();
    const kind = AUDIO_EXT.has(ext) ? 'audio' : BOOK_EXT.has(ext) ? 'book' : IMAGE_EXT.has(ext) ? 'photo' : 'video';
    console.log(`[feed] moved ${path.basename(filePath)} → ${kind}`);
    try { require('./videos-server').invalidateScanCache(); } catch {}
  } catch (e) {
    console.error('[feed] error moving file:', e.message);
  }
}

async function _processPrivate(filePath) {
  if (!fs.existsSync(filePath) || !_isSupported(filePath)) return;
  const { isUnlocked, encryptLocalFileToVault } = require('./vault-server');
  if (!isUnlocked()) {
    pendingPrivate.add(filePath);
    console.log(`[feed] vault locked — queued ${path.basename(filePath)}`);
    return;
  }
  try {
    if (!await _waitStable(filePath)) return;
    await encryptLocalFileToVault(filePath, path.basename(filePath), null, null);
    console.log(`[feed] encrypted to vault: ${path.basename(filePath)}`);
  } catch (e) {
    console.error('[feed] error encrypting file:', e.message);
  }
}

function _onFileEvent(folderPath, isPrivate, filename) {
  if (!filename) return;
  const filePath = path.join(folderPath, filename);
  if (debounceTimers.has(filePath)) clearTimeout(debounceTimers.get(filePath));
  debounceTimers.set(filePath, setTimeout(async () => {
    debounceTimers.delete(filePath);
    try {
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return;
      if (isPrivate) await _processPrivate(filePath);
      else await _processRegular(filePath);
    } catch {}
  }, 800));
}

function startWatchers(prefs) {
  stopWatchers();
  for (const folder of (prefs.feedFolders || [])) {
    if (!fs.existsSync(folder)) continue;
    try {
      watchers.set(folder, fs.watch(folder, (_, f) => _onFileEvent(folder, false, f)));
      console.log(`[feed] watching ${folder}`);
    } catch (e) { console.error('[feed] watch failed:', folder, e.message); }
  }
  for (const folder of (prefs.privateFeedFolders || [])) {
    if (!fs.existsSync(folder)) continue;
    try {
      watchers.set('private:' + folder, fs.watch(folder, (_, f) => _onFileEvent(folder, true, f)));
      console.log(`[feed] watching private ${folder}`);
    } catch (e) { console.error('[feed] watch failed (private):', folder, e.message); }
  }
}

function stopWatchers() {
  for (const [, w] of watchers) { try { w.close(); } catch {} }
  watchers.clear();
}

async function processPendingPrivateFeed() {
  const { isUnlocked, encryptLocalFileToVault } = require('./vault-server');
  if (!isUnlocked()) return;
  // Scan configured private folders for any files that arrived while vault was locked
  for (const folder of (loadPrefs().privateFeedFolders || [])) {
    if (!fs.existsSync(folder)) continue;
    try {
      for (const entry of fs.readdirSync(folder)) {
        const fp = path.join(folder, entry);
        if (fs.statSync(fp).isFile() && _isSupported(fp)) pendingPrivate.add(fp);
      }
    } catch {}
  }
  for (const filePath of [...pendingPrivate]) {
    pendingPrivate.delete(filePath);
    if (!fs.existsSync(filePath)) continue;
    try {
      if (!await _waitStable(filePath)) continue;
      await encryptLocalFileToVault(filePath, path.basename(filePath), null, null);
      console.log(`[feed] encrypted pending: ${path.basename(filePath)}`);
    } catch (e) { console.error('[feed] error encrypting pending:', e.message); }
  }
}

module.exports = { startWatchers, stopWatchers, processPendingPrivateFeed };
