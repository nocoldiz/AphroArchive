'use strict';
// ═══════════════════════════════════════════════════════════════════
//  assistant-server.js — AI chat via OpenRouter or local llama.cpp
// ═══════════════════════════════════════════════════════════════════

const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const { readBody, json } = require('./helpers-server');
const { loadPrefs } = require('./db-server');

const MODELS_DIR = path.join(process.cwd(), 'models');

// Indirect reference prevents pkg from bundling node-llama-cpp (ESM/import.meta incompatible)
const _llamaMod = 'node' + '-llama-cpp';

// ── Local llama state ──────────────────────────────────────────────

let localLlama     = null;
let localModel     = null;
let localCtx       = null;
let localModelPath = null;

async function _ensureLocalModel(modelPath) {
  if (localCtx && localModelPath === modelPath) return true;
  try {
    const { getLlama } = await import(_llamaMod);
    if (!localLlama) localLlama = await getLlama();
    if (localModel && localModelPath !== modelPath) {
      try { await localModel.dispose(); } catch {}
      localModel = null; localCtx = null;
    }
    localModel     = await localLlama.loadModel({ modelPath });
    localCtx       = await localModel.createContext();
    localModelPath = modelPath;
    return true;
  } catch (e) {
    console.error('[assistant] Failed to load local model:', e.message);
    return false;
  }
}

// ── API: POST /api/assistant/chat ──────────────────────────────────

async function apiAssistantChat(req, res) {
  const body   = await readBody(req);
  const { messages, model } = body;
  const prefs  = loadPrefs();
  const provider = prefs.assistantProvider || 'openrouter';

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
  });

  const send = (data) => { if (!res.writableEnded) res.write(data); };
  const done = ()     => { if (!res.writableEnded) { res.write('data: [DONE]\n\n'); res.end(); } };

  if (provider === 'local') {
    // model field is a path to a local GGUF file
    const modelPath = model;
    if (!modelPath || !fs.existsSync(modelPath)) {
      send(`data: ${JSON.stringify({ error: 'Local model path not found: ' + (modelPath || 'none') })}\n\n`);
      return done();
    }
    try {
      const { LlamaChatSession } = await import(_llamaMod);
      const ok = await _ensureLocalModel(modelPath);
      if (!ok) {
        send(`data: ${JSON.stringify({ error: 'Failed to load local model' })}\n\n`);
        return done();
      }
      const sequence = localCtx.getSequence();
      try {
        const session = new LlamaChatSession({ contextSequence: sequence });
        // Flatten messages for llama: system prompt injected as first user context
        const sysMsg = (messages || []).find(m => m.role === 'system');
        if (sysMsg) session.setChatHistory([{ type: 'system', text: sysMsg.content }]);
        const userMessages = (messages || []).filter(m => m.role !== 'system');
        const lastUser = userMessages.filter(m => m.role === 'user').pop();
        if (!lastUser) { send(`data: ${JSON.stringify({ error: 'No user message' })}\n\n`); return done(); }

        // Build prior turns as context
        const priorTurns = userMessages.slice(0, -1);
        if (priorTurns.length > 0) {
          const history = [];
          for (const m of priorTurns) {
            if (m.role === 'user')      history.push({ type: 'user', text: m.content });
            if (m.role === 'assistant') history.push({ type: 'model', response: [m.content] });
          }
          session.setChatHistory([
            ...(sysMsg ? [{ type: 'system', text: sysMsg.content }] : []),
            ...history,
          ]);
        }

        await session.prompt(lastUser.content, {
          onToken: (tokens) => {
            const text = localModel.detokenize(tokens);
            if (text) send(`data: ${JSON.stringify({ delta: text })}\n\n`);
          },
        });
        done();
      } finally {
        sequence.dispose();
      }
    } catch (e) {
      send(`data: ${JSON.stringify({ error: e.message })}\n\n`);
      done();
    }
    return;
  }

  // ── OpenRouter path ──────────────────────────────────────────────
  const apiKey = prefs.openrouterApiKey;
  if (!apiKey) {
    send(`data: ${JSON.stringify({ error: 'OpenRouter API key not configured. Add it in Settings → AI.' })}\n\n`);
    return done();
  }

  const payload = JSON.stringify({
    model: model || 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
    messages: messages || [],
    temperature: 0.9,
    max_tokens: 1500,
    stream: true,
  });

  const reqOpts = {
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
  };

  const r = https.request(reqOpts, (resp) => {
    if (resp.statusCode !== 200) {
      let buf = '';
      resp.on('data', c => buf += c.toString());
      resp.on('end', () => {
        let msg = `OpenRouter error ${resp.statusCode}`;
        try { const d = JSON.parse(buf); msg = (typeof d.error === 'string' ? d.error : d.error?.message) || msg; } catch {}
        send(`data: ${JSON.stringify({ error: msg })}\n\n`); done();
      });
      return;
    }

    let buffer = '';
    resp.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') { done(); return; }
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            const msg = typeof parsed.error === 'string' ? parsed.error : (parsed.error.message || JSON.stringify(parsed.error));
            send(`data: ${JSON.stringify({ error: msg })}\n\n`); done(); return;
          }
          const delta = parsed.choices?.[0]?.delta?.content || '';
          if (delta) send(`data: ${JSON.stringify({ delta })}\n\n`);
          if (parsed.choices?.[0]?.finish_reason === 'stop') { done(); return; }
        } catch {}
      }
    });
    resp.on('end', done);
    resp.on('error', (e) => { send(`data: ${JSON.stringify({ error: e.message })}\n\n`); done(); });
  });

  r.on('error', (e) => { send(`data: ${JSON.stringify({ error: e.message })}\n\n`); done(); });
  r.write(payload);
  r.end();
}

// ── API: GET /api/models/scan ──────────────────────────────────────

function _scanDir(dir, exts) {
  const results = [];
  if (!dir || !fs.existsSync(dir)) return results;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        results.push(..._scanDir(full, exts));
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (exts.includes(ext)) {
          let size = 0;
          try { size = fs.statSync(full).size; } catch {}
          results.push({ name: e.name, path: full, size });
        }
      }
    }
  } catch {}
  return results;
}

function apiScanModels(req, res) {
  const prefs = loadPrefs();
  const comfyPath = prefs.comfyuiPath || '';

  // Local LLM models (GGUF)
  const llmModels = _scanDir(MODELS_DIR, ['.gguf']);

  // ComfyUI models — scan standard subdirs
  const comfyResult = { checkpoints: [], loras: [], vaes: [], embeddings: [], unet: [], gguf: [], text_encoders: [], clip: [] };
  if (comfyPath) {
    const modelsBase = path.join(comfyPath, 'models');
    comfyResult.checkpoints   = _scanDir(path.join(modelsBase, 'checkpoints'),   ['.safetensors', '.ckpt', '.pt']);
    comfyResult.loras         = _scanDir(path.join(modelsBase, 'loras'),         ['.safetensors', '.pt']);
    comfyResult.vaes          = _scanDir(path.join(modelsBase, 'vae'),           ['.safetensors', '.pt']);
    comfyResult.embeddings    = _scanDir(path.join(modelsBase, 'embeddings'),    ['.safetensors', '.pt']);
    comfyResult.unet          = _scanDir(path.join(modelsBase, 'unet'),          ['.safetensors', '.gguf']);
    comfyResult.gguf          = _scanDir(path.join(modelsBase, 'gguf'),          ['.gguf']);
    comfyResult.text_encoders = _scanDir(path.join(modelsBase, 'text_encoders'), ['.safetensors', '.gguf']);
    comfyResult.clip          = _scanDir(path.join(modelsBase, 'clip'),          ['.safetensors', '.pt']);
  }

  return json(res, { llm: llmModels, comfyui: comfyResult });
}

module.exports = { apiAssistantChat, apiScanModels };
