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
  // Primary: check whether the default DB file has been written to disk
  if (fs.existsSync(path.join(DB_DIR, 'aphroarchive_default.db'))) return true;
  // Fallback: setup.done covers the profile-creation path and legacy installs
  return fs.existsSync(SETUP_DONE_FILE);
}

// Grandfather existing users: if they have a last-profile.txt or a Vault DB they've already set up
{
  if (!fs.existsSync(SETUP_DONE_FILE)) {
    const hasLastProfile = fs.existsSync(path.join(DB_DIR, 'last-profile.txt'));
    const hasVaultDb = fs.existsSync(path.join(DB_DIR, 'aphroarchive_Vault.db'));
    if (hasLastProfile || hasVaultDb) markSetupDone();
  }
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
      const folderTree = loadPresetFolders(d.name);
      const folderCount = folderTree
        ? Object.values(folderTree).reduce((n, subs) => n + 1 + (Array.isArray(subs) ? subs.length : 0), 0)
        : 0;
      return {
        id: d.name,
        name,
        description,
        hasFolders: !!folderTree,
        counts: {
          actors:     count('actors.json'),
          categories: count('categories.json'),
          channels:    count('channels.json'),
          websites:   count('websites.json'),
          series:     count('series.json'),
          albums:     count('albums.json'),
          links:      count('links.json'),
          folders:    folderCount,
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

// Load a preset's folders.json — a 2-level tree { "Main Genre": ["Subgenre", ...] }.
// Returns the parsed object, or null when the preset ships no folders.json.
function loadPresetFolders(id) {
  const dir = path.join(PROFILES_DIR, id);
  try {
    const data = JSON.parse(readText(path.join(dir, 'folders.json')));
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch {}
  return null;
}

function sanitizeFolderSeg(s) {
  return String(s || '').trim().replace(/[<>:"|?*\\/]/g, '_');
}

// Materialise a preset's folders.json onto disk under the active write root.
// Existing folders are left untouched. Returns { ok, created }.
function createPresetFolders(id) {
  const tree = loadPresetFolders(id);
  if (!tree) return { ok: false, created: 0 };
  const db = require('./db-server');
  const base = path.resolve(db.getDefaultWriteRoot());
  let created = 0;
  const mkdir = (dir) => {
    if (!dir.startsWith(base)) return;
    try { if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); created++; } } catch {}
  };
  for (const [main, subs] of Object.entries(tree)) {
    const mainSeg = sanitizeFolderSeg(main);
    if (!mainSeg) continue;
    const mainDir = path.join(base, mainSeg);
    mkdir(mainDir);
    if (Array.isArray(subs)) {
      for (const sub of subs) {
        const subSeg = sanitizeFolderSeg(sub);
        if (!subSeg) continue;
        mkdir(path.join(mainDir, subSeg));
      }
    }
  }
  try { require('./videos-server').invalidateScanCache(); } catch {}
  return { ok: true, created };
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
  if (!db.isDbOnDisk()) db.switchProfile('default');

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

// GET /api/profiles
function apiGetProfiles(req, res) {
  if (!fs.existsSync(DB_DIR)) return json(res, { profiles: ['default', 'Vault'], current: 'default', hasDbFiles: false });

  const files = fs.readdirSync(DB_DIR);
  const dbFiles = files.filter(f => f.startsWith('aphroarchive') && f.endsWith('.db'));
  const profiles = files
    .filter(f => f.startsWith('aphroarchive_') && f.endsWith('.db'))
    .map(f => f.replace('aphroarchive_', '').replace('.db', ''));

  if (profiles.length === 0) profiles.push('default');
  if (!profiles.includes('Vault')) profiles.push('Vault');

  const db = require('./db-server');
  json(res, { profiles, current: db.getCurrentProfile(), hasDbFiles: dbFiles.length > 0 });
}

// POST /api/profiles/switch
async function apiSwitchProfile(req, res) {
  const body = await readBody(req);
  const { profile } = body;
  if (!profile) return json(res, { error: 'Profile name required' }, 400);
  
  const db = require('./db-server');
  const { isUnlocked, lockVault, scheduleDeferredLock } = require('./vault-server');

  if (profile === 'Vault' && !isUnlocked()) {
    return json(res, { error: 'Vault is locked', locked: true }, 401);
  }

  // Switching away from Vault: drop the session key so it doesn't outlive
  // the profile context. If an encrypt/decrypt batch is in flight we defer
  // the lock until it finishes rather than pulling the key out mid-stream.
  if (profile !== 'Vault') scheduleDeferredLock();

  db.switchProfile(profile);
  saveLastProfile(profile);
  json(res, { ok: true, current: profile });
}

// POST /api/profiles/create
async function apiCreateProfile(req, res) {
  const body = await readBody(req);
  const { name, preset, createFolders, importLinks, linkCount } = body;
  if (!name) return json(res, { error: 'Profile name required' }, 400);

  const db = require('./db-server');
  db.switchProfile(name);
  saveLastProfile(name);

  let foldersCreated = 0;
  let linksImported = 0;
  if (preset) {
    const data = loadPresetData(preset);
    db.saveFolderMappings(data.categories);
    db.saveChannels(data.channels);
    db.saveWebsites(data.websites);
    db.saveActors(data.actors);
    if (Array.isArray(data.series) && data.series.length > 0) db.saveSeries(data.series);
    if (Array.isArray(data.albums) && data.albums.length > 0) db.saveAlbums(data.albums);
    if (createFolders) foldersCreated = createPresetFolders(preset).created;
    if (importLinks) linksImported = importPresetLinks(preset, typeof linkCount === 'number' ? linkCount : -1);
  }
  markSetupDone();

  json(res, { ok: true, current: name, foldersCreated, linksImported });
}

// POST /api/folders/from-preset  { preset }
async function apiCreateFoldersFromPreset(req, res) {
  const db = require('./db-server');
  if (db.getCurrentProfile() === 'Vault') return json(res, { error: 'Not available in Vault mode' }, 409);
  const body = await readBody(req);
  const { preset } = body;
  if (!preset) return json(res, { error: 'Preset required' }, 400);
  if (!loadPresetFolders(preset)) return json(res, { error: 'Preset has no folder structure' }, 404);
  const result = createPresetFolders(preset);
  json(res, { ok: true, created: result.created });
}

async function apiRenameProfile(req, res) {
  const body = await readBody(req);
  const { oldName, newName } = body;
  if (!oldName || !newName) return json(res, { error: 'Old and new names required' }, 400);

  const db = require('./db-server');
  const current = db.getCurrentProfile();

  const oldPath = path.join(DB_DIR, `aphroarchive_${oldName}.db`);
  const newPath = path.join(DB_DIR, `aphroarchive_${newName}.db`);

  if (!fs.existsSync(oldPath)) return json(res, { error: 'Profile not found' }, 404);
  if (fs.existsSync(newPath)) return json(res, { error: 'New name already exists' }, 400);

  if (current === oldName) {
    db.closeDb();
  }

  fs.renameSync(oldPath, newPath);

  if (current === oldName) {
    db.switchProfile(newName);
    saveLastProfile(newName);
  }

  json(res, { ok: true, current: current === oldName ? newName : current });
}

async function apiDeleteProfile(req, res) {
  const body = await readBody(req);
  const { name } = body;
  if (!name) return json(res, { error: 'Name required' }, 400);
  if (name === 'Vault') return json(res, { error: 'Cannot delete Vault profile' }, 400);

  const db = require('./db-server');
  if (db.getCurrentProfile() === name) return json(res, { error: 'Cannot delete the active profile — switch first' }, 400);

  const dbPath = path.join(DB_DIR, `aphroarchive_${name}.db`);
  if (!fs.existsSync(dbPath)) return json(res, { error: 'Profile not found' }, 404);

  try { fs.unlinkSync(dbPath); } catch (e) { return json(res, { error: e.message }, 500); }
  json(res, { ok: true });
}

async function apiCloneProfile(req, res) {
  const body = await readBody(req);
  const { sourceName, newName } = body;
  if (!sourceName || !newName) return json(res, { error: 'sourceName and newName required' }, 400);
  if (newName === 'Vault') return json(res, { error: 'Reserved name' }, 400);

  const srcPath = path.join(DB_DIR, `aphroarchive_${sourceName}.db`);
  const dstPath = path.join(DB_DIR, `aphroarchive_${newName}.db`);

  if (!fs.existsSync(srcPath)) return json(res, { error: 'Source profile not found' }, 404);
  if (fs.existsSync(dstPath)) return json(res, { error: 'Name already in use' }, 400);

  try {
    fs.copyFileSync(srcPath, dstPath);
    // Open the new DB and clear per-user data (videos, links, history, favs)
    const { DatabaseSync } = eval("require('node:sqlite')");
    const newDb = new DatabaseSync(dstPath);
    newDb.exec(`DELETE FROM videos; DELETE FROM links; DELETE FROM history; DELETE FROM favs;`);
    newDb.close();
  } catch (e) {
    try { fs.unlinkSync(dstPath); } catch {}
    return json(res, { error: e.message }, 500);
  }
  json(res, { ok: true });
}

const LAST_PROFILE_FILE = path.join(DB_DIR, 'last-profile.txt');

function saveLastProfile(name) {
  try { fs.writeFileSync(LAST_PROFILE_FILE, name, 'utf-8'); } catch {}
}

function loadLastProfile() {
  try {
    const name = fs.readFileSync(LAST_PROFILE_FILE, 'utf-8').trim();
    const dbPath = path.join(DB_DIR, `aphroarchive_${name}.db`);
    return name && fs.existsSync(dbPath) ? name : null;
  } catch { return null; }
}

module.exports = { apiGetPresets, apiApplyPreset, isDbInitialized, apiGetProfiles, apiSwitchProfile, apiCreateProfile, apiRenameProfile, apiDeleteProfile, apiCloneProfile, apiCreateFoldersFromPreset, loadLastProfile, saveLastProfile };
