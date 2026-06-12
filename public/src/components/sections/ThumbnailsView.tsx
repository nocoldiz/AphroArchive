import { useEffect, useState, useRef, useMemo } from 'preact/hooks';
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

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function init() {
      setLoading(true);
      await loadThumbnails();
      if (allVideos.value.length === 0) await loadVideos();
      setLoading(false);
    }
    init();
  }, []);

  const list = thumbnails.value;

  const allThumbs = useMemo(() => {
    if (!list.length) return [];
    const videoMap = new Map(allVideos.value.map(v => [v.id, v]));
    const baseThumbs: FlatThumb[] = list.flatMap(group =>
      (group.thumbs || []).map((url: string, i: number) => ({ videoId: group.id, url, index: i }))
    );

    let thumbs = baseThumbs.map(t => {
      const video = videoMap.get(t.videoId);
      return {
        ...t,
        title: video?.name || t.videoId,
        date: video?.mtime || 0,
        size: video?.size || 0
      };
    });

    if (sortMode === 'name') {
      thumbs.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortMode === 'size') {
      thumbs.sort((a, b) => b.size - a.size);
    } else {
      thumbs.sort((a, b) => b.date - a.date);
    }

    if (query) {
      const q = query.toLowerCase();
      thumbs = thumbs.filter(t => t.title.toLowerCase().includes(q));
    }

    return thumbs;
  }, [list, allVideos.value, sortMode, query]);

  const prev = () => setLightboxIdx((lightboxIdx - 1 + allThumbs.length) % allThumbs.length);
  const next = () => setLightboxIdx((lightboxIdx + 1) % allThumbs.length);

  useEffect(() => {
    if (slideshowOn && lightboxIdx !== -1 && allThumbs.length > 0) {
      slideTimerRef.current = setTimeout(() => {
        setLightboxIdx((lightboxIdx + 1) % allThumbs.length);
      }, slideSecs * 1000);
    }
    return () => clearTimeout(slideTimerRef.current);
  }, [slideshowOn, lightboxIdx, slideSecs, allThumbs.length]);

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

  if (loading) {
    return (
      <div className="empty-state" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <h3 style={{ color: 'var(--tx2)' }}>Loading thumbnails...</h3>
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div className="empty-state">
        <h3 style={{ color: 'var(--tx2)' }}>No thumbnails found</h3>
        <p style={{ color: 'var(--tx3)' }}>Generate some thumbnails first by browsing your videos.</p>
      </div>
    );
  }

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
          <div key={`${t.videoId}-${t.index}`} className="ph-card" style={{ width: `${appPrefs.value.cardSize}px`, height: 'auto', aspectRatio: '16/9' }} onClick={() => setLightboxIdx(i)}>
            <img className="ph-thumb" src={t.url} alt={`Thumb ${t.index}`} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
