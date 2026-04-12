'use strict';
// ═══════════════════════════════════════════════════════════════════
//  remote.js — Server-Sent Events remote control API
// ═══════════════════════════════════════════════════════════════════

const { json, readBody } = require('./helpers');

const _remoteClients = new Set();

function apiRemoteEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(':\n\n');
  _remoteClients.add(res);
  const hb = setInterval(() => { try { res.write(':\n\n'); } catch { clearInterval(hb); } }, 25000);
  req.on('close', () => { _remoteClients.delete(res); clearInterval(hb); });
}

async function apiRemoteCommand(req, res) {
  const body = await readBody(req);
  if (!body || !body.action) return json(res, { error: 'action required' }, 400);
  const payload = JSON.stringify(body);
  let sent = 0;
  for (const client of _remoteClients) {
    try { client.write('data: ' + payload + '\n\n'); sent++; } catch {}
  }
  json(res, { ok: true, sent });
}

module.exports = { apiRemoteEvents, apiRemoteCommand };
