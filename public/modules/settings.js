// ─── Settings ───
function showSettings() {
  closeAllViews();
  if (location.pathname !== '/settings') history.pushState(null, '', '/settings');
  settingsMode = true;
  $('browse-view').add('off');
  $('settings-sidebar').add('on');
  $('settings-view').add('on');
  loadSettings();
  const activeTheme = localStorage.getItem('theme') || '';
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === activeTheme);
  });
}

async function loadSettings() {
  const [lists, prefs, vaultStatus] = await Promise.all([
    fetch('/api/settings/lists').then(r => r.json()),
    fetch('/api/settings/prefs').then(r => r.json()).catch(() => ({})),
    fetch('/api/vault/status').then(r => r.json()).catch(() => ({})),
  ]);
  $('settings-hidden').val(lists.hidden || '');
  updateSettingsHint('settings-hidden-hint', lists.hidden || '');
  const sel = $('chronologyMode').el;
  if (sel) sel.value = prefs.chronologyMode || 'keep';
  const tog = $('aiCommentsToggle').el;
  if (tog) tog.checked = !!prefs.aiCommentsEnabled;
  aiCommentsEnabled = !!prefs.aiCommentsEnabled;
  const dstTog = $('disableSearchTrackingToggle').el;
  if (dstTog) dstTog.checked = !!prefs.disableSearchTracking;
  const vaultPanel = document.getElementById('settings-vault-panel');
  if (vaultPanel) vaultPanel.style.display = vaultStatus.configured ? '' : 'none';
}

async function saveDisableSearchTracking(disabled) {
  await fetch('/api/settings/prefs', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ disableSearchTracking: disabled }),
  });
  toast(disabled ? 'Search tracking disabled' : 'Search tracking enabled');
}

async function saveAiCommentsPref(enabled) {
  const r = await fetch('/api/settings/prefs', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aiCommentsEnabled: enabled })
  });
  if (r.ok) { aiCommentsEnabled = enabled; toast(enabled ? 'AI Comments enabled' : 'AI Comments disabled'); }
  else toast('Save failed');
}

async function clearAllAiComments() {
  const hint = document.getElementById('clear-comments-hint');
  if (hint) hint.textContent = 'Clearing…';
  const r = await fetch('/api/comments/clear-all', { method: 'DELETE' });
  if (r.ok) {
    const d = await r.json();
    toast('Cleared ' + d.deleted + ' comment file' + (d.deleted !== 1 ? 's' : ''));
    if (hint) hint.textContent = d.deleted + ' file' + (d.deleted !== 1 ? 's' : '') + ' deleted';
  } else {
    toast('Clear failed');
    if (hint) hint.textContent = '';
  }
}

async function saveChronologyMode() {
  const sel = $('chronologyMode').el;
  if (!sel) return;
  const r = await fetch('/api/settings/prefs', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chronologyMode: sel.value })
  });
  if (r.ok) toast('Saved');
  else toast('Save failed');
}

function updateSettingsHint(hintId, content) {
  const count = content.split('\n').map(l => l.trim()).filter(l => l.length > 0).length;
  const el = $(hintId).el;
  if (el) el.textContent = count + ' entr' + (count !== 1 ? 'ies' : 'y');
}

async function saveSettingsList(file) {
  const taId = { hidden: 'settings-hidden' }[file];
  const content = $(taId).el.value;
  const r = await fetch('/api/settings/' + file, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  });
  const d = await r.json();
  if (!r.ok) { toast(d.error || 'Save failed'); return; }
  toast('Saved ' + d.count + ' ' + file + ' entr' + (d.count !== 1 ? 'ies' : 'y'));
  updateSettingsHint('stg' + file.charAt(0).toUpperCase() + file.slice(1) + 'Hint', content);
  if (file === 'actors') loadActorList && typeof loadActorList === 'function' && loadActorList();
  if (file === 'categories' || file === 'studios') renCats && typeof renCats === 'function' && renCats();
  refresh();
}

// ─── Connect Modal ───
async function showConnect() {
  $('connectModal').add('on');
  const urlEl = $('connectUrl').el;
  const canvas = $('connectQR').el;
  urlEl.innerHTML = 'Loading…';
  canvas.style.display = 'none';
  renderRemoteToggle();
  try {
    const d = await (await fetch('/api/local-ip')).json();
    if (!d.url) { urlEl.textContent = 'Could not detect local IP address.'; return; }
    _connectUrls = d.all && d.all.length ? d.all : [{ url: d.url, name: 'Network', ip: d.ip }];
    _connectIdx = 0;
    renderConnectModal();
  } catch (e) {
    urlEl.textContent = 'Error loading network info.';
  }
}

let _connectUrls = [], _connectIdx = 0;

function renderConnectModal() {
  const entry = _connectUrls[_connectIdx];
  const urlEl = $('connectUrl').el;
  const canvas = $('connectQR').el;
  if (_connectUrls.length > 1) {
    urlEl.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;justify-content:center;flex-wrap:wrap">' +
      _connectUrls.map((e, i) =>
        '<button onclick="connectSwitchIP(' + i + ')" style="padding:4px 10px;border-radius:999px;font-size:0.75rem;border:1px solid var(--brd);cursor:pointer;background:' +
        (i === _connectIdx ? 'var(--ac)' : 'var(--bg3)') + ';color:' + (i === _connectIdx ? '#fff' : 'var(--tx2)') + '">' +
        esc(e.name) + '</button>'
      ).join('') +
      '</div>' +
      '<div style="margin-top:8px;font-size:0.82rem;color:var(--tx2)">' + esc(entry.url) + '</div>';
  } else {
    urlEl.textContent = entry.url;
  }
  canvas.style.display = 'block';
  QRCode.toCanvas(canvas, entry.url, { width: 220, margin: 2, color: { dark: '#000', light: '#fff' } });
}

function connectSwitchIP(idx) {
  _connectIdx = idx;
  renderConnectModal();
}

function closeConnectModal() {
  $('connectModal').remove('on');
}

// ─── Remote Mode ───
// The main device is the one running the server (accessed via localhost).
// Connected devices access via IP and can enable Remote Mode to control the main device.
const _isMainDevice =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1';

function renderRemoteToggle() {
  const el = $('connectRemoteRow').el;
  if (!el) return;
  if (_isMainDevice) {
    el.style.cursor = 'default';
    el.onclick = null;
    el.querySelector('.rm-toggle').style.display = 'none';
    el.querySelector('.rm-label').textContent = 'Main screen — receiving remote commands';
    el.querySelector('.rm-desc').textContent = 'Enable Remote Mode on a connected device to control playback here';
    return;
  }
  el.style.cursor = '';
  el.onclick = toggleRemoteMode;
  const tog = el.querySelector('.rm-toggle');
  tog.style.display = '';
  tog.classList.toggle('on', remoteMode);
  el.querySelector('.rm-label').textContent = remoteMode ? 'Remote Mode — on' : 'Remote Mode — off';
  el.querySelector('.rm-desc').textContent = 'Videos you pick will play on the main device';
  const ind = document.getElementById('connect-sidebar');
  if (ind) ind.classList.toggle('remote-active', remoteMode);
}

function toggleRemoteMode() {
  if (_isMainDevice) return;
  remoteMode = !remoteMode;
  localStorage.setItem('remoteMode', remoteMode ? '1' : '');
  renderRemoteToggle();
  if (remoteMode) toast('Remote Mode on — videos will play on the main device');
  else toast('Remote Mode off');
}

// Init remote mode from localStorage + start SSE listener
(function initRemote() {
  if (_isMainDevice) {
    remoteMode = false; // Main device is always the receiver
  } else {
    remoteMode = !!localStorage.getItem('remoteMode');
    if (remoteMode) {
      const ind = document.getElementById('connect-sidebar');
      if (ind) ind.classList.add('remote-active');
    }
  }
  // SSE listener — receives play commands from remote controllers
  function connectSSE() {
    const es = new EventSource('/api/remote/events');
    es.onmessage = e => {
      try {
        const cmd = JSON.parse(e.data);
        if (cmd.action === 'play' && cmd.id) {
          // Only the main device (localhost) opens incoming play commands
          if (_isMainDevice) openVid(cmd.id);
        }
      } catch {}
    };
    es.onerror = () => { es.close(); setTimeout(connectSSE, 5000); };
  }
  connectSSE();
})();
