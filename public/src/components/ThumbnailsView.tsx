import { useEffect, useState } from 'preact/hooks';
import { thumbnails, loadThumbnails, allVideos, loadVideos } from '../store';

interface FlatThumb {
  videoId: string;
  url: string;
  index: number;
}

export const ThumbnailsView = () => {
  const [lightboxIdx, setLightboxIdx] = useState(-1);
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState('date');

  useEffect(() => {
    loadThumbnails();
    if (allVideos.value.length === 0) loadVideos();
  }, []);

  const list = thumbnails.value;

  if (list.length === 0) {
    return (
      <div className="empty-state">
        <h3 style={{ color: 'var(--tx2)' }}>No thumbnails found</h3>
        <p style={{ color: 'var(--tx3)' }}>Generate some thumbnails first by browsing your videos.</p>
      </div>
    );
  }

  // Flatten the list: each video has multiple thumbs
  const baseThumbs: FlatThumb[] = list.flatMap(group => 
    group.thumbs.map((url: string, i: number) => ({ videoId: group.id, url, index: i }))
  );

  let allThumbs = baseThumbs.map(t => {
    const video = allVideos.value.find(v => v.id === t.videoId);
    return {
      ...t,
      title: video?.name || t.videoId,
      date: video?.mtime || 0,
      size: video?.size || 0
    };
  });

  if (sortMode === 'name') {
    allThumbs.sort((a, b) => a.title.localeCompare(b.title));
  } else if (sortMode === 'size') {
    allThumbs.sort((a, b) => b.size - a.size);
  } else { // date
    allThumbs.sort((a, b) => b.date - a.date);
  }

  if (query) {
    const q = query.toLowerCase();
    allThumbs = allThumbs.filter(t => t.title.toLowerCase().includes(q));
  }

  const prev = () => setLightboxIdx((lightboxIdx - 1 + allThumbs.length) % allThumbs.length);
  const next = () => setLightboxIdx((lightboxIdx + 1) % allThumbs.length);

  // Close lightbox on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (lightboxIdx === -1) return;
      if (e.key === 'Escape') setLightboxIdx(-1);
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxIdx, allThumbs.length]);

  return (
    <div className="thumbnails-view" style={{ padding: '20px' }}>
      <div className="section-header" style={{ marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', display: 'inline' }}>Thumbnails</h2>
          <span style={{ color: 'var(--tx3)', marginLeft: '10px' }}>{allThumbs.length} images</span>
        </div>
        <div className="section-controls" style={{ display: 'flex', gap: '5px' }}>
          <button className={`sort-btn ${sortMode === 'date' ? 'on' : ''}`} onClick={() => setSortMode('date')}>Date</button>
          <button className={`sort-btn ${sortMode === 'name' ? 'on' : ''}`} onClick={() => setSortMode('name')}>Name</button>
          <button className={`sort-btn ${sortMode === 'size' ? 'on' : ''}`} onClick={() => setSortMode('size')}>Size</button>
        </div>
      </div>

      <div className="prompts-search-bar" style={{ marginBottom: '20px' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--tx3)' }}>
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input 
          type="text" 
          placeholder="Filter thumbnails..." 
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--tx)', flex: 1, fontSize: '0.85rem' }}
        />
      </div>

      <div className="ph-grid">
        {allThumbs.map((t, i) => (
          <div key={`${t.videoId}-${t.index}`} className="ph-card" onClick={() => setLightboxIdx(i)}>
            <img className="ph-thumb" src={t.url} alt={`Thumb ${t.index}`} loading="lazy" />
            <div className="ph-overlay">
              <span className="ph-name">{t.title} {t.index + 1}</span>
            </div>
          </div>
        ))}
      </div>

      {lightboxIdx !== -1 && (
        <div className="ph-lightbox on" onClick={() => setLightboxIdx(-1)} style={{ zIndex: 10000 }}>
          <button className="ph-lb-nav ph-lb-prev" onClick={(e) => { e.stopPropagation(); prev(); }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <img 
            id="photosLbImg" 
            src={allThumbs[lightboxIdx].url} 
            alt="Lightbox" 
            onClick={(e) => e.stopPropagation()} 
          />
          <button className="ph-lb-nav ph-lb-next" onClick={(e) => { e.stopPropagation(); next(); }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <div className="ph-lb-caption">
            {allThumbs[lightboxIdx].title} · Image {allThumbs[lightboxIdx].index + 1}
          </div>
          <button className="ph-lb-close" onClick={() => setLightboxIdx(-1)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};
