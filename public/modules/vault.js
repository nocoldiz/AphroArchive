// ─── Vault ───
async function showVault() {
  closeAllViews();
  if (location.pathname !== '/vault') history.pushState(null, '', '/vault');
  vaultMode = true;
  $('browse-view').add('off');
  $('vault-sidebar').add('on');
  $('vault-view').add('on');
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
  vaultQ = ''; vaultSort = 'date'; vaultCurFolder = null;
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
  grid.innerHTML = tpl('loading', { message: 'Loading\u2026' });
  empty.style.display = 'none';
  const items = await (await fetch('/api/vault/files')).json();
  if (items.error) { grid.innerHTML = ''; return; }
  vaultFolders = items.filter(f => f.type === 'folder');
  vaultFiles   = items.filter(f => f.type !== 'folder');
  renderVaultGrid();
}

function renderVaultGrid() {
  const grid  = $('vaultGrid').el;
  const empty = $('vaultEmpty').el;
  _renderVaultBreadcrumb();
  const q = vaultQ.toLowerCase();

  // folders only show in root and only when not searching
  let folderHtml = '';
  if (!vaultCurFolder && !q) {
    folderHtml = vaultFolders.map(f =>
      '<div class="vault-folder-tile fade-in" data-vault-id="' + escA(f.id) + '">' +
        '<div class="vault-folder-icon" onclick="enterVaultFolder(\'' + escA(f.id) + '\',\'' + escA(f.name) + '\')">' +
          '<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' +
        '</div>' +
        '<div class="vault-folder-name" title="' + escA(f.name) + '" onclick="enterVaultFolder(\'' + escA(f.id) + '\',\'' + escA(f.name) + '\')">' + esc(f.name) + '</div>' +
        '<button class="vault-folder-del" onclick="deleteVaultFolder(\'' + escA(f.id) + '\',\'' + escA(f.name) + '\')" title="Delete folder"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg></button>' +
      '</div>'
    ).join('');
  }

  let files = q
    ? vaultFiles.filter(f => (f.name || f.originalName).toLowerCase().includes(q))
    : vaultFiles.filter(f => (f.folder || null) === vaultCurFolder);
  if (vaultSort === 'size-asc') files.sort((a, b) => a.size - b.size);
  else if (vaultSort === 'size-desc') files.sort((a, b) => b.size - a.size);
  else if (vaultSort === 'name') files.sort((a, b) => (a.name || a.originalName).localeCompare(b.name || b.originalName));

  if (!folderHtml && !files.length) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    empty.querySelector('p').textContent = vaultQ ? 'No results for "' + vaultQ + '"' : (vaultCurFolder ? 'This folder is empty' : 'Add video files using the button above');
    return;
  }
  empty.style.display = 'none';
  const cols = ['#e84040','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];
  const filesHtml = files.map(f => {
    const isImg = VAULT_IMG_EXTS.has(f.ext.toLowerCase());
    const c = cols[Math.abs(hsh(f.originalName)) % cols.length];
    const ctClass = 'card-thumb vault-ct' + (isImg ? ' has-thumb' : '');
    const ctStyle = isImg ? 'cursor:pointer' : 'background:linear-gradient(135deg,' + c + '12 0%,' + c + '06 100%);cursor:pointer';
    const inner = isImg
      ? '<img src="/api/vault/stream/' + escA(f.id) + '" alt="" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">'
      : '<span class="ext-badge">' + f.ext.replace('.','') + '</span>';
    const moveFolderOpts = vaultFolders.length
      ? '<button onclick="showVaultMoveMenu(event,\'' + escA(f.id) + '\')" title="Move to folder"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button>'
      : '';
    return '<div class="video-card fade-in" data-vault-id="' + escA(f.id) + '">' +
      '<div class="' + ctClass + '" style="' + ctStyle + '" onclick="vaultCardClick(\'' + escA(f.id) + '\',\'' + escA(f.name || f.originalName) + '\',\'' + escA(f.ext) + '\')">' +
      inner +
      '<div class="vault-chk" id="vchk-' + escA(f.id) + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>' +
      '<div class="play-overlay"></div>' +
      '<span class="size-badge">' + f.sizeF + '</span></div>' +
      '<div class="card-body"><div class="card-title" title="' + escA(f.originalName) + '">' + esc(f.name || f.originalName) + '</div>' +
      '<div class="card-meta"><span class="card-category" style="color:var(--ac)">Vault</span>' +
      '<div class="card-actions">' + moveFolderOpts + '<button onclick="deleteVaultFile(\'' + escA(f.id) + '\')" title="Delete"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg></button></div></div></div></div>';
  }).join('');
  grid.innerHTML = folderHtml
    ? '<div class="vault-folders-row">' + folderHtml + '</div>' + filesHtml
    : filesHtml;
}

function _renderVaultBreadcrumb() {
  const bc = $('vaultBreadcrumb').el;
  if (!bc) return;
  if (!vaultCurFolder) { bc.style.display = 'none'; return; }
  const folder = vaultFolders.find(f => f.id === vaultCurFolder);
  bc.style.display = 'flex';
  bc.innerHTML =
    '<button class="vault-bc-back" onclick="exitVaultFolder()"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg></button>' +
    '<span class="vault-bc-root" onclick="exitVaultFolder()">Vault</span>' +
    '<span class="vault-bc-sep">/</span>' +
    '<span class="vault-bc-cur">' + esc(folder ? folder.name : 'Folder') + '</span>';
}

function enterVaultFolder(id, name) {
  vaultCurFolder = id;
  renderVaultGrid();
}

function exitVaultFolder() {
  vaultCurFolder = null;
  renderVaultGrid();
}

async function newVaultFolder() {
  const name = prompt('Folder name:');
  if (!name || !name.trim()) return;
  const r = await fetch('/api/vault/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) });
  const d = await r.json();
  if (!r.ok) { toast(d.error || 'Failed to create folder'); return; }
  vaultFolders.push({ id: d.id, name: d.name, type: 'folder', mtime: Date.now() });
  renderVaultGrid();
}

async function deleteVaultFolder(id, name) {
  if (!confirm('Delete folder "' + name + '"? Files inside will be moved to root.')) return;
  const r = await fetch('/api/vault/folders/' + id, { method: 'DELETE' });
  if (!r.ok) { toast('Failed to delete folder'); return; }
  vaultFolders = vaultFolders.filter(f => f.id !== id);
  vaultFiles = vaultFiles.map(f => f.folder === id ? { ...f, folder: null } : f);
  if (vaultCurFolder === id) vaultCurFolder = null;
  renderVaultGrid();
  toast('Folder deleted');
}

let _vaultMoveMenuOpen = null;
function showVaultMoveMenu(e, fileId) {
  e.stopPropagation();
  closeVaultMoveMenu();
  const menu = document.createElement('div');
  menu.className = 'vault-move-menu';
  menu.id = 'vaultMoveMenu';
  const file = vaultFiles.find(f => f.id === fileId);
  const curFolder = file ? (file.folder || null) : null;
  const opts = [{ id: null, name: 'Root (no folder)' }, ...vaultFolders]
    .filter(f => f.id !== curFolder)
    .map(f => '<button onclick="moveVaultFile(\'' + escA(fileId) + '\',\'' + escA(f.id || '') + '\')">' + esc(f.name) + '</button>')
    .join('');
  menu.innerHTML = '<div class="vault-move-menu-title">Move to</div>' + opts;
  document.body.appendChild(menu);
  const rect = e.currentTarget.getBoundingClientRect();
  menu.style.top  = (rect.bottom + 4 + window.scrollY) + 'px';
  menu.style.left = Math.min(rect.left, window.innerWidth - 160) + 'px';
  _vaultMoveMenuOpen = fileId;
  setTimeout(() => document.addEventListener('click', closeVaultMoveMenu, { once: true }), 0);
}

function closeVaultMoveMenu() {
  const m = document.getElementById('vaultMoveMenu');
  if (m) m.remove();
  _vaultMoveMenuOpen = null;
}

async function moveVaultFile(fileId, folderId) {
  closeVaultMoveMenu();
  const folder = folderId || null;
  const r = await fetch('/api/vault/files/' + fileId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder }) });
  if (!r.ok) { toast('Move failed'); return; }
  vaultFiles = vaultFiles.map(f => f.id === fileId ? { ...f, folder } : f);
  renderVaultGrid();
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

async function _reloadVaultItems() {
  const items = await (await fetch('/api/vault/files')).json();
  if (items.error) return;
  vaultFolders = items.filter(f => f.type === 'folder');
  vaultFiles   = items.filter(f => f.type !== 'folder');
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
    const headers = { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(f.name) };
    if (vaultCurFolder) headers['X-Folder'] = vaultCurFolder;
    const r = await fetch('/api/vault/add', { method: 'POST', headers, body: f });
    if (!r.ok) toast('Failed to encrypt: ' + f.name);
  }
  prog.style.display = 'none';
  input.value = '';
  const savedFolder = vaultCurFolder;
  await _reloadVaultItems();
  vaultCurFolder = savedFolder;
  renderVaultGrid();
  toast('Encrypted and stored in vault');
}

async function openVaultVid(id, name, ext) {
  $('browse-view').add('off');
  $('vault-view').remove('on');
  $('player-view').add('on');
  $('video-player').el.src = '/api/vault/stream/' + id;
  $('player-title').text(name);
  $('player-category').text('Vault');
  $('player-size').text('');
  $('player-duration').text('');
  $('suggestions-grid').html('');
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
  const listEl = $('playlist-list').el;
  const countEl = $('playlist-count').el;
  countEl.textContent = vaultPl.length + ' video' + (vaultPl.length !== 1 ? 's' : '');
  if (!vaultPl.length) { listEl.innerHTML = '<div class="playlist-empty">No videos in vault</div>'; return; }
  const cols = ['#e84040','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];
  listEl.innerHTML = vaultPl.map((f, i) => {
    const c = cols[Math.abs(hsh(f.originalName)) % cols.length];
    const isCur = curV && f.id === curV.id;
    return '<div class="playlist-item' + (isCur ? ' cur' : '') + '" id="vppl-' + escA(f.id) + '" onclick="vaultCardClick(\'' + escA(f.id) + '\',\'' + escA(f.name || f.originalName) + '\',\'' + escA(f.ext) + '\')">' +
      '<div class="card-thumb playlist-thumb" style="background:linear-gradient(135deg,' + c + '12 0%,' + c + '06 100%)">' +
        '<div class="play-overlay" style="transform:translate(-50%,-50%) scale(0.6)"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></div>' +
        '<span class="size-badge">' + f.sizeF + '</span>' +
      '</div>' +
      '<div class="playlist-info">' +
        '<span class="playlist-num">' + (i + 1) + '</span>' +
        '<span class="playlist-name">' + esc(f.name || f.originalName) + '</span>' +
        '<span class="playlist-category">Vault</span>' +
      '</div></div>';
  }).join('');
  const curEl = $('vppl-' + (curV ? curV.id : '').el);
  if (curEl) setTimeout(() => curEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
}

async function deleteVaultFile(id) {
  if (!confirm('Permanently delete this encrypted file?')) return;
  const r = await fetch('/api/vault/files/' + id, { method: 'DELETE' });
  if (!r.ok) { toast('Delete failed'); return; }
  vaultFiles = vaultFiles.filter(f => f.id !== id);
  renderVaultGrid();
  toast('Deleted');
}

function vaultCardClick(id, name, ext) {
  if (vaultSelMode) toggleVaultSel(id);
  else if (VAULT_IMAGE_EXTS.has(ext.toLowerCase())) openVaultPhoto(id, name);
  else openVaultVid(id, name, ext);
}

// ── Zoom / pan state ──────────────────────────────────────────────────
let _vpZ = 1, _vpX = 0, _vpY = 0;           // zoom, panX, panY
let _vpDrag = false, _vpDragSX = 0, _vpDragSY = 0, _vpDragMoved = false;
let _vpPinchDist = 0;
let _vpZoomFadeTimer = null;

function _vpApply() {
  const img = $('vaultPhotoImg').el;
  if (!img) return;
  img.style.transform = 'translate(' + _vpX + 'px,' + _vpY + 'px) scale(' + _vpZ + ')';
  img.style.cursor = _vpZ > 1 ? (_vpDrag ? 'grabbing' : 'grab') : '';
  // zoom badge
  const badge = document.getElementById('vaultZoomBadge');
  if (badge) {
    if (_vpZ > 1) {
      badge.textContent = Math.round(_vpZ * 10) / 10 + '\u00d7';
      badge.style.opacity = '1';
      clearTimeout(_vpZoomFadeTimer);
      _vpZoomFadeTimer = setTimeout(() => { badge.style.opacity = '0'; }, 1500);
    } else {
      badge.style.opacity = '0';
    }
  }
}

function _vpReset() {
  _vpZ = 1; _vpX = 0; _vpY = 0; _vpDrag = false; _vpDragMoved = false;
  _vpApply();
}

function _vpWheel(e) {
  e.preventDefault();
  const ov = $('vaultPhotoOverlay').el;
  const r  = ov.getBoundingClientRect();
  const dx = e.clientX - (r.left + r.width  / 2);
  const dy = e.clientY - (r.top  + r.height / 2);
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  const oldZ = _vpZ;
  const newZ = Math.max(1, Math.min(8, _vpZ * factor));
  if (newZ === 1) { _vpX = 0; _vpY = 0; }
  else { const f = newZ / oldZ; _vpX = dx * (1 - f) + _vpX * f; _vpY = dy * (1 - f) + _vpY * f; }
  _vpZ = newZ;
  _vpApply();
}

function _vpMousedown(e) {
  if (_vpZ <= 1 || e.button !== 0) return;
  e.preventDefault();
  _vpDrag = true; _vpDragMoved = false;
  _vpDragSX = e.clientX - _vpX; _vpDragSY = e.clientY - _vpY;
  _vpApply();
}

function _vpMousemove(e) {
  if (!_vpDrag) return;
  _vpDragMoved = true;
  _vpX = e.clientX - _vpDragSX; _vpY = e.clientY - _vpDragSY;
  _vpApply();
}

function _vpMouseup(e) {
  if (!_vpDrag) return;
  _vpDrag = false;
  _vpApply();
  if (_vpDragMoved) { e.stopPropagation(); _vpDragMoved = false; }
}

function _vpDblclick(e) {
  e.stopPropagation();
  _vpReset();
}

function _vpTouchstart(e) {
  if (e.touches.length === 2) {
    _vpPinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  } else if (e.touches.length === 1 && _vpZ > 1) {
    _vpDrag = true; _vpDragMoved = false;
    _vpDragSX = e.touches[0].clientX - _vpX; _vpDragSY = e.touches[0].clientY - _vpY;
  }
}

function _vpTouchmove(e) {
  if (e.touches.length === 2) {
    e.preventDefault();
    const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const ov = $('vaultPhotoOverlay').el;
    const r  = ov.getBoundingClientRect();
    const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const dx = mx - (r.left + r.width / 2), dy = my - (r.top + r.height / 2);
    const oldZ = _vpZ;
    const newZ = Math.max(1, Math.min(8, _vpZ * (dist / _vpPinchDist)));
    if (newZ === 1) { _vpX = 0; _vpY = 0; }
    else { const f = newZ / oldZ; _vpX = dx * (1 - f) + _vpX * f; _vpY = dy * (1 - f) + _vpY * f; }
    _vpZ = newZ; _vpPinchDist = dist;
    _vpApply();
  } else if (e.touches.length === 1 && _vpDrag) {
    _vpDragMoved = true;
    _vpX = e.touches[0].clientX - _vpDragSX; _vpY = e.touches[0].clientY - _vpDragSY;
    _vpApply();
  }
}

function _vpTouchend(e) {
  if (e.touches.length < 2) _vpPinchDist = 0;
  if (e.touches.length === 0) { _vpDrag = false; _vpDragMoved = false; }
}

function _vpAttach() {
  const ov = $('vaultPhotoOverlay').el;
  ov.addEventListener('wheel',      _vpWheel,      { passive: false });
  ov.addEventListener('mousedown',  _vpMousedown);
  ov.addEventListener('mousemove',  _vpMousemove);
  ov.addEventListener('mouseup',    _vpMouseup,    true);
  ov.addEventListener('dblclick',   _vpDblclick);
  ov.addEventListener('touchstart', _vpTouchstart, { passive: true });
  ov.addEventListener('touchmove',  _vpTouchmove,  { passive: false });
  ov.addEventListener('touchend',   _vpTouchend,   { passive: true });
}

function _vpDetach() {
  const ov = $('vaultPhotoOverlay').el;
  ov.removeEventListener('wheel',      _vpWheel);
  ov.removeEventListener('mousedown',  _vpMousedown);
  ov.removeEventListener('mousemove',  _vpMousemove);
  ov.removeEventListener('mouseup',    _vpMouseup,   true);
  ov.removeEventListener('dblclick',   _vpDblclick);
  ov.removeEventListener('touchstart', _vpTouchstart);
  ov.removeEventListener('touchmove',  _vpTouchmove);
  ov.removeEventListener('touchend',   _vpTouchend);
}

// ── Photo open / show / close ─────────────────────────────────────────

function openVaultPhoto(id, name) {
  const q = vaultQ.toLowerCase();
  let files = q ? vaultFiles.filter(f => (f.name || f.originalName).toLowerCase().includes(q)) : vaultFiles.slice();
  if (vaultSort === 'size-asc') files.sort((a, b) => a.size - b.size);
  else if (vaultSort === 'size-desc') files.sort((a, b) => b.size - a.size);
  else if (vaultSort === 'name') files.sort((a, b) => (a.name || a.originalName).localeCompare(b.name || b.originalName));
  vaultPhotos = files.filter(f => VAULT_IMG_EXTS.has(f.ext.toLowerCase()));
  vaultPhotoIdx = vaultPhotos.findIndex(f => f.id === id);
  if (vaultPhotoIdx < 0) vaultPhotoIdx = 0;
  _vpReset();
  _showVaultPhoto();
  document.addEventListener('keydown', _vaultPhotoKey);
  _vpAttach();
}

function _showVaultPhoto() {
  const f = vaultPhotos[vaultPhotoIdx];
  if (!f) return;
  _vpReset();
  const overlay = $('vaultPhotoOverlay').el;
  $('vaultPhotoImg').el.src = '/api/vault/stream/' + f.id;
  $('vaultPhotoName').text(f.name || f.originalName);
  overlay.classList.add('on');
  const prevBtn = $('vaultPhotoPrev').el;
  const nextBtn = $('vaultPhotoNext').el;
  if (prevBtn) prevBtn.style.display = vaultPhotos.length > 1 ? '' : 'none';
  if (nextBtn) nextBtn.style.display = vaultPhotos.length > 1 ? '' : 'none';
}

function prevVaultPhoto(manual) {
  if (!vaultPhotos.length) return;
  if (manual) _stopVaultSs();
  vaultPhotoIdx = (vaultPhotoIdx - 1 + vaultPhotos.length) % vaultPhotos.length;
  _showVaultPhoto();
}

function nextVaultPhoto(manual) {
  if (!vaultPhotos.length) return;
  if (manual) _stopVaultSs();
  vaultPhotoIdx = (vaultPhotoIdx + 1) % vaultPhotos.length;
  _showVaultPhoto();
}

let _vaultSsTimer = null, _vaultSsInterval = 4, _vaultSsOn = false;
let _vaultSsRafId = null, _vaultSsStart = 0;

function toggleVaultSlideshow() {
  if (_vaultSsOn) _stopVaultSs(); else _startVaultSs();
}

function setVaultSsInterval(v) {
  const n = Math.max(1, Math.min(60, parseFloat(v) || 4));
  _vaultSsInterval = n;
  const inp = $('vaultSsInterval').el;
  if (inp) inp.value = n;
  if (_vaultSsOn) { _stopVaultSs(); _startVaultSs(); }
}

function _startVaultSs() {
  if (vaultPhotos.length < 2) return;
  _vaultSsOn = true;
  const btn = $('vaultSsBtn').el;
  if (btn) { btn.querySelector('.ss-icon-play').style.display = 'none'; btn.querySelector('.ss-icon-pause').style.display = ''; btn.classList.add('on'); }
  _vaultSsAdvance();
}

function _vaultSsAdvance() {
  _vaultSsStart = performance.now();
  _vaultSsAnimFrame();
  _vaultSsTimer = setTimeout(() => {
    nextVaultPhoto();
    if (_vaultSsOn) _vaultSsAdvance();
  }, _vaultSsInterval * 1000);
}

function _vaultSsAnimFrame() {
  if (!_vaultSsOn) return;
  const elapsed = performance.now() - _vaultSsStart;
  const pct = Math.min(100, (elapsed / (_vaultSsInterval * 1000)) * 100);
  const bar = $('vaultSsProgressBar').el;
  if (bar) bar.style.width = pct + '%';
  if (pct < 100) _vaultSsRafId = requestAnimationFrame(_vaultSsAnimFrame);
}

function _stopVaultSs() {
  _vaultSsOn = false;
  clearTimeout(_vaultSsTimer);
  cancelAnimationFrame(_vaultSsRafId);
  const btn = $('vaultSsBtn').el;
  if (btn) { btn.querySelector('.ss-icon-play').style.display = ''; btn.querySelector('.ss-icon-pause').style.display = 'none'; btn.classList.remove('on'); }
  const bar = $('vaultSsProgressBar').el;
  if (bar) bar.style.width = '0%';
}

function closeVaultPhoto() {
  _stopVaultSs();
  _vpReset();
  _vpDetach();
  $('vaultPhotoOverlay').remove('on');
  $('vaultPhotoImg').el.src = '';
  document.removeEventListener('keydown', _vaultPhotoKey);
  vaultPhotos = [];
  vaultPhotoIdx = -1;
}

function _vaultPhotoKey(e) {
  if (e.key === 'Escape') closeVaultPhoto();
  else if (e.key === 'ArrowLeft'  && _vpZ <= 1) { _stopVaultSs(); prevVaultPhoto(); }
  else if (e.key === 'ArrowRight' && _vpZ <= 1) { _stopVaultSs(); nextVaultPhoto(); }
  else if (e.key === ' ') { e.preventDefault(); toggleVaultSlideshow(); }
  else if (e.key === '+' || e.key === '=') { const nz = Math.min(8, _vpZ * 1.25); _vpZ = nz; _vpApply(); }
  else if (e.key === '-') { const nz = Math.max(1, _vpZ / 1.25); if (nz === 1) { _vpX = 0; _vpY = 0; } _vpZ = nz; _vpApply(); }
  else if (e.key === '0') { _vpReset(); }
}

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

async function deleteVaultSelected() {
  const ids = [...vaultSel];
  if (!ids.length) return;
  if (!confirm('Permanently delete ' + ids.length + ' file' + (ids.length > 1 ? 's' : '') + '?')) return;
  for (const id of ids) {
    await fetch('/api/vault/files/' + id, { method: 'DELETE' });
  }
  vaultFiles = vaultFiles.filter(f => !vaultSel.has(f.id));
  vaultSel.clear();
  vaultSelMode = false;
  const selBtn = $('vaultSelBtn').el;
  if (selBtn) selBtn.classList.remove('on');
  const grid = $('vaultGrid').el;
  if (grid) grid.classList.remove('vault-sel-mode');
  updateVaultSelBar();
  renderVaultGrid();
  toast('Deleted ' + ids.length + ' file' + (ids.length > 1 ? 's' : ''));
}

function showVaultSelMoveMenu(e) {
  e.stopPropagation();
  if (!vaultFolders.length) { toast('No folders — create one first'); return; }
  closeVaultMoveMenu();
  const menu = document.createElement('div');
  menu.className = 'vault-move-menu';
  menu.id = 'vaultMoveMenu';
  const opts = [{ id: null, name: 'Root (no folder)' }, ...vaultFolders]
    .map(f => '<button onclick="moveVaultSelected(\'' + escA(f.id || '') + '\')">' + esc(f.name) + '</button>')
    .join('');
  menu.innerHTML = '<div class="vault-move-menu-title">Move ' + vaultSel.size + ' file' + (vaultSel.size > 1 ? 's' : '') + ' to</div>' + opts;
  document.body.appendChild(menu);
  const rect = e.currentTarget.getBoundingClientRect();
  menu.style.top  = (rect.bottom + 4 + window.scrollY) + 'px';
  menu.style.left = Math.min(rect.left, window.innerWidth - 160) + 'px';
  setTimeout(() => document.addEventListener('click', closeVaultMoveMenu, { once: true }), 0);
}

async function moveVaultSelected(folderId) {
  closeVaultMoveMenu();
  const folder = folderId || null;
  const ids = [...vaultSel];
  for (const id of ids) {
    await fetch('/api/vault/files/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder }) });
  }
  vaultFiles = vaultFiles.map(f => vaultSel.has(f.id) ? { ...f, folder } : f);
  clearVaultSelection();
  vaultSelMode = false;
  const selBtn = $('vaultSelBtn').el;
  if (selBtn) selBtn.classList.remove('on');
  const grid = $('vaultGrid').el;
  if (grid) grid.classList.remove('vault-sel-mode');
  renderVaultGrid();
  toast('Moved ' + ids.length + ' file' + (ids.length > 1 ? 's' : ''));
}

async function deleteVaultDuplicates() {
  // Duplicates = same originalName, keep the newest (highest mtime)
  const byName = {};
  for (const f of vaultFiles) {
    const key = (f.originalName || '').toLowerCase();
    if (!byName[key]) byName[key] = [];
    byName[key].push(f);
  }
  const dupes = [];
  for (const group of Object.values(byName)) {
    if (group.length < 2) continue;
    group.sort((a, b) => b.mtime - a.mtime);
    dupes.push(...group.slice(1)); // keep newest, delete rest
  }
  if (!dupes.length) { toast('No duplicates found'); return; }
  if (!confirm('Delete ' + dupes.length + ' duplicate file' + (dupes.length > 1 ? 's' : '') + '? (Keeps newest copy of each)')) return;
  for (const f of dupes) {
    await fetch('/api/vault/files/' + f.id, { method: 'DELETE' });
  }
  const dupeIds = new Set(dupes.map(f => f.id));
  vaultFiles = vaultFiles.filter(f => !dupeIds.has(f.id));
  renderVaultGrid();
  toast('Deleted ' + dupes.length + ' duplicate' + (dupes.length > 1 ? 's' : ''));
}

window.addEventListener('pagehide', () => { navigator.sendBeacon('/api/vault/lock'); });
