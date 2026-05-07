import { Video } from '../types';
import { filteredVideos, currentVideo, currentView } from '../store';

const openCtx = (e: any) => {
  e.preventDefault();
  // Call legacy context menu if available
  if ((window as any).showContextMenu) {
    (window as any).showContextMenu(e, 'video', { id: e.currentTarget.id.replace('v-', '') });
  }
};

interface VideoCardProps {
  video: Video;
}

export const VideoCard = ({ video }: VideoCardProps) => {
  const play = () => {
    currentVideo.value = video;
    currentView.value = 'player';
    if ((window as any).playVideo) (window as any).playVideo(video.id);
  };

  return (
    <div className="video-card" id={`v-${video.id}`} onClick={play} onContextMenu={openCtx}>
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

export const VideoGrid = () => {
  const list = filteredVideos.value;

  if (list.length === 0) {
    return (
      <div className="empty-state">
        <h3>No videos found</h3>
        <p>Try a different search or category.</p>
      </div>
    );
  }

  return (
    <div className="video-grid" id="video-grid">
      {list.map(v => <VideoCard key={v.id} video={v} />)}
    </div>
  );
};
