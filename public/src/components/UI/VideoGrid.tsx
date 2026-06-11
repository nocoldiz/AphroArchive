import { useRef, useState, useEffect, useCallback } from 'preact/hooks';
import { Video } from '../../types';
import { filteredVideos, currentVideo, currentView, selectedVideoIds, videoSelMode, isLoadingVideos, videos, tagModalState, actorModalState, showAddToCollectionModal, thumbBlurMode, contextMenuState, playerNextUp, allVideos, categories, matchLinkCat, loadVideos, ensureVaultUnlocked } from '../../store';
import { useVideoSelection } from '../../hooks/useVideoSelection';



const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

interface VideoCardProps {
  video: Video;
  isSelected: boolean;
  index?: number;
  isRelated?: boolean;
}

export const VideoCard = ({ video, isSelected, index, isRelated }: VideoCardProps) => {
  const [showVideo, setShowVideo] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [dlQueued, setDlQueued] = useState(false);
  const timerRef = useRef<any>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const openLink = useCallback((e: any) => {
    e.stopPropagation();
    if (video.linkUrl) {
      window.open(video.linkUrl, '_blank');
    }
  }, [video]);

  const downloadLink = useCallback(async (e: any) => {
    e.stopPropagation();
    if (dlQueued) return;
    const url = video.linkUrl || video.relPath;
    if (!url) return;

    // Pick target category: use catPath unless it's the virtual 'Links' bucket
    const rawCat = video.catPath || '';
    const cat = (rawCat === 'Links' || rawCat === 'Uncategorized' || !rawCat) ? '' : rawCat;

    setDlQueued(true);
    try {
      await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, category: cat }),
      });
      if ((window as any).toast) (window as any).toast('Download queued');
    } catch {
      setDlQueued(false);
    }
  }, [video, dlQueued]);

  const openCtx = (e: any) => {
    e.preventDefault();
    e.stopPropagation();
    contextMenuState.value = {
      visible: true,
      x: e.pageX,
      y: e.pageY,
      type: 'video',
      data: video
    };
  };

  const enqueueNext = (e: any) => {
    e.stopPropagation();
    playerNextUp.value = [video, ...playerNextUp.value];
    if ((window as any).toast) (window as any).toast('Added to queue as next');
  };

  const enqueueEnd = (e: any) => {
    e.stopPropagation();
    playerNextUp.value = [...playerNextUp.value, video];
    if ((window as any).toast) (window as any).toast('Added to end of queue');
  };

  useEffect(() => {
    if (!cardRef.current || video.isLink) return;
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
    setIsHovered(true);
    timerRef.current = setTimeout(() => {
      setShowVideo(true);
    }, 250);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    clearTimeout(timerRef.current);
    setShowVideo(false);
  };

  const toggleFav = async (e: any) => {
    e.stopPropagation();
    const r = await fetch(`/api/favourites/${video.id}`, { method: 'POST' });
    const d = await r.json();
    
    const currentVideos = [...videos.value];
    const idx = currentVideos.findIndex(v => v.id === video.id);
    if (idx !== -1) {
      currentVideos[idx] = { ...currentVideos[idx], fav: d.fav };
      videos.value = currentVideos;
    }
    
    const w = window as any;
    if (w.toast) w.toast(d.fav ? '★ Added to favourites' : 'Removed from favourites');
  };

  const handleRename = (e: any) => {
    e.stopPropagation();
    (window as any).openRen(video.id, video.name);
  };

  const handleMove = (e: any) => {
    e.stopPropagation();
    (window as any).openMov(video.id, video.name, video.catPath || '');
  };

  const handlePlaylist = (e: any) => {
    e.stopPropagation();
    currentVideo.value = video;
    showAddToCollectionModal.value = true;
  };

  const handleTag = (e: any) => {
    e.stopPropagation();
    tagModalState.value = { visible: true, vidId: video.id, linkUrl: null };
  };

  const handleActor = (e: any) => {
    e.stopPropagation();
    actorModalState.value = { visible: true, vidId: video.id };
  };

  const handleEncrypt = async (e: any) => {
    e.stopPropagation();
    if (!confirm(`Encrypt video "${video.name}" and move to Vault?`)) return;

    const r = await fetch(`/api/videos/${video.id}/encrypt`, { method: 'POST' });
    if (r.ok) {
      if ((window as any).toast) (window as any).toast('Video encrypted and moved to Vault');
      videos.value = videos.value.filter(v => v.id !== video.id);
    } else {
      const err = await r.json();
      if ((window as any).toast) (window as any).toast('Encryption failed: ' + (err.error || 'Unknown error'));
    }
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
      style={{
        animationDelay: `${Math.min((index ?? 0) * 35, 420)}ms`,
        border: isSelected ? '2.5px solid #ff7300' : '1px solid var(--brd)',
        backgroundColor: isSelected ? 'rgba(255, 115, 0, 0.12)' : 'var(--bg2)',
        boxShadow: isSelected ? '0 0 15px rgba(255, 115, 0, 0.45)' : undefined
      }}
      draggable={true}
      onDragStart={(e) => {
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', video.id);
          e.dataTransfer.effectAllowed = 'move';
        }
      }}
      ref={cardRef}
    >
      <div className="card-thumb">
        <img
          src={video.isLink ? (video.img || '') : `/api/thumbs/${video.id}/0`}
          loading="lazy"
          className="video-thumb"
          id={`img-${video.id}`}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        {showVideo && !video.isLink && (
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
        
        <div className="thumb-actions" style={{
          position: 'absolute',
          top: '5px',
          right: '5px',
          display: 'flex',
          flexDirection: 'column',
          gap: '5px',
          zIndex: 3,
          opacity: isHovered ? 1 : 0,
          transform: isHovered ? 'translateY(0)' : 'translateY(-5px)',
          transition: 'opacity 0.2s ease, transform 0.2s ease'
        }}>
          {isRelated ? (
            <>
              <button onClick={enqueueNext} title="Add as next">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
              </button>
              <button onClick={enqueueEnd} title="Add to end">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5v14M5 19h14"/></svg>
              </button>
            </>
          ) : (
            <button onClick={toggleFav} title="Favourite" className={video.fav ? 'fav-active' : ''}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill={video.fav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            </button>
          )}
          {video.isLink && (
            <>
              <button
                onClick={openLink}
                title="Open in browser"
                style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', color: 'white' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
              </button>
              <button
                onClick={downloadLink}
                title={dlQueued ? 'Download queued…' : 'Download video'}
                className={dlQueued ? 'fav-active' : ''}
                style={{ opacity: dlQueued ? 0.5 : 1 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </button>
            </>
          )}
          <button onClick={openCtx} title="Menu">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
          </button>
        </div>

        <div style={{ position: 'absolute', bottom: '5px', left: '5px', right: '5px', display: 'flex', justifyContent: 'space-between', zIndex: 2 }}>
          {video.size > 0 && (
            <div style={{ background: 'rgba(0,0,0,0.6)', color: 'white', padding: '2px 5px', borderRadius: '3px', fontSize: '0.75rem' }}>
              {(video.size / 1024 / 1024).toFixed(1)} MB
            </div>
          )}
          {video.duration > 0 && (
            <div style={{ background: 'rgba(0,0,0,0.6)', color: 'white', padding: '2px 5px', borderRadius: '3px', fontSize: '0.75rem' }}>
              {formatDuration(video.duration)}
            </div>
          )}
        </div>

        {video.rating && <div className="rating-badge" style={{ zIndex: 2 }}>{'★'.repeat(video.rating)}</div>}
      </div>
      <div className="card-body">
        <div className="card-title" title={video.name}>{video.name}</div>
        <div className="card-meta" style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <span className="card-category">{video.category}</span>
        </div>
      </div>
    </div>
  );
};

export const VideoSelBar = () => {
  const count = selectedVideoIds.value.size;
  if (count === 0) return null;

  const selectedVids = allVideos.value.filter(v => selectedVideoIds.value.has(v.id));
  const linkVids = selectedVids.filter(v => v.isLink);
  const hasLinks = linkVids.length > 0;
  const localVids = selectedVids.filter(v => !v.isLink);

  const encryptSelected = () => {
    if (!localVids.length) return;
    ensureVaultUnlocked(async () => {
      if (!confirm(`Encrypt ${localVids.length} video${localVids.length !== 1 ? 's' : ''} into the Vault?\nOriginals will be securely deleted and removed from the public database.`)) return;
      const w = window as any;
      let ok = 0;
      for (const v of localVids) {
        try {
          const r = await fetch(`/api/videos/${v.id}/encrypt`, { method: 'POST' });
          if (r.ok) {
            ok++;
            // Instant gallery update — remove each file as it is encrypted
            videos.value = videos.value.filter(x => x.id !== v.id);
            allVideos.value = allVideos.value.filter(x => x.id !== v.id);
            selectedVideoIds.value = new Set([...selectedVideoIds.value].filter(id => id !== v.id));
          }
        } catch {}
      }
      videoSelMode.value = selectedVideoIds.value.size > 0;
      if (w.toast) w.toast(`Encrypted ${ok}/${localVids.length} video${localVids.length !== 1 ? 's' : ''} into the Vault`);
    });
  };

  const deleteSelected = async () => {
    if (!confirm(`Delete ${count} video${count !== 1 ? 's' : ''} from disk?\nThis action cannot be undone.`)) return;
    const ids = [...selectedVideoIds.value];
    let deleted = 0;
    for (const id of ids) {
      try {
        const r = await fetch(`/api/videos/${id}`, { method: 'DELETE' });
        if (r.ok) deleted++;
      } catch {}
    }
    videos.value = videos.value.filter(v => !selectedVideoIds.value.has(v.id));
    allVideos.value = allVideos.value.filter(v => !selectedVideoIds.value.has(v.id));
    selectedVideoIds.value = new Set();
    videoSelMode.value = false;
    if ((window as any).toast) (window as any).toast(`Deleted ${deleted} video${deleted !== 1 ? 's' : ''}`);
  };

  const downloadSelected = async () => {
    if (!linkVids.length) return;

    let successCount = 0;
    for (const v of linkVids) {
      let targetCat = v.category || '';
      if (targetCat === 'Links' || targetCat === 'Uncategorized' || !targetCat) {
        const catsList = categories.value || [];
        const match = matchLinkCat(v.name, catsList);
        if (match && match.catPath !== 'Links') {
          targetCat = match.catPath;
        } else {
          targetCat = '';
        }
      }

      try {
        const r = await fetch('/api/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: v.linkUrl || v.relPath, category: targetCat })
        });
        const d = await r.json();
        if (d.ok) successCount++;
      } catch (e) {}
    }

    if ((window as any).toast) {
      (window as any).toast(`Enqueued ${successCount} downloads!`);
    }

    // Reset selection
    selectedVideoIds.value = new Set();
    videoSelMode.value = false;
  };

  return (
    <div className="video-sel-bar" style={{ 
      display: 'flex', 
      alignItems: 'center', 
      gap: '15px',
      background: 'rgba(0, 0, 0, 0.8)',
      backdropFilter: 'blur(10px)',
      padding: '10px 20px',
      borderRadius: '30px',
      position: 'fixed',
      bottom: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 1000,
      color: 'white',
      boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      border: '1px solid rgba(255,255,255,0.1)'
    }}>
      <span id="videoSelCount" style={{ fontWeight: 'bold' }}>{count} video{count !== 1 ? 's' : ''} selected</span>
      
      <button
        onClick={deleteSelected}
        style={{ background: '#c0392b', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '15px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </svg>
        Delete ({count})
      </button>
      {localVids.length > 0 && (
        <button
          onClick={encryptSelected}
          style={{ background: '#7c3aed', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '15px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}
          title="Encrypt selected videos into the Vault"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          Encrypt ({localVids.length})
        </button>
      )}
      {hasLinks && (
        <button
          onClick={downloadSelected}
          style={{ background: '#ff7300', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '15px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download ({linkVids.length})
        </button>
      )}

      <button 
        onClick={(e) => (window as any).showVideoSelMoveMenu && (window as any).showVideoSelMoveMenu(e)}
        style={{ background: 'var(--ac)', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '15px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        Move to
      </button>
      <button 
        onClick={() => {
          selectedVideoIds.value = new Set();
          videoSelMode.value = false;
        }}
        style={{ background: 'rgba(255,255,255,0.1)', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '15px', cursor: 'pointer' }}
      >
        Deselect all
      </button>
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
      <div className="video-grid" id="video-grid" ref={gridRef} data-thumb-mode={thumbBlurMode.value}>
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
