'use strict';
// ═══════════════════════════════════════════════════════════════════
//  prompts.js — AI prompt storage and ComfyUI integration
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const http = require('http');
const { randomUUID } = require('crypto');
const { PROMPTS_FILE, COMFYUI_WORKFLOWS_DIR } = require('./config');
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

// ── ComfyUI workflow listing ─────────────────────────────────────────

async function apiComfyWorkflows(req, res) {
  try {
    fs.mkdirSync(COMFYUI_WORKFLOWS_DIR, { recursive: true });
    const files = fs.readdirSync(COMFYUI_WORKFLOWS_DIR)
      .filter(f => f.endsWith('.json'))
      .sort()
      .map(f => ({ name: f.replace(/\.json$/, ''), file: f }));
    json(res, files);
  } catch {
    json(res, []);
  }
}

// ── ComfyUI send prompt ──────────────────────────────────────────────

async function apiComfySend(req, res) {
  const body = await readBody(req);
  const { text, workflow } = body;
  if (!text) return json(res, { error: 'text required' }, 400);
  if (!workflow) return json(res, { error: 'workflow required' }, 400);

  const wfPath = path.join(COMFYUI_WORKFLOWS_DIR, workflow + '.json');
  if (!fs.existsSync(wfPath)) return json(res, { error: 'workflow not found' }, 404);

  let wf;
  try { wf = JSON.parse(fs.readFileSync(wfPath, 'utf-8')); }
  catch { return json(res, { error: 'invalid workflow JSON' }, 400); }

  // Array of recognized text/string node class types in ComfyUI (Native + Custom nodes)
  const textNodeClasses = [
    'CLIPTextEncode',
    'CLIPTextEncodeSDXL',
    'CLIPTextEncodeSDXLRefiner',
    'Text Multiline',    // Requested explicitly
    'MultilineText',     // Alternate custom node naming
    'CR Text',           // ComfyRoll Custom Node
    'Text',
    'String',
    'TextNode'
  ];

  // Inject the prompt text into the first recognized text node.
  let injected = false;
  for (const nodeId of Object.keys(wf)) {
    const node = wf[nodeId];
    
    // Check if node exists, has inputs, and matches a recognized text node type
    if (node && node.inputs && textNodeClasses.some(cls => node.class_type === cls || node.class_type.includes('Text Multiline'))) {
      
      let updated = false;

      // 1. Standard 'text' input (CLIPTextEncode, Text Multiline)
      if (typeof node.inputs.text === 'string') {
        node.inputs.text = text;
        updated = true;
      }
      // 2. Custom nodes that use 'string' as the input key
      else if (typeof node.inputs.string === 'string') {
        node.inputs.string = text;
        updated = true;
      }
      // 3. SDXL Advanced inputs (text_g, text_l)
      else if (typeof node.inputs.text_g === 'string' || typeof node.inputs.text_l === 'string') {
        if (typeof node.inputs.text_g === 'string') node.inputs.text_g = text;
        if (typeof node.inputs.text_l === 'string') node.inputs.text_l = text;
        updated = true;
      }

      if (updated) {
        injected = true;
        break; // Stop after injecting into the first positive-prompt/text node
      }
    }
  }
  
  if (!injected) return json(res, { error: 'No compatible Text or CLIPTextEncode node found in workflow' }, 422);

  const payload = JSON.stringify({ prompt: wf, client_id: 'aphroarchive' });
  const result  = await new Promise(resolve => {
    const req2 = http.request(
      { hostname: '127.0.0.1', port: 8188, path: '/prompt', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      r2 => {
        let data = '';
        r2.on('data', c => data += c);
        r2.on('end', () => {
          try { resolve({ ok: true, data: JSON.parse(data) }); }
          catch  { resolve({ ok: true, data }); }
        });
      }
    );
    req2.on('error', e => resolve({ ok: false, error: e.message }));
    req2.setTimeout(5000, () => { req2.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req2.write(payload);
    req2.end();
  });

  if (!result.ok) return json(res, { error: result.error || 'ComfyUI unreachable' }, 502);
  json(res, { ok: true, comfyData: result.data });
}

module.exports = {
  apiGetPrompts, apiAddPrompt, apiUpdatePrompt, apiDeletePrompt,
  apiComfyStatus, apiComfyWorkflows, apiComfySend,
};