import { currentVideo, currentView, allVideos, showAddToCollectionModal, isMuted } from '../../store';
import { zapOn, zapLock, zapIv, setZapIv, toggleZapLock, stopZapping } from '../../zap';
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
  const [nextUp, setNextUp] = useState<any[]>([]);

  if (!video) return null;

  useEffect(() => {
    if (video) {
      const list = allVideos.value
        .filter(v => v.category === video.category && v.id !== video.id)
        .slice(0, 10);
      setNextUp(list);
    }
  }, [video]);

  const handleDragStart = (e: any, index: number) => {
    e.dataTransfer.setData('text/plain', index.toString());
  };

  const handleDragOver = (e: any) => {
    e.preventDefault();
  };

  const handleDrop = (e: any, index: number) => {
    e.preventDefault();
    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    const newList = [...nextUp];
    const [removed] = newList.splice(fromIndex, 1);
    newList.splice(index, 0, removed);
    setNextUp(newList);
  };

  const removeVideo = (id: string) => {
    setNextUp(nextUp.filter(v => v.id !== id));
  };

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

  const handleEncrypt = async () => {
    if (!video) return;
    if (!confirm(`Encrypt video "${video.name}" and move to Vault?`)) return;

    const r = await fetch(`/api/videos/${video.id}/encrypt`, { method: 'POST' });
    if (r.ok) {
      if ((window as any).toast) (window as any).toast('Video encrypted and moved to Vault');
      currentView.value = 'home';
    } else {
      const err = await r.json();
      if ((window as any).toast) (window as any).toast('Encryption failed: ' + (err.error || 'Unknown error'));
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
              src={video.isVault ? `/api/vault/stream/${video.id}` : `/api/stream/${video.id}`}
              controls
              autoPlay
              muted={isMuted.value}
              style={{ width: '100%', maxHeight: '80vh', background: '#000' }}
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
            <video
              id="video-player-zap"
              controls
              muted={isMuted.value}
              style={{ display: 'none', width: '100%', maxHeight: '80vh', background: '#000' }}
            />
          </div>
          
          {zapOn.value && (
            <div className="mos-ui" style={{ position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: 'rgba(0,0,0,0.8)', padding: '10px 20px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '15px', color: '#fff' }}>
              <div className="mos-c" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>Interval:</span>
                <button onClick={() => setZapIv(-2)} style={{ padding: '2px 8px', cursor: 'pointer', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)' }}>-</button>
                <span>{zapIv.value}s</span>
                <button onClick={() => setZapIv(2)} style={{ padding: '2px 8px', cursor: 'pointer', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)' }}>+</button>
              </div>
              <button onClick={toggleZapLock} style={{ padding: '5px 10px', cursor: 'pointer', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)' }}>
                {zapLock.value ? 'Unlock (Resume Zapping)' : 'Lock to Current'}
              </button>
              <button onClick={stopZapping} style={{ padding: '5px 10px', cursor: 'pointer', background: 'var(--bg3)', border: '1px solid var(--brd)', color: '#ff4a4a' }}>
                Exit Zapping
              </button>
            </div>
          )}

          <div className="player-info">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h1 id="player-title" style={{ margin: 0 }}>{video.name}</h1>
              <div className="player-rating" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '1.4rem' }}>
                {[1, 2, 3, 4, 5].map(i => (
                  <span key={i} style={{ color: i <= (hoveredRating ?? rating ?? 0) ? 'var(--ac)' : 'var(--brd)', cursor: 'pointer' }}
                    onMouseEnter={() => setHoveredRating(i)}
                    onMouseLeave={() => setHoveredRating(null)}
                    onClick={() => updateRating(i === rating ? null : i)}>
                    ★
                  </span>
                ))}
              </div>
            </div>

            <div className="player-meta" style={{ display: 'flex', gap: '15px', color: 'var(--tx3)', fontSize: '0.9rem', marginBottom: '20px' }}>
              <span>{video.category}</span>
              <span>{(video.size / 1024 / 1024).toFixed(1)} MB</span>
              <span>{(video.duration / 60).toFixed(1)}m</span>
            </div>

            <div className="player-info-actions" style={{ display: 'flex', gap: '10px', marginBottom: '25px', flexWrap: 'wrap' }}>
              <button onClick={() => toggleFav()} className={video.fav ? 'st' : ''} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '20px', border: '1px solid var(--brd)', background: 'var(--bg2)', cursor: 'pointer', fontSize: '0.85rem' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill={video.fav ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                <span>Fav</span>
              </button>
              
              <button onClick={() => (window as any).openRenP()} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '20px', border: '1px solid var(--brd)', background: 'var(--bg2)', cursor: 'pointer', fontSize: '0.85rem' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                <span>Rename</span>
              </button>

              <button onClick={() => (window as any).openMovP()} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '20px', border: '1px solid var(--brd)', background: 'var(--bg2)', cursor: 'pointer', fontSize: '0.85rem' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <span>Move</span>
              </button>

              <button onClick={() => showAddToCollectionModal.value = true} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '20px', border: '1px solid var(--brd)', background: 'var(--bg2)', cursor: 'pointer', fontSize: '0.85rem' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="8" y1="6" x2="21" y2="6" />
                  <line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" />
                  <line x1="3" y1="12" x2="3.01" y2="12" />
                  <line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
                <span>Playlist</span>
              </button>

              <button id="pinBtn" onClick={() => (window as any).togglePin()} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '20px', border: '1px solid var(--brd)', background: 'var(--bg2)', cursor: 'pointer', fontSize: '0.85rem' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v20M5 5h14M19 17H5M9 5v12M15 5v12" />
                </svg>
                <span>Pin</span>
              </button>

              <button onClick={() => handleEncrypt()} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '20px', border: '1px solid var(--brd)', background: 'var(--bg2)', cursor: 'pointer', fontSize: '0.85rem' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                <span>Encrypt</span>
              </button>
            </div>

            <div className="player-studio-row" style={{ marginBottom: '15px', display: 'flex', alignItems: 'center' }}>
              <span style={{ color: 'var(--tx3)', marginRight: '10px', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Studio</span>
              {studio ? (
                <span style={{ color: 'var(--ac)', cursor: 'pointer', fontWeight: 500 }} onClick={() => (window as any).openStudio(studio)}>{studio}</span>
              ) : (
                <span style={{ color: 'var(--tx3)', fontSize: '0.85rem' }}>None</span>
              )}
              <button className="p-tag-add-btn" onClick={() => (window as any).openStudioModal(video.id)} style={{ marginLeft: '10px', width: '22px', height: '22px', fontSize: '0.75rem' }}>
                ✎
              </button>
            </div>

            <div className="player-actors-row" style={{ marginBottom: '15px', display: 'flex', alignItems: 'center' }}>
              <span style={{ color: 'var(--tx3)', marginRight: '10px', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Actors</span>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {actors.map(a => (
                  <button key={a} className="p-actor-tag" onClick={() => (window as any).openActor(a)}>
                    <img className="p-actor-ph" src={`/api/actor-photos/${encodeURIComponent(a)}/img`} alt="" onError={(e: any) => e.target.style.display = 'none'} style={{ width: '20px', height: '20px', borderRadius: '50%' }} />
                    {a}
                  </button>
                ))}
                <button className="p-tag-add-btn" onClick={() => (window as any).openActorModal(video.id)} style={{ width: '24px', height: '24px' }}>
                  +
                </button>
              </div>
            </div>

            <div className="player-tags-row" style={{ marginBottom: '20px', display: 'flex', alignItems: 'center' }}>
              <span style={{ color: 'var(--tx3)', marginRight: '10px', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tags</span>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {tags.map(t => (
                  <span key={t} className="p-tag">{t}</span>
                ))}
                <button className="p-tag-add-btn" onClick={() => (window as any).openTagModal(video.id)} style={{ width: '24px', height: '24px' }}>
                  +
                </button>
              </div>
            </div>

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
                {nextUp.length}
              </span>
            </div>
            <div className="playlist-list">
              {nextUp.map((v, index) => (
                <div 
                  key={v.id} 
                  className="playlist-item" 
                  draggable={true}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, index)}
                  style={{ cursor: 'grab', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <div onClick={() => currentVideo.value = v} style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                    <img src={`/api/thumbs/${v.id}/0`} className="pl-thumb" />
                    <div className="pl-info">
                      <div className="pl-name">{v.name}</div>
                      <div className="pl-meta">{(v.duration / 60).toFixed(1)}m</div>
                    </div>
                  </div>
                  <button 
                    className="pl-remove-btn" 
                    onClick={(e) => { e.stopPropagation(); removeVideo(v.id); }}
                    style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: '5px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
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
