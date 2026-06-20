'use strict';

// ─────────────────────────────────────────────────────────────────────
//  hls.js — universal in-browser HLS downloader.
//
//  Many sites deliver a video not as one file but as a "package": an .m3u8
//  manifest pointing at dozens of segments (MPEG-TS .ts or fragmented-MP4
//  .m4s + an init segment). This module fetches the segments and rejoins
//  them into a single playable file — entirely client-side, no server:
//   • MPEG-TS segments are transmuxed to MP4 (audio kept) via mux.js.
//   • fMP4 segments are concatenated (init + parts) into a fragmented MP4.
//
//  Exposes a global `Hls` with `download(url, { onProgress, signal })`.
// ─────────────────────────────────────────────────────────────────────

const Hls = (() => {

  const resolve = (base, ref) => { try { return new URL(ref, base).href; } catch { return ref; } };

  async function fetchText(url, signal) {
    const r = await fetch(url, { signal });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for playlist');
    return r.text();
  }

  // Pick the highest-quality variant from a master playlist.
  function parseMaster(text, baseUrl) {
    const lines = text.split(/\r?\n/);
    let best = null;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
      const bw = parseInt((lines[i].match(/BANDWIDTH=(\d+)/) || [])[1] || '0', 10);
      const resM = lines[i].match(/RESOLUTION=(\d+)x(\d+)/);
      const height = resM ? parseInt(resM[2], 10) : 0;
      let uri = '';
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j] && !lines[j].startsWith('#')) { uri = lines[j].trim(); break; }
      }
      if (!uri) continue;
      const score = bw || height;
      if (!best || score > best.score) best = { url: resolve(baseUrl, uri), score };
    }
    return best;
  }

  // Parse a media playlist into an init segment (if fMP4) and segment URLs.
  function parseMedia(text, baseUrl) {
    const lines = text.split(/\r?\n/);
    let initUrl = null;
    const segments = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#EXT-X-MAP')) {
        const m = line.match(/URI="([^"]+)"/);
        if (m) initUrl = resolve(baseUrl, m[1]);
        continue;
      }
      if (line.startsWith('#')) continue;
      segments.push(resolve(baseUrl, line));
    }
    const fmp4 = !!initUrl || /\.(m4s|mp4)(?:$|\?)/i.test(segments[0] || '');
    return { initUrl, segments, fmp4 };
  }

  // Download many URLs as byte arrays with bounded concurrency + progress.
  async function fetchSegments(urls, { onProgress, signal, concurrency = 6 }) {
    const out = new Array(urls.length);
    let done = 0, next = 0;
    async function worker() {
      while (next < urls.length) {
        const i = next++;
        const r = await fetch(urls[i], { signal });
        if (!r.ok) throw new Error('HTTP ' + r.status + ' for segment');
        out[i] = new Uint8Array(await r.arrayBuffer());
        done++;
        if (onProgress) onProgress(done, urls.length);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
    return out;
  }

  function concat(parts) {
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  }

  // Transmux concatenated MPEG-TS bytes → MP4 (keeps muxed audio) via mux.js.
  function transmuxTsToMp4(tsBytes) {
    return new Promise((resolveP, rejectP) => {
      if (typeof muxjs === 'undefined') return rejectP(new Error('mux.js unavailable'));
      const t = new muxjs.mp4.Transmuxer({ keepOriginalTimestamps: true });
      const chunks = [];
      let initSeg = null;
      t.on('data', (seg) => { if (initSeg === null) initSeg = seg.initSegment; chunks.push(seg.data); });
      t.on('done', () => {
        if (initSeg === null) return rejectP(new Error('No data produced'));
        resolveP(concat([initSeg, ...chunks]));
      });
      try { t.push(tsBytes); t.flush(); } catch (e) { rejectP(e); }
    });
  }

  // Main entry: returns { blob, ext }.
  async function download(url, { onProgress, signal } = {}) {
    let text = await fetchText(url, signal);
    let mediaUrl = url;

    if (text.includes('#EXT-X-STREAM-INF')) {
      const best = parseMaster(text, url);
      if (!best) throw new Error('No variant found in master playlist');
      mediaUrl = best.url;
      text = await fetchText(mediaUrl, signal);
    }

    const { initUrl, segments, fmp4 } = parseMedia(text, mediaUrl);
    if (!segments.length) throw new Error('No segments in playlist');

    const urls = initUrl ? [initUrl, ...segments] : segments;
    const parts = await fetchSegments(urls, { onProgress, signal });
    const joined = concat(parts);

    if (fmp4) return { blob: new Blob([joined], { type: 'video/mp4' }), ext: '.mp4' };

    // MPEG-TS: transmux to a browser-friendly MP4, falling back to raw .ts.
    try {
      const mp4 = await transmuxTsToMp4(joined);
      return { blob: new Blob([mp4], { type: 'video/mp4' }), ext: '.mp4' };
    } catch {
      return { blob: new Blob([joined], { type: 'video/mp2t' }), ext: '.ts' };
    }
  }

  const isHls = (u) => /\.m3u8(?:$|\?)/i.test(u || '');

  return { download, isHls };
})();
