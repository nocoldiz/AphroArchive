/** @jsxImportSource preact */
import { useState, useEffect, useRef } from 'preact/hooks';
import { SectionControls } from '../UI/SectionControls';

interface PhotoFile {
  id: string;
  filename: string;
  size: number;
  sizeF: string;
  date: number;
  isAi?: boolean;
  aiPrompt?: string;
}

export const PhotosView = () => {
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  const [sort, setSort] = useState<'date' | 'name' | 'size'>('date');
  const [search, setSearch] = useState('');
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [slideshowOn, setSlideshowOn] = useState(false);
  const [slideSecs, setSlideSecs] = useState(3);
  const [description, setDescription] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiFilter, setAiFilter] = useState<'all' | 'ai' | 'normal'>('all');

  const slideTimerRef = useRef<any>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/photos')
      .then(r => r.json())
      .then(d => {
        setPhotos(d);
        setLoading(false);
      })
      .catch(() => {
        setPhotos([]);
        setLoading(false);
      });
  }, []);

  const getSortedFilteredPhotos = () => {
    let files = [...photos];
    if (sort === 'name') files.sort((a, b) => a.filename.localeCompare(b.filename));
    else if (sort === 'size') files.sort((a, b) => b.size - a.size);
    else files.sort((a, b) => b.date - a.date);
    
    if (search) {
      const q = search.toLowerCase();
      files = files.filter(f => f.filename.toLowerCase().includes(q));
    }
    
    if (aiFilter === 'ai') files = files.filter(f => f.isAi);
    else if (aiFilter === 'normal') files = files.filter(f => !f.isAi);
    
    return files;
  };

  const files = getSortedFilteredPhotos();

  // Slideshow effect
  useEffect(() => {
    if (slideshowOn && lightboxIdx !== null) {
      slideTimerRef.current = setTimeout(() => {
        setLightboxIdx((lightboxIdx + 1) % files.length);
      }, slideSecs * 1000);
    }
    return () => clearTimeout(slideTimerRef.current);
  }, [slideshowOn, lightboxIdx, slideSecs, files.length]);

  const openLightbox = (idx: number) => {
    setLightboxIdx(idx);
    setDescription(null);
  };

  const closeLightbox = () => {
    setLightboxIdx(null);
    setSlideshowOn(false);
    clearTimeout(slideTimerRef.current);
  };

  const nextPhoto = () => {
    if (lightboxIdx !== null) {
      setLightboxIdx((lightboxIdx + 1) % files.length);
      setDescription(null);
    }
  };

  const prevPhoto = () => {
    if (lightboxIdx !== null) {
      setLightboxIdx((lightboxIdx - 1 + files.length) % files.length);
      setDescription(null);
    }
  };

  const deletePhoto = async (id: string) => {
    if (!confirm('Delete this photo?')) return;
    const w = window as any;
    const r = await fetch(`/api/photos/${id}`, { method: 'DELETE' });
    if (r.ok) {
      if (w.toast) w.toast('Photo deleted');
      setPhotos(photos.filter(f => f.id !== id));
      if (lightboxIdx !== null) closeLightbox();
    } else {
      if (w.toast) w.toast('Delete failed');
    }
  };

  const describePhoto = async (id: string) => {
    setDescription('Analyzing…');
    try {
      const r = await fetch('/api/vision/describe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'photo', id })
      }).then(r => r.json());
      setDescription(r.description || r.error || 'No description returned');
    } catch {
      setDescription('Request failed');
    }
  };

  const downloadPhoto = (f: PhotoFile) => {
    const a = document.createElement('a');
    a.href = `/api/photos/${f.id}/download`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const startMosaic = () => {
    const w = window as any;
    if (!photos.length) {
      if (w.toast) w.toast('No photos to show');
      return;
    }
    if (w.startMosaicWithPhotos) {
      w.startMosaicWithPhotos([...photos]);
    }
  };

  // Keyboard listeners for lightbox
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (lightboxIdx === null) return;
      if (e.key === 'ArrowLeft') prevPhoto();
      if (e.key === 'ArrowRight') nextPhoto();
      if (e.key === 'Escape') closeLightbox();
      if (e.key === ' ') {
        e.preventDefault();
        setSlideshowOn(!slideshowOn);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxIdx, slideshowOn]);

  const currentPhoto = lightboxIdx !== null ? files[lightboxIdx] : null;

  return (
    <div className="photos-view on" style={{ padding: '20px' }}>
      <div className="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ margin: 0 }}>Photos</h1>
        <SectionControls 
          showStarred={false}
          showShuffle={false}
          showSource={false}
          showCardSize={false}
          showFilter={true}
          currentSort={sort}
          onSortChange={(val: any) => setSort(val)}
          currentFilter={search}
          onFilterChange={setSearch}
          sortOptions={[
            { value: 'date', label: 'Date' },
            { value: 'name', label: 'Name' },
            { value: 'size', label: 'Size' }
          ]}
        >
          <span className="sg-sep"></span>
          <button className="sort-btn" onClick={startMosaic}>Mosaic</button>
          <span className="sg-sep"></span>
          <select 
            value={aiFilter} 
            onChange={(e: any) => setAiFilter(e.target.value)} 
            style={{ background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '5px', cursor: 'pointer' }}
          >
            <option value="all">All Photos</option>
            <option value="ai">AI Only</option>
            <option value="normal">No AI</option>
          </select>
        </SectionControls>
      </div>

      {loading ? (
        <div className="cv-loading">Loading photos…</div>
      ) : files.length === 0 ? (
        <div className="empty-state">No photos found</div>
      ) : (
        <div className="ph-grid" id="photosGrid">
          {files.map((f, i) => (
            <div key={f.id} className="ph-card" onClick={() => openLightbox(i)}>
              <img className="ph-thumb" src={`/api/photos/${f.id}/img`} alt={f.filename} loading="lazy" />
              <div className="ph-overlay">
                <span className="ph-name">{f.filename}</span>
                <button 
                  className="ph-del" 
                  title="Delete" 
                  onClick={(e) => { e.stopPropagation(); deletePhoto(f.id); }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox Modal */}
      {lightboxIdx !== null && currentPhoto && (
        <div id="photosLightbox" className="ph-lightbox on">
          <button className="ph-lb-close" onClick={closeLightbox}>×</button>
          
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '80%', position: 'relative' }}>
            <button className="ph-lb-nav ph-lb-prev" onClick={prevPhoto}>‹</button>
            <img id="photosLbImg" src={`/api/photos/${currentPhoto.id}/img`} alt="" />
            <button className="ph-lb-nav ph-lb-next" onClick={nextPhoto}>›</button>
          </div>

          <div className="ph-lb-caption" style={{ color: 'white', marginTop: '20px', textAlign: 'center', width: '80%' }}>
            <div id="photosLbCaption" style={{ fontSize: '1rem', marginBottom: '10px' }}>
              {currentPhoto.filename}  ·  {currentPhoto.sizeF}
            </div>
            
            <div className="ph-lb-actions" style={{ display: 'flex', justifyContent: 'center', gap: '15px', marginBottom: '15px' }}>
              <button id="photosLbSlideBtn" className="ph-lb-action-btn" onClick={() => setSlideshowOn(!slideshowOn)}>
                {slideshowOn ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                )}
                <span>{slideshowOn ? 'Pause' : 'Play'}</span>
              </button>
              <button className="ph-lb-action-btn" onClick={() => downloadPhoto(currentPhoto)}>Download</button>
              <button className="ph-lb-action-btn" onClick={() => describePhoto(currentPhoto.id)}>Describe</button>
            </div>

            {description && (
              <div id="photosLbDesc" style={{ background: 'rgba(255,255,255,0.1)', padding: '10px', borderRadius: '5px', fontSize: '0.9rem', marginBottom: '10px' }}>
                {description}
              </div>
            )}

            {currentPhoto.isAi && currentPhoto.aiPrompt && (
              <div style={{ background: 'rgba(255,255,255,0.1)', padding: '10px', borderRadius: '5px', fontSize: '0.85rem', marginTop: '10px', textAlign: 'left', maxHeight: '150px', overflowY: 'auto' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '5px', color: 'var(--ac)' }}>AI Parameters:</div>
                <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'monospace', color: 'var(--tx2)' }}>{currentPhoto.aiPrompt}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
