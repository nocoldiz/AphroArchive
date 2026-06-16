'use strict';
// ═══════════════════════════════════════════════════════════════════
//  search-server.js — full-text search & autocomplete suggestions
//                     backed by the SQLite FTS5 index (db-server.js)
// ═══════════════════════════════════════════════════════════════════

const { json } = require('./helpers-server');
const db = require('./db-server');

// GET /api/search/suggest?q=&limit=
// Grouped autocomplete suggestions (titles, actors, tags, folders) for the
// search box, drawn from the FTS5 index and the metadata tables.
function apiSearchSuggest(req, res, params) {
  const q = (params.get('q') || '').trim();
  let limit = parseInt(params.get('limit') || '8', 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 8;
  limit = Math.min(limit, 20);
  if (!q) return json(res, { titles: [], actors: [], tags: [], folders: [] });
  try {
    json(res, db.suggestSearch(q, limit));
  } catch (e) {
    console.error('[search] suggest failed:', e.message);
    json(res, { titles: [], actors: [], tags: [], folders: [] });
  }
}

// GET /api/search?q=&limit=
// Full-text search across video metadata; returns ranked video ids.
function apiSearch(req, res, params) {
  const q = (params.get('q') || '').trim();
  let limit = parseInt(params.get('limit') || '1000', 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 1000;
  limit = Math.min(limit, 5000);
  if (!q) return json(res, { ids: [] });
  try {
    const ids = db.searchVideosFts(q, limit) || [];
    json(res, { ids });
  } catch (e) {
    console.error('[search] fts query failed:', e.message);
    json(res, { ids: [] });
  }
}

module.exports = { apiSearchSuggest, apiSearch };
