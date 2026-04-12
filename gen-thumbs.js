#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  AphroArchive — batch thumbnail pre-generator
//  Usage:
//    node gen-thumbs.js [videos_dir] [--concurrency=N]
//
//  Scans the videos folder, skips any video whose 5 thumbnail frames already
//  exist, then generates the missing ones using ffmpeg + ffprobe.
//  Writes results into .AphroArchive-thumbs/ exactly as the server would.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';
const fs      = require('fs');
const path    = require('path');
const { execFile } = require('child_process');

// ── Config (mirrors server.js constants) ────────────────────────────────────
const ROOT       = __dirname;
const VIDEOS_DIR = path.resolve(
  process.argv.find((a, i) => i >= 2 && !a.startsWith('-')) ||
  process.env.VIDEOS_DIR ||
  path.join(ROOT, 'videos')
);
const THUMBS_DIR = path.join(ROOT, 'cache', '.AphroArchive-thumbs');
const CACHE_FILE = path.join(ROOT, 'cache', '.AphroArchive-thumbcache.json');

const VIDEO_EXT   = new Set(['.mp4','.mkv','.avi','.mov','.wmv','.flv',
                              '.webm','.m4v','.mpg','.mpeg','.3gp','.ogv','.ts']);
const THUMB_PCT   = [0.1, 0.25, 0.5, 0.75, 0.9];   // same 5 positions as server.js
const FRAME_COUNT = THUMB_PCT.length;

const CONCURRENCY = (() => {
  const m = process.argv.join(' ').match(/--concurrency[= ](\d+)/);
  return Math.max(1, m ? parseInt(m[1]) : 2);
})();

// ── Resolve ffmpeg / ffprobe (prefer copy next to script, fall back to PATH) ─
function resolveBin(name) {
  const exe  = process.platform === 'win32' ? name + '.exe' : name;
  const local = path.join(ROOT, exe);
  return fs.existsSync(local) ? local : name;
}
const FFMPEG  = resolveBin('ffmpeg');
const FFPROBE = resolveBin('ffprobe');

// ── ID helpers (must match server.js toId / fromId) ─────────────────────────
function toId(rel) { return Buffer.from(rel).toString('base64url'); }

// ── Video scanner ────────────────────────────────────────────────────────────
function scanDir(dir, base) {
  if (base === undefined) base = dir;
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }

  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'hidden' || e.name === 'Z') continue;   // vault / ignore
      out.push(...scanDir(fp, base));
    } else if (e.isFile() && VIDEO_EXT.has(path.extname(e.name).toLowerCase())) {
      out.push({ fp, rel: path.relative(base, fp) });
    }
  }
  return out;
}

// ── Thumb cache ──────────────────────────────────────────────────────────────
function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')); }
  catch { return {}; }
}
function saveCache(c) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(c));
  } catch (e) { console.error('  Warning: could not save cache:', e.message); }
}

// ── Check if thumbs are already complete for a given id ──────────────────────
function isComplete(id) {
  const dir = path.join(THUMBS_DIR, id);
  if (!fs.existsSync(dir)) return false;
  for (let i = 0; i < FRAME_COUNT; i++) {
    if (!fs.existsSync(path.join(dir, `${i}.jpg`))) return false;
  }
  return true;
}

// ── ffprobe: get video duration in seconds ───────────────────────────────────
function getDuration(fp) {
  return new Promise(resolve => {
    execFile(FFPROBE,
      ['-v', 'quiet', '-print_format', 'json', '-show_format', fp],
      { timeout: 15000 },
      (err, stdout) => {
        if (err) return resolve(null);
        try { resolve(parseFloat(JSON.parse(stdout).format.duration) || null); }
        catch { resolve(null); }
      }
    );
  });
}

// ── ffmpeg: grab one frame ────────────────────────────────────────────────────
function grabFrame(fp, t, outFile) {
  return new Promise(resolve => {
    execFile(FFMPEG,
      ['-ss', String(t), '-i', fp,
       '-vframes', '1', '-vf', 'scale=480:-1', '-q:v', '3', '-y', outFile],
      { timeout: 30000 },
      err => resolve(!err)
    );
  });
}

// ── Progress bar ──────────────────────────────────────────────────────────────
function renderBar(done, total, label) {
  const cols   = (process.stdout.columns || 80) - 1;
  const pct    = total ? Math.round(done / total * 100) : 0;
  const counts = ` ${String(done).padStart(String(total).length)}/${total} ${String(pct).padStart(3)}% `;
  const suffix = ' ' + label.slice(0, 30);
  const barW   = Math.max(6, cols - counts.length - suffix.length - 2);
  const filled = Math.floor(barW * done / (total || 1));
  const bar    = '█'.repeat(filled) + '░'.repeat(barW - filled);
  process.stdout.write('\r' + (counts + '[' + bar + ']' + suffix).slice(0, cols));
}

// ── Process one video ─────────────────────────────────────────────────────────
async function processVideo({ fp, rel }, cache) {
  const id = toId(rel);

  if (isComplete(id)) {
    // ensure cache entry exists even if we're skipping
    if (!cache[id] || !cache[id].count) {
      try {
        const stat = fs.statSync(fp);
        cache[id] = { mtime: stat.mtimeMs, count: FRAME_COUNT, duration: null };
      } catch {}
    }
    return 'skip';
  }

  const dur = await getDuration(fp);
  if (!dur) return 'fail';

  const dir = path.join(THUMBS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });

  const times = THUMB_PCT.map(p => (dur * p).toFixed(2));
  let n = 0;
  await Promise.all(
    times.map((t, i) =>
      grabFrame(fp, t, path.join(dir, `${i}.jpg`)).then(ok => { if (ok) n++; })
    )
  );

  try {
    const stat = fs.statSync(fp);
    cache[id] = { mtime: stat.mtimeMs, count: n, duration: dur };
  } catch {}

  return n > 0 ? 'done' : 'fail';
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n  AphroArchive — thumbnail generator');
  console.log('  ────────────────────────────────────');
  console.log(`  Videos dir : ${VIDEOS_DIR}`);
  console.log(`  Thumbs dir : ${THUMBS_DIR}`);
  console.log(`  Workers    : ${CONCURRENCY}`);
  console.log();

  if (!fs.existsSync(VIDEOS_DIR)) {
    console.error(`  Error: videos directory not found.\n  Path: ${VIDEOS_DIR}\n`);
    process.exit(1);
  }

  const videos = scanDir(VIDEOS_DIR);
  if (!videos.length) {
    console.log('  No video files found in', VIDEOS_DIR);
    return;
  }

  const cache   = loadCache();
  const pending = videos.filter(v => !isComplete(toId(v.rel)));
  const already = videos.length - pending.length;

  console.log(`  Found ${videos.length} video(s) — ${already} already done, ${pending.length} to generate.\n`);

  if (!pending.length) {
    console.log('  All thumbnails are up to date.\n');
    return;
  }

  let done = 0, failed = 0;
  const total = pending.length;
  const queue = [...pending];

  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      const label = path.basename(item.fp);
      renderBar(done, total, label);
      const result = await processVideo(item, cache);
      done++;
      if (result === 'fail') failed++;
    }
  }

  // Run N workers in parallel
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  saveCache(cache);

  // Clear the progress line
  process.stdout.write('\r' + ' '.repeat((process.stdout.columns || 80) - 1) + '\r');

  const generated = done - failed;
  console.log(`  Generated : ${generated}`);
  if (failed)  console.log(`  Failed    : ${failed}`);
  if (already) console.log(`  Skipped   : ${already}`);
  console.log(`  Total     : ${videos.length}\n`);
}

main().catch(e => { console.error('\n  Fatal:', e.message); process.exit(1); });
