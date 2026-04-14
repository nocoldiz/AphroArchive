// ─── AI Prompts ───

const PROMPT_SITES = [
  // ── General chat ──
  { id: 'chatgpt',    name: 'ChatGPT',      url: 'https://chatgpt.com/' },
  { id: 'claude',     name: 'Claude',       url: 'https://claude.ai/new' },
  { id: 'gemini',     name: 'Gemini',       url: 'https://gemini.google.com/app' },
  { id: 'grok',       name: 'Grok',         url: 'https://grok.com/' },
  { id: 'perplexity', name: 'Perplexity',   url: 'https://perplexity.ai/' },
  { id: 'mistral',    name: 'Le Chat',      url: 'https://chat.mistral.ai/chat' },
  { id: 'copilot',    name: 'Copilot',      url: 'https://copilot.microsoft.com/' },
  { id: 'deepseek',   name: 'DeepSeek',     url: 'https://chat.deepseek.com/' },
  { id: 'meta',       name: 'Meta AI',      url: 'https://www.meta.ai/' },
  { id: 'groq',       name: 'Groq',         url: 'https://chat.groq.com/' },
  { id: 'huggingchat',name: 'HuggingChat',  url: 'https://huggingface.co/chat/' },
  { id: 'poe',        name: 'Poe',          url: 'https://poe.com/' },
  { id: 'you',        name: 'You.com',      url: 'https://you.com/' },
  { id: 'phind',      name: 'Phind',        url: 'https://www.phind.com/' },
  { id: 'cohere',     name: 'Cohere',       url: 'https://coral.cohere.com/' },
  { id: 'qwen',       name: 'Qwen',         url: 'https://chat.qwenlm.ai/' },
  { id: 'kimi',       name: 'Kimi',         url: 'https://kimi.moonshot.cn/' },
  { id: 'venice',     name: 'Venice AI',    url: 'https://venice.ai/' },
  { id: 'pi',         name: 'Pi AI',        url: 'https://pi.ai/talk' },
  // ── Image generation ──
  { id: 'midjourney', name: 'Midjourney',   url: 'https://www.midjourney.com/imagine' },
  { id: 'ideogram',   name: 'Ideogram',     url: 'https://ideogram.ai/' },
  { id: 'leonardo',   name: 'Leonardo AI',  url: 'https://app.leonardo.ai/' },
  { id: 'playground', name: 'Playground',   url: 'https://playground.com/' },
  { id: 'fal',        name: 'fal.ai',       url: 'https://fal.ai/models' },
  // ── Local ──
  { id: 'comfyui',    name: 'ComfyUI',      url: 'http://127.0.0.1:8188', local: true },
  { id: 'a1111',      name: 'A1111',        url: 'http://127.0.0.1:7860', local: true },
  { id: 'lmstudio',   name: 'LM Studio',    url: 'http://localhost:1234',  local: true },
];

let _prompts          = [];
let _editId           = null;   // id being edited, null = new
let _comfyOk          = false;  // whether ComfyUI was reachable on last check
let _workflows        = [];     // list of available ComfyUI workflow files
let _selectedWorkflow = '';     // currently selected workflow name

// ─── View ───

async function showPrompts() {
  closeAllViews();
  promptsMode = true;
  $('browse-view').add('off');
  $('prompts-view').add('on');
  $('prompts-sidebar').add('on');
  if (location.pathname !== '/prompts') history.pushState(null, '', '/prompts');
  await loadPrompts();
  renderPromptsTable();
  // Background: check ComfyUI status and load workflows
  Promise.all([
    fetch('/api/comfyui/status').then(r => r.json()).catch(() => ({ ok: false })),
    fetch('/api/comfyui/workflows').then(r => r.json()).catch(() => []),
  ]).then(([status, workflows]) => {
    _comfyOk   = status.ok;
    _workflows = Array.isArray(workflows) ? workflows : [];
    renderComfyWorkflowBar();
    renderPromptsTable(); // re-render so send buttons reflect comfy state
  });
}

async function loadPrompts() {
  try { _prompts = await (await fetch('/api/prompts')).json(); }
  catch { _prompts = []; }
}

// ─── ComfyUI workflow bar ───

function renderComfyWorkflowBar() {
  const bar    = document.getElementById('comfyui-workflow-bar');
  const select = document.getElementById('comfyui-workflow-select');
  const hint   = document.getElementById('comfyui-bar-hint');
  if (!bar || !select) return;

  if (!_comfyOk) { bar.style.display = 'none'; return; }

  bar.style.display = 'flex';

  // Rebuild the <select> options
  const prev = select.value;
  select.innerHTML = '<option value="">Select workflow…</option>';
  _workflows.forEach(w => {
    const opt = document.createElement('option');
    opt.value       = w.name;
    opt.textContent = w.name;
    select.appendChild(opt);
  });

  // Restore previous selection if still available
  if (prev && _workflows.some(w => w.name === prev)) {
    select.value      = prev;
    _selectedWorkflow = prev;
  } else {
    _selectedWorkflow = '';
  }

  if (_workflows.length === 0) {
    hint.textContent = 'No workflows found — drop .json files into cache/comfyui-workflows/';
  } else {
    hint.textContent = '';
  }
}

function onWorkflowSelect(sel) {
  _selectedWorkflow = sel.value;
  // Re-render so send buttons enable/disable correctly
  renderPromptsTable();
}

// ─── Table rendering ───

function renderPromptsTable() {
  const tbody = document.getElementById('prompts-tbody');
  const empty = document.getElementById('prompts-empty');
  const table = document.getElementById('prompts-table');
  if (!tbody) return;
  if (!_prompts.length) {
    table.style.display = 'none';
    if (empty) empty.style.display = 'flex';
    return;
  }
  table.style.display = '';
  if (empty) empty.style.display = 'none';
  const showComfyBtn = _comfyOk;
  tbody.innerHTML = _prompts.map((p, i) => {
    const comfyBtn = showComfyBtn
      ? '<button class="pt-btn-comfy" onclick="sendToComfyUI(\'' + escA(p.id) + '\')"' +
          (_selectedWorkflow ? '' : ' disabled') +
          ' title="' + (_selectedWorkflow ? 'Send to ComfyUI — ' + escA(_selectedWorkflow) : 'Select a workflow first') + '">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>' +
        '</button>'
      : '';
    return '<tr>' +
      '<td class="pt-col-num">' + (i + 1) + '</td>' +
      '<td class="pt-col-text"><div class="pt-text" title="' + escA(p.text) + '">' + esc(p.text) + '</div></td>' +
      '<td class="pt-col-sites">' + renderSiteBtns(p) + '</td>' +
      '<td class="pt-col-actions">' +
        comfyBtn +
        '<button class="pt-btn" onclick="openEditPrompt(\'' + escA(p.id) + '\')" title="Edit">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>' +
        '</button>' +
        '<button class="pt-btn pt-btn-del" onclick="deletePrompt(\'' + escA(p.id) + '\')" title="Delete">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>' +
        '</button>' +
      '</td>' +
    '</tr>';
  }).join('');
}

function renderSiteBtns(prompt) {
  const sites = prompt.sites && prompt.sites.length ? prompt.sites : PROMPT_SITES.map(s => s.id);
  return sites.map(sid => {
    const s = PROMPT_SITES.find(x => x.id === sid);
    if (!s) return '';
    const disabled = s.local && !_comfyOk ? ' disabled title="ComfyUI not running"' : ' title="Send to ' + s.name + '"';
    return '<button class="pt-site-btn" onclick="sendToSite(\'' + escA(prompt.id) + '\',\'' + escA(s.id) + '\')"' + disabled + '>' + esc(s.name) + '</button>';
  }).join('');
}

// ─── Send to AI site ───

async function sendToSite(promptId, siteId) {
  const prompt = _prompts.find(p => p.id === promptId);
  if (!prompt) return;
  const site = PROMPT_SITES.find(s => s.id === siteId);
  if (!site) return;

  await navigator.clipboard.writeText(prompt.text).catch(() => {});

  if (site.local) {
    // ComfyUI — open browser, user pastes into text node
    window.open(site.url, '_blank');
    toast('Prompt copied — paste into a text node in ComfyUI', 3000);
  } else {
    window.open(site.url, '_blank');
    toast('Prompt copied — paste in ' + site.name, 2500);
  }
}

// ─── Send to ComfyUI via API ───

async function sendToComfyUI(promptId) {
  const prompt = _prompts.find(p => p.id === promptId);
  if (!prompt) return;
  if (!_selectedWorkflow) { toast('Select a workflow first'); return; }

  try {
    const r = await fetch('/api/comfyui/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: prompt.text, workflow: _selectedWorkflow }),
    });
    const data = await r.json();
    if (!r.ok) {
      toast('ComfyUI error: ' + (data.error || r.status), 3500);
      return;
    }
    toast('Queued in ComfyUI (' + _selectedWorkflow + ')', 2500);
  } catch {
    toast('Could not reach ComfyUI', 2500);
  }
}

// ─── Modal ───

function openAddPrompt() {
  _editId = null;
  document.getElementById('prompt-modal-title').textContent = 'New Prompt';
  document.getElementById('prompt-text-input').value = '';
  renderSiteCheckboxes(PROMPT_SITES.map(s => s.id)); // all selected by default
  $('prompt-modal').add('on');
  setTimeout(() => document.getElementById('prompt-text-input').focus(), 50);
}

function openEditPrompt(id) {
  const p = _prompts.find(x => x.id === id);
  if (!p) return;
  _editId = id;
  document.getElementById('prompt-modal-title').textContent = 'Edit Prompt';
  document.getElementById('prompt-text-input').value = p.text;
  renderSiteCheckboxes(p.sites && p.sites.length ? p.sites : PROMPT_SITES.map(s => s.id));
  $('prompt-modal').add('on');
  setTimeout(() => document.getElementById('prompt-text-input').focus(), 50);
}

function renderSiteCheckboxes(selected) {
  const grid = document.getElementById('prompt-sites-grid');
  if (!grid) return;
  grid.innerHTML = PROMPT_SITES.map(s => {
    const on = selected.includes(s.id);
    const disabled = s.local && !_comfyOk ? ' pt-site-check-disabled' : '';
    return '<label class="pt-site-check' + (on ? ' on' : '') + disabled + '" data-site="' + escA(s.id) + '" onclick="toggleSiteCheck(this)">' +
      '<svg class="pt-check-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' +
      esc(s.name) +
    '</label>';
  }).join('');
}

function toggleSiteCheck(el) {
  el.classList.toggle('on');
}

function closePromptModal() {
  $('prompt-modal').remove('on');
  _editId = null;
}

async function savePrompt() {
  const text = document.getElementById('prompt-text-input').value.trim();
  if (!text) { toast('Enter a prompt first'); return; }

  const selected = [...document.querySelectorAll('#prompt-sites-grid .pt-site-check.on')]
    .map(el => el.dataset.site);

  if (_editId) {
    const r = await fetch('/api/prompts/' + _editId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, sites: selected }),
    });
    if (!r.ok) { toast('Failed to save'); return; }
    const updated = await r.json();
    const idx = _prompts.findIndex(p => p.id === _editId);
    if (idx >= 0) _prompts[idx] = updated;
  } else {
    const r = await fetch('/api/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, sites: selected }),
    });
    if (!r.ok) { toast('Failed to save'); return; }
    const created = await r.json();
    _prompts.unshift(created);
  }

  closePromptModal();
  renderPromptsTable();
  toast(_editId ? 'Prompt updated' : 'Prompt saved');
}

async function deletePrompt(id) {
  if (!confirm('Delete this prompt?')) return;
  await fetch('/api/prompts/' + id, { method: 'DELETE' });
  _prompts = _prompts.filter(p => p.id !== id);
  renderPromptsTable();
  toast('Deleted');
}

// ─── Mass import ───

function openMassImport() {
  document.getElementById('mass-import-textarea').value = '';
  document.getElementById('mass-import-count').textContent = '';
  renderMassImportSiteCheckboxes(PROMPT_SITES.map(s => s.id));
  $('mass-import-modal').add('on');
  setTimeout(() => document.getElementById('mass-import-textarea').focus(), 50);
}

function closeMassImport() {
  $('mass-import-modal').remove('on');
}

function renderMassImportSiteCheckboxes(selected) {
  const grid = document.getElementById('mass-import-sites-grid');
  if (!grid) return;
  grid.innerHTML = PROMPT_SITES.map(s => {
    const on = selected.includes(s.id);
    const disabled = s.local && !_comfyOk ? ' pt-site-check-disabled' : '';
    return '<label class="pt-site-check' + (on ? ' on' : '') + disabled + '" data-site="' + escA(s.id) + '" onclick="toggleSiteCheck(this)">' +
      '<svg class="pt-check-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' +
      esc(s.name) +
    '</label>';
  }).join('');
}

function onMassImportInput(ta) {
  const lines = ta.value.split('\n').map(l => l.trim()).filter(Boolean);
  const cnt = document.getElementById('mass-import-count');
  if (cnt) cnt.textContent = lines.length ? lines.length + ' prompt' + (lines.length > 1 ? 's' : '') + ' detected' : '';
}

function massImportSelectAll() {
  document.querySelectorAll('#mass-import-sites-grid .pt-site-check').forEach(el => {
    if (!el.classList.contains('pt-site-check-disabled')) el.classList.add('on');
  });
}

function massImportSelectNone() {
  document.querySelectorAll('#mass-import-sites-grid .pt-site-check').forEach(el => el.classList.remove('on'));
}

async function saveMassImport() {
  const lines = document.getElementById('mass-import-textarea').value
    .split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) { toast('Paste at least one prompt'); return; }

  const sites = [...document.querySelectorAll('#mass-import-sites-grid .pt-site-check.on')]
    .map(el => el.dataset.site);

  const btn = document.getElementById('mass-import-save-btn');
  btn.disabled = true; btn.textContent = 'Importing…';

  let added = 0;
  for (const text of lines) {
    const r = await fetch('/api/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, sites }),
    });
    if (r.ok) { const p = await r.json(); _prompts.unshift(p); added++; }
  }

  btn.disabled = false; btn.textContent = 'Import';
  closeMassImport();
  renderPromptsTable();
  toast('Imported ' + added + ' prompt' + (added > 1 ? 's' : ''));
}

// ─── Keyboard ───
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if ($('mass-import-modal').el.classList.contains('on')) closeMassImport();
    else if ($('prompt-modal').el.classList.contains('on')) closePromptModal();
  }
});
