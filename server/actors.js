'use strict';
// ═══════════════════════════════════════════════════════════════════
//  actors.js — Actor listing, videos by actor, and photo scraping
// ═══════════════════════════════════════════════════════════════════

const fs    = require('fs');
const path  = require('path');
const http  = require('http');
const https = require('https');
const url   = require('url');
const { ACTOR_PHOTOS_DIR } = require('./config');
const { json, actorMatchesAny } = require('./helpers');
const { loadActors, loadVideoMeta, loadFavs } = require('./db');
const { allVideos } = require('./videos');

// ── Actor slug ───────────────────────────────────────────────────────

function actorSlug(name) { return name.toLowerCase().replace(/[^a-z0-9]/g, '_'); }

// ── HTTP helpers (used for IMDb photo scraping) ──────────────────────

function httpsGet(reqUrl, headers) {
  return new Promise((resolve, reject) => {
    const opts   = Object.assign(url.parse(reqUrl), { headers });
    const client = reqUrl.startsWith('https') ? https : http;
    client.get(opts, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return resolve(httpsGet(res.headers.location, headers));
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
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
  const UA         = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
  const q          = encodeURIComponent(actorName.toLowerCase());
  const firstChar  = actorName[0].toLowerCase().replace(/[^a-z]/, 'a');
  const suggestUrl = `https://v2.sg.media-imdb.com/suggests/${firstChar}/${q}.json`;
  const { body }   = await httpsGet(suggestUrl, { 'User-Agent': UA, 'Accept': '*/*', 'Referer': 'https://www.imdb.com/' });
  const match      = body.match(/\((\{[\s\S]*\})\)/);
  if (!match) return null;
  const parsed = JSON.parse(match[1]);
  for (const item of (parsed.d || [])) {
    if (item.id && item.id.startsWith('nm') && item.i && item.i.imageUrl)
      return item.i.imageUrl;
  }
  return null;
}

// ── Actor API handlers ───────────────────────────────────────────────

function apiActors(req, res) {
  const actors = loadActors();
  const videos = allVideos();
  const meta   = loadVideoMeta();
  const result = actors
    .map(e => ({
      name: e.name,
      count: videos.filter(v => {
        const ma = meta[v.id]?.actors || [];
        return ma.some(a => a.toLowerCase() === e.name.toLowerCase()) || actorMatchesAny(v.name, e.terms);
      }).length,
      nationality: e.nationality,
      age: e.age,
      deceased: e.deceased,
      imdb_page: e.imdb_page,
    }))
    .filter(a => a.count > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  json(res, result);
}

function apiActorVideos(req, res, actorName) {
  const actors = loadActors();
  const entry  = actors.find(e => e.name.toLowerCase() === actorName.toLowerCase());
  if (!entry) return json(res, { error: 'Not found' }, 404);
  const videos   = allVideos();
  const meta     = loadVideoMeta();
  const favs     = loadFavs();
  const actorLo  = entry.name.toLowerCase();
  const list     = videos
    .filter(v => {
      const ma = meta[v.id]?.actors || [];
      return ma.some(a => a.toLowerCase() === actorLo) || actorMatchesAny(v.name, entry.terms);
    })
    .map(v => ({ ...v, fav: favs.includes(v.id), rating: meta[v.id]?.rating ?? null }))
    .sort((a, b) => b.mtime - a.mtime);
  json(res, { actor: entry.name, videos: list });
}

// ── Actor photo API handlers ─────────────────────────────────────────

function apiActorPhotos(req, res) {
  if (!fs.existsSync(ACTOR_PHOTOS_DIR)) fs.mkdirSync(ACTOR_PHOTOS_DIR, { recursive: true });
  const actors = loadActors();
  json(res, actors.map(e => ({
    name: e.name,
    hasPhoto: fs.existsSync(path.join(ACTOR_PHOTOS_DIR, actorSlug(e.name) + '.jpg')),
  })));
}

async function apiActorPhotoScrape(req, res, actorName) {
  const actors = loadActors();
  const entry  = actors.find(e => e.name.toLowerCase() === actorName.toLowerCase());
  if (!entry) return json(res, { error: 'Actor not found in database' }, 404);
  if (!fs.existsSync(ACTOR_PHOTOS_DIR)) fs.mkdirSync(ACTOR_PHOTOS_DIR, { recursive: true });
  const destPath = path.join(ACTOR_PHOTOS_DIR, actorSlug(entry.name) + '.jpg');
  try {
    const imgUrl = await fetchImdbPhotoUrl(entry.name);
    if (!imgUrl) return json(res, { error: 'No photo found on IMDb for "' + entry.name + '"' }, 404);
    const out = fs.createWriteStream(destPath);
    const UA  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    await httpsGetStream(imgUrl, { 'User-Agent': UA, 'Referer': 'https://www.imdb.com/' }, out);
    json(res, { ok: true, name: entry.name });
  } catch (e) {
    try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch {}
    json(res, { error: e.message }, 500);
  }
}

function apiActorPhotoImg(req, res, actorName) {
  if (!fs.existsSync(ACTOR_PHOTOS_DIR)) { res.writeHead(404); res.end(); return; }
  const photoPath = path.join(ACTOR_PHOTOS_DIR, actorSlug(actorName) + '.jpg');
  if (!fs.existsSync(photoPath)) { res.writeHead(404); res.end(); return; }
  const stat = fs.statSync(photoPath);
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': stat.size, 'Cache-Control': 'public, max-age=86400' });
  fs.createReadStream(photoPath).pipe(res);
}

module.exports = {
  apiActors, apiActorVideos,
  apiActorPhotos, apiActorPhotoScrape, apiActorPhotoImg,
};
