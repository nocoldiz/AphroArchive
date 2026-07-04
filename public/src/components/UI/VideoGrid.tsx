import { formatVideoTitle } from '../../utils';
import { useRef, useState, useEffect, useCallback } from 'preact/hooks';
import { Video } from '../../types';
import { filteredVideos, currentVideo, currentView, selectedVideoIds, videoSelMode, isLoadingVideos, videos, tagModalState, actorModalState, showAddToCollectionModal, thumbBlurMode, contextMenuState, playerNextUp, allVideos, folders, matchLinkFolder, loadVideos, ensureVaultUnlocked, moveModalState, gridViewMode, groupByYear, encryptingVideoIds, skeletonCount } from '../../store';
import { useVideoSelection } from '../../hooks/useVideoSelection';
import { getProgress } from '../../home/progress';
import { getThumbPref } from '../../thumbPref';

// Index of the most recently clicked card — anchor for Shift+click range
// selection, file-manager style. `lastClickedList` records *which* list the
// anchor belongs to so a stale anchor from another view (e.g. browse) can't
// corrupt a range select in a different list (e.g. search results).
let lastClickedIndex = -1;
let lastClickedList: Video[] | null = null;

// ── Hover-preview connection hygiene ─────────────────────────────────
// Each hover preview streams the full file over /api/stream. Browsers cap
// HTTP/1.1 at ~6 connections per origin, so leaked/paused previews starve the
// main player stream (the "infinite spinner until page reload" bug). Two
// rules enforced here:
//   1. At most ONE preview element exists at a time, app-wide.
//   2. A preview that goes away is torn down hard (src removed + load()),
//      which forces the browser to abort the underlying socket.
let activePreviewTeardown: (() => void) | null = null;

function claimPreviewSlot(teardown: () => void) {
  if (activePreviewTeardown && activePreviewTeardown !== teardown) {
    try { activePreviewTeardown(); } catch {}
  }
  activePreviewTeardown = teardown;
}

function releasePreviewSlot(teardown: () => void) {
  if (activePreviewTeardown === teardown) activePreviewTeardown = null;
}

// Abort a media element's network activity and release its socket.
export function releaseMediaElement(v: HTMLMediaElement | null) {
  if (!v) return;
  try { v.pause(); } catch {}
  try { v.removeAttribute('src'); } catch {}
  try { v.load(); } catch {}
}


const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

// Shared IntersectionObserver for thumbnail generation — avoids one observer
// per card when the grid renders hundreds of videos.
let sharedThumbObserver: IntersectionObserver | null = null;
const thumbObserverIds = new WeakMap<Element, string>();

function getThumbObserver() {
  if (!sharedThumbObserver) {
    sharedThumbObserver = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) {
          const id = thumbObserverIds.get(e.target);
          if (id) {
            fetch(`/api/thumbs/${id}/generate`, { method: 'POST' }).catch(() => {});
            sharedThumbObserver!.unobserve(e.target);
            thumbObserverIds.delete(e.target);
          }
        }
      }
    }, { rootMargin: '300px' });
  }
  return sharedThumbObserver;
}

interface VideoCardProps {
  video: Video;
  isSelected: boolean;
  index?: number;
  isRelated?: boolean;
  // The list this card belongs to, used as the basis for Shift+click range
  // selection. Defaults to `filteredVideos` (the browse/folder/tag grid); the
  // universal search view passes its own result list so ranges select across
  // the visible search results rather than the hidden browse list.
  selectionList?: Video[];
}

export const VideoCard = ({ video, isSelected, index, isRelated, selectionList }: VideoCardProps) => {
  const [showVideo, setShowVideo] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [dlQueued, setDlQueued] = useState(false);
  const [thumbIdx, setThumbIdx] = useState(() => getThumbPref(video.id));
  const [linkThumb, setLinkThumb] = useState('');
  const timerRef = useRef<any>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Refresh the card image when the user picks a different preferred thumbnail.
  useEffect(() => {
    setThumbIdx(getThumbPref(video.id));
    const onChange = (e: any) => {
      if (e.detail?.videoId === video.id) setThumbIdx(e.detail.idx);
    };
    window.addEventListener('thumbpref-changed', onChange);
    return () => window.removeEventListener('thumbpref-changed', onChange);
  }, [video.id]);

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
    const el = cardRef.current;
    const observer = getThumbObserver();
    thumbObserverIds.set(el, video.id);
    observer.observe(el);
    return () => {
      observer.unobserve(el);
      thumbObserverIds.delete(el);
    };
  }, [video.id]);

  // Bookmark links often have no cached thumbnail (`img` is null until the
  // background scraper fills it). When such a link card scrolls into view —
  // e.g. in global search results — lazily resolve one via the server's
  // /api/og-thumb endpoint (generated screenshot → OG image, both cached).
  useEffect(() => {
    if (!cardRef.current || !video.isLink || video.img) return;
    const url = video.linkUrl || video.relPath;
    if (!url) return;
    const el = cardRef.current;
    let fetched = false;
    const observer = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting && !fetched) {
          fetched = true;
          observer.disconnect();
          fetch('/api/og-thumb?url=' + encodeURIComponent(url))
            .then(r => r.json())
            .then(d => { if (d && d.img) setLinkThumb(d.img); })
            .catch(() => {});
        }
      }
    }, { rootMargin: '300px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [video.id]);

  const play = () => {
    currentVideo.value = video;
    currentView.value = 'player';
    if ((window as any).playVideo) (window as any).playVideo(video.id);
  };

  const playFromButton = (e: any) => {
    e.stopPropagation();
    play();
  };

  const handleCardClick = (e: any) => {
    const idx = index ?? -1;
    const list = selectionList ?? filteredVideos.value;

    // Shift+click multi-selects and NEVER opens the video. With a valid anchor
    // in the same list it selects the range between the anchor and this card
    // (file-manager style); otherwise it just adds this card and becomes the
    // new anchor. This is what makes "hold Shift and click" work in the
    // folder, tag and search grids.
    if (e.shiftKey && idx >= 0 && !isRelated) {
      e.preventDefault();
      const next = new Set(selectedVideoIds.value);
      if (lastClickedList === list && lastClickedIndex >= 0 && lastClickedIndex < list.length) {
        const [a, b] = lastClickedIndex < idx ? [lastClickedIndex, idx] : [idx, lastClickedIndex];
        for (let i = a; i <= b && i < list.length; i++) next.add(list[i].id);
      } else {
        next.add(video.id);
      }
      selectedVideoIds.value = next;
      videoSelMode.value = next.size > 0;
      lastClickedIndex = idx;
      lastClickedList = list;
      return;
    }
    // Ctrl/Cmd+click toggles a single card into the selection.
    if ((e.ctrlKey || e.metaKey) && idx >= 0 && !isRelated) {
      e.preventDefault();
      const next = new Set(selectedVideoIds.value);
      if (next.has(video.id)) next.delete(video.id); else next.add(video.id);
      selectedVideoIds.value = next;
      videoSelMode.value = next.size > 0;
      lastClickedIndex = idx;
      lastClickedList = list;
      return;
    }
    // While in multi-select mode a plain click toggles rather than opens.
    if (videoSelMode.value && idx >= 0 && !isRelated) {
      const next = new Set(selectedVideoIds.value);
      if (next.has(video.id)) next.delete(video.id); else next.add(video.id);
      selectedVideoIds.value = next;
      videoSelMode.value = next.size > 0;
      lastClickedIndex = idx;
      lastClickedList = list;
      return;
    }
    if (idx >= 0 && !isRelated) { lastClickedIndex = idx; lastClickedList = list; }
    play();
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
    // 400ms debounce: drive-by hovers over a grid row shouldn't open sockets.
    timerRef.current = setTimeout(() => {
      setShowVideo(true);
    }, 400);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    clearTimeout(timerRef.current);
    setShowVideo(false);
  };

  // Hard teardown for this card's preview <video>: abort the stream socket and
  // hide the preview. Registered as the single app-wide active preview so a
  // new hover elsewhere force-closes this one even before unmount runs.
  const previewVidRef = useRef<HTMLVideoElement | null>(null);
  const teardownPreviewRef = useRef<() => void>(() => {});
  teardownPreviewRef.current = () => {
    releaseMediaElement(previewVidRef.current);
    previewVidRef.current = null;
    setShowVideo(false);
  };

  useEffect(() => {
    if (!showVideo) return;
    const teardown = () => teardownPreviewRef.current();
    claimPreviewSlot(teardown);
    return () => {
      releasePreviewSlot(teardown);
      releaseMediaElement(previewVidRef.current);
      previewVidRef.current = null;
    };
  }, [showVideo]);

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
    (window as any).openMov(video.id, video.name, video.catPath || '', !!(video as any).isVault);
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

  const isEncrypting = encryptingVideoIds.value.has(video.id);

  return (
    <div
      className={`video-card fade-in ${isSelected ? 'selected' : ''}`}
      id={`v-${video.id}`}
      onClick={isEncrypting ? undefined : handleCardClick}
      onContextMenu={openCtx}
      data-id={video.id}
      data-index={index}
      tabIndex={0}
      role="button"
      aria-label={video.name}
      onKeyDown={(e: any) => {
        if (e.key === 'Enter' || e.key === ' ') {
          // Don't hijack typing inside the inline panels.
          if ((e.target as HTMLElement).closest('input, textarea')) return;
          e.preventDefault();
          play();
        }
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        animationDelay: `${Math.min((index ?? 0) * 35, 420)}ms`,
        border: isSelected ? '2.5px solid #ff7300' : '1px solid var(--brd)',
        backgroundColor: isSelected ? 'rgba(255, 115, 0, 0.12)' : 'var(--bg2)',
        boxShadow: isSelected ? '0 0 15px rgba(255, 115, 0, 0.45)' : undefined,
        display: isEncrypting ? 'none' : undefined,
        pointerEvents: isEncrypting ? 'none' : undefined
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
        {video.isLink && !(video.img || linkThumb) ? (
          <div
            className="video-thumb link-thumb-placeholder"
            style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--border)' }}
          >
            <img
              src={`https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(video.linkUrl || video.relPath || '')}`}
              width="32"
              height="32"
              loading="lazy"
              alt=""
              style={{ opacity: 0.7 }}
            />
          </div>
        ) : (
          <img
            src={video.isLink ? (video.img || linkThumb) : `/api/thumbs/${video.id}/${thumbIdx}`}
            loading="lazy"
            className="video-thumb"
            id={`img-${video.id}`}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
        {showVideo && !video.isLink && (
          <video
            ref={previewVidRef as any}
            src={`/api/stream/${video.id}`}
            autoPlay
            muted
            playsInline
            preload="metadata"
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
              <button onClick={enqueueNext} title="Add as next" aria-label="Add as next in queue">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
              </button>
              <button onClick={enqueueEnd} title="Add to end" aria-label="Add to end of queue">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5v14M5 19h14"/></svg>
              </button>
            </>
          ) : (
            <>
              {!video.isLink && (
                <button onClick={playFromButton} title="Play" aria-label={`Play ${video.name}`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>
                </button>
              )}
              <button onClick={toggleFav} title="Favourite" aria-label={video.fav ? 'Remove from favourites' : 'Add to favourites'} aria-pressed={video.fav ? 'true' : 'false'} className={video.fav ? 'fav-active' : ''}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill={video.fav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              </button>
              {!video.isLink && (
                <button onClick={enqueueEnd} title="Add to queue" aria-label="Add to play queue">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h13M3 12h13M3 18h9M17 15l4 3-4 3"/></svg>
                </button>
              )}
            </>
          )}
          {video.isLink && (
            <>
              <button
                onClick={openLink}
                title="Open in browser"
                aria-label="Open link in browser"
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
                aria-label={dlQueued ? 'Download queued' : 'Download video'}
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
          <button onClick={openCtx} title="Menu" aria-label="More actions">
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
        {(() => {
          if (video.isLink) return null;
          const p = getProgress(video.id);
          if (!p || p.d <= 0) return null;
          const pct = Math.min(100, (p.t / p.d) * 100);
          if (pct < 1) return null;
          return (
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '3px', background: 'rgba(0,0,0,0.35)', zIndex: 4 }}>
              <div className="card-progress-fill" style={{ '--w': `${pct}%` } as any} />
            </div>
          );
        })()}
      </div>
      <div className="card-body">
        <div className="card-title" title={video.name}>{formatVideoTitle(video.name)}</div>
        <div className="card-meta" style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <span className="card-category">{video.category}</span>
        </div>
      </div>
    </div>
  );
};

const VideoListRow = ({ video, isSelected, index }: { video: Video; isSelected: boolean; index: number }) => {
  const [thumbIdx] = useState(() => getThumbPref(video.id));

  const play = () => {
    currentVideo.value = video;
    currentView.value = 'player';
  };

  const handleClick = (e: any) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey || videoSelMode.value) {
      const next = new Set(selectedVideoIds.value);
      if (next.has(video.id)) next.delete(video.id); else next.add(video.id);
      selectedVideoIds.value = next;
      videoSelMode.value = next.size > 0;
      return;
    }
    if (video.isLink && !video.hasVideo) {
      if (video.linkUrl) window.open(video.linkUrl, '_blank');
      return;
    }
    play();
  };

  const toggleFav = async (e: any) => {
    e.stopPropagation();
    const r = await fetch(`/api/favourites/${video.id}`, { method: 'POST' });
    const d = await r.json();
    const list = [...videos.value];
    const i = list.findIndex(v => v.id === video.id);
    if (i !== -1) { list[i] = { ...list[i], fav: d.fav }; videos.value = list; }
  };

  const date = new Date(video.mtime * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const sizeMb = video.size > 0 ? `${(video.size / 1_048_576).toFixed(1)} MB` : '—';

  return (
    <div
      className={`video-list-row${isSelected ? ' selected' : ''}`}
      onClick={handleClick}
      tabIndex={0}
      onContextMenu={(e: any) => {
        e.preventDefault();
        contextMenuState.value = { visible: true, x: e.pageX, y: e.pageY, type: 'video', data: video };
      }}
    >
      <img className="vl-thumb" src={`/api/thumbs/${video.id}/${thumbIdx}`} loading="lazy" alt="" />
      <div className="vl-title" title={video.name}>{formatVideoTitle(video.name)}</div>
      <div className="vl-dur">{video.duration > 0 ? formatDuration(video.duration) : '—'}</div>
      <div className="vl-size">{sizeMb}</div>
      <div className="vl-rating">{video.rating ? '★'.repeat(video.rating) : '—'}</div>
      <div className="vl-date">{date}</div>
      <button
        type="button"
        className="vl-fav"
        onClick={toggleFav}
        title={video.fav ? 'Remove from favourites' : 'Add to favourites'}
      >
        {video.fav ? '★' : '☆'}
      </button>
    </div>
  );
};

export const VideoSelBar = () => {
  const [showEncryptConfirm, setShowEncryptConfirm] = useState(false);
  const [activePanel, setActivePanel] = useState<null | 'tag' | 'actor' | 'collection'>(null);
  const [bulkInput, setBulkInput] = useState('');
  const [colList, setColList] = useState<{ name: string; count: number }[]>([]);
  const count = selectedVideoIds.value.size;
  if (count === 0) return null;

  const selectedVids = allVideos.value.filter(v => selectedVideoIds.value.has(v.id));
  const linkVids = selectedVids.filter(v => v.isLink);
  const hasLinks = linkVids.length > 0;
  const localVids = selectedVids.filter(v => !v.isLink);

  const togglePanel = (panel: 'tag' | 'actor' | 'collection') => {
    if (activePanel === panel) { setActivePanel(null); return; }
    setBulkInput('');
    if (panel === 'collection') {
      fetch('/api/collections').then(r => r.json()).then(d => setColList(d || [])).catch(() => {});
    }
    setActivePanel(panel);
  };

  const applyBulkTag = async () => {
    const tag = bulkInput.trim();
    if (!tag || !localVids.length) return;
    for (const v of localVids) {
      const existing = v.tags || [];
      if (existing.some(t => t.toLowerCase() === tag.toLowerCase())) continue;
      await fetch(`/api/videos/${v.id}/meta`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: [...existing, tag] }),
      }).catch(() => {});
    }
    (window as any).toast?.(`Tag "${tag}" added to ${localVids.length} video${localVids.length !== 1 ? 's' : ''}`);
    setBulkInput('');
    setActivePanel(null);
  };

  const applyBulkActor = async () => {
    const actor = bulkInput.trim();
    if (!actor || !localVids.length) return;
    for (const v of localVids) {
      const existing = v.actors || [];
      if (existing.some(a => a.toLowerCase() === actor.toLowerCase())) continue;
      await fetch(`/api/videos/${v.id}/meta`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actors: [...existing, actor] }),
      }).catch(() => {});
    }
    (window as any).toast?.(`Actor "${actor}" added to ${localVids.length} video${localVids.length !== 1 ? 's' : ''}`);
    setBulkInput('');
    setActivePanel(null);
  };

  const applyBulkCollection = async (colName: string) => {
    let added = 0;
    for (const v of selectedVids) {
      const r = await fetch(`/api/collections/${encodeURIComponent(colName)}/videos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: v.id }),
      }).catch(() => null);
      if (r?.ok) added++;
    }
    (window as any).toast?.(`Added ${added} video${added !== 1 ? 's' : ''} to "${colName}"`);
    setActivePanel(null);
  };

  const encryptSelected = () => {
    if (!localVids.length) return;
    ensureVaultUnlocked(() => setShowEncryptConfirm(true));
  };

  const runEncryptSelected = () => {
    if (!localVids.length) return;
    ensureVaultUnlocked(async () => {
      const w = window as any;
      const items = localVids.map(v => ({ id: v.id, kind: 'video', name: v.name }));
      const r = await fetch('/api/vault/encrypt-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        if (w.toast) w.toast('Encryption failed: ' + (err.error || 'Unknown error'));
        return;
      }

      // Background job runs server-side; progress is shown in Sync & Background
      // Tasks. Poll here so the grid drops each video as it gets encrypted.
      const orderedIds = items.map(i => i.id);
      const removeDone = (ids: Set<string>) => {
        if (!ids.size) return;
        videos.value = videos.value.filter(x => !ids.has(x.id));
        allVideos.value = allVideos.value.filter(x => !ids.has(x.id));
        selectedVideoIds.value = new Set([...selectedVideoIds.value].filter(id => !ids.has(id)));
      };
      const poll = async () => {
        try {
          const s = await fetch('/api/encryption/status').then(res => res.json());
          const done = s.done || 0;
          if (done > 0) removeDone(new Set(orderedIds.slice(0, done)));
          if (!s.running) {
            clearInterval(intervalId);
            removeDone(new Set(orderedIds));
            videoSelMode.value = selectedVideoIds.value.size > 0;
            if (w.toast) w.toast(s.error ? ('Encryption error: ' + s.error) : `Encrypted ${orderedIds.length} video${orderedIds.length !== 1 ? 's' : ''} into the Vault`);
          }
        } catch {}
      };
      const intervalId = setInterval(poll, 700);
      poll();
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
        const catsList = folders.value || [];
        const match = matchLinkFolder(v.name, catsList);
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
    <>
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
        onClick={() => moveModalState.value = { visible: true, vidIds: [...selectedVideoIds.value], linkUrl: null, currentFolder: '', isVault: selectedVids.some(v => (v as any).isVault) }}
        style={{ background: 'var(--ac)', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '15px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        Move to
      </button>
      {localVids.length > 0 && (
        <button
          onClick={() => togglePanel('tag')}
          style={{ background: activePanel === 'tag' ? 'var(--ac)' : 'rgba(255,255,255,0.1)', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '15px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
          Tag
        </button>
      )}
      {localVids.length > 0 && (
        <button
          onClick={() => togglePanel('actor')}
          style={{ background: activePanel === 'actor' ? 'var(--ac)' : 'rgba(255,255,255,0.1)', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '15px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Actor
        </button>
      )}
      <button
        onClick={() => togglePanel('collection')}
        style={{ background: activePanel === 'collection' ? 'var(--ac)' : 'rgba(255,255,255,0.1)', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '15px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        Playlist
      </button>
      <button
        onClick={() => {
          selectedVideoIds.value = new Set(filteredVideos.value.map(v => v.id));
          videoSelMode.value = true;
        }}
        style={{ background: 'rgba(255,255,255,0.1)', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '15px', cursor: 'pointer' }}
      >
        Select all
      </button>
      <button
        onClick={() => {
          selectedVideoIds.value = new Set();
          videoSelMode.value = false;
          setActivePanel(null);
        }}
        style={{ background: 'rgba(255,255,255,0.1)', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '15px', cursor: 'pointer' }}
      >
        Deselect all
      </button>
    </div>
    {activePanel === 'tag' && (
      <div style={{ position: 'fixed', bottom: '70px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(20,20,20,0.97)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '12px', padding: '14px 16px', display: 'flex', gap: '8px', zIndex: 1001, minWidth: '280px' }}>
        <input
          autoFocus
          value={bulkInput}
          onInput={(e: any) => setBulkInput(e.target.value)}
          onKeyDown={(e: any) => e.key === 'Enter' && applyBulkTag()}
          placeholder="Tag name…"
          style={{ flex: 1, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', color: '#fff', padding: '6px 10px', fontSize: '0.9rem' }}
        />
        <button onClick={applyBulkTag} style={{ background: 'var(--ac)', border: 'none', color: '#fff', borderRadius: '8px', padding: '6px 14px', cursor: 'pointer', fontWeight: 600 }}>Add</button>
      </div>
    )}
    {activePanel === 'actor' && (
      <div style={{ position: 'fixed', bottom: '70px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(20,20,20,0.97)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '12px', padding: '14px 16px', display: 'flex', gap: '8px', zIndex: 1001, minWidth: '280px' }}>
        <input
          autoFocus
          value={bulkInput}
          onInput={(e: any) => setBulkInput(e.target.value)}
          onKeyDown={(e: any) => e.key === 'Enter' && applyBulkActor()}
          placeholder="Actor name…"
          style={{ flex: 1, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', color: '#fff', padding: '6px 10px', fontSize: '0.9rem' }}
        />
        <button onClick={applyBulkActor} style={{ background: 'var(--ac)', border: 'none', color: '#fff', borderRadius: '8px', padding: '6px 14px', cursor: 'pointer', fontWeight: 600 }}>Add</button>
      </div>
    )}
    {activePanel === 'collection' && (
      <div style={{ position: 'fixed', bottom: '70px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(20,20,20,0.97)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '12px', padding: '14px 16px', zIndex: 1001, minWidth: '240px', maxHeight: '220px', overflowY: 'auto' }}>
        <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '10px' }}>Add {count} video{count !== 1 ? 's' : ''} to playlist</div>
        {colList.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.85rem' }}>No playlists yet</div>
        ) : colList.map(col => (
          <div
            key={col.name}
            onClick={() => applyBulkCollection(col.name)}
            style={{ padding: '8px 10px', borderRadius: '7px', cursor: 'pointer', fontSize: '0.87rem', color: '#fff', display: 'flex', justifyContent: 'space-between' }}
            onMouseOver={(e: any) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseOut={(e: any) => e.currentTarget.style.background = 'none'}
          >
            <span>{col.name}</span>
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.78rem' }}>{col.count}</span>
          </div>
        ))}
      </div>
    )}

    {showEncryptConfirm && (
      <div className="modal on" style={{ display: 'flex' }}>
        <div className="modal-content">
          <div className="modal-header">
            <h2>Encrypt Videos</h2>
          </div>
          <div className="modal-body">
            <p>Encrypt {localVids.length} video{localVids.length !== 1 ? 's' : ''} into the Vault?</p>
            <p>Originals will be securely deleted and removed from the public database.</p>
          </div>
          <div className="modal-footer">
            <button class="modal-btn modal-btn--primary" onClick={() => {
              setShowEncryptConfirm(false);
              runEncryptSelected();
            }}>Encrypt</button>
            <button class="modal-btn" onClick={() => setShowEncryptConfirm(false)}>Cancel</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

const CHUNK_SIZE = 60;

export const VideoGrid = () => {
  const list = filteredVideos.value;
  const gridRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [renderLimit, setRenderLimit] = useState(CHUNK_SIZE);
  const prevListRef = useRef(list);

  useVideoSelection(gridRef);

  // Reset chunking when the filtered list itself changes (new search/category/sort/etc.)
  if (prevListRef.current !== list) {
    prevListRef.current = list;
    if (renderLimit !== CHUNK_SIZE) setRenderLimit(CHUNK_SIZE);
  }

  useEffect(() => {
    if (!sentinelRef.current || renderLimit >= list.length) return;
    const observer = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) setRenderLimit(l => l + CHUNK_SIZE);
      }
    }, { rootMargin: '600px' });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [list, renderLimit]);

  // Fade in year/decade group headers as they enter the viewport.
  useEffect(() => {
    if (groupByYear.value === 'none') return;
    const headers = document.querySelectorAll<HTMLElement>('.year-group-header');
    if (!headers.length) return;
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) (e.target as HTMLElement).classList.add('visible'); });
    }, { threshold: 0.15 });
    headers.forEach(h => obs.observe(h));
    return () => obs.disconnect();
  }, [list]);

  // Arrow-key navigation between cards + Escape to clear selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape clears an active multi-selection from anywhere.
      if (e.key === 'Escape' && selectedVideoIds.value.size > 0) {
        const tag = (e.target as HTMLElement).tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea') return;
        selectedVideoIds.value = new Set();
        videoSelMode.value = false;
        return;
      }

      if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      const grid = gridRef.current;
      if (!grid) return;
      const active = document.activeElement as HTMLElement | null;
      // Only drive grid navigation when a card already has focus.
      if (!active || !active.classList.contains('video-card') || !grid.contains(active)) return;

      const cards = Array.from(grid.querySelectorAll<HTMLElement>('.video-card'));
      if (!cards.length) return;
      const cur = cards.indexOf(active);
      if (cur === -1) return;

      // Derive the column count from how many cards share the top row's offsetTop.
      const firstTop = cards[0].offsetTop;
      let cols = cards.filter(c => c.offsetTop === firstTop).length || 1;

      let next = cur;
      if (e.key === 'ArrowRight') next = cur + 1;
      else if (e.key === 'ArrowLeft') next = cur - 1;
      else if (e.key === 'ArrowDown') next = cur + cols;
      else if (e.key === 'ArrowUp') next = cur - cols;

      if (next >= 0 && next < cards.length) {
        e.preventDefault();
        cards[next].focus();
        cards[next].scrollIntoView({ block: 'nearest' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (isLoadingVideos.value) {
    return (
      <div className="video-grid" id="video-grid">
        {Array(skeletonCount.value).fill(0).map((_, i) => (
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

  const visible = list.slice(0, renderLimit);
  const viewMode = gridViewMode.value;
  const groupMode = groupByYear.value;

  const sentinel = renderLimit < list.length ? (
    <div ref={sentinelRef} style={{ textAlign: 'center', padding: '20px', color: 'var(--tx3)', fontSize: '0.85rem' }}>
      Showing {visible.length} of {list.length} — scroll for more
    </div>
  ) : null;

  const countBar = (
    <div style={{ padding: '4px 2px 0', color: 'var(--tx3)', fontSize: '0.8rem' }}>
      {list.length} video{list.length !== 1 ? 's' : ''}
    </div>
  );

  const listHeader = (
    <div className="vl-header">
      <span className="vl-thumb" />
      <span className="vl-title">Title</span>
      <span className="vl-dur">Duration</span>
      <span className="vl-size">Size</span>
      <span className="vl-rating">Rating</span>
      <span className="vl-date">Added</span>
      <span className="vl-fav" />
    </div>
  );

  // ── Grouped rendering ────────────────────────────────────────────────
  if (groupMode !== 'none') {
    const groupMap = new Map<string, Video[]>();
    for (const v of visible) {
      const year = new Date(v.mtime * 1000).getFullYear();
      const label = groupMode === 'decade' ? `${Math.floor(year / 10) * 10}s` : String(year);
      if (!groupMap.has(label)) groupMap.set(label, []);
      groupMap.get(label)!.push(v);
    }
    const groups = [...groupMap.entries()].sort((a, b) => b[0].localeCompare(a[0]));

    return (
      <>
        <VideoSelBar />
        {countBar}
        {groups.map(([label, items]) => (
          <div key={label} className="year-group">
            <h3 className="year-group-header">{label} <span className="year-group-count">({items.length})</span></h3>
            {viewMode === 'list' ? (
              <div className="video-list-view">
                {listHeader}
                {items.map((v, i) => (
                  <VideoListRow key={v.id} video={v} isSelected={selectedVideoIds.value.has(v.id)} index={i} />
                ))}
              </div>
            ) : (
              <div className="video-grid" data-thumb-mode={thumbBlurMode.value}>
                {items.map((v, i) => (
                  <VideoCard key={v.id} video={v} isSelected={selectedVideoIds.value.has(v.id)} index={i} />
                ))}
              </div>
            )}
          </div>
        ))}
        {sentinel}
      </>
    );
  }

  // ── List view ────────────────────────────────────────────────────────
  if (viewMode === 'list') {
    return (
      <>
        <VideoSelBar />
        {countBar}
        <div className="video-list-view" ref={gridRef}>
          {listHeader}
          {visible.map((v, i) => (
            <VideoListRow key={v.id} video={v} isSelected={selectedVideoIds.value.has(v.id)} index={i} />
          ))}
        </div>
        {sentinel}
      </>
    );
  }

  // ── Default grid view ────────────────────────────────────────────────
  return (
    <>
      <VideoSelBar />
      {countBar}
      <div
        className="video-grid"
        id="video-grid"
        ref={gridRef}
        data-thumb-mode={thumbBlurMode.value}
        onContextMenu={(e: any) => {
          if ((e.target as HTMLElement).closest('.video-card')) return;
          e.preventDefault();
          contextMenuState.value = { visible: true, x: e.pageX, y: e.pageY, type: 'grid', data: null };
        }}
      >
        {visible.map((v, i) => (
          <VideoCard key={v.id} video={v} isSelected={selectedVideoIds.value.has(v.id)} index={i} />
        ))}
      </div>
      {sentinel}
    </>
  );
};
