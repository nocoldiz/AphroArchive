'use strict';
// ═══════════════════════════════════════════════════════════════════
//  comments-server.js — AI comment generation + persistence
// ═══════════════════════════════════════════════════════════════════

const https = require('https');
const { json, readBody } = require('./helpers-server');
const { loadPrefs, loadComments, saveComments, clearAllComments: dbClearAllComments } = require('./db-server');

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

async function _openRouterComplete(prompt, prefs) {
  const apiKey = prefs.openrouterApiKey;
  if (!apiKey) throw new Error('OpenRouter API key not configured');
  const model  = prefs.openrouterModel || 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free';
  const payload = JSON.stringify({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.9,
    max_tokens: 600,
    stream: false,
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'openrouter.ai',
      path:     '/api/v1/chat/completions',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Authorization':  `Bearer ${apiKey}`,
        'HTTP-Referer':   'localhost',
        'X-Title':        'AphroArchive',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (resp) => {
      let buf = '';
      resp.on('data', c => buf += c.toString());
      resp.on('end', () => {
        try {
          const d = JSON.parse(buf);
          if (d.error) return reject(new Error(typeof d.error === 'string' ? d.error : (d.error.message || JSON.stringify(d.error))));
          resolve(d.choices?.[0]?.message?.content || '');
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function _generateCommentTexts(videoName, count) {
  const prefs = loadPrefs();
  const prompt = (prefs.aiCommentMasterPrompt && prefs.aiCommentMasterPrompt.trim())
    ? prefs.aiCommentMasterPrompt.replace(/\{count\}/g, count.toString()).replace(/\{videoName\}/g, videoName.replace(/"/g, '\\"').replace(/\n/g, ' '))
    : 'Generate exactly ' + count + ' realistic, casual internet comments that real users would post under a video titled "' +
    videoName.replace(/"/g, '\\"').replace(/\n/g, ' ') + '".\n\n' +
    'Vary them: mix of very short reactions, detailed praise, funny one-liners, and relatable observations. Make them feel like real different people.\n\n' +
    'Return ONLY a valid JSON array of exactly ' + count + ' strings: ["comment 1", "comment 2", ...]\n' +
    'No explanation, no markdown — just the raw JSON array.';

  const raw    = await _openRouterComplete(prompt, prefs);
  const parsed = JSON.parse(raw.trim());
  if (!Array.isArray(parsed)) throw new Error('not array');
  return parsed.filter(c => typeof c === 'string' && c.trim()).slice(0, count);
}

async function _generateReplyText(videoName, userComment) {
  const prefs = loadPrefs();
  const prompt = (prefs.aiReplyMasterPrompt && prefs.aiReplyMasterPrompt.trim())
    ? prefs.aiReplyMasterPrompt.replace(/\{userComment\}/g, userComment.replace(/"/g, '\\"')).replace(/\{videoName\}/g, videoName.replace(/"/g, '\\"').replace(/\n/g, ' '))
    : 'A user commented "' + userComment.replace(/"/g, '\\"') + '" on a video titled "' +
    videoName.replace(/"/g, '\\"').replace(/\n/g, ' ') + '". ' +
    'Write a short, casual 1-2 sentence reply. Return ONLY the reply text.';

  const raw = await _openRouterComplete(prompt, prefs);
  return raw.trim().replace(/^["']|["']$/g, '');
}

// ── API: GET /api/comments/:id?name=... ───────────────────────────────────────

async function apiGetComments(req, res, videoId) {
  try {
    const urlObj = new URL('http://x' + req.url);
    const videoName = urlObj.searchParams.get('name') || videoId;

    let comments = loadCommentFile(videoId);

    if (comments === null) {
      const prefs = loadPrefs();
      const canGenerate = prefs.aiCommentsEnabled && prefs.openrouterApiKey;
      if (canGenerate) {
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
    const canReply = prefs.aiCommentsEnabled && videoName && prefs.openrouterApiKey;
    if (canReply) {
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
  if (!prefs.openrouterApiKey) return json(res, { error: 'OpenRouter API key not configured' }, 503);
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
  apiGetComments, apiAddComment,
  apiGenerateComments, apiReplyToComment, apiClearAllComments,
};
