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
  }
  menu.innerHTML = html;
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
    // Refresh everything
    const r2 = await fetch('/api/categories');
    cats = await r2.json();
    if (typeof renCats === 'function') renCats();
    if (typeof loadCategoriesView === 'function' && categoriesMode) loadCategoriesView();
    if (typeof renderMainCategories === 'function') renderMainCategories();
    render(); // Refresh grid
  } else {
    const err = await r.json();
    toast('Encryption failed: ' + (err.error || 'Unknown error'));
  }
}

async function ctxUnlockCategory(path, name) {
  const pw = prompt(`Enter password to unlock "${name}":`);
  if (!pw) return;
  
  const r = await fetch('/api/categories/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, password: pw })
  });
  
  if (r.ok) {
    toast('Category unlocked');
    render(); // Refresh grid to show videos
  } else {
    const err = await r.json();
    toast('Unlock failed: ' + (err.error || 'Unknown error'));
  }
}
