'use strict';
// ═══════════════════════════════════════════════════════════════════
//  assistant.js — AI chat proxy via OpenRouter
// ═══════════════════════════════════════════════════════════════════

const https = require('https');
const { readBody, json } = require('./helpers-server');
const { loadPrefs } = require('./db-server');

async function apiAssistantChat(req, res) {
  const body = await readBody(req);
  const { messages, model } = body;

  const prefs = loadPrefs();
  const apiKey = prefs.openrouterApiKey;

  if (!apiKey) {
    return json(res, { error: 'OpenRouter API key not configured. Add it in Settings → AI.' }, 400);
  }

  const payload = JSON.stringify({
    model: model || 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
    messages: messages || [],
    temperature: 0.9,
    max_tokens: 1500,
    stream: true,
  });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const reqOpts = {
    hostname: 'openrouter.ai',
    path: '/api/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'localhost',
      'X-Title': 'AphroArchive',
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  const r = https.request(reqOpts, (resp) => {
    let buffer = '';
    resp.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content || '';
          if (delta) res.write(`data: ${JSON.stringify({ delta })}\n\n`);
          const finishReason = parsed.choices?.[0]?.finish_reason;
          if (finishReason === 'stop') {
            res.write('data: [DONE]\n\n');
            res.end();
          }
        } catch {}
      }
    });
    resp.on('end', () => {
      res.write('data: [DONE]\n\n');
      res.end();
    });
    resp.on('error', (e) => {
      res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
      res.end();
    });
  });

  r.on('error', (e) => {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  });
  r.write(payload);
  r.end();
}

module.exports = { apiAssistantChat };
