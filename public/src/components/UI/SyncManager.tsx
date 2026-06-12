import { useState, useEffect, useRef } from 'preact/hooks';
import { loadVideos } from '../../store';

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

function ProgressBar({ done = 0, total = 0, color = 'var(--ac)' }: { done?: number; total?: number; color?: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div style={{ height: '3px', background: 'var(--bg3)', borderRadius: '2px', overflow: 'hidden', marginTop: '2px' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.4s' }} />
    </div>
  );
}

function ScraperRow({
  label, icon, status, onStart, onStop, extraActions,
}: {
  label: string;
  icon: preact.JSX.Element;
  status: ScraperStatus;
  onStart: () => void;
  onStop?: () => void;
  extraActions?: preact.JSX.Element;
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
              style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '4px', padding: '2px 8px', fontSize: '0.72rem', cursor: 'pointer' }}
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
  }>({
    videoThumbs: { running: false },
    bmMeta: { running: false },
    bmThumbs: { running: false },
  });
  const [encProgress, setEncProgress] = useState<EncProgress>({
    running: false, type: '', category: '', total: 0, done: 0, current: '',
  });
  const wrapRef = useRef<HTMLDivElement>(null);
  const prevEncRunning = useRef(false);

  useEffect(() => {
    const poll = async () => {
      try {
        const [vtRes, bmMetaRes, bmThRes, encRes] = await Promise.all([
          fetch('/api/gen-thumbs/poll'),
          fetch('/api/links/scrape-status'),
          fetch('/api/links/thumb-status'),
          fetch('/api/encryption/status'),
        ]);
        const vt = vtRes.ok ? await vtRes.json() : { running: false };
        const bm = bmMetaRes.ok ? await bmMetaRes.json() : { running: false };
        const bt = bmThRes.ok ? await bmThRes.json() : { running: false };
        setScrapers({ videoThumbs: vt, bmMeta: bm, bmThumbs: bt });
        if (encRes.ok) {
          const enc = await encRes.json();
          // Detect transition from running → done
          if (prevEncRunning.current && !enc.running) {
            if (enc.ok) {
              const w = window as any;
              if (w.toast) w.toast('Encryption complete');
              loadVideos();
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

  const activeCount = [scrapers.videoThumbs, scrapers.bmMeta, scrapers.bmThumbs].filter(s => s.running).length
    + (rescanning ? 1 : 0) + (encProgress.running ? 1 : 0);

  const scraperAction = async (url: string, method = 'POST') => {
    await fetch(url, { method }).catch(() => {});
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

            <ScraperRow
              label="Video Thumbnails"
              icon={iconThumb}
              status={scrapers.videoThumbs}
              onStart={() => scraperAction('/api/gen-thumbs/start')}
              onStop={() => scraperAction('/api/gen-thumbs/stop')}
            />

            <ScraperRow
              label="Link Metadata"
              icon={iconLink}
              status={scrapers.bmMeta}
              onStart={() => scraperAction('/api/links/start-scraping')}
              onStop={() => scraperAction('/api/links/stop-scraping')}
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
              onStart={() => scraperAction('/api/links/generate-all')}
              onStop={() => scraperAction('/api/links/stop-generating')}
            />

            {/* Actor Data */}
            <div style={{ padding: '9px 14px', display: 'flex', alignItems: 'center', gap: '7px', borderBottom: '1px solid var(--brd)' }}>
              <span style={{ color: 'var(--tx3)', display: 'flex', alignItems: 'center' }}>{iconActor}</span>
              <span style={{ flex: 1, fontSize: '0.8rem', fontWeight: 500 }}>Actor Data</span>
              <button
                onClick={() => scraperAction('/api/actors/scrape-missing')}
                style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '4px', padding: '2px 8px', fontSize: '0.72rem', cursor: 'pointer' }}
              >
                Scrape missing
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

            {/* Local Videos Rescan */}
            <div style={{ padding: '9px 14px', display: 'flex', alignItems: 'center', gap: '7px' }}>
              <span style={{ color: 'var(--tx3)', display: 'flex', alignItems: 'center' }}>{iconRescan}</span>
              <span style={{ flex: 1, fontSize: '0.8rem', fontWeight: 500 }}>Local Videos</span>
              <button
                disabled={rescanning}
                onClick={async () => {
                  setRescanning(true);
                  try {
                    await fetch('/api/videos/rescan', { method: 'POST' });
                    await loadVideos();
                    const w = window as any;
                    if (w.toast) w.toast('Rescan complete');
                  } catch {}
                  setRescanning(false);
                }}
                style={{ background: rescanning ? 'var(--bg3)' : 'var(--ac)', color: rescanning ? 'var(--tx3)' : '#fff', border: 'none', borderRadius: '4px', padding: '2px 8px', fontSize: '0.72rem', cursor: rescanning ? 'default' : 'pointer' }}
              >
                {rescanning ? 'Scanning…' : 'Rescan'}
              </button>
            </div>
          </div>
        )}
      </div>

    </>
  );
};