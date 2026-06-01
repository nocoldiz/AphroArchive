import { useState, useEffect } from 'preact/hooks';

interface Site {
  url: string;
  name: string;
  searchURL: string;
  scrapeMethod?: string;
  hasSearch?: boolean;
}

interface HistoryItem {
  siteUrl: string;
  siteName: string;
  query: string;
  ts: number;
}

interface ScrapeResult {
  url: string;
  thumb: string;
  title: string;
  source?: string;
}

export const SearchSitesView = () => {
  const [tab, setTab] = useState<'sites' | 'cards' | 'history'>('sites');
  const [sites, setSites] = useState<Site[]>([]);
  const [starredUrls, setStarredUrls] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [activeSite, setActiveSite] = useState<Site | null>(null);
  const [results, setResults] = useState<ScrapeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [trackingDisabled, setTrackingDisabled] = useState(false);

  const w = window as any;

  useEffect(() => {
    loadData();
    loadHistory();
  }, []);

  const loadData = async () => {
    try {
      const [sitesRes, starredRes, prefsRes] = await Promise.all([
        fetch('/api/websites').then(r => r.json()),
        fetch('/api/websites/starred').then(r => r.json()),
        fetch('/api/settings/prefs').then(r => r.json()),
      ]);
      setSites(sitesRes);
      setStarredUrls(new Set(starredRes));
      setTrackingDisabled(!!prefsRes.disableSearchTracking);
    } catch (e) {
      console.error(e);
    }
  };

  const loadHistory = () => {
    try {
      const hist = JSON.parse(localStorage.getItem('ss_history') || '[]');
      setHistory(hist);
    } catch {
      setHistory([]);
    }
  };

  const saveHistory = (newHist: HistoryItem[]) => {
    localStorage.setItem('ss_history', JSON.stringify(newHist));
    setHistory(newHist);
  };

  const addHistory = (site: Site, q: string) => {
    if (trackingDisabled || !q) return;
    const newHist = history.filter(h => !(h.siteUrl === site.url && h.query === q));
    newHist.unshift({ siteUrl: site.url, siteName: site.name, query: q, ts: Date.now() });
    const sliced = newHist.slice(0, 100);
    saveHistory(sliced);
  };

  const toggleStar = async (url: string) => {
    try {
      const res = await fetch('/api/websites/star', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      }).then(r => r.json());
      setStarredUrls(new Set(res.urls));
    } catch {
      const newStarred = new Set(starredUrls);
      if (newStarred.has(url)) newStarred.delete(url);
      else newStarred.add(url);
      setStarredUrls(newStarred);
    }
  };

  const doSearch = async () => {
    if (searching || !query.trim() || !activeSite) return;
    setSearching(true);
    setResults([]);
    try {
      const res = await fetch(`/api/scrape?method=${encodeURIComponent(activeSite.scrapeMethod!)}&q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      if (data.error) {
        if (w.toast) w.toast(data.error);
      } else {
        setResults(data.results || []);
        addHistory(activeSite, query.trim());
      }
    } catch (e: any) {
      if (w.toast) w.toast(`Request failed: ${e.message}`);
    } finally {
      setSearching(false);
    }
  };

  const linkResult = (r: ScrapeResult) => {
    if (!w._lfItems) return;
    const already = w._lfItems.some((it: any) => it.url === r.url);
    if (already) {
      if (w.toast) w.toast('Already in links');
      return;
    }
    w._lfItems.push({ url: r.url, title: r.title, img: r.thumb });
    if (w.bfSaveCache) w.bfSaveCache();
    if (w.rebuildLinkVidIds) w.rebuildLinkVidIds(w._lfItems);
    if (w.renCats) w.renCats();
    if (w.toast) w.toast('Saved to links');
  };

  const openSite = (site: Site) => {
    const qTrim = query.trim();
    const hasSearch = site.hasSearch !== false;
    const url = (qTrim && hasSearch) ? site.searchURL + encodeURIComponent(qTrim) : site.searchURL;
    if (qTrim && hasSearch) {
      addHistory(site, qTrim);
    }
    window.open(url, '_blank');
  };

  const starredScrapable = sites.filter(s => s.scrapeMethod && starredUrls.has(s.url));
  
  useEffect(() => {
    if (starredScrapable.length > 0 && !activeSite) {
      setActiveSite(starredScrapable[0]);
    }
  }, [starredScrapable, activeSite]);

  const filteredSites = sites.filter(s => s.searchURL);
  const starredSites = filteredSites.filter(s => starredUrls.has(s.url));
  const unstarredSites = filteredSites.filter(s => !starredUrls.has(s.url));
  const sortedSites = [...starredSites, ...unstarredSites];

  return (
    <div className="search-sites-view on">
      <div className="section-header">
        <h2>Web Search</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div className="ss-tabs" style={{ display: 'flex', gap: '4px', background: 'var(--bg3)', padding: '2px', borderRadius: '8px' }}>
            <button className={`ss-tab ${tab === 'sites' ? 'on' : ''}`} onClick={() => setTab('sites')} style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: tab === 'sites' ? 'var(--ac)' : 'transparent', color: tab === 'sites' ? '#fff' : 'var(--tx2)', cursor: 'pointer', fontSize: '0.8rem' }}>Sites</button>
            <button className={`ss-tab ${tab === 'cards' ? 'on' : ''}`} onClick={() => setTab('cards')} style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: tab === 'cards' ? 'var(--ac)' : 'transparent', color: tab === 'cards' ? '#fff' : 'var(--tx2)', cursor: 'pointer', fontSize: '0.8rem' }}>Scrape</button>
            <button className={`ss-tab ${tab === 'history' ? 'on' : ''}`} onClick={() => setTab('history')} style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: tab === 'history' ? 'var(--ac)' : 'transparent', color: tab === 'history' ? '#fff' : 'var(--tx2)', cursor: 'pointer', fontSize: '0.8rem' }}>History</button>
          </div>
          
          <div className="gallery-filter-wrap" style={{ display: 'flex', alignItems: 'center' }}>
            <input 
              type="text" 
              placeholder="Search or filter…" 
              value={query}
              onInput={(e: any) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (tab === 'cards' ? doSearch() : null)}
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '4px 10px', borderRadius: '999px', fontSize: '0.75rem', width: '150px' }}
            />
          </div>
          {tab === 'cards' && (
            <button className="btn-primary" onClick={doSearch} style={{ padding: '6px 12px', borderRadius: '999px', fontSize: '0.75rem' }}>Search</button>
          )}
        </div>
      </div>

      {tab === 'sites' && (
        <div className="ss-sites-pane" style={{ padding: '16px 0' }}>
          {sortedSites.length === 0 && <div style={{ color: 'var(--tx2)', fontSize: '0.85rem' }}>No searchable sites found.</div>}
          <div className="search-sites-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
            {sortedSites.map(s => {
              const isStarred = starredUrls.has(s.url);
              const hasSearch = s.hasSearch !== false;
              let hostname = '';
              try { hostname = new URL(s.url).hostname; } catch {}
              return (
                <div key={s.url} className={`search-site-item ${isStarred ? 'starred' : ''}`} style={{ background: 'var(--bg2)', borderRadius: '8px', padding: '12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '8px', border: isStarred ? '1px solid var(--ac)' : '1px solid var(--brd)' }} onClick={() => openSite(s)}>
                  <div className="search-site-top" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div className="search-site-icon">
                      <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(s.url)}&sz=32`} width="16" height="16" alt="" onError={(e: any) => e.target.style.display='none'} />
                    </div>
                    <div className="search-site-name" style={{ fontWeight: '500', color: 'var(--tx)', flex: 1 }}>
                      {s.name || s.url}
                      {query && hasSearch && <span className="search-site-kw" style={{ color: 'var(--ac)', marginLeft: '4px' }}>— {query}</span>}
                    </div>
                    <button 
                      className={`search-site-pin ${isStarred ? 'on' : ''}`} 
                      onClick={(e) => { e.stopPropagation(); toggleStar(s.url); }} 
                      title={isStarred ? 'Unstar' : 'Star'}
                      style={{ background: 'none', border: 'none', color: isStarred ? 'var(--ac)' : 'var(--tx3)', cursor: 'pointer' }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill={isStarred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                      </svg>
                    </button>
                  </div>
                  <div className="search-site-url" style={{ fontSize: '0.75rem', color: 'var(--tx3)' }}>{hostname}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'cards' && (
        <div className="ss-cards-pane" style={{ padding: '16px 0' }}>
          <div className="ss-site-pills" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
            {starredScrapable.map(s => (
              <button 
                key={s.url}
                className={`ss-pill ${activeSite?.url === s.url ? 'on' : ''}`} 
                onClick={() => setActiveSite(s)}
                style={{ padding: '6px 12px', borderRadius: '999px', border: '1px solid var(--brd)', background: activeSite?.url === s.url ? 'var(--ac)' : 'var(--bg3)', color: activeSite?.url === s.url ? '#fff' : 'var(--tx)', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(s.url)}&sz=16`} width="12" height="12" alt="" onError={(e: any) => e.target.style.display='none'} />
                {s.name || s.url}
              </button>
            ))}
            {starredScrapable.length === 0 && (
              <div style={{ color: 'var(--tx2)', fontSize: '0.85rem' }}>Star some scrapable sites first.</div>
            )}
          </div>

          <div className="ss-cards-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px' }}>
            {searching && <div className="ss-loading" style={{ color: 'var(--tx2)', fontSize: '0.85rem' }}>Searching…</div>}
            {!searching && results.length === 0 && query && (
              <div style={{ color: 'var(--tx2)', fontSize: '0.85rem' }}>No results found or search not performed.</div>
            )}
            {!searching && results.map((r, i) => (
              <div key={i} className="ss-card" onClick={() => window.open(r.url, '_blank')} style={{ background: 'var(--bg2)', borderRadius: '8px', overflow: 'hidden', cursor: 'pointer', position: 'relative' }}>
                <div className="ss-card-thumb" style={{ position: 'relative', height: '140px', background: 'var(--bg3)' }}>
                  <img src={r.thumb} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e: any) => e.target.parentNode.classList.add('no-thumb')} />
                  <div className="ss-card-play" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifySelf: 'center', justifyContent: 'center', color: '#fff', opacity: 0, transition: 'opacity 0.2s', background: 'rgba(0,0,0,0.4)' }} onMouseEnter={(e: any) => e.target.style.opacity = 1} onMouseLeave={(e: any) => e.target.style.opacity = 0}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                  </div>
                  <button 
                    className="ss-card-bm" 
                    onClick={(e) => { e.stopPropagation(); linkResult(r); }} 
                    title="Save to links"
                    style={{ position: 'absolute', top: '8px', right: '8px', background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', padding: '4px', borderRadius: '4px', cursor: 'pointer' }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                  </button>
                </div>
                <div className="ss-card-info" style={{ padding: '8px' }}>
                  <div className="ss-card-title" title={r.title} style={{ fontWeight: '500', color: 'var(--tx)', fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</div>
                  <div className="ss-card-source" style={{ fontSize: '0.75rem', color: 'var(--tx3)' }}>{r.source || ''}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="ss-history-pane" style={{ padding: '16px 0' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
            <button className="ss-hist-ctrl-btn" onClick={() => saveHistory([])} style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '4px 10px', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer' }}>Clear all</button>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: 'var(--tx2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={trackingDisabled} onChange={(e: any) => { setTrackingDisabled(e.target.checked); if(e.target.checked) saveHistory([]); }} />
              Disable tracking
            </label>
          </div>

          {history.length === 0 && (
            <div style={{ color: 'var(--tx2)', fontSize: '0.85rem' }}>{trackingDisabled ? 'Search tracking is disabled.' : 'No recent searches.'}</div>
          )}

          <div className="ss-history-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {history.map((h, i) => {
              const site = sites.find(s => s.url === h.siteUrl);
              const hasSearch = site ? site.hasSearch !== false : true;
              const url = (hasSearch && site) ? site.searchURL + encodeURIComponent(h.query) : (site ? site.searchURL : h.siteUrl);
              return (
                <div key={i} className="ss-hist-item" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', background: 'var(--bg2)', borderRadius: '4px' }}>
                  <a href={url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, color: 'var(--tx)', fontSize: '0.85rem', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(h.siteUrl)}&sz=16`} width="12" height="12" alt="" onError={(e: any) => e.target.style.display='none'} />
                    {h.siteName || h.siteUrl}
                    {hasSearch && <span style={{ color: 'var(--ac)' }}>— {h.query}</span>}
                  </a>
                  <button 
                    className="ss-hist-rm" 
                    onClick={() => { const n = [...history]; n.splice(i,1); saveHistory(n); }} 
                    title="Remove"
                    style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', fontSize: '1rem' }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
