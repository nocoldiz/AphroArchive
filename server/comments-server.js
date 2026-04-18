'use strict';
// ═══════════════════════════════════════════════════════════════════
//  comments-server.js — AI comment generation via node-llama-cpp
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { json, readBody } = require('./helpers-server');
const { loadPrefs } = require('./db-server');
const { CACHE_DIR } = require('./config-server');

const MODELS_DIR   = path.join(process.cwd(), 'models');
const MODEL_FILE   = path.join(MODELS_DIR, 'llama-3.2-1b-instruct.gguf');

let getLlama      = null;
let LlamaChatSession = null;

let llama      = null;
let model      = null;
let ctx        = null;
let modelReady = false;

async function initCommentsModel() {
  const prefs = loadPrefs();
  if (!prefs.aiCommentsEnabled) return;

  if (!fs.existsSync(MODEL_FILE)) {
    console.warn('[comments] Model file not found:', MODEL_FILE);
    return;
  }

  try {
    ({ getLlama, LlamaChatSession } = await import('node-llama-cpp'));
  } catch (e) {
    console.warn('[comments] node-llama-cpp not installed — AI comments disabled:', e.message);
    return;
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

function isModelReady() {
  return modelReady;
}

async function reinitIfNeeded() {
  if (!modelReady) await initCommentsModel();
}

async function generateComments(videoId, videoName) {
const cacheFile = path.join(CACHE_DIR, 'comments_' + videoId + '.json');
  if (fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      console.log('[comments] cached "' + videoName + '":', cached);
      return cached;
    } catch {}
  }

  console.log('[comments] generating for "' + videoName + '"…');
  try {
  const session  = new LlamaChatSession({ contextSequence: ctx.getSequence() });
const prompt = 
    'Generate between 3 and 5 realistic, casual, vulgar internet comments that real users would post under a porn video titled "' +
    videoName.replace(/"/g, '\\"').replace(/\n/g, ' ') +
    '".\n\n' +
    'Vary them: some very short and horny, some praising the performer or specific acts, some funny or exaggerated.\n\n' +
    'Return ONLY a valid JSON array of strings like this: ["comment 1", "comment 2", ...]\n' +
    'No explanation, no extra text, no markdown, no numbering — just the raw JSON array.';
  let raw = await session.prompt(prompt);
raw = await session.prompt(prompt);
  } finally {
    // 2. CRITICAL: Dispose of the sequence to prevent "No sequences left" error
    sequence.dispose();
  }
  let comments;
  try {
    comments = JSON.parse(raw);
    if (!Array.isArray(comments)) throw new Error('not array');
  } catch {
    comments = [
      'Really enjoyed this one!',
      'Great video, thanks for sharing ' + videoName,
      'Came back to watch this again'
    ];
  }

  console.log('[comments] generated for "' + videoName + '":', comments);
  fs.writeFileSync(cacheFile, JSON.stringify(comments));
  return comments;
}

function fallbackComments(videoName) {
  const name = videoName;
  return [
    'This one is actually really good',
    'Been looking for something like ' + name + ' for a while',
    'Not bad at all, saved for later',
    'The ending surprised me tbh',
    'Anyone else come back to rewatch this?'
  ].sort(() => Math.random() - 0.5).slice(0, 3 + Math.floor(Math.random() * 3));
}

async function apiGenerateComments(req, res) {
  const body = await readBody(req);
  const { videoId, videoName } = body;
  if (!videoId || !videoName) return json(res, { error: 'Missing videoId or videoName' }, 400);

  const prefs = loadPrefs();
  if (!prefs.aiCommentsEnabled) return json(res, { error: 'AI comments disabled' }, 400);

  // ADD THIS LINE: Try to initialize the model if it isn't ready yet
  await reinitIfNeeded(); 

  try {
    let comments;
    if (isModelReady()) {
      comments = await generateComments(videoId, videoName);
    } else {
      console.log('[comments] model not ready (getLlama=' + !!getLlama + ', modelFile=' + fs.existsSync(MODEL_FILE) + ') — using fallback for "' + videoName + '"');
      comments = fallbackComments(videoName);
      console.log('[comments] fallback for "' + videoName + '":', comments);
    }
    return json(res, { comments });
  } catch (e) {
    console.error('[comments] error:', e.message);
    return json(res, { error: e.message }, 500);
  }
}

async function generateReply(videoName, userComment) {
  const session = new LlamaChatSession({ contextSequence: ctx.getSequence() });
  const prompt =
    'A user commented "' + userComment.replace(/"/g, '\\"') + '" on a video titled "' +
    videoName.replace(/"/g, '\\"').replace(/\n/g, ' ') + '". ' +
    'Write a short, casual 1-2 sentence reply. Return ONLY the reply text, nothing else.';
  const raw = await session.prompt(prompt);
  return raw.trim().replace(/^["']|["']$/g, '');
}

function fallbackReply() {
  const r = ['Totally agree!', 'Yeah exactly lol', 'Facts', 'Same here', 'Couldn\'t agree more', 'Real talk'];
  return r[Math.floor(Math.random() * r.length)];
}

async function apiReplyToComment(req, res) {
  const body = await readBody(req);
  const { videoId, videoName, userComment } = body;
  if (!videoId || !videoName || !userComment) return json(res, { error: 'Missing params' }, 400);
  const prefs = loadPrefs();
  if (!prefs.aiCommentsEnabled) return json(res, { error: 'AI comments disabled' }, 400);
  await reinitIfNeeded();
  try {
    const reply = isModelReady() ? await generateReply(videoName, userComment) : fallbackReply();
    return json(res, { reply });
  } catch (e) {
    return json(res, { error: e.message }, 500);
  }
}

module.exports = { initCommentsModel, isModelReady, reinitIfNeeded, generateComments, apiGenerateComments, apiReplyToComment };
