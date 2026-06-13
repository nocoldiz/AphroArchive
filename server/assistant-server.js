'use strict';
// ═══════════════════════════════════════════════════════════════════
//  assistant-server.js — AI chat via OpenRouter
// ═══════════════════════════════════════════════════════════════════

const https  = require('https');
const { readBody } = require('./helpers-server');
const { loadPrefs } = require('./db-server');

// ── API: POST /api/assistant/chat ──────────────────────────────────

async function apiAssistantChat(req, res) {
  const body   = await readBody(req);
  const { messages, model } = body;
  const prefs  = loadPrefs();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
  });

  const send = (data) => { if (!res.writableEnded) res.write(data); };
  const done = ()     => { if (!res.writableEnded) { res.write('data: [DONE]\n\n'); res.end(); } };

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

module.exports = { apiAssistantChat };
