/** @jsxImportSource preact */
import { useState, useEffect, useRef } from 'preact/hooks';
import { SectionControls } from '../UI/SectionControls';
import { PhotoLightbox } from '../modals/PhotoLightbox';
import { contextMenuState, currentPhotoFolder } from '../../store';
import { PhotoFile } from '../../types';

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
        if (!currentPhotoFolder.value) {
          const folderSet = new Set<string>();
          for (const f of d as PhotoFile[]) {
            if (!f.folder) continue;
            const parts = f.folder.split('/');
            let cur = '';
            for (const part of parts) {
              cur = cur ? cur + '/' + part : part;
              folderSet.add(cur);
            }
          }
          const first = [...folderSet].sort()[0];
          if (first) currentPhotoFolder.value = first;
        }
      })
      .catch(() => {
        setPhotos([]);
        setLoading(false);
      });
  }, []);

  const activeFolder = currentPhotoFolder.value;

  const getSortedFilteredPhotos = () => {
    let files = [...photos];

    if (activeFolder) {
      const fl = activeFolder.toLowerCase();
      files = files.filter(f => {
        const folder = (f.folder || '').toLowerCase();
        return folder === fl || folder.startsWith(fl + '/');
      });
    }

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

  const openCtx = (e: any, photo: PhotoFile, idx: number) => {
    e.preventDefault();
    e.stopPropagation();
    contextMenuState.value = {
      visible: true,
      x: e.pageX,
      y: e.pageY,
      type: 'photo',
      data: {
        id: photo.id,
        name: photo.filename,
        onDelete: () => deletePhoto(photo.id),
        onOpen: () => openLightbox(idx)
      }
    };
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
            <div key={f.id} className="ph-card" onClick={() => openLightbox(i)} onContextMenu={(e) => openCtx(e, f, i)}>
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
      <PhotoLightbox
        isOpen={lightboxIdx !== null && currentPhoto !== null}
        onClose={closeLightbox}
        imgUrl={currentPhoto ? `/api/photos/${currentPhoto.id}/img` : ''}
        title={currentPhoto ? currentPhoto.filename : ''}
        sizeF={currentPhoto ? currentPhoto.sizeF : ''}
        onPrev={prevPhoto}
        onNext={nextPhoto}
        onDelete={currentPhoto ? () => deletePhoto(currentPhoto.id) : undefined}
        onDownload={currentPhoto ? () => downloadPhoto(currentPhoto) : undefined}
        onDescribe={currentPhoto ? () => describePhoto(currentPhoto.id) : undefined}
        slideshowOn={slideshowOn}
        onToggleSlideshow={() => setSlideshowOn(!slideshowOn)}
        slideSecs={slideSecs}
        onSlideSecsChange={setSlideSecs}
        description={description}
        isAi={currentPhoto ? currentPhoto.isAi : false}
        aiPrompt={currentPhoto ? currentPhoto.aiPrompt : ''}
      />
    </div>
  );
};
