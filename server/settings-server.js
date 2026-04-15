'use strict';
// ═══════════════════════════════════════════════════════════════════
//  settings.js — Settings lists, hidden terms, prefs API handlers
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const { HIDDEN_FILE, ACTORS_JSON, CATEGORIES_JSON, STUDIOS_JSON } = require('./config-server');
const { json, readBody }  = require('./helpers-server');
const { loadPrefs, savePrefs } = require('./db-server');

function readJsonKeys(file) {
  try { return Object.keys(JSON.parse(fs.readFileSync(file, 'utf-8'))).join('\n'); }
  catch { return ''; }
}

function apiSettingsLists(req, res) {
  const read = f => { try { return fs.readFileSync(f, 'utf-8'); } catch { return ''; } };
  json(res, {
    hidden:     read(HIDDEN_FILE),
    categories: readJsonKeys(CATEGORIES_JSON),
    actors:     readJsonKeys(ACTORS_JSON),
    studios:    readJsonKeys(STUDIOS_JSON),
  });
}

async function apiSettingsSave(req, res, file) {
  const map = { hidden: HIDDEN_FILE };
  if (!map[file]) return json(res, { error: 'Unknown file' }, 400);
  const data  = await readBody(req);
  const lines = (data.content || '').split('\n').map(l => l.trim()).filter(l => l.length > 0);
  fs.writeFileSync(map[file], lines.join('\n') + (lines.length ? '\n' : ''));
  json(res, { ok: true, count: lines.length });
}

function apiGetPrefs(req, res) {
  json(res, loadPrefs());
}

async function apiSavePrefs(req, res) {
  const body  = await readBody(req);
  const prefs = loadPrefs();
  const CHRON_MODES = new Set(['keep', 'delete-on-startup', 'dont-save']);
  if ('chronologyMode' in body) {
    if (!CHRON_MODES.has(body.chronologyMode)) return json(res, { error: 'Invalid value' }, 400);
    prefs.chronologyMode = body.chronologyMode;
  }
  savePrefs(prefs);
  json(res, { ok: true });
}

module.exports = { apiSettingsLists, apiSettingsSave, apiGetPrefs, apiSavePrefs };
