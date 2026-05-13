import { useState, useEffect } from 'preact/hooks';
import { VideoCard } from '../UI/VideoGrid';
import { Video } from '../../types';
import { currentActor } from '../../store';

interface Actor {
  name: string;
  count: number;
  nationality?: string;
  age?: number;
  deceased?: boolean;
  imdb_page?: string;
}

export const ActorsView = () => {
  const [actors, setActors] = useState<Actor[]>([]);
  const [search, setSearch] = useState('');
  const [actorVideos, setActorVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingVideos, setLoadingVideos] = useState(false);

  const activeActorName = currentActor.value;

  useEffect(() => {
    if (!activeActorName) {
      setLoading(true);
      fetch('/api/actors')
        .then(r => r.json())
        .then(d => {
          setActors(d);
          setLoading(false);
        })
        .catch(() => {
          setActors([]);
          setLoading(false);
        });
    }
  }, [activeActorName]);

  useEffect(() => {
    if (activeActorName) {
      setLoadingVideos(true);
      fetch(`/api/actors/${encodeURIComponent(activeActorName)}`)
        .then(r => r.json())
        .then(d => {
          setActorVideos(d.videos || []);
          setLoadingVideos(false);
        })
        .catch(() => {
          setActorVideos([]);
          setLoadingVideos(false);
        });
    }
  }, [activeActorName]);

  const filteredActors = search.trim()
    ? actors.filter(a => a.name.toLowerCase().includes(search.toLowerCase()))
    : actors;

  const activeActors = filteredActors.filter(a => a.count > 0);
  const otherActors = filteredActors.filter(a => a.count === 0);

  const colors = ['#e84040', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];
  const getColor = (name: string) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const renderActorCard = (a: Actor) => {
    const c = getColor(a.name);
    const metaParts = [];
    if (a.nationality) metaParts.push(a.nationality);
    if (a.age != null) {
      metaParts.push(a.deceased ? `b. ${new Date().getFullYear() - a.age} †` : `${a.age} y/o`);
    }

    return (
      <div
        key={a.name}
        class={`actor-card fade-in ${a.count === 0 ? 'actor-card-unmatched' : ''}`}
        onClick={() => currentActor.value = a.name}
        style={{ cursor: 'pointer' }}
      >
        <div class="actor-avatar" style={{ background: `${c}22`, color: c }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
          </svg>
          <img class="actor-photo" src={`/api/actor-photos/${encodeURIComponent(a.name)}/img`} alt="" onError={(e: any) => e.target.style.display = 'none'} />
        </div>
        <div class="actor-name">{a.name}</div>
        <div class="actor-count">{a.count > 0 ? `${a.count} video${a.count !== 1 ? 's' : ''}` : 'No videos'}</div>
        {metaParts.length > 0 || a.imdb_page ? (
          <div class="actor-meta">
            {metaParts.join(' · ')}
            {a.imdb_page && (
              <>
                {metaParts.length > 0 && ' · '}
                <a class="actor-link" href={a.imdb_page} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}>IMDb</a>
              </>
            )}
          </div>
        ) : null}
      </div>
    );
  };

  if (activeActorName) {
    return (
      <div id="actor-detail-view" class="actor-detail-view on" style={{ padding: '20px' }}>
        <div class="view-header" style={{ display: 'flex', alignItems: 'center', marginBottom: '20px' }}>
          <button class="btn" onClick={() => currentActor.value = null} style={{ marginRight: '15px' }}>
            ← Back
          </button>
          <h1 style={{ margin: 0 }}>{activeActorName}</h1>
        </div>

        {loadingVideos ? (
          <div class="cv-loading">Loading videos…</div>
        ) : actorVideos.length === 0 ? (
          <div class="empty-state">No videos found for this actor</div>
        ) : (
          <div class="video-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px' }}>
            {actorVideos.map(v => <VideoCard key={v.id} video={v} isSelected={false} />)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div id="actors-view" class="actors-view on" style={{ padding: '20px' }}>
      <div class="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ margin: 0 }}>Actors</h1>
        <div class="search-bar" style={{ position: 'relative' }}>
          <input
            type="text"
            class="input-box"
            placeholder="Search actors..."
            value={search}
            onInput={(e: any) => setSearch(e.target.value)}
            style={{ width: '200px' }}
          />
        </div>
      </div>

      {loading ? (
        <div class="cv-loading">Loading actors…</div>
      ) : filteredActors.length === 0 ? (
        <div class="empty-state">No actors found</div>
      ) : (
        <>
          {activeActors.length > 0 && (
            <div class="actor-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '20px', marginBottom: '40px' }}>
              {activeActors.map(renderActorCard)}
            </div>
          )}

          {otherActors.length > 0 && (
            <>
              <div class="actor-section-sep" style={{ margin: '20px 0', borderBottom: '1px solid var(--border)', paddingBottom: '5px' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Other Actors</span>
              </div>
              <div class="actor-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '20px' }}>
                {otherActors.map(renderActorCard)}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};
