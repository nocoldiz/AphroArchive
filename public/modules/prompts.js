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
let _templateValues   = {};     // template name (no $) → array of string values
let _valorizedTexts   = {};     // promptId → pre-computed valorized text

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

  tbody.innerHTML = _prompts.map(p => {
    // 1. Fetch valorized text if available, fallback to default text
    const displayText = _valorizedTexts[p.id] || p.text;

    const acts = `
      <button class="pt-btn" onclick="openSendPromptModal('${escA(p.id)}')" title="Send prompt">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
      </button>
      <button class="pt-btn pt-btn-comfy" onclick="sendToComfyUI('${escA(p.id)}')" title="Send to ComfyUI">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
      </button>
      <button class="pt-btn" onclick="openEditPrompt('${escA(p.id)}')" title="Edit">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="pt-btn" onclick="deletePrompt('${escA(p.id)}')" title="Delete">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    `;

    return `<tr>
      <td class="pt-col-title">
        <div class="pt-title">${esc(p.title)}</div>
        <div class="pt-tags">${(p.tags||[]).map(t => '<span>'+esc(t)+'</span>').join('')}</div>
      </td>
      <td class="pt-col-text">
        <div class="pt-text-preview" title="${escA(displayText)}">${esc(displayText)}</div>
      </td>
      <td class="pt-col-actions">${acts}</td>
    </tr>`;
  }).join('');
}
function openSendPromptModal(id) {
  const p = _prompts.find(x => x.id === id);
  if (!p) return;
  
  let modal = document.getElementById('send-prompt-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'send-prompt-modal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-dialog" style="max-width: 500px;">
        <div class="modal-header">
          <h3>Send Prompt</h3>
          <button class="modal-close" onclick="closeSendPromptModal()">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body" style="display: flex; flex-direction: column; gap: 16px;">
          <div>
            <label style="font-size: 0.85rem; color: var(--tx2); margin-bottom: 6px; display: block;">Prompt Text</label>
            <textarea id="send-prompt-text" class="modal-input" style="height: 120px; resize: vertical; background: var(--bg2);" readonly></textarea>
          </div>
          <div>
            <label style="font-size: 0.85rem; color: var(--tx2); margin-bottom: 6px; display: block;">Send to API Service</label>
            <div id="send-prompt-sites" style="display: flex; flex-wrap: wrap; gap: 8px;"></div>
          </div>
        </div>
      </div>
    `;
// 2. Insert valorized text into the text area preview
  const displayText = _valorizedTexts[p.id] || p.text;
  document.getElementById('send-prompt-text').value = displayText;
  
  const sitesContainer = document.getElementById('send-prompt-sites');
  sitesContainer.innerHTML = '';
  
  PROMPT_SITES.forEach(site => {
    const btn = document.createElement('button');
    btn.className = 'pt-site-btn';
    btn.innerHTML = site.name;
    btn.onclick = () => {
      sendToSite(p.id, site.id);
      closeSendPromptModal();
    };
    sitesContainer.appendChild(btn);
  });

  modal.classList.add('on');  }

  document.getElementById('send-prompt-text').value = p.text;
  
  const sitesContainer = document.getElementById('send-prompt-sites');
  sitesContainer.innerHTML = '';
  
  // Show all available PROMPT_SITES
  PROMPT_SITES.forEach(site => {
    const btn = document.createElement('button');
    btn.className = 'pt-site-btn';
    btn.innerHTML = site.name;
    btn.onclick = () => {
      sendToSite(p.id, site.id);
      closeSendPromptModal();
    };
    sitesContainer.appendChild(btn);
  });

  modal.classList.add('on');
}

function closeSendPromptModal() {
  const modal = document.getElementById('send-prompt-modal');
  if (modal) modal.classList.remove('on');
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

  const text = _valorizedTexts[promptId] || prompt.text;
  await navigator.clipboard.writeText(text).catch(() => {});

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

  const text = _valorizedTexts[promptId] || prompt.text;
  try {
    const r = await fetch('/api/comfyui/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, workflow: _selectedWorkflow }),
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
  document.getElementById('prompt-title-input').value = '';
  document.getElementById('prompt-tags-input').value = '';
  document.getElementById('prompt-text-input').value = '';
  // Removed `renderSiteCheckboxes(...)` as they are no longer selected per-prompt
  
  // Ensure the AI Services checklist in the add-modal UI is hidden
  const siteChecklistContainer = document.getElementById('prompt-sites-container');
  if (siteChecklistContainer) siteChecklistContainer.style.display = 'none';

  $('prompt-modal').add('on');
  setTimeout(() => document.getElementById('prompt-title-input').focus(), 50);
}

function openEditPrompt(id) {
  const p = _prompts.find(x => x.id === id);
  if (!p) return;
  _editId = id;
  document.getElementById('prompt-title-input').value = p.title;
  document.getElementById('prompt-tags-input').value = (p.tags||[]).join(', ');
  document.getElementById('prompt-text-input').value = p.text;
  
  // Removed `renderSiteCheckboxes(...)` as they are no longer selected per-prompt
  const siteChecklistContainer = document.getElementById('prompt-sites-container');
  if (siteChecklistContainer) siteChecklistContainer.style.display = 'none';

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
// ─── Copy All Prompts ───

// ─── Copy All Prompts ───

async function copyAllPrompts() {
  if (!_prompts || _prompts.length === 0) {
    if (typeof toast === 'function') toast('No prompts to copy');
    else alert('No prompts to copy');
    return;
  }
  
  // 3. Map over valorized texts and separate prompts with double line breaks to preserve the internal newlines of the full templates
  const textToCopy = _prompts.map(p => _valorizedTexts[p.id] || p.text).join('\n\n');
  
  try {
    await navigator.clipboard.writeText(textToCopy);
    if (typeof toast === 'function') toast('Copied ' + _prompts.length + ' prompts');
    else alert('Copied ' + _prompts.length + ' prompts');
  } catch (err) {
    console.error('Failed to copy prompts:', err);
    if (typeof toast === 'function') toast('Failed to copy prompts');
    else alert('Failed to copy prompts');
  }
}
async function savePrompt() {
  const title = document.getElementById('prompt-title-input').value.trim();
  const tags  = document.getElementById('prompt-tags-input').value.split(',').map(s=>s.trim()).filter(Boolean);
  const text  = document.getElementById('prompt-text-input').value.trim();
  if (!title || !text) return alert('Title and text are required');

  const p = { title, tags, text }; // Omitted the mapping to fetch selected checkboxes
  if (_editId) p.id = _editId;

  try {
    await fetch('/api/prompts', {
      method: _editId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p)
    });
    $('prompt-modal').remove('on');
    await loadPrompts();
    renderPromptsTable();
  } catch (err) {
    alert('Error saving prompt');
  }
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

// ─── Valorize Templates ───

function _scanTemplates() {
  const found = new Set();
  _prompts.forEach(p => {
    const matches = p.text.match(/\$[A-Z][A-Z0-9_]*/g) || [];
    matches.forEach(m => found.add(m));
  });
  return [...found].sort();
}

function openValorizeModal() {
  const templates = _scanTemplates();
  const content = document.getElementById('valorize-modal-content');
  const applyBtn = document.getElementById('valorize-apply-btn');
  const clearBtn = document.getElementById('valorize-clear-btn');

  if (!templates.length) {
    content.innerHTML =
      '<div class="valorize-modal-instructions">' +
      '<p>No template strings were found in your prompts.</p>' +
      '<p>Templates are <strong>uppercase words</strong> preceded by <code>$</code>. Examples:</p>' +
      '<ul>' +
        '<li><code>$SUBJECT</code> — replaced with a subject of your choice</li>' +
        '<li><code>$PLACE</code> — replaced with a location</li>' +
        '<li><code>$STYLE</code> — replaced with an art style</li>' +
      '</ul>' +
      '<p>Example prompt: <code>A photo of $SUBJECT in $PLACE, $STYLE style</code></p>' +
      '<p>Add prompts containing <code>$UPPERCASE</code> words, then click <strong>Valorize Template</strong> to fill in values. ' +
      'If you provide multiple values (one per line), a random one is picked for each prompt.</p>' +
      '</div>';
    if (applyBtn) applyBtn.style.display = 'none';
  } else {
    content.innerHTML =
      '<div class="valorize-grid">' +
      templates.map(t => {
        const name = t.slice(1);
        const existing = (_templateValues[name] || []).join('\n');
        return '<div class="valorize-row">' +
          '<div class="valorize-key">' + esc(t) + '</div>' +
          '<div>' +
            '<textarea class="valorize-input" data-template="' + escA(name) + '" ' +
              'placeholder="One value per line&#10;(random one chosen per prompt)">' + esc(existing) + '</textarea>' +
            '<div class="valorize-input-hint">One value per line — a random one will be used per prompt</div>' +
          '</div>' +
        '</div>';
      }).join('') +
      '</div>';
    if (applyBtn) applyBtn.style.display = '';
  }

  const hasActive = Object.keys(_valorizedTexts).length > 0;
  if (clearBtn) clearBtn.style.display = hasActive ? '' : 'none';

  $('valorize-modal').add('on');
}

function closeValorizeModal() {
  $('valorize-modal').remove('on');
}

function applyValorize() {
  // Read values from inputs
  document.querySelectorAll('#valorize-modal-content .valorize-input').forEach(ta => {
    const name = ta.dataset.template;
    const vals = ta.value.split('\n').map(l => l.trim()).filter(Boolean);
    if (vals.length) _templateValues[name] = vals;
    else delete _templateValues[name];
  });

  // Pre-compute valorized text per prompt (random pick per prompt per template)
  _valorizedTexts = {};
  _prompts.forEach(p => {
    const tpls = [...new Set(p.text.match(/\$[A-Z][A-Z0-9_]*/g) || [])];
    if (!tpls.length) return;
    let text = p.text;
    tpls.forEach(t => {
      const name = t.slice(1);
      const vals = _templateValues[name];
      if (vals && vals.length) {
        const val = vals[Math.floor(Math.random() * vals.length)];
        text = text.split(t).join(val);
      }
    });
    if (text !== p.text) _valorizedTexts[p.id] = text;
  });

  // Update button appearance
  const btn = document.getElementById('valorize-btn');
  const active = Object.keys(_valorizedTexts).length > 0;
  if (btn) btn.classList.toggle('sort-btn--valorize-active', active);

  closeValorizeModal();
  renderPromptsTable();
  const count = Object.keys(_valorizedTexts).length;
  toast(count ? 'Templates valorized in ' + count + ' prompt' + (count > 1 ? 's' : '') : 'No templates matched — check your values');
}

function clearValorize() {
  _templateValues = {};
  _valorizedTexts = {};
  const btn = document.getElementById('valorize-btn');
  if (btn) btn.classList.remove('sort-btn--valorize-active');
  closeValorizeModal();
  renderPromptsTable();
  toast('Valorization cleared');
}

// ─── Keyboard ───
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if ($('valorize-modal').el.classList.contains('on')) closeValorizeModal();
    else if ($('mass-import-modal').el.classList.contains('on')) closeMassImport();
    else if ($('prompt-modal').el.classList.contains('on')) closePromptModal();
  }
});
