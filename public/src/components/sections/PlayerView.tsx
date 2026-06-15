import { currentVideo, currentView, allVideos, showAddToCollectionModal, isMuted, filteredVideos, playerNextUp, playerHistory, skipNextUpUpdate, folders, loadVideos, matchLinkFolder, renameModalState, moveModalState, tagModalState, actorModalState, channelModalState, appPrefs } from '../../store';
import { zapOn, zapStartTime } from '../../zap';
import { ZapView } from './ZapView';
import { useEffect, useRef, useState, useMemo } from 'preact/hooks';
import { AiComments } from '../UI/AiComments';
import { AddToCollectionModal } from '../modals/AddToCollectionModal';
import { VideoCard } from '../UI/VideoGrid';
import { AdvancedPlayer } from '../UI/AdvancedPlayer';
import { playerSeries, playerSeason } from '../../series';
import { getThumbPref, setThumbPref } from '../../thumbPref';

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
  const [channel, setChannel] = useState<string>('');
  const [rating, setRating] = useState<number | null>(null);
  const [hoveredRating, setHoveredRating] = useState<number | null>(null);
  const [chapters, setChapters] = useState<any[]>([]);
  const [suggested, setSuggested] = useState<any[]>([]);
  const [subtitles, setSubtitles] = useState<any[]>([]);
  const [language, setLanguage] = useState<string>('');

  const [note, setNote] = useState<string>('');
  const [subtitleUploading, setSubtitleUploading] = useState(false);
  const [cardThumb, setCardThumb] = useState<number>(() => video ? getThumbPref(video.id) : 0);
  const [downloadJobId, setDownloadJobId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showEncryptConfirm, setShowEncryptConfirm] = useState(false);

  const [autoChapters, setAutoChapters] = useState<any[]>([]);
  const [isDetectingChapters, setIsDetectingChapters] = useState(false);
  const [showPlayerOptions, setShowPlayerOptions] = useState(false);
  const [batchStatus, setBatchStatus] = useState<{ running: boolean; done: number; total: number } | null>(null);
  const playerOptionsRef = useRef<HTMLDivElement>(null);

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
              const match = matchLinkFolder(video.name, folders.value);
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
      const match = matchLinkFolder(video.name, folders.value);
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
      // When the session was launched from the Series screen, fill Next Up with
      // the series' episodes (restricted to the selected season) instead of the
      // current grid. Drop out of series mode if this video isn't part of it.
      const series = playerSeries.value;
      if (series) {
        if (series.episodes.some(e => e.video.id === video.id)) {
          const season = playerSeason.value;
          const eps = season != null ? series.episodes.filter(e => e.season === season) : series.episodes;
          const i = eps.findIndex(e => e.video.id === video.id);
          const ordered = i !== -1
            ? [...eps.slice(i + 1), ...eps.slice(0, i)]
            : eps.filter(e => e.video.id !== video.id);
          playerNextUp.value = ordered.map(e => e.video);
          return;
        }
        playerSeries.value = null;
        playerSeason.value = null;
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
      playerHistory.value = [];
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
    if (video) setCardThumb(getThumbPref(video.id));
    // Reset any chapter-based start time after the player has consumed it,
    // so a stale value doesn't bleed into the next video opened from VideoGrid.
    return () => { if (!zapOn.value) zapStartTime.value = 0; };
  }, [video?.id]);

  useEffect(() => {
    if (!video || video.isVault) return;
    Promise.all([
      fetch(`/api/videos/${video.id}`).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
      fetch(`/api/subtitles/${video.id}`).then(r => r.json()).catch(() => [])
    ]).then(([d, tracks]) => {
      setActors(d.actors || []);
      setTags(d.tags || []);
      setChannel(d.channel || '');
      setRating(d.video?.rating ?? null);
      setNote(d.video?.note || '');
      setLanguage(d.video?.language || '');
      setChapters(d.video?.chapters || []);
      setSuggested(d.suggested || []);
      setSubtitles(tracks);
      // Enqueue whisper if enabled and no file-based subtitle exists yet
      const hasFileSub = tracks.some((t: any) => t.filename);
      if (!hasFileSub && !video.isLink) {
        fetch(`/api/whisper/enqueue/${video.id}`, { method: 'POST' }).catch(() => {});
      }
    }).catch(() => {});
  }, [video]);

  // Auto-chapter detection: load cache on video change, trigger background detect if enabled
  useEffect(() => {
    if (!video || video.isLink || video.isVault) { setAutoChapters([]); return; }
    const autoEnabled = !!appPrefs.value.autoChapterDetection;
    fetch(`/api/auto-chapters/${video.id}`)
      .then(r => r.json())
      .then(d => {
        if (d.chapters && d.chapters.length > 0) {
          setAutoChapters(d.chapters);
        } else if (autoEnabled && d.chapters === null) {
          // Not yet detected — trigger background detection
          setIsDetectingChapters(true);
          fetch(`/api/auto-chapters/${video.id}/detect`, { method: 'POST' })
            .then(r => r.json())
            .then(d2 => { if (d2.chapters) setAutoChapters(d2.chapters); })
            .catch(() => {})
            .finally(() => setIsDetectingChapters(false));
        } else {
          setAutoChapters([]);
        }
      })
      .catch(() => setAutoChapters([]));
  }, [video?.id]);

  // Close options dropdown on outside click
  useEffect(() => {
    if (!showPlayerOptions) return;
    const handler = (e: MouseEvent) => {
      if (playerOptionsRef.current && !playerOptionsRef.current.contains(e.target as Node)) {
        setShowPlayerOptions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPlayerOptions]);

  const detectChaptersNow = async () => {
    if (!video || video.isLink || video.isVault || isDetectingChapters) return;
    setIsDetectingChapters(true);
    setShowPlayerOptions(false);
    try {
      const r = await fetch(`/api/auto-chapters/${video.id}/detect`, { method: 'POST' });
      const d = await r.json();
      if (d.chapters) setAutoChapters(d.chapters);
      (window as any).toast?.(`Found ${d.chapters?.length ?? 0} scene(s)`);
    } catch { (window as any).toast?.('Detection failed'); }
    finally { setIsDetectingChapters(false); }
  };

  const toggleAutoChapterDetection = async () => {
    const next = !appPrefs.value.autoChapterDetection;
    appPrefs.value = { ...appPrefs.value, autoChapterDetection: next };
    await fetch('/api/settings/prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoChapterDetection: next }),
    }).catch(() => {});
    if (!next) setAutoChapters([]);
  };

  const startBatchDetect = async () => {
    setShowPlayerOptions(false);
    setBatchStatus({ running: true, done: 0, total: 0 });
    await fetch('/api/gen-chapters/start', { method: 'POST' }).catch(() => {});
    const es = new EventSource('/api/gen-chapters/status');
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (ev.type === 'done') { setBatchStatus({ running: false, done: ev.done, total: ev.total }); es.close(); }
      else if (ev.type === 'progress') setBatchStatus({ running: true, done: ev.done, total: ev.total });
    };
    es.onerror = () => { setBatchStatus(null); es.close(); };
  };

  // Refetch actors/tags/channel after the tag/actor/channel modal closes for this video
  const anyMetaModalOpen = tagModalState.value.visible || actorModalState.value.visible || channelModalState.value.visible;
  const wasMetaModalOpen = useRef(false);
  useEffect(() => {
    if (anyMetaModalOpen) {
      wasMetaModalOpen.current = true;
      return;
    }
    if (!wasMetaModalOpen.current || !video || video.isVault) return;
    wasMetaModalOpen.current = false;
    fetch(`/api/videos/${video.id}`).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(d => {
      setActors(d.actors || []);
      setTags(d.tags || []);
      setChannel(d.channel || '');
    }).catch(() => {});
  }, [video, anyMetaModalOpen]);

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

  if (zapOn.value) {
    return (
      <ZapView
        video={video}
        videoRef={videoRef}
        subtitles={subtitles}
        chapters={chapters}
        language={language}
      />
    );
  }

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

  const removeTag = async (tag: string) => {
    if (!video) return;
    const newTags = tags.filter(t => t !== tag);
    setTags(newTags);
    await fetch(`/api/videos/${video.id}/meta`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: newTags }),
    }).catch(() => {});
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

  const reloadSubtitles = async () => {
    if (!video) return;
    const tracks = await fetch(`/api/subtitles/${video.id}`).then(r => r.json()).catch(() => []);
    setSubtitles(tracks);
  };

  const uploadSubtitle = async (file: File) => {
    if (!video) return;
    setSubtitleUploading(true);
    try {
      const r = await fetch(`/api/subtitles/${video.id}/upload`, {
        method: 'POST',
        headers: { 'x-filename': file.name, 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      const d = await r.json();
      if (d.ok) {
        (window as any).toast?.(`Subtitle uploaded: ${d.filename}`);
        await reloadSubtitles();
      } else {
        (window as any).toast?.('Upload failed: ' + (d.error || 'Unknown error'));
      }
    } catch {
      (window as any).toast?.('Upload failed');
    }
    setSubtitleUploading(false);
  };

  const deleteSubtitle = async (filename: string) => {
    if (!video) return;
    const r = await fetch(`/api/subtitle-file/${video.id}/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    if (r.ok) {
      (window as any).toast?.('Subtitle removed');
      await reloadSubtitles();
    } else {
      (window as any).toast?.('Delete failed');
    }
  };

  const saveNote = async () => {
    if (!video || video.isVault || video.isLink) return;
    await fetch(`/api/videos/${video.id}/meta`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    }).catch(() => {});
  };

  const takeScreenshot = async () => {
    const vid = videoRef.current;
    if (!vid) { (window as any).toast?.('Video not loaded'); return; }
    const canvas = document.createElement('canvas');
    canvas.width = vid.videoWidth || 1280;
    canvas.height = vid.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(vid, 0, 0);
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const safeName = (video?.name || 'video').replace(/[^a-zA-Z0-9._\- ]/g, '_');
      const timestamp = Math.floor(vid.currentTime);
      try {
        const r = await fetch('/api/screenshots/upload', {
          method: 'POST',
          headers: { 'x-filename': `${safeName}_${timestamp}s.jpg`, 'Content-Type': 'image/jpeg' },
          body: blob,
        });
        const d = await r.json();
        if (d.ok) {
          (window as any).toast?.('Screenshot saved');
        } else {
          (window as any).toast?.('Screenshot failed');
        }
      } catch { (window as any).toast?.('Screenshot failed'); }
    }, 'image/jpeg', 0.92);
  };

  const handleEncrypt = async () => {
    if (!video) return;

    const r = await fetch(`/api/videos/${video.id}/encrypt`, { method: 'POST' });
    if (r.ok) {
      if ((window as any).toast) (window as any).toast('Video encrypted and moved to Vault');
      currentView.value = 'hub';
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
    if (window.history.length > 1) {
      window.history.back();
    } else {
      currentView.value = 'hub';
    }
  };

  const series = playerSeries.value;
  const inSeries = !!series && series.episodes.some(e => e.video.id === video.id);
  const switchSeason = (n: number) => {
    if (!series) return;
    playerSeason.value = n;
    const eps = series.episodes.filter(e => e.season === n);
    if (eps.length) currentVideo.value = eps[0].video;
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
                src={video.streamUrl || `/api/vault/stream/${video.id}`}
                videoId={video.id}
                title={video.name}
                subtitles={subtitles}
                chapters={chapters}
                autoChapters={appPrefs.value.autoChapterDetection ? autoChapters : []}
                language={language}
                videoRef={videoRef}
                isMuted={isMuted.value}
                startTime={zapStartTime.value}
                onNext={() => {
                  if (playerNextUp.value.length > 0) {
                    playerHistory.value = [...playerHistory.value, video];
                    currentVideo.value = playerNextUp.value[0];
                  }
                }}
                onPrev={() => {
                  const hist = playerHistory.value;
                  if (hist.length > 0) {
                    const prev = hist[hist.length - 1];
                    playerHistory.value = hist.slice(0, -1);
                    skipNextUpUpdate.value = true;
                    playerNextUp.value = [video, ...playerNextUp.value];
                    currentVideo.value = prev;
                  }
                }}
              />
            ) : (
              <AdvancedPlayer
                key={video.id}
                src={`/api/stream/${video.id}`}
                hlsSrc={`/api/hls/${video.id}/index.m3u8`}
                videoId={video.id}
                title={video.name}
                subtitles={subtitles}
                chapters={chapters}
                autoChapters={appPrefs.value.autoChapterDetection ? autoChapters : []}
                language={language}
                videoRef={videoRef}
                isMuted={isMuted.value}
                startTime={zapStartTime.value}
                onNext={() => {
                  if (playerNextUp.value.length > 0) {
                    playerHistory.value = [...playerHistory.value, video];
                    currentVideo.value = playerNextUp.value[0];
                  }
                }}
                onPrev={() => {
                  const hist = playerHistory.value;
                  if (hist.length > 0) {
                    const prev = hist[hist.length - 1];
                    playerHistory.value = hist.slice(0, -1);
                    skipNextUpUpdate.value = true;
                    playerNextUp.value = [video, ...playerNextUp.value];
                    currentVideo.value = prev;
                  }
                }}
              />
            )}
          </div>

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

            {inSeries && (
              <div className="player-series-row" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--tx3)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{series!.name}</span>
                {series!.seasons.length > 1 && series!.seasons.map(n => (
                  <button
                    key={n}
                    onClick={() => switchSeason(n)}
                    style={{
                      padding: '5px 12px', borderRadius: '16px', cursor: 'pointer', fontSize: '0.8rem',
                      border: '1px solid var(--brd)',
                      background: playerSeason.value === n ? 'var(--ac)' : 'var(--bg2)',
                      color: playerSeason.value === n ? '#fff' : 'var(--tx)',
                    }}
                  >Season {n}</button>
                ))}
              </div>
            )}

            <div className="player-info-actions" style={{ display: 'flex', gap: '10px', marginBottom: '25px', flexWrap: 'wrap' }}>
              <button onClick={() => toggleFav()} className={video.fav ? 'st' : ''} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '20px', border: '1px solid var(--brd)', background: 'var(--bg2)', cursor: 'pointer', fontSize: '0.85rem' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill={video.fav ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                <span>Fav</span>
              </button>

              <button onClick={() => {
                const pool = allVideos.value.filter((v: any) => v.id !== video.id && !v.isLink);
                if (!pool.length) { if ((window as any).toast) (window as any).toast('No other videos'); return; }
                const pick = pool[Math.floor(Math.random() * pool.length)];
                (window as any).openVid(pick.id);
              }} title="Open a random video" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '20px', border: '1px solid var(--brd)', background: 'var(--bg2)', cursor: 'pointer', fontSize: '0.85rem' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
                  <circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
                  <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
                  <circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
                  <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
                </svg>
                <span>Random</span>
              </button>

              {video.linkUrl && (
                <button onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(video.linkUrl!);
                    if ((window as any).toast) (window as any).toast('Link copied');
                  } catch {
                    if ((window as any).toast) (window as any).toast('Copy failed');
                  }
                }} title="Copy the associated link URL" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '20px', border: '1px solid var(--brd)', background: 'var(--bg2)', cursor: 'pointer', fontSize: '0.85rem' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                  <span>Copy Link</span>
                </button>
              )}

              <button onClick={() => renameModalState.value = { visible: true, vidId: video.id, linkUrl: null, currentName: video.name }} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '20px', border: '1px solid var(--brd)', background: 'var(--bg2)', cursor: 'pointer', fontSize: '0.85rem' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                <span>Rename</span>
              </button>

              <button onClick={() => moveModalState.value = { visible: true, vidIds: [video.id], linkUrl: null, currentFolder: video.catPath || '', isVault: !!(video as any).isVault }} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '20px', border: '1px solid var(--brd)', background: 'var(--bg2)', cursor: 'pointer', fontSize: '0.85rem' }}>
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

              <button onClick={() => setShowEncryptConfirm(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '20px', border: '1px solid var(--brd)', background: 'var(--bg2)', cursor: 'pointer', fontSize: '0.85rem' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                <span>Encrypt</span>
              </button>


              {!video.isLink && (
                <button onClick={takeScreenshot} title="Save current frame to Screenshots" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '20px', border: '1px solid var(--brd)', background: 'var(--bg2)', cursor: 'pointer', fontSize: '0.85rem' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" />
                  </svg>
                  <span>Take Screenshot</span>
                </button>
              )}

              <button onClick={async () => {
                if (!confirm(`Delete video "${video.name}" from disk?\nThis action cannot be undone.`)) return;
                const r = await fetch(`/api/videos/${video.id}`, { method: 'DELETE' });
                if (r.ok) {
                  if ((window as any).toast) (window as any).toast('Video deleted');
                  currentView.value = 'hub';
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
                  const r = await fetch('/api/open-folder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: video.id })
                  });
                  if (!r.ok && (window as any).toast) (window as any).toast('Failed to open folder');
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

              {/* Options dropdown — auto-chapter detection + batch */}
              {!video.isLink && (
                <div ref={playerOptionsRef} style={{ position: 'relative' }}>
                  <button
                    onClick={() => setShowPlayerOptions(v => !v)}
                    title="Player options"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '20px', border: showPlayerOptions ? '1px solid var(--ac)' : '1px solid var(--brd)', background: 'var(--bg2)', cursor: 'pointer', fontSize: '0.85rem', color: showPlayerOptions ? 'var(--ac)' : 'var(--tx)' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                    <span>Options</span>
                  </button>
                  {showPlayerOptions && (
                    <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '10px', minWidth: '240px', zIndex: 50, padding: '8px 0', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
                      <div style={{ padding: '6px 14px 4px', fontSize: '0.7rem', color: 'var(--tx3)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Chapters</div>
                      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '8px 14px', cursor: 'pointer', fontSize: '0.85rem' }}>
                        <span>Auto-detect chapters</span>
                        <input type="checkbox" checked={!!appPrefs.value.autoChapterDetection} onChange={toggleAutoChapterDetection} style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--ac)' }} />
                      </label>
                      <button
                        onClick={detectChaptersNow}
                        disabled={isDetectingChapters}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 14px', background: 'none', border: 'none', color: isDetectingChapters ? 'var(--tx3)' : 'var(--tx)', cursor: isDetectingChapters ? 'default' : 'pointer', fontSize: '0.85rem', textAlign: 'left' }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                        {isDetectingChapters ? 'Detecting…' : 'Detect for this video'}
                      </button>
                      <button
                        onClick={startBatchDetect}
                        disabled={!!(batchStatus && batchStatus.running)}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 14px', background: 'none', border: 'none', color: (batchStatus && batchStatus.running) ? 'var(--tx3)' : 'var(--tx)', cursor: (batchStatus && batchStatus.running) ? 'default' : 'pointer', fontSize: '0.85rem', textAlign: 'left' }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12H3M3 12l4-4M3 12l4 4"/><path d="M21 6H9M21 18H9"/></svg>
                        {batchStatus && batchStatus.running ? `Detecting all… ${batchStatus.done}/${batchStatus.total}` : 'Detect all missing'}
                      </button>
                      {batchStatus && !batchStatus.running && (
                        <div style={{ padding: '4px 14px 8px', fontSize: '0.78rem', color: 'var(--tx3)' }}>Done — {batchStatus.done} processed</div>
                      )}
                    </div>
                  )}
                </div>
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

            {!video.isLink && !video.isVault && (
              <div className="player-subtitle-row" style={{ marginBottom: '15px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: subtitles.filter(s => s.filename).length > 0 ? '6px' : '0' }}>
                  <span style={{ color: 'var(--tx3)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Subtitles</span>
                  <label style={{ cursor: subtitleUploading ? 'default' : 'pointer', opacity: subtitleUploading ? 0.5 : 1 }}>
                    <input
                      type="file"
                      accept=".srt,.vtt,.ass,.ssa"
                      style={{ display: 'none' }}
                      disabled={subtitleUploading}
                      onChange={(e: any) => { const f = e.target.files?.[0]; if (f) uploadSubtitle(f); e.target.value = ''; }}
                    />
                    <span style={{ fontSize: '0.78rem', color: 'var(--ac)', border: '1px solid var(--ac)', borderRadius: '4px', padding: '2px 8px', userSelect: 'none' }}>
                      {subtitleUploading ? 'Uploading…' : '+ Upload'}
                    </span>
                  </label>
                </div>
                {subtitles.filter(s => s.filename).map(s => (
                  <div key={s.filename} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 0' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--tx2)' }}>{s.label}</span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--tx3)' }}>{s.filename}</span>
                    <button
                      onClick={() => deleteSubtitle(s.filename!)}
                      title="Remove subtitle file"
                      style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: '0 2px', fontSize: '0.75rem', lineHeight: 1 }}
                    >✕</button>
                  </div>
                ))}
              </div>
            )}

            <div className="player-channel-row" style={{ marginBottom: '15px', display: 'flex', alignItems: 'center' }}>
              <span style={{ color: 'var(--tx3)', marginRight: '10px', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Channel</span>
              {channel ? (
                <span style={{ color: 'var(--ac)', cursor: 'pointer', fontWeight: 500 }} onClick={() => (window as any).openChannel(channel)}>{channel}</span>
              ) : (
                <span style={{ color: 'var(--tx3)', fontSize: '0.85rem' }}>None</span>
              )}
              <button className="p-tag-add-btn" onClick={() => (window as any).openChannelModal(video.id)} style={{ marginLeft: '10px', width: '22px', height: '22px', fontSize: '0.75rem' }}>
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
                  <span key={t} className="p-tag" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {t}
                    <button onClick={() => removeTag(t)} title="Remove tag" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', opacity: 0.6 }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
                    </button>
                  </span>
                ))}
                <button className="p-tag-add-btn" onClick={() => (window as any).openTagModal(video.id)} style={{ width: '24px', height: '24px' }}>
                  +
                </button>
              </div>
            </div>

            {!video.isLink && !video.isVault && (
              <div className="player-note-row" style={{ marginBottom: '20px' }}>
                <span style={{ display: 'block', color: 'var(--tx3)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>Notes</span>
                <textarea
                  value={note}
                  onInput={(e: any) => setNote(e.target.value)}
                  onBlur={saveNote}
                  placeholder="Private note…"
                  rows={3}
                  style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '8px 12px', fontSize: '0.9rem', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
                />
              </div>
            )}

            {!video.isLink && !video.isVault && (
              <div className="player-thumb-row" style={{ marginBottom: '20px' }}>
                <span style={{ display: 'block', color: 'var(--tx3)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>Card thumbnail</span>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {[0, 1, 2, 3, 4].map(i => (
                    <img
                      key={i}
                      src={`/api/thumbs/${video.id}/${i}`}
                      alt={`Thumbnail ${i + 1}`}
                      onClick={() => { setThumbPref(video.id, i); setCardThumb(i); (window as any).toast?.('Card thumbnail updated'); }}
                      onError={(e: any) => e.target.style.display = 'none'}
                      style={{
                        width: '96px', aspectRatio: '16/9', objectFit: 'cover', borderRadius: '6px', cursor: 'pointer',
                        border: cardThumb === i ? '2px solid var(--ac)' : '2px solid transparent',
                        opacity: cardThumb === i ? 1 : 0.7,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

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

          {/* Auto-detected chapters — only shown when option is enabled */}
          {appPrefs.value.autoChapterDetection && autoChapters.length > 0 && (
            <div className="playlist-panel" style={{ marginBottom: '20px' }}>
              <div className="playlist-header">
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'rgba(80,200,255,0.9)', display: 'inline-block', flexShrink: 0 }} />
                  Scene Detection
                </span>
                <span className="playlist-count">{autoChapters.length}</span>
              </div>
              <div className="playlist-list">
                {autoChapters.map((c: any) => (
                  <div key={c.id} className="playlist-item" onClick={() => jumpToChapter(c.time)}>
                    <img src={`/api/thumbs/${video.id}/${Math.min(4, Math.round((c.time / (videoRef.current?.duration || 1)) * 4))}`} className="pl-thumb" alt={c.title} onError={(e: any) => e.target.style.display = 'none'} />
                    <div className="pl-info">
                      <div className="pl-name">{c.title}</div>
                      <div className="pl-meta">{formatDuration(c.time)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isDetectingChapters && (
            <div style={{ padding: '10px 14px', fontSize: '0.82rem', color: 'var(--tx3)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: 'rgba(80,200,255,0.7)', animation: 'pulse 1.2s ease-in-out infinite' }} />
              Detecting scenes…
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

      {showEncryptConfirm && (
        <div className="modal on" style={{ display: 'flex' }}>
          <div className="modal-content">
            <div className="modal-header">
              <h2>Encrypt Video</h2>
            </div>
            <div className="modal-body">
              <p>Encrypt "{video.name}" and move it to Vault?</p>
              <p>The video will be placed in a vault folder matching its current category.</p>
            </div>
            <div className="modal-footer">
              <button class="modal-btn modal-btn--primary" onClick={() => {
                setShowEncryptConfirm(false);
                handleEncrypt();
              }}>Encrypt</button>
              <button class="modal-btn" onClick={() => setShowEncryptConfirm(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const PlayerAction = ({ label, icon, onClick }: { label: string, icon: string, onClick: () => void }) => (
  <button onClick={onClick}>
    <i className={`icon-${icon}`} />
    <span>{label}</span>
  </button>
);
