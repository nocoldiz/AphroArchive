'use strict';
// ═══════════════════════════════════════════════════════════════════
//  collections.js — Collections CRUD API handlers
// ═══════════════════════════════════════════════════════════════════

const { json, readBody }               = require('./helpers-server');
const { loadCollections, saveCollections } = require('./db-server');
const { allVideos }                    = require('./videos-server');

function apiCollections(req, res) {
  const cols   = loadCollections();
  const videos = allVideos();
  const result = cols.map(col => ({
    name: col.name,
    ids: col.ids,
    count: col.ids.length,
    thumb: col.ids.map(id => videos.find(v => v.id === id)).find(v => v) || null,
  }));
  json(res, result);
}

async function apiCollectionCreate(req, res) {
  const data = await readBody(req);
  const name = (data.name || '').trim();
  if (!name) return json(res, { error: 'Name required' }, 400);
  const cols = loadCollections();
  if (cols.find(c => c.name === name)) return json(res, { error: 'Collection already exists' }, 400);
  cols.push({ name, ids: [] });
  saveCollections(cols);
  json(res, { ok: true, name });
}

async function apiCollectionDelete(req, res, name) {
  const cols = loadCollections();
  const i    = cols.findIndex(c => c.name === name);
  if (i === -1) return json(res, { error: 'Not found' }, 404);
  cols.splice(i, 1);
  saveCollections(cols);
  json(res, { ok: true });
}

async function apiCollectionAddVideo(req, res, name) {
  const data = await readBody(req);
  const id = (data.id || '').trim();
  if (!id) return json(res, { error: 'id required' }, 400);
  const cols = loadCollections();
  const col  = cols.find(c => c.name === name);
  if (!col) return json(res, { error: 'Collection not found' }, 404);
  if (!col.ids.includes(id)) col.ids.push(id);
  saveCollections(cols);
  json(res, { ok: true });
}

async function apiCollectionRemoveVideo(req, res, name, id) {
  const cols = loadCollections();
  const col  = cols.find(c => c.name === name);
  if (!col) return json(res, { error: 'Not found' }, 404);
  col.ids = col.ids.filter(i => i !== id);
  saveCollections(cols);
  json(res, { ok: true });
}

function apiCollectionVideos(req, res, name) {
  const cols   = loadCollections();
  const col    = cols.find(c => c.name === name);
  if (!col) return json(res, { error: 'Not found' }, 404);
  const videos = allVideos();
  json(res, col.ids.map(id => videos.find(v => v.id === id)).filter(Boolean));
}

module.exports = {
  apiCollections, apiCollectionCreate, apiCollectionDelete,
  apiCollectionAddVideo, apiCollectionRemoveVideo, apiCollectionVideos,
};
