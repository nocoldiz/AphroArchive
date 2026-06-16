import { useEffect, useRef, useState } from 'preact/hooks';
import { isMuted as isMutedSignal } from '../../store';
import { getProgress, setProgress } from '../../home/progress';
import { isTVMode, tvChannels, tvCurrentChannelIdx, tvFavChannels, toggleTVFav, nextTVChannel, prevTVChannel, playChannel } from '../../tv-mode';

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
  hlsSrc?: string;
  videoId: string;
  subtitles: Subtitle[];
  chapters: Chapter[];
  autoChapters?: Chapter[];
  onNext?: () => void;
  onPrev?: () => void;
  isMuted?: boolean;
  videoRef?: any;
  startTime?: number;
  language?: string;
  title?: string;
}

function loadHlsJs(): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w.Hls) return resolve(w.Hls);
    const script = document.createElement('script');
    script.src = '/hls.js';
    script.onload = () => resolve(w.Hls);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

const clampVol = (v: number) => Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;

// Per-video volume memory: loud/quiet videos can be pre-adjusted without
// touching the global level. Falls back to the last global volume.
const loadSavedVolume = (videoId?: string) => {
  if (videoId) {
    const per = localStorage.getItem(`vol:${videoId}`);
    if (per !== null) return clampVol(parseFloat(per));
  }
  return clampVol(parseFloat(localStorage.getItem('playerVolume') || '1'));
};

export const AdvancedPlayer = ({ src, hlsSrc, videoId, subtitles, chapters, autoChapters = [], onNext, onPrev, isMuted = false, videoRef: externalRef, startTime = 0, language = '', title = '' }: AdvancedPlayerProps) => {
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
  const [volume, setVolume] = useState(() => loadSavedVolume(videoId));
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
  const [loopA, setLoopA] = useState<number | null>(null);
  const [loopB, setLoopB] = useState<number | null>(null);
  const loopARef = useRef<number | null>(null);
  const loopBRef = useRef<number | null>(null);
  const controlsTimeoutRef = useRef<any>(null);
  const seekHoldRef = useRef<{ dir: string; since: number }>({ dir: '', since: 0 });
  const recRef = useRef<any>(null);
  const subPickerRef = useRef<HTMLDivElement>(null);
  const ccOnRef = useRef(false);
  const chaptersRef = useRef(chapters);
  const autoChaptersRef = useRef(autoChapters);
  const selectedSubIdxRef = useRef(selectedSubIdx);
  const [usingHls, setUsingHls] = useState(false);
  const hlsInstanceRef = useRef<any>(null);
  const [audioTracks, setAudioTracks] = useState<{ index: number; language: string; title: string; codec: string; channels: number }[]>([]);
  const [selectedAudio, setSelectedAudio] = useState(0);
  const [showChannelPicker, setShowChannelPicker] = useState(false);
  const [showTVFavs, setShowTVFavs] = useState(false);
  const [showChaptersDropdown, setShowChaptersDropdown] = useState(false);
  const channelPickerRef = useRef<HTMLDivElement>(null);
  const tvFavsRef = useRef<HTMLDivElement>(null);
  const chapterDropdownRef = useRef<HTMLDivElement>(null);

  const activeHlsSrc = hlsSrc
    ? (selectedAudio > 0 ? `${hlsSrc.split('?')[0]}?audio=${selectedAudio}` : hlsSrc)
    : undefined;

  useEffect(() => {
    setAudioTracks([]);
    setSelectedAudio(0);
    if (!videoId) return;
    fetch(`/api/audio-tracks/${videoId}`)
      .then(r => r.json())
      .then(d => { if (d.tracks && d.tracks.length > 1) setAudioTracks(d.tracks); })
      .catch(() => {});
  }, [videoId]);

  useEffect(() => {
    if (!usingHls || !activeHlsSrc) return;
    const vid = videoRef.current;
    if (!vid) return;

    const attach = (Hls: any) => {
      if (hlsInstanceRef.current) { hlsInstanceRef.current.destroy(); hlsInstanceRef.current = null; }
      if (!Hls.isSupported()) { toast('HLS not supported in this browser'); setUsingHls(false); return; }
      const hls = new Hls({ enableWorker: false });
      hlsInstanceRef.current = hls;
      hls.loadSource(activeHlsSrc);
      hls.attachMedia(vid);
      hls.on(Hls.Events.MANIFEST_PARSED, () => vid.play().catch(() => {}));
      hls.on(Hls.Events.ERROR, (_: any, data: any) => { if (data.fatal) toast('HLS error: ' + data.details); });
    };

    // Safari supports HLS natively — just point src directly
    if (vid.canPlayType('application/vnd.apple.mpegurl')) {
      vid.src = activeHlsSrc;
      vid.play().catch(() => {});
      return;
    }

    loadHlsJs().then(attach).catch(() => { toast('Failed to load HLS player'); setUsingHls(false); });

    return () => {
      if (hlsInstanceRef.current) { hlsInstanceRef.current.destroy(); hlsInstanceRef.current = null; }
    };
  }, [usingHls, activeHlsSrc]);
  const onNextRef = useRef(onNext);
  const onPrevRef = useRef(onPrev);
  useEffect(() => { onNextRef.current = onNext; });
  useEffect(() => { onPrevRef.current = onPrev; });
  useEffect(() => { loopARef.current = loopA; }, [loopA]);
  useEffect(() => { loopBRef.current = loopB; }, [loopB]);
  useEffect(() => { chaptersRef.current = chapters; }, [chapters]);
  useEffect(() => { autoChaptersRef.current = autoChapters; }, [autoChapters]);
  useEffect(() => { selectedSubIdxRef.current = selectedSubIdx; }, [selectedSubIdx]);

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
      const a = loopARef.current;
      const b = loopBRef.current;
      if (a !== null && b !== null && vid.currentTime >= b) {
        vid.currentTime = a;
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
      // Remember this video's preferred level for next time.
      localStorage.setItem(`vol:${videoId}`, String(vid.volume));
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

  // ── Media Session ───────────────────────────────────────────────────
  // Populate the OS/browser media overlay with title, artwork and controls.
  useEffect(() => {
    const ms = (navigator as any).mediaSession;
    if (!ms || typeof (window as any).MediaMetadata === 'undefined') return;
    try {
      ms.metadata = new (window as any).MediaMetadata({
        title: title || 'AphroArchive',
        artist: 'AphroArchive',
        artwork: [{ src: `/api/thumbs/${videoId}/0`, sizes: '480x270', type: 'image/jpeg' }],
      });
    } catch {}

    const vid = () => videoRef.current;
    const set = (action: string, handler: any) => { try { ms.setActionHandler(action, handler); } catch {} };
    set('play', () => vid()?.play().catch(() => {}));
    set('pause', () => vid()?.pause());
    set('previoustrack', onPrevRef.current ? () => onPrevRef.current!() : null);
    set('nexttrack', onNextRef.current ? () => onNextRef.current!() : null);
    set('seekbackward', (d: any) => { const v = vid(); if (v) v.currentTime = Math.max(0, v.currentTime - (d.seekOffset || 10)); });
    set('seekforward', (d: any) => { const v = vid(); if (v) v.currentTime = Math.min(v.duration || Infinity, v.currentTime + (d.seekOffset || 10)); });
    set('seekto', (d: any) => { const v = vid(); if (v && d.seekTime != null) v.currentTime = d.seekTime; });

    return () => {
      ['play', 'pause', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward', 'seekto'].forEach(a => set(a, null));
    };
  }, [title, videoId]);

  // Reflect play/pause in the OS media overlay.
  useEffect(() => {
    const ms = (navigator as any).mediaSession;
    if (ms) ms.playbackState = playing ? 'playing' : 'paused';
  }, [playing]);

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

  useEffect(() => {
    if (!showChannelPicker) return;
    const onDown = (e: MouseEvent) => {
      if (channelPickerRef.current && !channelPickerRef.current.contains(e.target as Node)) {
        setShowChannelPicker(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showChannelPicker]);

  useEffect(() => {
    if (!showTVFavs) return;
    const onDown = (e: MouseEvent) => {
      if (tvFavsRef.current && !tvFavsRef.current.contains(e.target as Node)) {
        setShowTVFavs(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showTVFavs]);

  useEffect(() => {
    if (!showChaptersDropdown) return;
    const onDown = (e: MouseEvent) => {
      if (chapterDropdownRef.current && !chapterDropdownRef.current.contains(e.target as Node)) {
        setShowChaptersDropdown(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showChaptersDropdown]);

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

      // While an arrow is held the OS fires repeated keydowns. Ramp the seek
      // step up the longer it's held: ×2 after 1s, ×4 after 2s.
      const seekStep = (dir: 'left' | 'right') => {
        const now = Date.now();
        if (seekHoldRef.current.dir !== dir) seekHoldRef.current = { dir, since: now };
        const held = now - seekHoldRef.current.since;
        const mult = held > 2000 ? 4 : held > 1000 ? 2 : 1;
        return 10 * mult * (dir === 'right' ? 1 : -1);
      };

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) {
            const all = [...chaptersRef.current, ...autoChaptersRef.current].sort((a, b) => a.time - b.time);
            const prev = [...all].reverse().find(c => c.time < vid.currentTime - 1);
            vid.currentTime = prev ? prev.time : 0;
          } else {
            vid.currentTime = Math.max(0, vid.currentTime + seekStep('left'));
          }
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) {
            const all = [...chaptersRef.current, ...autoChaptersRef.current].sort((a, b) => a.time - b.time);
            const next = all.find(c => c.time > vid.currentTime + 0.5);
            if (next) vid.currentTime = next.time;
          } else {
            vid.currentTime = Math.min(vid.duration || Infinity, vid.currentTime + seekStep('right'));
          }
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
          setSelectedSubIdx(v => v !== null ? null : 0);
          break;
        case 'n': case 'N':
          if (isTVMode.value) nextTVChannel(); else if (onNextRef.current) onNextRef.current();
          break;
        case 'p': case 'P':
          if (isTVMode.value) prevTVChannel(); else if (onPrevRef.current) onPrevRef.current();
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        seekHoldRef.current = { dir: '', since: 0 };
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
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
        src={usingHls ? undefined : src}
        preload="auto"
        muted={muted}
        style={{ width: '100%', maxHeight: isFullscreen ? '100vh' : '80vh', display: 'block' }}
        onClick={togglePlay}
        onDblClick={(e: any) => { e.preventDefault(); toggleFullscreen(); }}
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

          {/* User chapter markers — always visible */}
          {chapters.map(c => (
            <div key={c.id} style={{
              position: 'absolute',
              left: `${(c.time / duration) * 100}%`,
              top: 0,
              width: '2px',
              height: '100%',
              background: 'rgba(255,255,255,0.85)',
              zIndex: 3
            }} title={c.title} />
          ))}
          {/* Auto-detected chapter markers — distinct cyan colour */}
          {autoChapters.map(c => (
            <div key={c.id} style={{
              position: 'absolute',
              left: `${(c.time / duration) * 100}%`,
              top: '15%',
              width: '2px',
              height: '70%',
              background: 'rgba(80,200,255,0.7)',
              zIndex: 2
            }} title={`Auto: ${c.title}`} />
          ))}
          {/* A/B loop markers */}
          {loopA !== null && duration > 0 && (
            <div style={{ position: 'absolute', left: `${(loopA / duration) * 100}%`, top: 0, width: '3px', height: '100%', background: '#4ade80', zIndex: 4 }} title={`A: ${formatDuration(loopA)}`} />
          )}
          {loopB !== null && duration > 0 && (
            <div style={{ position: 'absolute', left: `${(loopB / duration) * 100}%`, top: 0, width: '3px', height: '100%', background: '#f87171', zIndex: 4 }} title={`B: ${formatDuration(loopB)}`} />
          )}
        </div>

        {/* Control Buttons */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <button onClick={togglePlay} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '1.2rem' }}>
              {playing ? '⏸' : '▶'}
            </button>
            <button onClick={() => isTVMode.value ? prevTVChannel() : onPrev?.()} title={isTVMode.value ? 'Prev channel (P)' : 'Previous'} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>⏮</button>
            <button onClick={() => setLocalZap(!localZap)} style={{ background: 'none', border: 'none', color: localZap ? 'var(--ac, #ff4a4a)' : '#fff', cursor: 'pointer', fontSize: '1.2rem' }} title="Local Zap Mode">⚡</button>
            <button onClick={() => isTVMode.value ? nextTVChannel() : onNext?.()} title={isTVMode.value ? 'Next channel (N)' : 'Next'} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>⏭</button>
            <span style={{ fontSize: '0.9rem' }}>{formatDuration(currentTime)} / {formatDuration(duration)}</span>
            <button
              onClick={() => { setLoopA(currentTime); if (loopB !== null && currentTime >= loopB) setLoopB(null); }}
              title="Set loop start (A)"
              style={{ background: loopA !== null ? 'rgba(74,222,128,0.25)' : 'none', border: loopA !== null ? '1px solid #4ade80' : '1px solid rgba(255,255,255,0.3)', color: loopA !== null ? '#4ade80' : '#fff', borderRadius: '3px', padding: '1px 6px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 }}
            >
              {loopA !== null ? `A ${formatDuration(loopA)}` : 'A'}
            </button>
            <button
              onClick={() => { setLoopB(currentTime); if (loopA !== null && currentTime <= loopA) setLoopA(null); }}
              title="Set loop end (B)"
              style={{ background: loopB !== null ? 'rgba(248,113,113,0.25)' : 'none', border: loopB !== null ? '1px solid #f87171' : '1px solid rgba(255,255,255,0.3)', color: loopB !== null ? '#f87171' : '#fff', borderRadius: '3px', padding: '1px 6px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 }}
            >
              {loopB !== null ? `B ${formatDuration(loopB)}` : 'B'}
            </button>
            {(loopA !== null || loopB !== null) && (
              <button
                onClick={() => { setLoopA(null); setLoopB(null); }}
                title="Clear A/B loop"
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '0.8rem', padding: '0 2px' }}
              >✕</button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            {/* TV Mode — channel picker + fav dropdown */}
            {isTVMode.value && (() => {
              const channels = tvChannels.value;
              const curIdx = tvCurrentChannelIdx.value;
              const curCh = channels[curIdx];
              const favIds = tvFavChannels.value;
              const favChannels = channels.filter(c => favIds.has(c.id));
              return (
                <>
                  {/* Favourites quick-access */}
                  {favChannels.length > 0 && (
                    <div ref={tvFavsRef} style={{ position: 'relative' }}>
                      <button
                        type="button"
                        onClick={() => { setShowTVFavs(v => !v); setShowChannelPicker(false); }}
                        title="Favourite channels"
                        style={{ background: showTVFavs ? 'rgba(255,200,0,0.25)' : 'none', border: showTVFavs ? '1px solid #ffd700' : '1px solid rgba(255,255,255,0.4)', borderRadius: '3px', color: showTVFavs ? '#ffd700' : '#fff', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700, padding: '2px 6px' }}
                      >
                        ★
                      </button>
                      {showTVFavs && (
                        <div style={{ position: 'absolute', bottom: '28px', right: 0, background: 'rgba(20,20,20,0.97)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', minWidth: '180px', zIndex: 20, overflow: 'hidden' }}>
                          <div style={{ padding: '6px 10px 4px', fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Favourites</div>
                          {favChannels.map((ch, i) => (
                            <div
                              key={ch.id}
                              onClick={() => { const idx = channels.indexOf(ch); if (idx !== -1) playChannel(idx); setShowTVFavs(false); }}
                              style={{ padding: '7px 10px', fontSize: '0.82rem', cursor: 'pointer', color: ch.id === (channels[curIdx]?.id) ? 'var(--ac, #ff4a4a)' : '#fff', background: ch.id === (channels[curIdx]?.id) ? 'rgba(255,255,255,0.07)' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}
                            >
                              <span>{ch.name}</span>
                              <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', flexShrink: 0 }}>{ch.videos.length}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Channel name + full picker */}
                  <div ref={channelPickerRef} style={{ position: 'relative' }}>
                    <button
                      type="button"
                      onClick={() => { setShowChannelPicker(v => !v); setShowTVFavs(false); }}
                      title="Channel picker"
                      style={{ background: showChannelPicker ? 'rgba(var(--ac-rgb,255,74,74),0.2)' : 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.25)', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600, padding: '3px 8px', display: 'flex', alignItems: 'center', gap: '5px', maxWidth: '150px' }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="15" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {curCh ? `${curIdx + 1}. ${curCh.name}` : 'TV'}
                      </span>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}><path d="m6 9 6 6 6-6"/></svg>
                    </button>
                    {showChannelPicker && (
                      <div style={{ position: 'absolute', bottom: '30px', right: 0, background: 'rgba(15,15,15,0.98)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', width: '240px', maxHeight: '360px', overflowY: 'auto', zIndex: 25 }}>
                        <div style={{ padding: '8px 10px 4px', fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.8px', position: 'sticky', top: 0, background: 'rgba(15,15,15,0.98)' }}>
                          All Channels — {channels.length}
                        </div>
                        {channels.map((ch, i) => (
                          <div
                            key={ch.id}
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', background: i === curIdx ? 'rgba(255,255,255,0.07)' : 'none', borderLeft: i === curIdx ? '2px solid var(--ac, #ff4a4a)' : '2px solid transparent' }}
                          >
                            <button
                              type="button"
                              onClick={() => toggleTVFav(ch.id)}
                              title={favIds.has(ch.id) ? 'Remove from favourites' : 'Add to favourites'}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: favIds.has(ch.id) ? '#ffd700' : 'rgba(255,255,255,0.25)', fontSize: '0.85rem', padding: '0', flexShrink: 0, lineHeight: 1 }}
                            >
                              ★
                            </button>
                            <div
                              onClick={() => { playChannel(i); setShowChannelPicker(false); }}
                              style={{ flex: 1, cursor: 'pointer', fontSize: '0.82rem', color: i === curIdx ? 'var(--ac, #ff4a4a)' : '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', justifyContent: 'space-between', gap: '6px' }}
                            >
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{i + 1}. {ch.name}</span>
                              <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)', flexShrink: 0 }}>{ch.videos.length}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}

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

            {/* Audio track selector */}
            {audioTracks.length > 1 && (
              <select
                value={selectedAudio}
                title="Audio track"
                onChange={(e: any) => {
                  const n = parseInt(e.target.value, 10);
                  setSelectedAudio(n);
                  if (n > 0 && !usingHls) setUsingHls(true);
                }}
                style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: selectedAudio > 0 ? '1px solid var(--ac, #ff4a4a)' : 'none', borderRadius: '3px', padding: '2px 5px', cursor: 'pointer', fontSize: '0.75rem' }}
              >
                {audioTracks.map(t => (
                  <option key={t.index} value={t.index} style={{ background: '#222' }}>
                    {t.title || t.language || `Track ${t.index + 1}`}
                  </option>
                ))}
              </select>
            )}

            {/* CC — toggle subtitle track visibility, only shown when subs are available */}
            {subtitles.length > 0 && (
              <button
                onClick={() => setSelectedSubIdx(v => v !== null ? null : 0)}
                title={selectedSubIdx !== null ? 'Hide subtitles (C)' : 'Show subtitles (C)'}
                style={{ background: 'none', border: selectedSubIdx !== null ? '1px solid var(--ac, #ff4a4a)' : '1px solid rgba(255,255,255,0.4)', borderRadius: '3px', color: selectedSubIdx !== null ? 'var(--ac, #ff4a4a)' : '#fff', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700, padding: '2px 6px' }}
              >
                CC
              </button>
            )}

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

            {hlsSrc && (
              <button
                type="button"
                onClick={() => setUsingHls(v => !v)}
                title={usingHls ? 'Switch back to direct stream' : 'Transcode via HLS (for unsupported formats)'}
                style={{ background: usingHls ? 'rgba(var(--ac-rgb,255,74,74),0.2)' : 'none', border: usingHls ? '1px solid var(--ac, #ff4a4a)' : '1px solid rgba(255,255,255,0.4)', borderRadius: '3px', color: usingHls ? 'var(--ac, #ff4a4a)' : '#fff', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700, padding: '2px 6px' }}
              >
                HLS
              </button>
            )}

            {/* Chapters dropdown */}
            {(chapters.length > 0 || autoChapters.length > 0) && (() => {
              const allChaps = [
                ...chapters.map(c => ({ ...c, isAuto: false })),
                ...autoChapters.map(c => ({ ...c, isAuto: true })),
              ].sort((a, b) => a.time - b.time);
              return (
                <div ref={chapterDropdownRef} style={{ position: 'relative' }}>
                  <button
                    type="button"
                    onClick={() => setShowChaptersDropdown(v => !v)}
                    title="Chapters"
                    style={{ background: showChaptersDropdown ? 'rgba(var(--ac-rgb,255,74,74),0.2)' : 'none', border: showChaptersDropdown ? '1px solid var(--ac, #ff4a4a)' : '1px solid rgba(255,255,255,0.4)', borderRadius: '3px', color: showChaptersDropdown ? 'var(--ac, #ff4a4a)' : '#fff', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700, padding: '2px 6px', display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                    {allChaps.length}
                  </button>
                  {showChaptersDropdown && (
                    <div style={{ position: 'absolute', bottom: '34px', right: 0, background: 'rgba(12,12,12,0.97)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', width: '260px', maxHeight: '400px', overflowY: 'auto', zIndex: 30 }}>
                      <div style={{ padding: '7px 10px 4px', fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.8px', position: 'sticky', top: 0, background: 'rgba(12,12,12,0.97)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                        Chapters — {allChaps.length}
                      </div>
                      {allChaps.map(c => (
                        <div
                          key={c.id}
                          onClick={() => {
                            const vid = videoRef.current;
                            if (vid) { vid.currentTime = c.time; vid.play().catch(() => {}); }
                            setShowChaptersDropdown(false);
                          }}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                          onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.07)'}
                          onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                        >
                          <img
                            src={`/api/thumbs/${videoId}/chapter/${c.id}`}
                            alt=""
                            style={{ width: '72px', height: '40px', objectFit: 'cover', borderRadius: '3px', flexShrink: 0, background: 'rgba(255,255,255,0.05)' }}
                            onError={(e: any) => { e.target.style.display = 'none'; }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '0.8rem', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              {c.isAuto && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'rgba(80,200,255,0.9)', display: 'inline-block', flexShrink: 0 }} />}
                              {c.title}
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', marginTop: '2px', fontVariantNumeric: 'tabular-nums' }}>{formatDuration(c.time)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            <button type="button" onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen (f)' : 'Fullscreen (f)'} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>
              {isFullscreen ? '🡼' : '⛶'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
