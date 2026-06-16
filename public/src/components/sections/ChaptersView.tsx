import { useState, useEffect } from 'preact/hooks';
import { allVideos, currentVideo, currentView } from '../../store';
import { zapStartTime } from '../../zap';

export const ChaptersView = () => {
  const [q, setQ] = useState('');
  const [autoChaptersMap, setAutoChaptersMap] = useState<Record<string, any[]>>({});
  const [gen, setGen] = useState<{ running: boolean; done: number; total: number; current: string } | null>(null);
  const videos = allVideos.value;

  const loadAutoChapters = () =>
    fetch('/api/auto-chapters')
      .then(r => r.json())
      .then(data => setAutoChaptersMap(data))
      .catch(() => {});

  useEffect(() => {
    loadAutoChapters();
  }, []);

  const generateAll = () => {
    if (gen?.running) {
      fetch('/api/gen-chapters/stop', { method: 'POST' }).catch(() => {});
      return;
    }
    setGen({ running: true, done: 0, total: 0, current: '' });
    fetch('/api/gen-chapters/start', { method: 'POST' })
      .then(r => r.json())
      .then(res => {
        if (!res.ok) { setGen(null); return; }
        const es = new EventSource('/api/gen-chapters/status');
        es.onmessage = (e) => {
          try {
            const ev = JSON.parse(e.data);
            if (ev.type === 'start') setGen({ running: true, done: 0, total: ev.total, current: '' });
            else if (ev.type === 'progress') setGen({ running: true, done: ev.done, total: ev.total, current: ev.current || '' });
            else if (ev.type === 'done') {
              setGen(null);
              es.close();
              loadAutoChapters();
            } else if (ev.type === 'idle') {
              es.close();
            }
          } catch {}
        };
        es.onerror = () => { es.close(); setGen(null); loadAutoChapters(); };
      })
      .catch(() => setGen(null));
  };

  const formatDuration = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':').replace(/^00:/, '');
  };

  const openVid = (id: string, time?: number) => {
    const v = videos.find(v => v.id === id);
    if (v) {
      zapStartTime.value = time || 0;
      currentVideo.value = v;
      currentView.value = 'player';
    }
  };

  // Merge manual chapters with auto-detected chapters per video
  let list = videos
    .filter(v => !v.isLink)
    .map(v => {
      const manual = v.chapters || [];
      const auto = autoChaptersMap[v.id] || [];
      const chapters = manual.length > 0 ? manual : auto;
      return { ...v, chapters };
    })
    .filter(v => v.chapters.length > 0);

  if (q) {
    const ql = q.toLowerCase().trim();
    list = list.filter(v =>
      v.name.toLowerCase().includes(ql) ||
      v.chapters?.some((c: any) => c.title.toLowerCase().includes(ql))
    );
  }

  return (
    <div className="chapters-view" style={{ padding: '20px' }}>
      <div className="section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <h2>Video Chapters</h2>
        <button type="button" className="cta-btn" onClick={generateAll}>
          {gen?.running
            ? (gen.total ? `Stop (${gen.done}/${gen.total})` : 'Stop…')
            : 'Auto-create chapters for all'}
        </button>
      </div>
      {gen?.running && (
        <div style={{ marginBottom: '16px', fontSize: '0.8rem', color: 'var(--tx2)' }}>
          {gen.total > 0 && (
            <div style={{ height: '4px', background: 'var(--bg3)', borderRadius: '2px', overflow: 'hidden', marginBottom: '6px' }}>
              <div style={{ height: '100%', width: `${Math.round((gen.done / gen.total) * 100)}%`, background: 'var(--ac)', transition: 'width 0.3s' }}></div>
            </div>
          )}
          <span>Detecting scene changes{gen.current ? `: ${gen.current}` : '…'}</span>
        </div>
      )}
      <div className="actor-search-bar" style={{ marginBottom: '20px' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          style={{ flexShrink: 0, color: 'var(--tx2)' }}>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          placeholder="Filter chapters or videos…"
          value={q}
          onInput={(e: any) => setQ(e.target.value)}
          style={{ background: 'transparent', border: 'none', color: 'var(--tx)', width: '100%', outline: 'none' }}
        />
      </div>

      {list.length === 0 ? (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          <h3>No chapters found</h3>
          <p>Add chapters to your videos to see them listed here.</p>
        </div>
      ) : (
        <div id="chaptersGrid" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {list.map(v => {
            const chapters = (q
              ? v.chapters?.filter((c: any) => c.title.toLowerCase().includes(q.toLowerCase()) || v.name.toLowerCase().includes(q.toLowerCase()))
              : v.chapters) || [];

            if (!chapters.length) return null;

            return (
              <div key={v.id} className="chapters-video-group" style={{ background: 'var(--bg2)', borderRadius: '12px', padding: '15px', border: '1px solid var(--brd)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '15px', borderBottom: '1px solid var(--brd)', paddingBottom: '12px' }}>
                  <div style={{ width: '50px', height: '50px', borderRadius: '6px', overflow: 'hidden', flexShrink: 0 }}>
                    <img src={`/api/thumbs/${v.id}/0`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--tx)' }}>{v.name}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--tx2)' }}>{v.category} • {v.chapters?.length || 0} chapters</div>
                  </div>
                  <button type="button" className="cta-btn" style={{ marginLeft: 'auto' }} onClick={() => openVid(v.id)}>Open Video</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
                  {chapters.map((c: any) => (
                    <div key={c.id} className="chapter-card" onClick={() => openVid(v.id, c.time)} style={{ cursor: 'pointer', background: 'var(--bg3)', borderRadius: '10px', overflow: 'hidden', transition: 'all 0.2s', border: '1px solid transparent' }} onMouseOver={(e: any) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.borderColor = 'var(--ac)'; }} onMouseOut={(e: any) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = 'transparent'; }}>
                      <div style={{ height: '120px', background: `url(/api/thumbs/${v.id}/chapter/${c.id}) center/cover no-repeat, url(/api/thumbs/${v.id}/0) center/cover no-repeat` }}></div>
                      <div style={{ padding: '10px' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--ac)', fontWeight: 700, marginBottom: '2px' }}>{formatDuration(c.time)}</div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--tx)' }}>{c.title}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
