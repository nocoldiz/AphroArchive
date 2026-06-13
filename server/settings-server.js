'use strict';
// ═══════════════════════════════════════════════════════════════════
//  settings.js — Settings lists, hidden terms, prefs API handlers
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const { VIDEOS_DIR } = require('./config-server');
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
  if ('vaultTimeoutMinutes' in body) {
    // Auto-lock period in minutes. 0 disables auto-lock. Clamp to a sane range.
    const n = Number(body.vaultTimeoutMinutes);
    if (Number.isFinite(n) && n >= 0) prefs.vaultTimeoutMinutes = Math.min(n, 24 * 60);
  }
  if ('anthropicApiKey' in body) prefs.anthropicApiKey = String(body.anthropicApiKey || '').trim();
  if ('openrouterApiKey' in body) prefs.openrouterApiKey = String(body.openrouterApiKey || '').trim();
  if ('openrouterModel' in body) prefs.openrouterModel = String(body.openrouterModel || '').trim();
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
  if ('llamaModelUri' in body) prefs.llamaModelUri = String(body.llamaModelUri || '').trim();
  if ('theme' in body) prefs.theme = String(body.theme || '').trim();
  if ('cardSize' in body && !isNaN(parseInt(body.cardSize, 10))) prefs.cardSize = parseInt(body.cardSize, 10);
  if ('isMuted' in body) prefs.isMuted = !!body.isMuted;
  if ('thumbBlurMode' in body) prefs.thumbBlurMode = String(body.thumbBlurMode || 'show').trim();
  if ('comfyuiUrl' in body) prefs.comfyuiUrl = String(body.comfyuiUrl || '').trim();
  if ('comfyuiWorkflowJson' in body) prefs.comfyuiWorkflowJson = String(body.comfyuiWorkflowJson || '').trim();
  if ('comfyuiPositiveNodeId' in body) prefs.comfyuiPositiveNodeId = String(body.comfyuiPositiveNodeId || '').trim();
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

module.exports = { apiSettingsLists, apiSettingsSave, apiGetPrefs, apiSavePrefs, apiBrowseFolders, apiBrowseFoldersNative, apiVerifyVaultPassword };
