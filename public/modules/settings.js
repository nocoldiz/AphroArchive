// ─── Settings ───
function showSettings() {
  if (mosaicOn) stopMosaic();
  if (location.pathname !== '/settings') history.pushState(null, '', '/settings');
  settingsMode = true;
  $('bv').add('off');
  document.querySelectorAll('.ci.on').forEach(e => e.classList.remove('on'));
  $('settingsSB').add('on');
  ['pv','dv','av','adv','sv','sdv','tagDV','vaultV','scraperV','foldersV','importFavsV','collectionsV','dbV']
    .forEach(id => $(id).remove('on'));
  vaultMode = false; scraperMode = false; foldersMode = false; importFavsMode = false; collectionsMode = false; dbMode = false;
  studioMode = false; actorMode = false;
  curActor = null; curStudio = null; curTag = null; curV = null; curCollection = null;
  $('settingsV').add('on');
  loadSettings();
  const activeTheme = localStorage.getItem('theme') || '';
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === activeTheme);
  });
}

async function loadSettings() {
  const d = await (await fetch('/api/settings/lists')).json();
  $('stgHidden').val(d.hidden || '');
  $('stgWhitelist').val(d.whitelist || '');
  updateSettingsHint('stgHiddenHint', d.hidden || '');
  updateSettingsHint('stgWhitelistHint', d.whitelist || '');
}

function updateSettingsHint(hintId, content) {
  const count = content.split('\n').map(l => l.trim()).filter(l => l.length > 0).length;
  const el = $(hintId).el;
  if (el) el.textContent = count + ' entr' + (count !== 1 ? 'ies' : 'y');
}

async function saveSettingsList(file) {
  const taId = { hidden: 'stgHidden', whitelist: 'stgWhitelist' }[file];
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
  urlEl.textContent = 'Loading…';
  canvas.style.display = 'none';
  try {
    const d = await (await fetch('/api/local-ip')).json();
    if (!d.url) { urlEl.textContent = 'Could not detect local IP address.'; return; }
    urlEl.textContent = d.url;
    canvas.style.display = 'block';
    QRCode.toCanvas(canvas, d.url, { width: 220, margin: 2, color: { dark: '#000', light: '#fff' } });
  } catch (e) {
    urlEl.textContent = 'Error loading network info.';
  }
}

function closeConnectModal() {
  $('connectModal').remove('on');
}
