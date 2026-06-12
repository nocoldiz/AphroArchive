import { currentVideo, currentView, allVideos, showAddToCollectionModal, isMuted, filteredVideos, playerNextUp, skipNextUpUpdate, categories, loadVideos, matchLinkCat, imagegenInputState } from '../../store';
import { zapOn, zapLock, zapIv, zapStartTime, setZapIv, toggleZapLock, stopZapping } from '../../zap';
import { useEffect, useRef, useState, useMemo } from 'preact/hooks';
import { AiComments } from '../UI/AiComments';
import { AddToCollectionModal } from '../modals/AddToCollectionModal';
import { VideoCard } from '../UI/VideoGrid';
import { AdvancedPlayer } from '../UI/AdvancedPlayer';

// BCP-47 codes — fed to SpeechRecognition.lang for live subtitle generation
const LANGUAGES: { code: string; label: string }[] = [
  { code: 'en-US', label: 'English' },
  { code: 'it-IT', label: 'Italiano' },
  { code: 'es-ES', label: 'Español' },
  { code: 'fr-FR', label: 'Français' },
  { code: 'de-DE', label: 'Deutsch' },
  { code: 'pt-BR', label: 'Português' },
  { code: 'ru-RU', label: 'Русский' },
  { code: 'ja-JP', label: '日本語' },
  { code: 'zh-CN', label: '中文' },
  { code: 'ko-KR', label: '한국어' },
  { code: 'ar-SA', label: 'العربية' },
  { code: 'hi-IN', label: 'हिन्दी' },
  { code: 'nl-NL', label: 'Nederlands' },
  { code: 'pl-PL', label: 'Polski' },
  { code: 'tr-TR', label: 'Türkçe' },
];

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
  const [language, setLanguage] = useState<string>('');
  if (!video) return null;

  const [downloadJobId, setDownloadJobId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    let timer: any;
    let cancelled = false;
    if (downloadJobId && video) {
      timer = setInterval(async () => {
        let jobs: any[];
        try {
          const r = await fetch('/api/download/jobs');
          jobs = await r.json();
        } catch {
          return;
        }
        if (cancelled) return;
        const job = jobs.find((j: any) => j.id === downloadJobId);
        if (job) {
          setDownloadProgress(job.progress);
          if (job.status === 'done') {
            clearInterval(timer);
            setDownloadJobId(null);
            setIsDownloading(false);
            
            let targetCat = video.category || '';
            if (video.isLink && (targetCat === 'Links' || targetCat === 'Uncategorized' || !targetCat)) {
              const match = matchLinkCat(video.name, categories.value);
              if (match && match.catPath !== 'Links') {
                targetCat = match.catPath;
              } else {
                targetCat = '';
              }
            }
            const cleanCat = targetCat.trim();
            const isVirtual = cleanCat.toLowerCase() === 'links' || cleanCat.toLowerCase() === 'uncategorized';
            const physicalCat = isVirtual ? '' : cleanCat;
            const relPath = physicalCat ? `${physicalCat}/${job.title}.mp4` : `${job.title}.mp4`;
            const base64 = btoa(unescape(encodeURIComponent(relPath)));
            const newId = base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
            
            currentVideo.value = {
              ...video,
              id: newId,
              isLink: false,
              path: relPath,
              category: physicalCat || 'Uncategorized'
            };
            
            if ((window as any).toast) (window as any).toast('Video downloaded and loaded!');
            loadVideos();
          } else if (job.status === 'error') {
            clearInterval(timer);
            setDownloadJobId(null);
            setIsDownloading(false);
            alert('Download failed: ' + job.error);
          }
        }
      }, 1000);
    }
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [downloadJobId]);

  const startDownload = async () => {
    if (!video) return;
    const downloadUrl = video.isLink ? video.linkUrl : video.path;
    if (!downloadUrl) return;

    let targetCat = video.category || '';
    if (video.isLink && (targetCat === 'Links' || targetCat === 'Uncategorized' || !targetCat)) {
      const match = matchLinkCat(video.name, categories.value);
      if (match && match.catPath !== 'Links') {
        targetCat = match.catPath;
      } else {
        targetCat = '';
      }
    }

    setIsDownloading(true);
    const r = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: downloadUrl, category: targetCat })
    });
    const d = await r.json();
    if (d.ok && d.ids && d.ids.length > 0) {
      setDownloadJobId(d.ids[0]);
    } else {
      setIsDownloading(false);
      alert('Failed to start download');
    }
  };

  useEffect(() => {
    if (video) {
      if (skipNextUpUpdate.value) {
        skipNextUpUpdate.value = false;
        return;
      }
      const allVis = filteredVideos.value;
      const idx = allVis.findIndex(v => v.id === video.id);
      
      if (idx !== -1) {
        const after = allVis.slice(idx + 1);
        const before = allVis.slice(0, idx);
        playerNextUp.value = [...after, ...before];
      } else {
        const list = allVideos.value
          .filter(v => v.category === video.category && v.id !== video.id)
          .slice(0, 10);
        playerNextUp.value = list;
      }
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
    const newList = [...playerNextUp.value];
    const [removed] = newList.splice(fromIndex, 1);
    newList.splice(index, 0, removed);
    playerNextUp.value = newList;
  };

  const removeVideo = (id: string) => {
    playerNextUp.value = playerNextUp.value.filter(v => v.id !== id);
  };

  useEffect(() => {
    if (!video || video.isVault) return;
    Promise.all([
      fetch(`/api/videos/${video.id}`).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
      fetch(`/api/subtitles/${video.id}`).then(r => r.json()).catch(() => [])
    ]).then(([d, tracks]) => {
      setActors(d.actors || []);
      setTags(d.tags || []);
      setStudio(d.studio || '');
      setRating(d.video?.rating ?? null);
      setLanguage(d.video?.language || '');
      setChapters(d.video?.chapters || []);
      setSuggested(d.suggested || []);
      setSubtitles(tracks);
    }).catch(() => {});
  }, [video]);

  const relatedVideos = useMemo(() => {
    if (!video) return [];
    const nextUpIds = new Set(playerNextUp.value.map(v => v.id));
    
    const titleWords = video.name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    
    return allVideos.value.filter(v => {
      if (v.id === video.id) return false;
      if (nextUpIds.has(v.id)) return false;
      
      const sameActors = actors.length > 0 && v.actors && v.actors.some(a => actors.includes(a));
      const sameTags = tags.length > 0 && v.tags && v.tags.some(t => tags.includes(t));
      
      const vTitleWords = v.name.toLowerCase().split(/\s+/);
      const sameTitle = titleWords.some(w => vTitleWords.includes(w));
      
      return sameActors || sameTags || sameTitle;
    }).slice(0, 8);
  }, [video, playerNextUp.value, actors, tags, allVideos.value]);

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

      switch (e.key) {
        case 'v': case 'V':
          toggleFav();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [video, toggleFav]);

  if (!video) return null;

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

  const updateLanguage = async (lang: string) => {
    if (!video) return;
    const prev = language;
    setLanguage(lang);
    const r = await fetch(`/api/videos/${video.id}/meta`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: lang })
    }).catch(() => null);
    if (!r || !r.ok) {
      setLanguage(prev);
      (window as any).toast?.('Failed to save language');
    }
  };

  const sendFrameToImagegen = async () => {
    const vid = videoRef.current;
    if (!vid) { (window as any).toast?.('Video not loaded'); return; }
    const canvas = document.createElement('canvas');
    canvas.width = vid.videoWidth || 512;
    canvas.height = vid.videoHeight || 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(vid, 0, 0);
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      try {
        const r = await fetch('/api/imagegen/upload', {
          method: 'POST',
          headers: { 'x-filename': 'frame.jpg', 'Content-Type': 'image/jpeg' },
          body: blob,
        });
        const d = await r.json();
        if (d.ok) {
          imagegenInputState.value = { imageUrl: URL.createObjectURL(blob), imagePath: d.path };
          currentView.value = 'imagegen';
        } else {
          (window as any).toast?.('Upload failed');
        }
      } catch { (window as any).toast?.('Upload failed'); }
    }, 'image/jpeg', 0.92);
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
          {video.isLink ? (
              <div className="bm-fallback" style={{ background: '#000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', aspectRatio: '16/9', gap: '16px' }}>
                {video.img && (
                  <div style={{ maxWidth: '100%', maxHeight: '70%', display: 'flex', justifyContent: 'center', cursor: 'pointer' }} onClick={() => video.linkUrl && window.open(video.linkUrl, '_blank')}>
                    <img src={video.img} alt={video.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                  </div>
                )}
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={() => video.linkUrl && window.open(video.linkUrl, '_blank')} className="btn" style={{ fontSize: '1rem', padding: '10px 20px', cursor: 'pointer' }}>
                    Open in browser ↗
                  </button>
                  <button onClick={() => startDownload()} className="btn" style={{ fontSize: '1rem', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    <span>Download Video</span>
                  </button>
                </div>
              </div>
            ) : video.isVault ? (
              <AdvancedPlayer
                key={video.id}
                src={`/api/vault/stream/${video.id}`}
                videoId={video.id}
                subtitles={subtitles}
                chapters={chapters}
                language={language}
                videoRef={videoRef}
                isMuted={isMuted.value}
                startTime={zapStartTime.value}
                onNext={() => {
                  if (playerNextUp.value.length > 0) {
                    currentVideo.value = playerNextUp.value[0];
                  }
                }}
                onPrev={() => {}}
              />
            ) : (
              <AdvancedPlayer
                key={video.id}
                src={`/api/stream/${video.id}`}
                videoId={video.id}
                subtitles={subtitles}
                chapters={chapters}
                language={language}
                videoRef={videoRef}
                isMuted={isMuted.value}
                startTime={zapStartTime.value}
                onNext={() => {
                  if (playerNextUp.value.length > 0) {
                    currentVideo.value = playerNextUp.value[0];
                  }
                }}
                onPrev={() => {}}
              />
            )}
            <video id="zap-preload" style={{ display: 'none' }} />
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
              <span>{((video.size || 0) / 1024 / 1024).toFixed(1)} MB</span>
              <span>{video.duration ? (video.duration / 60).toFixed(1) + 'm' : '—'}</span>
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

              {!video.isLink && (
                <button onClick={sendFrameToImagegen} title="Capture current frame and open in Image Gen" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '20px', border: '1px solid var(--brd)', background: 'var(--bg2)', cursor: 'pointer', fontSize: '0.85rem' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                  <span>Frame → Image Gen</span>
                </button>
              )}

              <button onClick={async () => {
                if (!confirm(`Delete video "${video.name}" from disk?\nThis action cannot be undone.`)) return;
                const r = await fetch(`/api/videos/${video.id}`, { method: 'DELETE' });
                if (r.ok) {
                  if ((window as any).toast) (window as any).toast('Video deleted');
                  currentView.value = 'home';
                  allVideos.value = allVideos.value.filter((v: any) => v.id !== video.id);
                } else {
                  const err = await r.json();
                  if ((window as any).toast) (window as any).toast('Delete failed: ' + (err.error || 'Unknown error'));
                }
              }} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '20px', border: '1px solid var(--brd)', background: 'var(--bg2)', cursor: 'pointer', fontSize: '0.85rem', color: '#ff4a4a' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
                </svg>
                <span>Delete</span>
              </button>

              {!video.isLink && !video.isVault && (
                <button onClick={async () => {
                  const r = await fetch('/api/videos/open-folder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: video.id })
                  });
                }} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '20px', border: '1px solid var(--brd)', background: 'var(--bg2)', cursor: 'pointer', fontSize: '0.85rem' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <span>Open Folder</span>
                </button>
              )}
              
              {video.isLink && (
                <>
                  <button onClick={() => video.linkUrl && window.open(video.linkUrl, '_blank')} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '20px', border: '1px solid var(--brd)', background: 'var(--bg2)', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--tx)' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                      <polyline points="15 3 21 3 21 9"></polyline>
                      <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                    <span>Open Link</span>
                  </button>
                  <button onClick={() => startDownload()} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '20px', border: '1px solid var(--brd)', background: 'var(--bg2)', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    <span>Download</span>
                  </button>
                </>
              )}
            </div>

            {isDownloading && (
              <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px', fontSize: '0.85rem', color: 'var(--tx3)' }}>
                  <span>Downloading...</span>
                  <span>{downloadProgress.toFixed(1)}%</span>
                </div>
                <div style={{ width: '100%', height: '4px', background: 'var(--brd)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ width: `${downloadProgress}%`, height: '100%', background: 'var(--ac)' }} />
                </div>
              </div>
            )}

            <div className="player-language-row" style={{ marginBottom: '15px', display: 'flex', alignItems: 'center' }}>
              <span style={{ color: 'var(--tx3)', marginRight: '10px', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Language</span>
              <select
                value={language}
                title="Video language — used for live subtitle generation"
                onChange={(e: any) => updateLanguage(e.target.value)}
                style={{ background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '0.85rem' }}
              >
                <option value="">Not set</option>
                {LANGUAGES.map(l => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>
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
            {relatedVideos.length > 0 && (
              <div style={{ marginTop: '30px' }}>
                <h2 style={{ fontSize: '1.2rem', marginBottom: '15px' }}>Related Videos</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '15px' }}>
                  {relatedVideos.map(v => (
                    <div key={v.id} onClickCapture={() => { skipNextUpUpdate.value = true; }}>
                      <VideoCard video={v} isSelected={false} isRelated={true} />
                    </div>
                  ))}
                </div>
              </div>
            )}
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
                {playerNextUp.value.length}
              </span>
            </div>
            <div className="playlist-list">
              {playerNextUp.value.map((v, index) => (
                <div 
                  key={v.id} 
                  draggable={true}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, index)}
                  style={{ cursor: 'grab', position: 'relative', marginBottom: '10px' }}
                >
                  <VideoCard video={v} isSelected={false} index={index} />
                  <button 
                    className="pl-remove-btn" 
                    onClick={(e) => { e.stopPropagation(); removeVideo(v.id); }}
                    style={{ position: 'absolute', top: '5px', left: '5px', background: 'rgba(0,0,0,0.5)', border: 'none', color: 'white', cursor: 'pointer', padding: '5px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 4 }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
