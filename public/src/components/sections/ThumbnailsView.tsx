import { useEffect, useState, useRef } from 'preact/hooks';
import { thumbnails, loadThumbnails, allVideos, loadVideos, appPrefs } from '../../store';
import { SectionControls } from '../UI/SectionControls';
import { PhotoLightbox } from '../modals/PhotoLightbox';

interface FlatThumb {
  videoId: string;
  url: string;
  index: number;
}

export const ThumbnailsView = () => {
  const [lightboxIdx, setLightboxIdx] = useState(-1);
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState('date');
  const [slideshowOn, setSlideshowOn] = useState(false);
  const [slideSecs, setSlideSecs] = useState(3);

  const slideTimerRef = useRef<any>(null);

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

  // Slideshow effect
  useEffect(() => {
    if (slideshowOn && lightboxIdx !== -1) {
      slideTimerRef.current = setTimeout(() => {
        setLightboxIdx((lightboxIdx + 1) % allThumbs.length);
      }, slideSecs * 1000);
    }
    return () => clearTimeout(slideTimerRef.current);
  }, [slideshowOn, lightboxIdx, slideSecs, allThumbs.length]);

  // Keyboard listeners for lightbox
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (lightboxIdx === -1) return;
      if (e.key === 'Escape') setLightboxIdx(-1);
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
      if (e.key === ' ') {
        e.preventDefault();
        setSlideshowOn(!slideshowOn);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxIdx, slideshowOn, allThumbs.length]);

  const currentPhoto = lightboxIdx !== -1 ? allThumbs[lightboxIdx] : null;

  return (
    <div className="thumbnails-view" style={{ padding: '20px' }}>
      <div className="section-header" style={{ marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', display: 'inline' }}>Thumbnails</h2>
          <span style={{ color: 'var(--tx3)', marginLeft: '10px' }}>{allThumbs.length} images</span>
        </div>
        <SectionControls 
          showStarred={false}
          showShuffle={false}
          showSource={false}
          showCardSize={false}
          showFilter={true}
          currentSort={sortMode}
          onSortChange={setSortMode}
          currentFilter={query}
          onFilterChange={setQuery}
          sortOptions={[
            { value: 'date', label: 'Date' },
            { value: 'name', label: 'Name' },
            { value: 'size', label: 'Size' }
          ]}
        />
      </div>

      <div className="ph-grid">
        {allThumbs.map((t, i) => (
          <div key={`${t.videoId}-${t.index}`} className="ph-card" style={{ width: `${appPrefs.value.cardSize}px` }} onClick={() => setLightboxIdx(i)}>
            <img className="ph-thumb" src={t.url} alt={`Thumb ${t.index}`} loading="lazy" />
            <div className="ph-overlay">
              <span className="ph-name">{t.title} {t.index + 1}</span>
            </div>
          </div>
        ))}
      </div>

      <PhotoLightbox
        isOpen={lightboxIdx !== -1 && currentPhoto !== null}
        onClose={() => { setLightboxIdx(-1); setSlideshowOn(false); }}
        imgUrl={currentPhoto ? currentPhoto.url : ''}
        title={currentPhoto ? `${currentPhoto.title} · Image ${currentPhoto.index + 1}` : ''}
        sizeF={''}
        onPrev={prev}
        onNext={next}
        slideshowOn={slideshowOn}
        onToggleSlideshow={() => setSlideshowOn(!slideshowOn)}
        slideSecs={slideSecs}
        onSlideSecsChange={setSlideSecs}
        description={null}
        isAi={false}
        aiPrompt={''}
      />
    </div>
  );
};
