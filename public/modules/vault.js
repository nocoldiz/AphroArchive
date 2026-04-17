// ─── Vault ───
async function showVault() {
  closeAllViews();
  if (location.pathname !== '/vault') history.pushState(null, '', '/vault');
  vaultMode = true;
  $('browse-view').add('off');
  $('vault-sidebar').add('on');
  $('vault-view').add('on');
  
  // 1. Set the internal state
  vaultThumbMode = 'hover'; 
  
  if (typeof vaultThumbsVisible !== 'undefined') {
    vaultThumbsVisible = false; 
  }
  
  // 2. Apply the attribute to the grid so CSS reacts [NEW]
  const grid = $('vaultGrid').el;
  if (grid) grid.setAttribute('data-thumb-mode', vaultThumbMode);
  
  // 3. Update the button icon/color to reflect the hover state [NEW]
  const btn = document.getElementById('vault-toggle-thumbs');
  if (btn) btn.style.color = 'var(--star)';

  loadVaultView();
  
  initVaultAutoHide(); 
  initVaultShiftSelection(); 
}
let vaultThumbMode  = 'hover';
let vaultThumbsVisible = false;
let vaultTypeFilter = null; // null | 'video' | 'photo' | 'audio' | 'book' | 'fav' | 'prompt'
let vaultFavIds = new Set();

const VAULT_VIDEO_EXTS = new Set(['.mp4','.webm','.mkv','.mov','.avi','.m4v','.mpg','.mpeg','.wmv','.ts']);
const VAULT_PHOTO_EXTS = new Set(['.jpg','.jpeg','.png','.gif','.webp','.avif','.bmp','.heic','.heif']);
const VAULT_AUDIO_EXTS = new Set(['.mp3','.flac','.wav','.ogg','.aac','.m4a','.opus','.wma']);
const VAULT_BOOK_EXTS  = new Set(['.pdf','.epub','.txt','.mobi','.azw','.azw3','.cbz','.cbr']);

const VAULT_FILTER_TILES = [
  { key: 'fav',   label: 'Favourites', icon: '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' },
  { key: 'video', label: 'Videos', icon: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="5" width="15" height="14" rx="2"/><path d="M17 9l5-3v12l-5-3V9z"/></svg>' },
  { key: 'photo', label: 'Photos', icon: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>' },
  { key: 'audio', label: 'Audio',  icon: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>' },
  { key: 'book',  label: 'Books',  icon: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>' },
  { key: 'prompt',label: 'Prompts',icon: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1" fill="currentColor"/></svg>' },
];
let shiftKeyPressed = false;
let isVaultDragging = false;
let vDragStartX, vDragStartY;
let isDraggingVault = false, dragStartX = 0, dragStartY = 0;
const vaultGrid = document.getElementById('vaultGrid');
const dragBox = document.getElementById('vaultDragBox');
function setupVaultDragSelection() {
  const grid = $('vaultGrid').el;
  const box = document.getElementById('vaultDragBox');

  grid.addEventListener('mousedown', (e) => {
    // ONLY start drag selection if the Shift key is held down
    if (!e.shiftKey) return; 
    
    // Optional: comment out the strict grid target check if you want to be able 
    // to start dragging directly over a card while holding shift.
    // if (e.target !== grid || vaultSelMode) return; 
    
    e.preventDefault(); // Prevent text highlighting while dragging
    isVaultDragging = true;
    vDragStartX = e.clientX;
    vDragStartY = e.clientY;
    
    box.style.display = 'block';
    box.style.width = '0px';
    box.style.height = '0px';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isVaultDragging) return;

    const x = Math.min(e.clientX, vDragStartX);
    const y = Math.min(e.clientY, vDragStartY);
    const w = Math.abs(e.clientX - vDragStartX);
    const h = Math.abs(e.clientY - vDragStartY);

    box.style.left = x + 'px';
    box.style.top = y + 'px';
    box.style.width = w + 'px';
    box.style.height = h + 'px';

    const boxRect = box.getBoundingClientRect();
    document.querySelectorAll('.vault-card, .vault-folder-tile').forEach(card => {
      const cardRect = card.getBoundingClientRect();
      const match = !(boxRect.right < cardRect.left || boxRect.left > cardRect.right || 
                     boxRect.bottom < cardRect.top || boxRect.top > cardRect.bottom);
      
      const id = card.dataset.vaultId;
      if (match) {
        vaultSel.add(id);
        card.classList.add('selected');
      }
    });
    if (vaultSel.size > 0) {
      vaultSelMode = true;
      $('vaultGrid').add('vault-sel-mode');
      $('vaultSelBtn').add('on');
      updateVaultSelBar();
    }
  });

  window.addEventListener('mouseup', () => {
    isVaultDragging = false;
    box.style.display = 'none';
  });
}

async function deleteSelectedVaultItems() {
  const ids = Array.from(vaultSel);
  if (!ids.length) return;
  
  if (!confirm(`Delete ${ids.length} selected items?`)) return;
  
  for (const id of ids) {
    await fetch(`/api/vault/delete/${id}`, { method: 'DELETE' });
  }
  
  vaultSel.clear();
  loadVaultFiles();
  toast(`Deleted ${ids.length} items`);
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
  let vaultSort = 'mtime';
  let vaultSortDir = 'desc';
vaultQ = ''; vaultSort = 'date-desc'; vaultCurFolder = null; vaultTypeFilter = null;
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
  const [items, favs] = await Promise.all([
    fetch('/api/vault/files').then(r => r.json()),
    fetch('/api/vault/favs').then(r => r.json()).catch(() => []),
  ]);
  if (items.error) { grid.innerHTML = ''; return; }
  vaultFavIds = new Set(Array.isArray(favs) ? favs : []);
  vaultFolders = items.filter(f => f.type === 'folder');
  vaultFiles   = items.filter(f => f.type !== 'folder');
  _loadVaultNameCache();
  renderVaultGrid();
  _scanVaultWorkflowNames();
}

function setVaultTypeFilter(key) {
  vaultTypeFilter = vaultTypeFilter === key ? null : key;
  renderVaultGrid();
}

async function toggleVaultFav(e, id) {
  e.stopPropagation();
  const r = await fetch('/api/vault/favs/' + id, { method: 'POST' }).then(r => r.json()).catch(() => null);
  if (!r) return;
  if (r.fav) vaultFavIds.add(id); else vaultFavIds.delete(id);
  document.querySelectorAll('[data-vault-id="' + id + '"] .vault-fav-btn').forEach(btn => {
    btn.classList.toggle('on', r.fav);
    btn.querySelector('svg path').setAttribute('fill', r.fav ? 'currentColor' : 'none');
  });
}

async function showVaultPrompts() {
  closeAllViews();
  vaultPromptsMode = true;
  const backBtn = document.getElementById('vault-prompts-back-btn');
  if (backBtn) backBtn.style.display = '';
  _searchQuery = '';
  const si = document.getElementById('prompts-search');
  if (si) si.value = '';
  $('prompts-view').add('on');
  $('vault-sidebar').add('on');
  await loadPrompts();
  renderPromptsTable();
  if (location.pathname !== '/vault/prompts') history.pushState(null, '', '/vault/prompts');
}

function closeVaultPrompts() {
  vaultPromptsMode = false;
  const backBtn = document.getElementById('vault-prompts-back-btn');
  if (backBtn) backBtn.style.display = 'none';
  showVault();
}

function renderVaultGrid() {
  const grid = $('vaultGrid').el;
  const empty = $('vaultEmpty').el;
  const folderRow = document.getElementById('vault-folders-row'); // Target the new row
  _renderVaultBreadcrumb();
  
  const q = vaultQ.toLowerCase();

  // 1. Generate Folder HTML
  // Virtual filter tiles always shown at root; real user folders only at root without search
  let filterHtml = '';
  if (!vaultCurFolder) {
    filterHtml = VAULT_FILTER_TILES.map(t => {
      const isActive = vaultTypeFilter === t.key;
      const onclick  = t.key === 'prompt'
        ? 'showVaultPrompts()'
        : 'setVaultTypeFilter(\'' + t.key + '\')';
      return '<div class="vault-filter-tile' + (isActive ? ' active' : '') + '" onclick="' + onclick + '">' +
        '<div class="vault-filter-icon">' + t.icon + '</div>' +
        '<div class="vault-folder-name">' + t.label + '</div>' +
      '</div>';
    }).join('');
  }

  let folderHtml = '';
  if (!vaultCurFolder && !q && !vaultTypeFilter) {
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

  // 2. Filter and Sort Files
  let files;
  if (vaultTypeFilter) {
    if (vaultTypeFilter === 'fav') {
      files = vaultFiles.filter(f => vaultFavIds.has(f.id));
    } else {
      const extSet = vaultTypeFilter === 'video' ? VAULT_VIDEO_EXTS
                   : vaultTypeFilter === 'photo' ? VAULT_PHOTO_EXTS
                   : vaultTypeFilter === 'audio' ? VAULT_AUDIO_EXTS
                   : VAULT_BOOK_EXTS;
      files = vaultFiles.filter(f => extSet.has((f.ext || '').toLowerCase()));
    }
    if (q) files = files.filter(f => (f.name || f.originalName).toLowerCase().includes(q));
  } else {
    files = q
      ? vaultFiles.filter(f => (f.name || f.originalName).toLowerCase().includes(q))
      : vaultFiles.filter(f => (f.folder || null) === vaultCurFolder);
  }

  if (vaultSort === 'size-asc') files.sort((a, b) => a.size - b.size);
  else if (vaultSort === 'size-desc') files.sort((a, b) => b.size - a.size);
  else if (vaultSort === 'name') files.sort((a, b) => (a.name || a.originalName).localeCompare(b.name || b.originalName));

  // 3. Handle Empty State
  if (!filterHtml && !folderHtml && !files.length) {
    if (folderRow) folderRow.innerHTML = '';
    grid.innerHTML = '';
    empty.style.display = 'block';
    empty.querySelector('p').textContent = vaultQ ? 'No results for "' + vaultQ + '"' : (vaultCurFolder ? 'This folder is empty' : 'Add video files using the button above');
    return;
  }

  empty.style.display = 'none';

  // 4. Generate Files HTML
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

    const isFav = vaultFavIds.has(f.id);
    const favBtn = '<button onclick="toggleVaultFav(event,\'' + escA(f.id) + '\')" title="Favourite" class="vault-fav-btn' + (isFav ? ' on' : '') + '"><svg width="12" height="12" viewBox="0 0 24 24" fill="' + (isFav ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></button>';
    const metaBtn = f.ext.toLowerCase() === '.png'
      ? '<button onclick="openVaultCardMeta(event,\'' + escA(f.id) + '\')" title="View metadata"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></button>'
      : '';

    return '<div class="video-card fade-in" data-vault-id="' + escA(f.id) + '">' +
      '<div class="' + ctClass + '" style="' + ctStyle + '" onclick="vaultCardClick(\'' + escA(f.id) + '\',\'' + escA(f.name || f.originalName) + '\',\'' + escA(f.ext) + '\')">' +
      inner +
      '<div class="vault-chk" id="vchk-' + escA(f.id) + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>' +
      '<div class="play-overlay"></div>' +
      '<span class="size-badge">' + f.sizeF + '</span></div>' +
      '<div class="card-body"><div class="card-title" title="' + escA(f.originalName) + '">' + esc(_vaultNameCache[f.id] || f.name || f.originalName) + '</div>' +
      '<div class="card-meta"><span class="card-category" style="color:var(--ac)">Vault</span>' +
      '<div class="card-actions">' + favBtn + metaBtn + moveFolderOpts + '<button onclick="deleteVaultFile(\'' + escA(f.id) + '\')" title="Delete"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg></button></div></div></div></div>';
  }).join('');

  // 5. Render to DOM
  if (folderRow) {
    folderRow.innerHTML = filterHtml + folderHtml;
    folderRow.style.display = (filterHtml || folderHtml) ? 'flex' : 'none';
  }
  
  // Update the file grid
  grid.innerHTML = filesHtml;
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

async function handleVaultSort(key) {
  if (vaultSort === key) {
    // If clicking the same key, toggle direction
    vaultSortDir = (vaultSortDir === 'desc') ? 'asc' : 'desc';
  } else {
    // New key selected
    vaultSort = key;
    // Default: Names sort A-Z (asc), Dates and Size sort Newest/Largest (desc)
    vaultSortDir = (key === 'name') ? 'asc' : 'desc';
  }
  applyVaultSort();
}

/**
 * Applies the sort to vaultFiles and refreshes the UI
 */
function applyVaultSort() {
  // 1. Update Arrows in UI
  const keys = ['mtime', 'name', 'size'];
  keys.forEach(k => {
    const el = document.getElementById(`vault-sort-${k}-dir`);
    if (!el) return;
    if (vaultSort === k) {
      el.textContent = (vaultSortDir === 'desc') ? ' ↓' : ' ↑';
    } else {
      el.textContent = '';
    }
  });

  // 2. Perform Sort
  vaultFiles.sort((a, b) => {
    let valA, valB;

    if (vaultSort === 'mtime') {
      valA = a.mtime || 0;
      valB = b.mtime || 0;
    } else if (vaultSort === 'name') {
      valA = (a.originalName || '').toLowerCase();
      valB = (b.originalName || '').toLowerCase();
    } else if (vaultSort === 'size') {
      valA = a.size || 0;
      valB = b.size || 0;
    }

    if (valA < valB) return vaultSortDir === 'asc' ? -1 : 1;
    if (valA > valB) return vaultSortDir === 'asc' ? 1 : -1;
    return 0;
  });

  renderVaultGrid();
}

/**
 * Updated Thumbnails toggle (removes arrow logic)
 */
function toggleVaultThumbs() {
  const grid = $('vaultGrid').el;
  const btn = document.getElementById('vault-toggle-thumbs');
  
  // Cycle states: show -> hide -> hover -> show
  if (vaultThumbMode === 'show') {
    vaultThumbMode = 'hide';
    toast('Thumbnails: Hidden');
  } else if (vaultThumbMode === 'hide') {
    vaultThumbMode = 'hover';
    toast('Thumbnails: Show on Hover');
  } else {
    vaultThumbMode = 'show';
    toast('Thumbnails: Visible');
  }

  // Update the grid attribute so CSS can react
  if (grid) grid.setAttribute('data-thumb-mode', vaultThumbMode);
  
  // Update button icon/opacity to show it's active
  if (btn) {
    btn.style.color = vaultThumbMode === 'show' ? 'var(--ac)' : (vaultThumbMode === 'hover' ? 'var(--star)' : 'inherit');
  }
}
async function createNewVaultTextFile() {
  let name = prompt('Enter text file name:', 'notes.txt');
  if (!name) return;
  
  const r = await fetch('/api/vault/create-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      name: name, 
      folder: vaultCurFolder, 
      content: '' 
    })
  });
  
  if (!r.ok) {
    toast('Failed to create text file');
    return;
  }
  
  loadVaultFiles();
  toast('Empty text file created securely');
}
/**
 * Shuffle logic (Keep existing or use this)
 */
function shuffleVault() {
  // Clear sort indicators
  vaultSort = 'shuffle';
  ['mtime', 'name', 'size'].forEach(k => {
    const el = document.getElementById(`vault-sort-${k}-dir`);
    if (el) el.textContent = '';
  });

  for (let i = vaultFiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [vaultFiles[i], vaultFiles[j]] = [vaultFiles[j], vaultFiles[i]];
  }
  renderVaultGrid();
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
  const delBtn = document.getElementById('vault-player-del');
  if (delBtn) delBtn.style.display = 'block';
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
async function deleteVaultFileFromPlayer() {
  if (!curV || !curV.isVault) return;
  
  const idToDelete = curV.id;
  
  // 1. Call API to delete (no confirm() check here)
  const r = await fetch('/api/vault/files/' + idToDelete, { method: 'DELETE' });
  if (!r.ok) {
    toast('Delete failed');
    return;
  }

  // 2. Remove from local arrays
  vaultFiles = vaultFiles.filter(f => f.id !== idToDelete);
  const deletedIdx = vaultPl.findIndex(f => f.id === idToDelete);
  vaultPl = vaultPl.filter(f => f.id !== idToDelete);

  toast('Deleted from vault');

  // 3. Determine next video to play
  if (vaultPl.length > 0) {
    // If there's a next video, play it. If we deleted the last one, play the new last one.
    const nextIdx = deletedIdx < vaultPl.length ? deletedIdx : vaultPl.length - 1;
    const nextVid = vaultPl[nextIdx];
    
    // Play next video without leaving player view
    vaultCardClick(nextVid.id, nextVid.name || nextVid.originalName, nextVid.ext);
  } else {
    // If no videos left, go back to vault view
    showVault();
  }
  
  // 4. Refresh the background grid so it's updated when user returns
  renderVaultGrid();
}

// Modify or add to vault.js

async function viewVaultFile(id) {
  const file = vaultFiles.find(f => f.id === id);
  if (!file) return;

  const name = file.originalName.toLowerCase();
  const isBook = name.endsWith('.txt') || name.endsWith('.pdf') || name.endsWith('.epub');

  if (isBook) {
    // Open the Book Reader interface
    showBookReader(id, true); 
  } else {
    // Default behavior (download/image preview)
    openVaultFileDefault(id);
  }
}

async function showBookReader(id, isVault = false) {
  closeAllViews();
  $('book-view').add('on');
  
  const endpoint = isVault ? `/api/vault/read-book?id=${id}` : `/api/books/read?id=${id}`;
  
  try {
    const resp = await fetch(endpoint);
    const data = await resp.json();
    
    if (data.error) throw new Error(data.error);

    // Reuse the existing Book Reader rendering logic
    const viewer = $('book-content').el;
    viewer.innerHTML = '';
    
    if (data.ext === '.pdf') {
        // logic for PDF embedding...
    } else {
        const pre = document.createElement('pre');
        pre.className = 'book-text-content';
        pre.textContent = data.content;
        viewer.appendChild(pre);
    }
    
    $('book-title').text(data.title);
  } catch (e) {
    toast('Error opening book: ' + e.message);
    showVault();
  }
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
  // NEW: Shift key now forces selection mode (single or multiple)
  if (shiftKeyPressed || (typeof vaultSelMode !== 'undefined' && vaultSelMode)) { 
    toggleVaultSel(id); 
    return; 
  }
  
  const extLower = (ext || '').toLowerCase();
  const isBook = extLower === '.txt' || extLower === '.pdf' || extLower === '.epub';

  if (isBook) {
    openVaultBook(id, name, extLower);
  } else if (typeof VAULT_IMG_EXTS !== 'undefined' && VAULT_IMG_EXTS.has(extLower)) {
    openVaultPhoto(id);
  } else {
    openVaultVid(id, name, ext);
  }

}

// 2. Create a vault-specific reader function
async function openVaultBook(id, name, ext) {
  const reader = $('booksReader').el;
  const readerTitle = $('booksReaderTitle').el;
  const readerBody = $('booksReaderBody').el;
  
  readerTitle.textContent = 'Loading…';
  readerBody.innerHTML = '<div class="bk-loading">Loading…</div>';
  reader.classList.add('on'); // Show the book reader interface

  // PDFs and EPUBs are handled via browser tabs
  if (ext === '.pdf' || ext === '.epub') {
    reader.classList.remove('on');
    // Use the secure vault streaming endpoint
    window.open(`/api/vault/stream/${id}`, '_blank');
    return;
  }

  // Handle .txt files
  try {
    const r = await fetch(`/api/vault/stream/${id}`);
    if (!r.ok) throw new Error('Failed to load text file from vault');
    
    const text = await r.text();
    readerTitle.textContent = name || 'Vault Text File';
    
    // Utilize the renderMarkdown function already present in books.js
    if (typeof renderMarkdown === 'function') {
        readerBody.innerHTML = renderMarkdown(text);
    } else {
        readerBody.innerHTML = `<pre style="white-space: pre-wrap; padding: 20px;">${text}</pre>`;
    }
  } catch (err) {
    readerBody.innerHTML = '<div class="bk-loading">Error loading file</div>';
  }
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

vaultGrid.addEventListener('mousedown', (e) => {
  // Only trigger if clicking the grid background, not a file/button
  if (e.target !== vaultGrid) return;
  
  isDraggingVault = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  
  dragBox.style.left = dragStartX + 'px';
  dragBox.style.top = dragStartY + 'px';
  dragBox.style.width = '0px';
  dragBox.style.height = '0px';
  dragBox.style.display = 'block';
  
  if (!e.shiftKey) {
    clearVaultSelection(); // Function already exists in your file
  }
});

window.addEventListener('mousemove', (e) => {
  if (!isDraggingVault) return;

  const currentX = e.clientX;
  const currentY = e.clientY;
  
  const left = Math.min(dragStartX, currentX);
  const top = Math.min(dragStartY, currentY);
  const width = Math.abs(currentX - dragStartX);
  const height = Math.abs(currentY - dragStartY);

  dragBox.style.left = left + 'px';
  dragBox.style.top = top + 'px';
  dragBox.style.width = width + 'px';
  dragBox.style.height = height + 'px';

  // Check collision with vault items
  const rect = dragBox.getBoundingClientRect();
  document.querySelectorAll('.vault-card').forEach(card => {
    const cardRect = card.getBoundingClientRect();
    const isOverlapping = !(rect.right < cardRect.left || 
                            rect.left > cardRect.right || 
                            rect.bottom < cardRect.top || 
                            rect.top > cardRect.bottom);
    
    const id = card.dataset.vaultId;
    if (isOverlapping) {
        vaultSel.add(id);
        card.classList.add('selected');
    }
  });
  updateVaultSelBar(); // Update the UI bar showing "X items selected"
});

window.addEventListener('mouseup', () => {
  isDraggingVault = false;
  if (dragBox) dragBox.style.display = 'none';
});

async function deleteSelectedVaultFiles() {
  const ids = Array.from(vaultSel);
  if (ids.length === 0) return;

  if (!confirm(`Are you sure you want to delete ${ids.length} selected files?`)) return;

  // Assuming your API supports bulk delete or requires individual calls
  for (const id of ids) {
    await fetch(`/api/vault/delete/${id}`, { method: 'DELETE' });
  }

  toast(`Deleted ${ids.length} files`);
  vaultSel.clear();
  loadVaultFiles(); // Refresh the grid
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
  closeVaultPhotoMeta();
  const overlay = $('vaultPhotoOverlay').el;
  $('vaultPhotoImg').el.src = '/api/vault/stream/' + f.id;
  const cached = _vaultNameCache[f.id];
  $('vaultPhotoName').text(cached || f.name || f.originalName);
  overlay.classList.add('on');
  const prevBtn = $('vaultPhotoPrev').el;
  const nextBtn = $('vaultPhotoNext').el;
  if (prevBtn) prevBtn.style.display = vaultPhotos.length > 1 ? '' : 'none';
  if (nextBtn) nextBtn.style.display = vaultPhotos.length > 1 ? '' : 'none';
  _updateVaultPhotoFavBtn(f.id);
  if (cached === undefined) {
    _resolveVaultName(f).then(name => {
      if (!name) return;
      _saveVaultNameCache();
      if (vaultPhotos[vaultPhotoIdx] && vaultPhotos[vaultPhotoIdx].id === f.id)
        $('vaultPhotoName').text(name);
      const titleEl = document.querySelector('[data-vault-id="' + f.id + '"] .card-title');
      if (titleEl) titleEl.textContent = name;
    });
  }
}

function _updateVaultPhotoFavBtn(id) {
  const btn = document.getElementById('vaultPhotoFav');
  if (!btn) return;
  const on = vaultFavIds.has(id);
  btn.classList.toggle('on', on);
  btn.querySelector('svg path').setAttribute('fill', on ? 'currentColor' : 'none');
  btn.querySelector('svg path').setAttribute('stroke', on ? '#e84040' : 'currentColor');
}

async function toggleVaultPhotoFav() {
  const f = vaultPhotos[vaultPhotoIdx];
  if (!f) return;
  const r = await fetch('/api/vault/favs/' + f.id, { method: 'POST' }).then(r => r.json()).catch(() => null);
  if (!r) return;
  if (r.fav) vaultFavIds.add(f.id); else vaultFavIds.delete(f.id);
  _updateVaultPhotoFavBtn(f.id);
  document.querySelectorAll('[data-vault-id="' + f.id + '"] .vault-fav-btn').forEach(btn => {
    btn.classList.toggle('on', r.fav);
    btn.querySelector('svg path').setAttribute('fill', r.fav ? 'currentColor' : 'none');
  });
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


// ─── Dynamic Vault Mosaic (Photos & Videos) ───

let vaultDynamicMosTimer = null;
let vaultDynamicMosActive = false;
let vaultDynamicTiles = [];
let vaultDynamicPool = [];

function startVaultDynamicMosaic() {
  // Filter for both images and videos in the vault
vaultDynamicPool = vaultFiles.filter(f => {
  // Strip leading dot if present
  const ext = (f.ext || '').toLowerCase().replace('.', ''); 
  const isImg = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
  const isVid = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v'].includes(ext);
  return isImg || isVid;
});

  if (!vaultDynamicPool.length) {
    toast('No photos or videos found in the vault.');
    return;
  }
  let vaultThumbsHidden = false;

  vaultDynamicMosActive = true;
  
  // Hide current vault view
  const vaultView = document.getElementById('vault-view');
  if (vaultView) vaultView.style.display = 'none';

  // Create or reuse full-screen container
  let container = document.getElementById('vault-dynamic-mosaic-view');
  if (!container) {
    container = document.createElement('div');
    container.id = 'vault-dynamic-mosaic-view';
    // Style as a full-screen absolute overlay grid
    Object.assign(container.style, {
      position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
      backgroundColor: '#000', zIndex: '9999', display: 'grid', gap: '4px',
      overflow: 'hidden'
    });

    // Close button
    const closeBtn = document.createElement('div');
    closeBtn.innerHTML = '✕';
    Object.assign(closeBtn.style, {
      position: 'absolute', top: '20px', right: '20px', color: '#fff', 
      fontSize: '28px', cursor: 'pointer', zIndex: '10000', 
      background: 'rgba(0,0,0,0.6)', borderRadius: '50%', 
      width: '40px', height: '40px', display: 'flex', 
      alignItems: 'center', justifyContent: 'center'
    });
    closeBtn.onclick = stopVaultDynamicMosaic;
    container.appendChild(closeBtn);

    document.body.appendChild(container);
  } else {
    container.style.display = 'grid';
  }

  // Determine grid size based on screen dimensions (approx 300px per tile)
  const cols = Math.max(1, Math.floor(window.innerWidth / 300));
  const rows = Math.max(1, Math.floor(window.innerHeight / 300));
  const numTiles = cols * rows;

  container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  container.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

  vaultDynamicTiles = [];

  // Generate the media tiles
  for (let i = 0; i < numTiles; i++) {
    const tileWrap = document.createElement('div');
    Object.assign(tileWrap.style, {
      position: 'relative', width: '100%', height: '100%', 
      overflow: 'hidden', backgroundColor: '#111'
    });

    // Image element
    const img = document.createElement('img');
    Object.assign(img.style, {
      width: '100%', height: '100%', objectFit: 'cover', 
      position: 'absolute', opacity: '0', transition: 'opacity 0.6s ease'
    });

    // Video element
    const vid = document.createElement('video');
    Object.assign(vid.style, {
      width: '100%', height: '100%', objectFit: 'cover', 
      position: 'absolute', opacity: '0', transition: 'opacity 0.6s ease'
    });
    vid.muted = true; vid.loop = true; vid.playsInline = true;

    tileWrap.appendChild(img);
    tileWrap.appendChild(vid);
    container.appendChild(tileWrap);

    vaultDynamicTiles.push({ wrap: tileWrap, img, vid });
    updateVaultDynamicTile(i); // Initial load
  }

  scheduleVaultDynamicMosaic();
}


function initVaultAutoHide() {
  const grid = $('vaultGrid').el;
  if (!grid) return;

  // Set initial state based on your variable when vault loads
  if (!vaultThumbsVisible) {
    grid.classList.add('vault-auto-hide');
  }

  // Hover IN: Temporarily reveal thumbnails if they are in "hidden" mode
  grid.addEventListener('mouseenter', () => {
    if (!vaultThumbsVisible) {
      grid.classList.remove('vault-auto-hide');
    }
  });

  // Hover OUT: Hide/blur them again if they are in "hidden" mode
  grid.addEventListener('mouseleave', () => {
    if (!vaultThumbsVisible) {
      grid.classList.add('vault-auto-hide');
    }
  });
}

function initVaultShiftSelection() {
  // Prevent duplicate listeners if showVault() is called multiple times
  if (window._vaultShiftInitialized) return;
  window._vaultShiftInitialized = true;

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') shiftKeyPressed = true;
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') shiftKeyPressed = false;
  });
}
function updateVaultDynamicTile(idx) {
  if (!vaultDynamicMosActive) return;
  const tile = vaultDynamicTiles[idx];
  
  // Pick random file from the unfiltered pool
  const item = vaultDynamicPool[Math.floor(Math.random() * vaultDynamicPool.length)];
  const ext = (item.ext || '').toLowerCase().replace('.', '');
  
  // Expanded list of video extensions to ensure they play as videos
  const videoExts = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v', 'mpg', 'mpeg', 'wmv', 'ts'];
  const isVideo = videoExts.includes(ext);
  
  const url = `/api/vault/stream/${item.id}`;

  if (isVideo) {
    tile.vid.src = url;
    tile.vid.oncanplay = () => {
      tile.vid.play().catch(() => {});
      tile.vid.style.opacity = '1';
      tile.img.style.opacity = '0';
      setTimeout(() => { tile.img.src = ''; }, 600);
    };
  } else {
    // For images and all other file types, attempt to load in the <img> tag
    tile.img.src = url;
    tile.img.onload = () => {
      tile.img.style.opacity = '1';
      tile.vid.style.opacity = '0';
      setTimeout(() => { tile.vid.pause(); tile.vid.src = ''; }, 600);
    };
    // If the file isn't an image (e.g. a zip or pdf), the <img> tag will remain 
    // blank or show a broken icon, which is expected when removing all filters.
  }
}

function scheduleVaultDynamicMosaic() {
  if (!vaultDynamicMosActive) return;
  // Choose how fast tiles change (e.g., replace one random tile every 1.5 seconds)
  const swapInterval = 1500; 
  
  vaultDynamicMosTimer = setTimeout(() => {
    if (!vaultDynamicMosActive) return;
    const randomIdx = Math.floor(Math.random() * vaultDynamicTiles.length);
    updateVaultDynamicTile(randomIdx);
    scheduleVaultDynamicMosaic();
  }, swapInterval);
}

function stopVaultDynamicMosaic() {
  vaultDynamicMosActive = false;
  clearTimeout(vaultDynamicMosTimer);
  
  const container = document.getElementById('vault-dynamic-mosaic-view');
  if (container) {
    container.style.display = 'none';
    
    // Memory cleanup: stop all streams
    vaultDynamicTiles.forEach(t => {
      t.vid.pause(); t.vid.src = ''; t.vid.load();
      t.img.src = '';
    });
    // Remove all children except the close button
    while (container.childNodes.length > 1) {
      container.removeChild(container.lastChild);
    }
  }
  
  // Restore main vault view
  const vaultView = document.getElementById('vault-view');
  if (vaultView) vaultView.style.display = '';
}
// ─── Vault Shuffle ───


function closeVaultPhoto() {
  _stopVaultSs();
  _vpReset();
  _vpDetach();
  closeVaultPhotoMeta();
  $('vaultPhotoOverlay').remove('on');
  $('vaultPhotoImg').el.src = '';
  document.removeEventListener('keydown', _vaultPhotoKey);
  vaultPhotos = [];
  vaultPhotoIdx = -1;
}

// ── ComfyUI name extraction ───────────────────────────────────────────────

const _vaultNameCache = {}; // id → string | null
const _VNCK = 'vault_name_cache';

function _loadVaultNameCache() {
  try { Object.assign(_vaultNameCache, JSON.parse(localStorage.getItem(_VNCK) || '{}')); } catch {}
}

function _saveVaultNameCache() {
  try {
    const out = {};
    for (const [k, v] of Object.entries(_vaultNameCache)) if (v) out[k] = v;
    localStorage.setItem(_VNCK, JSON.stringify(out));
  } catch {}
}

function _extractComfyName(meta) {
  if (meta.prompt) {
    try {
      const nodes = Object.values(JSON.parse(meta.prompt));
      for (const node of nodes) {
        if (node.class_type === 'PreviewAny') {
          const v = (node.inputs || {}).preview_markdown;
          if (typeof v === 'string' && v.trim()) return v.trim();
        }
      }
      for (const node of nodes) {
        if (node.class_type === 'CLIPTextEncode') {
          const t = (node.inputs || {}).text;
          if (typeof t === 'string' && t.trim()) return t.trim();
        }
      }
    } catch {}
  }
  if (meta.workflow) {
    try {
      const nodes = JSON.parse(meta.workflow).nodes || [];
      for (const node of nodes) {
        if (node.type === 'PreviewAny' && Array.isArray(node.widgets_values)) {
          for (const v of node.widgets_values) {
            if (typeof v === 'string' && v.trim()) return v.trim();
          }
        }
      }
      // fallback: single-element widgets_values containing prompt keywords
      const _PROMPT_KW = /\b(masterpiece|man|woman|boy|girl)\b/i;
      for (const node of nodes) {
        if (Array.isArray(node.widgets_values) && node.widgets_values.length === 1) {
          const v = node.widgets_values[0];
          if (typeof v === 'string' && _PROMPT_KW.test(v)) return v.trim();
        }
      }
    } catch {}
  }
  return null;
}

async function _resolveVaultName(f) {
  if (_vaultNameCache[f.id] !== undefined) return _vaultNameCache[f.id];
  if (f.ext.toLowerCase() !== '.png') { _vaultNameCache[f.id] = null; return null; }
  try {
    const buf = await (await fetch('/api/vault/stream/' + f.id, { cache: 'force-cache' })).arrayBuffer();
    const meta = _parsePngMeta(buf);
    _vaultNameCache[f.id] = meta ? _extractComfyName(meta) : null;
  } catch { _vaultNameCache[f.id] = null; }
  return _vaultNameCache[f.id];
}

async function _scanVaultWorkflowNames() {
  const toScan = vaultFiles.filter(f =>
    !f.name && f.ext.toLowerCase() === '.png' && _vaultNameCache[f.id] === undefined
  );
  if (!toScan.length) return;
  const CONCURRENCY = 3;
  let i = 0;
  async function next() {
    if (i >= toScan.length) return;
    const f = toScan[i++];
    const name = await _resolveVaultName(f);
    if (name) {
      const titleEl = document.querySelector('[data-vault-id="' + f.id + '"] .card-title');
      if (titleEl) titleEl.textContent = name;
    }
    return next();
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, next));
  _saveVaultNameCache();
}

// ── ComfyUI / PNG metadata ────────────────────────────────────────────────

function _parsePngMeta(buf) {
  const view = new DataView(buf);
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (view.getUint8(i) !== sig[i]) return null;
  const latin1 = new TextDecoder('latin1');
  const utf8 = new TextDecoder('utf-8');
  const result = {};
  let pos = 8;
  while (pos + 12 <= buf.byteLength) {
    const len = view.getUint32(pos); pos += 4;
    const type = latin1.decode(new Uint8Array(buf, pos, 4)); pos += 4;
    if (type === 'IEND') break;
    if (pos + len > buf.byteLength) break;
    const data = new Uint8Array(buf, pos, len);
    if (type === 'tEXt') {
      const sep = data.indexOf(0);
      if (sep >= 0) {
        result[latin1.decode(data.slice(0, sep))] = latin1.decode(data.slice(sep + 1));
      }
    } else if (type === 'iTXt') {
      const sep = data.indexOf(0);
      if (sep >= 0) {
        const key = latin1.decode(data.slice(0, sep));
        let off = sep + 3; // skip null, compression_flag, compression_method
        while (off < len && data[off] !== 0) off++; off++; // skip lang tag
        while (off < len && data[off] !== 0) off++; off++; // skip translated key
        result[key] = utf8.decode(data.slice(off));
      }
    }
    pos += len + 4;
  }
  return Object.keys(result).length ? result : null;
}

let _currentVaultMeta = {};

function copyVaultMeta(key, btn) {
  const val = _currentVaultMeta[key];
  if (val == null) return;
  navigator.clipboard.writeText(val).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 1500);
  }).catch(() => {
    btn.textContent = 'Error';
    setTimeout(() => btn.textContent = 'Copy', 1500);
  });
}

function _fmtMetaVal(raw) {
  try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
}

async function showVaultPhotoMeta() {
  const panel = document.getElementById('vaultMetaPanel');
  const body = document.getElementById('vaultMetaBody');
  if (!panel) return;
  if (panel.classList.contains('open')) { closeVaultPhotoMeta(); return; }
  panel.classList.add('open');
  document.getElementById('vaultMetaBtn').classList.add('on');
  body.innerHTML = '<div class="vault-meta-loading">Reading metadata\u2026</div>';

  const f = vaultPhotos[vaultPhotoIdx];
  if (!f || f.ext.toLowerCase() !== '.png') {
    body.innerHTML = '<div class="vault-meta-empty">No metadata found<br><small style="opacity:.5">Only PNG files supported</small></div>';
    return;
  }

  try {
    const resp = await fetch('/api/vault/stream/' + f.id, { cache: 'force-cache' });
    if (!resp.ok) throw new Error('fetch failed');
    const buf = await resp.arrayBuffer();
    const meta = _parsePngMeta(buf);
    if (!meta) { body.innerHTML = '<div class="vault-meta-empty">No embedded metadata found</div>'; return; }

    _currentVaultMeta = meta;

    const KNOWN = ['workflow', 'prompt', 'parameters', 'comment', 'description', 'Software', 'Creation Time'];
    const keys = [...new Set([...KNOWN.filter(k => meta[k]), ...Object.keys(meta).filter(k => !KNOWN.includes(k))])];

    body.innerHTML = keys.map(k => {
      const val = _fmtMetaVal(meta[k]);
      const safeKey = k.replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const safeVal = val.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      return '<div class="vault-meta-section">' +
        '<div class="vault-meta-key"><span>' + safeKey + '</span>' +
        '<button class="vault-meta-copy" onclick="copyVaultMeta(\'' + escA(k) + '\',this)">Copy</button></div>' +
        '<pre class="vault-meta-val">' + safeVal + '</pre>' +
        '</div>';
    }).join('');
  } catch {
    body.innerHTML = '<div class="vault-meta-empty">Failed to read metadata</div>';
  }
}

function closeVaultPhotoMeta() {
  const panel = document.getElementById('vaultMetaPanel');
  if (panel) panel.classList.remove('open');
  const btn = document.getElementById('vaultMetaBtn');
  if (btn) btn.classList.remove('on');
  _currentVaultMeta = {};
}

function openVaultCardMeta(e, id) {
  e.stopPropagation();
  openVaultPhoto(id);
  setTimeout(showVaultPhotoMeta, 80);
}

function _vaultPhotoKey(e) {
  if (e.key === 'Escape') {
    closeVaultPhoto();
  } 
  // Arrow Navigation
  else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    _stopVaultSs();
    prevVaultPhoto();
  } 
  else if (e.key === 'ArrowRight') {
    e.preventDefault();
    _stopVaultSs();
    nextVaultPhoto();
  } 
  // Delete Photo (Canc key)
  else if (e.key === 'Delete') {
    const f = vaultPhotos[vaultPhotoIdx];
    if (f) {
      // Clear selection and add only the current file
      vaultSel.clear();
      vaultSel.add(f.id);
      
      // Call deletion with no confirmation
      deleteVaultFileFromPlayer(true);
      
      // Update the local lightbox state immediately
      vaultPhotos.splice(vaultPhotoIdx, 1);
      if (vaultPhotos.length === 0) {
        closeVaultPhoto();
      } else {
        if (vaultPhotoIdx >= vaultPhotos.length) vaultPhotoIdx = 0;
        _showVaultPhoto();
      }
    }
  } 
  // Existing Slidehsow and Zoom Controls
  else if (e.key === ' ') {
    e.preventDefault();
    toggleVaultSlideshow();
  } else if (e.key === '+' || e.key === '=') {
    const nz = Math.min(8, _vpZ * 1.25);
    _vpZ = nz;
    _vpApply();
  } else if (e.key === '-') {
    const nz = Math.max(1, _vpZ / 1.25);
    if (nz === 1) { _vpX = 0; _vpY = 0; }
    _vpZ = nz;
    _vpApply();
  } else if (e.key === '0') {
    _vpReset();
  }
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
closeAllViews();
  if (location.pathname !== '/vault') history.pushState(null, '', '/vault');
  vaultMode = true;
  $('browse-view').add('off');
  $('vault-sidebar').add('on');
  $('vault-view').add('on');
  loadVaultView();
  
  // Call the auto-hide initializer here
  initVaultAutoHide(); 
  initVaultShiftSelection();   // ← NEW
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
