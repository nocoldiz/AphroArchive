'use strict';
// ═══════════════════════════════════════════════════════════════════
//  database.js — CRUD API for actors/categories/channels JSON files
//                and direct video file import from local paths
// ═══════════════════════════════════════════════════════════════════

function channelToJson(s) {
  return {
    website: s.website || null,
    short_description: s.description || null,
    handle: s.handle || null,
    channel_id: s.channel_id || null,
    country: s.country || null,
    language: s.language || null,
    subscribers: s.subscribers || null,
    upload_schedule: s.upload_schedule || null,
    joined: s.joined || null,
    total_views: s.total_views || null,
    social_links: s.social_links || null,
  };
}

const fs   = require('fs');
const path = require('path');
const { VIDEOS_DIR, VIDEO_EXT } = require('./config-server');
const { invalidateScanCache } = require('./videos-server');
const { json, readBody } = require('./helpers-server');
const {
  loadActors, saveActors,
  loadWebsites, saveWebsites,
  loadFolderMappings, saveFolderMappings,
  loadChannels, saveChannels,
  invalidateDbTypeCache,
} = require('./db-server');

function apiDbGet(req, res, type) {
  if (type === 'websites') {
    const sites = loadWebsites();
    const obj = {};
    sites.forEach(s => { obj[s.name || s.url] = s; });
    return json(res, obj);
  }
  if (type === 'categories') {
    const cats = loadFolderMappings();
    const obj = {};
    cats.forEach(c => { obj[c.name] = { displayName: c.displayName, tags: c.terms.slice(1) }; });
    return json(res, obj);
  }
  if (type === 'channels') {
    const channels = loadChannels();
    const obj = {};
    channels.forEach(s => { obj[s.name] = channelToJson(s); });
    return json(res, obj);
  }
  if (type === 'actors') {
    const actors = loadActors();
    const obj = {};
    actors.forEach(a => { obj[a.name] = { nationality: a.nationality, imdb_page: a.imdb_page }; });
    return json(res, obj);
  }
  return json(res, { error: 'Unknown type' }, 400);
}

async function apiDbUpsert(req, res, type) {
  const body = await readBody(req);
  const { name, data, oldName } = body;
  if (!name || typeof name !== 'string') return json(res, { error: 'Name required' }, 400);

  if (type === 'websites') {
    const sites = loadWebsites();
    const searchName = (oldName && typeof oldName === 'string') ? oldName : name;
    const idx   = sites.findIndex(s => (s.name || s.url) === searchName);
    const entry = { name, url: data.url || '', searchURL: data.searchURL || '', scrapeMethod: data.scrapeMethod || '', tags: data.tags || [], description: data.description || '' };
    if (idx >= 0) sites[idx] = entry; else sites.push(entry);
    saveWebsites(sites);
    return json(res, { ok: true });
  }
  if (type === 'categories') {
    const cats = loadFolderMappings();
    const raw = {};
    cats.forEach(c => { raw[c.name] = { displayName: c.displayName, tags: c.terms.slice(1) }; });
    raw[name] = data || {};
    saveFolderMappings(raw);
    invalidateDbTypeCache(type);
    return json(res, { ok: true });
  }
  if (type === 'channels') {
    const channels = loadChannels();
    const raw = {};
    channels.forEach(s => { raw[s.name] = channelToJson(s); });
    raw[name] = data || {};
    saveChannels(raw);
    invalidateDbTypeCache(type);
    return json(res, { ok: true });
  }
  if (type === 'actors') {
    const actors = loadActors();
    const raw = {};
    actors.forEach(a => { raw[a.name] = { date_of_birth: null, nationality: a.nationality, imdb_page: a.imdb_page }; });
    raw[name] = data || {};
    saveActors(raw);
    invalidateDbTypeCache(type);
    return json(res, { ok: true });
  }
  return json(res, { error: 'Unknown type' }, 400);
}

async function apiDbDelete(req, res, type, name) {
  if (type === 'websites') {
    const sites = loadWebsites().filter(s => (s.name || s.url) !== name);
    saveWebsites(sites);
    return json(res, { ok: true });
  }
  if (type === 'categories') {
    const cats = loadFolderMappings();
    const raw = {};
    cats.forEach(c => { raw[c.name] = { displayName: c.displayName, tags: c.terms.slice(1) }; });
    delete raw[name];
    saveFolderMappings(raw);
    invalidateDbTypeCache(type);
    return json(res, { ok: true });
  }
  if (type === 'channels') {
    const channels = loadChannels();
    const raw = {};
    channels.forEach(s => { raw[s.name] = channelToJson(s); });
    delete raw[name];
    saveChannels(raw);
    invalidateDbTypeCache(type);
    return json(res, { ok: true });
  }
  if (type === 'actors') {
    const actors = loadActors();
    const raw = {};
    actors.forEach(a => { raw[a.name] = { date_of_birth: null, nationality: a.nationality, imdb_page: a.imdb_page }; });
    delete raw[name];
    saveActors(raw);
    invalidateDbTypeCache(type);
    return json(res, { ok: true });
  }
  return json(res, { error: 'Unknown type' }, 400);
}

async function apiDbImport(req, res) {
  const body  = await readBody(req);
  const paths = Array.isArray(body.paths) ? body.paths.map(p => p.trim()).filter(Boolean) : [];
  if (!paths.length) return json(res, { error: 'No paths provided' }, 400);
  const results = [];
  for (const src of paths) {
    if (!fs.existsSync(src)) { results.push({ path: src, ok: false, error: 'Not found' }); continue; }
    const stat = fs.statSync(src);
    if (!stat.isFile()) { results.push({ path: src, ok: false, error: 'Not a file' }); continue; }
    const ext = path.extname(src).toLowerCase();
    if (!VIDEO_EXT.has(ext)) { results.push({ path: src, ok: false, error: 'Not a video file' }); continue; }
    const dst = path.join(VIDEOS_DIR, path.basename(src));
    try {
      if (fs.existsSync(dst)) { results.push({ path: src, ok: false, error: 'File already exists in destination' }); continue; }
      fs.copyFileSync(src, dst);
      invalidateScanCache();
      results.push({ path: src, ok: true });
    } catch (e) { results.push({ path: src, ok: false, error: e.message }); }
  }
  json(res, { results });
}

function apiGetFolderTags(req, res) {
  const url = new URL('http://x' + req.url);
  const folderPath = (url.searchParams.get('path') || '').trim();
  const cats = loadFolderMappings();
  const pathLo = folderPath.toLowerCase();
  const matched = cats.find(c =>
    (c.displayName || '').toLowerCase() === pathLo ||
    c.name.toLowerCase() === pathLo
  );
  if (!matched) return json(res, { found: false, name: folderPath, displayName: folderPath, tags: [] });
  json(res, { found: true, name: matched.name, displayName: matched.displayName, tags: matched.terms.slice(1) });
}

async function apiUpdateFolderTags(req, res) {
  const body = await readBody(req);
  const { folderPath, tags } = body;
  if (!folderPath || typeof folderPath !== 'string') return json(res, { error: 'folderPath required' }, 400);
  const cats = loadFolderMappings();
  const pathLo = folderPath.toLowerCase();
  const matched = cats.find(c =>
    (c.displayName || '').toLowerCase() === pathLo ||
    c.name.toLowerCase() === pathLo
  );
  const raw = {};
  cats.forEach(c => { raw[c.name] = { displayName: c.displayName, tags: c.terms.slice(1) }; });
  const cleanTags = Array.isArray(tags) ? tags.map(t => String(t).trim()).filter(Boolean) : [];
  if (matched) {
    raw[matched.name] = { displayName: matched.displayName, tags: cleanTags };
  } else {
    raw[folderPath] = { displayName: folderPath, tags: cleanTags };
  }
  saveFolderMappings(raw);
  invalidateDbTypeCache('categories');
  json(res, { ok: true });
}

function apiDbExportJson(req, res, type) {
  let data;
  if (type === 'actors') {
    const actors = loadActors();
    data = {};
    actors.forEach(a => { data[a.name] = { date_of_birth: a.date_of_birth || null, nationality: a.nationality || null, imdb_page: a.imdb_page || null }; });
  } else if (type === 'categories') {
    const cats = loadFolderMappings();
    data = {};
    cats.forEach(c => { data[c.name] = { displayName: c.displayName, tags: c.terms.slice(1) }; });
  } else if (type === 'channels') {
    const channels = loadChannels();
    data = {};
    channels.forEach(s => { data[s.name] = channelToJson(s); });
  } else if (type === 'websites') {
    data = loadWebsites();
  } else {
    return json(res, { error: 'Unknown type' }, 400);
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${type}.json"`);
  res.end(JSON.stringify(data, null, 2));
}

async function apiDbImportJson(req, res, type) {
  const body = await readBody(req);
  if (type === 'websites') {
    if (!Array.isArray(body)) return json(res, { error: 'Expected array' }, 400);
    const sites = loadWebsites();
    const existing = new Map(sites.map(s => [s.name || s.url, s]));
    for (const s of body) { existing.set(s.name || s.url, s); }
    saveWebsites(Array.from(existing.values()));
    return json(res, { ok: true, count: body.length });
  }
  if (typeof body !== 'object' || Array.isArray(body)) return json(res, { error: 'Expected object' }, 400);
  if (type === 'actors') {
    const actors = loadActors();
    const raw = {};
    actors.forEach(a => { raw[a.name] = { date_of_birth: a.date_of_birth, nationality: a.nationality, imdb_page: a.imdb_page }; });
    Object.assign(raw, body);
    saveActors(raw);
  } else if (type === 'categories') {
    const cats = loadFolderMappings();
    const raw = {};
    cats.forEach(c => { raw[c.name] = { displayName: c.displayName, tags: c.terms.slice(1) }; });
    Object.assign(raw, body);
    saveFolderMappings(raw);
  } else if (type === 'channels') {
    const channels = loadChannels();
    const raw = {};
    channels.forEach(s => { raw[s.name] = channelToJson(s); });
    Object.assign(raw, body);
    saveChannels(raw);
  } else {
    return json(res, { error: 'Unknown type' }, 400);
  }
  invalidateDbTypeCache(type);
  return json(res, { ok: true, count: Object.keys(body).length });
}

module.exports = { apiDbGet, apiDbUpsert, apiDbDelete, apiDbImport, apiGetFolderTags, apiUpdateFolderTags, apiDbExportJson, apiDbImportJson };
