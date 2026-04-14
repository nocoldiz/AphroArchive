// ─── AI Prompts ───

const PROMPT_SITES = [
  { id: 'chatgpt',    name: 'ChatGPT',    url: 'https://chatgpt.com/' },
  { id: 'claude',     name: 'Claude',     url: 'https://claude.ai/new' },
  { id: 'gemini',     name: 'Gemini',     url: 'https://gemini.google.com/app' },
  { id: 'grok',       name: 'Grok',       url: 'https://grok.com/' },
  { id: 'perplexity', name: 'Perplexity', url: 'https://perplexity.ai/' },
  { id: 'mistral',    name: 'Le Chat',    url: 'https://chat.mistral.ai/chat' },
  { id: 'copilot',    name: 'Copilot',    url: 'https://copilot.microsoft.com/' },
  { id: 'deepseek',   name: 'DeepSeek',   url: 'https://chat.deepseek.com/' },
  { id: 'meta',       name: 'Meta AI',    url: 'https://www.meta.ai/' },
  { id: 'comfyui',    name: 'ComfyUI',    url: 'http://127.0.0.1:8188', local: true },
];

let _prompts = [];
let _editId  = null;          // id being edited, null = new
let _comfyOk = false;         // whether ComfyUI was reachable on last check

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
  // Background check for ComfyUI
  fetch('/api/comfyui/status').then(r => r.json()).then(d => { _comfyOk = d.ok; }).catch(() => {});
}

async function loadPrompts() {
  try { _prompts = await (await fetch('/api/prompts')).json(); }
  catch { _prompts = []; }
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
  tbody.innerHTML = _prompts.map((p, i) =>
    '<tr>' +
      '<td class="pt-col-num">' + (i + 1) + '</td>' +
      '<td class="pt-col-text"><div class="pt-text" title="' + escA(p.text) + '">' + esc(p.text) + '</div></td>' +
      '<td class="pt-col-sites">' + renderSiteBtns(p) + '</td>' +
      '<td class="pt-col-actions">' +
        '<button class="pt-btn" onclick="openEditPrompt(\'' + escA(p.id) + '\')" title="Edit">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>' +
        '</button>' +
        '<button class="pt-btn pt-btn-del" onclick="deletePrompt(\'' + escA(p.id) + '\')" title="Delete">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>' +
        '</button>' +
      '</td>' +
    '</tr>'
  ).join('');
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

// ─── Keyboard ───
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('prompt-modal').el.classList.contains('on')) closePromptModal();
});
