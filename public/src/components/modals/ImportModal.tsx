import { useState, useRef } from 'preact/hooks';
import { importModalState, currentView, currentFolder, isVaultUnlocked, activeProfile } from '../../store';

type Tab = 'links' | 'files' | 'folder';

const VIDEO_VIEWS = new Set(['browse', 'home', 'player', 'mosaic']);

// Directory portion of a picked file's relative path ("Top/sub/file.mp4" → "Top/sub").
const dirOf = (file: File) => {
  const rel = (file as any).webkitRelativePath || file.name;
  const parts = rel.split('/');
  parts.pop();
  return parts.join('/');
};

export const ImportModal = () => {
  const state = importModalState.value;
  const [tab, setTab] = useState<Tab>('links');
  const [linkText, setLinkText] = useState('');
  const [importing, setImporting] = useState(false);
  const [linkResult, setLinkResult] = useState<{ added: number; skipped: number } | null>(null);
  const [filesList, setFilesList] = useState<File[]>([]);
  const [folderFiles, setFolderFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  if (!state.visible) return null;

  const close = () => {
    importModalState.value = { visible: false };
    setLinkText('');
    setLinkResult(null);
    setFilesList([]);
    setFolderFiles([]);
    setProgress(null);
    setImporting(false);
    setTab('links');
  };

  const view = currentView.value;
  const cat = currentFolder.value;
  const destCategory = VIDEO_VIEWS.has(view) && cat ? cat : '';
  const inVaultMode = isVaultUnlocked.value && activeProfile.value === 'Vault';
  const vaultFolderName = (() => {
    const id = (window as any).vaultCurFolder;
    if (!id) return '';
    const f = ((window as any).vaultFolders || []).find((x: any) => x.id === id);
    return f?.name || '';
  })();
  const destLabel = inVaultMode
    ? (vaultFolderName ? `Vault / ${vaultFolderName}` : 'Vault')
    : (destCategory || 'Uncategorized');

  // ── Links tab ──────────────────────────────────────────────────────

  const urlCount = linkText.split('\n').filter(l => l.trim().startsWith('http')).length;

  const importLinks = async () => {
    const urls = linkText.split('\n').map(l => l.trim()).filter(l => l.startsWith('http'));
    if (!urls.length) return;
    setImporting(true);
    setLinkResult(null);
    try {
      const endpoint = inVaultMode ? '/api/vault/import-links' : '/api/links/import-urls';
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      });
      const d = await r.json();
      if (r.ok) {
        setLinkResult({ added: d.added, skipped: d.skipped });
        setLinkText('');
        const w = window as any;
        if (w.toast) w.toast(inVaultMode ? `Saved ${d.added} link(s) to Vault` : `Saved ${d.added} link(s) to Web/Links`);
      }
    } catch {}
    setImporting(false);
  };

  // ── File / folder import ───────────────────────────────────────────

  const handleFilesPick = (e: Event) => {
    const input = e.target as HTMLInputElement;
    setFilesList(Array.from(input.files || []));
    setProgress(null);
    input.value = '';
  };

  const handleFolderPick = (e: Event) => {
    const input = e.target as HTMLInputElement;
    setFolderFiles(Array.from(input.files || []));
    setProgress(null);
    input.value = '';
  };

  const pickFiles = () => filesInputRef.current?.click();
  const pickFolder = () => {
    if (!folderInputRef.current) return;
    (folderInputRef.current as any).webkitdirectory = true;
    folderInputRef.current.click();
  };

  // Encrypt / import a batch. `preserveStructure` mirrors the source folder tree
  // (creating subfolders) — used by the Folder tab; the Files tab drops straight
  // into the currently open folder.
  const runImport = async (items: File[], preserveStructure: boolean) => {
    if (!items.length || importing) return;
    setImporting(true);
    setProgress({ done: 0, total: items.length });
    let ok = 0;
    const w = window as any;

    if (inVaultMode) {
      const baseId: string | null = w.vaultCurFolder || null;
      // Resolve / create vault folders by path, caching `${parent}|${name}` → id.
      const folByKey = new Map<string, string>();
      if (preserveStructure) {
        try {
          const all = await fetch('/api/vault/files').then(r => r.json());
          if (Array.isArray(all)) {
            for (const f of all) {
              if (f.type === 'folder') folByKey.set(`${f.parent || ''}|${(f.name || '').toLowerCase()}`, f.id);
            }
          }
        } catch {}
      }
      const ensureFolder = async (dirRel: string): Promise<string | null> => {
        let parent: string | null = baseId;
        for (const seg of dirRel.split('/').filter(Boolean)) {
          const key = `${parent || ''}|${seg.toLowerCase()}`;
          let id = folByKey.get(key);
          if (!id) {
            try {
              const r = await fetch('/api/vault/folders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: seg, parent }),
              });
              const d = await r.json();
              id = d.id;
            } catch {}
            if (id) folByKey.set(key, id);
          }
          parent = id || parent;
        }
        return parent;
      };

      // Surface the import in Sync & Background Tasks (server can't size the
      // batch on its own since files stream in one request each).
      const encProg = (phase: string, extra: Record<string, unknown> = {}) =>
        fetch('/api/encryption/import-progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phase, ...extra }),
        }).catch(() => {});

      await encProg('start', { total: items.length });
      try {
        for (let i = 0; i < items.length; i++) {
          const file = items[i];
          await encProg('update', { done: i, current: file.name });
          try {
            const folderId = preserveStructure ? await ensureFolder(dirOf(file)) : baseId;
            const headers: Record<string, string> = { 'x-filename': encodeURIComponent(file.name) };
            if (folderId) headers['x-folder'] = folderId;
            const r = await fetch('/api/vault/add', { method: 'POST', headers, body: file });
            if (r.ok) ok++;
          } catch {}
          setProgress({ done: i + 1, total: items.length });
        }
      } finally {
        await encProg('done', { done: ok });
      }
      setImporting(false);
      if (w.toast) w.toast(`Encrypted ${ok} file(s) to Vault`);
      if (typeof w.loadVaultFiles === 'function') w.loadVaultFiles();
      close();
      return;
    }

    // Non-vault: videos route to their category folder; other types are sorted
    // by the server into their own libraries (subfolder applies to videos only).
    for (let i = 0; i < items.length; i++) {
      const file = items[i];
      try {
        const category = preserveStructure
          ? [destCategory, dirOf(file)].filter(Boolean).join('/')
          : destCategory;
        const r = await fetch('/api/import', {
          method: 'POST',
          headers: { 'x-filename': encodeURIComponent(file.name), 'x-category': category },
          body: file,
        });
        if (r.ok) ok++;
      } catch {}
      setProgress({ done: i + 1, total: items.length });
    }
    setImporting(false);
    if (w.toast) w.toast(`Imported ${ok} file(s)`);
    if (w.refresh) w.refresh(true);
    close();
  };

  // ── Render ─────────────────────────────────────────────────────────

  const renderFileList = (list: File[], showPath: boolean) => (
    <div style={{
      background: 'var(--bg3)', borderRadius: '6px', border: '1px solid var(--brd)',
      maxHeight: '180px', overflowY: 'auto', marginBottom: '12px',
    }}>
      {list.map((f, i) => (
        <div key={i} style={{
          display: 'flex', justifyContent: 'space-between', padding: '5px 10px',
          fontSize: '0.74rem', borderBottom: i < list.length - 1 ? '1px solid var(--brd)' : 'none',
          color: 'var(--tx2)',
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {showPath ? ((f as any).webkitRelativePath || f.name) : f.name}
          </span>
          <span style={{ color: 'var(--tx3)', marginLeft: '10px', flexShrink: 0 }}>{(f.size / 1024 / 1024).toFixed(1)} MB</span>
        </div>
      ))}
    </div>
  );

  const progressBar = progress && (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ height: '4px', background: 'var(--bg3)', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{
          width: `${(progress.done / progress.total) * 100}%`,
          height: '100%', background: 'var(--ac)', transition: 'width 0.2s',
        }} />
      </div>
      <div style={{ fontSize: '0.7rem', color: 'var(--tx3)', marginTop: '4px' }}>
        {progress.done} / {progress.total}
      </div>
    </div>
  );

  const dropBtnStyle = {
    width: '100%', padding: '28px 20px', border: '2px dashed var(--brd)',
    background: 'var(--bg3)', color: 'var(--tx2)', borderRadius: '8px',
    cursor: 'pointer', fontSize: '0.85rem', display: 'flex',
    flexDirection: 'column' as const, alignItems: 'center', gap: '8px',
  };

  const folderTopName = folderFiles.length ? (((folderFiles[0] as any).webkitRelativePath || '').split('/')[0] || '') : '';

  return (
    <div
      className="modal-overlay on"
      onClick={(e: any) => e.target === e.currentTarget && close()}
      style={{ zIndex: 20000 }}
    >
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--brd)',
        borderRadius: '10px', width: '480px', maxWidth: '96vw', overflow: 'hidden',
        boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
      }}>

        {/* Header */}
        <div style={{ padding: '16px 20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Import{inVaultMode ? ' to Vault' : ''}</span>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            title="Close"
            style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: '2px', display: 'flex' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', padding: '12px 20px 0', gap: '2px', borderBottom: '1px solid var(--brd)', marginTop: '12px' }}>
          {(['links', 'files', 'folder'] as Tab[]).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              style={{
                background: tab === t ? 'var(--ac)' : 'none',
                color: tab === t ? '#fff' : 'var(--tx2)',
                border: 'none', borderRadius: '4px 4px 0 0',
                padding: '6px 16px', fontSize: '0.8rem', cursor: 'pointer', fontWeight: tab === t ? 600 : 400,
              }}
            >
              {t === 'links' ? 'Paste Links' : t === 'files' ? 'Files' : 'Folder'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ padding: '18px 20px 20px' }}>

          {tab === 'links' && (
            <>
              <p style={{ margin: '0 0 10px', fontSize: '0.78rem', color: 'var(--tx3)', lineHeight: 1.5 }}>
                Paste URLs one per line. Each will be saved to{' '}
                <strong style={{ color: 'var(--tx)' }}>{inVaultMode ? 'Vault Links' : 'Web / Links'}</strong>
                {inVaultMode ? ' — visible only inside the Vault.' : ', auto-categorized and tagged by matching the URL against known tags and categories.'}
              </p>
              <textarea
                value={linkText}
                onInput={(e: any) => { setLinkText(e.target.value); setLinkResult(null); }}
                placeholder={'https://example.com/video1\nhttps://example.com/video2'}
                rows={7}
                style={{
                  width: '100%', boxSizing: 'border-box', resize: 'vertical',
                  background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)',
                  borderRadius: '6px', padding: '8px 10px', fontSize: '0.78rem',
                  fontFamily: 'monospace', lineHeight: 1.5, outline: 'none',
                }}
              />
              {linkResult && (
                <div style={{ marginTop: '8px', fontSize: '0.78rem', color: linkResult.added > 0 ? '#1a7' : 'var(--tx3)' }}>
                  {linkResult.added > 0
                    ? <>Added <strong>{linkResult.added}</strong> link(s){linkResult.skipped > 0 ? ` · ${linkResult.skipped} already existed` : ''}</>
                    : 'All URLs already in library'}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--tx3)' }}>{urlCount} URL{urlCount !== 1 ? 's' : ''}</span>
                <button
                  type="button"
                  onClick={importLinks}
                  disabled={!urlCount || importing}
                  style={{
                    background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '6px',
                    padding: '7px 20px', fontSize: '0.82rem', cursor: urlCount && !importing ? 'pointer' : 'default',
                    opacity: !urlCount || importing ? 0.5 : 1,
                  }}
                >
                  {importing ? 'Saving…' : 'Save to Links'}
                </button>
              </div>
            </>
          )}

          {tab === 'files' && (
            <>
              <div style={{ marginBottom: '14px', fontSize: '0.78rem', color: 'var(--tx3)' }}>
                {inVaultMode
                  ? <>Files will be encrypted into <strong style={{ color: 'var(--tx)' }}>{destLabel}</strong>.</>
                  : <>Files are sorted by type. Videos go to <strong style={{ color: 'var(--tx)' }}>{destLabel}</strong>{!destCategory && <span> — open a folder first to import videos there</span>}.</>}
              </div>

              <input ref={filesInputRef} type="file" multiple aria-label="Choose files" title="Choose files" style={{ display: 'none' }} onChange={handleFilesPick} />

              {filesList.length === 0 ? (
                <button type="button" onClick={pickFiles} style={dropBtnStyle}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  </svg>
                  Choose Files
                </button>
              ) : (
                <>
                  {renderFileList(filesList, false)}
                  {progressBar}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={() => { setFilesList([]); setProgress(null); }}
                      disabled={importing}
                      style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '6px', padding: '7px 14px', fontSize: '0.8rem', cursor: importing ? 'default' : 'pointer', opacity: importing ? 0.4 : 1 }}
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => runImport(filesList, false)}
                      disabled={importing}
                      style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '6px', padding: '7px 20px', fontSize: '0.82rem', cursor: importing ? 'default' : 'pointer', opacity: importing ? 0.6 : 1 }}
                    >
                      {importing
                        ? `Importing… ${progress ? `(${progress.done}/${progress.total})` : ''}`
                        : `Import ${filesList.length} file${filesList.length !== 1 ? 's' : ''}`}
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {tab === 'folder' && (
            <>
              <div style={{ marginBottom: '14px', fontSize: '0.78rem', color: 'var(--tx3)' }}>
                The whole folder (including subfolders) is imported into a new folder named after it
                {inVaultMode
                  ? <> under <strong style={{ color: 'var(--tx)' }}>{destLabel}</strong>, encrypted.</>
                  : <> under <strong style={{ color: 'var(--tx)' }}>{destLabel}</strong> for videos; other types are sorted by kind.</>}
              </div>

              <input ref={folderInputRef} type="file" multiple aria-label="Choose folder" title="Choose folder" style={{ display: 'none' }} onChange={handleFolderPick} />

              {folderFiles.length === 0 ? (
                <button type="button" onClick={pickFolder} style={dropBtnStyle}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                  Choose Folder
                </button>
              ) : (
                <>
                  {folderTopName && (
                    <div style={{ fontSize: '0.76rem', color: 'var(--tx2)', marginBottom: '8px' }}>
                      📁 <strong style={{ color: 'var(--tx)' }}>{folderTopName}</strong> · {folderFiles.length} file{folderFiles.length !== 1 ? 's' : ''}
                    </div>
                  )}
                  {renderFileList(folderFiles, true)}
                  {progressBar}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={() => { setFolderFiles([]); setProgress(null); }}
                      disabled={importing}
                      style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '6px', padding: '7px 14px', fontSize: '0.8rem', cursor: importing ? 'default' : 'pointer', opacity: importing ? 0.4 : 1 }}
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => runImport(folderFiles, true)}
                      disabled={importing}
                      style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '6px', padding: '7px 20px', fontSize: '0.82rem', cursor: importing ? 'default' : 'pointer', opacity: importing ? 0.6 : 1 }}
                    >
                      {importing
                        ? `Importing… ${progress ? `(${progress.done}/${progress.total})` : ''}`
                        : `Import ${folderFiles.length} file${folderFiles.length !== 1 ? 's' : ''}`}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
