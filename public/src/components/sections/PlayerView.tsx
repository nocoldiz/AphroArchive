import { currentVideo, currentView, allVideos, showAddToCollectionModal } from '../../store';
import { useEffect, useRef, useState } from 'preact/hooks';
import { AiComments } from '../UI/AiComments';
import { AddToCollectionModal } from '../modals/AddToCollectionModal';

export const PlayerView = () => {
  const video = currentVideo.value;
  const videoRef = useRef<HTMLVideoElement>(null);

  const [actors, setActors] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [studio, setStudio] = useState<string>('');
  const [rating, setRating] = useState<number | null>(null);
  const [hoveredRating, setHoveredRating] = useState<number | null>(null);
  const [chapters, setChapters] = useState<any[]>([]);
  const [suggested, setSuggested] = useState<any[]>([]);
  const [subtitles, setSubtitles] = useState<any[]>([]);

  if (!video) return null;

  useEffect(() => {
    if (!video || video.isVault) return;
    fetch(`/api/videos/${video.id}`)
      .then(r => r.json())
      .then(d => {
        setActors(d.actors || []);
        setTags(d.tags || []);
        setStudio(d.studio || '');
        setRating(d.video.rating || null);
        setChapters(d.chapters || []);
        setSuggested(d.suggested || []);
      });

    fetch(`/api/subtitles/${video.id}`)
      .then(r => r.json())
      .then(tracks => setSubtitles(tracks))
      .catch(() => { });
  }, [video]);

  const toggleFav = async () => {
    if (!video) return;
    const r = await fetch(`/api/favourites/${video.id}`, { method: 'POST' });
    const d = await r.json();
    currentVideo.value = { ...video, fav: d.fav };
    const w = window as any;
    if (w.toast) w.toast(d.fav ? '★ Added to favourites' : 'Removed from favourites');
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement).isContentEditable) return;

      const vid = videoRef.current;
      if (!vid) return;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          vid.currentTime = Math.max(0, vid.currentTime - 10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          vid.currentTime = Math.min(vid.duration || Infinity, vid.currentTime + 10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          vid.volume = Math.min(1, Math.round((vid.volume + 0.1) * 10) / 10);
          break;
        case 'ArrowDown':
          e.preventDefault();
          vid.volume = Math.max(0, Math.round((vid.volume - 0.1) * 10) / 10);
          break;
        case ' ':
          if (document.activeElement !== vid) {
            e.preventDefault();
            if (vid.paused) vid.play(); else vid.pause();
          }
          break;
        case 'f': case 'F':
          toggleFav();
          break;
        case 'm': case 'M':
          vid.muted = !vid.muted;
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [video, toggleFav]);

  const updateRating = async (stars: number | null) => {
    if (!video) return;
    const r = await fetch(`/api/videos/${video.id}/meta`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: stars })
    });
    if (r.ok) {
      setRating(stars);
    }
  };

  const formatDuration = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':').replace(/^00:/, '');
  };

  const jumpToChapter = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      videoRef.current.play();
    }
  };

  const goBack = () => {
    currentView.value = 'home';
    if ((window as any).goBack) (window as any).goBack();
  };

  return (
    <>
      {showAddToCollectionModal.value && <AddToCollectionModal onClose={() => showAddToCollectionModal.value = false} />}
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
              src={video.isVault ? `/api/vault/stream/${video.id}` : `/stream?id=${video.id}`}
              controls
              autoPlay
            >
              {subtitles.map((t, i) => (
                <track
                  key={t.filename}
                  kind="subtitles"
                  label={t.label}
                  src={`/api/subtitle-file/${video.id}/${encodeURIComponent(t.filename)}`}
                  default={i === 0}
                />
              ))}
            </video>
          </div>

          <div className="player-info">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h1 id="player-title" style={{ margin: 0 }}>{video.name}</h1>
              <div className="player-rating" style={{ display: 'flex', alignItems: 'center', gap: '2px', fontSize: '1.2rem' }}>
                {[1, 2, 3, 4, 5].map(i => (
                  <span key={i} style={{ color: i <= (hoveredRating ?? rating ?? 0) ? 'var(--accent)' : 'var(--border)', cursor: 'pointer' }}
                    onMouseEnter={() => setHoveredRating(i)}
                    onMouseLeave={() => setHoveredRating(null)}
                    onClick={() => updateRating(i === rating ? null : i)}>
                    ★
                  </span>
                ))}
              </div>
            </div>

            <div className="player-meta" style={{ display: 'flex', gap: '15px', color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '15px' }}>
              <span>{video.category}</span>
              <span>{(video.size / 1024 / 1024).toFixed(1)} MB</span>
              <span>{(video.duration / 60).toFixed(1)}m</span>
            </div>

            <div className="player-info-actions" style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
              <PlayerAction label="Fav" icon="star" onClick={() => toggleFav()} />
              <PlayerAction label="Rename" icon="edit" onClick={() => (window as any).openRenP()} />
              <PlayerAction label="Move" icon="folder" onClick={() => (window as any).openMovP()} />
              <PlayerAction label="Playlist" icon="list" onClick={() => showAddToCollectionModal.value = true} />
              <PlayerAction label="Pin" icon="pin" onClick={() => (window as any).togglePin()} />
            </div>

            {studio && (
              <div className="player-studio-row" style={{ marginBottom: '15px' }}>
                <span style={{ color: 'var(--text-muted)', marginRight: '10px' }}>Studio:</span>
                <span style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => (window as any).openStudio(studio)}>{studio}</span>
              </div>
            )}

            {actors.length > 0 && (
              <div className="player-actors-row" style={{ marginBottom: '15px' }}>
                <span style={{ color: 'var(--text-muted)', marginRight: '10px' }}>Actors:</span>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  {actors.map(a => (
                    <button key={a} className="p-actor-tag" onClick={() => (window as any).openActor(a)} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <img className="p-actor-ph" src={`/api/actor-photos/${encodeURIComponent(a)}/img`} alt="" onError={(e: any) => e.target.style.display = 'none'} style={{ width: '20px', height: '20px', borderRadius: '50%' }} />
                      {a}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {tags.length > 0 && (
              <div className="player-tags-row" style={{ marginBottom: '15px' }}>
                <span style={{ color: 'var(--text-muted)', marginRight: '10px' }}>Tags:</span>
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                  {tags.map(t => (
                    <span key={t} className="p-tag" style={{ background: 'var(--bg3)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem' }}>{t}</span>
                  ))}
                </div>
              </div>
            )}

            <AiComments />
          </div>
        </div>

        <div className="pv-side">
          {chapters.length > 0 && (
            <div className="playlist-panel" style={{ marginBottom: '20px' }}>
              <div className="playlist-header">
                <span>Chapters</span>
                <span className="playlist-count">{chapters.length}</span>
              </div>
              <div className="playlist-list">
                {chapters.map(c => (
                  <div key={c.id} className="playlist-item" onClick={() => jumpToChapter(c.time)}>
                    <img src={`/api/thumbs/${video.id}/chapter/${c.id}`} className="pl-thumb" onError={(e: any) => e.target.src = `/api/thumbs/${video.id}/0`} />
                    <div className="pl-info">
                      <div className="pl-name">{c.title}</div>
                      <div className="pl-meta">{formatDuration(c.time)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
