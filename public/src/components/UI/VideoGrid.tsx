import { useRef } from 'preact/hooks';
import { Video } from '../../types';
import { filteredVideos, currentVideo, currentView, selectedVideoIds, videoSelMode } from '../../store';
import { useVideoSelection } from '../hooks/useVideoSelection';

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
}

export const VideoCard = ({ video, isSelected }: VideoCardProps) => {
  const play = () => {
    currentVideo.value = video;
    currentView.value = 'player';
    if ((window as any).playVideo) (window as any).playVideo(video.id);
  };

  return (
    <div
      className={`video-card ${isSelected ? 'selected' : ''}`}
      id={`v-${video.id}`}
      onClick={play}
      onContextMenu={openCtx}
      data-id={video.id}
    >
      <div className="video-thumb-wrap">
        <img
          src={`/api/thumbs/${video.id}/0`}
          loading="lazy"
          className="video-thumb"
          id={`img-${video.id}`}
        />
        {video.duration > 0 && <div className="video-duration">{(video.duration / 60).toFixed(1)}m</div>}
        {video.rating && <div className="video-rating">{'★'.repeat(video.rating)}</div>}
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
        {list.map(v => (
          <VideoCard
            key={v.id}
            video={v}
            isSelected={selectedVideoIds.value.has(v.id)}
          />
        ))}
      </div>
    </>
  );
};
