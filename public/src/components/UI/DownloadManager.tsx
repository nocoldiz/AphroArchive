import { useState, useEffect, useRef } from 'preact/hooks';
import { categories, loadVideos } from '../../store';

interface DownloadJob {
  id: string;
  url: string;
  title: string;
  category: string;
  status: 'queued' | 'running' | 'done' | 'error';
  progress: number;
  speed?: string;
  eta?: string;
  error?: string;
  videoId?: string;
  movedTo?: string;
}

interface ScraperStatus {
  running: boolean;
  done?: number;
  total?: number;
  failed?: number;
  current?: string;
  skipped?: number;
}

interface BulkStatus {
  running: boolean;
  done: number;
  total: number;
  current: string;
  log: string[];
}

function suggestCategory(title: string, cats: any[]): string {
  const norm = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const cat of cats) {
    const key = (cat.path || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (key && norm.includes(key)) return cat.path;
  }
  return '';
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

const DL_STATUS_COLOR: Record<string, string> = {
  done: '#1a7a3a', error: '#a11', running: 'var(--ac)', queued: 'var(--bg3)',
};

export const DownloadManager = () => {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [open, setOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<Record<string, string>>({});
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
  const [bulk, setBulk] = useState<BulkStatus>({ running: false, done: 0, total: 0, current: '', log: [] });
  const [bulkUrls, setBulkUrls] = useState('');
  const [showBulkInput, setShowBulkInput] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Poll downloads + all scraper statuses + bulk
  useEffect(() => {
    const poll = async () => {
      try {
        const [dlRes, vtRes, bmMetaRes, bmThRes, blkRes] = await Promise.all([
          fetch('/api/download/jobs'),
          fetch('/api/gen-thumbs/poll'),
          fetch('/api/links/scrape-status'),
          fetch('/api/links/thumb-status'),
          fetch('/api/bulk-download/status'),
        ]);
        if (dlRes.ok) setJobs(await dlRes.json());
        const vt = vtRes.ok ? await vtRes.json() : { running: false };
        const bm = bmMetaRes.ok ? await bmMetaRes.json() : { running: false };
        const bt = bmThRes.ok ? await bmThRes.json() : { running: false };
        setScrapers({ videoThumbs: vt, bmMeta: bm, bmThumbs: bt });
        if (blkRes.ok) setBulk(await blkRes.json());
      } catch {}
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const activeDlCount = jobs.filter(j => j.status === 'queued' || j.status === 'running').length;
  const activeScraperCount = [scrapers.videoThumbs, scrapers.bmMeta, scrapers.bmThumbs].filter(s => s.running).length;
  const badgeCount = activeDlCount + activeScraperCount + (bulk.running ? 1 : 0);

  const cats = (categories.value as any[]).filter(
    c => c.path && c.path !== 'uncategorized' && c.path !== 'Links'
  );

  const removeJob = async (id: string) => {
    await fetch(`/api/download/jobs/${id}`, { method: 'DELETE' });
    setJobs(prev => prev.filter(j => j.id !== id));
  };

  const moveToCategory = async (job: DownloadJob) => {
    if (!job.videoId) return;
    const cat = moveTarget[job.id] !== undefined ? moveTarget[job.id] : suggestCategory(job.title, cats);
    const r = await fetch(`/api/videos/${job.videoId}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: cat }),
    });
    if (r.ok) {
      const w = window as any;
      if (w.toast) w.toast(`Moved to ${cat || 'root'}`);
      if (w.refresh) w.refresh(true);
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, movedTo: cat } : j));
    } else {
      const d = await r.json().catch(() => ({}));
      alert(d.error || 'Move failed');
    }
  };

  const scraperAction = async (url: string, method = 'POST') => {
    await fetch(url, { method }).catch(() => {});
  };

  const startBulkDownload = async () => {
    const urls = bulkUrls.split('\n').map(l => l.trim()).filter(l => l.startsWith('http'));
    if (!urls.length) return;
    const r = await fetch('/api/bulk-download/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
    });
    if (r.ok) { setBulkUrls(''); setShowBulkInput(false); }
  };

  const stopBulkDownload = () => fetch('/api/bulk-download/stop', { method: 'POST' }).catch(() => {});

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

  return (
    <div style={{ position: 'relative' }} ref={wrapRef}>
      <button
        class={open ? 'on' : ''}
        title="Downloads & Tasks"
        onClick={() => setOpen(v => !v)}
        style={{ position: 'relative' }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        {badgeCount > 0 && (
          <span style={{
            position: 'absolute', top: '-5px', right: '-5px',
            background: 'var(--ac)', color: '#fff', borderRadius: '50%',
            fontSize: '9px', width: '14px', height: '14px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, pointerEvents: 'none',
          }}>
            {badgeCount}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          background: 'var(--bg2)', border: '1px solid var(--brd)',
          borderRadius: '10px', width: '360px', zIndex: 9999,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>

          {/* ── Downloads section ─────────────────────────── */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--brd)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>Downloads {jobs.length > 0 && `(${jobs.length})`}</span>
            {jobs.some(j => j.status === 'done' || j.status === 'error') && (
              <button
                onClick={() => setJobs(prev => prev.filter(j => j.status === 'queued' || j.status === 'running'))}
                style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', fontSize: '0.72rem' }}
              >
                Clear finished
              </button>
            )}
          </div>

          {jobs.length === 0 ? (
            <div style={{ padding: '14px', textAlign: 'center', color: 'var(--tx3)', fontSize: '0.8rem', borderBottom: '1px solid var(--brd)' }}>
              No downloads
            </div>
          ) : (
            <div style={{ maxHeight: '260px', overflowY: 'auto', borderBottom: '1px solid var(--brd)' }}>
              {jobs.map(job => {
                const suggested = job.videoId ? suggestCategory(job.title, cats) : '';
                const target = moveTarget[job.id] !== undefined ? moveTarget[job.id] : suggested;
                const isMoved = job.movedTo !== undefined;
                return (
                  <div key={job.id} style={{ padding: '8px 14px', borderBottom: '1px solid var(--brd)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ flex: 1, fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={job.title || job.url}>
                        {job.title || job.url}
                      </span>
                      <span style={{
                        fontSize: '0.68rem', padding: '1px 5px', borderRadius: '3px', flexShrink: 0,
                        background: DL_STATUS_COLOR[job.status] || 'var(--bg3)',
                        color: job.status === 'queued' ? 'var(--tx2)' : '#fff',
                      }}>
                        {job.status === 'running' ? `${Math.round(job.progress || 0)}%` : job.status}
                      </span>
                      <button onClick={() => removeJob(job.id)} title="Remove" style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: '1px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    </div>
                    {(job.status === 'running' || job.status === 'queued') && (
                      <div style={{ height: '3px', background: 'var(--bg3)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ width: `${job.progress || 0}%`, height: '100%', background: 'var(--ac)', transition: 'width 0.3s' }} />
                      </div>
                    )}
                    {job.status === 'running' && job.speed && (
                      <div style={{ fontSize: '0.68rem', color: 'var(--tx3)', display: 'flex', gap: '8px' }}>
                        <span>{job.speed}</span>{job.eta && <span>ETA {job.eta}</span>}
                      </div>
                    )}
                    {job.status === 'error' && job.error && (
                      <div style={{ fontSize: '0.7rem', color: '#e55', wordBreak: 'break-all' }}>{job.error}</div>
                    )}
                    {job.status === 'done' && job.videoId && !isMoved && (
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <select
                          value={target}
                          onChange={(e: any) => setMoveTarget(prev => ({ ...prev, [job.id]: e.target.value }))}
                          style={{ flex: 1, background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '2px 5px', fontSize: '0.72rem' }}
                        >
                          <option value="">— root —</option>
                          {cats.map((c: any) => <option key={c.path} value={c.path}>{c.path.replace(/\//g, ' / ')}</option>)}
                        </select>
                        <button onClick={() => moveToCategory(job)} style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '4px', padding: '2px 8px', fontSize: '0.72rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          Move
                        </button>
                      </div>
                    )}
                    {isMoved && <div style={{ fontSize: '0.68rem', color: 'var(--tx3)' }}>Moved → {job.movedTo || 'root'}</div>}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Bulk Download section ─────────────────────── */}
          <div style={{ borderBottom: '1px solid var(--brd)' }}>
            <div style={{ padding: '9px 14px', display: 'flex', alignItems: 'center', gap: '7px' }}>
              <span style={{ color: 'var(--tx3)', display: 'flex', alignItems: 'center' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/>
                  <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/>
                </svg>
              </span>
              <span style={{ flex: 1, fontSize: '0.8rem', fontWeight: 500 }}>Bulk Download</span>
              {bulk.running ? (
                <>
                  <span style={{ fontSize: '0.72rem', color: 'var(--tx3)' }}>
                    {bulk.total > 0 ? `${bulk.done}/${bulk.total}` : 'running…'}
                  </span>
                  <button
                    type="button"
                    onClick={stopBulkDownload}
                    style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '4px', padding: '2px 7px', fontSize: '0.72rem', cursor: 'pointer' }}
                  >
                    Stop
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowBulkInput(v => !v)}
                  style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '4px', padding: '2px 8px', fontSize: '0.72rem', cursor: 'pointer' }}
                >
                  {showBulkInput ? 'Cancel' : 'Add URLs'}
                </button>
              )}
            </div>

            {bulk.running && bulk.total > 0 && <ProgressBar done={bulk.done} total={bulk.total} />}
            {bulk.running && bulk.current && (
              <div style={{ padding: '0 14px 6px', fontSize: '0.68rem', color: 'var(--tx3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={bulk.current}>
                {bulk.current}
              </div>
            )}
            {bulk.running && bulk.log.length > 0 && (
              <div style={{ margin: '0 14px 8px', background: 'var(--bg3)', borderRadius: '4px', padding: '6px 8px', maxHeight: '100px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.65rem', color: 'var(--tx2)', lineHeight: '1.4' }}>
                {bulk.log.slice(-20).map((l, i) => <div key={i}>{l}</div>)}
              </div>
            )}
            {!bulk.running && bulk.total > 0 && bulk.log.length > 0 && (
              <div style={{ padding: '0 14px 8px', fontSize: '0.7rem', color: 'var(--tx3)' }}>
                Done — {bulk.total} item(s) processed
              </div>
            )}

            {showBulkInput && !bulk.running && (
              <div style={{ padding: '0 14px 10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <textarea
                  value={bulkUrls}
                  onInput={(e: any) => setBulkUrls(e.target.value)}
                  placeholder={'Paste URLs, one per line\nhttps://example.com/video1\nhttps://example.com/video2'}
                  rows={5}
                  style={{
                    width: '100%', boxSizing: 'border-box', resize: 'vertical',
                    background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)',
                    borderRadius: '5px', padding: '6px 8px', fontSize: '0.72rem',
                    fontFamily: 'monospace', lineHeight: '1.5',
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.68rem', color: 'var(--tx3)' }}>
                    {bulkUrls.split('\n').filter(l => l.trim().startsWith('http')).length} URL(s)
                  </span>
                  <button
                    type="button"
                    onClick={startBulkDownload}
                    disabled={!bulkUrls.split('\n').some(l => l.trim().startsWith('http'))}
                    style={{
                      background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '4px',
                      padding: '4px 14px', fontSize: '0.75rem', cursor: 'pointer',
                    }}
                  >
                    Start
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Background Tasks section ───────────────────── */}
          <div style={{ padding: '8px 14px 4px', fontSize: '0.72rem', fontWeight: 600, color: 'var(--tx3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Background Tasks
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

          <div style={{ padding: '9px 14px', display: 'flex', alignItems: 'center', gap: '7px' }}>
            <span style={{ color: 'var(--tx3)', display: 'flex', alignItems: 'center' }}>{iconActor}</span>
            <span style={{ flex: 1, fontSize: '0.8rem', fontWeight: 500 }}>Actor Data</span>
            <button
              onClick={() => scraperAction('/api/actors/scrape-missing')}
              style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '4px', padding: '2px 8px', fontSize: '0.72rem', cursor: 'pointer' }}
            >
              Scrape missing
            </button>
          </div>

          <div style={{ padding: '9px 14px', display: 'flex', alignItems: 'center', gap: '7px', borderTop: '1px solid var(--brd)' }}>
            <span style={{ color: 'var(--tx3)', display: 'flex', alignItems: 'center' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/>
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
              </svg>
            </span>
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
  );
};
