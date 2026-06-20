/** @jsxImportSource preact */
import { useState, useEffect, useRef } from 'preact/hooks';
import { SectionControls } from '../UI/SectionControls';
import { PhotoLightbox } from '../modals/PhotoLightbox';
import { contextMenuState } from '../../store';
import { ScreenshotFile } from '../../types';

export const ScreenshotsView = () => {
  const [screenshots, setScreenshots] = useState<ScreenshotFile[]>([]);
  const [sort, setSort] = useState<'date' | 'name' | 'size'>('date');
  const [search, setSearch] = useState('');
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [slideshowOn, setSlideshowOn] = useState(false);
  const [slideSecs, setSlideSecs] = useState(3);
  const [loading, setLoading] = useState(true);

  const slideTimerRef = useRef<any>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/screenshots')
      .then(r => r.json())
      .then(d => {
        setScreenshots(d);
        setLoading(false);
      })
      .catch(() => {
        setScreenshots([]);
        setLoading(false);
      });
  }, []);

  const getSortedFilteredScreenshots = () => {
    let files = [...screenshots];

    if (sort === 'name') files.sort((a, b) => a.filename.localeCompare(b.filename));
    else if (sort === 'size') files.sort((a, b) => b.size - a.size);
    else files.sort((a, b) => b.date - a.date);

    if (search) {
      const q = search.toLowerCase();
      files = files.filter(f => f.filename.toLowerCase().includes(q));
    }

    return files;
  };

  const files = getSortedFilteredScreenshots();

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
  };

  const closeLightbox = () => {
    setLightboxIdx(null);
    setSlideshowOn(false);
    clearTimeout(slideTimerRef.current);
  };

  const nextScreenshot = () => {
    if (lightboxIdx !== null) {
      setLightboxIdx((lightboxIdx + 1) % files.length);
    }
  };

  const prevScreenshot = () => {
    if (lightboxIdx !== null) {
      setLightboxIdx((lightboxIdx - 1 + files.length) % files.length);
    }
  };

  const deleteScreenshot = async (id: string) => {
    if (!confirm('Delete this screenshot?')) return;
    const w = window as any;
    const r = await fetch(`/api/screenshots/${id}`, { method: 'DELETE' });
    if (r.ok) {
      if (w.toast) w.toast('Screenshot deleted');
      setScreenshots(screenshots.filter(f => f.id !== id));
      if (lightboxIdx !== null) closeLightbox();
    } else {
      if (w.toast) w.toast('Delete failed');
    }
  };

  const openCtx = (e: any, screenshot: ScreenshotFile, idx: number) => {
    e.preventDefault();
    e.stopPropagation();
    contextMenuState.value = {
      visible: true,
      x: e.pageX,
      y: e.pageY,
      type: 'photo',
      data: {
        id: screenshot.id,
        name: screenshot.filename,
        onDelete: () => deleteScreenshot(screenshot.id),
        onOpen: () => openLightbox(idx)
      }
    };
  };

  const downloadScreenshot = (f: ScreenshotFile) => {
    const a = document.createElement('a');
    a.href = `/api/screenshots/${f.id}/download`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Keyboard listeners for lightbox
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (lightboxIdx === null) return;
      if (e.key === 'ArrowLeft') prevScreenshot();
      if (e.key === 'ArrowRight') nextScreenshot();
      if (e.key === 'Escape') closeLightbox();
      if (e.key === ' ') {
        e.preventDefault();
        setSlideshowOn(!slideshowOn);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxIdx, slideshowOn]);

  const currentScreenshot = lightboxIdx !== null ? files[lightboxIdx] : null;

  return (
    <div className="photos-view on" style={{ padding: '20px' }}>
      <div className="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ margin: 0 }}>Screenshots</h1>
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
        />
      </div>

      {loading ? (
        <div className="cv-loading">Loading screenshots…</div>
      ) : files.length === 0 ? (
        <div className="empty-state">No screenshots found</div>
      ) : (
        <div className="ph-grid" id="screenshotsGrid">
          {files.map((f, i) => (
            <div key={f.id} className="ph-card" onClick={() => openLightbox(i)} onContextMenu={(e) => openCtx(e, f, i)}>
              <img className="ph-thumb" src={`/api/screenshots/${f.id}/img`} alt={f.filename} loading="lazy" />
              <div className="ph-overlay">
                <span className="ph-name">{f.filename}</span>
                <button
                  className="ph-del"
                  title="Delete"
                  onClick={(e) => { e.stopPropagation(); deleteScreenshot(f.id); }}
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
        isOpen={lightboxIdx !== null && currentScreenshot !== null}
        onClose={closeLightbox}
        imgUrl={currentScreenshot ? `/api/screenshots/${currentScreenshot.id}/img` : ''}
        title={currentScreenshot ? currentScreenshot.filename : ''}
        sizeF={currentScreenshot ? currentScreenshot.sizeF : ''}
        onPrev={prevScreenshot}
        onNext={nextScreenshot}
        onDelete={currentScreenshot ? () => deleteScreenshot(currentScreenshot.id) : undefined}
        onDownload={currentScreenshot ? () => downloadScreenshot(currentScreenshot) : undefined}
        slideshowOn={slideshowOn}
        onToggleSlideshow={() => setSlideshowOn(!slideshowOn)}
        slideSecs={slideSecs}
        onSlideSecsChange={setSlideSecs}
      />
    </div>
  );
};
