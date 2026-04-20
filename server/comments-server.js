'use strict';
// ═══════════════════════════════════════════════════════════════════
//  comments-server.js — AI comment generation + persistence
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { json, readBody } = require('./helpers-server');
const { loadPrefs } = require('./db-server');
const { CACHE_DIR } = require('./config-server');

const MODELS_DIR = path.join(process.cwd(), 'models');
const MODEL_FILE = path.join(MODELS_DIR, 'llama-3.2-1b-instruct.gguf');

let getLlama         = null;
let LlamaChatSession = null;
let llama      = null;
let model      = null;
let ctx        = null;
let modelReady = false;

// ── Model lifecycle ────────────────────────────────────────────────────────────
async function initCommentsModel() {
  const prefs = loadPrefs();
  if (!prefs.aiCommentsEnabled) return;
  if (!fs.existsSync(MODEL_FILE)) { console.warn('[comments] Model not found:', MODEL_FILE); return; }
  try {
  } catch (e) {
    console.warn('[comments] node-llama-cpp not installed:', e.message); return;
  }
  try {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
    llama      = await getLlama();
    model      = await llama.loadModel({ modelPath: MODEL_FILE });
    ctx        = await model.createContext();
    modelReady = true;
    console.log('[comments] Model loaded OK');
  } catch (e) {
    modelReady = false;
    console.error('[comments] Failed to load model:', e.message);
  }
}
const isModelReady = () => modelReady;
async function reinitIfNeeded() { if (!modelReady) await initCommentsModel(); }

// ── Helpers ───────────────────────────────────────────────────────────────────
const _ADJS  = ['Curious','Sneaky','Bold','Gentle','Witty','Calm','Fuzzy','Quick','Silent','Clever','Crispy','Spicy','Lucky','Sassy','Zesty'];
const _NOUNS = ['Otter','Falcon','Panda','Wolf','Raven','Tiger','Fox','Lynx','Elk','Bear','Gecko','Hippo','Lemur','Mink','Newt'];
function _rndUser() {
  return _ADJS[Math.random()*_ADJS.length|0] + _NOUNS[Math.random()*_NOUNS.length|0] + (1000 + Math.floor(Math.random()*8999));
}
function _uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

// Deterministic hash — MUST match _hashId() in reddit.html and _hash() in comments.js
function _hashId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}
// Seeded count: 4–30 comments, same formula as client card estimate
function _seededCount(videoId) { return 4 + (_hashId(videoId) % 27); }

// Seeded LCG — assigns reply structure deterministically
function _seededRng(videoId) {
  let s = (_hashId(videoId) >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// Wrap flat texts into structured comment objects, some as replies
function _buildComments(texts, videoId) {
  const rng = _seededRng(videoId);
  const out = [];
  for (let i = 0; i < texts.length; i++) {
    let parentId = null;
    // From 3rd comment onwards, ~35% chance of replying to a random earlier top-level
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
      ts: Date.now() - Math.floor(rng() * 86400000 * 14)
    });
  }
  return out;
}

function _cacheFile(videoId) {
  const safe = videoId.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0, 200);
  return path.join(CACHE_DIR, 'comments_' + safe + '.json');
}

function loadCommentFile(videoId) {
  const f = _cacheFile(videoId);
  if (!fs.existsSync(f)) return null; // null = not yet generated (vs [] = generated but empty)
  try {
    const data = JSON.parse(fs.readFileSync(f, 'utf-8'));
    // Migrate old format (plain string array) to structured
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'string') {
      const migrated = data.map(text => ({
        id: 'ai_' + _uid(),
        text,
        author: _rndUser(),
        isAI: true,
        parentId: null,
        ts: Date.now() - Math.floor(Math.random() * 86400000 * 7)
      }));
      saveCommentFile(videoId, migrated);
      return migrated;
    }
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

function saveCommentFile(videoId, comments) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(_cacheFile(videoId), JSON.stringify(comments, null, 2));
}

// ── AI text generation ────────────────────────────────────────────────────────
async function _generateCommentTexts(videoName, count) {
  const sequence = ctx.getSequence();
  try {
    const session = new LlamaChatSession({ contextSequence: sequence });
    const prompt =
      'Generate exactly ' + count + ' realistic, casual internet comments that real users would post under a video titled "' +
      videoName.replace(/"/g,'\\"').replace(/\n/g,' ') + '".\n\n' +
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
    const prompt =
      'A user commented "' + userComment.replace(/"/g,'\\"') + '" on a video titled "' +
      videoName.replace(/"/g,'\\"').replace(/\n/g,' ') + '". ' +
      'Write a short, casual 1-2 sentence reply. Return ONLY the reply text.';
    const raw = await session.prompt(prompt);
    return raw.trim().replace(/^["']|["']$/g,'');
  } finally {
    sequence.dispose();
  }
}

// ── API: GET /api/comments/:id?name=... ───────────────────────────────────────
async function apiGetComments(req, res, videoId) {
  try {
    const urlObj   = new URL('http://x' + req.url);
    const videoName = urlObj.searchParams.get('name') || videoId;

    let comments = loadCommentFile(videoId);

    if (comments === null) {
      // Not yet generated — attempt AI generation
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

// ── API: POST /api/comments/:id/add ──────────────────────────────────────────
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

// ── Legacy endpoints (kept for backward compat) ───────────────────────────────
async function apiGenerateComments(req, res) {
  const body = await readBody(req);
  const { videoId, videoName } = body;
  if (!videoId || !videoName) return json(res, { error: 'Missing params' }, 400);
  // Delegate to new GET handler by synthesising a mock req
  const mockReq = { url: '/api/comments/' + encodeURIComponent(videoId) + '?name=' + encodeURIComponent(videoName) };
  const comments = [];
  const mockRes = {
    writeHead: () => {}, end: (body) => {
      try { const d = JSON.parse(body); comments.push(...(Array.isArray(d) ? d : [])); } catch {}
    }
  };
  await apiGetComments(mockReq, mockRes, videoId);
  // Return in old format { comments: [text, ...] }
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
    const files = fs.readdirSync(CACHE_DIR).filter(f => f.startsWith('comments_') && f.endsWith('.json'));
    files.forEach(f => fs.unlinkSync(path.join(CACHE_DIR, f)));
    return json(res, { ok: true, deleted: files.length });
  } catch (e) {
    return json(res, { error: e.message }, 500);
  }
}

module.exports = {
  initCommentsModel, isModelReady, reinitIfNeeded,
  apiGetComments, apiAddComment,
  apiGenerateComments, apiReplyToComment, apiClearAllComments
};
