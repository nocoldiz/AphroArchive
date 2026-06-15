// Hero Banner widget — cycles through featured / recent videos.
import { useState, useEffect, useMemo } from 'preact/hooks';
import { allVideos } from '../../public/src/store';
import { thumbFor, localVideos, openVid } from '../../public/src/home/shared';

export default function HeroWidget() {
  const pool = useMemo(() => {
    const favs = localVideos().filter(v => v.starred || v.fav);
    const recent = [...localVideos()].sort((a, b) => b.mtime - a.mtime).slice(0, 12);
    return (favs.length ? favs : recent).filter(v => thumbFor(v)).slice(0, 5);
  }, [allVideos.value]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (pool.length < 2) return;
    const t = setInterval(() => setIdx(i => (i + 1) % pool.length), 6000);
    return () => clearInterval(t);
  }, [pool.length]);

  if (!pool.length) return <div className="dw-shell"><div className="dw-empty">Add videos to feature them here.</div></div>;
  const v = pool[Math.min(idx, pool.length - 1)];
  return (
    <div className="dw-hero" style={{ backgroundImage: `url(${thumbFor(v)})` }}>
      <div className="dw-hero-grad" />
      <div className="dw-hero-info">
        <div className="dw-hero-tag">Featured</div>
        <h2 className="dw-hero-title">{v.name}</h2>
        <button className="dw-hero-play" onClick={() => openVid(v.id)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          Play
        </button>
      </div>
      {pool.length > 1 &&
        <div className="dw-hero-dots">
          {pool.map((_, i) => <span key={i} className={'dw-dot' + (i === idx ? ' on' : '')} onClick={() => setIdx(i)} />)}
        </div>}
    </div>
  );
}
