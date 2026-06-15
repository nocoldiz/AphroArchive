/** @jsxImportSource preact */
import { useState, useEffect } from 'preact/hooks';
import { VideoCard } from '../UI/VideoGrid';
import { Video } from '../../types';
import { currentChannel, cardSize } from '../../store';
import { SectionControls } from '../UI/SectionControls';

interface Channel {
  name: string;
  count: number;
  website?: string;
  description?: string;
}

export const ChannelsView = () => {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [search, setSearch] = useState('');
  const [channelVideos, setChannelVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [sort, setSort] = useState<'name' | 'count-desc'>('name');

  const activeChannelName = currentChannel.value;

  useEffect(() => {
    if (!activeChannelName) {
      setLoading(true);
      fetch('/api/channels')
        .then(r => r.json())
        .then(d => {
          setChannels(d);
          setLoading(false);
        })
        .catch(() => {
          setChannels([]);
          setLoading(false);
        });
    }
  }, [activeChannelName]);

  useEffect(() => {
    if (activeChannelName) {
      setLoadingVideos(true);
      fetch(`/api/channels/${encodeURIComponent(activeChannelName)}`)
        .then(r => r.json())
        .then(d => {
          setChannelVideos(d.videos || []);
          setLoadingVideos(false);
        })
        .catch(() => {
          setChannelVideos([]);
          setLoadingVideos(false);
        });
    }
  }, [activeChannelName]);

  const filteredChannels = search.trim()
    ? channels.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
    : channels;

  const sortedChannels = [...filteredChannels];
  if (sort === 'name') {
    sortedChannels.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sort === 'count-desc') {
    sortedChannels.sort((a, b) => b.count - a.count);
  }

  const activeChannels = sortedChannels.filter(s => s.count > 0);
  const otherChannels = sortedChannels.filter(s => s.count === 0);

  const colors = ['#e84040', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];
  const getColor = (name: string) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const renderChannelCard = (s: Channel) => {
    const c = getColor(s.name);

    return (
      <div
        key={s.name}
        className={`cv-card fade-in ${s.count === 0 ? 'cv-card-unmatched' : ''}`}
        onClick={() => currentChannel.value = s.name}
        style={{ cursor: 'pointer' }}
      >
        <div className="cv-thumb" style={{ background: `${c}22`, color: c, position: 'relative', overflow: 'hidden' }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0.3 }}>
            <rect x="2" y="7" width="20" height="15" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
          </svg>
        </div>
        
        <div className="cv-overlay">
          <span className="cv-type">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="15" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /></svg>
          </span>
          <div className="cv-info">
            <span className="cv-name">{s.name}</span>
            <span className="cv-count">{s.count}</span>
          </div>
        </div>
      </div>
    );
  };

  if (activeChannelName) {
    return (
      <div id="channel-detail-view" className="channel-detail-view on" style={{ padding: '20px' }}>
        <div className="view-header" style={{ display: 'flex', alignItems: 'center', marginBottom: '20px' }}>
          <button className="btn" onClick={() => currentChannel.value = null} style={{ marginRight: '15px' }}>
            ← Back
          </button>
          <h1 style={{ margin: 0 }}>{activeChannelName}</h1>
        </div>

        {loadingVideos ? (
          <div className="cv-loading">Loading videos…</div>
        ) : channelVideos.length === 0 ? (
          <div className="empty-state">No videos found for this channel</div>
        ) : (
          <div className="cv-grid" id="cvGrid" style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize.value}px, 1fr))`, gap: '20px' }}>
            {channelVideos.map(v => <VideoCard key={v.id} video={v} isSelected={false} />)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div id="channels-view" className="channels-view on" style={{ padding: '20px' }}>
      <div className="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ margin: 0 }}>Channels</h1>
        <SectionControls
          showStarred={false}
          showShuffle={false}
          showSource={false}
          showFilter={true}
          sortOptions={[
            { value: 'name', label: 'Name' },
            { value: 'count-desc', label: 'Count' }
          ]}
          currentSort={sort}
          onSortChange={(val) => setSort(val as any)}
          currentFilter={search}
          onFilterChange={setSearch}
        />
      </div>

      {loading ? (
        <div className="cv-loading">Loading channels…</div>
      ) : filteredChannels.length === 0 ? (
        <div className="empty-state">No channels found</div>
      ) : (
        <>
          {activeChannels.length > 0 && (
            <div className="cv-grid" id="cvGrid" style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize.value}px, 1fr))`, gap: '20px', marginBottom: '40px' }}>
              {activeChannels.map(renderChannelCard)}
            </div>
          )}

          {otherChannels.length > 0 && (
            <>
              <div className="actor-section-sep" style={{ margin: '20px 0', borderBottom: '1px solid var(--border)', paddingBottom: '5px' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Other Channels</span>
              </div>
              <div className="cv-grid" id="cvGrid" style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize.value}px, 1fr))`, gap: '20px' }}>
                {otherChannels.map(renderChannelCard)}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};
