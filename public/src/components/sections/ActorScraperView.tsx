import { useState, useEffect } from 'preact/hooks';

interface Actor {
  name: string;
  hasPhoto: boolean;
}

export const ActorScraperView = () => {
  const [actors, setActors] = useState<Actor[]>([]);
  const [scraping, setScraping] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/actor-photos')
      .then(r => r.json())
      .then(data => {
        setActors(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const scrape = async (name: string) => {
    if (scraping.has(name)) return;
    
    setScraping(prev => {
      const next = new Set(prev);
      next.add(name);
      return next;
    });

    try {
      const res = await fetch(`/api/actor-photos/${encodeURIComponent(name)}/scrape`, { method: 'POST' });
      const d = await res.json();
      
      const w = window as any;
      if (d.ok) {
        setActors(prev => prev.map(a => a.name === name ? { ...a, hasPhoto: true } : a));
        if (w.toast) w.toast(`Photo saved for ${name}`);
      } else {
        if (w.toast) w.toast(`Failed for ${name}: ${d.error || 'Unknown error'}`);
      }
    } catch (e: any) {
      const w = window as any;
      if (w.toast) w.toast(`Error: ${e.message}`);
    }

    setScraping(prev => {
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  };

  const scrapeAll = async () => {
    const targets = actors.filter(a => !a.hasPhoto && !scraping.has(a.name));
    if (!targets.length) {
      const w = window as any;
      if (w.toast) w.toast('Nothing to scrape');
      return;
    }
    
    const w = window as any;
    if (w.toast) w.toast(`Scraping ${targets.length} actors…`);
    
    for (const a of targets) {
      await scrape(a.name);
      await new Promise(r => setTimeout(r, 600)); // polite rate limit
    }
  };

  const missing = actors.filter(a => !a.hasPhoto).length;

  return (
    <div className="scraper-view" style={{ padding: '20px' }}>
      <div className="section-header">
        <h2>Actor Scraper</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span className="scraper-info-label">
            {actors.length} actor{actors.length !== 1 ? 's' : ''} 
            {missing ? ` · ${missing} missing photo${missing !== 1 ? 's' : ''}` : ' · all photos cached'}
          </span>
          <button className="vault-lock-btn" onClick={scrapeAll}>
            {missing ? `Scrape All Missing (${missing})` : 'Refresh All'}
          </button>
        </div>
      </div>
      <p style={{ fontSize: '0.82rem', color: 'var(--tx2)', marginBottom: '18px' }}>
        Fetches actor headshots from IMDb and caches them as thumbnails in actor cards.
      </p>

      {loading ? (
        <div className="loading">Loading actors…</div>
      ) : actors.length === 0 ? (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
          </svg>
          <h3>No actors found</h3>
          <p>Add actor names to actors.txt — one per line</p>
        </div>
      ) : (
        <div id="scraper-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '15px' }}>
          {actors.map(a => {
            const isScraping = scraping.has(a.name);
            return (
              <div key={a.name} className="scraper-row" style={{ background: 'var(--bg2)', padding: '12px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '12px', border: '1px solid var(--brd)' }}>
                <div className="scraper-photo" style={{ width: '40px', height: '40px', borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
                  {a.hasPhoto ? (
                    <img src={`/api/actor-photos/${encodeURIComponent(a.name)}/img`} alt={a.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div className="scraper-avatar" style={{ width: '100%', height: '100%', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tx3)' }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <circle cx="12" cy="8" r="4" />
                        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                      </svg>
                    </div>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="scraper-name" style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--tx)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</div>
                  <div className={`scraper-status ${a.hasPhoto ? 'scraper-ok' : 'scraper-missing'}`} style={{ fontSize: '0.75rem', color: a.hasPhoto ? 'var(--ac)' : 'var(--tx3)' }}>
                    {a.hasPhoto ? '✓ Cached' : '✗ Missing'}
                  </div>
                </div>
                <button 
                  className="scraper-btn" 
                  onClick={() => scrape(a.name)} 
                  disabled={isScraping}
                  style={{ padding: '4px 10px', fontSize: '0.8rem', borderRadius: '4px', background: isScraping ? 'var(--bg3)' : 'var(--ac)', color: isScraping ? 'var(--tx3)' : '#fff', border: 'none', cursor: isScraping ? 'default' : 'pointer' }}
                >
                  {isScraping ? 'Scraping…' : (a.hasPhoto ? 'Refresh' : 'Scrape')}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
