/** @jsxImportSource preact */
import { useState, useEffect } from 'preact/hooks';

interface Book {
  id: string;
  title: string;
  filename: string;
  ext: string;
  type?: string;
  size?: number;
  sizeF?: string;
  date?: number;
  chapters?: number;
}

export const BooksView = () => {
  const [books, setBooks] = useState<Book[]>([]);
  const [sort, setSort] = useState<'date' | 'name' | 'size'>('date');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [readingBook, setReadingBook] = useState<any | null>(null);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [importing, setImporting] = useState(false);

  const w = window as any;

  useEffect(() => {
    loadBooks();
  }, []);

  const loadBooks = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/books');
      const data = await res.json();
      setBooks(data);
    } catch (e) {
      console.error(e);
      setBooks([]);
    } finally {
      setLoading(false);
    }
  };

  const openBook = async (id: string, isVault: boolean = false) => {
    setReadingBook({ loading: true });
    try {
      const url = isVault ? `/api/vault/read-book?id=${id}` : `/api/books/read/${id}`;
      const res = await fetch(url);
      
      if (res.headers.get('content-type')?.includes('application/pdf') ||
          res.headers.get('content-type')?.includes('epub')) {
        setReadingBook(null);
        window.open(url, '_blank');
        return;
      }

      const data = await res.json();
      setReadingBook({ ...data, id, isVault });
      const ext = (data.ext || '').toLowerCase();
      if (ext === '.txt' || ext === '.md') {
        setEditContent(data.content || '');
      }
    } catch (e) {
      console.error(e);
      setReadingBook(null);
      if (w.toast) w.toast('Failed to load book');
    }
  };

  const saveBookEdit = async () => {
    if (!readingBook || !readingBook.id) return;
    setSaving(true);
    try {
      const url = readingBook.isVault ? `/api/vault/text/${readingBook.id}` : `/api/books/${readingBook.id}`;
      const r = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent }),
      });
      if (r.ok) {
        if (w.toast) w.toast('Saved');
      } else {
        if (w.toast) w.toast('Save failed');
      }
    } catch (e) {
      if (w.toast) w.toast('Save failed');
    } finally {
      setSaving(false);
    }
  };

  const importBook = async () => {
    if (!urlInput.trim()) return;
    setImporting(true);
    try {
      const r = await fetch('/api/books/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.trim() })
      });
      const d = await r.json();
      if (!r.ok) {
        if (w.toast) w.toast(d.error || 'Import failed');
        return;
      }
      setUrlInput('');
      if (w.toast) w.toast(`Imported: ${d.title}`);
      loadBooks();
    } catch (e: any) {
      if (w.toast) w.toast(e.message);
    } finally {
      setImporting(false);
    }
  };

  const deleteBook = async (id: string) => {
    if (!confirm('Delete this book?')) return;
    try {
      const r = await fetch(`/api/books/${id}`, { method: 'DELETE' });
      if (r.ok) {
        if (w.toast) w.toast('Book deleted');
        loadBooks();
      } else {
        if (w.toast) w.toast('Delete failed');
      }
    } catch (e) {
      if (w.toast) w.toast('Delete failed');
    }
  };

  const handleUpload = async (e: any) => {
    const fileInput = e.target;
    const files = fileInput.files;
    if (!files.length) return;
    let done = 0;
    for (const file of files) {
      try {
        const r = await fetch('/api/books/upload', {
          method: 'POST',
          headers: { 'x-filename': encodeURIComponent(file.name) },
          body: file
        });
        if (r.ok) done++;
      } catch {
        console.error('Upload error');
      }
    }
    fileInput.value = '';
    if (done) {
      if (w.toast) w.toast(`${done} book${done !== 1 ? 's' : ''} added`);
      loadBooks();
    }
  };

  const renderMarkdown = (md: string) => {
    return md
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^---$/gm, '<hr>')
      .split(/\n{2,}/).map(p => {
        p = p.trim();
        if (!p || p.startsWith('<h') || p.startsWith('<hr')) return p;
        return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
      }).join('\n');
  };

  const sortedBooks = [...books];
  if (sort === 'name') sortedBooks.sort((a, b) => (a.title || a.filename).localeCompare(b.title || b.filename));
  else if (sort === 'size') sortedBooks.sort((a, b) => (b.size || 0) - (a.size || 0));
  else sortedBooks.sort((a, b) => (b.date || 0) - (a.date || 0));

  const filteredBooks = query
    ? sortedBooks.filter(b => (b.title || b.filename || '').toLowerCase().includes(query.toLowerCase()))
    : sortedBooks;

  return (
    <div className="books-view on">
      <div className="section-header">
        <h2>Books & Documents</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div className="ss-tabs" style={{ display: 'flex', gap: '4px', background: 'var(--bg3)', padding: '2px', borderRadius: '8px' }}>
            <button className={`ss-tab ${sort === 'date' ? 'on' : ''}`} onClick={() => setSort('date')} style={{ padding: '4px 8px', borderRadius: '4px', border: 'none', background: sort === 'date' ? 'var(--ac)' : 'transparent', color: sort === 'date' ? '#fff' : 'var(--tx2)', cursor: 'pointer', fontSize: '0.75rem' }}>Date</button>
            <button className={`ss-tab ${sort === 'name' ? 'on' : ''}`} onClick={() => setSort('name')} style={{ padding: '4px 8px', borderRadius: '4px', border: 'none', background: sort === 'name' ? 'var(--ac)' : 'transparent', color: sort === 'name' ? '#fff' : 'var(--tx2)', cursor: 'pointer', fontSize: '0.75rem' }}>Name</button>
            <button className={`ss-tab ${sort === 'size' ? 'on' : ''}`} onClick={() => setSort('size')} style={{ padding: '4px 8px', borderRadius: '4px', border: 'none', background: sort === 'size' ? 'var(--ac)' : 'transparent', color: sort === 'size' ? '#fff' : 'var(--tx2)', cursor: 'pointer', fontSize: '0.75rem' }}>Size</button>
          </div>

          <label className="vault-add-label" style={{ cursor: 'pointer' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg> Upload
            <input type="file" multiple style={{ display: 'none' }} onChange={handleUpload} />
          </label>

          <div style={{ display: 'flex', gap: '4px' }}>
            <input 
              type="text" 
              placeholder="Import URL…" 
              value={urlInput}
              onInput={(e: any) => setUrlInput(e.target.value)}
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '4px 10px', borderRadius: '4px', fontSize: '0.75rem', width: '150px' }}
            />
            <button className="btn-primary" onClick={importBook} disabled={importing} style={{ padding: '4px 10px', fontSize: '0.75rem' }}>
              {importing ? '...' : 'Import'}
            </button>
          </div>

          <div className="gallery-filter-wrap" style={{ display: 'flex', alignItems: 'center' }}>
            <input 
              type="text" 
              placeholder="Filter…" 
              value={query}
              onInput={(e: any) => setQuery(e.target.value)}
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '4px 10px', borderRadius: '999px', fontSize: '0.75rem', width: '120px' }}
            />
          </div>
        </div>
      </div>

      <div id="booksGrid" className="books-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '16px', padding: '16px 0' }}>
        {loading && <div style={{ color: 'var(--tx2)', fontSize: '0.85rem' }}>Loading…</div>}
        {!loading && filteredBooks.length === 0 && (
          <div id="booksEmpty" style={{ color: 'var(--tx2)', fontSize: '0.85rem' }}>No books found.</div>
        )}
        {!loading && filteredBooks.map(b => (
          <div key={b.id} className="bk-card" onClick={() => openBook(b.id)} style={{ display: 'flex', gap: '12px', padding: '12px', background: 'var(--bg2)', borderRadius: '8px', cursor: 'pointer', position: 'relative' }}>
            <div className="bk-icon" style={{ color: 'var(--tx2)' }}>
              {b.ext === '.pdf' ? (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="11" y2="17"/></svg>
              ) : b.ext === '.epub' ? (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
              ) : (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              )}
            </div>
            <div className="bk-info" style={{ flex: 1, minWidth: 0 }}>
              <div className="bk-title" style={{ fontWeight: '500', color: 'var(--tx)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.title || b.filename}</div>
              <div className="bk-meta" style={{ fontSize: '0.75rem', color: 'var(--tx3)', display: 'flex', gap: '6px', alignItems: 'center' }}>
                {b.type === 'fanfiction' && <span className="bk-badge bk-badge--ff" style={{ background: 'var(--bg3)', padding: '2px 4px', borderRadius: '4px', fontSize: '0.65rem' }}>FF.net</span>}
                {b.type === 'url' && <span className="bk-badge bk-badge--url" style={{ background: 'var(--bg3)', padding: '2px 4px', borderRadius: '4px', fontSize: '0.65rem' }}>Web</span>}
                {b.ext && <span className="bk-badge" style={{ background: 'var(--bg3)', padding: '2px 4px', borderRadius: '4px', fontSize: '0.65rem' }}>{b.ext.replace('.','').toUpperCase()}</span>}
                {b.chapters && <span className="bk-chapters">{b.chapters} ch.</span>}
                <span>{b.sizeF || ''}</span>
              </div>
            </div>
            <button 
              className="bk-del" 
              onClick={(e) => { e.stopPropagation(); deleteBook(b.id); }} 
              title="Delete"
              style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: '4px' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        ))}
      </div>

      {readingBook && (
        <div className="books-reader on" style={{ position: 'fixed', inset: 0, background: 'var(--bg1)', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
          <div className="reader-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--brd)' }}>
            <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{readingBook.title || 'Reading'}</h2>
            <button className="btn-icon" onClick={() => setReadingBook(null)} style={{ background: 'none', border: 'none', color: 'var(--tx)', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
          </div>
          <div className="reader-body" style={{ flex: 1, overflowY: 'auto', padding: '16px', maxWidth: '800px', margin: '0 auto', width: '100%' }}>
            {readingBook.loading ? (
              <div style={{ color: 'var(--tx2)' }}>Loading…</div>
            ) : (
              readingBook.ext === '.txt' || readingBook.ext === '.md' ? (
                <div>
                  <textarea 
                    value={editContent}
                    onInput={(e: any) => setEditContent(e.target.value)}
                    style={{ width: '100%', height: '60vh', background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '12px', fontFamily: 'monospace', fontSize: '13px', resize: 'vertical', boxSizing: 'border-box' }}
                  />
                  <div style={{ display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center' }}>
                    <button onClick={saveBookEdit} disabled={saving} style={{ background: 'var(--ac)', color: '#fff', border: 'none', padding: '7px 18px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <div dangerouslySetInnerHTML={{ __html: renderMarkdown(readingBook.content || '') }} />
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
};
