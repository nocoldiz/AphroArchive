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
  kind?: 'video' | 'file';
  mediaType?: 'audio' | 'book' | 'photo' | 'file';
}

const MEDIA_TYPE_LABEL: Record<string, string> = {
  audio: 'Audio', book: 'Book', photo: 'Photo', file: 'File',
};

function suggestCategory(title: string, cats: any[]): string {
  const norm = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const cat of cats) {
    const key = (cat.path || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (key && norm.includes(key)) return cat.path;
  }
  return '';
}

const DL_STATUS_COLOR: Record<string, string> = {
  done: '#1a7a3a', error: '#a11', running: 'var(--ac)', queued: 'var(--bg3)',
};

export const DownloadManager = () => {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [open, setOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<Record<string, string>>({});
  const [newUrls, setNewUrls] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const prevJobStatuses = useRef<Record<string, string>>({});

  useEffect(() => {
    const poll = async () => {
      try {
        const dlRes = await fetch('/api/download/jobs');
        if (dlRes.ok) {
          const newJobs: DownloadJob[] = await dlRes.json();
          // Detect transitions to 'done' and reload the video list
          let anyNewlyDone = false;
          for (const job of newJobs) {
            const prev = prevJobStatuses.current[job.id];
            if (job.status === 'done' && prev && prev !== 'done') anyNewlyDone = true;
            prevJobStatuses.current[job.id] = job.status;
          }
          setJobs(newJobs);
          if (anyNewlyDone) loadVideos();
        }
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
  const badgeCount = activeDlCount;

  const cats = (categories.value as any[]).filter(
    c => c.path && c.path !== 'uncategorized' && c.path !== 'Links'
  );

  const removeJob = async (id: string) => {
    await fetch(`/api/download/jobs/${id}`, { method: 'DELETE' });
    setJobs(prev => prev.filter(j => j.id !== id));
  };

  const cancelAll = async () => {
    await fetch('/api/download/cancel-all', { method: 'POST' });
    setJobs(prev => prev.filter(j => j.status === 'done' || j.status === 'error'));
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

  const parseUrls = () => newUrls.split('\n').map(l => l.trim()).filter(l => l.startsWith('http'));

  const handleDownload = async () => {
    const urls = parseUrls();
    if (!urls.length) return;
    const items = urls.map(url => ({ url, category: newCategory, pendingCategory: newCategory }));
    const r = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    if (r.ok) setNewUrls('');
  };

  const handleAddToQueue = async () => {
    const urls = parseUrls();
    if (!urls.length) return;
    const r = await fetch('/api/links/import-urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
    });
    const w = window as any;
    if (r.ok) {
      if (w.toast) w.toast(`Added ${urls.length} link(s) to Download Queue`);
      setNewUrls('');
    } else if (w.toast) {
      w.toast('Failed to add to Download Queue');
    }
  };

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
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--brd)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontWeight: 600, fontSize: '0.85rem', flex: 1 }}>Downloads {jobs.length > 0 && `(${jobs.length})`}</span>
            {activeDlCount > 0 && (
              <button
                onClick={cancelAll}
                style={{ background: 'none', border: '1px solid var(--brd)', color: '#e55', cursor: 'pointer', fontSize: '0.72rem', borderRadius: '4px', padding: '2px 7px', whiteSpace: 'nowrap' }}
              >
                Stop all
              </button>
            )}
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
                      {job.kind === 'file' && job.mediaType && (
                        <span style={{ fontSize: '0.62rem', padding: '1px 5px', borderRadius: '3px', flexShrink: 0, background: 'var(--bg3)', color: 'var(--tx2)' }}>
                          {MEDIA_TYPE_LABEL[job.mediaType] || job.mediaType}
                        </span>
                      )}
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
                        <span>↓ {job.speed}</span>{job.eta && <span>ETA {job.eta}</span>}
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

          {/* ── Add download section ──────────────────────── */}
          <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <textarea
              value={newUrls}
              onInput={(e: any) => setNewUrls(e.target.value)}
              placeholder={'Paste one or more URLs, one per line'}
              rows={2}
              style={{
                width: '100%', boxSizing: 'border-box', resize: 'vertical',
                background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)',
                borderRadius: '5px', padding: '6px 8px', fontSize: '0.72rem',
                fontFamily: 'monospace', lineHeight: '1.5',
              }}
            />
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <select
                value={newCategory}
                onChange={(e: any) => setNewCategory(e.target.value)}
                title="Category"
                style={{ flex: 1, background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '4px 5px', fontSize: '0.72rem' }}
              >
                <option value="">— root —</option>
                {cats.map((c: any) => <option key={c.path} value={c.path}>{c.path.replace(/\//g, ' / ')}</option>)}
              </select>
              <button
                type="button"
                onClick={handleAddToQueue}
                disabled={!parseUrls().length}
                title="Save link(s) to the Download Queue without downloading now"
                style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '4px', padding: '4px 10px', fontSize: '0.72rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                Add to Queue
              </button>
              <button
                type="button"
                onClick={handleDownload}
                disabled={!parseUrls().length}
                style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 14px', fontSize: '0.72rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                Download
              </button>
            </div>
          </div>

        </div>
      )}
    </div>
  );
};
