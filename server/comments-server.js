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

let getLlama, LlamaChatSession;
try {
  ({ getLlama, LlamaChatSession } = require('node-llama-cpp'));
} catch { /* package not installed */ }

let llama      = null;
let model      = null;
let ctx        = null;
let modelReady = false;

async function initCommentsModel() {
  const prefs = loadPrefs();
  if (!prefs.aiCommentsEnabled) return;

  if (!getLlama) {
    console.warn('[comments] node-llama-cpp not installed — AI comments disabled');
    return;
  }

  if (!fs.existsSync(MODEL_FILE)) {
    console.warn('[comments] Model file not found:', MODEL_FILE);
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
    try { return JSON.parse(fs.readFileSync(cacheFile, 'utf-8')); } catch {}
  }

  const session  = new LlamaChatSession({ contextSequence: ctx.getSequence() });
  const prompt   =
    'Generate between 3 and 5 realistic, casual internet comments that someone might write after watching a video called \'' +
    videoName.replace(/'/g, "\\'") +
    '\'. Return ONLY a valid JSON array of strings, no explanation, no markdown, just the array.';

  let raw = await session.prompt(prompt);
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

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

  fs.writeFileSync(cacheFile, JSON.stringify(comments));
  return comments;
}

async function apiGenerateComments(req, res) {
  const body = await readBody(req);
  const { videoId, videoName } = body;
  if (!videoId || !videoName) return json(res, { error: 'Missing videoId or videoName' }, 400);
  if (!isModelReady()) return json(res, { error: 'AI comments not enabled or model not loaded' }, 400);
  try {
    const comments = await generateComments(videoId, videoName);
    return json(res, { comments });
  } catch (e) {
    return json(res, { error: e.message }, 500);
  }
}

module.exports = { initCommentsModel, isModelReady, reinitIfNeeded, generateComments, apiGenerateComments };
