import { useRef, useState, useEffect } from 'preact/hooks';
import { Video } from '../../types';
import { filteredVideos, currentVideo, currentView, selectedVideoIds, videoSelMode, isLoadingVideos } from '../../store';
import { useVideoSelection } from '../../hooks/useVideoSelection';

const openCtx = (e: any) => {
  e.preventDefault();
  // Call legacy context menu if available
  if ((window as any).showContextMenu) {
    (window as any).showContextMenu(e, 'video', { id: e.currentTarget.id.replace('v-', '') });
  }
};

interface VideoCardProps {
  video: Video;
  isSelected: boolean;
  index?: number;
}

export const VideoCard = ({ video, isSelected, index }: VideoCardProps) => {
  const [showVideo, setShowVideo] = useState(false);
  const timerRef = useRef<any>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cardRef.current) return;
    const observer = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) {
          fetch(`/api/thumbs/${video.id}/generate`, { method: 'POST' })
            .catch(() => {});
          observer.unobserve(cardRef.current!);
        }
      }
    }, { rootMargin: '300px' });
    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [video.id]);

  const play = () => {
    currentVideo.value = video;
    currentView.value = 'player';
    if ((window as any).playVideo) (window as any).playVideo(video.id);
  };

  const handleMouseEnter = () => {
    timerRef.current = setTimeout(() => {
      setShowVideo(true);
    }, 250);
  };

  const handleMouseLeave = () => {
    clearTimeout(timerRef.current);
    setShowVideo(false);
  };

  return (
    <div
      className={`video-card fade-in ${isSelected ? 'selected' : ''}`}
      id={`v-${video.id}`}
      onClick={play}
      onContextMenu={openCtx}
      data-id={video.id}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ animationDelay: `${Math.min((index ?? 0) * 35, 420)}ms` }}
      draggable={true}
      onDragStart={(e) => {
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', video.id);
          e.dataTransfer.effectAllowed = 'move';
        }
      }}
      ref={cardRef}
    >
      <div className="video-thumb-wrap" style={{ position: 'relative' }}>
        <img
          src={`/api/thumbs/${video.id}/0`}
          loading="lazy"
          className="video-thumb"
          id={`img-${video.id}`}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        {showVideo && (
          <video
            src={`/api/stream/${video.id}`}
            autoPlay
            muted
            playsInline
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 1 }}
            onLoadedMetadata={(e: any) => {
              const v = e.target;
              v.currentTime = v.duration > 0 ? v.duration / 2 : 0;
            }}
            onPlay={(e: any) => {
              setTimeout(() => {
                try { e.target.pause(); } catch {}
              }, 10000);
            }}
          />
        )}
        {video.duration > 0 && <div className="video-duration" style={{ zIndex: 2 }}>{(video.duration / 60).toFixed(1)}m</div>}
        {video.rating && <div className="video-rating" style={{ zIndex: 2 }}>{'★'.repeat(video.rating)}</div>}
      </div>
      <div className="video-info">
        <div className="video-name" title={video.name}>{video.name}</div>
        <div className="video-meta">{(video.size / 1024 / 1024).toFixed(1)}MB · {video.category}</div>
      </div>
    </div>
  );
};

export const VideoSelBar = () => {
  const count = selectedVideoIds.value.size;
  if (count === 0) return null;

  return (
    <div className="video-sel-bar" style={{ display: 'flex' }}>
      <span id="videoSelCount">{count} video{count !== 1 ? 's' : ''} selected</span>
      <button onClick={(e) => (window as any).showVideoSelMoveMenu && (window as any).showVideoSelMoveMenu(e)}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg> Move to
      </button>
      <button onClick={() => {
        selectedVideoIds.value = new Set();
        videoSelMode.value = false;
      }}>Deselect all</button>
    </div>
  );
};

export const VideoGrid = () => {
  const list = filteredVideos.value;
  const gridRef = useRef<HTMLDivElement>(null);

  useVideoSelection(gridRef);

  if (isLoadingVideos.value) {
    return (
      <div className="video-grid" id="video-grid">
        {Array(12).fill(0).map((_, i) => (
          <div key={i} className="skeleton skeleton-card"></div>
        ))}
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div className="empty-state">
        <h3>No videos found</h3>
        <p>Try a different search or category.</p>
      </div>
    );
  }

  return (
    <>
      <VideoSelBar />
      <div className="video-grid" id="video-grid" ref={gridRef}>
        {list.map((v, i) => (
          <VideoCard
            key={v.id}
            video={v}
            isSelected={selectedVideoIds.value.has(v.id)}
            index={i}
          />
        ))}
      </div>
    </>
  );
};
