import { useState, useEffect } from 'preact/hooks';
import { searchQuery } from '../../store';

export const SearchExtras = () => {
  const q = searchQuery.value;
  const [photos, setPhotos] = useState<any[]>([]);
  const [audio, setAudio] = useState<any[]>([]);
  const [books, setBooks] = useState<any[]>([]);

  useEffect(() => {
    if (!q) {
      setPhotos([]);
      setAudio([]);
      setBooks([]);
      return;
    }

    Promise.all([
      fetch('/api/photos').then(r => r.json()).catch(() => []),
      fetch('/api/audio').then(r => r.json()).catch(() => []),
      fetch('/api/books').then(r => r.json()).catch(() => []),
    ]).then(([ph, au, bk]) => {
      const ql = q.toLowerCase();
      setPhotos(ph.filter((p: any) => p.filename.toLowerCase().includes(ql)));
      setAudio(au.filter((a: any) => (a.title || '').toLowerCase().includes(ql)));
      setBooks(bk.filter((b: any) => (b.title || b.filename || '').toLowerCase().includes(ql)));
    });
  }, [q]);

  if (!q || (!photos.length && !audio.length && !books.length)) return null;

  return (
    <>
      {photos.length > 0 && (
        <div id="search-extra-photos">
          <h3 className="search-extra-heading">Photos</h3>
          <div className="ph-grid">
            {photos.map(p => (
              <div key={p.id} className="ph-card" onClick={() => window.open(`/api/photos/${p.id}/img`, '_blank')}>
                <img className="ph-thumb" src={`/api/photos/${p.id}/img`} alt={p.filename} loading="lazy" />
                <div className="ph-overlay"><span className="ph-name">{p.filename}</span></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {audio.length > 0 && (
        <div id="search-extra-audio">
          <h3 className="search-extra-heading">Audio</h3>
          <div className="au-grid">
            {audio.map(f => (
              <div key={f.id} className="au-card" onClick={() => (window as any).playAudio && (window as any).playAudio(f.id)}>
                <div className="au-card-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                </div>
                <div className="au-card-info">
                  <div className="au-card-title">{f.title || 'Untitled'}</div>
                  <div className="au-card-sub">{f.filename}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {books.length > 0 && (
        <div id="search-extra-books">
          <h3 className="search-extra-heading">Books</h3>
          <div className="bk-grid">
            {books.map(b => (
              <div key={b.id} className="bk-card" onClick={() => window.open(`/api/books/${b.id}/file`, '_blank')}>
                <div className="bk-card-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
                </div>
                <div className="bk-card-info">
                  <div className="bk-card-title">{b.title || b.filename}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
};
