'use strict';
// ═══════════════════════════════════════════════════════════════════
//  feed-watcher-server.js — Auto-ingest from feed/ and vaultfeed/
//
//  feed/      — videos auto-sorted by categorizer algorithm, other
//               media moved to their respective media dirs
//  vaultfeed/ — files encrypted into vault on next unlock
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const {
  VIDEO_EXT, VIDEOS_DIR,
  AUDIO_EXT, AUDIO_DIR,
  BOOK_EXT, BOOKS_DIR,
  IMAGE_EXT, PHOTOS_DIR,
  FEED_DIR, VAULT_FEED_DIR,
} = require('./config-server');

const debounceTimers = new Map();
let _feedWatcher = null;

function _isSupported(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return VIDEO_EXT.has(ext) || AUDIO_EXT.has(ext) || BOOK_EXT.has(ext) || IMAGE_EXT.has(ext);
}

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

async function _processFeedFile(filePath) {
  if (!fs.existsSync(filePath) || !_isSupported(filePath)) return;
  try {
    if (!await _waitStable(filePath)) return;
    const ext = path.extname(filePath).toLowerCase();
    const filename = path.basename(filePath);

    if (AUDIO_EXT.has(ext)) {
      fs.mkdirSync(AUDIO_DIR, { recursive: true });
      fs.renameSync(filePath, _nonCollidingDest(AUDIO_DIR, filename));
      console.log(`[feed] ${filename} → audio`);
      return;
    }
    if (BOOK_EXT.has(ext)) {
      fs.mkdirSync(BOOKS_DIR, { recursive: true });
      fs.renameSync(filePath, _nonCollidingDest(BOOKS_DIR, filename));
      console.log(`[feed] ${filename} → books`);
      return;
    }
    if (IMAGE_EXT.has(ext)) {
      fs.mkdirSync(PHOTOS_DIR, { recursive: true });
      fs.renameSync(filePath, _nonCollidingDest(PHOTOS_DIR, filename));
      console.log(`[feed] ${filename} → photos`);
      return;
    }

    // Video: use categorizer algorithm to pick best folder
    const { autoCategorize } = require('./videos-server');
    const category = autoCategorize(filename);
    const destDir = category ? path.join(VIDEOS_DIR, category) : VIDEOS_DIR;
    fs.mkdirSync(destDir, { recursive: true });
    const dest = _nonCollidingDest(destDir, filename);
    fs.renameSync(filePath, dest);
    console.log(`[feed] ${filename} → ${category || '(root)'}`);
    try { require('./videos-server').invalidateScanCache(); } catch {}
  } catch (e) {
    console.error('[feed] error processing file:', e.message);
  }
}

function _onFeedEvent(filename) {
  if (!filename) return;
  const filePath = path.join(FEED_DIR, filename);
  if (debounceTimers.has(filePath)) clearTimeout(debounceTimers.get(filePath));
  debounceTimers.set(filePath, setTimeout(async () => {
    debounceTimers.delete(filePath);
    try {
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return;
      await _processFeedFile(filePath);
    } catch {}
  }, 800));
}

// Encrypt everything in vaultfeed/ into the vault. Called on vault unlock.
async function processVaultFeed() {
  const { isUnlocked, encryptLocalFileToVault } = require('./vault-server');
  if (!isUnlocked() || !fs.existsSync(VAULT_FEED_DIR)) return;
  let entries;
  try { entries = fs.readdirSync(VAULT_FEED_DIR); } catch { return; }
  for (const entry of entries) {
    const fp = path.join(VAULT_FEED_DIR, entry);
    try {
      if (!fs.statSync(fp).isFile() || !_isSupported(fp)) continue;
      if (!await _waitStable(fp)) continue;
      if (!isUnlocked()) break;
      await encryptLocalFileToVault(fp, entry, null, null);
      console.log(`[vaultfeed] encrypted: ${entry}`);
    } catch (e) {
      console.error('[vaultfeed] error encrypting:', e.message);
    }
  }
}

function startWatchers() {
  stopWatchers();
  try {
    _feedWatcher = fs.watch(FEED_DIR, (_, f) => _onFeedEvent(f));
    console.log(`[feed] watching ${FEED_DIR}`);
  } catch (e) {
    console.error('[feed] watch failed:', e.message);
  }
  // Pick up anything dropped into feed/ while the app was off
  try {
    for (const entry of fs.readdirSync(FEED_DIR)) {
      const fp = path.join(FEED_DIR, entry);
      try { if (fs.statSync(fp).isFile()) _onFeedEvent(entry); } catch {}
    }
  } catch {}
}

function stopWatchers() {
  if (_feedWatcher) { try { _feedWatcher.close(); } catch {} _feedWatcher = null; }
  for (const t of debounceTimers.values()) clearTimeout(t);
  debounceTimers.clear();
}

module.exports = { startWatchers, stopWatchers, processVaultFeed };
