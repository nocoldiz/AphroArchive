// ─── Global Import ───

function openImport() {
  $('globalFileIn').el.click();
}

async function handleGlobalFiles(files) {
  const arr = Array.from(files).filter(f => f.size > 0);
  if (!arr.length) return;

  const counts = { video: 0, audio: 0, book: 0, skip: 0 };

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

  const imported = counts.video + counts.audio + counts.book;
  if (!imported) return;

  const parts = [];
  if (counts.video) parts.push(counts.video + ' video' + (counts.video > 1 ? 's' : ''));
  if (counts.audio) parts.push(counts.audio + ' audio');
  if (counts.book)  parts.push(counts.book  + ' book'  + (counts.book  > 1 ? 's' : ''));
  toast('Imported: ' + parts.join(', '));

  if (counts.video) refresh();
  if (counts.audio && audioMode) loadAudio();
  if (counts.book  && booksMode) loadBooks();

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
