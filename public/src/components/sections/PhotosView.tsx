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
      })
      .catch(() => {
        setPhotos([]);
        setLoading(false);
      });
  }, []);

  const activeFolder = currentPhotoFolder.value;

  const inSubtree = (folder: string) =>
    !activeFolder || folder === activeFolder || folder.startsWith(activeFolder + '/');

  // Direct subfolders of the active folder, with recursive photo counts.
  const getSubfolders = () => {
    const counts = new Map<string, number>();
    for (const f of photos) {
      const folder = f.folder || '';
      if (!inSubtree(folder) || folder === activeFolder) continue;
      const seg = (activeFolder ? folder.slice(activeFolder.length + 1) : folder).split('/')[0];
      counts.set(seg, (counts.get(seg) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count, path: activeFolder ? activeFolder + '/' + name : name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  const getSortedFilteredPhotos = () => {
    // Normal browsing shows only the photos directly in this folder;
    // searching flattens the whole subtree so nested images are findable.
    let files = photos.filter(f => search ? inSubtree(f.folder || '') : (f.folder || '') === activeFolder);

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
  const subfolders = search ? [] : getSubfolders();
  const crumbs = activeFolder ? activeFolder.split('/') : [];
  const goTo = (path: string) => { currentPhotoFolder.value = path; setLightboxIdx(null); };
  const goUp = () => goTo(crumbs.slice(0, -1).join('/'));

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

      <div className="ph-crumbs">
        {activeFolder && (
          <button className="sort-btn ph-back" title="Back" onClick={goUp}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        )}
        <div>
          <span
            className={crumbs.length ? 'crumb crumb--link' : 'crumb'}
            onClick={crumbs.length ? () => goTo('') : undefined}
          >Photos</span>
          {crumbs.map((seg, i) => (
            <span key={i}>
              <span className="crumb-sep"> / </span>
              {i === crumbs.length - 1
                ? <span className="crumb">{seg}</span>
                : <span className="crumb crumb--link" onClick={() => goTo(crumbs.slice(0, i + 1).join('/'))}>{seg}</span>}
            </span>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="cv-loading">Loading photos…</div>
      ) : files.length === 0 && subfolders.length === 0 ? (
        <div className="empty-state">No photos found</div>
      ) : (
        <div className="ph-grid" id="photosGrid">
          {subfolders.map(sf => (
            <div key={'dir:' + sf.path} className="ph-card ph-folder" title={sf.name} onClick={() => goTo(sf.path)}>
              <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="var(--ac)" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              <span className="ph-folder-name">{sf.name}</span>
              <span className="ph-folder-count">{sf.count} photo{sf.count === 1 ? '' : 's'}</span>
            </div>
          ))}
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
