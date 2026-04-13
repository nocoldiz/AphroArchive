'use strict';
// ═══════════════════════════════════════════════════════════════════
//  database.js — CRUD API for actors/categories/studios JSON files
//                and direct video file import from local paths
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { ACTORS_JSON, CATEGORIES_JSON, STUDIOS_JSON, VIDEOS_DIR, VIDEO_EXT } = require('./config');
const { invalidateScanCache } = require('./videos');
const { json, readBody }                      = require('./helpers');
const { readDbFile, writeDbFile, loadWebsites, saveWebsites, invalidateDbTypeCache } = require('./db');

const DB_FILES = { actors: ACTORS_JSON, categories: CATEGORIES_JSON, studios: STUDIOS_JSON };

function apiDbGet(req, res, type) {
  if (type === 'websites') {
    const sites = loadWebsites();
    const obj = {};
    sites.forEach(s => { obj[s.name || s.url] = s; });
    return json(res, obj);
  }
  if (!DB_FILES[type]) return json(res, { error: 'Unknown type' }, 400);
  json(res, readDbFile(DB_FILES[type]));
}

async function apiDbUpsert(req, res, type) {
  if (type === 'websites') {
    const body = await readBody(req);
    const { name, data } = body;
    if (!name || typeof name !== 'string') return json(res, { error: 'Name required' }, 400);
    const sites = loadWebsites();
    const idx   = sites.findIndex(s => (s.name || s.url) === name);
    const entry = { name, url: data.url || '', searchURL: data.searchURL || '', scrapeMethod: data.scrapeMethod || '', tags: data.tags || [], description: data.description || '' };
    if (idx >= 0) sites[idx] = entry; else sites.push(entry);
    saveWebsites(sites);
    return json(res, { ok: true });
  }
  if (!DB_FILES[type]) return json(res, { error: 'Unknown type' }, 400);
  const body = await readBody(req);
  const { name, data } = body;
  if (!name || typeof name !== 'string') return json(res, { error: 'Name required' }, 400);
  const db   = readDbFile(DB_FILES[type]);
  db[name]   = data || {};
  writeDbFile(DB_FILES[type], db);
  invalidateDbTypeCache(type);
  json(res, { ok: true });
}

async function apiDbDelete(req, res, type, name) {
  if (type === 'websites') {
    const sites = loadWebsites().filter(s => (s.name || s.url) !== name);
    saveWebsites(sites);
    return json(res, { ok: true });
  }
  if (!DB_FILES[type]) return json(res, { error: 'Unknown type' }, 400);
  const db = readDbFile(DB_FILES[type]);
  delete db[name];
  writeDbFile(DB_FILES[type], db);
  invalidateDbTypeCache(type);
  json(res, { ok: true });
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
