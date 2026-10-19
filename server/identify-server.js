'use strict';
// ═══════════════════════════════════════════════════════════════════
//  identify-server.js — recognise videos by content fingerprint, the way
//  Stash (github.com/stashapp/stash) does: compute oshash / phash (and
//  optionally MD5) for each file and look them up on a stash-box server
//  (StashDB by default) with findScenesBySceneFingerprints.
//
//  The fingerprints are byte-for-byte ports of Stash's own code so the
//  hashes match what other Stash users submitted:
//    oshash — pkg/hash/oshash (OpenSubtitles hash)
//    phash  — pkg/hash/videophash: 25 frames at 160px → 5×5 sprite →
//             goimagehash.PerceptionHash (nfnt/resize Bilinear 64×64, DCT)
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { FFMPEG_BIN, FFPROBE_BIN, VIDEOS_DIR } = require('./config-server');
const { json, readBody, fromId } = require('./helpers-server');
const { loadPrefs, loadStashIds, setStashId, loadVideoMeta, setVideoMetaFields } = require('./db-server');
const { searchOnlineVideoMetadata } = require('./video-scraper-server');

const DEFAULT_ENDPOINT = 'https://stashdb.org/graphql';
const QUERY_BATCH = 40;   // Stash sends at most 40 scenes per request
const HASH_PARALLEL = 2;  // videos fingerprinted at once (each runs 25 ffmpeg seeks)

// ── oshash ───────────────────────────────────────────────────────────

const OSHASH_CHUNK = 64 * 1024;

function sumChunk(buf) {
  let sum = 0n;
  for (let i = 0; i + 8 <= buf.length; i += 8) sum += buf.readBigUInt64LE(i);
  return sum;
}

async function oshash(fp) {
  const fh = await fs.promises.open(fp, 'r');
  try {
    const size = (await fh.stat()).size;
    if (size <= 8) throw new Error('file too small for oshash');
    const chunk = size < OSHASH_CHUNK ? Math.floor(size / 8) * 8 : OSHASH_CHUNK;
    const head = Buffer.alloc(chunk);
    const tail = Buffer.alloc(chunk);
    await fh.read(head, 0, chunk, 0);
    await fh.read(tail, 0, chunk, size - chunk);
    const result = (sumChunk(head) + sumChunk(tail) + BigInt(size)) & 0xffffffffffffffffn;
    return result.toString(16).padStart(16, '0');
  } finally { await fh.close(); }
}

function md5File(fp) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('md5');
    fs.createReadStream(fp).on('data', d => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

// ── phash ────────────────────────────────────────────────────────────

const SHOT_W = 160, COLS = 5, ROWS = 5;

function probeDuration(fp) {
  return new Promise(resolve => {
    execFile(FFPROBE_BIN, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', fp],
      { timeout: 30000 }, (err, out) => resolve(err ? 0 : parseFloat(String(out).trim()) || 0));
  });
}

// One 160px-wide frame as BMP, exactly like transcoder.ScreenshotTime with
// OutputTypeBMP. slow = accurate seek (-ss after -i), Stash's fallback.
function grabFrame(fp, t, slow) {
  const ss = ['-ss', String(t)];
  const args = ['-v', 'error', '-y', ...(slow ? [] : ss), '-i', fp, ...(slow ? ss : []),
    '-frames:v', '1', '-vf', `scale=${SHOT_W}:-2`, '-c:v', 'bmp', '-f', 'rawvideo', '-'];
  return new Promise((resolve, reject) => {
    execFile(FFMPEG_BIN, args, { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, timeout: 60000 }, (err, out) => {
      if (err) return reject(err);
      try { resolve(decodeBmp(out)); } catch (e) { reject(e); }
    });
  });
}

// Minimal BMP decoder (24/32-bit, as ffmpeg's bmp encoder emits) → RGB rows top-down.
function decodeBmp(buf) {
  if (!buf || buf.length < 54 || buf.toString('latin1', 0, 2) !== 'BM') throw new Error('not a BMP frame');
  const off = buf.readUInt32LE(10);
  const w = buf.readInt32LE(18);
  const rawH = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  if (bpp !== 24 && bpp !== 32) throw new Error(`unsupported BMP depth ${bpp}`);
  const h = Math.abs(rawH);
  const bytes = bpp / 8;
  const stride = Math.ceil((w * bytes) / 4) * 4;
  const rgb = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const src = off + (rawH > 0 ? h - 1 - y : y) * stride;
    for (let x = 0; x < w; x++) {
      const s = src + x * bytes, d = (y * w + x) * 3;
      rgb[d] = buf[s + 2]; rgb[d + 1] = buf[s + 1]; rgb[d + 2] = buf[s];
    }
  }
  return { w, h, rgb };
}

// nfnt/resize createWeights8 with the Bilinear (linear, 2-tap) kernel.
function createWeights8(dy, scale) {
  const filterLength = 2 * Math.max(Math.ceil(scale), 1);
  const filterFactor = Math.min(1 / scale, 1);
  const coeffs = new Int16Array(dy * filterLength);
  const start = new Int32Array(dy);
  for (let y = 0; y < dy; y++) {
    let interpX = scale * (y + 0.5) - 0.5;
    start[y] = Math.trunc(interpX) - Math.trunc(filterLength / 2) + 1;
    interpX -= start[y];
    for (let i = 0; i < filterLength; i++) {
      const v = Math.abs((interpX - i) * filterFactor);
      coeffs[y * filterLength + i] = Math.trunc((v <= 1 ? 1 - v : 0) * 256);
    }
  }
  return { coeffs, start, filterLength };
}

// One nfnt resize pass: filters each source row and writes the result
// transposed (out[col][row]), exactly like resizeNRGBA/resizeRGBA.
function resizePass(src, srcW, srcH, outLen) {
  const { coeffs, start, filterLength } = createWeights8(outLen, srcW / outLen);
  const maxX = srcW - 1;
  const out = new Uint8Array(outLen * srcH * 3); // outLen rows × srcH cols
  for (let x = 0; x < srcH; x++) {
    const row = x * srcW * 3;
    for (let y = 0; y < outLen; y++) {
      let r = 0, g = 0, b = 0, sum = 0;
      const ci = y * filterLength;
      for (let i = 0; i < filterLength; i++) {
        const c = coeffs[ci + i];
        if (!c) continue;
        let xi = start[y] + i;
        xi = xi >= 0 && xi < maxX ? xi : (xi >= maxX ? maxX : 0);
        const p = row + xi * 3;
        r += c * src[p]; g += c * src[p + 1]; b += c * src[p + 2];
        sum += c;
      }
      const o = (y * srcH + x) * 3;
      out[o] = clamp8(Math.trunc(r / sum));
      out[o + 1] = clamp8(Math.trunc(g / sum));
      out[o + 2] = clamp8(Math.trunc(b / sum));
    }
  }
  return out;
}
const clamp8 = v => (v < 0 ? 0 : v > 255 ? 255 : v);

// goimagehash static DCT tables (literal copies, so results match bit-for-bit).
const DCT64 = [1.9993976373924083, 1.9945809133573804, 1.9849590691974202, 1.9705552847778824, 1.9514042600770571, 1.9275521315908797, 1.8990563611860733, 1.8659855976694777,
  1.8284195114070614, 1.7864486023910306, 1.7401739822174227, 1.6897071304994142, 1.6351696263031674, 1.5766928552532127, 1.5144176930129691, 1.448494165902934,
  1.3790810894741339, 1.3063456859075537, 1.2304631811612539, 1.151616382835691, 1.0699952397741948, 0.9857963844595683, 0.8992226593092132, 0.8104826280099796,
  0.7197900730699766, 0.627363480797783, 0.5334255149497968, 0.43820248031373954, 0.3419237775206027, 0.24482135039843256, 0.1471291271993349, 0.049082457045824535];
const DCT32 = [1.9975909124103448, 1.978353019929562, 1.9400625063890882, 1.8830881303660416, 1.8079785862468867, 1.7154572200005442, 1.6064150629612899, 1.4819022507099182,
  1.3431179096940369, 1.191398608984867, 1.0282054883864435, 0.8551101868605644, 0.6737797067844401, 0.48596035980652796, 0.2934609489107235, 0.09813534865483627];
const DCT16 = [1.9903694533443936, 1.9138806714644176, 1.76384252869671, 1.546020906725474, 1.2687865683272912, 0.9427934736519956, 0.5805693545089246, 0.19603428065912154];
const TABLES = { 64: DCT64, 32: DCT32, 16: DCT16 };

function forwardDCT4(a, o) {
  const x0 = a[o], y0 = a[o + 3], x1 = a[o + 1], y1 = a[o + 2];
  let t0 = x0 + y0, t1 = x1 + y1;
  let t2 = (x0 - y0) / 1.8477590650225735, t3 = (x1 - y1) / 0.7653668647301797;
  let x = t0, y = t1;
  t0 += t1; t1 = (x - y) / 1.4142135623730951;
  x = t2; y = t3;
  t2 += t3; t3 = (x - y) / 1.4142135623730951;
  a[o] = t0; a[o + 1] = t2 + t3; a[o + 2] = t1; a[o + 3] = t3;
}

function forwardDCT8(a, o) {
  const A = [a[o] + a[o + 7], a[o + 1] + a[o + 6], a[o + 2] + a[o + 5], a[o + 3] + a[o + 4]];
  const B = [(a[o] - a[o + 7]) / 1.9615705608064609, (a[o + 1] - a[o + 6]) / 1.6629392246050907,
    (a[o + 2] - a[o + 5]) / 1.1111404660392046, (a[o + 3] - a[o + 4]) / 0.3901806440322566];
  forwardDCT4(A, 0); forwardDCT4(B, 0);
  a[o] = A[0]; a[o + 1] = B[0] + B[1]; a[o + 2] = A[1]; a[o + 3] = B[1] + B[2];
  a[o + 4] = A[2]; a[o + 5] = B[2] + B[3]; a[o + 6] = A[3]; a[o + 7] = B[3];
}

// Lee's DCT-II (unscaled), sizes 64/32/16 → 8, operating in place on a[o..o+n).
function forwardDCT(a, o, n) {
  if (n === 8) return forwardDCT8(a, o);
  const half = n / 2, table = TABLES[n];
  const temp = new Float64Array(n);
  for (let i = 0; i < half; i++) {
    const x = a[o + i], y = a[o + n - 1 - i];
    temp[i] = x + y;
    temp[i + half] = (x - y) / table[i];
  }
  forwardDCT(temp, 0, half);
  forwardDCT(temp, half, half);
  for (let i = 0; i < half - 1; i++) {
    a[o + i * 2] = temp[i];
    a[o + i * 2 + 1] = temp[i + half] + temp[i + half + 1];
  }
  a[o + n - 2] = temp[half - 1]; a[o + n - 1] = temp[n - 1];
}

// etcs.quickSelectMedian, quirks included (for even lengths it averages
// sequence[k-1] and sequence[k] as left by the partial selection).
function quickSelectMedian(seq, low, hi, k) {
  if (low === hi) return seq[k];
  while (low < hi) {
    const pivot = Math.trunc(low / 2) + Math.trunc(hi / 2);
    const pv = seq[pivot];
    let store = low;
    [seq[pivot], seq[hi]] = [seq[hi], seq[pivot]];
    for (let i = low; i < hi; i++) {
      if (seq[i] < pv) { [seq[store], seq[i]] = [seq[i], seq[store]]; store++; }
    }
    [seq[hi], seq[store]] = [seq[store], seq[hi]];
    if (k <= store) hi = store; else low = store + 1;
  }
  return seq.length % 2 === 0 ? seq[k - 1] / 2 + seq[k] / 2 : seq[k];
}

// goimagehash.PerceptionHash of an RGB image → 16-hex-digit string.
function perceptionHash(rgb, w, h) {
  const temp = resizePass(rgb, w, h, 64);      // 64 rows × h cols (transposed)
  const small = resizePass(temp, h, 64, 64);   // 64×64, back to normal orientation
  const px = new Float64Array(64 * 64);
  for (let i = 0; i < 64 * 64; i++) {
    px[i] = 0.299 * small[i * 3] + 0.587 * small[i * 3 + 1] + 0.114 * small[i * 3 + 2];
  }
  for (let i = 0; i < 64; i++) forwardDCT(px, i * 64, 64);
  const flat = new Float64Array(64);
  const col = new Float64Array(64);
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 64; j++) col[j] = px[64 * j + i];
    forwardDCT(col, 0, 64);
    for (let j = 0; j < 8; j++) flat[8 * j + i] = col[j];
  }
  const median = quickSelectMedian(Array.from(flat), 0, 63, 32);
  let hash = 0n;
  for (let idx = 0; idx < 64; idx++) {
    if (flat[idx] > median) hash |= 1n << BigInt(64 - idx - 1);
  }
  return hash.toString(16); // utils.PhashToString: no zero padding
}

async function videoPhash(fp, duration) {
  const count = COLS * ROWS;
  const offset = 0.05 * duration;
  const step = (0.9 * duration) / count;
  const frames = [];
  let slow = false;
  for (let i = 0; i < count; i++) {
    if (_job && _job.stop) throw new Error('stopped');
    const t = offset + i * step;
    let f;
    try { f = await grabFrame(fp, t, slow); }
    catch (e) {
      if (slow) throw e;
      slow = true; // Stash retries this and all later frames with accurate seek
      f = await grabFrame(fp, t, slow);
    }
    frames.push(f);
  }
  const { w, h } = frames[0];
  const W = w * COLS, H = h * ROWS;
  const sprite = Buffer.alloc(W * H * 3);
  frames.forEach((f, i) => {
    const x0 = w * (i % COLS), y0 = h * Math.floor(i / ROWS);
    for (let y = 0; y < Math.min(f.h, H - y0); y++) {
      const n = Math.min(f.w, W - x0) * 3;
      f.rgb.copy(sprite, ((y0 + y) * W + x0) * 3, y * f.w * 3, y * f.w * 3 + n);
    }
  });
  return perceptionHash(sprite, W, H);
}

// ── stash-box lookup ─────────────────────────────────────────────────

const SCENE_QUERY = `query FindScenesBySceneFingerprints($fingerprints: [[FingerprintQueryInput!]!]!) {
  findScenesBySceneFingerprints(fingerprints: $fingerprints) {
    id title code date duration
    urls { url }
    images { url width height }
    studio { name parent { name } }
    performers { as performer { name disambiguation } }
    fingerprints { algorithm hash duration }
  }
}`;

function stashboxConfig() {
  const prefs = loadPrefs();
  return {
    endpoint: (prefs.stashboxEndpoint || DEFAULT_ENDPOINT).trim(),
    apiKey: (prefs.stashboxApiKey || '').trim(),
    useMd5: !!prefs.stashboxUseMd5,
  };
}

async function queryStashbox(cfg, fingerprintSets) {
  const r = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ApiKey': cfg.apiKey, 'User-Agent': 'AphroArchive' },
    body: JSON.stringify({ query: SCENE_QUERY, variables: { fingerprints: fingerprintSets } }),
    signal: AbortSignal.timeout(60000),
  });
  const body = await r.json().catch(() => null);
  if (!r.ok || !body || body.errors) {
    const msg = body && body.errors ? body.errors.map(e => e.message).join('; ') : `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return body.data.findScenesBySceneFingerprints || [];
}

function hamming(a, b) {
  try {
    let x = BigInt('0x' + a) ^ BigInt('0x' + b), n = 0;
    while (x) { n += Number(x & 1n); x >>= 1n; }
    return n;
  } catch { return 64; }
}

// Slim a stash-box scene to what the UI needs, scored by how it matched.
function toCandidate(scene, fp) {
  let matchedBy = 'phash', dist = 64;
  for (const f of scene.fingerprints || []) {
    if ((f.algorithm === 'OSHASH' && f.hash === fp.oshash) || (f.algorithm === 'MD5' && f.hash === fp.md5)) {
      matchedBy = f.algorithm.toLowerCase(); dist = 0; break;
    }
    if (f.algorithm === 'PHASH' && fp.phash) dist = Math.min(dist, hamming(f.hash, fp.phash));
  }
  const durDiff = scene.duration && fp.duration ? Math.abs(scene.duration - fp.duration) : null;
  const studio = scene.studio ? scene.studio.name : '';
  return {
    id: scene.id,
    title: scene.title || '',
    code: scene.code || '',
    date: scene.date || '',
    duration: scene.duration || null,
    studio,
    parentStudio: scene.studio && scene.studio.parent ? scene.studio.parent.name : '',
    performers: (scene.performers || []).map(p => p.as || (p.performer && p.performer.name)).filter(Boolean),
    url: scene.urls && scene.urls[0] ? scene.urls[0].url : '',
    image: scene.images && scene.images[0] ? scene.images[0].url : '',
    matchedBy, distance: dist, durationDiff: durDiff,
  };
}

function rankCandidates(list) {
  const exact = c => (c.matchedBy === 'phash' ? 1 : 0);
  return list.sort((a, b) => exact(a) - exact(b) || a.distance - b.distance || (a.durationDiff ?? 1e9) - (b.durationDiff ?? 1e9));
}

// ── Batch job ────────────────────────────────────────────────────────

let _job = null; // { running, stop, total, done, failed, matched, current, error }

function videoPath(id) {
  const rel = fromId(id);
  return path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(VIDEOS_DIR, rel);
}

async function fingerprint(v, prev, cfg) {
  const fp = videoPath(v.id);
  const st = await fs.promises.stat(fp);
  // Reuse cached fingerprints while the file is unchanged.
  if (prev && prev.size === st.size && prev.mtime === Math.round(st.mtimeMs) && prev.oshash && prev.phash && (!cfg.useMd5 || prev.md5)) {
    return { oshash: prev.oshash, phash: prev.phash, md5: prev.md5 || '', duration: prev.duration, size: prev.size, mtime: prev.mtime };
  }
  const duration = await probeDuration(fp);
  if (!duration) throw new Error('could not read duration');
  const out = { size: st.size, mtime: Math.round(st.mtimeMs), duration };
  out.oshash = await oshash(fp);
  out.phash = await videoPhash(fp, duration);
  out.md5 = cfg.useMd5 ? await md5File(fp) : '';
  return out;
}

async function runJob({ ids, force, useScraper }) {
  const cfg = stashboxConfig();
  const isScraperMode = !cfg.apiKey || !!useScraper;
  _job = {
    running: true,
    stop: false,
    total: 0,
    done: 0,
    failed: 0,
    matched: 0,
    current: '',
    error: '',
    mode: isScraperMode ? 'scraper' : 'stashbox'
  };

  const { cachedScan } = require('./videos-server');
  const stored = loadStashIds();
  let list = (await cachedScan()).filter(v => !v.encrypted && !v.isLink);
  if (ids && ids.length) { const want = new Set(ids); list = list.filter(v => want.has(v.id)); }
  else if (!force) list = list.filter(v => !stored[v.id] || stored[v.id].status === 'error');
  _job.total = list.length;
  console.log(`[identify] ${list.length} videos to look up in ${isScraperMode ? 'Web Scraper' : 'StashDB'} mode`);

  if (isScraperMode) {
    const SCRAPER_PARALLEL = 3;
    const queue = [...list];
    const worker = async () => {
      while (queue.length && !_job.stop) {
        const v = queue.shift();
        _job.current = v.name || v.filename || '';
        try {
          const rawTitle = v.name || v.filename || '';
          let duration = null;
          try {
            const fp = videoPath(v.id);
            duration = await probeDuration(fp);
          } catch {}
          const scenes = await searchOnlineVideoMetadata(rawTitle, duration);
          setStashId(v.id, {
            status: scenes.length ? 'matched' : 'nomatch',
            scenes,
            checkedAt: Date.now(),
            error: '',
            matchedBy: 'web-scraper'
          });
          if (scenes.length) _job.matched++;
        } catch (e) {
          if (!_job.stop) {
            console.warn('[identify-scraper] search failed for', _job.current, '—', e.message);
            setStashId(v.id, { status: 'error', scenes: [], error: e.message, checkedAt: Date.now() });
            _job.failed++;
          }
        }
        _job.done++;
      }
    };
    await Promise.all(Array.from({ length: SCRAPER_PARALLEL }, worker));
    _job.running = false;
    _job.current = '';
    console.log(`[identify-scraper] done: ${_job.matched} matched, ${_job.failed} failed of ${_job.done}`);
    return;
  }

  const queue = [...list];
  let pending = []; // fingerprinted, awaiting a stash-box query

  const flush = async () => {
    const batch = pending; pending = [];
    if (!batch.length) return;
    const sets = batch.map(({ fp }) => [
      { hash: fp.oshash, algorithm: 'OSHASH' },
      { hash: fp.phash, algorithm: 'PHASH' },
      ...(fp.md5 ? [{ hash: fp.md5, algorithm: 'MD5' }] : []),
    ]);
    let results;
    try { results = await queryStashbox(cfg, sets); }
    catch (e) {
      console.warn('[identify] stash-box query failed —', e.message);
      _job.error = e.message;
      for (const { v, fp } of batch) { setStashId(v.id, { ...fp, status: 'error', scenes: [], error: e.message }); _job.failed++; }
      return;
    }
    batch.forEach(({ v, fp }, i) => {
      const scenes = rankCandidates((results[i] || []).map(s => toCandidate(s, fp))).slice(0, 8);
      setStashId(v.id, { ...fp, status: scenes.length ? 'matched' : 'nomatch', scenes, error: '' });
      if (scenes.length) _job.matched++;
    });
  };

  const worker = async () => {
    while (queue.length && !_job.stop) {
      const v = queue.shift();
      _job.current = v.name || v.filename || '';
      try {
        const fp = await fingerprint(v, stored[v.id], cfg);
        pending.push({ v, fp });
        if (pending.length >= QUERY_BATCH) await flush();
      } catch (e) {
        if (!_job.stop) {
          console.warn('[identify] fingerprint failed', _job.current, '—', e.message);
          setStashId(v.id, { status: 'error', scenes: [], error: e.message });
          _job.failed++;
        }
      }
      _job.done++;
    }
  };
  await Promise.all(Array.from({ length: HASH_PARALLEL }, worker));
  await flush(); // also flushes what was hashed before a stop
  _job.running = false;
  _job.current = '';
  console.log(`[identify] done: ${_job.matched} matched, ${_job.failed} failed of ${_job.done}`);
}

// ── API ──────────────────────────────────────────────────────────────

async function apiIdentifyStart(req, res) {
  if (_job && _job.running) return json(res, { ok: false, error: 'Already running' });
  const body = await readBody(req).catch(() => ({}));
  runJob({
    ids: Array.isArray(body && body.ids) ? body.ids : null,
    force: !!(body && body.force),
    useScraper: !!(body && body.useScraper),
  }).catch(e => { console.error('[identify]', e); if (_job) { _job.running = false; _job.error = e.message; } });
  json(res, { ok: true });
}

function apiIdentifyStop(req, res) {
  if (_job) _job.stop = true;
  json(res, { ok: true });
}

function apiIdentifyPoll(req, res) {
  if (!_job) return json(res, { running: false });
  const { running, total, done, failed, matched, current, error, mode } = _job;
  json(res, { running, total, done, failed, matched, current, error, mode });
}

// Every looked-up video still in the library, with its current file name.
async function apiIdentifyResults(req, res) {
  const { cachedScan } = require('./videos-server');
  const stored = loadStashIds();
  const out = [];
  for (const v of await cachedScan()) {
    const s = stored[v.id];
    if (!s) continue;
    out.push({
      id: v.id, name: v.name, filename: v.filename, ext: v.ext, category: v.category || '',
      status: s.status, error: s.error || '', scenes: s.scenes || [], checkedAt: s.checkedAt,
    });
  }
  json(res, {
    items: out,
    config: {
      endpoint: stashboxConfig().endpoint,
      hasKey: !!stashboxConfig().apiKey,
      scraperAvailable: true,
    }
  });
}

// Optional metadata write-back: studio → channel, performers → actors,
// tags → tags, release date. Existing values are only replaced when the scene has one.
function applySceneMeta(id, scene) {
  const meta = loadVideoMeta()[id] || {};
  const fields = {};
  if (scene.studio) fields.channel = scene.studio;
  if (scene.date) fields.date = scene.date;
  if (scene.performers && scene.performers.length) {
    fields.actors = [...new Set([...(meta.actors || []), ...scene.performers])];
  }
  if (scene.tags && scene.tags.length) {
    fields.tags = [...new Set([...(meta.tags || []), ...scene.tags])];
  }
  if (Object.keys(fields).length) setVideoMetaFields(id, fields);
}

// items: [{ id, newName?, sceneId?, applyMeta? }]. Renames go through the
// same code path as the single-video rename (sidecars, favourites, meta).
async function apiIdentifyApply(req, res) {
  const body = await readBody(req);
  const items = Array.isArray(body && body.items) ? body.items : [];
  if (!items.length) return json(res, { error: 'Nothing to apply' }, 400);
  const { renameVideo } = require('./videos-server');
  const stored = loadStashIds();
  const results = [];
  for (const it of items) {
    let id = String(it.id || '');
    const r = { id, ok: true };
    try {
      if (it.applyMeta) {
        const scenes = (stored[id] && stored[id].scenes) || [];
        const scene = scenes.find(s => s.id === it.sceneId) || scenes[0];
        if (scene) applySceneMeta(id, scene);
      }
      const newName = String(it.newName || '').trim();
      if (newName) {
        const out = renameVideo(id, newName);
        if (out.error) { r.ok = false; r.error = out.error; }
        else { r.newId = out.newId; id = out.newId; }
      }
    } catch (e) { r.ok = false; r.error = e.message; }
    results.push(r);
  }
  json(res, { ok: true, results });
}

module.exports = {
  apiIdentifyStart, apiIdentifyStop, apiIdentifyPoll, apiIdentifyResults, apiIdentifyApply,
  // exported for tests
  oshash, perceptionHash, videoPhash, decodeBmp,
};
