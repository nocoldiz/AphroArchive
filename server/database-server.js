'use strict';
// ═══════════════════════════════════════════════════════════════════
//  database.js — CRUD API for actors/categories/studios JSON files
//                and direct video file import from local paths
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { VIDEOS_DIR, VIDEO_EXT } = require('./config-server');
const { invalidateScanCache } = require('./videos-server');
const { json, readBody } = require('./helpers-server');
const {
  loadActors, saveActors,
  loadWebsites, saveWebsites,
  loadCategories, saveCategories,
  loadStudios, saveStudios,
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
    const cats = loadCategories();
    const obj = {};
    cats.forEach(c => { obj[c.name] = { displayName: c.displayName, tags: c.terms.slice(1) }; });
    return json(res, obj);
  }
  if (type === 'studios') {
    const studios = loadStudios();
    const obj = {};
    studios.forEach(s => { obj[s.name] = { website: s.website, short_description: s.description }; });
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
    const cats = loadCategories();
    const raw = {};
    cats.forEach(c => { raw[c.name] = { displayName: c.displayName, tags: c.terms.slice(1) }; });
    raw[name] = data || {};
    saveCategories(raw);
    invalidateDbTypeCache(type);
    return json(res, { ok: true });
  }
  if (type === 'studios') {
    const studios = loadStudios();
    const raw = {};
    studios.forEach(s => { raw[s.name] = { website: s.website, short_description: s.description }; });
    raw[name] = data || {};
    saveStudios(raw);
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
    const cats = loadCategories();
    const raw = {};
    cats.forEach(c => { raw[c.name] = { displayName: c.displayName, tags: c.terms.slice(1) }; });
    delete raw[name];
    saveCategories(raw);
    invalidateDbTypeCache(type);
    return json(res, { ok: true });
  }
  if (type === 'studios') {
    const studios = loadStudios();
    const raw = {};
    studios.forEach(s => { raw[s.name] = { website: s.website, short_description: s.description }; });
    delete raw[name];
    saveStudios(raw);
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

module.exports = { apiDbGet, apiDbUpsert, apiDbDelete, apiDbImport };
