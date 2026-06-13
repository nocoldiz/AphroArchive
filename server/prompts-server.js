'use strict';
// ═══════════════════════════════════════════════════════════════════
//  prompts.js — AI prompt storage + wildcard-based prompt builder
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const http = require('http');
const { randomUUID } = require('crypto');
const { DB_DIR } = require('./config-server');
const { json, readBody } = require('./helpers-server');
const { loadPrompts, savePrompt, updatePrompt: dbUpdatePrompt, deletePrompt: dbDeletePrompt, deleteAllPrompts: dbDeleteAllPrompts } = require('./db-server');

const WILDCARDS_DIR = path.join(DB_DIR, 'wildcards');

// ── Handlers ─────────────────────────────────────────────────────────

async function apiGetPrompts(req, res) {
  json(res, loadPrompts());
}

async function apiAddPrompt(req, res) {
  const body = await readBody(req);
  const text = (body.text || '').trim();
  if (!text) return json(res, { error: 'text required' }, 400);
  const prompt = {
    id: randomUUID(),
    text,
    sites: Array.isArray(body.sites) ? body.sites : [],
    createdAt: Date.now(),
  };
  savePrompt(prompt);
  json(res, prompt);
}

async function apiUpdatePrompt(req, res, id) {
  const body = await readBody(req);
  const fields = {};
  if (body.text !== undefined) fields.text = body.text.trim();
  if (Array.isArray(body.sites)) fields.sites = body.sites;
  const ok = dbUpdatePrompt(id, fields);
  if (!ok) return json(res, { error: 'not found' }, 404);
  const updated = loadPrompts().find(p => p.id === id);
  json(res, updated || { ok: true });
}

async function apiDeletePrompt(req, res, id) {
  dbDeletePrompt(id);
  json(res, { ok: true });
}

async function apiDeleteAllPrompts(req, res) {
  dbDeleteAllPrompts();
  json(res, { success: true });
}

// In your main server router (likely where other /api/prompts routes are defined):
// Example: if (path === '/api/prompts/all' && method === 'DELETE') return apiDeleteAllPrompts(req, res);

// ── Local Llama via Ollama ────────────────────────────────────────────

async function apiRunLocal(req, res) {
  const body  = await readBody(req);
  const text  = (body.text || '').trim();
  const model = (body.model || 'llama3').trim();
  if (!text) return json(res, { error: 'text required' }, 400);

  const payload = JSON.stringify({ model, prompt: text, stream: false });

  const response = await new Promise(resolve => {
    const r = http.request(
      { hostname: '127.0.0.1', port: 11434, path: '/api/generate', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      res2 => {
        let data = '';
        res2.on('data', c => data += c);
        res2.on('end', () => {
          try { resolve({ ok: true, data: JSON.parse(data) }); }
          catch { resolve({ ok: false, error: 'invalid JSON from ollama' }); }
        });
      }
    );
    r.on('error', e => resolve({ ok: false, error: 'Ollama not reachable: ' + e.message }));
    r.setTimeout(120000, () => { r.destroy(); resolve({ ok: false, error: 'timeout' }); });
    r.write(payload);
    r.end();
  });

  if (!response.ok) return json(res, { error: response.error }, 502);
  json(res, { response: response.data.response || '' });
}

// ── Wildcards (used by the prompt builder) ────────────────────────────

function apiGetWildcardAssets(req, res) {
  let wildcards = [];
  try {
    fs.mkdirSync(WILDCARDS_DIR, { recursive: true });
    wildcards = fs.readdirSync(WILDCARDS_DIR)
      .filter(f => f.toLowerCase().endsWith('.txt'))
      .map(f => {
        const fp = path.join(WILDCARDS_DIR, f);
        try {
          const lines = fs.readFileSync(fp, 'utf-8')
            .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
          return { name: path.basename(f, '.txt'), file: f, count: lines.length, preview: lines.slice(0, 5) };
        } catch { return { name: path.basename(f, '.txt'), file: f, count: 0, preview: [] }; }
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {}
  json(res, { wildcards });
}

function apiGetWildcard(req, res, name) {
  const fp = path.join(WILDCARDS_DIR, path.basename(name) + '.txt');
  try {
    const content = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf-8') : '';
    json(res, { name, content, lines: content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')) });
  } catch (e) { json(res, { error: e.message }, 500); }
}

async function apiSaveWildcard(req, res, name) {
  const body = await readBody(req);
  const safeName = path.basename(name).replace(/[^a-zA-Z0-9_\-]/g, '_');
  if (!safeName) return json(res, { error: 'Invalid name' }, 400);
  try {
    fs.mkdirSync(WILDCARDS_DIR, { recursive: true });
    const fp = path.join(WILDCARDS_DIR, safeName + '.txt');
    fs.writeFileSync(fp, body.content || '', 'utf-8');
    const lines = (body.content || '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    json(res, { ok: true, name: safeName, count: lines.length });
  } catch (e) { json(res, { error: e.message }, 500); }
}

function apiDeleteWildcard(req, res, name) {
  const fp = path.join(WILDCARDS_DIR, path.basename(name) + '.txt');
  try { fs.unlinkSync(fp); } catch {}
  json(res, { ok: true });
}

function apiExportAllWildcards(req, res) {
  const result = {};
  try {
    fs.mkdirSync(WILDCARDS_DIR, { recursive: true });
    fs.readdirSync(WILDCARDS_DIR)
      .filter(f => f.toLowerCase().endsWith('.txt'))
      .forEach(f => {
        const name = path.basename(f, '.txt');
        try { result[name] = fs.readFileSync(path.join(WILDCARDS_DIR, f), 'utf-8'); } catch {}
      });
  } catch {}
  json(res, result);
}

async function apiImportAllWildcards(req, res) {
  const body = await readBody(req);
  let created = 0, updated = 0;
  try {
    fs.mkdirSync(WILDCARDS_DIR, { recursive: true });
    for (const [name, content] of Object.entries(body)) {
      const safeName = String(name).replace(/[^a-zA-Z0-9_\-]/g, '_');
      if (!safeName) continue;
      const fp = path.join(WILDCARDS_DIR, safeName + '.txt');
      const exists = fs.existsSync(fp);
      fs.writeFileSync(fp, String(content), 'utf-8');
      exists ? updated++ : created++;
    }
  } catch (e) { return json(res, { error: e.message }, 500); }
  json(res, { ok: true, created, updated });
}

module.exports = {
  apiGetPrompts, apiAddPrompt, apiUpdatePrompt, apiDeletePrompt,
  apiDeleteAllPrompts, apiRunLocal,
  apiGetWildcardAssets, apiGetWildcard, apiSaveWildcard, apiDeleteWildcard,
  apiExportAllWildcards, apiImportAllWildcards,
};