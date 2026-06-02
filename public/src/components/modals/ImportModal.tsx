import { useState, useRef } from 'preact/hooks';
import { importModalState, currentView, currentCategory } from '../../store';

type Tab = 'links' | 'folder';

const VIDEO_EXTS = new Set(['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'ts', 'mts', 'm2ts', 'mpg', 'mpeg', 'vob', 'ogv', 'divx', 'xvid', 'rm', 'rmvb', 'asf', 'amv', 'f4v', '3gp', '3g2']);
const VIDEO_VIEWS = new Set(['browse', 'home', 'player', 'mosaic']);

export const ImportModal = () => {
  const state = importModalState.value;
  const [tab, setTab] = useState<Tab>('links');
  const [linkText, setLinkText] = useState('');
  const [importing, setImporting] = useState(false);
  const [linkResult, setLinkResult] = useState<{ added: number; skipped: number } | null>(null);
  const [folderFiles, setFolderFiles] = useState<File[]>([]);
  const [folderProgress, setFolderProgress] = useState<{ done: number; total: number } | null>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  if (!state.visible) return null;

  const close = () => {
    importModalState.value = { visible: false };
    setLinkText('');
    setLinkResult(null);
    setFolderFiles([]);
    setFolderProgress(null);
    setImporting(false);
    setTab('links');
  };

  const view = currentView.value;
  const cat = currentCategory.value;
  const destCategory = VIDEO_VIEWS.has(view) && cat ? cat : '';
  const destLabel = destCategory || 'Uncategorized';

  // ── Links tab ──────────────────────────────────────────────────────

  const urlCount = linkText.split('\n').filter(l => l.trim().startsWith('http')).length;

  const importLinks = async () => {
    const urls = linkText.split('\n').map(l => l.trim()).filter(l => l.startsWith('http'));
    if (!urls.length) return;
    setImporting(true);
    setLinkResult(null);
    try {
      const r = await fetch('/api/links/import-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      });
      const d = await r.json();
      if (r.ok) {
        setLinkResult({ added: d.added, skipped: d.skipped });
        setLinkText('');
        const w = window as any;
        if (w.toast) w.toast(`Saved ${d.added} link(s) to Web/Links`);
      }
    } catch {}
    setImporting(false);
  };

  // ── Folder tab ─────────────────────────────────────────────────────

  const handleFolderPick = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files || []).filter(f => {
      const ext = f.name.split('.').pop()?.toLowerCase() || '';
      return VIDEO_EXTS.has(ext);
    });
    setFolderFiles(files);
    setFolderProgress(null);
    // reset input so the same folder can be re-picked
    input.value = '';
  };

  const importFolder = async () => {
    if (!folderFiles.length || importing) return;
    setImporting(true);
    setFolderProgress({ done: 0, total: folderFiles.length });
    let ok = 0;
    for (let i = 0; i < folderFiles.length; i++) {
      const file = folderFiles[i];
      try {
        await fetch('/api/import', {
          method: 'POST',
          headers: {
            'x-filename': encodeURIComponent(file.name),
            'x-category': destCategory,
          },
          body: file,
        });
        ok++;
      } catch {}
      setFolderProgress({ done: i + 1, total: folderFiles.length });
    }
    setImporting(false);
    const w = window as any;
    if (w.toast) w.toast(`Imported ${ok} video(s) → ${destLabel}`);
    if (w.refresh) w.refresh(true);
    close();
  };

  const pickFolder = () => {
    if (!folderInputRef.current) return;
    (folderInputRef.current as any).webkitdirectory = true;
    folderInputRef.current.click();
  };

  // ── Render ─────────────────────────────────────────────────────────

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
          <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Import</span>
          <button
            type="button"
            onClick={close}
            style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: '2px', display: 'flex' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', padding: '12px 20px 0', gap: '2px', borderBottom: '1px solid var(--brd)', marginTop: '12px' }}>
          {(['links', 'folder'] as Tab[]).map(t => (
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
              {t === 'links' ? 'Paste Links' : 'Local Folder'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ padding: '18px 20px 20px' }}>

          {tab === 'links' ? (
            <>
              <p style={{ margin: '0 0 10px', fontSize: '0.78rem', color: 'var(--tx3)', lineHeight: 1.5 }}>
                Paste URLs one per line. Each will be saved to <strong style={{ color: 'var(--tx)' }}>Web / Links</strong>, auto-categorized and tagged by matching the URL against known tags and categories.
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
          ) : (
            <>
              <div style={{ marginBottom: '14px', fontSize: '0.78rem', color: 'var(--tx3)' }}>
                Videos will be imported to{' '}
                <strong style={{ color: 'var(--tx)' }}>{destLabel}</strong>
                {!destCategory && <span> — navigate to a folder first to import there</span>}
              </div>

              {/* Hidden folder input */}
              <input
                ref={folderInputRef}
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={handleFolderPick}
              />

              {folderFiles.length === 0 ? (
                <button
                  type="button"
                  onClick={pickFolder}
                  style={{
                    width: '100%', padding: '28px 20px', border: '2px dashed var(--brd)',
                    background: 'var(--bg3)', color: 'var(--tx2)', borderRadius: '8px',
                    cursor: 'pointer', fontSize: '0.85rem', display: 'flex',
                    flexDirection: 'column', alignItems: 'center', gap: '8px',
                  }}
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                  Choose Folder
                </button>
              ) : (
                <>
                  {/* File list */}
                  <div style={{
                    background: 'var(--bg3)', borderRadius: '6px', border: '1px solid var(--brd)',
                    maxHeight: '180px', overflowY: 'auto', marginBottom: '12px',
                  }}>
                    {folderFiles.map((f, i) => (
                      <div key={i} style={{
                        display: 'flex', justifyContent: 'space-between', padding: '5px 10px',
                        fontSize: '0.74rem', borderBottom: i < folderFiles.length - 1 ? '1px solid var(--brd)' : 'none',
                        color: 'var(--tx2)',
                      }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{f.name}</span>
                        <span style={{ color: 'var(--tx3)', marginLeft: '10px', flexShrink: 0 }}>{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                      </div>
                    ))}
                  </div>

                  {/* Progress bar */}
                  {folderProgress && (
                    <div style={{ marginBottom: '10px' }}>
                      <div style={{ height: '4px', background: 'var(--bg3)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{
                          width: `${(folderProgress.done / folderProgress.total) * 100}%`,
                          height: '100%', background: 'var(--ac)', transition: 'width 0.2s',
                        }} />
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--tx3)', marginTop: '4px' }}>
                        {folderProgress.done} / {folderProgress.total}
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={() => { setFolderFiles([]); setFolderProgress(null); }}
                      disabled={importing}
                      style={{
                        background: 'none', border: '1px solid var(--brd)', color: 'var(--tx2)',
                        borderRadius: '6px', padding: '7px 14px', fontSize: '0.8rem',
                        cursor: importing ? 'default' : 'pointer', opacity: importing ? 0.4 : 1,
                      }}
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={importFolder}
                      disabled={importing}
                      style={{
                        background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '6px',
                        padding: '7px 20px', fontSize: '0.82rem',
                        cursor: importing ? 'default' : 'pointer', opacity: importing ? 0.6 : 1,
                      }}
                    >
                      {importing
                        ? `Importing… ${folderProgress ? `(${folderProgress.done}/${folderProgress.total})` : ''}`
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
