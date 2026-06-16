import { useState, useEffect, useRef } from 'preact/hooks';
import { loadVideos, appPrefs, refreshLibraryQuietly, isLoadingVideos } from '../../store';

interface ScraperStatus {
  running: boolean;
  done?: number;
  total?: number;
  failed?: number;
  current?: string;
  skipped?: number;
}

interface EncProgress {
  running: boolean;
  type: string;
  category: string;
  total: number;
  done: number;
  current: string;
}

interface WorkerStatus {
  active: boolean;
  task: string;
  detail: string;
  enabled?: boolean;
}

function ProgressBar({ done = 0, total = 0, color = 'var(--ac)' }: { done?: number; total?: number; color?: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div style={{ height: '3px', background: 'var(--bg3)', borderRadius: '2px', overflow: 'hidden', marginTop: '2px' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.4s' }} />
    </div>
  );
}

function ScraperRow({
  label, icon, status, onStart, onStop, extraActions, disabled,
}: {
  label: string;
  icon: preact.JSX.Element;
  status: ScraperStatus;
  onStart: () => void;
  onStop?: () => void;
  extraActions?: preact.JSX.Element;
  disabled?: boolean;
}) {
  const { running, done = 0, total = 0, current } = status;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div style={{ padding: '9px 14px', borderBottom: '1px solid var(--brd)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        <span style={{ color: 'var(--tx3)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>{icon}</span>
        <span style={{ flex: 1, fontSize: '0.8rem', fontWeight: 500 }}>{label}</span>
        {running ? (
          <>
            <span style={{ fontSize: '0.72rem', color: 'var(--tx3)' }}>
              {total > 0 ? `${done}/${total} (${pct}%)` : 'running…'}
            </span>
            {onStop && (
              <button
                onClick={onStop}
                title="Stop"
                style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '4px', padding: '2px 7px', fontSize: '0.72rem', cursor: 'pointer' }}
              >
                Stop
              </button>
            )}
          </>
        ) : (
          <>
            {extraActions}
            <button
              onClick={onStart}
              disabled={disabled}
              style={{ background: disabled ? 'var(--bg3)' : 'var(--ac)', color: disabled ? 'var(--tx3)' : '#fff', border: 'none', borderRadius: '4px', padding: '2px 8px', fontSize: '0.72rem', cursor: disabled ? 'default' : 'pointer' }}
            >
              Start
            </button>
          </>
        )}
      </div>
      {running && total > 0 && <ProgressBar done={done} total={total} />}
      {running && current && (
        <div style={{ fontSize: '0.68rem', color: 'var(--tx3)', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={current}>
          {current}
        </div>
      )}
    </div>
  );
}

export const SyncManager = () => {
  const [open, setOpen] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [scrapers, setScrapers] = useState<{
    videoThumbs: ScraperStatus;
    bmMeta: ScraperStatus;
    bmThumbs: ScraperStatus;
    reencode: ScraperStatus;
    whisper: ScraperStatus & { enabled?: boolean };
    sceneDetect: ScraperStatus;
    categorizerJob: ScraperStatus;
  }>({
    videoThumbs: { running: false },
    bmMeta: { running: false },
    bmThumbs: { running: false },
    reencode: { running: false },
    whisper: { running: false, enabled: true },
    sceneDetect: { running: false },
    categorizerJob: { running: false },
  });
  const [encProgress, setEncProgress] = useState<EncProgress>({
    running: false, type: '', category: '', total: 0, done: 0, current: '',
  });
  const [worker, setWorker] = useState<WorkerStatus>({ active: false, task: '', detail: '' });
  const wrapRef = useRef<HTMLDivElement>(null);
  const prevEncRunning = useRef(false);
  const prevCatRunning = useRef(false);

  useEffect(() => {
    const poll = async () => {
      try {
        const [vtRes, bmMetaRes, bmThRes, encRes, reencRes, whisperRes, sceneRes, workerRes, catRes] = await Promise.all([
          fetch('/api/gen-thumbs/poll'),
          fetch('/api/links/scrape-status'),
          fetch('/api/links/thumb-status'),
          fetch('/api/encryption/status'),
          fetch('/api/reencode/poll'),
          fetch('/api/gen-whisper/poll'),
          fetch('/api/gen-chapters/poll'),
          fetch('/api/background-worker/poll'),
          fetch('/api/categorizer/poll'),
        ]);
        const vt   = vtRes.ok    ? await vtRes.json()    : { running: false };
        const bm   = bmMetaRes.ok ? await bmMetaRes.json() : { running: false };
        const bt   = bmThRes.ok  ? await bmThRes.json()  : { running: false };
        const reenc = reencRes.ok ? await reencRes.json() : { running: false };
        const wh   = whisperRes.ok ? await whisperRes.json() : { running: false, enabled: true };
        const scene = sceneRes.ok ? await sceneRes.json() : { running: false };
        const cat  = catRes.ok ? await catRes.json() : { running: false };
        setScrapers({ videoThumbs: vt, bmMeta: bm, bmThumbs: bt, reencode: reenc, whisper: wh, sceneDetect: scene, categorizerJob: cat });
        setWorker(workerRes.ok ? await workerRes.json() : { active: false, task: '', detail: '' });
        if (prevCatRunning.current && !cat.running) refreshLibraryQuietly();
        prevCatRunning.current = cat.running;
        if (encRes.ok) {
          const enc = await encRes.json();
          // Detect transition from running → done
          if (prevEncRunning.current && !enc.running) {
            if (enc.ok) {
              const w = window as any;
              if (w.toast) w.toast('Encryption complete');
              // Quietly re-sync all video-derived surfaces (grid, search, home
              // widgets, recent/history) without the loading-skeleton flash, so
              // the encrypted video disappears everywhere — not just the grid —
              // regardless of which entry point started the job.
              refreshLibraryQuietly();
            } else if (enc.error) {
              const w = window as any;
              if (w.toast) w.toast('Encryption error: ' + enc.error);
            }
          }
          prevEncRunning.current = enc.running;
          setEncProgress(enc);
        }
      } catch {}
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const activeCount = [scrapers.videoThumbs, scrapers.bmMeta, scrapers.bmThumbs, scrapers.reencode, scrapers.whisper, scrapers.sceneDetect, scrapers.categorizerJob].filter(s => s.running).length
    + (rescanning ? 1 : 0) + (encProgress.running ? 1 : 0) + (worker.active ? 1 : 0);

  const scraperAction = async (url: string, method = 'POST') => {
    await fetch(url, { method }).catch(() => {});
  };

  const stopAll = async () => {
    const stops: Promise<void>[] = [];
    if (scrapers.videoThumbs.running) stops.push(scraperAction('/api/gen-thumbs/stop'));
    if (scrapers.bmMeta.running) stops.push(scraperAction('/api/links/stop-scraping'));
    if (scrapers.bmThumbs.running) stops.push(scraperAction('/api/links/stop-generating'));
    if (scrapers.reencode.running) stops.push(scraperAction('/api/reencode/stop'));
    if (scrapers.sceneDetect.running) stops.push(scraperAction('/api/gen-chapters/stop'));
    if (scrapers.whisper.running) stops.push(scraperAction('/api/gen-whisper/stop'));
    if (worker.enabled) stops.push(scraperAction('/api/background-worker/stop'));
    if (stops.length) await Promise.all(stops);
  };

  const startExclusive = async (startUrl: string) => {
    await stopAll();
    await scraperAction(startUrl);
  };

  const iconThumb = (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
    </svg>
  );
  const iconLink = (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
    </svg>
  );
  const iconActor = (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
    </svg>
  );
  const iconRescan = (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/>
      <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
    </svg>
  );
  const iconLock = (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  );
  const iconScene = (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
      <line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/>
      <line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/>
      <line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>
    </svg>
  );

  return (
    <>
      <div style={{ position: 'relative' }} ref={wrapRef}>
        <button
          class={open ? 'on' : ''}
          title="Sync & Background Tasks"
          onClick={() => setOpen(v => !v)}
          style={{ position: 'relative' }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/>
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
          </svg>
          {activeCount > 0 && (
            <span style={{
              position: 'absolute', top: '-5px', right: '-5px',
              background: 'var(--ac)', color: '#fff', borderRadius: '50%',
              fontSize: '9px', width: '14px', height: '14px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, pointerEvents: 'none',
            }}>
              {activeCount}
            </span>
          )}
        </button>

        {open && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
            background: 'var(--bg2)', border: '1px solid var(--brd)',
            borderRadius: '10px', width: '320px', zIndex: 9999,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--brd)' }}>
              <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>Sync & Background Tasks</span>
            </div>

            {/* Background Worker — always shown as first row */}
            <div style={{ padding: '9px 14px', borderBottom: '1px solid var(--brd)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <span style={{ color: worker.enabled ? 'var(--ac)' : 'var(--tx3)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                  </svg>
                </span>
                <span style={{ flex: 1, fontSize: '0.8rem', fontWeight: 500 }}>
                  {worker.active ? (worker.task || 'Working…') : 'Background Worker'}
                </span>
                {worker.enabled ? (
                  <>
                    {!worker.active && <span style={{ fontSize: '0.72rem', color: 'var(--tx3)' }}>idle</span>}
                    <button
                      type="button"
                      onClick={() => scraperAction('/api/background-worker/stop')}
                      style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '4px', padding: '2px 7px', fontSize: '0.72rem', cursor: 'pointer' }}
                    >Stop</button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => startExclusive('/api/background-worker/start')}
                    disabled={isLoadingVideos.value}
                    style={{ background: isLoadingVideos.value ? 'var(--bg3)' : 'var(--ac)', color: isLoadingVideos.value ? 'var(--tx3)' : '#fff', border: 'none', borderRadius: '4px', padding: '2px 8px', fontSize: '0.72rem', cursor: isLoadingVideos.value ? 'default' : 'pointer' }}
                  >Start</button>
                )}
              </div>
              {worker.active && worker.detail && (
                <div style={{ fontSize: '0.68rem', color: 'var(--tx3)', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={worker.detail}>
                  {worker.detail}
                </div>
              )}
            </div>

            <ScraperRow
              label="Video Thumbnails"
              icon={iconThumb}
              status={scrapers.videoThumbs}
              onStart={() => startExclusive('/api/gen-thumbs/start')}
              onStop={() => scraperAction('/api/gen-thumbs/stop')}
              disabled={isLoadingVideos.value}
            />

            <ScraperRow
              label="Link Metadata"
              icon={iconLink}
              status={scrapers.bmMeta}
              onStart={() => startExclusive('/api/links/start-scraping')}
              onStop={() => scraperAction('/api/links/stop-scraping')}
              disabled={isLoadingVideos.value}
              extraActions={
                <button
                  onClick={() => scraperAction('/api/links/rescrape-all')}
                  style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '4px', padding: '2px 6px', fontSize: '0.68rem', cursor: 'pointer' }}
                >
                  Rescrape all
                </button>
              }
            />

            <ScraperRow
              label="Link Thumbnails"
              icon={iconThumb}
              status={scrapers.bmThumbs}
              onStart={() => startExclusive('/api/links/generate-all')}
              onStop={() => scraperAction('/api/links/stop-generating')}
              disabled={isLoadingVideos.value}
            />

            <ScraperRow
              label="Re-encode to H.265"
              icon={
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                </svg>
              }
              status={scrapers.reencode}
              onStart={() => startExclusive('/api/reencode/start')}
              onStop={() => scraperAction('/api/reencode/stop')}
              disabled={isLoadingVideos.value}
            />

            <ScraperRow
              label="Scene Detection"
              icon={iconScene}
              status={scrapers.sceneDetect}
              onStart={() => startExclusive('/api/gen-chapters/start')}
              onStop={() => scraperAction('/api/gen-chapters/stop')}
              disabled={isLoadingVideos.value}
            />

            {/* Whisper Subtitles — shown only when running, like Encryption */}
            {scrapers.whisper.running && (
              <div style={{ padding: '9px 14px', borderBottom: '1px solid var(--brd)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <span style={{ color: 'var(--tx3)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                      <line x1="9" y1="10" x2="15" y2="10"/><line x1="9" y1="14" x2="13" y2="14"/>
                    </svg>
                  </span>
                  <span style={{ flex: 1, fontSize: '0.8rem', fontWeight: 500 }}>Generating Subtitles</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--tx3)' }}>
                    {(scrapers.whisper.total ?? 0) > 0 ? `${scrapers.whisper.done ?? 0}/${scrapers.whisper.total}` : '…'}
                  </span>
                  <button
                    type="button"
                    onClick={() => scraperAction('/api/gen-whisper/stop')}
                    title="Stop"
                    style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '4px', padding: '2px 7px', fontSize: '0.72rem', cursor: 'pointer' }}
                  >Stop</button>
                </div>
                {(scrapers.whisper.total ?? 0) > 0 && <ProgressBar done={scrapers.whisper.done} total={scrapers.whisper.total} />}
                {scrapers.whisper.current && (
                  <div style={{ fontSize: '0.68rem', color: 'var(--tx3)', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={scrapers.whisper.current}>
                    {scrapers.whisper.current}
                  </div>
                )}
              </div>
            )}

            {/* Actor Data */}
            <div style={{ padding: '9px 14px', display: 'flex', alignItems: 'center', gap: '7px', borderBottom: '1px solid var(--brd)' }}>
              <span style={{ color: 'var(--tx3)', display: 'flex', alignItems: 'center' }}>{iconActor}</span>
              <span style={{ flex: 1, fontSize: '0.8rem', fontWeight: 500 }}>Actor Data</span>
              <button
                onClick={() => startExclusive('/api/actors/scrape-missing')}
                disabled={isLoadingVideos.value}
                style={{ background: isLoadingVideos.value ? 'var(--bg3)' : 'var(--ac)', color: isLoadingVideos.value ? 'var(--tx3)' : '#fff', border: 'none', borderRadius: '4px', padding: '2px 8px', fontSize: '0.72rem', cursor: isLoadingVideos.value ? 'default' : 'pointer' }}
              >
                Start
              </button>
            </div>

            {/* ── Encryption Progress ── */}
            {encProgress.running && (
              <div style={{ padding: '9px 14px', borderBottom: '1px solid var(--brd)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <span style={{ color: 'var(--tx3)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>{iconLock}</span>
                  <span style={{ flex: 1, fontSize: '0.8rem', fontWeight: 500 }}>
                    {encProgress.type === 'encrypt' ? 'Encrypting' : 'Decrypting'} ({encProgress.category})
                  </span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--tx3)' }}>
                    {encProgress.total > 0 ? `${encProgress.done}/${encProgress.total}` : '…'}
                  </span>
                  <button
                    onClick={() => fetch('/api/encryption/stop', { method: 'POST' }).catch(() => {})}
                    title="Stop"
                    style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '4px', padding: '2px 7px', fontSize: '0.72rem', cursor: 'pointer' }}
                  >
                    Stop
                  </button>
                </div>
                {encProgress.total > 0 && <ProgressBar done={encProgress.done} total={encProgress.total} />}
                {encProgress.current && (
                  <div style={{ fontSize: '0.68rem', color: 'var(--tx3)', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={encProgress.current}>
                    {encProgress.current}
                  </div>
                )}
              </div>
            )}

            {/* ── Categorizer Progress ── */}
            {scrapers.categorizerJob.running && (
              <div style={{ padding: '9px 14px', borderBottom: '1px solid var(--brd)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <span style={{ color: 'var(--tx3)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                      <polyline points="12 9 9 12 12 15"/><line x1="16" y1="12" x2="9" y2="12"/>
                    </svg>
                  </span>
                  <span style={{ flex: 1, fontSize: '0.8rem', fontWeight: 500 }}>Moving videos…</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--tx3)' }}>
                    {(scrapers.categorizerJob.total ?? 0) > 0
                      ? `${scrapers.categorizerJob.done ?? 0}/${scrapers.categorizerJob.total}`
                      : '…'}
                  </span>
                  <button
                    type="button"
                    onClick={() => scraperAction('/api/categorizer/stop')}
                    title="Stop"
                    style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '4px', padding: '2px 7px', fontSize: '0.72rem', cursor: 'pointer' }}
                  >Stop</button>
                </div>
                {(scrapers.categorizerJob.total ?? 0) > 0 && (
                  <ProgressBar done={scrapers.categorizerJob.done} total={scrapers.categorizerJob.total} />
                )}
              </div>
            )}

            {/* Local Videos Rescan */}
            <div style={{ padding: '9px 14px', display: 'flex', alignItems: 'center', gap: '7px' }}>
              <span style={{ color: 'var(--tx3)', display: 'flex', alignItems: 'center' }}>{iconRescan}</span>
              <span style={{ flex: 1, fontSize: '0.8rem', fontWeight: 500 }}>Local Videos</span>
              <button
                disabled={rescanning || isLoadingVideos.value}
                onClick={async () => {
                  await stopAll();
                  setRescanning(true);
                  try {
                    await fetch('/api/videos/rescan', { method: 'POST' });
                    await loadVideos();
                    const w = window as any;
                    if (w.toast) w.toast('Rescan complete');
                  } catch {}
                  setRescanning(false);
                }}
                style={{ background: (rescanning || isLoadingVideos.value) ? 'var(--bg3)' : 'var(--ac)', color: (rescanning || isLoadingVideos.value) ? 'var(--tx3)' : '#fff', border: 'none', borderRadius: '4px', padding: '2px 8px', fontSize: '0.72rem', cursor: (rescanning || isLoadingVideos.value) ? 'default' : 'pointer' }}
              >
                {rescanning ? 'Scanning…' : 'Start'}
              </button>
            </div>
          </div>
        )}
      </div>

    </>
  );
};