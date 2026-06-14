import { useEffect, useRef, useState } from 'preact/hooks';
import { isMuted as isMutedSignal } from '../../store';
import { getProgress, setProgress } from '../../home/progress';

interface Chapter {
  id: string;
  title: string;
  time: number;
}

interface Subtitle {
  filename: string | null;
  label: string;
  type?: 'embedded';
  streamIndex?: number;
}

interface AdvancedPlayerProps {
  src: string;
  videoId: string;
  subtitles: Subtitle[];
  chapters: Chapter[];
  onNext?: () => void;
  onPrev?: () => void;
  isMuted?: boolean;
  videoRef?: any;
  startTime?: number;
  language?: string;
}

const loadSavedVolume = () => {
  const v = parseFloat(localStorage.getItem('playerVolume') || '1');
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
};

export const AdvancedPlayer = ({ src, videoId, subtitles, chapters, onNext, onPrev, isMuted = false, videoRef: externalRef, startTime = 0, language = '' }: AdvancedPlayerProps) => {
  const localRef = useRef<HTMLVideoElement>(null);
  const videoRef = externalRef || localRef;
  const containerRef = useRef<HTMLDivElement>(null);
  // Resume from saved progress when no explicit start time was requested.
  const startTimeRef = useRef(startTime || (() => {
    const p = getProgress(videoId);
    return p && p.t < p.d * 0.97 ? p.t : 0;
  })());
  const lastSaveRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(loadSavedVolume);
  const [muted, setMuted] = useState(isMuted);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const [buffered, setBuffered] = useState<{ start: number; end: number }[]>([]);
  const [localZap, setLocalZap] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ccOn, setCcOn] = useState(false);
  const [ccText, setCcText] = useState('');
  const [selectedSubIdx, setSelectedSubIdx] = useState<number | null>(null);
  const [showSubPicker, setShowSubPicker] = useState(false);
  const controlsTimeoutRef = useRef<any>(null);
  const recRef = useRef<any>(null);
  const subPickerRef = useRef<HTMLDivElement>(null);
  const ccOnRef = useRef(false);
  const onNextRef = useRef(onNext);
  const onPrevRef = useRef(onPrev);
  useEffect(() => { onNextRef.current = onNext; });
  useEffect(() => { onPrevRef.current = onPrev; });

  const toast = (msg: string) => (window as any).toast?.(msg);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => {
      setPlaying(false);
      setProgress(videoId, vid.currentTime, vid.duration || 0);
    };
    const onTimeUpdate = () => {
      setCurrentTime(vid.currentTime);
      const now = Date.now();
      if (now - lastSaveRef.current > 4000) {
        lastSaveRef.current = now;
        setProgress(videoId, vid.currentTime, vid.duration || 0);
      }
    };
    const onDurationChange = () => setDuration(vid.duration);
    const onLoadedMetadata = () => {
      setDuration(vid.duration);
      if (startTimeRef.current > 0) {
        vid.currentTime = startTimeRef.current;
        startTimeRef.current = 0;
      }
    };
    const onVolumeChange = () => {
      setVolume(vid.volume);
      setMuted(vid.muted);
      localStorage.setItem('playerVolume', String(vid.volume));
    };
    const onEnded = () => {
      if (onNextRef.current) onNextRef.current();
    };
    const onProgress = () => {
      const buf = vid.buffered;
      const ranges = [];
      for (let i = 0; i < buf.length; i++) {
        ranges.push({ start: buf.start(i), end: buf.end(i) });
      }
      setBuffered(ranges);
    };
    const onWaiting = () => setLoading(true);
    const onCanPlay = () => setLoading(false);

    vid.addEventListener('play', onPlay);
    vid.addEventListener('pause', onPause);
    vid.addEventListener('timeupdate', onTimeUpdate);
    vid.addEventListener('durationchange', onDurationChange);
    vid.addEventListener('loadedmetadata', onLoadedMetadata);
    vid.addEventListener('volumechange', onVolumeChange);
    vid.addEventListener('ended', onEnded);
    vid.addEventListener('progress', onProgress);
    vid.addEventListener('waiting', onWaiting);
    vid.addEventListener('canplay', onCanPlay);

    // Browsers block unmuted autoplay without a user gesture (e.g. on page
    // reload). Fall back to muted autoplay so playback always starts.
    const playPromise = vid.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        if (!vid.muted) {
          vid.muted = true;
          setMuted(true);
          isMutedSignal.value = true;
          vid.play().catch(() => {});
        }
      });
    }

    return () => {
      // Persist final position when navigating away mid-playback.
      setProgress(videoId, vid.currentTime, vid.duration || 0);
      vid.removeEventListener('play', onPlay);
      vid.removeEventListener('pause', onPause);
      vid.removeEventListener('timeupdate', onTimeUpdate);
      vid.removeEventListener('durationchange', onDurationChange);
      vid.removeEventListener('loadedmetadata', onLoadedMetadata);
      vid.removeEventListener('volumechange', onVolumeChange);
      vid.removeEventListener('ended', onEnded);
      vid.removeEventListener('progress', onProgress);
      vid.removeEventListener('waiting', onWaiting);
      vid.removeEventListener('canplay', onCanPlay);
    };
  }, []);

  useEffect(() => {
    const vid = videoRef.current;
    if (vid) {
      vid.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !localZap) return;

    const interval = setInterval(() => {
      if (vid.paused) return;

      const remaining = vid.duration - vid.currentTime;
      if (remaining < 10) {
        clearInterval(interval);
        setLocalZap(false);
        return;
      }

      const minJump = 5;
      const maxJump = remaining - 5;
      if (maxJump > minJump) {
        const jump = minJump + Math.random() * (maxJump - minJump);
        vid.currentTime = vid.currentTime + jump;
      } else {
        clearInterval(interval);
        setLocalZap(false);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [localZap]);

  useEffect(() => {
    const vid = videoRef.current;
    if (vid) {
      vid.volume = volume;
      vid.muted = muted;
    }
  }, [volume, muted]);

  // Mute writes through to the global mute signal so the topbar button stays in sync
  const setMutedAndSync = (next: boolean) => {
    setMuted(next);
    isMutedSignal.value = next;
  };

  // ── Fullscreen ──────────────────────────────────────────────────────
  useEffect(() => {
    const onFsChange = () => {
      const fsEl = document.fullscreenElement || (document as any).webkitFullscreenElement;
      setIsFullscreen(fsEl === containerRef.current);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, []);

  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;
    const fsEl = document.fullscreenElement || (document as any).webkitFullscreenElement;
    if (!fsEl) {
      const request = container.requestFullscreen || (container as any).webkitRequestFullscreen;
      if (!request) { toast('Fullscreen not supported'); return; }
      try {
        const p = request.call(container);
        if (p && p.catch) p.catch(() => toast('Fullscreen blocked'));
      } catch { toast('Fullscreen blocked'); }
    } else {
      (document.exitFullscreen || (document as any).webkitExitFullscreen)?.call(document);
    }
  };

  // ── Subtitle track mode control ──────────────────────────────────────
  // Auto-select first track when subtitles arrive; then reflect user picks.
  useEffect(() => {
    if (subtitles.length > 0 && selectedSubIdx === null) setSelectedSubIdx(0);
    if (subtitles.length === 0) setSelectedSubIdx(null);
  }, [subtitles]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    const apply = () => {
      const tracks = vid.textTracks;
      for (let i = 0; i < tracks.length; i++) {
        tracks[i].mode = selectedSubIdx === i ? 'showing' : 'disabled';
      }
    };
    const t = setTimeout(apply, 80);
    return () => clearTimeout(t);
  }, [selectedSubIdx, subtitles]);

  // Close subtitle picker on outside click
  useEffect(() => {
    if (!showSubPicker) return;
    const onDown = (e: MouseEvent) => {
      if (subPickerRef.current && !subPickerRef.current.contains(e.target as Node)) {
        setShowSubPicker(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showSubPicker]);

  // ── Live captions via the browser SpeechRecognition API ────────────
  // Listens through the microphone, so video audio must be audible (speakers).
  useEffect(() => {
    ccOnRef.current = ccOn;
    if (!ccOn) {
      if (recRef.current) {
        recRef.current.onend = null;
        try { recRef.current.stop(); } catch {}
        recRef.current = null;
      }
      setCcText('');
      return;
    }

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast('Live captions are not supported by this browser');
      setCcOn(false);
      return;
    }

    const rec = new SR();
    recRef.current = rec;
    rec.lang = language || navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e: any) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
      }
      // Keep only the tail so the overlay stays at most ~2 lines
      setCcText(text.length > 160 ? '…' + text.slice(-160) : text);
    };
    rec.onerror = (e: any) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        toast('Live captions need microphone access (audio must play through speakers)');
        setCcOn(false);
      }
    };
    rec.onend = () => {
      // Chrome stops recognition periodically — restart while captions are on
      if (ccOnRef.current && recRef.current === rec) {
        try { rec.start(); } catch {}
      }
    };

    try { rec.start(); } catch {}
    toast(`Live captions on (${rec.lang}) — listening via microphone`);

    return () => {
      rec.onend = null;
      try { rec.stop(); } catch {}
      if (recRef.current === rec) recRef.current = null;
    };
  }, [ccOn, language]);

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
          e.preventDefault();
          togglePlay();
          break;
        case 'm': case 'M':
          setMutedAndSync(!muted);
          break;
        case 'f': case 'F':
          toggleFullscreen();
          break;
        case 'c': case 'C':
          setCcOn(v => !v);
          break;
        case 'n': case 'N':
          if (onNextRef.current) onNextRef.current();
          break;
        case 'p': case 'P':
          if (onPrevRef.current) onPrevRef.current();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [muted]);

  const togglePlay = () => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) {
      vid.play().catch(() => {});
    } else {
      vid.pause();
    }
  };

  const handleTimebarClick = (e: MouseEvent) => {
    const vid = videoRef.current;
    if (!vid) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = x / rect.width;
    if (!isFinite(vid.duration)) return;
    vid.currentTime = pct * vid.duration;
  };

  const handleTimebarMouseMove = (e: MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = x / rect.width;
    setHoverTime(pct * duration);
    setHoverX(x);
  };

  const handleTimebarMouseLeave = () => {
    setHoverTime(null);
  };

  const resetControlsTimeout = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (playing) {
        setShowControls(false);
      }
    }, 3000);
  };

  useEffect(() => {
    window.addEventListener('mousemove', resetControlsTimeout);
    return () => window.removeEventListener('mousemove', resetControlsTimeout);
  }, [playing]);

  const formatDuration = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':').replace(/^00:/, '');
  };

  const getThumbIndex = (time: number) => {
    if (!duration) return 0;
    const pct = time / duration;
    return Math.floor(pct * 5);
  };

  return (
    <div
      ref={containerRef}
      className="advanced-player"
      style={{
        position: 'relative',
        width: '100%',
        background: '#000',
        ...(isFullscreen ? { height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' } : {})
      }}
      onMouseMove={resetControlsTimeout}
    >
      <video
        ref={videoRef}
        src={src}
        preload="auto"
        muted={muted}
        style={{ width: '100%', maxHeight: isFullscreen ? '100vh' : '80vh', display: 'block' }}
        onClick={togglePlay}
        autoPlay
      >
        {subtitles.map((t, i) => (
          <track
            key={t.type === 'embedded' ? `emb-${t.streamIndex}` : t.filename!}
            kind="subtitles"
            label={t.label}
            src={t.type === 'embedded'
              ? `/api/subtitle-embedded/${videoId}/${t.streamIndex}`
              : `/api/subtitle-file/${videoId}/${encodeURIComponent(t.filename!)}`
            }
          />
        ))}
      </video>

      {/* Loading Spinner */}
      {loading && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.3)',
          zIndex: 5
        }}>
          <div style={{
            width: '50px',
            height: '50px',
            border: '3px solid rgba(255,255,255,0.2)',
            borderTop: '3px solid #fff',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }} />
          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      )}

      {/* Live Captions Overlay */}
      {ccOn && ccText && (
        <div style={{
          position: 'absolute',
          bottom: showControls ? '90px' : '30px',
          left: '50%',
          transform: 'translateX(-50%)',
          maxWidth: '85%',
          background: 'rgba(0,0,0,0.75)',
          color: '#fff',
          padding: '6px 14px',
          borderRadius: '6px',
          fontSize: '1.05rem',
          lineHeight: 1.4,
          textAlign: 'center',
          zIndex: 6,
          pointerEvents: 'none',
          transition: 'bottom 0.3s'
        }}>
          {ccText}
        </div>
      )}

      {/* Controls Overlay */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
        padding: '20px 10px 10px 10px',
        opacity: showControls ? 1 : 0,
        transition: 'opacity 0.3s',
        pointerEvents: showControls ? 'auto' : 'none'
      }}>
        {/* Timebar */}
        <div
          className="timebar"
          style={{ height: '6px', background: 'rgba(255,255,255,0.2)', cursor: 'pointer', position: 'relative', borderRadius: '3px', marginBottom: '10px' }}
          onClick={handleTimebarClick}
          onMouseMove={handleTimebarMouseMove}
          onMouseLeave={handleTimebarMouseLeave}
        >
          {/* Buffer Display */}
          {buffered.map((r, i) => (
            <div key={i} style={{
              position: 'absolute',
              left: `${(r.start / duration) * 100}%`,
              width: `${((r.end - r.start) / duration) * 100}%`,
              height: '100%',
              background: 'rgba(255,255,255,0.2)',
              borderRadius: '3px'
            }} />
          ))}

          <div className="progress" style={{ width: `${(currentTime / duration) * 100}%`, height: '100%', background: 'var(--ac, #ff4a4a)', borderRadius: '3px', position: 'relative', zIndex: 1 }} />

          {/* Hover Preview */}
          {hoverTime !== null && (
            <div style={{
              position: 'absolute',
              left: `${hoverX}px`,
              bottom: '15px',
              transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.8)',
              padding: '4px',
              borderRadius: '4px',
              color: '#fff',
              fontSize: '0.8rem',
              whiteSpace: 'nowrap',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              zIndex: 10
            }}>
              <img
                src={`/api/thumbs/${videoId}/${getThumbIndex(hoverTime)}`}
                alt=""
                style={{ width: '120px', height: 'auto', borderRadius: '2px' }}
                onError={(e: any) => e.target.style.display = 'none'}
              />
              <span>{formatDuration(hoverTime)}</span>
            </div>
          )}

          {/* Chapter Markers */}
          {chapters.map(c => (
            <div key={c.id} style={{
              position: 'absolute',
              left: `${(c.time / duration) * 100}%`,
              top: 0,
              width: '2px',
              height: '100%',
              background: 'rgba(255,255,255,0.7)',
              zIndex: 2
            }} title={c.title} />
          ))}
        </div>

        {/* Control Buttons */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <button onClick={togglePlay} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '1.2rem' }}>
              {playing ? '⏸' : '▶'}
            </button>
            <button onClick={onPrev} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>⏮</button>
            <button onClick={() => setLocalZap(!localZap)} style={{ background: 'none', border: 'none', color: localZap ? 'var(--ac, #ff4a4a)' : '#fff', cursor: 'pointer', fontSize: '1.2rem' }} title="Local Zap Mode">⚡</button>
            <button onClick={onNext} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>⏭</button>
            <span style={{ fontSize: '0.9rem' }}>{formatDuration(currentTime)} / {formatDuration(duration)}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            {/* Volume */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <button onClick={() => setMutedAndSync(!muted)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>
                {muted || volume === 0 ? '🔇' : '🔊'}
              </button>
              <input
                type="range"
                title="Volume"
                min="0"
                max="1"
                step="0.05"
                value={muted ? 0 : volume}
                onChange={(e: any) => {
                  setVolume(parseFloat(e.target.value));
                  localStorage.setItem('playerVolume', e.target.value);
                  if (muted) setMutedAndSync(false);
                }}
                style={{ width: '80px', cursor: 'pointer' }}
              />
            </div>

            {/* Subtitle picker */}
            {subtitles.length > 0 && (
              <div ref={subPickerRef} style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => setShowSubPicker(v => !v)}
                  title="Subtitles"
                  style={{ background: 'none', border: selectedSubIdx !== null ? '1px solid var(--ac, #ff4a4a)' : '1px solid rgba(255,255,255,0.4)', borderRadius: '3px', color: selectedSubIdx !== null ? 'var(--ac, #ff4a4a)' : '#fff', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700, padding: '2px 6px' }}
                >
                  SUB
                </button>
                {showSubPicker && (
                  <div style={{ position: 'absolute', bottom: '28px', right: 0, background: 'rgba(20,20,20,0.97)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', minWidth: '160px', zIndex: 20, overflow: 'hidden' }}>
                    <div
                      onClick={() => { setSelectedSubIdx(null); setShowSubPicker(false); }}
                      style={{ padding: '7px 12px', fontSize: '0.8rem', cursor: 'pointer', color: selectedSubIdx === null ? 'var(--ac, #ff4a4a)' : '#fff', background: selectedSubIdx === null ? 'rgba(255,255,255,0.07)' : 'none' }}
                    >
                      None
                    </div>
                    {subtitles.map((t, i) => (
                      <div
                        key={i}
                        onClick={() => { setSelectedSubIdx(i); setShowSubPicker(false); }}
                        style={{ padding: '7px 12px', fontSize: '0.8rem', cursor: 'pointer', color: selectedSubIdx === i ? 'var(--ac, #ff4a4a)' : '#fff', background: selectedSubIdx === i ? 'rgba(255,255,255,0.07)' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                      >
                        {t.type === 'embedded' ? '⬡ ' : ''}{t.label}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Live Captions */}
            <button
              onClick={() => setCcOn(v => !v)}
              title={`Live captions${language ? ` (${language})` : ''} — generated with speech recognition through the microphone; play audio through speakers`}
              style={{ background: 'none', border: ccOn ? '1px solid var(--ac, #ff4a4a)' : '1px solid rgba(255,255,255,0.4)', borderRadius: '3px', color: ccOn ? 'var(--ac, #ff4a4a)' : '#fff', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700, padding: '2px 6px' }}
            >
              CC
            </button>

            {/* Speed */}
            <select
              value={playbackSpeed}
              title="Playback speed"
              onChange={(e: any) => setPlaybackSpeed(parseFloat(e.target.value))}
              style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', borderRadius: '3px', padding: '2px 5px', cursor: 'pointer' }}
            >
              <option value="0.5">0.5x</option>
              <option value="1">1x</option>
              <option value="1.25">1.25x</option>
              <option value="1.5">1.5x</option>
              <option value="2">2x</option>
            </select>

            <button onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen (f)' : 'Fullscreen (f)'} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>
              {isFullscreen ? '🡼' : '⛶'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
