import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { isMuted as isMutedSignal, appPrefs } from '../../store';
import { getProgress, setProgress } from '../../home/progress';
import { isTVMode, tvChannels, tvCurrentChannelIdx, tvFavChannels, toggleTVFav, nextTVChannel, prevTVChannel, playChannel } from '../../tv-mode';
import {
  Chapter,
  formatTimecode,
  mergeChapters,
  findNextChapter,
  findPrevChapter,
  loopWrapTarget,
  pickPreviewThumb,
  chapterAt,
  clampPreviewX,
  deriveSkipMarkers,
  activeSkip,
  SkipMarkers,
} from '../../player/playerLogic';

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

// Approx width (px) of the scrub-preview tooltip, used to keep it on-screen.
const PREVIEW_W = 140;

// Local Zap: skip randomly forward through the current video, then roll on to
// the next video in the playlist. Held in module-level signals (not component
// state) so the mode survives the per-video remount and keeps zapping across
// videos until turned off. `localZapSeconds === null` means a random 8–20s gap.
export const localZapOn = signal(false);
export const localZapSeconds = signal<number | null>(null);

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
  // Live TV tunes in at the broadcast position (even 0) and never resumes from
  // saved progress. Otherwise, resume from saved progress when no explicit start
  // time was requested.
  const startTimeRef = useRef(isTVMode.value ? startTime : (startTime || (() => {
    const p = getProgress(videoId);
    return p && p.t < p.d * 0.97 ? p.t : 0;
  })()));
  // Whether this playback began as a TV broadcast — TV never writes resume
  // progress, including the final save on unmount (by which time TV mode may
  // already have been switched off).
  const tvPlaybackRef = useRef(isTVMode.value);
  const lastSaveRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // Intro-end / credits-start markers derived from auto-detected scene
  // boundaries. Held in a ref too so the []-deps timeupdate handler can read the
  // latest values without re-subscribing. `autoSkipCreditsDoneRef` guards the
  // "always skip" auto-advance so onNext fires only once per credits region.
  const [skipMarkers, setSkipMarkers] = useState<SkipMarkers>({ introEnd: null, creditsStart: null });
  const skipMarkersRef = useRef<SkipMarkers>(skipMarkers);
  const autoSkipCreditsDoneRef = useRef(false);
  const [volume, setVolume] = useState(() => loadSavedVolume(videoId));
  const [muted, setMuted] = useState(isMuted);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showControls, setShowControls] = useState(true);
  // Seed from the current document fullscreen state so a player remounting into
  // an already-fullscreen wrapper (next/prev video) knows it's fullscreen.
  const [isFullscreen, setIsFullscreen] = useState(() => {
    const fsEl = document.fullscreenElement || (document as any).webkitFullscreenElement;
    return !!fsEl && !!(fsEl as HTMLElement).classList?.contains('video-player-wrap');
  });
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  // Chapter ticks that are briefly pulsing because the playhead just crossed
  // them (id → true). `prevTimeRef` remembers the last playhead position so a
  // crossing can be detected on each timeupdate; per-tick removal timers live in
  // `pulseTimersRef` so they aren't torn down by the frequent currentTime effect.
  const [pulsingChapters, setPulsingChapters] = useState<Set<string>>(new Set());
  const prevTimeRef = useRef(0);
  const pulseTimersRef = useRef<Record<string, any>>({});
  const [buffered, setBuffered] = useState<{ start: number; end: number }[]>([]);
  const [loading, setLoading] = useState(false);
  // Auto-recovery: transient load failures (404 race on a fresh stream, network
  // blip, mid-buffer stall) used to leave a blank player until a full page
  // reload. Instead we silently re-fetch the source a few times, only surfacing
  // a manual retry overlay once the budget is exhausted.
  const [loadError, setLoadError] = useState(false);
  const retryTimerRef = useRef<any>(null);
  const retryCountRef = useRef(0);
  const stallTimerRef = useRef<any>(null);
  const [ccOn, setCcOn] = useState(false);
  const [ccText, setCcText] = useState('');
  const [selectedSubIdx, setSelectedSubIdx] = useState<number | null>(null);
  const [showSubPicker, setShowSubPicker] = useState(false);
  const [loopA, setLoopA] = useState<number | null>(null);
  const [loopB, setLoopB] = useState<number | null>(null);
  // A/B repeat is tucked behind a single loop toggle; the A/B/clear controls
  // only appear once the user opens it.
  const [showAbLoop, setShowAbLoop] = useState(false);
  const loopARef = useRef<number | null>(null);
  const loopBRef = useRef<number | null>(null);
  const controlsTimeoutRef = useRef<any>(null);
  const showControlsRef = useRef(true);
  const seekHoldRef = useRef<{ dir: string; since: number }>({ dir: '', since: 0 });
  const recRef = useRef<any>(null);
  const subPickerRef = useRef<HTMLDivElement>(null);
  const ccOnRef = useRef(false);
  const chaptersRef = useRef(chapters);
  const autoChaptersRef = useRef(autoChapters);
  const selectedSubIdxRef = useRef(selectedSubIdx);
  // Default to direct range-streaming: instant start, no server-side transcode.
  // HLS (ffmpeg transcode) is a fallback for formats the browser can't decode
  // natively — engaged automatically on a media error, or manually via the HLS
  // button / a non-default audio track.
  const [usingHls, setUsingHls] = useState(false);
  const hlsInstanceRef = useRef<any>(null);
  const prevUsingHlsRef = useRef(false);
  const triedHlsFallbackRef = useRef(false);
  // Live mirror of `usingHls` so the mount-time recovery closures read the
  // current transcode mode rather than the stale value captured at mount.
  const usingHlsRef = useRef(false);
  useEffect(() => { usingHlsRef.current = usingHls; }, [usingHls]);
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
      hls.on(Hls.Events.ERROR, (_: any, data: any) => {
        if (!data.fatal) return;
        // Try hls.js's built-in recovery first; only if that's not applicable do
        // we tear HLS down and drop back to direct streaming, so a transcode
        // hiccup never leaves the player stuck forever.
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) { try { hls.startLoad(); return; } catch {} }
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { try { hls.recoverMediaError(); return; } catch {} }
        try { hls.destroy(); } catch {}
        if (hlsInstanceRef.current === hls) hlsInstanceRef.current = null;
        toast('HLS error: ' + data.details);
        setUsingHls(false);
      });
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

  // When HLS falls back to direct stream (e.g. hls.js unavailable), the src
  // just got set but the initial vid.play() already ran and failed (no src at
  // the time). Explicitly restart playback so the video isn't stuck black.
  useEffect(() => {
    const was = prevUsingHlsRef.current;
    prevUsingHlsRef.current = usingHls;
    if (was && !usingHls) {
      const vid = videoRef.current;
      if (!vid || !src) return;
      vid.play().catch(() => {
        if (!vid.muted) { vid.muted = true; vid.play().catch(() => {}); }
      });
    }
  }, [usingHls]);
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

  const MAX_RELOAD_RETRIES = 4;

  // Re-fetch the current source from scratch, preserving the playback position
  // so a transient failure doesn't lose the user's place.
  const reloadStream = () => {
    const vid = videoRef.current;
    if (!vid || usingHlsRef.current) return;
    const resumeAt = vid.currentTime || 0;
    setLoading(true);
    // Abort the stalled request first: a bare load() would queue a *second*
    // request behind the hung one inside the browser's connection pool.
    const currentSrc = vid.getAttribute('src') || src;
    try { vid.pause(); } catch {}
    try { vid.removeAttribute('src'); vid.load(); } catch {}
    if (currentSrc) { try { vid.src = currentSrc; } catch {} }
    try { vid.load(); } catch {}
    const onLoaded = () => {
      vid.removeEventListener('loadedmetadata', onLoaded);
      if (resumeAt > 0.5) { try { vid.currentTime = resumeAt; } catch {} }
      vid.play().catch(() => {
        if (!vid.muted) { vid.muted = true; setMuted(true); isMutedSignal.value = true; vid.play().catch(() => {}); }
      });
    };
    vid.addEventListener('loadedmetadata', onLoaded);
  };

  // Direct-stream load/stall failure → retry a few times with linear backoff
  // before giving up and surfacing the manual retry overlay.
  const handleLoadFailure = () => {
    if (usingHlsRef.current) return; // HLS errors are surfaced via their own toast
    if (retryTimerRef.current) return; // a retry is already pending
    if (retryCountRef.current >= MAX_RELOAD_RETRIES) { setLoading(false); setLoadError(true); return; }
    retryCountRef.current++;
    const delay = 400 * retryCountRef.current;
    setLoading(true);
    retryTimerRef.current = setTimeout(() => { retryTimerRef.current = null; reloadStream(); }, delay);
  };

  const manualRetry = () => {
    retryCountRef.current = 0;
    setLoadError(false);
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    reloadStream();
  };

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    // Initial-load watchdog: occasionally a fresh stream never fires
    // loadedmetadata/canplay/error at all (server slow to send headers, a
    // dropped first request) and the player just sits blank — the bug that
    // used to force a full page reload. If nothing has loaded within the
    // budget, kick the same auto-retry path instead of waiting forever.
    let firstLoadTimer: any = setTimeout(() => {
      firstLoadTimer = null;
      if (!usingHlsRef.current && vid.readyState < 1) handleLoadFailure();
    }, 9000);
    const clearFirstLoad = () => {
      if (firstLoadTimer) { clearTimeout(firstLoadTimer); firstLoadTimer = null; }
    };

    const onPlay = () => setPlaying(true);
    const onPause = () => {
      setPlaying(false);
      if (!isTVMode.value) setProgress(videoId, vid.currentTime, vid.duration || 0);
    };
    const onTimeUpdate = () => {
      setCurrentTime(vid.currentTime);
      const now = Date.now();
      if (!isTVMode.value && now - lastSaveRef.current > 4000) {
        lastSaveRef.current = now;
        setProgress(videoId, vid.currentTime, vid.duration || 0);
      }
      const wrapTo = loopWrapTarget(vid.currentTime, loopARef.current, loopBRef.current);
      if (wrapTo !== null) vid.currentTime = wrapTo;

      // "Always skip intro & credits": jump past the intro on sight, and roll on
      // to the next video once the credits start. The manual button (rendered
      // from `skipMarkers`) covers the same regions when the pref is off.
      if (appPrefs.value?.autoSkipIntroCredits && !isTVMode.value) {
        const skip = activeSkip(skipMarkersRef.current, vid.currentTime, vid.duration || 0);
        if (skip?.kind === 'intro') {
          vid.currentTime = skip.seekTo;
        } else if (skip?.kind === 'credits' && !autoSkipCreditsDoneRef.current) {
          autoSkipCreditsDoneRef.current = true;
          if (onNextRef.current) onNextRef.current();
        }
      }
    };
    const onDurationChange = () => setDuration(vid.duration);
    const onLoadedMetadata = () => {
      clearFirstLoad();
      setDuration(vid.duration);
      if (startTimeRef.current > 0) {
        let t = startTimeRef.current;
        // The TV schedule counts unknown-duration videos as 300s, so its
        // tune-in offset can overshoot the real runtime. Seeking past the end
        // clamps there and fires 'ended', which rolls to the next programme
        // from 0 — wrap into the real duration so tune-in lands mid-stream.
        const dur = vid.duration;
        if (Number.isFinite(dur) && dur > 0 && t >= dur - 1) {
          t = t % dur;
          if (t >= dur - 1) t = 0;
        }
        vid.currentTime = t;
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
    // Stall watchdog: if the element gets stuck buffering and the playback
    // position stops advancing, force a reload instead of leaving it frozen.
    const clearStall = () => {
      if (stallTimerRef.current) { clearTimeout(stallTimerRef.current); stallTimerRef.current = null; }
    };
    const armStall = () => {
      if (stallTimerRef.current || usingHlsRef.current) return;
      const at = vid.currentTime;
      stallTimerRef.current = setTimeout(() => {
        stallTimerRef.current = null;
        // Only intervene if we're genuinely stuck (not paused, no progress, not ended).
        if (!vid.paused && !vid.ended && vid.currentTime <= at + 0.1 && vid.readyState < 3) {
          handleLoadFailure();
        }
      }, 12000);
    };
    const onWaiting = () => { setLoading(true); armStall(); };
    const onStalled = () => armStall();
    const onCanPlay = () => { clearFirstLoad(); setLoading(false); clearStall(); retryCountRef.current = 0; setLoadError(false); };
    const onPlaying = () => { clearFirstLoad(); setLoading(false); clearStall(); };

    vid.addEventListener('play', onPlay);
    vid.addEventListener('pause', onPause);
    vid.addEventListener('timeupdate', onTimeUpdate);
    vid.addEventListener('durationchange', onDurationChange);
    vid.addEventListener('loadedmetadata', onLoadedMetadata);
    vid.addEventListener('volumechange', onVolumeChange);
    vid.addEventListener('ended', onEnded);
    vid.addEventListener('progress', onProgress);
    vid.addEventListener('waiting', onWaiting);
    vid.addEventListener('stalled', onStalled);
    vid.addEventListener('playing', onPlaying);
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
      if (!tvPlaybackRef.current && !isTVMode.value) setProgress(videoId, vid.currentTime, vid.duration || 0);
      clearStall();
      clearFirstLoad();
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
      vid.removeEventListener('play', onPlay);
      vid.removeEventListener('pause', onPause);
      vid.removeEventListener('timeupdate', onTimeUpdate);
      vid.removeEventListener('durationchange', onDurationChange);
      vid.removeEventListener('loadedmetadata', onLoadedMetadata);
      vid.removeEventListener('volumechange', onVolumeChange);
      vid.removeEventListener('ended', onEnded);
      vid.removeEventListener('progress', onProgress);
      vid.removeEventListener('waiting', onWaiting);
      vid.removeEventListener('stalled', onStalled);
      vid.removeEventListener('playing', onPlaying);
      vid.removeEventListener('canplay', onCanPlay);
      // Release the media connection NOW. Leaving a detached <video> (or a live
      // HLS loader) holding an open/stalled stream socket leaks a connection;
      // after a handful of switches the browser's per-host connection cap is
      // exhausted and every later video hangs "forever" until a full reload.
      if (hlsInstanceRef.current) { try { hlsInstanceRef.current.destroy(); } catch {} hlsInstanceRef.current = null; }
      try { vid.pause(); vid.removeAttribute('src'); vid.load(); } catch {}
    };
  }, []);

  useEffect(() => {
    const vid = videoRef.current;
    if (vid) {
      vid.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  // Recompute skip markers whenever the auto-chapters or duration change (a new
  // video, or scene detection finishing mid-playback). Reset the credits guard
  // so the fresh markers can auto-advance again.
  useEffect(() => {
    const m = deriveSkipMarkers(autoChapters, duration);
    setSkipMarkers(m);
    skipMarkersRef.current = m;
    autoSkipCreditsDoneRef.current = false;
  }, [autoChapters, duration]);

  // Universal last-resort watchdog: whenever the spinner is up, give it a hard
  // deadline. If we're still not playing by then, force a recovery path instead
  // of spinning forever — this catches the cases the metadata/stall watchdogs
  // miss (notably HLS, which the others deliberately skip).
  useEffect(() => {
    if (!loading) return;
    const vid = videoRef.current;
    if (!vid) return;
    const at = vid.currentTime;
    const t = setTimeout(() => {
      if (vid.readyState >= 3 && !vid.paused && vid.currentTime > at + 0.1) { setLoading(false); return; }
      if (usingHlsRef.current) {
        const hls = hlsInstanceRef.current;
        if (hls) { try { hls.startLoad(); } catch {} }
        else { setUsingHls(false); setLoading(false); }
        return;
      }
      handleLoadFailure();
    }, 15000);
    return () => clearTimeout(t);
  }, [loading]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !localZapOn.value) return;

    let timer: any;
    // Gap before the next skip: a fixed value from the selector, or a random
    // 8–20s when left on "Random".
    const nextDelay = () => {
      const fixed = localZapSeconds.value;
      const secs = fixed && fixed > 0 ? fixed : 8 + Math.random() * 12;
      return secs * 1000;
    };
    const tick = () => {
      if (!vid.paused) {
        const remaining = vid.duration - vid.currentTime;
        const minJump = 5;
        const maxJump = remaining - 5;
        if (!isFinite(vid.duration) || maxJump <= minJump) {
          // No room left to jump forward — advance to the next video in the
          // playlist and keep zapping there (the mode persists across remount).
          onNextRef.current?.();
          return;
        }
        vid.currentTime = vid.currentTime + minJump + Math.random() * (maxJump - minJump);
      }
      timer = setTimeout(tick, nextDelay());
    };
    timer = setTimeout(tick, nextDelay());

    return () => clearTimeout(timer);
  }, [localZapOn.value]);

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
  // Fullscreen the stable outer wrapper (.video-player-wrap) rather than this
  // per-video container: the wrapper isn't remounted when the video changes, so
  // fullscreen survives next/prev and auto-advance. Falls back to the container
  // when there's no such wrapper (e.g. the immersive Zap view).
  const getFsTarget = (): HTMLElement | null => {
    const el = containerRef.current;
    if (!el) return null;
    return (el.closest('.video-player-wrap') as HTMLElement) || el;
  };
  useEffect(() => {
    const onFsChange = () => {
      const fsEl = document.fullscreenElement || (document as any).webkitFullscreenElement;
      setIsFullscreen(!!fsEl && fsEl === getFsTarget());
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
    // Live TV can't be scrubbed from OS media controls either.
    set('seekbackward', (d: any) => { if (isTVMode.value) return; const v = vid(); if (v) v.currentTime = Math.max(0, v.currentTime - (d.seekOffset || 10)); });
    set('seekforward', (d: any) => { if (isTVMode.value) return; const v = vid(); if (v) v.currentTime = Math.min(v.duration || Infinity, v.currentTime + (d.seekOffset || 10)); });
    set('seekto', (d: any) => { if (isTVMode.value) return; const v = vid(); if (v && d.seekTime != null) v.currentTime = d.seekTime; });

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
    const target = getFsTarget();
    if (!target) return;
    const fsEl = document.fullscreenElement || (document as any).webkitFullscreenElement;
    if (!fsEl) {
      const request = target.requestFullscreen || (target as any).webkitRequestFullscreen;
      if (!request) { toast('Fullscreen not supported'); return; }
      try {
        const p = request.call(target);
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
          if (isTVMode.value) break; // live TV — no seeking
          if (e.shiftKey) {
            const prev = findPrevChapter(mergeChapters(chaptersRef.current, autoChaptersRef.current), vid.currentTime);
            vid.currentTime = prev ? prev.time : 0;
          } else {
            vid.currentTime = Math.max(0, vid.currentTime + seekStep('left'));
          }
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (isTVMode.value) break; // live TV — no seeking
          if (e.shiftKey) {
            const next = findNextChapter(mergeChapters(chaptersRef.current, autoChaptersRef.current), vid.currentTime);
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

  // Skip back: jump to the previous chapter, or restart the current one if none precedes.
  const prevChapter = () => {
    const vid = videoRef.current;
    if (!vid) return;
    const prev = findPrevChapter(mergeChapters(chaptersRef.current, autoChaptersRef.current), vid.currentTime);
    vid.currentTime = prev ? prev.time : 0;
  };

  // Skip forward: jump to the next chapter; falls through to onNext if already past the last one.
  const nextChapter = () => {
    const vid = videoRef.current;
    if (!vid) return;
    const next = findNextChapter(mergeChapters(chaptersRef.current, autoChaptersRef.current), vid.currentTime);
    if (next) vid.currentTime = next.time;
    else onNextRef.current?.();
  };

  const handleTimebarClick = (e: MouseEvent) => {
    if (isTVMode.value) return; // live TV — you can't skip ahead of the broadcast
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
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const pct = rect.width ? x / rect.width : 0;
    setHoverTime(pct * duration);
    // Clamp the preview-box centre so it never spills past either edge of the bar.
    setHoverX(clampPreviewX(x, PREVIEW_W, rect.width));
  };

  const handleTimebarMouseLeave = () => {
    setHoverTime(null);
  };

  const resetControlsTimeout = () => {
    // Avoid a re-render on every mousemove once controls are already visible —
    // only flip state when it actually changes, then re-arm the hide timer.
    if (!showControlsRef.current) { showControlsRef.current = true; setShowControls(true); }
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (playing) {
        showControlsRef.current = false;
        setShowControls(false);
      }
    }, 3000);
  };

  // Any pointer, key or touch activity brings the controls back and re-arms the
  // 3s auto-hide. While paused the controls stay pinned open (the hide timer is
  // a no-op unless `playing`).
  useEffect(() => {
    window.addEventListener('mousemove', resetControlsTimeout);
    window.addEventListener('keydown', resetControlsTimeout);
    window.addEventListener('touchstart', resetControlsTimeout);
    return () => {
      window.removeEventListener('mousemove', resetControlsTimeout);
      window.removeEventListener('keydown', resetControlsTimeout);
      window.removeEventListener('touchstart', resetControlsTimeout);
    };
  }, [playing]);

  // Pausing reveals the controls immediately; starting playback arms the hide
  // timer so they linger for the first few seconds before fading.
  useEffect(() => {
    if (!playing) {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      showControlsRef.current = true;
      setShowControls(true);
    } else {
      resetControlsTimeout();
    }
  }, [playing]);

  useEffect(() => () => clearTimeout(controlsTimeoutRef.current), []);

  const formatDuration = formatTimecode;

  const allChaptersSorted = mergeChapters(chapters, autoChapters);
  const loopActive = loopA !== null || loopB !== null;

  // Pulse a chapter tick when the playhead crosses it during normal playback.
  // Only small forward steps count — a seek or a backward jump (delta ≤ 0 or a
  // big skip) shouldn't fire the cue. Each crossed tick flashes for 700ms.
  useEffect(() => {
    const prev = prevTimeRef.current;
    prevTimeRef.current = currentTime;
    const delta = currentTime - prev;
    if (delta <= 0 || delta > 2 || duration <= 0) return;
    const crossed = allChaptersSorted.filter(c => c.time > prev && c.time <= currentTime);
    if (!crossed.length) return;
    setPulsingChapters(prevSet => {
      const next = new Set(prevSet);
      crossed.forEach(c => next.add(c.id));
      return next;
    });
    crossed.forEach(c => {
      if (pulseTimersRef.current[c.id]) clearTimeout(pulseTimersRef.current[c.id]);
      pulseTimersRef.current[c.id] = setTimeout(() => {
        delete pulseTimersRef.current[c.id];
        setPulsingChapters(prevSet => {
          const next = new Set(prevSet);
          next.delete(c.id);
          return next;
        });
      }, 700);
    });
  }, [currentTime]);

  useEffect(() => () => {
    Object.values(pulseTimersRef.current).forEach(t => clearTimeout(t));
  }, []);

  // Netflix-style skip button: shown in the bottom-right only while the playhead
  // sits inside the detected intro or credits window. Hidden when "always skip"
  // is on, since the player auto-skips those regions itself.
  const autoSkipEnabled = !!appPrefs.value?.autoSkipIntroCredits;
  const skipTarget = (isTVMode.value || autoSkipEnabled)
    ? null
    : activeSkip(skipMarkers, currentTime, duration);
  const doSkip = () => {
    const vid = videoRef.current;
    if (!vid || !skipTarget) return;
    if (skipTarget.kind === 'credits' && onNextRef.current) onNextRef.current();
    else vid.currentTime = skipTarget.seekTo;
  };

  const getPreviewSrc = (time: number) =>
    pickPreviewThumb(videoId, time, duration, allChaptersSorted);

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
        style={{ width: '100%', maxHeight: isFullscreen ? '100vh' : '85vh', display: 'block' }}
        onClick={togglePlay}
        onDblClick={(e: any) => { e.preventDefault(); toggleFullscreen(); }}
        onError={() => {
          // Browser can't decode the original file (e.g. mkv/hevc) — fall back to
          // the HLS transcode once, but only when the user has left HLS enabled
          // in Settings → Playback. Direct streaming stays the default for the
          // common case (mp4/webm), which starts instantly without ffmpeg.
          if (!usingHls && hlsSrc && appPrefs.value.hlsTranscode !== false && !triedHlsFallbackRef.current) {
            triedHlsFallbackRef.current = true;
            setUsingHls(true);
            return;
          }
          // Otherwise it's a transient load failure (stream not ready yet, 404
          // race, network blip) — auto-retry the same source instead of leaving
          // a blank player that only a full page reload would fix.
          handleLoadFailure();
        }}
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

      {/* Load failure overlay — shown only after auto-retries are exhausted */}
      {loadError && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '14px',
          background: 'rgba(0,0,0,0.78)',
          color: '#fff',
          zIndex: 7
        }}>
          <div style={{ fontSize: '0.95rem', opacity: 0.85 }}>This video failed to load.</div>
          <button
            type="button"
            onClick={manualRetry}
            style={{ background: 'var(--ac, #ff4a4a)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 700, padding: '8px 20px', borderRadius: '6px' }}
          >
            Retry
          </button>
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

      {/* Skip intro / credits button — bottom-right, only inside the window */}
      {skipTarget && (
        <button
          type="button"
          onClick={doSkip}
          style={{
            position: 'absolute',
            right: '18px',
            bottom: showControls ? '90px' : '24px',
            zIndex: 6,
            background: 'rgba(0,0,0,0.72)',
            border: '1px solid rgba(255,255,255,0.55)',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '0.9rem',
            fontWeight: 700,
            padding: '9px 18px',
            borderRadius: '6px',
            transition: 'bottom 0.3s'
          }}
        >
          {skipTarget.kind === 'intro' ? 'Skip Intro ⏭' : 'Skip Credits ⏭'}
        </button>
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
        {/* Timebar — hidden on live TV: a broadcast has no scrubbing */}
        {!isTVMode.value && (
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
                src={getPreviewSrc(hoverTime)}
                alt=""
                style={{ width: '120px', height: 'auto', borderRadius: '2px' }}
                onError={(e: any) => e.target.style.display = 'none'}
              />
              {(() => {
                const ch = chapterAt(allChaptersSorted, hoverTime);
                return ch ? (
                  <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', color: 'rgba(255,255,255,0.7)', fontSize: '0.72rem' }}>{ch.title}</span>
                ) : null;
              })()}
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatDuration(hoverTime)}</span>
            </div>
          )}

          {/* Pulse animation for a chapter tick as the playhead crosses it */}
          <style>{`
            @keyframes chapterTickPulse {
              0%   { transform: scaleX(1) scaleY(1); box-shadow: 0 0 0 0 rgba(255,255,255,0); }
              35%  { transform: scaleX(2.6) scaleY(1.9); box-shadow: 0 0 9px 2px rgba(255,255,255,0.9); }
              100% { transform: scaleX(1) scaleY(1); box-shadow: 0 0 0 0 rgba(255,255,255,0); }
            }
          `}</style>

          {/* User chapter markers — always visible */}
          {chapters.map(c => {
            const pulsing = pulsingChapters.has(c.id);
            return (
              <div key={c.id} style={{
                position: 'absolute',
                left: `${(c.time / duration) * 100}%`,
                top: 0,
                width: '2px',
                height: '100%',
                background: 'rgba(255,255,255,0.85)',
                transformOrigin: 'center',
                zIndex: pulsing ? 5 : 3,
                animation: pulsing ? 'chapterTickPulse 0.7s ease-out' : 'none'
              }} title={c.title} />
            );
          })}
          {/* Auto-detected chapter markers — distinct cyan colour */}
          {autoChapters.map(c => {
            const pulsing = pulsingChapters.has(c.id);
            return (
              <div key={c.id} style={{
                position: 'absolute',
                left: `${(c.time / duration) * 100}%`,
                top: '15%',
                width: '2px',
                height: '70%',
                background: 'rgba(80,200,255,0.7)',
                transformOrigin: 'center',
                zIndex: pulsing ? 5 : 2,
                animation: pulsing ? 'chapterTickPulse 0.7s ease-out' : 'none'
              }} title={`Auto: ${c.title}`} />
            );
          })}
          {/* A/B loop markers */}
          {loopA !== null && duration > 0 && (
            <div style={{ position: 'absolute', left: `${(loopA / duration) * 100}%`, top: 0, width: '3px', height: '100%', background: '#4ade80', zIndex: 4 }} title={`A: ${formatDuration(loopA)}`} />
          )}
          {loopB !== null && duration > 0 && (
            <div style={{ position: 'absolute', left: `${(loopB / duration) * 100}%`, top: 0, width: '3px', height: '100%', background: '#f87171', zIndex: 4 }} title={`B: ${formatDuration(loopB)}`} />
          )}
        </div>
        )}

        {/* Control Buttons */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            {/* Previous / next video — hidden on live TV; channel switching
                lives in the channel panel, picker and N/P keys instead */}
            {!isTVMode.value && onPrev && (
              <button onClick={() => onPrevRef.current?.()} title="Previous video (P)" style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '1.1rem' }}>⏮</button>
            )}
            <button onClick={togglePlay} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '1.2rem' }}>
              {playing ? '⏸' : '▶'}
            </button>
            {!isTVMode.value && onNext && (
              <button onClick={() => onNextRef.current?.()} title="Next video (N)" style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '1.1rem' }}>⏭</button>
            )}
            {isTVMode.value ? (
              <span style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, letterSpacing: '0.5px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ff4a4a', boxShadow: '0 0 6px #ff4a4a' }} />LIVE
              </span>
            ) : (
              <span style={{ fontSize: '0.9rem' }}>{formatDuration(currentTime)} / {formatDuration(duration)}</span>
            )}

            {/* A/B repeat — single loop toggle that reveals the A/B controls */}
            <button
              onClick={() => setShowAbLoop(v => !v)}
              title={loopActive ? 'A/B repeat (active)' : 'A/B repeat'}
              style={{ background: (showAbLoop || loopActive) ? 'rgba(var(--ac-rgb,255,74,74),0.2)' : 'none', border: (showAbLoop || loopActive) ? '1px solid var(--ac, #ff4a4a)' : '1px solid rgba(255,255,255,0.4)', color: (showAbLoop || loopActive) ? 'var(--ac, #ff4a4a)' : '#fff', borderRadius: '3px', padding: '2px 6px', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>
            </button>
            {showAbLoop && (
              <>
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
                {loopActive && (
                  <button
                    onClick={() => { setLoopA(null); setLoopB(null); }}
                    title="Clear A/B loop"
                    style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '0.8rem', padding: '0 2px' }}
                  >✕</button>
                )}
              </>
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

            {/* HLS transcoding is no longer a player button — it's controlled in
                Settings → Playback and engages automatically for formats the
                browser can't decode natively. */}

            {/* Chapters — prev arrow, dropdown (labelled with the current chapter), next arrow */}
            {(chapters.length > 0 || autoChapters.length > 0) && (() => {
              const allChaps = [
                ...chapters.map(c => ({ ...c, isAuto: false })),
                ...autoChapters.map(c => ({ ...c, isAuto: true })),
              ].sort((a, b) => a.time - b.time);
              const curChap = chapterAt(allChaps, currentTime);
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                  <button type="button" onClick={prevChapter} title="Previous chapter" style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '1.3rem', lineHeight: 1, padding: '0 2px' }}>‹</button>
                  <div ref={chapterDropdownRef} style={{ position: 'relative' }}>
                  <button
                    type="button"
                    onClick={() => setShowChaptersDropdown(v => !v)}
                    title="Chapters"
                    style={{ background: showChaptersDropdown ? 'rgba(var(--ac-rgb,255,74,74),0.2)' : 'none', border: showChaptersDropdown ? '1px solid var(--ac, #ff4a4a)' : '1px solid rgba(255,255,255,0.4)', borderRadius: '3px', color: showChaptersDropdown ? 'var(--ac, #ff4a4a)' : '#fff', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700, padding: '2px 6px', display: 'flex', alignItems: 'center', gap: '4px', maxWidth: '160px' }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{curChap ? curChap.title : `${allChaps.length}`}</span>
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
                  <button type="button" onClick={nextChapter} title="Next chapter" style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '1.3rem', lineHeight: 1, padding: '0 2px' }}>›</button>
                </div>
              );
            })()}

            {/* Seconds-between-skips selector — only while Local Zap is running */}
            {localZapOn.value && (
              <select
                value={localZapSeconds.value ?? ''}
                title="Seconds before next skip"
                onChange={(e: any) => {
                  const v = e.target.value;
                  localZapSeconds.value = v === '' ? null : parseInt(v, 10);
                }}
                style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid var(--ac, #ff4a4a)', borderRadius: '3px', padding: '2px 5px', cursor: 'pointer', fontSize: '0.75rem' }}
              >
                <option value="" style={{ background: '#222' }}>Random 8–20s</option>
                <option value="5" style={{ background: '#222' }}>5s</option>
                <option value="10" style={{ background: '#222' }}>10s</option>
                <option value="15" style={{ background: '#222' }}>15s</option>
                <option value="20" style={{ background: '#222' }}>20s</option>
                <option value="30" style={{ background: '#222' }}>30s</option>
                <option value="60" style={{ background: '#222' }}>60s</option>
              </select>
            )}

            {/* Local Zap — skip randomly forward, then roll into the next video */}
            <button
              type="button"
              onClick={() => { localZapOn.value = !localZapOn.value; }}
              title="Local Zap Mode — skip forward at random, then next video"
              style={{ background: 'none', border: 'none', color: localZapOn.value ? 'var(--ac, #ff4a4a)' : '#fff', cursor: 'pointer', fontSize: '1.2rem' }}
            >⚡</button>

            <button type="button" onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen (f)' : 'Fullscreen (f)'} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>
              {isFullscreen ? '🡼' : '⛶'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
