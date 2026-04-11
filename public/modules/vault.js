// ─── Vault ───
async function showVault() {
  if (mosaicOn) stopMosaic();
  if (location.pathname !== '/vault') history.pushState(null, '', '/vault');
  vaultMode = true;
  $('bv').add('off');
  $('pv').remove('on');
  $('dv').remove('on');
  $('dupSB').remove('on');
  $('sv').remove('on');
  $('sdv').remove('on');
  $('studioSB').remove('on');
  $('av').remove('on');
  $('adv').remove('on');
  $('actorSB').remove('on');
  $('tagDV').remove('on');
  document.querySelectorAll('#tagList .ci').forEach(el => el.classList.remove('on'));
  dupMode = false; studioMode = false; curStudio = null; actorMode = false; curActor = null; curTag = null;
  if (curV) { const vp = $('vP').el; vp.pause(); vp.src = ''; curV = null; }
  $('vaultSB').add('on');
  $('vaultV').add('on');
  loadVaultView();
}

async function loadVaultView() {
  const s = await (await fetch('/api/vault/status')).json();
  const auth = $('vaultAuth').el;
  const files = $('vaultFiles').el;
  const btn = $('vaultAuthBtn').el;
  const err = $('vaultErr').el;
  err.textContent = '';
  if (s.unlocked) {
    auth.style.display = 'none';
    files.style.display = 'block';
    loadVaultFiles();
  } else if (!s.configured) {
    auth.style.display = 'flex';
    files.style.display = 'none';
    $('vaultAuthTitle').text('Create Vault');
    $('vaultAuthDesc').text('Set a master password. It cannot be changed or recovered.');
    $('vaultPwConfirm').el.style.display = 'block';
    btn.textContent = 'Create Vault';
    btn.onclick = doVaultSetup;
  } else {
    auth.style.display = 'flex';
    files.style.display = 'none';
    $('vaultAuthTitle').text('Vault Locked');
    $('vaultAuthDesc').text('Enter your password to access encrypted files.');
    $('vaultPwConfirm').show(false);
    btn.textContent = 'Unlock';
    btn.onclick = doVaultUnlock;
  }
}

async function doVaultSetup() {
  const pw = $('vaultPw').el.value;
  const pw2 = $('vaultPwConfirm').el.value;
  const err = $('vaultErr').el;
  const btn = $('vaultAuthBtn').el;
  err.textContent = '';
  if (pw.length < 6) { err.textContent = 'Password must be at least 6 characters'; return; }
  if (pw !== pw2) { err.textContent = 'Passwords do not match'; return; }
  btn.disabled = true; btn.textContent = 'Creating…';
  const r = await fetch('/api/vault/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
  const d = await r.json();
  btn.disabled = false;
  if (!r.ok) { err.textContent = d.error || 'Failed'; btn.textContent = 'Create Vault'; return; }
  $('vaultPw').val('');
  $('vaultPwConfirm').val('');
  loadVaultView();
}

async function doVaultUnlock() {
  const pw = $('vaultPw').el.value;
  const err = $('vaultErr').el;
  const btn = $('vaultAuthBtn').el;
  err.textContent = '';
  btn.disabled = true; btn.textContent = 'Verifying…';
  const r = await fetch('/api/vault/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
  const d = await r.json();
  btn.disabled = false; btn.textContent = 'Unlock';
  if (!r.ok) { err.textContent = d.error || 'Wrong password'; return; }
  $('vaultPw').val('');
  loadVaultView();
}

async function lockVault() {
  await fetch('/api/vault/lock', { method: 'POST' });
  loadVaultView();
}

async function loadVaultFiles() {
  vaultQ = ''; vaultSort = 'date';
  const vsi = $('vaultSearchInput').el;
  if (vsi) vsi.value = '';
  document.querySelectorAll('.vault-sort-btn').forEach(b => b.classList.toggle('on', b.dataset.sort === 'date'));
  vaultSelMode = false;
  vaultSel.clear();
  updateVaultSelBar();
  const selBtn = $('vaultSelBtn').el;
  if (selBtn) selBtn.classList.remove('on');
  const grid = $('vaultGrid').el;
  const empty = $('vaultEmpty').el;
  grid.innerHTML = '<div class="dup-scan">Loading\u2026</div>';
  empty.style.display = 'none';
  const files = await (await fetch('/api/vault/files')).json();
  if (files.error) { grid.innerHTML = ''; return; }
  vaultFiles = files;
  renderVaultGrid();
}

function renderVaultGrid() {
  const grid = $('vaultGrid').el;
  const empty = $('vaultEmpty').el;
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
  const clr = $('vaultSearchClear').el;
  if (clr) clr.style.display = q ? '' : 'none';
  renderVaultGrid();
}

function setVaultSort(s) {
  vaultSort = s;
  document.querySelectorAll('.vault-sort-btn').forEach(b => b.classList.toggle('on', b.dataset.sort === s));
  renderVaultGrid();
}

async function addVaultFiles() {
  const input = $('vaultFileIn').el;
  const files = input.files;
  if (!files.length) return;
  const prog = $('vaultProgress').el;
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
  $('bv').add('off');
  $('vaultV').remove('on');
  $('pv').add('on');
  $('vP').el.src = '/api/vault/stream/' + id;
  $('pT').text(name);
  $('pC').text('Vault');
  $('pS').text('');
  $('pD').text('');
  $('sG').html('');
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
  const listEl = $('pplList').el;
  const countEl = $('pplCount').el;
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
  const curEl = $('vppl-' + (curV ? curV.id : '').el);
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
  const overlay = $('vaultPhotoOverlay').el;
  $('vaultPhotoImg').el.src = '/api/vault/stream/' + id;
  $('vaultPhotoName').text(name);
  overlay.classList.add('on');
  document.addEventListener('keydown', _vaultPhotoKey);
}

function closeVaultPhoto() {
  $('vaultPhotoOverlay').remove('on');
  $('vaultPhotoImg').el.src = '';
  document.removeEventListener('keydown', _vaultPhotoKey);
}

function _vaultPhotoKey(e) { if (e.key === 'Escape') closeVaultPhoto(); }

function toggleVaultSelMode() {
  vaultSelMode = !vaultSelMode;
  const btn = $('vaultSelBtn').el;
  if (btn) btn.classList.toggle('on', vaultSelMode);
  const grid = $('vaultGrid').el;
  if (grid) grid.classList.toggle('vault-sel-mode', vaultSelMode);
  if (!vaultSelMode) { clearVaultSelection(); }
}

function toggleVaultSel(id) {
  if (vaultSel.has(id)) vaultSel.delete(id); else vaultSel.add(id);
  const chk = $('vchk-' + id).el;
  const card = document.querySelector('[data-vault-id="' + id + '"]');
  if (chk) chk.classList.toggle('on', vaultSel.has(id));
  if (card) card.classList.toggle('vault-selected', vaultSel.has(id));
  updateVaultSelBar();
}

function clearVaultSelection() {
  vaultSel.forEach(id => {
    const chk = $('vchk-' + id).el;
    const card = document.querySelector('[data-vault-id="' + id + '"]');
    if (chk) chk.classList.remove('on');
    if (card) card.classList.remove('vault-selected');
  });
  vaultSel.clear();
  updateVaultSelBar();
}

function updateVaultSelBar() {
  const bar = $('vaultSelBar').el;
  const count = $('vaultSelCount').el;
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
