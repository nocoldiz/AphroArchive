'use strict';
// ═══════════════════════════════════════════════════════════════════
//  settings.js — Settings lists, hidden terms, prefs API handlers
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { VIDEOS_DIR, PATHS_FILE, CACHE_DIR, DB_DIR, VAULT_DIR,
        DEFAULT_CACHE_DIR, DEFAULT_DB_DIR, DEFAULT_VAULT_DIR } = require('./config-server');
const { json, readBody }  = require('./helpers-server');
const { loadPrefs, savePrefs, loadHidden, saveHidden, loadCategories, loadActors, loadStudios, loadVaultConfig } = require('./db-server');

function apiSettingsLists(req, res) {
  json(res, {
    hidden:     loadHidden().join('\n'),
    categories: loadCategories().map(c => c.name).join('\n'),
    actors:     loadActors().map(a => a.name).join('\n'),
    studios:    loadStudios().map(s => s.name).join('\n'),
  });
}

async function apiSettingsSave(req, res, file) {
  if (file !== 'hidden') return json(res, { error: 'Unknown file' }, 400);
  const data  = await readBody(req);
  const lines = (data.content || '').split('\n').map(l => l.trim()).filter(l => l.length > 0);
  saveHidden(lines);
  json(res, { ok: true, count: lines.length });
}

function apiGetPrefs(req, res) {
  const prefs = loadPrefs();
  const videosDirExists = fs.existsSync(VIDEOS_DIR);
  const missingSourceFolders = (prefs.sourceFolders || []).filter(f => !fs.existsSync(f));
  json(res, {
    ...prefs,
    videosDir: VIDEOS_DIR,
    videosDirExists,
    missingSourceFolders
  });
}

async function apiSavePrefs(req, res) {
  const body  = await readBody(req);
  const prefs = loadPrefs();
  const CHRON_MODES = new Set(['keep', 'delete-on-startup', 'dont-save']);
  if ('chronologyMode' in body) {
    if (!CHRON_MODES.has(body.chronologyMode)) return json(res, { error: 'Invalid value' }, 400);
    prefs.chronologyMode = body.chronologyMode;
  }
  if ('aiCommentsEnabled' in body) prefs.aiCommentsEnabled = !!body.aiCommentsEnabled;
  if ('disableSearchTracking' in body) prefs.disableSearchTracking = !!body.disableSearchTracking;
  if ('vaultSelfDestruct' in body) prefs.vaultSelfDestruct = !!body.vaultSelfDestruct;
  if ('vaultTimeoutMinutes' in body) {
    // Auto-lock period in minutes. 0 disables auto-lock. Clamp to a sane range.
    const n = Number(body.vaultTimeoutMinutes);
    if (Number.isFinite(n) && n >= 0) prefs.vaultTimeoutMinutes = Math.min(n, 24 * 60);
  }
  if ('anthropicApiKey' in body) prefs.anthropicApiKey = String(body.anthropicApiKey || '').trim();
  if ('openrouterApiKey' in body) prefs.openrouterApiKey = String(body.openrouterApiKey || '').trim();
  if ('openrouterModel' in body) prefs.openrouterModel = String(body.openrouterModel || '').trim();
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
  if ('defaultRoot' in body || 'defaultPath' in body || 'defaultWriteRoot' in body) {
    const val = body.defaultRoot ?? body.defaultPath ?? body.defaultWriteRoot ?? '';
    prefs.defaultRoot = val ? String(val).trim() : '';
  }
  let feedFoldersChanged = false;
  if ('feedFolders' in body) {
    if (Array.isArray(body.feedFolders)) {
      prefs.feedFolders = body.feedFolders.map(p => String(p).trim()).filter(Boolean);
      feedFoldersChanged = true;
    }
  }
  if ('privateFeedFolders' in body) {
    if (Array.isArray(body.privateFeedFolders)) {
      prefs.privateFeedFolders = body.privateFeedFolders.map(p => String(p).trim()).filter(Boolean);
      feedFoldersChanged = true;
    }
  }
  // New assistant prefs (nsfw switch, jailbreak/system prompt mode, story genre) for AssistantView.tsx
  if ('assistantNsfw' in body) prefs.assistantNsfw = !!body.assistantNsfw;
  if ('assistantSystemMode' in body) prefs.assistantSystemMode = String(body.assistantSystemMode || 'default');
  if ('assistantStoryGenre' in body) prefs.assistantStoryGenre = String(body.assistantStoryGenre || 'Any');
  if ('theme' in body) prefs.theme = String(body.theme || '').trim();
  if ('cardSize' in body && !isNaN(parseInt(body.cardSize, 10))) prefs.cardSize = parseInt(body.cardSize, 10);
  if ('isMuted' in body) prefs.isMuted = !!body.isMuted;
  if ('thumbBlurMode' in body) prefs.thumbBlurMode = String(body.thumbBlurMode || 'show').trim();
  if ('comfyuiUrl' in body) prefs.comfyuiUrl = String(body.comfyuiUrl || '').trim();
  if ('comfyuiWorkflowJson' in body) prefs.comfyuiWorkflowJson = String(body.comfyuiWorkflowJson || '').trim();
  if ('comfyuiPositiveNodeId' in body) prefs.comfyuiPositiveNodeId = String(body.comfyuiPositiveNodeId || '').trim();
  if ('disabledPlugins' in body) {
    if (Array.isArray(body.disabledPlugins)) prefs.disabledPlugins = body.disabledPlugins.map(String);
  }
  // Home dashboard widget layout (opaque array of widget instances).
  if ('homeDashboard' in body) {
    prefs.homeDashboard = Array.isArray(body.homeDashboard) ? body.homeDashboard : [];
  }
  if ('autoChapterDetection' in body) prefs.autoChapterDetection = !!body.autoChapterDetection;
  if ('whisperEnabled' in body) prefs.whisperEnabled = !!body.whisperEnabled;
  if ('whisperModel' in body) {
    const valid = new Set(['tiny', 'base', 'small', 'medium', 'large', 'turbo']);
    if (valid.has(body.whisperModel)) prefs.whisperModel = body.whisperModel;
  }
  if ('whisperLanguage' in body) prefs.whisperLanguage = String(body.whisperLanguage || 'auto').trim().slice(0, 10);
  savePrefs(prefs);
  if (feedFoldersChanged) {
    try {
      const fw = require('./feed-watcher-server');
      fw.stopWatchers();
      fw.startWatchers(loadPrefs());
    } catch (e) {}
  }
  json(res, { ok: true });
}

async function apiVerifyVaultPassword(req, res) {
  const cfg = loadVaultConfig();
  if (!cfg) return json(res, { ok: false, error: 'Vault not configured' });
  const body = await readBody(req);
  const pw = (body.password || '').trim();
  if (!pw) return json(res, { ok: false });
  try {
    const { deriveKeys } = require('./vault-server');
    const { verifyHash } = await deriveKeys(pw, cfg.salt);
    json(res, { ok: verifyHash === cfg.verifyHash });
  } catch (e) {
    json(res, { ok: false, error: e.message });
  }
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

function apiBrowseFoldersNative(req, res) {
  if (process.platform !== 'win32') {
    return json(res, { error: 'Native file selector only supported on Windows' }, 400);
  }
  
  const { exec } = require('child_process');
  const scriptLines = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$fb = New-Object System.Windows.Forms.FolderBrowserDialog',
    '$fb.Description = "Select Folder"',
    '$owner = New-Object System.Windows.Forms.Form',
    '$owner.TopMost = $true',
    '$owner.StartPosition = "CenterScreen"',
    '$owner.Width = 0; $owner.Height = 0; $owner.ShowInTaskbar = $false',
    'if ($fb.ShowDialog($owner) -eq "OK") { $fb.SelectedPath }',
    '$owner.Dispose()',
  ].join('\n');
  const encoded = Buffer.from(scriptLines, 'utf16le').toString('base64');

  exec(`powershell -STA -EncodedCommand ${encoded}`, { timeout: 120000 }, (error, stdout) => {
    if (error) {
      return json(res, { error: error.message }, 500);
    }
    const selectedPath = stdout.trim();
    json(res, { path: selectedPath || null });
  });
}

function apiGetPaths(req, res) {
  let cfg = {};
  try { cfg = fs.existsSync(PATHS_FILE) ? JSON.parse(fs.readFileSync(PATHS_FILE, 'utf8')) : {}; } catch {}
  json(res, {
    cacheDir: CACHE_DIR,
    dbDir:    DB_DIR,
    vaultDir: VAULT_DIR,
    defaults: { cacheDir: DEFAULT_CACHE_DIR, dbDir: DEFAULT_DB_DIR, vaultDir: DEFAULT_VAULT_DIR },
    custom:   { cacheDir: cfg.cacheDir || '', dbDir: cfg.dbDir || '', vaultDir: cfg.vaultDir || '' },
    exists:   { cacheDir: fs.existsSync(CACHE_DIR), dbDir: fs.existsSync(DB_DIR), vaultDir: fs.existsSync(VAULT_DIR) },
  });
}

async function apiSavePaths(req, res) {
  const body = await readBody(req);
  let cfg = {};
  try { cfg = fs.existsSync(PATHS_FILE) ? JSON.parse(fs.readFileSync(PATHS_FILE, 'utf8')) : {}; } catch {}
  if ('cacheDir' in body) cfg.cacheDir = String(body.cacheDir || '').trim();
  if ('dbDir'    in body) cfg.dbDir    = String(body.dbDir    || '').trim();
  if ('vaultDir' in body) cfg.vaultDir = String(body.vaultDir || '').trim();
  // Remove empty keys so defaults take effect
  for (const k of ['cacheDir', 'dbDir', 'vaultDir']) { if (!cfg[k]) delete cfg[k]; }
  try {
    fs.writeFileSync(PATHS_FILE, JSON.stringify(cfg, null, 2), 'utf8');
    json(res, { ok: true, restartRequired: true });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

module.exports = { apiSettingsLists, apiSettingsSave, apiGetPrefs, apiSavePrefs, apiBrowseFolders, apiBrowseFoldersNative, apiVerifyVaultPassword, apiGetPaths, apiSavePaths };
