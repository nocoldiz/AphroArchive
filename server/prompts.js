'use strict';
// ═══════════════════════════════════════════════════════════════════
//  prompts.js — AI prompt storage and ComfyUI integration
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const http = require('http');
const { randomUUID } = require('crypto');
const { PROMPTS_FILE } = require('./config');
const { json, readBody } = require('./helpers');

// ── Storage ──────────────────────────────────────────────────────────

function loadPrompts() {
  try { return JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf-8')); } catch { return []; }
}

function savePrompts(arr) {
  fs.writeFileSync(PROMPTS_FILE, JSON.stringify(arr));
}

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
  const arr = loadPrompts();
  arr.unshift(prompt);
  savePrompts(arr);
  json(res, prompt);
}

async function apiUpdatePrompt(req, res, id) {
  const body = await readBody(req);
  const arr = loadPrompts();
  const idx = arr.findIndex(p => p.id === id);
  if (idx < 0) return json(res, { error: 'not found' }, 404);
  if (body.text !== undefined) arr[idx].text = body.text.trim();
  if (Array.isArray(body.sites)) arr[idx].sites = body.sites;
  savePrompts(arr);
  json(res, arr[idx]);
}

async function apiDeletePrompt(req, res, id) {
  const arr = loadPrompts().filter(p => p.id !== id);
  savePrompts(arr);
  json(res, { ok: true });
}

// ── ComfyUI status check ─────────────────────────────────────────────

async function apiComfyStatus(req, res) {
  const ok = await new Promise(resolve => {
    const r = http.get({ host: '127.0.0.1', port: 8188, path: '/system_stats' }, () => resolve(true));
    r.on('error', () => resolve(false));
    r.setTimeout(1500, () => { r.destroy(); resolve(false); });
  });
  json(res, { ok });
}

module.exports = { apiGetPrompts, apiAddPrompt, apiUpdatePrompt, apiDeletePrompt, apiComfyStatus };
