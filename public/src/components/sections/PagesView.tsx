import { useState, useEffect } from 'preact/hooks';
import { SectionControls } from '../UI/SectionControls';
import { cardSize, contextMenuState } from '../../store';
import { PageItem } from '../../types';

export const PagesView = () => {
  const [pagesList, setPagesList] = useState<PageItem[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPages();
  }, []);

  const loadPages = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/pages');
      const data = await res.json();
      setPagesList(data);
    } catch (e) {
      console.error(e);
      setPagesList([]);
    } finally {
      setLoading(false);
    }
  };

  const deletePage = async (id: string, name: string) => {
    const w = window as any;
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      const r = await fetch(`/api/pages/${id}`, { method: 'DELETE' });
      if (!r.ok) {
        if (w.toast) w.toast('Delete failed');
        return;
      }
      setPagesList(pagesList.filter(p => p.id !== id));
      if (w.toast) w.toast('Page deleted');
    } catch (e) {
      if (w.toast) w.toast('Delete failed');
    }
  };

  const openPage = async (id: string, name: string) => {
    const w = window as any;
    if (w._openHtmlViewer) {
      await w._openHtmlViewer(`/api/pages/${id}/stream`, name, async () => {
        // Callback on delete inside viewer
        await deletePage(id, name);
      });
    } else {
      console.error('_openHtmlViewer not found on window');
    }
  };

  const openCtx = (e: any, page: PageItem) => {
    e.preventDefault();
    e.stopPropagation();
    contextMenuState.value = {
      visible: true,
      x: e.pageX,
      y: e.pageY,
      type: 'page',
      data: {
        id: page.id,
        name: page.name,
        onDelete: () => deletePage(page.id, page.name),
        onOpen: () => openPage(page.id, page.name)
      }
    };
  };

  const handleUpload = async (e: any) => {
    const input = e.target;
    const files = [...input.files].filter((f: File) => /\.(html?|xhtml|mhtml)$/i.test(f.name));
    if (!files.length) return;
    
    const w = window as any;
    for (const file of files) {
      const buf = await file.arrayBuffer();
      await fetch('/api/pages/upload', {
        method: 'POST',
        headers: { 'X-Filename': file.name, 'Content-Type': 'application/octet-stream' },
        body: buf,
      });
    }
    input.value = '';
    await loadPages();
    if (w.toast) w.toast(files.length === 1 ? `"${files[0].name}" added` : `${files.length} pages added`);
  };

  const filteredPages = query
    ? pagesList.filter(p => p.name.toLowerCase().includes(query.toLowerCase()))
    : pagesList;

  return (
    <div className="pages-view on">
      <div className="section-header">
        <h2>Saved Pages</h2>
        <SectionControls 
          showSort={false}
          showStarred={false}
          showShuffle={false}
          showSource={false}
          showFilter={true}
          currentFilter={query}
          onFilterChange={setQuery}
        >
          <span className="sg-sep"></span>
          <label className="vault-add-label" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', borderRadius: '999px', background: 'var(--bg3)', border: '1px solid var(--brd)', fontSize: '0.75rem' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg> Add Pages
            <input type="file" multiple accept=".html,.htm,.xhtml,.mhtml" style={{ display: 'none' }} onChange={handleUpload} />
          </label>
        </SectionControls>
      </div>

      <div id="pagesGrid" className="pages-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize.value}px, 1fr))`, gap: '16px', padding: '16px 0' }}>
        {loading && <div style={{ color: 'var(--tx2)', fontSize: '0.85rem', padding: '8px 0' }}>Loading…</div>}
        {!loading && filteredPages.length === 0 && (
          <div id="pagesEmpty" style={{ color: 'var(--tx2)', fontSize: '0.85rem', padding: '8px 0' }}>
            No pages found
          </div>
        )}
        {!loading && filteredPages.map(p => (
          <div key={p.id} className="page-card" onClick={() => openPage(p.id, p.name)} onContextMenu={(e) => openCtx(e, p)} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'var(--bg2)', borderRadius: '8px', cursor: 'pointer', position: 'relative' }}>
            <div className="page-card-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="9" y1="13" x2="15" y2="13"/>
                <line x1="9" y1="17" x2="13" y2="17"/>
              </svg>
            </div>
            <div className="page-card-body" style={{ flex: 1, minWidth: 0 }}>
              <div className="page-card-name" style={{ fontWeight: '500', color: 'var(--tx)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
              <div className="page-card-meta" style={{ fontSize: '0.75rem', color: 'var(--tx3)' }}>{p.sizeF} · {new Date(p.mtime).toLocaleDateString()}</div>
            </div>
            <button 
              className="page-card-del" 
              onClick={(e) => { e.stopPropagation(); deletePage(p.id, p.name); }} 
              title="Delete"
              style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: '4px' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6"/><path d="M14 11v6"/>
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
