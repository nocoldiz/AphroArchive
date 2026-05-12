import { useState, useEffect } from 'preact/hooks';
import { vaultMode } from '../store';

export const DropOverlay = () => {
  const [visible, setVisible] = useState(false);
  const [dragDepth, setDragDepth] = useState(0);

  const w = window as any;

  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      setDragDepth(prev => {
        const next = prev + 1;
        if (next === 1) setVisible(true);
        return next;
      });
    };

    const handleDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    };

    const handleDragLeave = () => {
      setDragDepth(prev => {
        const next = Math.max(0, prev - 1);
        if (next === 0) setVisible(false);
        return next;
      });
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      setDragDepth(0);
      setVisible(false);
      const files = e.dataTransfer?.files;
      if (files?.length) await handleGlobalFiles(files);
    };

    document.addEventListener('dragenter', handleDragEnter, false);
    document.addEventListener('dragover', handleDragOver, false);
    document.addEventListener('dragleave', handleDragLeave, false);
    document.addEventListener('drop', handleDrop, false);

    return () => {
      document.removeEventListener('dragenter', handleDragEnter);
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('dragleave', handleDragLeave);
      document.removeEventListener('drop', handleDrop);
    };
  }, []);

  const handleGlobalFiles = async (files: FileList) => {
    const arr = Array.from(files).filter(f => f.size > 0);
    if (!arr.length) return;

    // 1. VAULT INTERCEPTION
    if (vaultMode.value) {
      let added = 0;
      for (const file of arr) {
        try {
          const r = await fetch('/api/vault/add', {
            method: 'POST',
            headers: { 'x-filename': encodeURIComponent(file.name) },
            body: file
          });
          if (r.ok) added++;
          else if (w.toast) w.toast('Failed to add ' + file.name + ' to vault');
        } catch {
          if (w.toast) w.toast('Error adding ' + file.name);
        }
      }
      
      if (added > 0) {
        if (w.toast) w.toast('Added ' + added + ' file(s) to Vault');
        if (typeof w.loadVaultFiles === 'function') w.loadVaultFiles();
      }
      return;
    }

    // 2. STANDARD IMPORTER
    const counts: Record<string, number> = { video: 0, audio: 0, book: 0, photo: 0, skip: 0 };

    for (const file of arr) {
      try {
        const r = await fetch('/api/import', {
          method: 'POST',
          headers: { 'x-filename': encodeURIComponent(file.name) },
          body: file
        });
        const d = await r.json();
        if (r.ok) counts[d.kind]++;
        else {
          counts.skip++;
          if (w.toast) w.toast('Skipped ' + file.name + ': ' + (d.error || 'unsupported'));
        }
      } catch {
        counts.skip++;
      }
    }

    const imported = counts.video + counts.audio + counts.book + (counts.photo || 0);
    if (!imported) return;

    const parts = [];
    if (counts.video) parts.push(counts.video + ' video' + (counts.video > 1 ? 's' : ''));
    if (counts.audio) parts.push(counts.audio + ' audio');
    if (counts.book)  parts.push(counts.book  + ' book'  + (counts.book  > 1 ? 's' : ''));
    if (counts.photo) parts.push(counts.photo + ' photo' + (counts.photo > 1 ? 's' : ''));
    if (w.toast) w.toast('Imported: ' + parts.join(', '));

    if (counts.video && w.refresh) w.refresh(true);
    if (counts.audio && w.audioMode && w.loadAudio) w.loadAudio();
    if (counts.book  && w.booksMode && w.loadBooks) w.loadBooks();
    if (counts.photo && w.photosMode && w.loadPhotos) w.loadPhotos();
  };

  return (
    <div id="dropOverlay" style={{ display: visible ? 'flex' : 'none' }}>
      <div className="drop-overlay-inner">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <p>Drop files to import</p>
        <span>Videos · Audio · Books</span>
      </div>
    </div>
  );
};
