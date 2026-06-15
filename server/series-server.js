'use strict';
const { json, readBody } = require('./helpers-server');
const { loadSeries, upsertSeries, deleteSeries } = require('./db-server');

function apiGetSeries(req, res) {
  json(res, { series: loadSeries() });
}

async function apiUpsertSeries(req, res) {
  const body = await readBody(req);
  const { name, key, cover, episodes } = body;
  if (!name || typeof name !== 'string') return json(res, { error: 'name required' }, 400);
  if (!key || typeof key !== 'string') return json(res, { error: 'key required' }, 400);
  upsertSeries({ key, name, cover: cover || '', episodes: episodes || [] });
  json(res, { ok: true });
}

function apiDeleteSeries(req, res, key) {
  deleteSeries(decodeURIComponent(key));
  json(res, { ok: true });
}

function apiExportSeries(req, res) {
  const data = loadSeries();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="series.json"');
  res.end(JSON.stringify(data, null, 2));
}

async function apiImportSeries(req, res) {
  const body = await readBody(req);
  if (!Array.isArray(body)) return json(res, { error: 'Expected array' }, 400);
  let count = 0;
  for (const s of body) {
    if (!s.key || !s.name) continue;
    upsertSeries(s);
    count++;
  }
  json(res, { ok: true, count });
}

module.exports = { apiGetSeries, apiUpsertSeries, apiDeleteSeries, apiExportSeries, apiImportSeries };
