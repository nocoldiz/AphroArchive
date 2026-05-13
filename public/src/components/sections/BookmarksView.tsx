import { useState, useEffect, useRef } from 'preact/hooks';
import { rebuildBookmarkVidIds } from '../../store';

interface BookmarkItem {
  url: string;
  title: string;
  img?: string;
  fav?: boolean;
}

interface BookmarkCardProps {
  item: BookmarkItem;
  onRemove: (url: string) => void;
  onToggleStar: (url: string) => void;
  onUpdate: (url: string, updates: Partial<BookmarkItem>) => void;
}

const BookmarkCard = ({ item, onRemove, onToggleStar, onUpdate }: BookmarkCardProps) => {
  const hostname = new URL(item.url).hostname;

  useEffect(() => {
    if (!item.img) {
      fetch('/api/bookmarks/generate-thumb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: item.url })
      })
      .then(r => r.json())
      .then(res => {
        if (res.img) {
          onUpdate(item.url, { img: res.img });
        }
      })
      .catch(() => {});
    }
  }, [item.img, item.url, onUpdate]);

  return (
    <div class="bf-card" style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden', cursor: 'pointer', position: 'relative' }} onClick={() => (window as any).openBfIframe(item.url, item.title || 'Viewing Bookmark')}>
      <div style={{ height: '120px', background: 'var(--border)', position: 'relative' }}>
        {item.img ? (
          <img src={item.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>No Thumb</div>
        )}
        <input type="checkbox" class="bf-chk" value={item.url} onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: '10px', left: '10px' }} />
        
        {/* Star Button */}
        <button 
          class={`bm-star-btn ${item.fav ? 'st' : ''}`} 
          onClick={(e) => { e.stopPropagation(); onToggleStar(item.url); }}
          style={{ position: 'absolute', top: '10px', right: '40px', background: 'rgba(0,0,0,0.5)', border: 'none', color: item.fav ? 'var(--accent)' : 'white', borderRadius: '50%', width: '24px', height: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={item.fav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </button>

        {/* Remove Button */}
        <button 
          class="bf-card-rm" 
          onClick={(e) => { e.stopPropagation(); onRemove(item.url); }} 
          style={{ position: 'absolute', top: '10px', right: '10px', background: 'rgba(0,0,0,0.5)', border: 'none', color: 'white', borderRadius: '50%', width: '24px', height: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          ×
        </button>
      </div>
      <div style={{ padding: '10px' }}>
        <div class="bf-card-title" style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.title}>{item.title}</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '5px' }}>
          <img src={`https://www.google.com/s2/favicons?sz=12&domain_url=${encodeURIComponent(item.url)}`} width="12" height="12" />
          {hostname}
        </div>
      </div>
    </div>
  );
};

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

export const BookmarksView = () => {
  const [items, setItems] = useState<BookmarkItem[]>([]);
  const [visibleItems, setVisibleItems] = useState<BookmarkItem[]>([]);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [matchedCount, setMatchedCount] = useState(0);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [loading, setLoading] = useState(true);

  const dlPollerRef = useRef<any>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/bookmarks/cache')
      .then(r => r.json())
      .then(d => {
        if (d.items) {
          setItems(d.items);
          setVisibleItems(d.items);
          updateMatches(d.items);
        }
        setLoading(false);
      })
      .catch(() => {
        setItems([]);
        setVisibleItems([]);
        setLoading(false);
      });
  }, []);

  const updateMatches = (items: BookmarkItem[]) => {
    rebuildBookmarkVidIds(items);
    // Count matches
    const w = window as any;
    const vids = w.V || [];
    let count = 0;
    for (const item of items) {
      const haystack = item.url.toLowerCase();
      const isMatch = vids.some((v: any) => {
        const fname = v.name.toLowerCase().replace(/\.[^.]+$/, '');
        return haystack.includes(fname);
      });
      if (isMatch) count++;
    }
    setMatchedCount(count);
  };

  useEffect(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? items.filter(item => item.title.toLowerCase().includes(term) || item.url.toLowerCase().includes(term))
      : items;
    setVisibleItems(filtered);
  }, [search, items]);

  // Download poller
  useEffect(() => {
    const checkJobs = async () => {
      try {
        const r = await fetch('/api/download/jobs');
        const d = await r.json();
        setJobs(d);
        const active = d.some((j: any) => j.status === 'queued' || j.status === 'running');
        if (!active && dlPollerRef.current) {
          clearInterval(dlPollerRef.current);
          dlPollerRef.current = null;
        }
      } catch { }
    };

    const active = jobs.some(j => j.status === 'queued' || j.status === 'running');
    if (active && !dlPollerRef.current) {
      dlPollerRef.current = setInterval(checkJobs, 1500);
    }

    return () => {
      if (dlPollerRef.current) clearInterval(dlPollerRef.current);
    };
  }, [jobs]);

  const importFavs = async (browser: 'chrome' | 'firefox') => {
    setLoading(true);
    try {
      const r = await fetch(`/api/browser-favs?browser=${browser}`);
      const d = await r.json();
      if (d.items) {
        setItems(d.items);
        updateMatches(d.items);
      }
    } catch { }
    setLoading(false);
  };

  const clearAll = async () => {
    if (!items.length) return;
    if (!confirm(`Clear all ${items.length} imported bookmarks?`)) return;

    await fetch('/api/bookmarks/cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [] })
    });
    setItems([]);
    setVisibleItems([]);
    setMatchedCount(0);
    rebuildBookmarkVidIds([]);
  };

  const removeItem = async (url: string) => {
    const newItems = items.filter(it => it.url !== url);
    setItems(newItems);
    updateMatches(newItems);
    await fetch('/api/bookmarks/cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: newItems })
    });
  };

  const toggleStar = async (url: string) => {
    const newItems = items.map(it => it.url === url ? { ...it, fav: !it.fav } : it);
    setItems(newItems);
    await fetch('/api/bookmarks/cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: newItems })
    });
  };

  const updateItem = async (url: string, updates: Partial<BookmarkItem>) => {
    const newItems = items.map(it => it.url === url ? { ...it, ...updates } : it);
    setItems(newItems);
    await fetch('/api/bookmarks/cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: newItems })
    });
  };

  const downloadSelected = async () => {
    const checkboxes = document.querySelectorAll('.bf-chk:checked') as NodeListOf<HTMLInputElement>;
    const urls = Array.from(checkboxes).map(el => el.value);
    if (!urls.length) {
      alert('Select at least one bookmark');
      return;
    }
    const r = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls, category: '' })
    });
    const d = await r.json();
    if (r.ok) {
      // Start poller
      const jobsRes = await fetch('/api/download/jobs');
      const jobsData = await jobsRes.json();
      setJobs(jobsData);
    }
  };

  const openAllVisible = () => {
    if (!visibleItems.length) return;
    const n = visibleItems.length;
    if (n > 10 && !confirm(`Open ${n} tabs?`)) return;
    visibleItems.forEach((item, i) => {
      setTimeout(() => {
        window.open(item.url, '_blank');
      }, i * 100);
    });
  };

  const copyAllVisible = () => {
    if (!visibleItems.length) return;
    const text = visibleItems.map(item => item.url).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      alert(`Copied ${visibleItems.length} URLs`);
    });
  };

  const total = items.length;
  const pct = total ? Math.round((matchedCount / total) * 100) : 0;

  return (
    <div class="import-favs-view on" style={{ padding: '20px' }}>
      <div class="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ margin: 0 }}>Bookmarks</h1>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button class="btn" onClick={() => importFavs('chrome')}>Import Chrome</button>
          <button class="btn" onClick={() => importFavs('firefox')}>Import Firefox</button>
          <button class="btn" onClick={clearAll}>Clear All</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '15px', alignItems: 'center', marginBottom: '20px' }}>
        <input
          type="text"
          class="input-box"
          placeholder="Search bookmarks..."
          value={search}
          onInput={(e: any) => setSearch(e.target.value)}
          style={{ width: '300px' }}
        />
        <div class="sort-buttons" style={{ display: 'flex', gap: '5px' }}>
          <button class={`btn ${viewMode === 'list' ? 'on' : ''}`} onClick={() => setViewMode('list')}>List</button>
          <button class={`btn ${viewMode === 'grid' ? 'on' : ''}`} onClick={() => setViewMode('grid')}>Grid</button>
        </div>
        <button class="btn" onClick={copyAllVisible}>Copy URLs</button>
        <button class="btn" onClick={openAllVisible}>Open All</button>
        <button class="btn" onClick={downloadSelected}>Download Selected</button>
      </div>

      <div class="bf-stats" style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '15px' }}>
        <span>{visibleItems.length} bookmarks</span>
        <div class="bf-pct-wrap" style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
          <div class="bf-pct-bar" style={{ width: '200px', height: '10px', background: 'var(--border)', borderRadius: '5px', overflow: 'hidden' }}>
            <div class="bf-pct-fill" style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }}></div>
          </div>
          <span>{pct}% in library</span>
        </div>
      </div>

      {loading ? (
        <div class="cv-loading">Loading bookmarks…</div>
      ) : visibleItems.length === 0 ? (
        <div class="empty-state">No bookmarks found</div>
      ) : viewMode === 'grid' ? (
        <div class="bf-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '15px' }}>
          {visibleItems.map((item) => (
            <BookmarkCard 
              key={item.url} 
              item={item} 
              onRemove={removeItem} 
              onToggleStar={toggleStar}
              onUpdate={updateItem}
            />
          ))}
        </div>
      ) : (
        <div class="bf-list">
          {visibleItems.map(item => (
            <div key={item.url} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', borderBottom: '1px solid var(--border)' }}>
              <input type="checkbox" class="bf-chk" value={item.url} />
              <img src={`https://www.google.com/s2/favicons?sz=16&domain_url=${encodeURIComponent(item.url)}`} width="16" height="16" />
              <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, color: 'var(--text)', textDecoration: 'none' }}>{item.title}</a>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{new URL(item.url).hostname}</span>
              <button class="btn" onClick={() => removeItem(item.url)}>Remove</button>
            </div>
          ))}
        </div>
      )}

      {/* Download Queue */}
      {jobs.length > 0 && (
        <div id="dlQueuePanel" style={{ marginTop: '40px', padding: '20px', background: 'var(--bg2)', borderRadius: '8px' }}>
          <h3>Download Queue</h3>
          <div class="dl-queue-list">
            {jobs.map(j => (
              <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ flex: 1 }}>{j.title}</span>
                <span style={{ color: j.status === 'done' ? 'green' : j.status === 'error' ? 'red' : 'inherit' }}>{j.status}</span>
                {j.status === 'running' && (
                  <div style={{ width: '100px', height: '10px', background: 'var(--border)', borderRadius: '5px', overflow: 'hidden' }}>
                    <div style={{ width: `${j.progress || 0}%`, height: '100%', background: 'var(--accent)' }}></div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
