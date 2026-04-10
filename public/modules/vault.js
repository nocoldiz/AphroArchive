// ─── Vault ───
async function showVault() {
  if (mosaicOn) stopMosaic();
  if (location.pathname !== '/vault') history.pushState(null, '', '/vault');
  vaultMode = true;
  document.getElementById('bv').classList.add('off');
  document.getElementById('pv').classList.remove('on');
  document.getElementById('dv').classList.remove('on');
  document.getElementById('dupSB').classList.remove('on');
  document.getElementById('sv').classList.remove('on');
  document.getElementById('sdv').classList.remove('on');
  document.getElementById('studioSB').classList.remove('on');
  document.getElementById('av').classList.remove('on');
  document.getElementById('adv').classList.remove('on');
  document.getElementById('actorSB').classList.remove('on');
  document.getElementById('tagDV').classList.remove('on');
  document.querySelectorAll('#tagList .ci').forEach(el => el.classList.remove('on'));
  dupMode = false; studioMode = false; curStudio = null; actorMode = false; curActor = null; curTag = null;
  if (curV) { const vp = document.getElementById('vP'); vp.pause(); vp.src = ''; curV = null; }
  document.getElementById('vaultSB').classList.add('on');
  document.getElementById('vaultV').classList.add('on');
  loadVaultView();
}

async function loadVaultView() {
  const s = await (await fetch('/api/vault/status')).json();
  const auth = document.getElementById('vaultAuth');
  const files = document.getElementById('vaultFiles');
  const btn = document.getElementById('vaultAuthBtn');
  const err = document.getElementById('vaultErr');
  err.textContent = '';
  if (s.unlocked) {
    auth.style.display = 'none';
    files.style.display = 'block';
    loadVaultFiles();
  } else if (!s.configured) {
    auth.style.display = 'flex';
    files.style.display = 'none';
    document.getElementById('vaultAuthTitle').textContent = 'Create Vault';
    document.getElementById('vaultAuthDesc').textContent = 'Set a master password. It cannot be changed or recovered.';
    document.getElementById('vaultPwConfirm').style.display = 'block';
    btn.textContent = 'Create Vault';
    btn.onclick = doVaultSetup;
  } else {
    auth.style.display = 'flex';
    files.style.display = 'none';
    document.getElementById('vaultAuthTitle').textContent = 'Vault Locked';
    document.getElementById('vaultAuthDesc').textContent = 'Enter your password to access encrypted files.';
    document.getElementById('vaultPwConfirm').style.display = 'none';
    btn.textContent = 'Unlock';
    btn.onclick = doVaultUnlock;
  }
}

async function doVaultSetup() {
  const pw = document.getElementById('vaultPw').value;
  const pw2 = document.getElementById('vaultPwConfirm').value;
  const err = document.getElementById('vaultErr');
  const btn = document.getElementById('vaultAuthBtn');
  err.textContent = '';
  if (pw.length < 6) { err.textContent = 'Password must be at least 6 characters'; return; }
  if (pw !== pw2) { err.textContent = 'Passwords do not match'; return; }
  btn.disabled = true; btn.textContent = 'Creating…';
  const r = await fetch('/api/vault/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
  const d = await r.json();
  btn.disabled = false;
  if (!r.ok) { err.textContent = d.error || 'Failed'; btn.textContent = 'Create Vault'; return; }
  document.getElementById('vaultPw').value = '';
  document.getElementById('vaultPwConfirm').value = '';
  loadVaultView();
}

async function doVaultUnlock() {
  const pw = document.getElementById('vaultPw').value;
  const err = document.getElementById('vaultErr');
  const btn = document.getElementById('vaultAuthBtn');
  err.textContent = '';
  btn.disabled = true; btn.textContent = 'Verifying…';
  const r = await fetch('/api/vault/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
  const d = await r.json();
  btn.disabled = false; btn.textContent = 'Unlock';
  if (!r.ok) { err.textContent = d.error || 'Wrong password'; return; }
  document.getElementById('vaultPw').value = '';
  loadVaultView();
}

async function lockVault() {
  await fetch('/api/vault/lock', { method: 'POST' });
  loadVaultView();
}

async function loadVaultFiles() {
  vaultQ = ''; vaultSort = 'date';
  const vsi = document.getElementById('vaultSearchInput');
  if (vsi) vsi.value = '';
  document.querySelectorAll('.vault-sort-btn').forEach(b => b.classList.toggle('on', b.dataset.sort === 'date'));
  vaultSelMode = false;
  vaultSel.clear();
  updateVaultSelBar();
  const selBtn = document.getElementById('vaultSelBtn');
  if (selBtn) selBtn.classList.remove('on');
  const grid = document.getElementById('vaultGrid');
  const empty = document.getElementById('vaultEmpty');
  grid.innerHTML = '<div class="dup-scan">Loading\u2026</div>';
  empty.style.display = 'none';
  const files = await (await fetch('/api/vault/files')).json();
  if (files.error) { grid.innerHTML = ''; return; }
  vaultFiles = files;
  renderVaultGrid();
}

function renderVaultGrid() {
  const grid = document.getElementById('vaultGrid');
  const empty = document.getElementById('vaultEmpty');
  const q = vaultQ.toLowerCase();
  let files = q ? vaultFiles.filter(f => (f.name || f.originalName).toLowerCase().includes(q)) : vaultFiles.slice();
  if (vaultSort === 'size-asc') files.sort((a, b) => a.size - b.size);
  else if (vaultSort === 'size-desc') files.sort((a, b) => b.size - a.size);
  else if (vaultSort === 'name') files.sort((a, b) => (a.name || a.originalName).localeCompare(b.name || b.originalName));
  if (!files.length) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    empty.querySelector('p').textContent = vaultQ ? 'No results for "' + vaultQ + '"' : 'Add video files using the button above';
    return;
  }
  empty.style.display = 'none';
  const cols = ['#e84040','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];
  grid.innerHTML = files.map(f => {
    const isImg = VAULT_IMG_EXTS.has(f.ext.toLowerCase());
    const c = cols[Math.abs(hsh(f.originalName)) % cols.length];
    const ctClass = 'ct vault-ct' + (isImg ? ' has-thumb' : '');
    const ctStyle = isImg ? 'cursor:pointer' : 'background:linear-gradient(135deg,' + c + '12 0%,' + c + '06 100%);cursor:pointer';
    const inner = isImg
      ? '<img src="/api/vault/stream/' + escA(f.id) + '" alt="" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">'
      : '<span class="eb">' + f.ext.replace('.','') + '</span>';
    return '<div class="vc fi" data-vault-id="' + escA(f.id) + '">' +
      '<div class="' + ctClass + '" style="' + ctStyle + '" onclick="vaultCardClick(\'' + escA(f.id) + '\',\'' + escA(f.name || f.originalName) + '\',\'' + escA(f.ext) + '\')">' +
      inner +
      '<div class="vault-chk" id="vchk-' + escA(f.id) + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>' +
      '<div class="po"></div>' +
      '<span class="szb">' + f.sizeF + '</span></div>' +
      '<div class="cb"><div class="ctit" title="' + escA(f.originalName) + '">' + esc(f.name || f.originalName) + '</div>' +
      '<div class="cm"><span class="ccat" style="color:var(--ac)">Vault</span>' +
      '<div class="ca"><button onclick="deleteVaultFile(\'' + escA(f.id) + '\')" title="Delete"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg></button></div></div></div></div>';
  }).join('');
}

function searchVault(q) {
  vaultQ = q;
  const clr = document.getElementById('vaultSearchClear');
  if (clr) clr.style.display = q ? '' : 'none';
  renderVaultGrid();
}

function setVaultSort(s) {
  vaultSort = s;
  document.querySelectorAll('.vault-sort-btn').forEach(b => b.classList.toggle('on', b.dataset.sort === s));
  renderVaultGrid();
}

async function addVaultFiles() {
  const input = document.getElementById('vaultFileIn');
  const files = input.files;
  if (!files.length) return;
  const prog = document.getElementById('vaultProgress');
  prog.style.display = 'block';
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    prog.textContent = 'Encrypting ' + (i + 1) + '/' + files.length + ': ' + f.name + '\u2026';
    const r = await fetch('/api/vault/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(f.name) },
      body: f
    });
    if (!r.ok) toast('Failed to encrypt: ' + f.name);
  }
  prog.style.display = 'none';
  input.value = '';
  loadVaultFiles();
  toast('Encrypted and stored in vault');
}

async function openVaultVid(id, name, ext) {
  document.getElementById('bv').classList.add('off');
  document.getElementById('vaultV').classList.remove('on');
  document.getElementById('pv').classList.add('on');
  document.getElementById('vP').src = '/api/vault/stream/' + id;
  document.getElementById('pT').textContent = name;
  document.getElementById('pC').textContent = 'Vault';
  document.getElementById('pS').textContent = '';
  document.getElementById('pD').textContent = '';
  document.getElementById('sG').innerHTML = '';
  curV = { id, name, category: 'Vault', fav: false, isVault: true };
  curVTags = []; curVAllCategories = []; curVActors = [];
  renderVideoTags();
  renderRating(null);
  updPStar();
  if (!vaultFiles.length) vaultFiles = await (await fetch('/api/vault/files')).then(r => r.json()).catch(() => []);
  const _vaultBase = vaultQ ? vaultFiles.filter(f => (f.name || f.originalName).toLowerCase().includes(vaultQ.toLowerCase())) : vaultFiles;
  vaultPl = _vaultBase.filter(f => !VAULT_IMG_EXTS.has((f.ext || '').toLowerCase()));
  vaultPlIdx = vaultPl.findIndex(f => f.id === id);
  if (vaultPlIdx < 0) vaultPlIdx = 0;
  renderVaultPlaylist();
  window.scrollTo(0, 0);
}

function renderVaultPlaylist() {
  const listEl = document.getElementById('pplList');
  const countEl = document.getElementById('pplCount');
  countEl.textContent = vaultPl.length + ' video' + (vaultPl.length !== 1 ? 's' : '');
  if (!vaultPl.length) { listEl.innerHTML = '<div class="ppl-empty">No videos in vault</div>'; return; }
  const cols = ['#e84040','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];
  listEl.innerHTML = vaultPl.map((f, i) => {
    const c = cols[Math.abs(hsh(f.originalName)) % cols.length];
    const isCur = curV && f.id === curV.id;
    return '<div class="ppl-item' + (isCur ? ' cur' : '') + '" id="vppl-' + escA(f.id) + '" onclick="vaultCardClick(\'' + escA(f.id) + '\',\'' + escA(f.name || f.originalName) + '\',\'' + escA(f.ext) + '\')">' +
      '<div class="ct ppl-ct" style="background:linear-gradient(135deg,' + c + '12 0%,' + c + '06 100%)">' +
        '<div class="po" style="transform:translate(-50%,-50%) scale(0.6)"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></div>' +
        '<span class="szb">' + f.sizeF + '</span>' +
      '</div>' +
      '<div class="ppl-info">' +
        '<span class="ppl-num">' + (i + 1) + '</span>' +
        '<span class="ppl-name">' + esc(f.name || f.originalName) + '</span>' +
        '<span class="ppl-cat">Vault</span>' +
      '</div></div>';
  }).join('');
  const curEl = document.getElementById('vppl-' + (curV ? curV.id : ''));
  if (curEl) setTimeout(() => curEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
}

async function deleteVaultFile(id) {
  if (!confirm('Permanently delete this encrypted file?')) return;
  const r = await fetch('/api/vault/files/' + id, { method: 'DELETE' });
  if (!r.ok) { toast('Delete failed'); return; }
  toast('Deleted');
  loadVaultFiles();
}

function vaultCardClick(id, name, ext) {
  if (vaultSelMode) toggleVaultSel(id);
  else if (VAULT_IMAGE_EXTS.has(ext.toLowerCase())) openVaultPhoto(id, name);
  else openVaultVid(id, name, ext);
}

function openVaultPhoto(id, name) {
  const overlay = document.getElementById('vaultPhotoOverlay');
  document.getElementById('vaultPhotoImg').src = '/api/vault/stream/' + id;
  document.getElementById('vaultPhotoName').textContent = name;
  overlay.classList.add('on');
  document.addEventListener('keydown', _vaultPhotoKey);
}

function closeVaultPhoto() {
  document.getElementById('vaultPhotoOverlay').classList.remove('on');
  document.getElementById('vaultPhotoImg').src = '';
  document.removeEventListener('keydown', _vaultPhotoKey);
}

function _vaultPhotoKey(e) { if (e.key === 'Escape') closeVaultPhoto(); }

function toggleVaultSelMode() {
  vaultSelMode = !vaultSelMode;
  const btn = document.getElementById('vaultSelBtn');
  if (btn) btn.classList.toggle('on', vaultSelMode);
  const grid = document.getElementById('vaultGrid');
  if (grid) grid.classList.toggle('vault-sel-mode', vaultSelMode);
  if (!vaultSelMode) { clearVaultSelection(); }
}

function toggleVaultSel(id) {
  if (vaultSel.has(id)) vaultSel.delete(id); else vaultSel.add(id);
  const chk = document.getElementById('vchk-' + id);
  const card = document.querySelector('[data-vault-id="' + id + '"]');
  if (chk) chk.classList.toggle('on', vaultSel.has(id));
  if (card) card.classList.toggle('vault-selected', vaultSel.has(id));
  updateVaultSelBar();
}

function clearVaultSelection() {
  vaultSel.forEach(id => {
    const chk = document.getElementById('vchk-' + id);
    const card = document.querySelector('[data-vault-id="' + id + '"]');
    if (chk) chk.classList.remove('on');
    if (card) card.classList.remove('vault-selected');
  });
  vaultSel.clear();
  updateVaultSelBar();
}

function updateVaultSelBar() {
  const bar = document.getElementById('vaultSelBar');
  const count = document.getElementById('vaultSelCount');
  if (!bar) return;
  if (vaultSel.size === 0) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  count.textContent = vaultSel.size + ' selected';
}

function downloadVaultSelected() {
  const ids = [...vaultSel];
  ids.forEach((id, i) => {
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = '/api/vault/download/' + id;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }, i * 300);
  });
  toast('Downloading ' + ids.length + ' file' + (ids.length > 1 ? 's' : '') + '\u2026');
}

window.addEventListener('pagehide', () => { navigator.sendBeacon('/api/vault/lock'); });
