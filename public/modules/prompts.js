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

let _prompts        = [];
let _editId         = null;
let _searchQuery    = '';
let _templateValues = {};
let _valorizedTexts = {};
let vaultPromptsMode = false;

function _promptsEndpoint() {
  return vaultPromptsMode ? '/api/vault/prompts' : '/api/prompts';
}

// ─── View ───

async function showPrompts() {
  vaultPromptsMode = false;
  const backBtn = document.getElementById('vault-prompts-back-btn');
  if (backBtn) backBtn.style.display = 'none';
  closeAllViews();
  promptsMode = true;
  $('browse-view').add('off');
  $('prompts-view').add('on');
  $('prompts-sidebar').add('on');
  _searchQuery = '';
  const si = document.getElementById('prompts-search');
  if (si) si.value = '';
  if (location.pathname !== '/prompts') history.pushState(null, '', '/prompts');
  await loadPrompts();
  renderPromptsTable();
}

async function loadPrompts() {
  try { _prompts = await (await fetch(_promptsEndpoint())).json(); }
  catch { _prompts = []; }
}

// ─── Search ───

function onPromptsSearch(val) {
  _searchQuery = val.trim();
  renderPromptsTable();
}

function getFilteredPrompts() {
  if (!_searchQuery) return _prompts;
  const tokens   = _searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
  const include  = tokens.filter(t => !t.startsWith('-'));
  const exclude  = tokens.filter(t => t.startsWith('-')).map(t => t.slice(1)).filter(Boolean);
  return _prompts.filter(p => {
    const hay = [p.title || '', p.text || '', ...(p.tags || [])].join(' ').toLowerCase();
    if (exclude.some(w => hay.includes(w))) return false;
    if (include.length && !include.some(w => hay.includes(w))) return false;
    return true;
  });
}

// ─── Table rendering ───

function renderPromptsTable() {
  const tbody   = document.getElementById('prompts-tbody');
  const empty   = document.getElementById('prompts-empty');
  const table   = document.getElementById('prompts-table');
  const counter = document.getElementById('prompts-search-count');
  if (!tbody) return;

  const filtered = getFilteredPrompts();

  if (counter) {
    counter.textContent = _searchQuery
      ? filtered.length + ' / ' + _prompts.length
      : (_prompts.length ? _prompts.length + ' prompts' : '');
  }

  if (!filtered.length) {
    table.style.display = 'none';
    if (empty) {
      empty.style.display = 'flex';
      const h = empty.querySelector('h3');
      const p = empty.querySelector('p');
      if (_searchQuery && _prompts.length) {
        if (h) h.textContent = 'No matches';
        if (p) p.textContent = 'Try different keywords.';
      } else {
        if (h) h.textContent = 'No prompts yet';
        if (p) p.innerHTML = 'Click <strong>New Prompt</strong> to add your first AI prompt.';
      }
    }
    return;
  }
  table.style.display = '';
  if (empty) empty.style.display = 'none';

  tbody.innerHTML = filtered.map(p => {
    const displayText = _valorizedTexts[p.id] || p.text;
    const acts = `
      <button class="pt-btn" onclick="openSendPromptModal('${escA(p.id)}')" title="Send prompt">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
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
    const disabled = ' title="Send to ' + s.name + '"';
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
    const disabled = '';
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
  const visible = getFilteredPrompts();
  if (!visible.length) { toast('No prompts to copy'); return; }
  const text = visible.map(p => _valorizedTexts[p.id] || p.text).join('\n\n');
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied ' + visible.length + ' prompt' + (visible.length !== 1 ? 's' : ''));
  } catch {
    toast('Failed to copy');
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
    await fetch(_editId ? _promptsEndpoint() + '/' + _editId : _promptsEndpoint(), {
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
  await fetch(_promptsEndpoint() + '/' + id, { method: 'DELETE' });
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
    const disabled = '';
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
    const r = await fetch(_promptsEndpoint(), {
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

// Add to prompts.js
async function confirmDeleteAllPrompts() {
  if (!confirm('Are you sure you want to delete ALL prompts? This action cannot be undone.')) {
    return;
  }

  try {
    const response = await fetch(_promptsEndpoint() + '/all', {
      method: 'DELETE'
    });

    if (response.ok) {
      _prompts = []; // Clear local state
      renderPromptsTable(); // Refresh the UI
      toast('All prompts deleted successfully');
    } else {
      const err = await response.json();
      toast('Error: ' + (err.error || 'Failed to delete prompts'));
    }
  } catch (e) {
    console.error(e);
    toast('Network error while deleting prompts');
  }
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
