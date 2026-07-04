/** @jsxImportSource preact */
import { useState, useEffect, useRef } from 'preact/hooks';
import { SectionControls } from '../UI/SectionControls';

interface FileItem {
  id: string;
  filename: string;
  title: string;
  ext: string;
  size: number;
  sizeF: string;
  date: number;
  absPath?: string;
  folder: string;
  source: 'upload' | 'scan';
}

const ICON_SIZE_KEY = 'files_icon_size';
const DISPLAY_KEY = 'files_display';

function fileIcon(ext: string) {
  const e = ext.replace('.', '').toLowerCase();
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(e))
    return <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
  if (['exe', 'msi', 'dmg', 'deb', 'rpm', 'apk'].includes(e))
    return <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>;
  if (['json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'csv'].includes(e))
    return <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>;
  if (['js', 'ts', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'cs', 'php', 'sh', 'bat'].includes(e))
    return <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>;
  if (['txt', 'md', 'log', 'rtf'].includes(e))
    return <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>;
  return <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
}

function extColor(ext: string) {
  const e = ext.replace('.', '').toLowerCase();
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(e)) return '#f59e0b';
  if (['exe', 'msi', 'dmg', 'apk'].includes(e)) return '#ef4444';
  if (['json', 'xml', 'yaml', 'yml', 'csv'].includes(e)) return '#10b981';
  if (['js', 'ts', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'sh'].includes(e)) return '#6366f1';
  if (['txt', 'md', 'log'].includes(e)) return '#94a3b8';
  return '#64748b';
}

export const FilesView = () => {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [activeFolder, setActiveFolder] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'date' | 'name' | 'size'>('date');
  const [display, setDisplay] = useState<'grid' | 'table'>(() => (localStorage.getItem(DISPLAY_KEY) as any) || 'grid');
  const [iconSize, setIconSize] = useState(() => parseInt(localStorage.getItem(ICON_SIZE_KEY) || '80', 10));
  const [loading, setLoading] = useState(true);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameFolderVal, setRenameFolderVal] = useState('');
  const uploadRef = useRef<HTMLInputElement>(null);
  const w = window as any;

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [fRes, flRes] = await Promise.all([fetch('/api/files'), fetch('/api/files/folders')]);
      setFiles(await fRes.json());
      setFolders(await flRes.json());
    } catch {}
    setLoading(false);
  };

  const handleUpload = async (e: any) => {
    const input = e.target as HTMLInputElement;
    const picked = Array.from(input.files || []);
    if (!picked.length) return;
    let ok = 0;
    for (const file of picked) {
      try {
        const r = await fetch('/api/files/upload', {
          method: 'POST',
          headers: { 'x-filename': encodeURIComponent(file.name) },
          body: file,
        });
        if (r.ok) {
          ok++;
          if (activeFolder) {
            const d = await r.json();
            if (d.id) await fetch('/api/files/folders/set', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: d.id, folder: activeFolder }) });
          }
        }
      } catch {}
    }
    input.value = '';
    if (ok) { if (w.toast) w.toast(`${ok} file(s) uploaded`); loadAll(); }
  };

  const deleteFile = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    await fetch(`/api/files/${id}`, { method: 'DELETE' });
    if (w.toast) w.toast('Deleted');
    loadAll();
  };

  const moveToFolder = async (fileId: string, folder: string) => {
    try {
      const r = await fetch('/api/files/folders/set', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: fileId, folder: folder || null }) });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to move');
      }
      if (w.toast) w.toast(folder ? `Moved to ${folder}` : 'Moved to root');
    } catch (e: any) {
      if (w.toast) w.toast(e.message || 'Failed to move');
    }
    setMovingId(null);
    loadAll();
  };

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setNewFolderName('');
    setFolders(f => [...f, name].sort());
  };

  const renameFolder = async (oldName: string, newName: string) => {
    if (!newName.trim() || newName === oldName) { setRenamingFolder(null); return; }
    await fetch('/api/files/folders/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oldName, newName: newName.trim() }) });
    if (activeFolder === oldName) setActiveFolder(newName.trim());
    setRenamingFolder(null);
    loadAll();
  };

  const deleteFolder = async (name: string) => {
    if (!confirm(`Delete folder "${name}"? Files will move to root.`)) return;
    await fetch('/api/files/folders/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    if (activeFolder === name) setActiveFolder('');
    loadAll();
  };

  const setDisplayMode = (m: 'grid' | 'table') => { setDisplay(m); localStorage.setItem(DISPLAY_KEY, m); };
  const setSize = (s: number) => { setIconSize(s); localStorage.setItem(ICON_SIZE_KEY, String(s)); };

  const filtered = files
    .filter(f => !activeFolder ? true : f.folder === activeFolder)
    .filter(f => !query || f.filename.toLowerCase().includes(query.toLowerCase()) || f.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => sort === 'name' ? a.filename.localeCompare(b.filename) : sort === 'size' ? b.size - a.size : b.date - a.date);

  const sidebarStyle: any = {
    width: '180px', flexShrink: 0, borderRight: '1px solid var(--brd)',
    padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: '2px',
    overflowY: 'auto',
  };

  const folderBtnStyle = (active: boolean): any => ({
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem',
    background: active ? 'var(--ac)' : 'none', color: active ? '#fff' : 'var(--tx2)',
    border: 'none', width: '100%', textAlign: 'left', gap: '4px',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div class="section-header">
        <h2>Files</h2>
        <SectionControls
          showStarred={false} showShuffle={false} showSource={false} showCardSize={false}
          showFilter={true}
          currentSort={sort}
          onSortChange={(v: any) => setSort(v)}
          currentFilter={query}
          onFilterChange={setQuery}
          sortOptions={[{ value: 'date', label: 'Date' }, { value: 'name', label: 'Name' }, { value: 'size', label: 'Size' }]}
        >
          <span class="sg-sep" />
          {/* Grid / Table toggle */}
          <button title="Grid" onClick={() => setDisplayMode('grid')} style={{ background: display === 'grid' ? 'var(--ac)' : 'var(--bg3)', color: display === 'grid' ? '#fff' : 'var(--tx2)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
          </button>
          <button title="Table" onClick={() => setDisplayMode('table')} style={{ background: display === 'table' ? 'var(--ac)' : 'var(--bg3)', color: display === 'table' ? '#fff' : 'var(--tx2)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          </button>
          {display === 'grid' && (
            <input type="range" min={48} max={160} step={8} value={iconSize} onInput={(e: any) => setSize(Number(e.target.value))}
              title="Icon size"
              style={{ width: '72px', accentColor: 'var(--ac)', cursor: 'pointer' }}
            />
          )}
          <span class="sg-sep" />
          <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', borderRadius: '999px', background: 'var(--bg3)', border: '1px solid var(--brd)', fontSize: '0.75rem' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Upload
            <input ref={uploadRef} type="file" multiple style={{ display: 'none' }} onChange={handleUpload} />
          </label>
        </SectionControls>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Sidebar */}
        <div style={sidebarStyle}>
          <button style={folderBtnStyle(!activeFolder)} onClick={() => setActiveFolder('')}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>All files</span>
            <span style={{ fontSize: '0.7rem', opacity: 0.7, flexShrink: 0 }}>{files.length}</span>
          </button>
          {folders.map(f => (
            <div key={f} style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
              {renamingFolder === f ? (
                <input
                  autoFocus
                  value={renameFolderVal}
                  onInput={(e: any) => setRenameFolderVal(e.target.value)}
                  onKeyDown={(e: any) => { if (e.key === 'Enter') renameFolder(f, renameFolderVal); if (e.key === 'Escape') setRenamingFolder(null); }}
                  onBlur={() => renameFolder(f, renameFolderVal)}
                  style={{ flex: 1, background: 'var(--bg3)', border: '1px solid var(--ac)', borderRadius: '4px', color: 'var(--tx)', padding: '3px 6px', fontSize: '0.78rem' }}
                />
              ) : (
                <button style={folderBtnStyle(activeFolder === f)} onClick={() => setActiveFolder(f)}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{f}</span>
                  <span style={{ fontSize: '0.7rem', opacity: 0.7, flexShrink: 0 }}>{files.filter(x => x.folder === f).length}</span>
                </button>
              )}
              {renamingFolder !== f && (
                <button onClick={() => { setRenamingFolder(f); setRenameFolderVal(f); }} title="Rename" style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: '2px 3px', flexShrink: 0 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
              )}
              {renamingFolder !== f && (
                <button onClick={() => deleteFolder(f)} title="Delete folder" style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: '2px 3px', flexShrink: 0 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              )}
            </div>
          ))}

          {/* New folder */}
          <div style={{ marginTop: '8px', borderTop: '1px solid var(--brd)', paddingTop: '8px' }}>
            <div style={{ display: 'flex', gap: '4px' }}>
              <input
                value={newFolderName}
                onInput={(e: any) => setNewFolderName(e.target.value)}
                onKeyDown={(e: any) => e.key === 'Enter' && createFolder()}
                placeholder="New folder…"
                style={{ flex: 1, background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '4px', color: 'var(--tx)', padding: '4px 6px', fontSize: '0.72rem' }}
              />
              <button onClick={createFolder} style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '0.72rem' }}>+</button>
            </div>
          </div>
        </div>

        {/* Main area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          {loading && <div style={{ color: 'var(--tx2)', fontSize: '0.85rem' }}>Loading…</div>}
          {!loading && filtered.length === 0 && (
            <div style={{ color: 'var(--tx2)', fontSize: '0.85rem' }}>
              {query ? 'No files match.' : activeFolder ? 'No files in this folder.' : 'No files yet. Upload some files or they will appear here when found during scan.'}
            </div>
          )}

          {!loading && filtered.length > 0 && display === 'grid' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
              {filtered.map(f => (
                <div key={f.id} style={{ width: iconSize + 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', cursor: 'default', position: 'relative' }}>
                  <div style={{ width: iconSize, height: iconSize, color: extColor(f.ext), display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg2)', borderRadius: '8px', border: '1px solid var(--brd)', padding: '10px', boxSizing: 'border-box' }}>
                    {fileIcon(f.ext)}
                  </div>
                  <div style={{ width: iconSize + 24, textAlign: 'center', fontSize: Math.max(10, iconSize * 0.13) + 'px', color: 'var(--tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.filename}>{f.title || f.filename}</div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--tx3)', textTransform: 'uppercase' }}>{f.ext.replace('.', '')}</div>
                  {/* Actions row */}
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <a href={`/api/files/${f.id}/download`} download={f.filename} title="Download" style={{ display: 'flex', color: 'var(--tx3)', padding: '3px' }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </a>
                    <button onClick={() => setMovingId(movingId === f.id ? null : f.id)} title="Move to folder" style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: '3px', display: 'flex' }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                    </button>
                    <button onClick={() => deleteFile(f.id, f.filename)} title="Delete" style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: '3px', display: 'flex' }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                  {movingId === f.id && (
                    <div style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '6px', zIndex: 100, minWidth: '140px', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--tx3)', marginBottom: '4px' }}>Move to:</div>
                      <button onClick={() => moveToFolder(f.id, '')} style={{ display: 'block', width: '100%', textAlign: 'left', background: !f.folder ? 'var(--ac)' : 'none', color: !f.folder ? '#fff' : 'var(--tx2)', border: 'none', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '0.78rem' }}>Root</button>
                      {folders.map(fl => (
                        <button key={fl} onClick={() => moveToFolder(f.id, fl)} style={{ display: 'block', width: '100%', textAlign: 'left', background: f.folder === fl ? 'var(--ac)' : 'none', color: f.folder === fl ? '#fff' : 'var(--tx2)', border: 'none', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '0.78rem' }}>{fl}</button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {!loading && filtered.length > 0 && display === 'table' && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ color: 'var(--tx3)', borderBottom: '1px solid var(--brd)' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 500 }}>Name</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 500, width: '60px' }}>Type</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 500, width: '80px' }}>Size</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 500, width: '100px' }}>Folder</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 500, width: '100px' }}>Date</th>
                  <th style={{ width: '90px' }} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((f, i) => (
                  <tr key={f.id} style={{ borderBottom: '1px solid var(--brd)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                    <td style={{ padding: '7px 8px', color: 'var(--tx)', display: 'flex', alignItems: 'center', gap: '8px', maxWidth: '300px' }}>
                      <span style={{ color: extColor(f.ext), flexShrink: 0, display: 'flex', width: 16, height: 16 }}>{fileIcon(f.ext)}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.filename}>{f.title || f.filename}</span>
                    </td>
                    <td style={{ padding: '7px 8px', color: 'var(--tx3)', textTransform: 'uppercase', fontSize: '0.72rem' }}>{f.ext.replace('.', '')}</td>
                    <td style={{ padding: '7px 8px', color: 'var(--tx2)', textAlign: 'right' }}>{f.sizeF}</td>
                    <td style={{ padding: '7px 8px', color: 'var(--tx3)' }}>
                      <select value={f.folder} onChange={(e: any) => moveToFolder(f.id, e.target.value)} style={{ background: 'var(--bg3)', color: 'var(--tx2)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '2px 4px', fontSize: '0.72rem', cursor: 'pointer' }}>
                        <option value="">Root</option>
                        {folders.map(fl => <option key={fl} value={fl}>{fl}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '7px 8px', color: 'var(--tx3)' }}>{new Date(f.date).toLocaleDateString()}</td>
                    <td style={{ padding: '7px 8px' }}>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                        <a href={`/api/files/${f.id}/download`} download={f.filename} title="Download" style={{ color: 'var(--tx3)', display: 'flex' }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        </a>
                        <button onClick={() => deleteFile(f.id, f.filename)} title="Delete" style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: '0', display: 'flex' }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
