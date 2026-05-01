// ─── Context Menu ───

let currentCtxTarget = null;

function showContextMenu(e, type, data) {
  e.preventDefault();
  e.stopPropagation();
  
  const menu = document.getElementById('context-menu');
  if (!menu) return;
  
  currentCtxTarget = { type, data };
  
  // Set menu content based on type
  renderCtxMenu(type, data);
  
  menu.style.display = 'block';
  
  // Position menu
  const menuWidth = 180;
  // Temporary display to get height
  menu.style.visibility = 'hidden';
  menu.style.display = 'block';
  const menuHeight = menu.offsetHeight || 160;
  menu.style.display = 'none';
  menu.style.visibility = 'visible';
  
  let x = e.clientX;
  let y = e.clientY;
  
  if (x + menuWidth > window.innerWidth) x -= menuWidth;
  if (y + menuHeight > window.innerHeight) y -= menuHeight;
  
  // Ensure it doesn't go off screen left or top
  if (x < 0) x = 10;
  if (y < 0) y = 10;
  
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.style.display = 'block';
  
  const close = () => {
    menu.style.display = 'none';
    document.removeEventListener('click', close);
    document.removeEventListener('contextmenu', close);
  };
  
  setTimeout(() => {
    document.addEventListener('click', close);
    document.addEventListener('contextmenu', close);
  }, 10);
}

function renderCtxMenu(type, data) {
  const menu = document.getElementById('context-menu');
  if (!menu) return;
  
  let html = '';
  if (type === 'category') {
    const isEnc = data.encrypted;
    html = `
      <div class="ctx-item" onclick="ctxRenameCategory('${escA(data.path)}', '${escA(data.name)}')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
        Rename
      </div>
      <div class="ctx-item" onclick="ctxDeleteCategory('${escA(data.path)}', '${escA(data.name)}')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        Delete
      </div>
      <div class="ctx-item" onclick="ctxHideCategory('${escA(data.path)}', '${escA(data.name)}')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
        Hide
      </div>
      <div class="ctx-sep"></div>
      <div class="ctx-item" onclick="${isEnc ? 'ctxUnlockCategory' : 'ctxEncryptCategory'}('${escA(data.path)}', '${escA(data.name)}')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        ${isEnc ? 'Unlock' : 'Encrypt'}
      </div>
    `;
  } else if (type === 'all_videos') {
    html = `
      <div class="ctx-item" onclick="ctxLockAllCategories()">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Lock all unencrypted
      </div>
    `;
  }
  menu.innerHTML = html;
}

let encryptTarget = null;

function ctxEncryptCategory(path, name) {
  encryptTarget = { path, name };
  const modal = document.getElementById('encrypt-cat-modal');
  const title = document.getElementById('encrypt-cat-title');
  const desc = document.getElementById('encrypt-cat-desc');
  const pw1 = document.getElementById('encrypt-cat-pw1');
  const pw2 = document.getElementById('encrypt-cat-pw2');
  if (!modal) return;
  
  title.innerText = `Encrypt "${name}"`;
  desc.innerText = "Secure this category with a password.";
  pw1.value = ''; pw2.value = '';
  modal.style.display = 'flex';
  setTimeout(() => pw1.focus(), 50);
}

function ctxLockAllCategories() {
  encryptTarget = { path: 'ALL', name: 'All Categories' };
  const modal = document.getElementById('encrypt-cat-modal');
  const title = document.getElementById('encrypt-cat-title');
  const desc = document.getElementById('encrypt-cat-desc');
  const pw1 = document.getElementById('encrypt-cat-pw1');
  const pw2 = document.getElementById('encrypt-cat-pw2');
  if (!modal) return;
  
  title.innerText = "Lock All Categories";
  desc.innerText = "Encrypt ALL categories that are not currently locked.";
  pw1.value = ''; pw2.value = '';
  modal.style.display = 'flex';
  setTimeout(() => pw1.focus(), 50);
}

function closeEncryptCatModal() {
  const modal = document.getElementById('encrypt-cat-modal');
  if (modal) modal.style.display = 'none';
  encryptTarget = null;
}

async function execEncryptCat() {
  if (!encryptTarget) return;
  const pw1 = document.getElementById('encrypt-cat-pw1').value;
  const pw2 = document.getElementById('encrypt-cat-pw2').value;
  
  if (!pw1) { toast('Password required'); return; }
  if (pw1 !== pw2) { toast('Passwords do not match'); return; }

  const isAll = encryptTarget.path === 'ALL';
  const endpoint = isAll ? '/api/categories/encrypt-all' : '/api/categories/encrypt';
  
  if (isAll && !confirm('This will encrypt ALL categories. Continue?')) return;
  
  toast(isAll ? 'Locking all categories...' : 'Encrypting category...');
  closeEncryptCatModal();

  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: encryptTarget.path, password: pw1 })
  });
  
  if (r.ok) {
    const d = await r.json();
    toast(isAll ? `Locked ${d.count} categories` : 'Category encrypted');
    if (typeof refresh === 'function') refresh(true);
  } else {
    const err = await r.json();
    toast('Action failed: ' + (err.error || 'Unknown error'));
  }
}

async function ctxRenameCategory(path, oldName) {
  const newName = prompt('Rename category to:', oldName);
  if (!newName || newName === oldName) return;
  
  const r = await fetch('/api/categories/rename', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPath: path, newName })
  });
  
  if (r.ok) {
    toast('Category renamed');
    if (typeof loadCategoriesView === 'function' && categoriesMode) loadCategoriesView();
    // Also update sidebar
    const r2 = await fetch('/api/categories');
    cats = await r2.json();
    if (typeof renCats === 'function') renCats();
    if (typeof renderMainCategories === 'function') renderMainCategories();
  } else {
    const err = await r.json();
    toast('Rename failed: ' + (err.error || 'Unknown error'));
  }
}

async function ctxDeleteCategory(path, name) {
  if (!confirm(`Delete category "${name}"?\nAll videos inside will be moved to the main videos folder.`)) return;
  
  const r = await fetch('/api/categories/delete', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  });
  
  if (r.ok) {
    toast('Category deleted, videos moved to main folder');
    if (typeof loadCategoriesView === 'function' && categoriesMode) loadCategoriesView();
    // Update sidebar
    const r2 = await fetch('/api/categories');
    cats = await r2.json();
    if (typeof renCats === 'function') renCats();
    if (typeof renderMainCategories === 'function') renderMainCategories();
  } else {
    toast('Delete failed');
  }
}

async function ctxHideCategory(path, name) {
  // Use the folder name (last part of path) for hiding
  const parts = path.split('/');
  const folderName = parts[parts.length - 1];
  
  if (!confirm(`Hide category "${name}"?\nThis will add "${folderName}" to your hidden categories list.`)) return;

  const r = await fetch('/api/categories/hide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: folderName })
  });
  
  if (r.ok) {
    toast(`Category "${name}" hidden`);
    if (typeof loadCategoriesView === 'function' && categoriesMode) loadCategoriesView();
    // Update sidebar
    const r2 = await fetch('/api/categories');
    cats = await r2.json();
    if (typeof renCats === 'function') renCats();
    if (typeof renderMainCategories === 'function') renderMainCategories();
  } else {
    toast('Hide failed');
  }
}

async function ctxEncryptCategory(path, name) {
  const pw = prompt(`Enter encryption password for "${name}":`);
  if (!pw) return;
  const pw2 = prompt(`Confirm password:`);
  if (pw !== pw2) return alert('Passwords do not match');
  
  toast('Encrypting category... please wait.');
  const r = await fetch('/api/categories/encrypt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, password: pw })
  });
  
  if (r.ok) {
    toast('Category encrypted successfully');
    if (typeof refresh === 'function') refresh(true);
  } else {
    const err = await r.json();
    toast('Encryption failed: ' + (err.error || 'Unknown error'));
  }
}

let unlockTarget = null;

async function ctxUnlockCategory(path, name) {
  unlockTarget = { path, name };
  const modal = document.getElementById('unlock-cat-modal');
  const title = document.getElementById('unlock-cat-title');
  const pwInput = document.getElementById('unlock-cat-pw');
  
  if (!modal) return;
  
  title.innerText = `Unlock "${name}"`;
  pwInput.value = '';
  modal.style.display = 'flex';
  setTimeout(() => pwInput.focus(), 50);
}

function closeUnlockCatModal() {
  const modal = document.getElementById('unlock-cat-modal');
  if (modal) modal.style.display = 'none';
  unlockTarget = null;
}

async function execUnlockCat(type) {
  if (!unlockTarget) return;
  const pw = document.getElementById('unlock-cat-pw').value;
  if (!pw) { toast('Password required'); return; }
  
  const isPermanent = type === 'P';
  const endpoint = isPermanent ? '/api/categories/decrypt' : '/api/categories/unlock';
  
  if (isPermanent) {
    if (!confirm('Are you sure you want to PERMANENTLY decrypt this category? This will remove the lock.')) return;
    toast('Decrypting category... please wait.');
  }

  closeUnlockCatModal();

  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: unlockTarget.path, password: pw })
  });
  
  if (r.ok) {
    toast(isPermanent ? 'Category decrypted and lock removed' : 'Category unlocked temporarily');
    if (typeof refresh === 'function') refresh(true);
  } else {
    const err = await r.json();
    toast('Action failed: ' + (err.error || 'Unknown error'));
  }
}
