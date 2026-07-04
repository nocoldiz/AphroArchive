'use strict';
// ═══════════════════════════════════════════════════════════════════
//  presets.js — DB preset system: list, preview, apply presets
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { DB_DIR, PRESETS_DIR } = require('./config-server');
const { json, readBody } = require('./helpers-server');

const PROFILES_DIR = PRESETS_DIR;
const SETUP_DONE_FILE = path.join(DB_DIR, 'setup.done');

// Read a UTF-8 file, stripping a leading BOM (several preset files were saved
// with one, which makes JSON.parse throw).
function readText(fp) {
  return fs.readFileSync(fp, 'utf-8').replace(/^﻿/, '');
}

function markSetupDone() {
  try { fs.mkdirSync(DB_DIR, { recursive: true }); } catch {}
  try { fs.writeFileSync(SETUP_DONE_FILE, '', 'utf-8'); } catch {}
}

function isDbInitialized() {
  // Primary: check whether the DB file has been written to disk
  if (fs.existsSync(path.join(DB_DIR, 'db.db'))) return true;
  // Fallback: setup.done covers legacy installs
  return fs.existsSync(SETUP_DONE_FILE);
}

function listProfileTemplates() {
  if (!fs.existsSync(PROFILES_DIR)) return [];
  return fs.readdirSync(PROFILES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const dir = path.join(PROFILES_DIR, d.name);
      let name = d.name, description = '';
      try {
        // meta.json may have unquoted keys — use a lenient parse
        const raw = readText(path.join(dir, 'meta.json'))
          .replace(/^\s*([a-zA-Z_]\w*)\s*:/gm, '"$1":'); // quote bare keys
        const parsed = JSON.parse(raw);
        name        = parsed.title       || d.name;
        description = parsed.description || '';
      } catch {}
      // Count entries in each file for the preview
      const count = (file) => {
        try {
          const data = JSON.parse(readText(path.join(dir, file)));
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
          channels:    count('channels.json'),
          websites:   count('websites.json'),
          series:     count('series.json'),
          albums:     count('albums.json'),
          links:      count('links.json'),
        },
      };
    });
}

function loadPresetData(id) {
  const dir = path.join(PROFILES_DIR, id);
  const result = { actors: {}, categories: {}, channels: {}, websites: [], series: [], albums: [], links: [] };
  const tryLoad = (file) => { try { return JSON.parse(readText(path.join(dir, file))); } catch { return null; } };
  const a = tryLoad('actors.json');     if (a && !Array.isArray(a)) Object.assign(result.actors, a);
  const c = tryLoad('categories.json'); if (c && !Array.isArray(c)) Object.assign(result.categories, c);
  const s = tryLoad('channels.json');    if (s && !Array.isArray(s)) Object.assign(result.channels, s);
  const w = tryLoad('websites.json');   if (Array.isArray(w)) result.websites = w;
  const se = tryLoad('series.json');    if (Array.isArray(se)) result.series = se;
  const al = tryLoad('albums.json');    if (Array.isArray(al)) result.albums = al;
  const lk = tryLoad('links.json');     if (Array.isArray(lk)) result.links = lk;
  return result;
}

// Import up to `limit` curated links from a preset into the active profile DB.
// limit < 0 (or undefined) imports them all. Returns the number imported.
function importPresetLinks(id, limit) {
  const data = loadPresetData(id);
  const links = Array.isArray(data.links) ? data.links : [];
  if (!links.length) return 0;
  const n = (typeof limit === 'number' && limit >= 0) ? Math.min(limit, links.length) : links.length;
  const db = require('./db-server');
  let imported = 0;
  for (const lk of links.slice(0, n)) {
    if (!lk || !lk.url) continue;
    db.upsertLink({
      url: lk.url,
      title: lk.title || '',
      category: lk.category || '',
      img: lk.img || null,
      hasVideo: lk.hasVideo ?? true,
      tags: Array.isArray(lk.tags) ? lk.tags : [],
      addedAt: lk.addedAt || Date.now(),
    });
    imported++;
  }
  return imported;
}

function mergePresets(ids) {
  const merged = { actors: {}, categories: {}, channels: {}, websites: [], series: [], albums: [] };
  const seenUrls = new Set();
  const seenSeriesKeys = new Set();
  const seenAlbumIds = new Set();
  for (const id of ids) {
    const data = loadPresetData(id);
    Object.assign(merged.actors,     data.actors);
    Object.assign(merged.categories, data.categories);
    Object.assign(merged.channels,    data.channels);
    for (const site of data.websites) {
      if (!site.url || seenUrls.has(site.url)) continue;
      seenUrls.add(site.url);
      merged.websites.push(site);
    }
    for (const s of (data.series || [])) {
      if (!s.key || seenSeriesKeys.has(s.key)) continue;
      seenSeriesKeys.add(s.key);
      merged.series.push(s);
    }
    for (const al of (data.albums || [])) {
      if (!al.id || seenAlbumIds.has(al.id)) continue;
      seenAlbumIds.add(al.id);
      merged.albums.push(al);
    }
  }
  return merged;
}

function readExistingDb() {
  const db = require('./db-server');
  const actors = {};
  db.loadActors().forEach(a => { actors[a.name] = { date_of_birth: a.date_of_birth, nationality: a.nationality, imdb_page: a.imdb_page }; });
  const categories = {};
  db.loadFolderMappings().forEach(c => { categories[c.name] = { displayName: c.displayName, tags: c.terms.slice(1) }; });
  const channels = {};
  db.loadChannels().forEach(s => { channels[s.name] = { website: s.website, short_description: s.description, handle: s.handle, channel_id: s.channel_id, country: s.country, language: s.language, subscribers: s.subscribers, upload_schedule: s.upload_schedule, joined: s.joined, total_views: s.total_views, social_links: s.social_links }; });
  return { actors, categories, channels, websites: db.loadWebsites() };
}

function writeDb(merged, mergeWithExisting = false) {
  const db = require('./db-server');
  let data = merged;
  if (mergeWithExisting) {
    const existingCats = db.loadFolderMappings();
    const existingChannels = db.loadChannels();
    const existingWebsites = db.loadWebsites();
    
    const cats = { ...merged.categories };
    for (const c of existingCats) {
      if (!cats[c.name]) cats[c.name] = { displayName: c.displayName, tags: c.terms.slice(1) };
    }
    
    const channels = { ...merged.channels };
    for (const s of existingChannels) {
      if (!channels[s.name]) channels[s.name] = { website: s.website, short_description: s.description, handle: s.handle, channel_id: s.channel_id, country: s.country, language: s.language, subscribers: s.subscribers, upload_schedule: s.upload_schedule, joined: s.joined, total_views: s.total_views, social_links: s.social_links };
    }
    
    const seenUrls = new Set(existingWebsites.map(w => w.url).filter(Boolean));
    const websites = [...existingWebsites];
    for (const site of merged.websites) {
      if (site.url && !seenUrls.has(site.url)) {
        seenUrls.add(site.url);
        websites.push(site);
      }
    }
    
    data = {
      categories: cats,
      channels: channels,
      websites: websites,
      actors: merged.actors
    };
  }
  
  db.saveFolderMappings(data.categories);
  db.saveChannels(data.channels);
  db.saveWebsites(data.websites);
  db.saveActors(data.actors);
  if (Array.isArray(data.series) && data.series.length > 0) {
    if (mergeWithExisting) {
      for (const s of data.series) db.upsertSeries(s);
    } else {
      db.saveSeries(data.series);
    }
  }
  if (Array.isArray(data.albums) && data.albums.length > 0) {
    if (mergeWithExisting) {
      for (const a of data.albums) db.upsertAlbum(a);
    } else {
      db.saveAlbums(data.albums);
    }
  }
}

// GET /api/presets
function apiGetPresets(req, res) {
  const firstRun = !isDbInitialized();
  json(res, { needed: firstRun, firstRun, profiles: listProfileTemplates() });
}

// POST /api/presets/apply  { selection: 'blank' | 'all' | ['id',...], merge?: boolean }
async function apiApplyPreset(req, res) {
  const body = await readBody(req);
  const { selection, merge, importLinks, linkCount } = body;

  let merged;
  let presetIds = [];
  if (selection === 'blank') {
    merged = { actors: {}, categories: {}, channels: {}, websites: [] };
  } else if (selection === 'all') {
    presetIds = listProfileTemplates().map(p => p.id);
    merged = mergePresets(presetIds);
  } else if (Array.isArray(selection) && selection.length > 0) {
    presetIds = selection;
    merged = mergePresets(selection);
  } else {
    return json(res, { error: 'Invalid selection' }, 400);
  }

  const db = require('./db-server');
  // First run: promote in-memory DB to a real file before writing preset data
  if (!db.isDbOnDisk()) db.persistDbToDisk();

  writeDb(merged, !!merge);

  let linksImported = 0;
  if (importLinks && presetIds.length) {
    const perPreset = (typeof linkCount === 'number' && linkCount >= 0)
      ? Math.ceil(linkCount / presetIds.length) : -1;
    for (const id of presetIds) {
      if (perPreset === 0) break;
      linksImported += importPresetLinks(id, perPreset);
    }
  }

  markSetupDone();

  db.invalidateDbTypeCache('actors');
  db.invalidateDbTypeCache('categories');
  db.invalidateDbTypeCache('channels');

  json(res, { ok: true, linksImported });
}

module.exports = { apiGetPresets, apiApplyPreset, isDbInitialized };
