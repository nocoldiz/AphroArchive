'use strict';
// ═══════════════════════════════════════════════════════════════════
//  actors.js — Actor listing, videos by actor, and photo scraping
// ═══════════════════════════════════════════════════════════════════

const fs    = require('fs');
const path  = require('path');
const http  = require('http');
const https = require('https');
const url   = require('url');
const { ACTOR_PHOTOS_DIR, ACTORS_JSON } = require('./config-server');
const { json, actorMatchesAny, toId } = require('./helpers-server');
const { loadActors, loadVideoMeta, loadFavs } = require('./db-server');
const { allVideos } = require('./videos-server');

// ── Actor slug ───────────────────────────────────────────────────────

function actorSlug(name) { return name.toLowerCase().replace(/[^a-z0-9]/g, '_'); }

// ── HTTP helpers (used for IMDb photo scraping) ──────────────────────

function httpsGet(reqUrl, headers) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(reqUrl);
    const client = reqUrl.startsWith('https') ? https : http;
    client.get(urlObj, { headers }, res => {
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
    const urlObj = new URL(reqUrl);
    const client = reqUrl.startsWith('https') ? https : http;
    client.get(urlObj, { headers }, res => {
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

async function apiActors(req, res) {
  const actors = loadActors();
  const videos = await allVideos();
  const meta   = loadVideoMeta();
  const result = actors
    .map(e => {
      const matchingVideos = videos.filter(v => {
        const ma = meta[v.id]?.actors || [];
        return ma.some(a => a.toLowerCase() === e.name.toLowerCase()) || actorMatchesAny(v.name, e.terms);
      });
      return {
        name: e.name,
        count: matchingVideos.length,
        duration: matchingVideos.reduce((sum, v) => sum + (v.duration || 0), 0),
        nationality: e.nationality,
        age: e.age,
        deceased: e.deceased,
        imdb_page: e.imdb_page,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  json(res, result);
}

async function apiActorVideos(req, res, actorName) {
  const actors = loadActors();
  const entry  = actors.find(e => e.name.toLowerCase() === actorName.toLowerCase());
  if (!entry) return json(res, { error: 'Not found' }, 404);
  const videos   = await allVideos();
  const meta     = loadVideoMeta();
  const favs     = loadFavs();
  const actorLo  = entry.name.toLowerCase();

  const parsed = require('url').parse(req.url, true);
  const fav    = (parsed.query.fav === '1' || parsed.query.fav === 'true');

  let list = videos
    .filter(v => {
      const ma = meta[v.id]?.actors || [];
      return ma.some(a => a.toLowerCase() === actorLo) || actorMatchesAny(v.name, entry.terms);
    })
    .map(v => ({ ...v, fav: favs.includes(v.id), rating: meta[v.id]?.rating ?? null }));

  if (fav) list = list.filter(v => v.fav);

  list.sort((a, b) => b.mtime - a.mtime);

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

async function apiActorPhotoImg(req, res, actorName) {
  if (fs.existsSync(ACTOR_PHOTOS_DIR)) {
    const photoPath = path.join(ACTOR_PHOTOS_DIR, actorSlug(actorName) + '.jpg');
    if (fs.existsSync(photoPath)) {
      const stat = fs.statSync(photoPath);
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': stat.size, 'Cache-Control': 'public, max-age=86400' });
      fs.createReadStream(photoPath).pipe(res);
      return;
    }
  }
  // fall back to first video thumbnail for this actor (deterministic)
  const actors = loadActors();
  const entry  = actors.find(e => e.name.toLowerCase() === actorName.toLowerCase());
  if (entry) {
    const actorLo = entry.name.toLowerCase();
    const videos  = (await allVideos()).filter(v => actorMatchesAny(v.name, [actorLo])).sort((a, b) => a.name.localeCompare(b.name));
    if (videos.length) {
      res.writeHead(302, { Location: '/api/thumbs/' + videos[0].id + '/0' });
      res.end();
      return;
    }
  }
  res.writeHead(404); res.end();
}

async function scrapeActorInfo(actorName) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
  const q = encodeURIComponent(actorName.toLowerCase());
  const firstChar = actorName[0].toLowerCase().replace(/[^a-z]/, 'a');
  const suggestUrl = `https://v2.sg.media-imdb.com/suggests/${firstChar}/${q}.json`;
  
  try {
    const { body } = await httpsGet(suggestUrl, { 'User-Agent': UA, 'Accept': '*/*', 'Referer': 'https://www.imdb.com/' });
    const match = body.match(/\((\{[\s\S]*\})\)/);
    if (!match) return null;
    const parsed = JSON.parse(match[1]);
    
    let imdbId = null;
    let imageUrl = null;
    
    for (const item of (parsed.d || [])) {
      if (item.id && item.id.startsWith('nm')) {
        imdbId = item.id;
        if (item.i && item.i.imageUrl) imageUrl = item.i.imageUrl;
        break;
      }
    }
    
    if (!imdbId) return null;
    
    const actorUrl = `https://www.imdb.com/name/${imdbId}/`;
    const { body: html } = await httpsGet(actorUrl, { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' });
    
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    let info = {};
    
    if (jsonLdMatch) {
      try {
        const data = JSON.parse(jsonLdMatch[1]);
        info.name = data.name;
        info.birthDate = data.birthDate;
        info.deathDate = data.deathDate;
        info.description = data.description;
        if (data.image) imageUrl = data.image;
      } catch (e) {
        console.error('Failed to parse JSON-LD for actor', actorName, e);
      }
    }
    
    return {
      imdbId,
      imageUrl,
      ...info
    };
  } catch (e) {
    console.error('Failed to scrape actor info for', actorName, e);
    return null;
  }
}

async function scrapeAndSaveActorInfo(actorName) {
  const info = await scrapeActorInfo(actorName);
  if (!info) return false;
  
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(ACTORS_JSON, 'utf-8')); } catch (e) {}
  
  if (!raw[actorName]) raw[actorName] = {};
  
  if (info.birthDate) raw[actorName].date_of_birth = info.birthDate;
  if (info.imdbId) raw[actorName].imdb_page = `https://www.imdb.com/name/${info.imdbId}/`;
  if (info.description) raw[actorName].bio = info.description;
  
  fs.writeFileSync(ACTORS_JSON, JSON.stringify(raw, null, 2));
  
  const { invalidateDbTypeCache } = require('./db-server');
  invalidateDbTypeCache('actors');
  
  if (info.imageUrl) {
    const destPath = path.join(ACTOR_PHOTOS_DIR, actorName.toLowerCase().replace(/[^a-z0-9]/g, '_') + '.jpg');
    if (!fs.existsSync(destPath)) {
      try {
        const out = fs.createWriteStream(destPath);
        const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
        await httpsGetStream(info.imageUrl, { 'User-Agent': UA, 'Referer': 'https://www.imdb.com/' }, out);
      } catch (e) {
        console.error('Failed to download actor photo', e);
      }
    }
  }
  
  return true;
}

async function apiActorsScrapeMissing(req, res) {
  const { loadActors } = require('./db-server');
  const actors = loadActors();
  const missing = actors.filter(actor => actor.age === null && !actor.nationality && !actor.imdb_page);
  
  if (missing.length === 0) return json(res, { ok: true, message: 'No actors missing info' });
  
  (async () => {
    console.log(`Starting background scraping for ${missing.length} actors`);
    for (const actor of missing) {
      console.log(`Scraping info for ${actor.name}`);
      await scrapeAndSaveActorInfo(actor.name);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    console.log('Finished background scraping for actors');
  })();
  
  json(res, { ok: true, count: missing.length });
}

module.exports = {
  apiActors, apiActorVideos,
  apiActorPhotos, apiActorPhotoScrape, apiActorPhotoImg,
  scrapeAndSaveActorInfo, scrapeActorInfo, apiActorsScrapeMissing
};
