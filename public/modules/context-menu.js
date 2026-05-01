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
      <div class="ctx-item" onclick="ctxOpenCategoryFolder('${escA(data.path)}')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        Open folder
      </div>
      <div class="ctx-sep"></div>
      ${isEnc ? `
        <div class="ctx-item" onclick="ctxUnlockCategory('${escA(data.path)}', '${escA(data.name)}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          Unlock
        </div>
      ` : ''}
      ${data.partial ? `
        <div class="ctx-item" onclick="ctxEncryptCategory('${escA(data.path)}', '${escA(data.name)}', true)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#e84040" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
          Finish Encryption
        </div>
      ` : (!isEnc ? `
        <div class="ctx-item" onclick="ctxEncryptCategory('${escA(data.path)}', '${escA(data.name)}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          Encrypt
        </div>
      ` : '')}
    `;
  } else if (type === 'all_videos') {
    html = `
      <div class="ctx-item" onclick="ctxLockAllCategories()">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Lock all unencrypted
      </div>
      <div class="ctx-item" onclick="ctxUnlockAllCategories()">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M7 11V7a5 5 0 0 1 10 0v4"/><rect x="3" y="11" width="18" height="11" rx="2"/></svg>
        Unlock all encrypted
      </div>
    `;
  }
  menu.innerHTML = html;
}

let encryptTarget = null;

function ctxEncryptCategory(path, name, isPartial = false) {
  encryptTarget = { path, name, isPartial };
  const modal = document.getElementById('encrypt-cat-modal');
  const title = document.getElementById('encrypt-cat-title');
  const desc = document.getElementById('encrypt-cat-desc');
  const pw1 = document.getElementById('encrypt-cat-pw1');
  const pw2 = document.getElementById('encrypt-cat-pw2');
  if (!modal) return;
  
  title.innerText = isPartial ? "Finish Encryption" : "Encrypt Category";
  desc.innerText = isPartial ? "Encrypt the remaining files in this category." : "Encrypt all files in this category.";
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
  if (!isAll) {
    const targetPath = encryptTarget.path;
    const isPartial = encryptTarget.isPartial;
    closeEncryptCatModal();

    openBulkProgModal(isPartial ? 'Finishing Encryption' : 'Encrypting Category', `Processing files in ${targetPath}...`);

    const r = await fetch('/api/categories/encrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: targetPath, password: pw1 })
    });
    
    if (r.ok) {
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      
      while(true) {
        const {done, value} = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, {stream: true});
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.total) updateBulkProg(msg.cur, msg.total);
            if (msg.error) { toast('Error: ' + msg.error); closeBulkProgModal(); return; }
          } catch(e) {}
        }
      }
      
      document.getElementById('bulk-prog-title').innerText = 'Complete';
      document.getElementById('bulk-prog-desc').innerText = 'Category encryption finished successfully.';
      document.getElementById('bulk-prog-footer').style.display = 'block';
      if (typeof refresh === 'function') refresh(true);
    } else {
      const err = await r.json();
      toast('Action failed: ' + (err.error || 'Unknown error'));
      closeBulkProgModal();
    }
  } else {
    // Bulk action
    if (!confirm('This will encrypt ALL categories. Continue?')) return;
    closeEncryptCatModal();
    
    try {
      const categories = await (await fetch('/api/categories')).json();
      const toEncrypt = categories.filter(c => !c.encrypted && c.count > 0);
      
      if (toEncrypt.length === 0) {
        toast('No unencrypted categories found.');
        return;
      }

      openBulkProgModal('Locking All Categories', `Encrypting ${toEncrypt.length} categories...`);
      
      let count = 0;
      for (const cat of toEncrypt) {
        updateBulkProg(count, toEncrypt.length);
        const r = await fetch('/api/categories/encrypt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: cat.path, password: pw1 })
        });
        if (r.ok) count++;
      }
      
      updateBulkProg(toEncrypt.length, toEncrypt.length);
      document.getElementById('bulk-prog-title').innerText = 'Action Complete';
      document.getElementById('bulk-prog-desc').innerText = `Successfully locked ${count} categories.`;
      document.getElementById('bulk-prog-footer').style.display = 'block';
      
      if (typeof refresh === 'function') refresh(true);
    } catch (e) {
      toast('Bulk encryption failed: ' + e.message);
      closeBulkProgModal();
    }
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
    if (typeof refresh === 'function') refresh(true);
  } else {
    const err = await r.json();
    toast('Rename failed: ' + (err.error || 'Unknown error'));
  }
}

async function ctxOpenCategoryFolder(path) {
  const r = await fetch('/api/open-category-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  });
  if (!r.ok) toast('Failed to open folder');
}
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


let unlockTarget = null;

async function ctxUnlockCategory(path, name) {
  unlockTarget = { path, name };
  const modal = document.getElementById('unlock-cat-modal');
  const title = document.getElementById('unlock-cat-title');
  const desc = document.getElementById('unlock-cat-desc');
  const pw = document.getElementById('unlock-cat-pw');
  if (!modal) return;
  
  title.innerText = "Unlock Category";
  desc.innerText = "Enter the password to access this category.";
  pw.value = '';
  modal.style.display = 'flex';
  setTimeout(() => pw.focus(), 50);
}

function ctxUnlockAllCategories() {
  unlockTarget = { path: 'ALL', name: 'All Categories' };
  const modal = document.getElementById('unlock-cat-modal');
  const title = document.getElementById('unlock-cat-title');
  const desc = document.getElementById('unlock-cat-desc');
  const pw = document.getElementById('unlock-cat-pw');
  if (!modal) return;
  
  title.innerText = "Unlock All Categories";
  desc.innerText = "Access ALL encrypted categories with one password.";
  pw.value = '';
  modal.style.display = 'flex';
  setTimeout(() => pw.focus(), 50);
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
  const isAll = unlockTarget.path === 'ALL';
  
  if (!isAll) {
    const targetPath = unlockTarget.path;
    const endpoint = isPermanent ? '/api/categories/decrypt' : '/api/categories/unlock';
    closeUnlockCatModal();

    if (isPermanent) {
      openBulkProgModal('Decrypting Category', `Permanently restoring files in ${targetPath}...`);
    }

    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: targetPath, password: pw })
    });
    
    if (r.ok) {
      if (isPermanent) {
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while(true) {
          const {done, value} = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, {stream: true});
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.total) updateBulkProg(msg.cur, msg.total);
              if (msg.error) { toast('Error: ' + msg.error); closeBulkProgModal(); return; }
            } catch(e) {}
          }
        }
        document.getElementById('bulk-prog-title').innerText = 'Complete';
        document.getElementById('bulk-prog-desc').innerText = 'Category decryption finished successfully.';
        document.getElementById('bulk-prog-footer').style.display = 'block';
      } else {
        toast('Category unlocked temporarily');
      }
      if (typeof refresh === 'function') refresh(true);
    } else {
      const err = await r.json();
      toast('Action failed: ' + (err.error || 'Unknown error'));
      if (isPermanent) closeBulkProgModal();
    }
  } else {
    // Bulk action
    if (isPermanent && !confirm('Permanently decrypt ALL categories? This will remove all locks.')) return;
    
    closeUnlockCatModal();
    
    try {
      const categories = await (await fetch('/api/categories')).json();
      const toProcess = categories.filter(c => c.encrypted);
      
      if (toProcess.length === 0) {
        toast('No locked categories found.');
        return;
      }

      openBulkProgModal(isPermanent ? 'Decrypting All' : 'Unlocking All', `${isPermanent ? 'Decrypting' : 'Unlocking'} ${toProcess.length} categories...`);
      
      let count = 0;
      const endpoint = isPermanent ? '/api/categories/decrypt' : '/api/categories/unlock';
      
      for (const cat of toProcess) {
        updateBulkProg(count, toProcess.length);
        const r = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: cat.path, password: pw })
        });
        if (r.ok) count++;
      }
      
      updateBulkProg(toProcess.length, toProcess.length);
      document.getElementById('bulk-prog-title').innerText = 'Action Complete';
      document.getElementById('bulk-prog-desc').innerText = `Successfully ${isPermanent ? 'decrypted' : 'unlocked'} ${count} categories.`;
      document.getElementById('bulk-prog-footer').style.display = 'block';
      
      if (typeof refresh === 'function') refresh(true);
    } catch (e) {
      toast('Bulk action failed: ' + e.message);
      closeBulkProgModal();
    }
  }
}

// ── Bulk Progress Helpers ──
function openBulkProgModal(title, desc) {
  document.getElementById('bulk-prog-title').innerText = title;
  document.getElementById('bulk-prog-desc').innerText = desc;
  document.getElementById('bulk-prog-fill').style.width = '0%';
  document.getElementById('bulk-prog-count').innerText = '0 / 0';
  document.getElementById('bulk-prog-percent').innerText = '0%';
  document.getElementById('bulk-prog-footer').style.display = 'none';
  document.getElementById('bulk-prog-modal').style.display = 'flex';
}

function updateBulkProg(cur, total) {
  const p = Math.floor((cur / total) * 100);
  document.getElementById('bulk-prog-fill').style.width = p + '%';
  document.getElementById('bulk-prog-count').innerText = `${cur} / ${total}`;
  document.getElementById('bulk-prog-percent').innerText = p + '%';
}

function closeBulkProgModal() {
  document.getElementById('bulk-prog-modal').style.display = 'none';
}
