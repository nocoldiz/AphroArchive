'use strict';
// ═══════════════════════════════════════════════════════════════════
//  presets.js — DB preset system: list, preview, apply presets
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { DB_DIR } = require('./config-server');
const { json, readBody } = require('./helpers-server');

const PROFILES_DIR = path.join(DB_DIR, 'profiles');
const SETUP_DONE_FILE = path.join(DB_DIR, 'setup.done');

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
  const dir = path.join(PROFILES_DIR, id);
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
  const db = require('./db-server');
  const actors = {};
  db.loadActors().forEach(a => { actors[a.name] = { date_of_birth: a.date_of_birth, nationality: a.nationality, imdb_page: a.imdb_page }; });
  const categories = {};
  db.loadCategories().forEach(c => { categories[c.name] = { displayName: c.displayName, tags: c.terms.slice(1) }; });
  const studios = {};
  db.loadStudios().forEach(s => { studios[s.name] = { website: s.website, short_description: s.description }; });
  return { actors, categories, studios, websites: db.loadWebsites() };
}

function writeDb(merged, mergeWithExisting = false) {
  const db = require('./db-server');
  let data = merged;
  if (mergeWithExisting) {
    const existingCats = db.loadCategories();
    const existingStudios = db.loadStudios();
    const existingWebsites = db.loadWebsites();
    
    const cats = { ...merged.categories };
    for (const c of existingCats) {
      if (!cats[c.name]) cats[c.name] = { displayName: c.displayName, tags: c.terms.slice(1) };
    }
    
    const studios = { ...merged.studios };
    for (const s of existingStudios) {
      if (!studios[s.name]) studios[s.name] = { website: s.website, short_description: s.description };
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
      studios: studios,
      websites: websites,
      actors: merged.actors
    };
  }
  
  db.saveCategories(data.categories);
  db.saveStudios(data.studios);
  db.saveWebsites(data.websites);
  db.saveActors(data.actors);
}

// GET /api/presets
function apiGetPresets(req, res) {
  const firstRun = !isDbInitialized();
  json(res, { needed: firstRun, firstRun, profiles: listProfileTemplates() });
}

// POST /api/presets/apply  { selection: 'blank' | 'all' | ['id',...], merge?: boolean }
async function apiApplyPreset(req, res) {
  const body = await readBody(req);
  const { selection, merge } = body;

  let merged;
  if (selection === 'blank') {
    merged = { actors: {}, categories: {}, studios: {}, websites: [] };
  } else if (selection === 'all') {
    merged = mergePresets(listProfileTemplates().map(p => p.id));
  } else if (Array.isArray(selection) && selection.length > 0) {
    merged = mergePresets(selection);
  } else {
    return json(res, { error: 'Invalid selection' }, 400);
  }

  const db = require('./db-server');
  // First run: promote in-memory DB to a real file before writing preset data
  if (!db.isDbOnDisk()) db.switchProfile('default');

  writeDb(merged, !!merge);
  markSetupDone();

  db.invalidateDbTypeCache('actors');
  db.invalidateDbTypeCache('categories');
  db.invalidateDbTypeCache('studios');

  json(res, { ok: true });
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
  const { isUnlocked } = require('./vault-server');
  
  if (profile === 'Vault' && !isUnlocked()) {
    return json(res, { error: 'Vault is locked', locked: true }, 401);
  }
  
  db.switchProfile(profile);
  saveLastProfile(profile);
  json(res, { ok: true, current: profile });
}

// POST /api/profiles/create
async function apiCreateProfile(req, res) {
  const body = await readBody(req);
  const { name, preset } = body;
  if (!name) return json(res, { error: 'Profile name required' }, 400);
  
  const db = require('./db-server');
  db.switchProfile(name);
  saveLastProfile(name);

  if (preset) {
    const data = loadPresetData(preset);
    db.saveCategories(data.categories);
    db.saveStudios(data.studios);
    db.saveWebsites(data.websites);
    db.saveActors(data.actors);
  }
  markSetupDone();

  json(res, { ok: true, current: name });
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

module.exports = { apiGetPresets, apiApplyPreset, isDbInitialized, apiGetProfiles, apiSwitchProfile, apiCreateProfile, apiRenameProfile, apiDeleteProfile, apiCloneProfile, loadLastProfile, saveLastProfile };
