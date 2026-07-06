'use strict';
// ═══════════════════════════════════════════════════════════════════
//  collections.js — Collections CRUD API handlers
// ═══════════════════════════════════════════════════════════════════

const { json, jsonError, readBody, validateBody } = require('./helpers-server');
const { loadCollections, saveCollections } = require('./db-server');
const { allVideos }                    = require('./videos-server');

async function apiCollections(req, res) {
  const cols   = loadCollections();
  const videos = await allVideos();
  const byId   = new Map(videos.map(v => [v.id, v]));
  const result = cols.map(col => ({
    name: col.name,
    ids: col.ids || [],
    count: (col.ids || []).length,
    thumb: (col.ids || []).map(id => byId.get(id)).find(v => v) || null,
  }));
  json(res, result);
}

async function apiCollectionCreate(req, res) {
  const data = await readBody(req);
  const v = validateBody(data, { name: { required: true, type: 'string' } });
  if (!v.ok) return jsonError(res, v.error);
  const name = v.value.name;
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

async function apiCollectionVideos(req, res, name) {
  const cols   = loadCollections();
  const col    = cols.find(c => c.name === name);
  if (!col) return json(res, { error: 'Not found' }, 404);
  const videos = await allVideos();
  const byId   = new Map(videos.map(v => [v.id, v]));
  const favs   = new Set(require('./db-server').loadFavs());

  const q   = new URL(req.url, 'http://localhost').searchParams;
  const fav = (q.get('fav') === '1' || q.get('fav') === 'true');

  let list = col.ids.map(id => {
    const v = byId.get(id);
    if (!v) return null;
    return { ...v, fav: favs.has(v.id) };
  }).filter(Boolean);

  if (fav) list = list.filter(v => v.fav);

  json(res, list);
}

module.exports = {
  apiCollections, apiCollectionCreate, apiCollectionDelete,
  apiCollectionAddVideo, apiCollectionRemoveVideo, apiCollectionVideos,
};
