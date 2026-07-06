import { useState, useEffect } from 'preact/hooks';
import { VideoCard } from '../UI/VideoGrid';
import { Video } from '../../types';
import { currentActor, cardSize } from '../../store';
import { SectionControls } from '../UI/SectionControls';
import { AzRail, azKey } from '../UI/AzRail';

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
  const [sort, setSort] = useState<'name' | 'count-desc' | 'duration-desc'>('name');

  const activeActorName = currentActor.value;

  useEffect(() => {
    fetch('/api/actors/scrape-missing', { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.count > 0) {
          console.log(`Started scraping for ${d.count} actors`);
          if ((window as any).toast) (window as any).toast(`Started scraping info for ${d.count} actors`);
        }
      })
      .catch(() => {});
  }, []);

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

  const sortedActors = [...filteredActors];
  if (sort === 'name') {
    sortedActors.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sort === 'count-desc') {
    sortedActors.sort((a, b) => b.count - a.count);
  } else if (sort === 'duration-desc') {
    sortedActors.sort((a, b) => ((b as any).duration || 0) - ((a as any).duration || 0));
  }

  const activeActors = sortedActors.filter(a => a.count > 0);
  const otherActors = sortedActors.filter(a => a.count === 0);

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
        data-az={azKey(a.name)}
        class={`cv-card fade-in ${a.count === 0 ? 'cv-card-unmatched' : ''}`}
        onClick={() => currentActor.value = a.name}
        style={{ cursor: 'pointer' }}
      >
        <div class="cv-thumb" style={{ background: `${c}22`, color: c, position: 'relative', overflow: 'hidden' }}>
          <img src={`/api/actor-photos/${encodeURIComponent(a.name)}/img`} alt="" loading="lazy" onError={(e: any) => e.target.style.display = 'none'} style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 }} />
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0.3 }}>
            <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
          </svg>
        </div>
        
        <div class="cv-overlay">
          <span class="cv-type">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" /></svg>
          </span>
          <div class="cv-info">
            <span class="cv-name">{a.name}</span>
            <span class="cv-count">{a.count}</span>
          </div>
        </div>
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
          <div class="cv-grid" id="cvGrid" style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize.value}px, 1fr))`, gap: '20px' }}>
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
        <SectionControls
          showStarred={false}
          showShuffle={false}
          showSource={false}
          showFilter={true}
          sortOptions={[
            { value: 'name', label: 'Name' },
            { value: 'count-desc', label: 'Count' },
            { value: 'duration-desc', label: 'Duration' }
          ]}
          currentSort={sort}
          onSortChange={(val) => setSort(val as any)}
          currentFilter={search}
          onFilterChange={setSearch}
        />
      </div>

      {loading ? (
        <div class="cv-loading">Loading actors…</div>
      ) : filteredActors.length === 0 ? (
        <div class="empty-state">No actors found</div>
      ) : (
        <>
          {activeActors.length > 0 && (
            <div class="cv-grid" id="cvGrid" style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize.value}px, 1fr))`, gap: '20px', marginBottom: '40px' }}>
              {activeActors.map(renderActorCard)}
            </div>
          )}

          {otherActors.length > 0 && (
            <>
              <div class="actor-section-sep" style={{ margin: '20px 0', borderBottom: '1px solid var(--border)', paddingBottom: '5px' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Other Actors</span>
              </div>
              <div class="cv-grid" id="cvGrid" style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize.value}px, 1fr))`, gap: '20px' }}>
                {otherActors.map(renderActorCard)}
              </div>
            </>
          )}

          {sort === 'name' && sortedActors.length > 30 && (
            <AzRail names={sortedActors.map(a => a.name)} containerSelector="#actors-view" />
          )}
        </>
      )}
    </div>
  );
};
