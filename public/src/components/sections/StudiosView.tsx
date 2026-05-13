import { useState, useEffect } from 'preact/hooks';
import { VideoCard } from '../UI/VideoGrid';
import { Video } from '../../types';
import { currentStudio } from '../../store';

interface Studio {
  name: string;
  count: number;
  website?: string;
  description?: string;
}

export const StudiosView = () => {
  const [studios, setStudios] = useState<Studio[]>([]);
  const [search, setSearch] = useState('');
  const [studioVideos, setStudioVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingVideos, setLoadingVideos] = useState(false);

  const activeStudioName = currentStudio.value;

  useEffect(() => {
    if (!activeStudioName) {
      setLoading(true);
      fetch('/api/studios')
        .then(r => r.json())
        .then(d => {
          setStudios(d);
          setLoading(false);
        })
        .catch(() => {
          setStudios([]);
          setLoading(false);
        });
    }
  }, [activeStudioName]);

  useEffect(() => {
    if (activeStudioName) {
      setLoadingVideos(true);
      fetch(`/api/studios/${encodeURIComponent(activeStudioName)}`)
        .then(r => r.json())
        .then(d => {
          setStudioVideos(d.videos || []);
          setLoadingVideos(false);
        })
        .catch(() => {
          setStudioVideos([]);
          setLoadingVideos(false);
        });
    }
  }, [activeStudioName]);

  const filteredStudios = search.trim()
    ? studios.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
    : studios;

  const activeStudios = filteredStudios.filter(s => s.count > 0);
  const otherStudios = filteredStudios.filter(s => s.count === 0);

  const colors = ['#e84040', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];
  const getColor = (name: string) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const renderStudioCard = (s: Studio) => {
    const c = getColor(s.name);

    return (
      <div
        key={s.name}
        class={`actor-card fade-in ${s.count === 0 ? 'actor-card-unmatched' : ''}`}
        onClick={() => currentStudio.value = s.name}
        style={{ cursor: 'pointer' }}
      >
        <div class="actor-avatar" style={{ background: `${c}22`, color: c }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="7" width="20" height="15" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
          </svg>
        </div>
        <div class="actor-name">{s.name}</div>
        <div class="actor-count">
          {s.count > 0 ? `${s.count} video${s.count !== 1 ? 's' : ''}` : 'No videos'}
          {s.website && <> · <a class="actor-link" href={s.website} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}>Website</a></>}
        </div>
        {s.description && <div class="actor-desc">{s.description}</div>}
      </div>
    );
  };

  if (activeStudioName) {
    return (
      <div id="studio-detail-view" class="studio-detail-view on" style={{ padding: '20px' }}>
        <div class="view-header" style={{ display: 'flex', alignItems: 'center', marginBottom: '20px' }}>
          <button class="btn" onClick={() => currentStudio.value = null} style={{ marginRight: '15px' }}>
            ← Back
          </button>
          <h1 style={{ margin: 0 }}>{activeStudioName}</h1>
        </div>

        {loadingVideos ? (
          <div class="cv-loading">Loading videos…</div>
        ) : studioVideos.length === 0 ? (
          <div class="empty-state">No videos found for this studio</div>
        ) : (
          <div class="video-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px' }}>
            {studioVideos.map(v => <VideoCard key={v.id} video={v} isSelected={false} />)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div id="studios-view" class="studios-view on" style={{ padding: '20px' }}>
      <div class="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ margin: 0 }}>Studios</h1>
        <div class="search-bar" style={{ position: 'relative' }}>
          <input
            type="text"
            class="input-box"
            placeholder="Search studios..."
            value={search}
            onInput={(e: any) => setSearch(e.target.value)}
            style={{ width: '200px' }}
          />
        </div>
      </div>

      {loading ? (
        <div class="cv-loading">Loading studios…</div>
      ) : filteredStudios.length === 0 ? (
        <div class="empty-state">No studios found</div>
      ) : (
        <>
          {activeStudios.length > 0 && (
            <div class="actor-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '20px', marginBottom: '40px' }}>
              {activeStudios.map(renderStudioCard)}
            </div>
          )}

          {otherStudios.length > 0 && (
            <>
              <div class="actor-section-sep" style={{ margin: '20px 0', borderBottom: '1px solid var(--border)', paddingBottom: '5px' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Other Studios</span>
              </div>
              <div class="actor-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '20px' }}>
                {otherStudios.map(renderStudioCard)}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};
