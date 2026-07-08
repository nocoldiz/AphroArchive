'use strict';
// ═══════════════════════════════════════════════════════════════════
//  playlists-server.js — Playlists CRUD API handlers
// ═══════════════════════════════════════════════════════════════════

const { json, jsonError, readBody, validateBody } = require('./helpers-server');
const { loadPlaylists, savePlaylists } = require('./db-server');
const { allVideos }                    = require('./videos-server');

async function apiPlaylists(req, res) {
  const pls    = loadPlaylists();
  const videos = await allVideos();
  const byId   = new Map(videos.map(v => [v.id, v]));
  const result = pls.map(pl => ({
    name: pl.name,
    ids: pl.ids || [],
    count: (pl.ids || []).length,
    thumb: (pl.ids || []).map(id => byId.get(id)).find(v => v) || null,
  }));
  json(res, result);
}

async function apiPlaylistCreate(req, res) {
  const data = await readBody(req);
  const v = validateBody(data, { name: { required: true, type: 'string' } });
  if (!v.ok) return jsonError(res, v.error);
  const name = v.value.name;
  const pls = loadPlaylists();
  if (pls.find(c => c.name === name)) return json(res, { error: 'Playlist already exists' }, 400);
  pls.push({ name, ids: [] });
  savePlaylists(pls);
  json(res, { ok: true, name });
}

async function apiPlaylistDelete(req, res, name) {
  const pls = loadPlaylists();
  const i   = pls.findIndex(c => c.name === name);
  if (i === -1) return json(res, { error: 'Not found' }, 404);
  pls.splice(i, 1);
  savePlaylists(pls);
  json(res, { ok: true });
}

async function apiPlaylistDeleteAll(req, res) {
  const count = loadPlaylists().length;
  savePlaylists([]);
  json(res, { ok: true, deleted: count });
}

async function apiPlaylistAddVideo(req, res, name) {
  const data = await readBody(req);
  const id = (data.id || '').trim();
  if (!id) return json(res, { error: 'id required' }, 400);
  const pls = loadPlaylists();
  const pl  = pls.find(c => c.name === name);
  if (!pl) return json(res, { error: 'Playlist not found' }, 404);
  if (!pl.ids.includes(id)) pl.ids.push(id);
  savePlaylists(pls);
  json(res, { ok: true });
}

async function apiPlaylistRemoveVideo(req, res, name, id) {
  const pls = loadPlaylists();
  const pl  = pls.find(c => c.name === name);
  if (!pl) return json(res, { error: 'Not found' }, 404);
  pl.ids = pl.ids.filter(i => i !== id);
  savePlaylists(pls);
  json(res, { ok: true });
}

async function apiPlaylistVideos(req, res, name) {
  const pls    = loadPlaylists();
  const pl     = pls.find(c => c.name === name);
  if (!pl) return json(res, { error: 'Not found' }, 404);
  const videos = await allVideos();
  const byId   = new Map(videos.map(v => [v.id, v]));
  const favs   = new Set(require('./db-server').loadFavs());

  const q   = new URL(req.url, 'http://localhost').searchParams;
  const fav = (q.get('fav') === '1' || q.get('fav') === 'true');

  let list = pl.ids.map(id => {
    const v = byId.get(id);
    if (!v) return null;
    return { ...v, fav: favs.has(v.id) };
  }).filter(Boolean);

  if (fav) list = list.filter(v => v.fav);

  json(res, list);
}

module.exports = {
  apiPlaylists, apiPlaylistCreate, apiPlaylistDelete, apiPlaylistDeleteAll,
  apiPlaylistAddVideo, apiPlaylistRemoveVideo, apiPlaylistVideos,
};
