import { useState, useEffect, useRef } from 'preact/hooks';

interface LinkItem {
  url: string;
  title: string;
  img?: string;
  fav?: boolean;
  scrapedVideoUrl?: string;
  embedUrl?: string;
  category?: string;
  tags?: string[];
}

interface CategoryItem {
  name: string;
  path: string;
  count: number;
}

interface DownloadJob {
  id: string;
  url: string;
  title: string;
  status: 'queued' | 'running' | 'done' | 'error';
  progress?: number;
  speed?: string;
  eta?: string;
  error?: string;
}

const VIRTUAL_CATS = new Set(['links', 'uncategorized', '']);

function wordScore(text: string, word: string): boolean {
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);
}

function resolveTargetFolder(link: LinkItem, categories: CategoryItem[]): string {
  const cat = (link.category || '').trim();
  if (cat && !VIRTUAL_CATS.has(cat.toLowerCase())) {
    const exact = categories.find(c => c.name.toLowerCase() === cat.toLowerCase() || c.path.toLowerCase() === cat.toLowerCase());
    if (exact) return exact.name;
  }
  // Tag scoring
  const tags = link.tags || [];
  if (tags.length > 0) {
    let best: CategoryItem | null = null;
    let bestScore = 0;
    for (const c of categories) {
      const haystack = c.path.toLowerCase();
      const score = tags.filter(t => t.length >= 2 && wordScore(haystack, t)).length;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (best && bestScore > 0) return best.name;
  }
  // Title matching fallback
  const title = (link.title || '').toLowerCase();
  for (const c of categories) {
    const key = c.path.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (key && title.includes(key)) return c.name;
  }
  return '';
}

export const DownloadQueueView = () => {
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'starred' | 'playable' | 'noplay'>('all');
  const [loading, setLoading] = useState(true);
  const pollerRef = useRef<any>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [lr, cr] = await Promise.all([
        fetch('/api/links/cache?limit=0').then(r => r.json()),
        fetch('/api/categories').then(r => r.json()),
      ]);
      setLinks((lr.items || []).map((i: any) => ({ ...i, tags: typeof i.tags === 'string' ? JSON.parse(i.tags || '[]') : (i.tags || []) })));
      setCategories(cr || []);
    } catch {}
    setLoading(false);
  };

  const pollJobs = async () => {
    try {
      const d = await fetch('/api/download/jobs').then(r => r.json());
      setJobs(d);
      const active = d.some((j: DownloadJob) => j.status === 'queued' || j.status === 'running');
      if (!active && pollerRef.current) { clearInterval(pollerRef.current); pollerRef.current = null; }
      // Refresh links when jobs complete
      const hasNewDone = d.some((j: DownloadJob) => j.status === 'done');
      if (hasNewDone) loadData();
    } catch {}
  };

  const startPolling = () => {
    if (!pollerRef.current) pollerRef.current = setInterval(pollJobs, 1500);
  };

  useEffect(() => { loadData(); pollJobs(); return () => { if (pollerRef.current) clearInterval(pollerRef.current); }; }, []);

  const visible = links.filter(item => {
    if (filter === 'starred' && !item.fav) return false;
    if (filter === 'playable' && !item.scrapedVideoUrl && !item.embedUrl) return false;
    if (filter === 'noplay' && (item.scrapedVideoUrl || item.embedUrl)) return false;
    if (search) {
      const q = search.toLowerCase();
      const tags = (item.tags || []).join(' ').toLowerCase();
      if (!item.title.toLowerCase().includes(q) && !item.url.toLowerCase().includes(q) && !tags.includes(q)) return false;
    }
    return true;
  });

  const toggleSelect = (url: string) => {
    setSelected(prev => {
      const s = new Set(prev);
      s.has(url) ? s.delete(url) : s.add(url);
      return s;
    });
  };

  const selectAll = () => setSelected(new Set(visible.map(i => i.url)));
  const selectNone = () => setSelected(new Set());

  const downloadSelected = async () => {
    const items = [...selected].map(url => {
      const link = links.find(l => l.url === url)!;
      return { url, category: resolveTargetFolder(link, categories) };
    });
    if (!items.length) return;
    try {
      await fetch('/api/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
      startPolling();
      pollJobs();
    } catch (e) { console.error(e); }
  };

  const downloadOne = async (link: LinkItem) => {
    const category = resolveTargetFolder(link, categories);
    try {
      await fetch('/api/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ url: link.url, category }] }) });
      startPolling();
      pollJobs();
    } catch {}
  };

  const getJobForUrl = (url: string) => jobs.find(j => j.url === url);

  const activeJobs = jobs.filter(j => j.status === 'queued' || j.status === 'running');

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', gap: '12px', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, color: 'var(--ac)' }}>Download Queue</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text" placeholder="Search…" value={search} onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
            style={{ background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '6px 10px', width: '200px' }}
          />
          {(['all', 'starred', 'playable', 'noplay'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`modal-btn ${filter === f ? 'modal-btn--primary' : 'modal-btn--secondary'}`} style={{ padding: '6px 12px', fontSize: '12px' }}>
              {f === 'all' ? 'All' : f === 'starred' ? '★ Starred' : f === 'playable' ? 'Has Video' : 'No Video'}
            </button>
          ))}
          <button onClick={selectAll} className="modal-btn modal-btn--secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>Select All</button>
          <button onClick={selectNone} className="modal-btn modal-btn--secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>None</button>
          <button
            onClick={downloadSelected}
            className="modal-btn modal-btn--primary"
            disabled={selected.size === 0}
            style={{ padding: '6px 14px', fontSize: '13px', opacity: selected.size === 0 ? 0.5 : 1 }}
          >
            ↓ Download {selected.size > 0 ? `(${selected.size})` : ''}
          </button>
        </div>
      </div>

      {activeJobs.length > 0 && (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', fontSize: '13px' }}>
          <strong>{activeJobs.length} active</strong> — {activeJobs.map(j => (
            <span key={j.id} style={{ marginRight: '12px', color: 'var(--tx2)' }}>
              {j.title} {j.status === 'running' && j.progress != null ? `${j.progress.toFixed(0)}%` : j.status}
            </span>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--tx3)' }}>Loading links…</div>
      ) : visible.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--tx3)' }}>No links found.</div>
      ) : (
        <div style={{ background: 'var(--bg2)', borderRadius: '10px', border: '1px solid var(--brd)', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '32px 44px 1fr 140px 180px 160px 140px 80px', gap: '0 12px', padding: '8px 12px', borderBottom: '1px solid var(--brd)', fontSize: '11px', color: 'var(--tx3)', textTransform: 'uppercase', letterSpacing: '0.05em', background: 'var(--bg3)' }}>
            <span />
            <span />
            <span>Title</span>
            <span>Site</span>
            <span>Tags</span>
            <span>Folder</span>
            <span>Status</span>
            <span>Action</span>
          </div>

          {visible.map(item => {
            const job = getJobForUrl(item.url);
            const isSelected = selected.has(item.url);
            const folder = resolveTargetFolder(item, categories);
            const hostname = (() => { try { return new URL(item.url).hostname.replace('www.', ''); } catch { return item.url; } })();
            const tags: string[] = item.tags || [];

            return (
              <div
                key={item.url}
                style={{ display: 'grid', gridTemplateColumns: '32px 44px 1fr 140px 180px 160px 140px 80px', gap: '0 12px', padding: '8px 12px', borderBottom: '1px solid var(--brd)', alignItems: 'center', background: isSelected ? 'var(--bg3)' : undefined, transition: 'background 0.1s' }}
              >
                {/* Checkbox */}
                <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(item.url)} style={{ cursor: 'pointer' }} />

                {/* Thumb */}
                <div style={{ width: '40px', height: '28px', borderRadius: '3px', overflow: 'hidden', background: 'var(--bg3)', flexShrink: 0 }}>
                  {item.img
                    ? <img src={item.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <img src={`https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(item.url)}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '4px' }} />
                  }
                </div>

                {/* Title */}
                <span style={{ fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--tx)' }} title={item.title}>{item.title || item.url}</span>

                {/* Site */}
                <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--tx2)', overflow: 'hidden' }}>
                  <img src={`https://www.google.com/s2/favicons?sz=12&domain_url=${encodeURIComponent(item.url)}`} width="12" height="12" />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hostname}</span>
                </span>

                {/* Tags */}
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'nowrap', overflow: 'hidden' }}>
                  {tags.slice(0, 3).map((t, i) => (
                    <span key={i} style={{ background: 'var(--bg)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '1px 5px', fontSize: '11px', color: 'var(--tx3)', whiteSpace: 'nowrap' }}>{t}</span>
                  ))}
                  {tags.length > 3 && <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>+{tags.length - 3}</span>}
                </div>

                {/* Folder */}
                <span style={{ fontSize: '12px', color: folder ? 'var(--ac)' : 'var(--tx3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={folder || 'Root (Uncategorized)'}>
                  {folder ? `📁 ${folder}` : '📁 Uncategorized'}
                </span>

                {/* Status */}
                <div style={{ fontSize: '12px' }}>
                  {job ? (
                    job.status === 'running' ? (
                      <div>
                        <div style={{ height: '4px', background: 'var(--bg3)', borderRadius: '2px', overflow: 'hidden', marginBottom: '2px' }}>
                          <div style={{ height: '100%', width: `${job.progress ?? 0}%`, background: 'var(--ac)', transition: 'width 0.3s' }} />
                        </div>
                        <span style={{ color: 'var(--tx3)' }}>{(job.progress ?? 0).toFixed(0)}% {job.speed}</span>
                      </div>
                    ) : job.status === 'queued' ? (
                      <span style={{ color: 'var(--tx3)' }}>Queued…</span>
                    ) : job.status === 'done' ? (
                      <span style={{ color: '#4caf50' }}>✓ Done</span>
                    ) : (
                      <span style={{ color: '#f44336' }} title={job.error || ''}>✗ Error</span>
                    )
                  ) : (
                    <span style={{ color: 'var(--tx3)' }}>—</span>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    className="modal-btn modal-btn--primary"
                    style={{ padding: '3px 8px', fontSize: '11px' }}
                    onClick={() => downloadOne(item)}
                    title="Download"
                  >↓</button>
                  <a
                    href={item.url} target="_blank" rel="noopener noreferrer"
                    style={{ padding: '3px 7px', fontSize: '11px', background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '4px', color: 'var(--tx2)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                    title="Open in browser"
                  >↗</a>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--tx3)' }}>
        {visible.length} link{visible.length !== 1 ? 's' : ''} · {links.length} total
      </div>
    </div>
  );
};
