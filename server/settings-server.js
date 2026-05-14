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
  if ('aiCommentsEnabled' in body) {
    const wasEnabled = !!prefs.aiCommentsEnabled;
    prefs.aiCommentsEnabled = !!body.aiCommentsEnabled;
    if (!wasEnabled && prefs.aiCommentsEnabled) {
      const comments = require('./comments-server');
      comments.reinitIfNeeded();
    }
  }
  if ('disableSearchTracking' in body) prefs.disableSearchTracking = !!body.disableSearchTracking;
  if ('vaultSelfDestruct' in body) prefs.vaultSelfDestruct = !!body.vaultSelfDestruct;
  if ('anthropicApiKey' in body) prefs.anthropicApiKey = String(body.anthropicApiKey || '').trim();
  if ('visionProvider' in body) prefs.visionProvider = body.visionProvider === 'claude' ? 'claude' : 'ollama';
  if ('ollamaUrl' in body) prefs.ollamaUrl = String(body.ollamaUrl || '').trim();
  if ('ollamaVisionModel' in body) prefs.ollamaVisionModel = String(body.ollamaVisionModel || '').trim();
  if ('networkEnabled' in body)   prefs.networkEnabled   = !!body.networkEnabled;
  if ('aiCommentMasterPrompt' in body) prefs.aiCommentMasterPrompt = String(body.aiCommentMasterPrompt || '').trim();
  if ('aiReplyMasterPrompt' in body)   prefs.aiReplyMasterPrompt   = String(body.aiReplyMasterPrompt || '').trim();
  if ('sourceFolders' in body) {
    if (Array.isArray(body.sourceFolders)) {
      prefs.sourceFolders = body.sourceFolders.map(p => String(p).trim()).filter(Boolean);
      try {
        const { invalidateScanCache } = require('./videos-server');
        invalidateScanCache();
      } catch (e) {}
    }
  }
  savePrefs(prefs);
  json(res, { ok: true });
}

function apiBrowseFolders(req, res, params) {
  const os = require('os');
  let currentPath = params.get('path');
  
  if (!currentPath) {
    currentPath = os.homedir();
  }
  
  try {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    const dirs = [];
    for (const ent of entries) {
      if (ent.isDirectory() && !ent.name.startsWith('.')) {
        dirs.push(ent.name);
      }
    }
      
    const drives = [];
    if (process.platform === 'win32') {
      for (let i = 65; i <= 90; i++) {
        const drive = String.fromCharCode(i) + ':\\';
        try {
          if (fs.existsSync(drive)) drives.push(drive);
        } catch (e) {}
      }
    } else {
      drives.push('/');
    }
      
    json(res, {
      currentPath: path.resolve(currentPath),
      parent: path.resolve(currentPath) === path.resolve(path.dirname(currentPath)) ? null : path.dirname(path.resolve(currentPath)),
      dirs: dirs.sort(),
      drives: drives
    });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

module.exports = { apiSettingsLists, apiSettingsSave, apiGetPrefs, apiSavePrefs, apiBrowseFolders };
