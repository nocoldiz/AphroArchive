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
const http    = require('http');
const https   = require('https');
const url     = require('url');
const { execFile } = require('child_process');

// ── Config (mirrors server.js constants) ────────────────────────────────────
const ROOT       = __dirname;
const VIDEOS_DIR = path.resolve(
  process.argv.find((a, i) => i >= 2 && !a.startsWith('-')) ||
  process.env.VIDEOS_DIR ||
  path.join(ROOT, 'videos')
);
const THUMBS_DIR      = path.join(ROOT, 'cache', '.AphroArchive-thumbs');
const CACHE_FILE      = path.join(ROOT, 'cache', '.AphroArchive-thumbcache.json');
const ACTOR_PHOTOS_DIR = path.join(ROOT, 'cache', '.AphroArchive-actor-photos');
const ACTORS_DB       = path.join(ROOT, 'db', 'actors.json');

const VIDEO_EXT   = new Set(['.mp4','.mkv','.avi','.mov','.wmv','.flv',
                              '.webm','.m4v','.mpg','.mpeg','.3gp','.ogv','.ts']);
const THUMB_PCT   = [0.1, 0.25, 0.5, 0.75, 0.9];   // same 5 positions as server.js
const FRAME_COUNT = THUMB_PCT.length;

const CONCURRENCY  = (() => {
  const m = process.argv.join(' ').match(/--concurrency[= ](\d+)/);
  return Math.max(1, m ? parseInt(m[1]) : 2);
})();
const SKIP_ACTORS  = process.argv.includes('--skip-actors');
const ACTORS_ONLY  = process.argv.includes('--actors-only');

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

// ── Actor slug (mirrors server/actors.js) ─────────────────────────────────────
function actorSlug(name) { return name.toLowerCase().replace(/[^a-z0-9]/g, '_'); }

// ── HTTP helpers for IMDb photo scraping ──────────────────────────────────────
function httpsGet(reqUrl, headers) {
  return new Promise((resolve, reject) => {
    const opts   = Object.assign(url.parse(reqUrl), { headers });
    const client = reqUrl.startsWith('https') ? https : http;
    client.get(opts, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return resolve(httpsGet(res.headers.location, headers));
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

function httpsGetStream(reqUrl, headers, dest) {
  return new Promise((resolve, reject) => {
    const opts   = Object.assign(url.parse(reqUrl), { headers });
    const client = reqUrl.startsWith('https') ? https : http;
    client.get(opts, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return resolve(httpsGetStream(res.headers.location, headers, dest));
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      res.pipe(dest);
      dest.on('finish', resolve);
      dest.on('error', reject);
    }).on('error', reject);
  });
}

async function fetchImdbPhotoUrl(actorName) {
  const UA        = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
  const q         = encodeURIComponent(actorName.toLowerCase());
  const firstChar = actorName[0].toLowerCase().replace(/[^a-z]/, 'a');
  const suggestUrl = `https://v2.sg.media-imdb.com/suggests/${firstChar}/${q}.json`;
  const { body }  = await httpsGet(suggestUrl, { 'User-Agent': UA, 'Accept': '*/*', 'Referer': 'https://www.imdb.com/' });
  const match = body.match(/\((\{[\s\S]*\})\)/);
  if (!match) return null;
  const parsed = JSON.parse(match[1]);
  for (const item of (parsed.d || [])) {
    if (item.id && item.id.startsWith('nm') && item.i && item.i.imageUrl)
      return item.i.imageUrl;
  }
  return null;
}

// ── Actor photo phase ─────────────────────────────────────────────────────────
async function fetchActorPhotos() {
  let actorsDb;
  try { actorsDb = JSON.parse(fs.readFileSync(ACTORS_DB, 'utf-8')); }
  catch { console.log('  actors.json not found — skipping actor photos.\n'); return; }

  const actors = Object.entries(actorsDb)
    .filter(([, v]) => v && v.imdb_page);

  if (!actors.length) {
    console.log('  No actors with imdb_page found.\n');
    return;
  }

  fs.mkdirSync(ACTOR_PHOTOS_DIR, { recursive: true });

  const pending = actors.filter(([name]) =>
    !fs.existsSync(path.join(ACTOR_PHOTOS_DIR, actorSlug(name) + '.jpg'))
  );
  const already = actors.length - pending.length;

  console.log(`  Actors     : ${actors.length} total — ${already} already done, ${pending.length} to fetch.\n`);

  if (!pending.length) {
    console.log('  All actor photos are up to date.\n');
    return;
  }

  let done = 0, failed = 0;
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

  for (const [name] of pending) {
    renderBar(done, pending.length, name);
    const destPath = path.join(ACTOR_PHOTOS_DIR, actorSlug(name) + '.jpg');
    try {
      const imgUrl = await fetchImdbPhotoUrl(name);
      if (!imgUrl) { failed++; done++; continue; }
      const out = fs.createWriteStream(destPath);
      await httpsGetStream(imgUrl, { 'User-Agent': UA, 'Referer': 'https://www.imdb.com/' }, out);
    } catch {
      try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch {}
      failed++;
    }
    done++;
  }

  process.stdout.write('\r' + ' '.repeat((process.stdout.columns || 80) - 1) + '\r');

  const fetched = done - failed;
  console.log(`  Fetched    : ${fetched}`);
  if (failed)  console.log(`  Failed     : ${failed}`);
  if (already) console.log(`  Skipped    : ${already}`);
  console.log();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n  AphroArchive — thumbnail + actor photo generator');
  console.log('  ────────────────────────────────────────────────');
  console.log(`  Videos dir : ${VIDEOS_DIR}`);
  console.log(`  Thumbs dir : ${THUMBS_DIR}`);
  console.log(`  Photos dir : ${ACTOR_PHOTOS_DIR}`);
  console.log(`  Workers    : ${CONCURRENCY}`);
  console.log();

  if (!ACTORS_ONLY) {
    if (!fs.existsSync(VIDEOS_DIR)) {
      console.error(`  Error: videos directory not found.\n  Path: ${VIDEOS_DIR}\n`);
      process.exit(1);
    }

    const videos = scanDir(VIDEOS_DIR);
    if (!videos.length) {
      console.log('  No video files found in', VIDEOS_DIR);
    } else {
      const cache   = loadCache();
      const pending = videos.filter(v => !isComplete(toId(v.rel)));
      const already = videos.length - pending.length;

      console.log(`  Found ${videos.length} video(s) — ${already} already done, ${pending.length} to generate.\n`);

      if (!pending.length) {
        console.log('  All thumbnails are up to date.\n');
      } else {
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

        await Promise.all(Array.from({ length: CONCURRENCY }, worker));
        saveCache(cache);

        process.stdout.write('\r' + ' '.repeat((process.stdout.columns || 80) - 1) + '\r');

        const generated = done - failed;
        console.log(`  Generated : ${generated}`);
        if (failed)  console.log(`  Failed    : ${failed}`);
        if (already) console.log(`  Skipped   : ${already}`);
        console.log(`  Total     : ${videos.length}\n`);
      }
    }
  }

  if (!SKIP_ACTORS) {
    console.log('  Actor photos');
    console.log('  ────────────');
    await fetchActorPhotos();
  }
}

main().catch(e => { console.error('\n  Fatal:', e.message); process.exit(1); });
