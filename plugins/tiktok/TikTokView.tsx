import { useState, useEffect, useRef, useMemo, useCallback } from 'preact/hooks';
import { allVideos, currentVideo, currentView, currentFolder, currentTag, linkVidIds } from '../../public/src/store';
import { Video } from '../../public/src/types';
import './TikTokView.css';

const MAX_DURATION = 60;

const COLORS = ['#e84040', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#a855f7'];

const hashId = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const strColor = (s: string) => COLORS[hashId(s) % COLORS.length];
const initial = (s: string) => (s || '?').charAt(0).toUpperCase();
// Any non-landscape clip counts — portrait 9:16, 4:5, 3:4, and square 1:1
// alike — so the feed isn't limited to strict phone-shot 9:16 videos.
const isVertical = (v: any) => !!(v.width && v.height && v.height >= v.width);
const streamOf = (v: any) => v.isVault ? `/api/vault/stream/${v.id}` : `/api/stream/${v.id}`;

const HeartIcon = ({ size = 30 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
);

export const TikTokView = () => {
  const [hiddenTerms, setHiddenTerms] = useState<string[]>([]);
  const [seed, setSeed] = useState(() => hashId(String(performance.now())));
  const [activeIdx, setActiveIdx] = useState(0);
  const [muted, setMuted] = useState(() => localStorage.getItem('tiktok_muted') !== '0');
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const feedRef = useRef<HTMLDivElement>(null);
  const wheelLock = useRef(0);

  useEffect(() => {
    fetch('/api/settings/lists')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.hidden)) setHiddenTerms(d.hidden); })
      .catch(() => {});
  }, []);

  // Favourited library videos start out liked.
  useEffect(() => {
    const favIds = allVideos.value.filter(v => v.fav).map(v => v.id);
    if (favIds.length) setLikedIds(prev => new Set([...prev, ...favIds]));
  }, [allVideos.value]);

  const { items, verticalOnly } = useMemo(() => {
    const bms = linkVidIds.value;
    let shorts = allVideos.value.filter(v =>
      !(v as any).isLink && !bms.has(v.id) &&
      (v.duration || 0) > 0 && (v.duration || 0) <= MAX_DURATION);

    if (hiddenTerms.length) {
      shorts = shorts.filter(v => {
        const name = (v.name || '').toLowerCase();
        const cat = (v.category || '').toLowerCase();
        const tags = v.tags || [];
        return !hiddenTerms.some(term => {
          const t = term.toLowerCase();
          return name.includes(t) || cat === t || cat.startsWith(t + '/') || cat.startsWith(t + '\\') ||
            tags.some(tag => tag.toLowerCase() === t);
        });
      });
    }

    const vertical = shorts.filter(isVertical);
    // Durations/dimensions come from the thumbnail cache; libraries without
    // vertical clips still get a feed of everything under a minute.
    const pool = vertical.length ? vertical : shorts;
    const sorted = [...pool].sort((a, b) => hashId(a.id + seed) - hashId(b.id + seed));
    return { items: sorted, verticalOnly: vertical.length > 0 };
  }, [allVideos.value, hiddenTerms, seed]);

  // Which slide fills the viewport drives playback.
  useEffect(() => {
    const feed = feedRef.current;
    if (!feed) return;
    const obs = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.intersectionRatio >= 0.6) {
          const idx = Number((e.target as HTMLElement).dataset.idx);
          if (Number.isFinite(idx)) setActiveIdx(idx);
        }
      }
    }, { root: feed, threshold: [0.6] });
    feed.querySelectorAll('.tt-slide').forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, [items.length]);

  useEffect(() => {
    const v = items[activeIdx];
    if (!v) return;
    fetch(`/api/history/${encodeURIComponent(v.id)}`, { method: 'POST' }).catch(() => {});
  }, [activeIdx, items]);

  const goTo = useCallback((idx: number) => {
    const feed = feedRef.current;
    if (!feed || !items.length) return;
    const n = ((idx % items.length) + items.length) % items.length;
    const el = feed.children[n] as HTMLElement | undefined;
    // Wrapping from the last clip back to the first would smooth-scroll past
    // the entire feed — jump instantly instead.
    el?.scrollIntoView({ behavior: Math.abs(n - idx) > 1 ? 'auto' : 'smooth' });
  }, [items.length]);

  const exit = () => { currentView.value = 'hub'; };

  const toggleMute = () => {
    setMuted(m => {
      localStorage.setItem('tiktok_muted', m ? '0' : '1');
      return !m;
    });
  };

  const toggleLike = (id: string, forceOn = false) => {
    if (forceOn && likedIds.has(id)) return;
    setLikedIds(prev => {
      const next = new Set(prev);
      if (next.has(id) && !forceOn) next.delete(id); else next.add(id);
      return next;
    });
    fetch(`/api/favourites/${encodeURIComponent(id)}`, { method: 'POST' }).catch(() => {});
  };

  const openInPlayer = (v: Video) => {
    currentVideo.value = v;
    currentView.value = 'player';
  };

  const openCategory = (v: any) => {
    currentFolder.value = v.catPath || v.category || '';
    currentTag.value = null;
    currentView.value = 'browse';
  };

  const shareClip = async (id: string) => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/video/${id}`);
      const w = window as any;
      if (w.toast) w.toast('Link copied to clipboard');
    } catch {}
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exit();
      else if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); goTo(activeIdx + 1); }
      else if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); goTo(activeIdx - 1); }
      else if (e.key.toLowerCase() === 'm') toggleMute();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [activeIdx, goTo]);

  // One wheel tick = one clip; scroll-snap alone lets small deltas settle back.
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const now = Date.now();
    if (now - wheelLock.current < 350) return;
    wheelLock.current = now;
    if (e.deltaY > 0) goTo(activeIdx + 1);
    else if (e.deltaY < 0) goTo(activeIdx - 1);
  };

  const shuffle = () => {
    setSeed(hashId(String(performance.now())));
    setActiveIdx(0);
    if (feedRef.current) feedRef.current.scrollTop = 0;
  };

  if (!items.length) {
    return (
      <div className="tt-app">
        <div className="tt-empty">
          <div className="tt-empty-icon">🎬</div>
          <h3>No short clips found</h3>
          <p>TikTok mode plays vertical videos under a minute. Durations come from thumbnails — generate them in Settings → Thumbnails if the feed stays empty.</p>
          <button className="tt-empty-btn" onClick={exit}>Back to Archive</button>
        </div>
      </div>
    );
  }

  return (
    <div className="tt-app">
      <div className="tt-topbar">
        <button className="tt-top-btn" title="Exit (Esc)" onClick={exit}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
        <span className="tt-title">Shorts</span>
        <span className="tt-counter">{activeIdx + 1} / {items.length}</span>
        <button className="tt-top-btn" title="Shuffle" onClick={shuffle}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /></svg>
        </button>
      </div>

      {!verticalOnly && <div className="tt-notice">No vertical clips found — showing everything under a minute</div>}

      <div className="tt-feed" ref={feedRef as any} onWheel={onWheel as any}>
        {items.map((v, i) => (
          <Slide
            key={v.id}
            v={v}
            idx={i}
            active={i === activeIdx}
            near={Math.abs(i - activeIdx) <= 1}
            muted={muted}
            liked={likedIds.has(v.id)}
            onLike={toggleLike}
            onEnded={() => goTo(i + 1)}
            onToggleMute={toggleMute}
            onOpen={() => openInPlayer(v)}
            onOpenCategory={() => openCategory(v)}
            onShare={() => shareClip(v.id)}
          />
        ))}
      </div>
    </div>
  );
};

const Slide = ({ v, idx, active, near, muted, liked, onLike, onEnded, onToggleMute, onOpen, onOpenCategory, onShare }: any) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [heart, setHeart] = useState(0);
  const tapTimer = useRef<any>(null);
  const heartTimer = useRef<any>(null);
  const errTimer = useRef<any>(null);

  const category = v.category || 'Uncategorized';
  const color = strColor(category);
  const vertical = isVertical(v);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (active) {
      try { vid.currentTime = 0; } catch {}
      setPaused(false);
      setProgress(0);
      vid.play().catch(() => {});
    } else {
      vid.pause();
      setPaused(false);
    }
  }, [active, near]);

  useEffect(() => () => {
    clearTimeout(tapTimer.current);
    clearTimeout(heartTimer.current);
    clearTimeout(errTimer.current);
  }, []);

  const togglePause = () => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) { vid.play().catch(() => {}); setPaused(false); }
    else { vid.pause(); setPaused(true); }
  };

  const burstLike = () => {
    onLike(v.id, true);
    setHeart((h: number) => h + 1);
    clearTimeout(heartTimer.current);
    heartTimer.current = setTimeout(() => setHeart(0), 900);
  };

  // Single tap pauses, double tap likes — the timer disambiguates the two.
  const onTap = () => {
    if (tapTimer.current) {
      clearTimeout(tapTimer.current);
      tapTimer.current = null;
      burstLike();
    } else {
      tapTimer.current = setTimeout(() => {
        tapTimer.current = null;
        togglePause();
      }, 260);
    }
  };

  return (
    <div className="tt-slide" data-idx={idx}>
      <div className="tt-frame">
        <div className="tt-media" onClick={onTap}>
          <img className="tt-poster" src={`/api/thumbs/${v.id}/0`} alt="" loading="lazy" onError={(e: any) => { e.target.style.display = 'none'; }} />
          {near && (
            <video
              ref={videoRef as any}
              className={vertical ? 'cover' : 'contain'}
              src={streamOf(v)}
              muted={muted}
              playsInline
              preload={active ? 'auto' : 'metadata'}
              poster={`/api/thumbs/${v.id}/0`}
              onTimeUpdate={(e: any) => { if (active && e.target.duration) setProgress(e.target.currentTime / e.target.duration); }}
              onEnded={() => { if (active) onEnded(); }}
              onError={() => {
                // A clip that can't stream (e.g. locked encrypted category)
                // would stall the feed — skip past it.
                if (!active) return;
                clearTimeout(errTimer.current);
                errTimer.current = setTimeout(() => onEnded(), 1200);
              }}
            />
          )}

          {paused && (
            <div className="tt-pause-glyph">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,3 21,12 6,21" /></svg>
            </div>
          )}

          {heart > 0 && (
            <div className="tt-heart-burst"><HeartIcon size={96} /></div>
          )}

          <div className="tt-info">
            <div className="tt-user" onClick={(e: any) => { e.stopPropagation(); onOpenCategory(); }}>
              <div className="tt-avatar" style={{ background: color }}>{initial(category)}</div>
              <span className="tt-username">@{category.replace(/\s+/g, '_').toLowerCase()}</span>
            </div>
            <div className="tt-caption">{v.name}</div>
            {v.tags && v.tags.length > 0 && (
              <div className="tt-tags">{v.tags.slice(0, 5).map((t: string) => <span key={t}>#{t.replace(/\s+/g, '')}</span>)}</div>
            )}
          </div>

          <div className="tt-rail" onClick={(e: any) => e.stopPropagation()}>
            <button className={`tt-rail-btn ${liked ? 'liked' : ''}`} title="Like" onClick={() => onLike(v.id)}>
              <HeartIcon />
            </button>
            <button className="tt-rail-btn" title={muted ? 'Unmute (M)' : 'Mute (M)'} onClick={onToggleMute}>
              {muted ? (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M11 5L6 9H2v6h4l5 4V5z" /><line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" stroke-width="2" /><line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" stroke-width="2" /></svg>
              ) : (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" fill="none" stroke="currentColor" stroke-width="2" /></svg>
              )}
            </button>
            <button className="tt-rail-btn" title="Open in player" onClick={onOpen}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
            </button>
            <button className="tt-rail-btn" title="Copy link" onClick={onShare}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            </button>
          </div>

          <div className="tt-progress"><div className="tt-progress-fill" style={{ width: `${progress * 100}%` }} /></div>
        </div>
      </div>
    </div>
  );
};
