import { currentVideo, currentView, allVideos } from '../store';
import { useEffect, useRef } from 'preact/hooks';
import { AiComments } from './AiComments';

export const PlayerView = () => {
  const video = currentVideo.value;
  const videoRef = useRef<HTMLVideoElement>(null);

  if (!video) return null;

  const goBack = () => {
    currentView.value = 'home';
    if ((window as any).goBack) (window as any).goBack();
  };

  return (
    <>
      <button className="back-btn" onClick={goBack}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m15 18-6-6 6-6" />
        </svg>Back
      </button>

      <div className="pv-layout">
        <div className="pv-main">
          <div className="video-player-wrap">
            <video 
              ref={videoRef}
              id="video-player" 
              src={`/stream?id=${video.id}`} 
              controls 
              autoPlay 
            />
          </div>

          <div className="player-info">
            <h1 id="player-title">{video.name}</h1>
            <div className="player-meta">
              <span>{video.category}</span>
              <span>{(video.size / 1024 / 1024).toFixed(1)} MB</span>
              <span>{(video.duration / 60).toFixed(1)}m</span>
            </div>

            <div className="player-info-actions">
              <PlayerAction label="Fav" icon="star" onClick={() => (window as any).togglePStar()} />
              <PlayerAction label="Rename" icon="edit" onClick={() => (window as any).openRenP()} />
              <PlayerAction label="Move" icon="folder" onClick={() => (window as any).openMovP()} />
              <PlayerAction label="Playlist" icon="list" onClick={() => (window as any).openAddToCollection()} />
              <PlayerAction label="Pin" icon="pin" onClick={() => (window as any).togglePin()} />
            </div>

            <AiComments />

            {/* Sub-sections like Actors, Studio, Tags will be added next */}
          </div>
        </div>

        <div className="pv-side">
          <div className="playlist-panel">
            <div className="playlist-header">
              <span>Next Up</span>
              <span className="playlist-count">
                {allVideos.value.filter(v => v.category === video.category && v.id !== video.id).length}
              </span>
            </div>
            <div className="playlist-list">
              {allVideos.value
                .filter(v => v.category === video.category && v.id !== video.id)
                .slice(0, 10)
                .map(v => (
                  <div key={v.id} className="playlist-item" onClick={() => currentVideo.value = v}>
                    <img src={`/api/thumbs/${v.id}/0`} className="pl-thumb" />
                    <div className="pl-info">
                      <div className="pl-name">{v.name}</div>
                      <div className="pl-meta">{(v.duration / 60).toFixed(1)}m</div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

const PlayerAction = ({ label, icon, onClick }: { label: string, icon: string, onClick: () => void }) => (
  <button onClick={onClick}>
    <i className={`icon-${icon}`} />
    <span>{label}</span>
  </button>
);
