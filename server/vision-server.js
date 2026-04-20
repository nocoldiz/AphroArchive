'use strict';
// ═══════════════════════════════════════════════════════════════════
//  vision.js — Image description via Claude or Ollama vision
// ═══════════════════════════════════════════════════════════════════

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { spawn } = require('child_process');
const { THUMBS_DIR, PHOTOS_DIR, FFMPEG_BIN } = require('./config-server');
const { loadPrefs } = require('./db-server');
const { json, readBody } = require('./helpers-server');

const PHOTO_MIME = {
  '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png',
  '.gif':'image/gif', '.webp':'image/webp', '.avif':'image/avif',
};

function _extractVideoFrame(videoBuffer) {
  return new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG_BIN, [
      '-i', 'pipe:0', '-vframes', '1', '-vf', 'scale=480:-1',
      '-f', 'image2', '-vcodec', 'mjpeg', 'pipe:1'
    ]);
    const chunks = [];
    let settled = false;
    const done = (err, buf) => { if (settled) return; settled = true; err ? reject(err) : resolve(buf); };
    ff.stdout.on('data', c => chunks.push(c));
    ff.stdout.on('end', () => {
      const buf = Buffer.concat(chunks);
      done(buf.length < 100 ? new Error('Empty frame') : null, buf);
    });
    ff.stderr.on('data', () => {});
    ff.on('error', e => done(e));
    ff.on('close', code => { if (code !== 0) done(new Error('ffmpeg exited with code ' + code)); });
    try { ff.stdin.write(videoBuffer); ff.stdin.end(); } catch (e) { done(e); }
  });
}

async function apiVisionDescribe(req, res) {
  const body = await readBody(req);
  const { source, id, thumbIdx = 0 } = body;

  const prefs    = loadPrefs();
  const provider = prefs.visionProvider || 'ollama';

  let imageBuffer, mimeType;

  try {
    if (source === 'vault') {
      const vault  = require('./vault-server');
      const result = vault.decryptToBuffer(id);
      if (!result) return json(res, { error: 'Vault locked or file not found' }, 400);
      imageBuffer = result.buffer;
      mimeType    = result.mimeType;
    } else if (source === 'vault-video') {
      const vault  = require('./vault-server');
      const result = vault.decryptToBuffer(id);
      if (!result) return json(res, { error: 'Vault locked or file not found' }, 400);
      imageBuffer = await _extractVideoFrame(result.buffer);
      mimeType    = 'image/jpeg';
    } else if (source === 'photo') {
      const rel = Buffer.from(id, 'base64url').toString('utf-8');
      const fp  = path.resolve(path.join(PHOTOS_DIR, rel));
      if (!fp.startsWith(path.resolve(PHOTOS_DIR) + path.sep)) return json(res, { error: 'Invalid path' }, 400);
      if (!fs.existsSync(fp)) return json(res, { error: 'File not found' }, 404);
      imageBuffer = fs.readFileSync(fp);
      const ext   = path.extname(fp).toLowerCase();
      mimeType    = PHOTO_MIME[ext] || 'image/jpeg';
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

  const base64 = imageBuffer.toString('base64');

  try {
    let description;
    if (provider === 'ollama') {
      const ollamaUrl = prefs.ollamaUrl || 'http://127.0.0.1:11434';
      const model     = prefs.ollamaVisionModel || 'minicpm-v';
      description = await _callOllamaVision(ollamaUrl, model, base64);
    } else {
      const apiKey = prefs.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '';
      if (!apiKey) return json(res, { error: 'No Anthropic API key configured. Add it in Settings → AI Vision.' }, 400);
      description = await _callClaudeVision(apiKey, base64, mimeType);
    }
    json(res, { description });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

function _callOllamaVision(ollamaBaseUrl, model, base64Image) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL('/api/generate', ollamaBaseUrl); } catch { url = new URL('http://127.0.0.1:11434/api/generate'); }
    const payload = JSON.stringify({
      model,
      prompt: 'Describe this image concisely in 2-3 sentences. Focus on what is visually depicted.',
      images: [base64Image],
      stream: false,
    });
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request({
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 11434),
      path:     url.pathname,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, r => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error));
          resolve(parsed.response || '');
        } catch { reject(new Error('Failed to parse Ollama response')); }
      });
    });
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Ollama request timed out')); });
    req.on('error', e => reject(new Error('Ollama not reachable: ' + e.message)));
    req.write(payload);
    req.end();
  });
}

function _callClaudeVision(apiKey, base64Image, mimeType) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Image } },
          { type: 'text',  text: 'Describe this image concisely in 2-3 sentences. Focus on what is visually depicted.' }
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
          const text = parsed.content?.[0]?.text || '';
          resolve(text);
        } catch {
          reject(new Error('Failed to parse API response'));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

module.exports = { apiVisionDescribe };
