'use strict';
const { json, readBody } = require('./helpers-server');
const { loadAlbums, upsertAlbum, deleteAlbum } = require('./db-server');

function apiGetAlbums(req, res) {
  json(res, { albums: loadAlbums() });
}

async function apiUpsertAlbum(req, res) {
  const body = await readBody(req);
  const { id, name, artist, year, cover, tracks } = body;
  if (!id || typeof id !== 'string') return json(res, { error: 'id required' }, 400);
  if (!name || typeof name !== 'string') return json(res, { error: 'name required' }, 400);
  upsertAlbum({ id, name, artist: artist || '', year: year || null, cover: cover || '', tracks: tracks || [] });
  json(res, { ok: true });
}

function apiDeleteAlbum(req, res, id) {
  deleteAlbum(decodeURIComponent(id));
  json(res, { ok: true });
}

function apiExportAlbums(req, res) {
  const data = loadAlbums();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="albums.json"');
  res.end(JSON.stringify(data, null, 2));
}

async function apiImportAlbums(req, res) {
  const body = await readBody(req);
  if (!Array.isArray(body)) return json(res, { error: 'Expected array' }, 400);
  let count = 0;
  for (const a of body) {
    if (!a.id || !a.name) continue;
    upsertAlbum(a);
    count++;
  }
  json(res, { ok: true, count });
}

module.exports = { apiGetAlbums, apiUpsertAlbum, apiDeleteAlbum, apiExportAlbums, apiImportAlbums };
