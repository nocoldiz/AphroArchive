// ─── Global Import ───

function openImport() {
  $('globalFileIn').el.click();
}

async function handleGlobalFiles(files) {
  const arr = Array.from(files).filter(f => f.size > 0);
  if (!arr.length) return;

  // 1. VAULT INTERCEPTION: If the user is in the vault, send files there instead.
  if (typeof vaultMode !== 'undefined' && vaultMode) {
    let added = 0;
    for (const file of arr) {
      try {
        // NOTE: Adjust '/api/vault/add' if your vault upload endpoint is named differently
        // (e.g., '/api/vault/upload'). Or, if you have a specific JS function 
        // like `uploadToVault(file)`, call it here instead of fetch.
        const r = await fetch('/api/vault/add', {
          method: 'POST',
          headers: { 'x-filename': encodeURIComponent(file.name) },
          body: file
        });
        if (r.ok) added++;
        else toast('Failed to add ' + file.name + ' to vault');
      } catch {
        toast('Error adding ' + file.name);
      }
    }
    
    if (added > 0) {
      toast('Added ' + added + ' file(s) to Vault');
      if (typeof loadVaultFiles === 'function') loadVaultFiles(); // Refresh vault view
    }
    
    $('globalFileIn').el.value = '';
    return; // Exit early so they don't get sent to the general importer
  }

  // 2. STANDARD IMPORTER (Videos, Audio, Books)
  const counts = { video: 0, audio: 0, book: 0, photo: 0, skip: 0 };

  for (const file of arr) {
    try {
      const r = await fetch('/api/import', {
        method: 'POST',
        headers: { 'x-filename': encodeURIComponent(file.name) },
        body: file
      });
      const d = await r.json();
      if (r.ok) counts[d.kind]++;
      else { counts.skip++; toast('Skipped ' + file.name + ': ' + (d.error || 'unsupported')); }
    } catch { counts.skip++; }
  }

  const imported = counts.video + counts.audio + counts.book + (counts.photo || 0);
  if (!imported) return;

  const parts = [];
  if (counts.video) parts.push(counts.video + ' video' + (counts.video > 1 ? 's' : ''));
  if (counts.audio) parts.push(counts.audio + ' audio');
  if (counts.book)  parts.push(counts.book  + ' book'  + (counts.book  > 1 ? 's' : ''));
  if (counts.photo) parts.push(counts.photo + ' photo' + (counts.photo > 1 ? 's' : ''));
  toast('Imported: ' + parts.join(', '));

  if (counts.video) refresh();
  if (counts.audio && audioMode) loadAudio();
  if (counts.book  && booksMode) loadBooks();
  if (counts.photo && photosMode) loadPhotos();

  $('globalFileIn').el.value = '';
}

// ─── Drag & Drop overlay ───

let _dragDepth = 0;

document.addEventListener('dragenter', e => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  _dragDepth++;
  if (_dragDepth === 1) $('dropOverlay').show(true);
}, false);

document.addEventListener('dragover', e => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
}, false);

document.addEventListener('dragleave', () => {
  _dragDepth = Math.max(0, _dragDepth - 1);
  if (_dragDepth === 0) $('dropOverlay').show(false);
}, false);

document.addEventListener('drop', async e => {
  e.preventDefault();
  _dragDepth = 0;
  $('dropOverlay').show(false);
  const files = e.dataTransfer?.files;
  if (files?.length) await handleGlobalFiles(files);
}, false);
