import { useEffect, useRef, useState } from 'preact/hooks';

interface Chapter {
  id: string;
  title: string;
  time: number;
}

interface Subtitle {
  filename: string;
  label: string;
}

interface AdvancedPlayerProps {
  src: string;
  videoId: string;
  subtitles: Subtitle[];
  chapters: Chapter[];
  onNext?: () => void;
  onPrev?: () => void;
  isMuted?: boolean;
  videoRef?: any; // Allow passing external ref
}

export const AdvancedPlayer = ({ src, videoId, subtitles, chapters, onNext, onPrev, isMuted = false, videoRef: externalRef }: AdvancedPlayerProps) => {
  const localRef = useRef<HTMLVideoElement>(null);
  const videoRef = externalRef || localRef;
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(isMuted);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showControls, setShowControls] = useState(true);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const [buffered, setBuffered] = useState<{ start: number; end: number }[]>([]);
  const controlsTimeoutRef = useRef<any>(null);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTimeUpdate = () => setCurrentTime(vid.currentTime);
    const onDurationChange = () => setDuration(vid.duration);
    const onVolumeChange = () => {
      setVolume(vid.volume);
      setMuted(vid.muted);
    };
    const onEnded = () => {
      if (onNext) onNext();
    };
    const onProgress = () => {
      const buf = vid.buffered;
      const ranges = [];
      for (let i = 0; i < buf.length; i++) {
        ranges.push({ start: buf.start(i), end: buf.end(i) });
      }
      setBuffered(ranges);
    };

    vid.addEventListener('play', onPlay);
    vid.addEventListener('pause', onPause);
    vid.addEventListener('timeupdate', onTimeUpdate);
    vid.addEventListener('durationchange', onDurationChange);
    vid.addEventListener('volumechange', onVolumeChange);
    vid.addEventListener('ended', onEnded);
    vid.addEventListener('progress', onProgress);

    return () => {
      vid.removeEventListener('play', onPlay);
      vid.removeEventListener('pause', onPause);
      vid.removeEventListener('timeupdate', onTimeUpdate);
      vid.removeEventListener('durationchange', onDurationChange);
      vid.removeEventListener('volumechange', onVolumeChange);
      vid.removeEventListener('ended', onEnded);
      vid.removeEventListener('progress', onProgress);
    };
  }, [onNext]);

  useEffect(() => {
    const vid = videoRef.current;
    if (vid) {
      vid.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  useEffect(() => {
    const vid = videoRef.current;
    if (vid) {
      vid.volume = volume;
      vid.muted = muted;
    }
  }, [volume, muted]);

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
          setMuted(!muted);
          break;
        case 'f': case 'F':
          toggleFullscreen();
          break;
        case 'n': case 'N':
          if (onNext) onNext();
          break;
        case 'p': case 'P':
          if (onPrev) onPrev();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [muted, onNext, onPrev]);

  const togglePlay = () => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) {
      vid.play();
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

  const toggleFullscreen = () => {
    const container = videoRef.current?.parentElement;
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

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
    <div className="advanced-player" style={{ position: 'relative', width: '100%', background: '#000' }} onMouseMove={resetControlsTimeout}>
      <video
        ref={videoRef}
        src={src}
        style={{ width: '100%', maxHeight: '80vh', display: 'block' }}
        onClick={togglePlay}
        autoPlay
      >
        {subtitles.map((t, i) => (
          <track
            key={t.filename}
            kind="subtitles"
            label={t.label}
            src={`/api/subtitle-file/${videoId}/${encodeURIComponent(t.filename)}`}
            default={i === 0}
          />
        ))}
      </video>

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
            <button onClick={onNext} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>⏭</button>
            <span style={{ fontSize: '0.9rem' }}>{formatDuration(currentTime)} / {formatDuration(duration)}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            {/* Volume */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <button onClick={() => setMuted(!muted)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>
                {muted || volume === 0 ? '🔇' : '🔊'}
              </button>
              <input 
                type="range" 
                min="0" 
                max="1" 
                step="0.05" 
                value={muted ? 0 : volume} 
                onChange={(e: any) => {
                  setVolume(parseFloat(e.target.value));
                  if (muted) setMuted(false);
                }} 
                style={{ width: '80px', cursor: 'pointer' }}
              />
            </div>
            
            {/* Speed */}
            <select 
              value={playbackSpeed} 
              onChange={(e: any) => setPlaybackSpeed(parseFloat(e.target.value))}
              style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', borderRadius: '3px', padding: '2px 5px', cursor: 'pointer' }}
            >
              <option value="0.5">0.5x</option>
              <option value="1">1x</option>
              <option value="1.25">1.25x</option>
              <option value="1.5">1.5x</option>
              <option value="2">2x</option>
            </select>

            <button onClick={toggleFullscreen} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>🔲</button>
          </div>
        </div>
      </div>
    </div>
  );
};
