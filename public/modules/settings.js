// ─── Settings ───
function showSettings() {
  if (mosaicOn) stopMosaic();
  if (location.pathname !== '/settings') history.pushState(null, '', '/settings');
  settingsMode = true;
  $('browse-view').add('off');
  document.querySelectorAll('.sidebar-item.on').forEach(e => e.classList.remove('on'));
  $('settings-sidebar').add('on');
  ['player-view','duplicates-view','actors-view','actor-detail-view','studios-view','studio-detail-view','tag-detail-view','vault-view','scraper-view','folders-view','import-favs-view','collections-view','database-view']
    .forEach(id => $(id).remove('on'));
  vaultMode = false; scraperMode = false; foldersMode = false; importFavsMode = false; collectionsMode = false; dbMode = false;
  studioMode = false; actorMode = false;
  curActor = null; curStudio = null; curTag = null; curV = null; curCollection = null;
  $('settings-view').add('on');
  loadSettings();
  const activeTheme = localStorage.getItem('theme') || '';
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === activeTheme);
  });
}

async function loadSettings() {
  const [lists, prefs] = await Promise.all([
    fetch('/api/settings/lists').then(r => r.json()),
    fetch('/api/settings/prefs').then(r => r.json()).catch(() => ({}))
  ]);
  $('settings-hidden').val(lists.hidden || '');
  $('settings-whitelist').val(lists.whitelist || '');
  updateSettingsHint('settings-hidden-hint', lists.hidden || '');
  updateSettingsHint('settings-whitelist-hint', lists.whitelist || '');
  const sel = $('chronologyMode').el;
  if (sel) sel.value = prefs.chronologyMode || 'keep';
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
  const taId = { hidden: 'settings-hidden', whitelist: 'settings-whitelist' }[file];
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
  // Build URL display + switcher if multiple IPs
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
