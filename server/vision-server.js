'use strict';
// ═══════════════════════════════════════════════════════════════════
//  vision-server.js — Image description via local Ollama or Claude API
//  Priority: Ollama (local) → Claude API (remote fallback)
// ═══════════════════════════════════════════════════════════════════

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const { THUMBS_DIR, PHOTOS_DIR } = require('./config-server');
const { loadPrefs } = require('./db-server');
const { json, readBody } = require('./helpers-server');

const PHOTO_MIME = {
  '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png',
  '.gif':'image/gif', '.webp':'image/webp', '.avif':'image/avif',
};

const OLLAMA_HOST = 'http://localhost:11434';
const VISION_PROMPT = 'Describe this image concisely in 2-3 sentences. Focus on what is visually depicted.';

// ── Ollama HTTP helper ────────────────────────────────────────────────────────
function _ollamaRequest(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port: 11434,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, r => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Ollama: invalid JSON response')); }
      });
    });
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Ollama timeout')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function _describeWithOllama(model, imageBuffer) {
  const base64 = imageBuffer.toString('base64');
  const result = await _ollamaRequest('/api/generate', {
    model,
    prompt: VISION_PROMPT,
    images: [base64],
    stream: false,
  });
  if (result.error) throw new Error('Ollama: ' + result.error);
  return (result.response || '').trim();
}

// ── Claude API fallback ───────────────────────────────────────────────────────
function _callClaudeVision(apiKey, base64Image, mimeType) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Image } },
          { type: 'text',  text: VISION_PROMPT }
        ]
      }]
    });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
        'content-length':    Buffer.byteLength(payload),
      }
    }, r => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message || 'API error'));
          resolve(parsed.content?.[0]?.text || '');
        } catch { reject(new Error('Failed to parse API response')); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────
async function apiVisionDescribe(req, res) {
  const body = await readBody(req);
  const { source, id, thumbIdx = 0 } = body;

  const prefs           = loadPrefs();
  const ollamaModel     = (prefs.ollamaVisionModel || '').trim();
  const anthropicApiKey = (prefs.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '').trim();

  if (!ollamaModel && !anthropicApiKey) {
    return json(res, { error: 'No vision model configured. Set an Ollama model (e.g. "moondream") in Settings, or add an Anthropic API key as fallback.' }, 400);
  }

  let imageBuffer, mimeType;
  try {
    if (source === 'vault') {
      const vault  = require('./vault-server');
      const result = vault.decryptToBuffer(id);
      if (!result) return json(res, { error: 'Vault locked or file not found' }, 400);
      imageBuffer = result.buffer;
      mimeType    = result.mimeType;
    } else if (source === 'photo') {
      const rel = Buffer.from(id, 'base64url').toString('utf-8');
      const fp  = path.resolve(path.join(PHOTOS_DIR, rel));
      if (!fp.startsWith(path.resolve(PHOTOS_DIR) + path.sep)) return json(res, { error: 'Invalid path' }, 400);
      if (!fs.existsSync(fp)) return json(res, { error: 'File not found' }, 404);
      imageBuffer = fs.readFileSync(fp);
      mimeType    = PHOTO_MIME[path.extname(fp).toLowerCase()] || 'image/jpeg';
    } else if (source === 'thumb') {
      const thumbPath = path.join(THUMBS_DIR, id, String(thumbIdx) + '.jpg');
      if (!fs.existsSync(thumbPath)) return json(res, { error: 'Thumbnail not found' }, 404);
      imageBuffer = fs.readFileSync(thumbPath);
      mimeType    = 'image/jpeg';
    } else {
      return json(res, { error: 'Invalid source' }, 400);
    }
  } catch (e) {
    return json(res, { error: 'Failed to read image: ' + e.message }, 500);
  }

  // Try Ollama first
  if (ollamaModel) {
    try {
      const description = await _describeWithOllama(ollamaModel, imageBuffer);
      if (description) return json(res, { description, via: 'ollama' });
    } catch (e) {
      const isConnErr = e.code === 'ECONNREFUSED' || e.message.includes('ECONNREFUSED');
      if (!anthropicApiKey) {
        const hint = isConnErr ? 'Ollama is not running. Start it with: ollama serve' : e.message;
        return json(res, { error: hint }, 503);
      }
      // Fall through to Claude API
      console.warn('[vision] Ollama failed (' + e.message + '), falling back to Claude API');
    }
  }

  // Claude API fallback
  if (!anthropicApiKey) return json(res, { error: 'No Anthropic API key configured' }, 400);
  try {
    const description = await _callClaudeVision(anthropicApiKey, imageBuffer.toString('base64'), mimeType);
    json(res, { description, via: 'claude' });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

// ── Ollama model status (for settings UI) ─────────────────────────────────────
function apiVisionStatus(req, res) {
  const r = http.get({ host: '127.0.0.1', port: 11434, path: '/api/tags', timeout: 3000 }, resp => {
    let data = '';
    resp.on('data', c => data += c);
    resp.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        const models = (parsed.models || []).map(m => m.name);
        json(res, { ollama: true, models });
      } catch {
        json(res, { ollama: true, models: [] });
      }
    });
  });
  r.on('error', () => json(res, { ollama: false, models: [] }));
  r.on('timeout', () => { r.destroy(); json(res, { ollama: false, models: [] }); });
}

module.exports = { apiVisionDescribe, apiVisionStatus };
