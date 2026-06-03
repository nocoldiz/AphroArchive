'use strict';
// ═══════════════════════════════════════════════════════════════════
//  comments-server.js — AI comment generation + persistence
// ═══════════════════════════════════════════════════════════════════

const { json, readBody } = require('./helpers-server');
const { loadPrefs, loadComments, saveComments, clearAllComments: dbClearAllComments } = require('./db-server');

const fs   = require('fs');
const path = require('path');

const MODELS_DIR        = path.join(process.cwd(), 'models');
const MODEL_FILENAME    = 'llama-3.2-1b-instruct.gguf';
const DEFAULT_MODEL_URI = 'hf:bartowski/Llama-3.2-1B-Instruct-GGUF:Q4_K_M';

let getLlama = null;
let LlamaChatSession = null;
let llama = null;
let model = null;
let ctx = null;
let modelReady = false;

// ── Download state ─────────────────────────────────────────────────────────

let dlActive = false;
let dlPct    = 0;
let dlDone   = 0;
let dlTotal  = 0;
let dlError  = null;
let dlAbort  = null;

// ── Model path resolution ──────────────────────────────────────────────────

async function _resolveModelPath() {
  const { resolveModelFile } = await import('node-llama-cpp');
  const opts = { download: false };
  // Priority 1: local ./models subfolder if it exists
  if (fs.existsSync(MODELS_DIR)) {
    try {
      return await resolveModelFile(MODEL_FILENAME, { ...opts, directory: MODELS_DIR });
    } catch {}
  }
  // Priority 2: node-llama-cpp's global models directory (~/.node-llama-cpp/models)
  try {
    return await resolveModelFile(MODEL_FILENAME, opts);
  } catch {}
  return null;
}

// ── Model lifecycle ────────────────────────────────────────────────────────

async function initCommentsModel() {
  const prefs = loadPrefs();
  if (!prefs.aiCommentsEnabled) return;
  try {
    const nodeLlama = await import('node-llama-cpp');
    getLlama = nodeLlama.getLlama;
    LlamaChatSession = nodeLlama.LlamaChatSession;
  } catch (e) {
    console.warn('[comments] node-llama-cpp not installed:', e.message); return;
  }
  const modelPath = await _resolveModelPath();
  if (!modelPath) { console.warn('[comments] Model not found in', MODELS_DIR, 'or node-llama-cpp global dir'); return; }
  try {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
    llama = await getLlama();
    model = await llama.loadModel({ modelPath });
    ctx   = await model.createContext();
    modelReady = true;
    console.log('[comments] Model loaded OK:', path.basename(modelPath));
  } catch (e) {
    modelReady = false;
    console.error('[comments] Failed to load model:', e.message);
  }
}

const isModelReady = () => modelReady;
async function reinitIfNeeded() { if (!modelReady) await initCommentsModel(); }

// ── Model download ─────────────────────────────────────────────────────────

async function _runDownload() {
  const prefs = loadPrefs();
  const modelUri = (prefs.llamaModelUri || '').trim() || DEFAULT_MODEL_URI;
  try {
    const { createModelDownloader } = await import('node-llama-cpp');
    fs.mkdirSync(MODELS_DIR, { recursive: true });
    const downloader = await createModelDownloader({
      modelUri,
      dirPath: MODELS_DIR,
      fileName: MODEL_FILENAME,
      showCliProgress: false,
      onProgress: ({ totalSize, downloadedSize }) => {
        dlDone  = downloadedSize;
        dlTotal = totalSize;
        dlPct   = totalSize > 0 ? Math.round(downloadedSize / totalSize * 100) : 0;
      },
    });
    dlAbort = new AbortController();
    await downloader.download({ signal: dlAbort.signal });
    dlPct = 100; dlError = null;
    console.log('[comments] Model downloaded to', path.join(MODELS_DIR, MODEL_FILENAME));
    modelReady = false;
    await initCommentsModel();
  } catch (e) {
    if (e.name !== 'AbortError') {
      dlError = e.message;
      console.error('[comments] Download failed:', e.message);
    }
  } finally {
    dlActive = false; dlAbort = null;
  }
}

function apiDownloadModel(req, res) {
  if (dlActive) return json(res, { error: 'Download already in progress' }, 409);
  dlActive = true; dlPct = 0; dlDone = 0; dlTotal = 0; dlError = null;
  _runDownload().catch(() => {});
  json(res, { ok: true });
}

function apiCancelDownload(req, res) {
  if (dlAbort) { try { dlAbort.abort(); } catch {} }
  dlActive = false;
  json(res, { ok: true });
}

function apiModelStatus(req, res) {
  const localFile = path.join(MODELS_DIR, MODEL_FILENAME);
  json(res, {
    ready:      modelReady,
    fileExists: fs.existsSync(localFile),
    filePath:   localFile,
    modelName:  MODEL_FILENAME,
    downloading: dlActive,
    dlPct, dlDone, dlTotal, dlError,
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

const _ADJS = ['Curious', 'Sneaky', 'Bold', 'Gentle', 'Witty', 'Calm', 'Fuzzy', 'Quick', 'Silent', 'Clever', 'Crispy', 'Spicy', 'Lucky', 'Sassy', 'Zesty'];
const _NOUNS = ['Otter', 'Falcon', 'Panda', 'Wolf', 'Raven', 'Tiger', 'Fox', 'Lynx', 'Elk', 'Bear', 'Gecko', 'Hippo', 'Lemur', 'Mink', 'Newt'];
function _rndUser() {
  return _ADJS[Math.random() * _ADJS.length | 0] + _NOUNS[Math.random() * _NOUNS.length | 0] + (1000 + Math.floor(Math.random() * 8999));
}
function _uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function _hashId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function _seededCount(videoId) { return 4 + (_hashId(videoId) % 27); }

function _seededRng(videoId) {
  let s = (_hashId(videoId) >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function _buildComments(texts, videoId) {
  const rng = _seededRng(videoId);
  const out = [];
  for (let i = 0; i < texts.length; i++) {
    let parentId = null;
    if (i >= 3 && rng() < 0.35) {
      const topLevel = out.filter(c => !c.parentId);
      if (topLevel.length > 0)
        parentId = topLevel[Math.floor(rng() * topLevel.length)].id;
    }
    out.push({
      id: 'ai_' + _uid(),
      text: texts[i],
      author: _rndUser(),
      isAI: true,
      parentId,
      ts: Date.now() - Math.floor(rng() * 86300000 * 14)
    });
  }
  return out;
}

function loadCommentFile(videoId) {
  const data = loadComments(videoId);
  if (data === null) return null;
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'string') {
    const migrated = data.map(text => ({
      id: 'ai_' + _uid(),
      text,
      author: _rndUser(),
      isAI: true,
      parentId: null,
      ts: Date.now() - Math.floor(Math.random() * 86300000 * 7)
    }));
    saveComments(videoId, migrated);
    return migrated;
  }
  return Array.isArray(data) ? data : [];
}

function saveCommentFile(videoId, comments) {
  saveComments(videoId, comments);
}

// ── AI text generation ─────────────────────────────────────────────────────

async function _generateCommentTexts(videoName, count) {
  const sequence = ctx.getSequence();
  try {
    const session = new LlamaChatSession({ contextSequence: sequence });
    const prefs = loadPrefs();
    const prompt = (prefs.aiCommentMasterPrompt && prefs.aiCommentMasterPrompt.trim())
      ? prefs.aiCommentMasterPrompt.replace(/\{count\}/g, count.toString()).replace(/\{videoName\}/g, videoName.replace(/"/g, '\\"').replace(/\n/g, ' '))
      : 'Generate exactly ' + count + ' realistic, casual internet comments that real users would post under a video titled "' +
      videoName.replace(/"/g, '\\"').replace(/\n/g, ' ') + '".\n\n' +
      'Vary them: mix of very short reactions, detailed praise, funny one-liners, and relatable observations. Make them feel like real different people.\n\n' +
      'Return ONLY a valid JSON array of exactly ' + count + ' strings: ["comment 1", "comment 2", ...]\n' +
      'No explanation, no markdown — just the raw JSON array.';
    const raw = await session.prompt(prompt);
    const parsed = JSON.parse(raw.trim());
    if (!Array.isArray(parsed)) throw new Error('not array');
    const texts = parsed.filter(c => typeof c === 'string' && c.trim());
    return texts.slice(0, count);
  } finally {
    sequence.dispose();
  }
}

async function _generateReplyText(videoName, userComment) {
  const sequence = ctx.getSequence();
  try {
    const session = new LlamaChatSession({ contextSequence: sequence });
    const prefs = loadPrefs();
    const prompt = (prefs.aiReplyMasterPrompt && prefs.aiReplyMasterPrompt.trim())
      ? prefs.aiReplyMasterPrompt.replace(/\{userComment\}/g, userComment.replace(/"/g, '\\"')).replace(/\{videoName\}/g, videoName.replace(/"/g, '\\"').replace(/\n/g, ' '))
      : 'A user commented "' + userComment.replace(/"/g, '\\"') + '" on a video titled "' +
      videoName.replace(/"/g, '\\"').replace(/\n/g, ' ') + '". ' +
      'Write a short, casual 1-2 sentence reply. Return ONLY the reply text.';
    const raw = await session.prompt(prompt);
    return raw.trim().replace(/^["']|["']$/g, '');
  } finally {
    sequence.dispose();
  }
}

// ── API: GET /api/comments/:id?name=... ───────────────────────────────────────

async function apiGetComments(req, res, videoId) {
  try {
    const urlObj = new URL('http://x' + req.url);
    const videoName = urlObj.searchParams.get('name') || videoId;

    let comments = loadCommentFile(videoId);

    if (comments === null) {
      const prefs = loadPrefs();
      if (prefs.aiCommentsEnabled && isModelReady()) {
        await reinitIfNeeded();
        const count = _seededCount(videoId);
        try {
          const texts = await _generateCommentTexts(videoName, count);
          if (texts.length > 0) {
            comments = _buildComments(texts, videoId);
            saveCommentFile(videoId, comments);
          }
        } catch (e) {
          console.error('[comments] generation failed:', e.message);
        }
        if (comments === null) comments = [];
      } else {
        comments = [];
      }
    }

    return json(res, comments);
  } catch (e) {
    console.error('[comments] apiGetComments:', e.message);
    return json(res, [], 200);
  }
}

// ── API: POST /api/comments/:id/add ─────────────────────────────────────────

async function apiAddComment(req, res, videoId) {
  try {
    const { videoName, text, parentId } = await readBody(req);
    if (!text || !videoId) return json(res, { error: 'Missing params' }, 400);

    const comments = loadCommentFile(videoId) || [];

    const userComment = {
      id: 'usr_' + _uid(),
      text,
      author: 'You',
      isAI: false,
      parentId: parentId || null,
      ts: Date.now()
    };
    comments.push(userComment);

    let aiReply = null;
    const prefs = loadPrefs();
    if (prefs.aiCommentsEnabled && videoName && isModelReady()) {
      await reinitIfNeeded();
      try {
        const replyText = await _generateReplyText(videoName, text);
        if (replyText) {
          aiReply = {
            id: 'ai_' + _uid(),
            text: replyText,
            author: _rndUser(),
            isAI: true,
            parentId: userComment.id,
            ts: Date.now() + 1000
          };
          comments.push(aiReply);
        }
      } catch (e) {
        console.error('[comments] reply generation failed:', e.message);
      }
    }

    saveCommentFile(videoId, comments);
    return json(res, { comment: userComment, reply: aiReply });
  } catch (e) {
    console.error('[comments] apiAddComment:', e.message);
    return json(res, { error: e.message }, 500);
  }
}

// ── Legacy endpoints ───────────────────────────────────────────────────────

async function apiGenerateComments(req, res) {
  const body = await readBody(req);
  const { videoId, videoName } = body;
  if (!videoId || !videoName) return json(res, { error: 'Missing params' }, 400);
  const mockReq = { url: '/api/comments/' + encodeURIComponent(videoId) + '?name=' + encodeURIComponent(videoName) };
  const comments = [];
  const mockRes = {
    writeHead: () => { }, end: (body) => {
      try { const d = JSON.parse(body); comments.push(...(Array.isArray(d) ? d : [])); } catch { }
    }
  };
  await apiGetComments(mockReq, mockRes, videoId);
  return json(res, { comments: comments.map(c => c.text || c) });
}

async function apiReplyToComment(req, res) {
  const body = await readBody(req);
  const { videoId, videoName, userComment } = body;
  if (!videoId || !videoName || !userComment) return json(res, { error: 'Missing params' }, 400);
  const prefs = loadPrefs();
  if (!prefs.aiCommentsEnabled) return json(res, { error: 'AI comments disabled' }, 400);
  if (!isModelReady()) return json(res, { error: 'Model not ready' }, 503);
  await reinitIfNeeded();
  try {
    const reply = await _generateReplyText(videoName, userComment);
    return json(res, { reply });
  } catch (e) {
    return json(res, { error: e.message }, 500);
  }
}

function apiClearAllComments(req, res) {
  try {
    dbClearAllComments();
    return json(res, { ok: true });
  } catch (e) {
    return json(res, { error: e.message }, 500);
  }
}

module.exports = {
  initCommentsModel, isModelReady, reinitIfNeeded,
  apiGetComments, apiAddComment,
  apiGenerateComments, apiReplyToComment, apiClearAllComments,
  apiModelStatus, apiDownloadModel, apiCancelDownload,
};
