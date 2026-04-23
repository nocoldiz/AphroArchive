// ─── DB Preset Picker ───
// Shown on first launch (needed=true) or when user manually re-opens it.

let _presets = [];
let _pickerMergeMode = false; // true when re-opened from Database view

async function checkAndShowPresetPicker() {
  let data;
  try {
    const r = await fetch('/api/presets');
    data = await r.json();
  } catch { return; }

  if (!data.needed) return;

  _presets = data.presets || [];
  _pickerMergeMode = false;
  _renderPresetPicker();
  document.getElementById('preset-overlay').style.display = 'flex';

  return new Promise(resolve => {
    window._presetPickerResolve = resolve;
  });
}

function openPresetPickerManual() {
  fetch('/api/presets').then(r => r.json()).then(data => {
    _presets = data.presets || [];
    _pickerMergeMode = true;
    _renderPresetPicker();
    const overlay = document.getElementById('preset-overlay');
    overlay.style.display = 'flex';
    document.getElementById('preset-picker-title').textContent = 'Change Database Preset';
    document.getElementById('preset-picker-subtitle').textContent =
      'Pick presets to apply. Your custom entries (manually added actors, studios, etc.) will be preserved and merged.';
    document.getElementById('preset-apply-btn').textContent = 'Apply & Merge';
  }).catch(() => {});
}

function _renderPresetPicker() {
  const title    = document.getElementById('preset-picker-title');
  const subtitle = document.getElementById('preset-picker-subtitle');
  if (title)    title.textContent    = 'Choose a Database Preset';
  if (subtitle) subtitle.textContent = 'Pick one or more presets to populate your initial actors, categories, studios and websites — or start with an empty database.';
  const btn = document.getElementById('preset-apply-btn');
  if (btn) btn.textContent = 'Apply Selected';

  const list = document.getElementById('preset-picker-list');
  if (!list) return;
  if (!_presets.length) {
    list.innerHTML = '<p style="color:var(--tx2);font-size:0.85rem">No presets found in <code>db/presets/</code>.</p>';
    return;
  }
  list.innerHTML = _presets.map(p => `
    <label class="preset-card">
      <input type="checkbox" class="preset-cb" value="${escA(p.id)}">
      <div class="preset-card-body">
        <div class="preset-card-name">${esc(p.name)}</div>
        ${p.description ? `<div class="preset-card-desc">${esc(p.description)}</div>` : ''}
        <div class="preset-card-counts">
          ${p.counts.categories ? `<span>${p.counts.categories} categories</span>` : ''}
          ${p.counts.actors     ? `<span>${p.counts.actors} actors</span>`         : ''}
          ${p.counts.studios    ? `<span>${p.counts.studios} studios</span>`       : ''}
          ${p.counts.websites   ? `<span>${p.counts.websites} websites</span>`     : ''}
        </div>
      </div>
    </label>
  `).join('');
}

async function _applyPreset(selection, merge) {
  if (merge === undefined) merge = _pickerMergeMode;
  const btn    = document.getElementById('preset-apply-btn');
  const status = document.getElementById('preset-status');
  if (btn)    btn.disabled = true;
  if (status) status.textContent = 'Applying…';
  try {
    const r = await fetch('/api/presets/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selection, merge }),
    });
    if (!r.ok) throw new Error('Server error');
  } catch (e) {
    if (status) status.textContent = 'Error: ' + e.message;
    if (btn)    btn.disabled = false;
    return;
  }
  document.getElementById('preset-overlay').style.display = 'none';
  if (window._presetPickerResolve) { window._presetPickerResolve(); window._presetPickerResolve = null; }
  if (_pickerMergeMode) {
    if (typeof loadDbTab === 'function' && typeof dbTab !== 'undefined') loadDbTab(dbTab);
    if (typeof toast === 'function') toast('Database updated');
  }
}

function presetApplySelected() {
  const checked = [...document.querySelectorAll('.preset-cb:checked')].map(cb => cb.value);
  if (!checked.length) {
    document.getElementById('preset-status').textContent = 'Select at least one preset, or use Blank / All.';
    return;
  }
  _applyPreset(checked); // uses _pickerMergeMode (merge when re-opening, replace on first setup)
}

function presetApplyReplace() {
  const checked = [...document.querySelectorAll('.preset-cb:checked')].map(cb => cb.value);
  if (!checked.length) {
    document.getElementById('preset-status').textContent = 'Select at least one preset to replace with.';
    return;
  }
  _applyPreset(checked, false); // always overwrites, never merges
}

function presetApplyAll()   { _applyPreset('all'); }
function presetApplyBlank() { _applyPreset('blank', false); } // always clears, never merges
