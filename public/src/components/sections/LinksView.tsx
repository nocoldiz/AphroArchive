import { useState, useEffect, useRef } from 'preact/hooks';
import { rebuildLinkVidIds, currentVideo, currentView } from '../../store';
import { SectionControls } from '../UI/SectionControls';

interface LinkItem {
  url: string;
  title: string;
  img?: string;
  fav?: boolean;
  scrapedVideoUrl?: string;
  hasVideo?: boolean;
  embedUrl?: string;
  hasEmbed?: boolean;
  category?: string;
}

interface LinkCardProps {
  item: LinkItem;
  onRemove: (url: string) => void;
  onToggleStar: (url: string) => void;
  onUpdate: (url: string, updates: Partial<LinkItem>) => void;
}

const LinkCard = ({ item, onRemove, onToggleStar }: LinkCardProps) => {
  const hostname = new URL(item.url).hostname;
  const hasPlayable = !!(item.scrapedVideoUrl || item.embedUrl);

  const openPlayer = () => {
    currentVideo.value = {
      id: btoa(item.url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
      name: item.title,
      path: item.scrapedVideoUrl || '',
      relPath: item.url,
      category: item.category || 'Links',
      isLink: true,
      img: item.img,
      embedUrl: item.embedUrl,
      linkUrl: item.url,
    } as any;
    currentView.value = 'player';
  };

  return (
    <div class="bf-card" style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden', cursor: 'pointer', position: 'relative' }} onClick={openPlayer}>
      <div style={{ height: '120px', background: 'var(--border)', position: 'relative' }}>
        {item.img ? (
          <img src={item.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>No Thumb</div>
        )}
        {/* External-link indicator when no playable source */}
        {!hasPlayable && (
          <div style={{ position: 'absolute', bottom: '6px', right: '6px', background: 'rgba(0,0,0,0.6)', borderRadius: '4px', padding: '2px 4px', display: 'flex', alignItems: 'center' }} title="No direct video — opens in browser">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </div>
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

interface ActiveCat { name: string; path: string; }

function matchTitleToCategory(title: string, cats: ActiveCat[]): string | null {
  const normalized = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const cat of cats) {
    const catKey = cat.path.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (catKey && normalized.includes(catKey)) return cat.name;
  }
  return null;
}

export const LinksView = () => {
  const [items, setItems] = useState<LinkItem[]>([]);
  const [visibleItems, setVisibleItems] = useState<LinkItem[]>([]);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [groupByCategory, setGroupByCategory] = useState(true);
  const [activeCats, setActiveCats] = useState<ActiveCat[]>([]);
  const [matchedCount, setMatchedCount] = useState(0);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [websites, setWebsites] = useState<any[]>([]);
  const [selectedWebsite, setSelectedWebsite] = useState<string>('');

  const dlPollerRef = useRef<any>(null);
  const [scrapeJob, setScrapeJob] = useState<{ running: boolean, total: number, done: number, failed: number, current: string } | null>(null);
  const scrapePollerRef = useRef<any>(null);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const r = await fetch('/api/links/scrape-status');
        const d = await r.json();
        setScrapeJob(d);
        if (d.running && !scrapePollerRef.current) {
          scrapePollerRef.current = setInterval(async () => {
            const r2 = await fetch('/api/links/scrape-status');
            const d2 = await r2.json();
            setScrapeJob(d2);
            if (!d2.running && scrapePollerRef.current) {
              clearInterval(scrapePollerRef.current);
              scrapePollerRef.current = null;
            }
          }, 1500);
        }
      } catch (e) {}
    };
    checkStatus();
    return () => { if (scrapePollerRef.current) clearInterval(scrapePollerRef.current); };
  }, []);

  const loadLinks = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/links/cache?limit=0');
      const d = await r.json();
      if (d.items) {
        setItems(d.items);
        updateMatches(d.items);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadLinks(); }, []);

  useEffect(() => {
    fetch('/api/websites')
      .then(r => r.json())
      .then(setWebsites)
      .catch(() => {});
    fetch('/api/categories')
      .then(r => r.json())
      .then(data => setActiveCats(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const updateMatches = (items: LinkItem[]) => {
    rebuildLinkVidIds(items);
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
    let filtered = items;

    if (selectedWebsite) {
      filtered = filtered.filter(item => {
        try {
          const itemUrl = new URL(item.url);
          const webUrl = new URL(selectedWebsite);
          return itemUrl.hostname === webUrl.hostname || itemUrl.hostname.endsWith('.' + webUrl.hostname);
        } catch {
          return item.url.includes(selectedWebsite);
        }
      });
    }

    if (term) {
      filtered = filtered.filter(item => item.title.toLowerCase().includes(term) || item.url.toLowerCase().includes(term));
    }

    setVisibleItems(filtered);
  }, [search, items, selectedWebsite]);

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
        // Filter links to only include those matching profile websites!
        const filtered = d.items.filter((item: any) => {
          return websites.some(w => {
            try {
              const itemUrl = new URL(item.url);
              const webUrl = new URL(w.url);
              return itemUrl.hostname === webUrl.hostname || itemUrl.hostname.endsWith('.' + webUrl.hostname);
            } catch {
              return item.url.includes(w.url);
            }
          });
        });
        
        // Merge with existing items (avoid duplicates by url or name)
        const existingUrls = new Set(items.map(it => it.url));
        const existingNames = new Set(items.map(it => (it.title || '').trim().toLowerCase()).filter(Boolean));
        const newItems = [...items];
        for (const item of filtered) {
          const nm = (item.title || '').trim().toLowerCase();
          if (!existingUrls.has(item.url) && !(nm && existingNames.has(nm))) {
            newItems.push(item);
            existingUrls.add(item.url);
            if (nm) existingNames.add(nm);
          }
        }
        
        setItems(newItems);
        updateMatches(newItems);
        
        // Save to cache
        await fetch('/api/links/cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: newItems })
        });
        
        const w = window as any;
        if (w.toast) w.toast(`Imported ${filtered.length} links`);
      }
    } catch { }
    setLoading(false);
  };

  const clearAll = async () => {
    if (!items.length) return;
    if (!confirm(`Clear all ${items.length} imported links?`)) return;

    await fetch('/api/links/cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [] })
    });
    setItems([]);
    setVisibleItems([]);
    setMatchedCount(0);
    rebuildLinkVidIds([]);
  };

  const removeDuplicates = async () => {
    if (!items.length) return;
    const seenUrls = new Set<string>();
    const seenNames = new Set<string>();
    const cleaned: any[] = [];
    for (const item of items) {
      const u = item.url;
      const nm = (item.title || '').trim().toLowerCase();
      if (!u || seenUrls.has(u) || (nm && seenNames.has(nm))) continue;
      seenUrls.add(u);
      if (nm) seenNames.add(nm);
      cleaned.push(item);
    }
    const removed = items.length - cleaned.length;
    if (removed <= 0) {
      const w = window as any;
      if (w.toast) w.toast('No duplicates found (by link or name)');
      return;
    }
    if (!confirm(`Remove ${removed} duplicate links (same URL or same name)? Keep ${cleaned.length}?`)) return;
    setItems(cleaned);
    updateMatches(cleaned);
    try {
      await fetch('/api/links/cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: cleaned })
      });
      const w = window as any;
      if (w.toast) w.toast(`Removed ${removed} duplicates`);
    } catch (e: any) {
      alert('Error saving after dedup: ' + e.message);
    }
  };

  const removeItem = async (url: string) => {
    const newItems = items.filter(it => it.url !== url);
    setItems(newItems);
    updateMatches(newItems);
    await fetch('/api/links/cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: newItems })
    });
  };

  const toggleStar = async (url: string) => {
    const newItems = items.map(it => it.url === url ? { ...it, fav: !it.fav } : it);
    setItems(newItems);
    await fetch('/api/links/cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: newItems })
    });
  };

  const updateItem = async (url: string, updates: Partial<LinkItem>) => {
    const newItems = items.map(it => it.url === url ? { ...it, ...updates } : it);
    setItems(newItems);
    await fetch('/api/links/cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: newItems })
    });
  };

  const downloadSelected = async () => {
    const checkboxes = document.querySelectorAll('.bf-chk:checked') as NodeListOf<HTMLInputElement>;
    const urls = Array.from(checkboxes).map(el => el.value);
    if (!urls.length) {
      alert('Select at least one link');
      return;
    }
    const r = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls, category: '' })
    });
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

  const saveToDb = async () => {
    if (!items.length) {
      alert('No links to save');
      return;
    }
    setLoading(true);
    try {
      const r = await fetch('/api/links/save-to-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      });
      const d = await r.json();
      if (d.ok) {
        const w = window as any;
        if (w.toast) w.toast(`Saved ${d.count} links to DB`);
      } else {
        alert('Failed to save links: ' + (d.error || 'Unknown error'));
      }
    } catch (e: any) {
      alert('Error saving links: ' + e.message);
    }
    setLoading(false);
  };

  const startScraping = async () => {
    try {
      const r = await fetch('/api/links/start-scraping', { method: 'POST' });
      const d = await r.json();
      if (d.ok) {
        const w = window as any;
        if (w.toast) w.toast('Scraping started');
      } else {
        alert('Failed to start scraping: ' + (d.error || 'Unknown error'));
      }
    } catch (e: any) {
      alert('Error starting scraping: ' + e.message);
    }
  };

  const rescrapeAll = async () => {
    if (!confirm('Clear all scraped data and rescrape everything from scratch?')) return;
    try {
      const r = await fetch('/api/links/rescrape-all', { method: 'POST' });
      const d = await r.json();
      if (d.ok) {
        const w = window as any;
        if (w.toast) w.toast('Rescraping all from start');
      }
    } catch (e: any) {
      alert('Error: ' + e.message);
    }
  };

  const total = items.length;
  const pct = total ? Math.round((matchedCount / total) * 100) : 0;

  const importFileRef = useRef<HTMLInputElement>(null);

  const exportLinksJson = async () => {
    const r = await fetch('/api/links/export');
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aphroarchive-links-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const onImportFileChange = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    (e.target as HTMLInputElement).value = '';
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const r = await fetch('/api/links/import-json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const d = await r.json();
      if (d.error) { alert('Import error: ' + d.error); return; }
      const w = window as any;
      if (w.toast) w.toast(`Imported: +${d.added} new · ${d.skipped} skipped · ${d.total} total`);
      await loadLinks();
    } catch (err: any) {
      alert('Failed to parse JSON: ' + err.message);
    }
  };

  return (
    <div class="import-favs-view on" style={{ padding: '20px' }}>
      <div class="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ margin: 0 }}>Links</h1>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button class="btn" onClick={() => importFavs('chrome')}>Import Chrome</button>
          <button class="btn" onClick={() => importFavs('firefox')}>Import Firefox</button>
          <button class="btn" onClick={exportLinksJson} title={`Export all ${items.length} links as JSON`}>Export JSON</button>
          <button class="btn" onClick={() => importFileRef.current?.click()} title="Import links from JSON file">Import JSON</button>
          <input ref={importFileRef as any} type="file" accept=".json,application/json" aria-label="Import links from JSON file" style={{ display: 'none' }} onChange={onImportFileChange as any} />
          <button class="btn" onClick={clearAll}>Clear All</button>
          <button class="btn" onClick={removeDuplicates} title="Remove links that have duplicate URL or duplicate name/title">Remove Duplicates</button>
          <button class="btn" onClick={saveToDb}>Save to DB</button>
          <button class="btn" onClick={startScraping}>Start Scraping</button>
          <button class="btn" onClick={rescrapeAll}>Rescrape All</button>
        </div>
      </div>

        <SectionControls 
          showSort={false}
          showStarred={false}
          showShuffle={false}
          showSource={false}
          showCardSize={false}
          showFilter={true}
          currentFilter={search}
          onFilterChange={setSearch}
        >
          <span className="sg-sep"></span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }} title="Filter by Website">
            <select 
              value={selectedWebsite} 
              onChange={(e: any) => setSelectedWebsite(e.target.value)}
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '3px 6px', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer' }}
            >
              <option value="">All Websites</option>
              {websites.map(w => (
                <option key={w.name} value={w.url}>{w.name}</option>
              ))}
            </select>
          </div>
          <span className="sg-sep"></span>
          <div className="ss-tabs" style={{ display: 'flex', gap: '4px', background: 'var(--bg3)', padding: '2px', borderRadius: '8px' }}>
            <button className={`ss-tab ${viewMode === 'grid' ? 'on' : ''}`} onClick={() => setViewMode('grid')} style={{ padding: '4px 8px', borderRadius: '4px', border: 'none', background: viewMode === 'grid' ? 'var(--ac)' : 'transparent', color: viewMode === 'grid' ? '#fff' : 'var(--tx2)', cursor: 'pointer', fontSize: '0.75rem' }}>Grid</button>
            <button className={`ss-tab ${viewMode === 'list' ? 'on' : ''}`} onClick={() => setViewMode('list')} style={{ padding: '4px 8px', borderRadius: '4px', border: 'none', background: viewMode === 'list' ? 'var(--ac)' : 'transparent', color: viewMode === 'list' ? '#fff' : 'var(--tx2)', cursor: 'pointer', fontSize: '0.75rem' }}>List</button>
          </div>
          <span className="sg-sep"></span>
          <button className={`sort-btn ${groupByCategory ? 'on' : ''}`} onClick={() => setGroupByCategory(g => !g)} title="Group by folder">
            Folders
          </button>
          <span className="sg-sep"></span>
          <button className="sort-btn" onClick={copyAllVisible}>Copy URLs</button>
          <button className="sort-btn" onClick={openAllVisible}>Open All</button>
          <button className="sort-btn" onClick={downloadSelected}>Download Selected</button>
        </SectionControls>

      <div class="bf-stats" style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '15px' }}>
        <span>{visibleItems.length} links</span>
        <div class="bf-pct-wrap" style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
          <div class="bf-pct-bar" style={{ width: '200px', height: '10px', background: 'var(--border)', borderRadius: '5px', overflow: 'hidden' }}>
            <div class="bf-pct-fill" style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }}></div>
          </div>
          <span>{pct}% in library</span>
        </div>
        {scrapeJob && scrapeJob.running && (
          <div class="scrape-progress" style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Scraping: {scrapeJob.done}/{scrapeJob.total}</span>
            <div style={{ width: '150px', height: '10px', background: 'var(--border)', borderRadius: '5px', overflow: 'hidden' }}>
              <div style={{ width: `${Math.round((scrapeJob.done / (scrapeJob.total || 1)) * 100)}%`, height: '100%', background: 'var(--accent)' }}></div>
            </div>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }} title={scrapeJob.current}>{scrapeJob.current}</span>
          </div>
        )}
      </div>

      {loading ? (
        <div class="cv-loading">Loading links…</div>
      ) : visibleItems.length === 0 ? (
        <div class="empty-state">No links found</div>
      ) : (() => {
        const renderCard = (item: LinkItem) => (
          <LinkCard key={item.url} item={item} onRemove={removeItem} onToggleStar={toggleStar} onUpdate={updateItem} />
        );
        const renderRow = (item: LinkItem) => (
          <div key={item.url} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', borderBottom: '1px solid var(--border)' }}>
            <input type="checkbox" class="bf-chk" value={item.url} aria-label="Select link" />
            <img src={`https://www.google.com/s2/favicons?sz=16&domain_url=${encodeURIComponent(item.url)}`} width="16" height="16" alt="" />
            <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, color: 'var(--text)', textDecoration: 'none' }}>{item.title}</a>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{new URL(item.url).hostname}</span>
            <button class="btn" onClick={() => removeItem(item.url)}>Remove</button>
          </div>
        );

        if (groupByCategory) {
          const groups: Record<string, LinkItem[]> = {};
          for (const item of visibleItems) {
            const matched = activeCats.length > 0 ? matchTitleToCategory(item.title, activeCats) : null;
            const key = matched || item.category || 'Uncategorized';
            (groups[key] = groups[key] || []).push(item);
          }
          const sortedKeys = Object.keys(groups).sort((a, b) => {
            if (a === 'Uncategorized') return 1;
            if (b === 'Uncategorized') return -1;
            return a.localeCompare(b);
          });
          return (
            <>
              {sortedKeys.map(cat => (
                <div key={cat} style={{ marginBottom: '30px' }}>
                  <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {cat} <span style={{ fontWeight: 400, opacity: 0.6 }}>({groups[cat].length})</span>
                  </h3>
                  {viewMode === 'grid' ? (
                    <div class="bf-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '15px' }}>
                      {groups[cat].map(renderCard)}
                    </div>
                  ) : (
                    <div class="bf-list">{groups[cat].map(renderRow)}</div>
                  )}
                </div>
              ))}
            </>
          );
        }

        return viewMode === 'grid' ? (
          <div class="bf-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '15px' }}>
            {visibleItems.map(renderCard)}
          </div>
        ) : (
          <div class="bf-list">{visibleItems.map(renderRow)}</div>
        );
      })()}

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
