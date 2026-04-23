'use strict';
// ═══════════════════════════════════════════════════════════════════
//  presets.js — DB preset system: list, preview, apply presets
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { DB_DIR, ACTORS_JSON, CATEGORIES_JSON, STUDIOS_JSON, WEBSITES_JSON } = require('./config-server');
const { json, readBody } = require('./helpers-server');

const PRESETS_DIR = path.join(DB_DIR, 'presets');

// DB is considered initialised if categories.json exists
function isDbInitialized() {
  return fs.existsSync(CATEGORIES_JSON);
}

function listPresets() {
  if (!fs.existsSync(PRESETS_DIR)) return [];
  return fs.readdirSync(PRESETS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const dir = path.join(PRESETS_DIR, d.name);
      let name = d.name, description = '';
      try {
        // meta.json may have unquoted keys — use a lenient parse
        const raw = fs.readFileSync(path.join(dir, 'meta.json'), 'utf-8')
          .replace(/^\s*([a-zA-Z_]\w*)\s*:/gm, '"$1":'); // quote bare keys
        const parsed = JSON.parse(raw);
        name        = parsed.title       || d.name;
        description = parsed.description || '';
      } catch {}
      // Count entries in each file for the preview
      const count = (file) => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
          return Array.isArray(data) ? data.length : Object.keys(data).length;
        } catch { return 0; }
      };
      return {
        id: d.name,
        name,
        description,
        counts: {
          actors:     count('actors.json'),
          categories: count('categories.json'),
          studios:    count('studios.json'),
          websites:   count('websites.json'),
        },
      };
    });
}

function loadPresetData(id) {
  const dir = path.join(PRESETS_DIR, id);
  const result = { actors: {}, categories: {}, studios: {}, websites: [] };
  const tryLoad = (file) => { try { return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')); } catch { return null; } };
  const a = tryLoad('actors.json');     if (a && !Array.isArray(a)) Object.assign(result.actors, a);
  const c = tryLoad('categories.json'); if (c && !Array.isArray(c)) Object.assign(result.categories, c);
  const s = tryLoad('studios.json');    if (s && !Array.isArray(s)) Object.assign(result.studios, s);
  const w = tryLoad('websites.json');   if (Array.isArray(w)) result.websites = w;
  return result;
}

function mergePresets(ids) {
  const merged = { actors: {}, categories: {}, studios: {}, websites: [] };
  const seenUrls = new Set();
  for (const id of ids) {
    const data = loadPresetData(id);
    Object.assign(merged.actors,     data.actors);
    Object.assign(merged.categories, data.categories);
    Object.assign(merged.studios,    data.studios);
    for (const site of data.websites) {
      if (!site.url || seenUrls.has(site.url)) continue;
      seenUrls.add(site.url);
      merged.websites.push(site);
    }
  }
  return merged;
}

function readExistingDb() {
  const tryObj  = (f) => { try { const d = JSON.parse(fs.readFileSync(f, 'utf-8')); return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {}; } catch { return {}; } };
  const tryArr  = (f) => { try { const d = JSON.parse(fs.readFileSync(f, 'utf-8')); return Array.isArray(d) ? d : []; } catch { return []; } };
  return {
    actors:     tryObj(ACTORS_JSON),
    categories: tryObj(CATEGORIES_JSON),
    studios:    tryObj(STUDIOS_JSON),
    websites:   tryArr(WEBSITES_JSON),
  };
}

function writeDb(merged, mergeWithExisting = false) {
  fs.mkdirSync(DB_DIR, { recursive: true });
  let data = merged;
  if (mergeWithExisting) {
    const existing = readExistingDb();
    const seenUrls = new Set(existing.websites.map(w => w.url).filter(Boolean));
    const extraSites = merged.websites.filter(w => w.url && !seenUrls.has(w.url));
    data = {
      actors:     Object.assign({}, merged.actors,     existing.actors),
      categories: Object.assign({}, merged.categories, existing.categories),
      studios:    Object.assign({}, merged.studios,    existing.studios),
      websites:   [...existing.websites, ...extraSites],
    };
  }
  fs.writeFileSync(ACTORS_JSON,     JSON.stringify(data.actors,     null, 2));
  fs.writeFileSync(CATEGORIES_JSON, JSON.stringify(data.categories, null, 2));
  fs.writeFileSync(STUDIOS_JSON,    JSON.stringify(data.studios,    null, 2));
  fs.writeFileSync(WEBSITES_JSON,   JSON.stringify(data.websites,   null, 2));
}

// GET /api/presets
function apiGetPresets(req, res) {
  json(res, { needed: !isDbInitialized(), presets: listPresets() });
}

// POST /api/presets/apply  { selection: 'blank' | 'all' | ['id',...], merge?: boolean }
async function apiApplyPreset(req, res) {
  const body = await readBody(req);
  const { selection, merge } = body;

  let merged;
  if (selection === 'blank') {
    merged = { actors: {}, categories: {}, studios: {}, websites: [] };
  } else if (selection === 'all') {
    merged = mergePresets(listPresets().map(p => p.id));
  } else if (Array.isArray(selection) && selection.length > 0) {
    merged = mergePresets(selection);
  } else {
    return json(res, { error: 'Invalid selection' }, 400);
  }

  writeDb(merged, !!merge);

  // Bust in-memory caches
  const db = require('./db-server');
  db.invalidateDbTypeCache('actors');
  db.invalidateDbTypeCache('categories');
  db.invalidateDbTypeCache('studios');

  json(res, { ok: true });
}

module.exports = { apiGetPresets, apiApplyPreset, isDbInitialized };
