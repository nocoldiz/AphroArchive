import { tvChannels, tvCurrentChannelIdx, tvFavChannels, toggleTVFav, playChannel, channelNowPlaying, tvTick } from '../../tv-mode';
import { formatVideoTitle } from '../../utils';

const TYPE_LABEL: Record<string, string> = {
  folder: 'Folder',
  tag: 'Tag',
  collection: 'Playlist',
};

// Replaces the "Next Up" playlist while TV mode is on. Lists every live channel
// and lets you tune in; the channel you're on is highlighted and each row shows
// what's currently on air (refreshed by tvTick once a second).
export const TVChannelPanel = () => {
  // Subscribe to the tick so "now playing" stays current as streams roll on.
  tvTick.value;
  const channels = tvChannels.value;
  const curIdx = tvCurrentChannelIdx.value;
  const favs = tvFavChannels.value;

  return (
    <div className="playlist-panel tv-channel-panel">
      <div className="playlist-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ display: 'inline-flex', width: '8px', height: '8px', borderRadius: '50%', background: '#ff4a4a', boxShadow: '0 0 6px #ff4a4a' }} />
          Live Channels
        </span>
        <span className="playlist-count">{channels.length}</span>
      </div>
      <div className="playlist-list" style={{ overflowY: 'auto' }}>
        {channels.map((ch, i) => {
          const onAir = channelNowPlaying(i);
          const active = i === curIdx;
          const isFav = favs.has(ch.id);
          return (
            <div
              key={ch.id}
              onClick={() => playChannel(i)}
              className={active ? 'tv-channel-row tv-channel-row--active' : 'tv-channel-row'}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', cursor: 'pointer',
                borderLeft: active ? '3px solid var(--ac)' : '3px solid transparent',
                background: active ? 'var(--acg, rgba(255,74,74,0.08))' : 'transparent',
                borderBottom: '1px solid var(--brd)',
              }}
            >
              <span style={{ flexShrink: 0, minWidth: '20px', textAlign: 'center', fontVariantNumeric: 'tabular-nums', color: active ? 'var(--ac)' : 'var(--tx3)', fontSize: '0.85rem', fontWeight: 600 }}>
                {i + 1}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, fontSize: '0.88rem', color: active ? 'var(--ac)' : 'var(--tx)' }}>
                    {ch.name}
                  </span>
                  <span style={{ flexShrink: 0, fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--tx3)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '0 4px', lineHeight: '1.4' }}>
                    {TYPE_LABEL[ch.type] || ch.type}
                  </span>
                </div>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.74rem', color: 'var(--tx3)', marginTop: '2px' }}>
                  {active && <span style={{ color: '#ff4a4a', fontWeight: 700, marginRight: '5px' }}>● ON AIR</span>}
                  {onAir ? formatVideoTitle(onAir.name) : `${ch.videos.length} videos`}
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggleTVFav(ch.id); }}
                title={isFav ? 'Remove from favourites' : 'Add to favourites'}
                style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: isFav ? '#ffd700' : 'var(--tx3)', fontSize: '1rem', lineHeight: 1, padding: '2px' }}
              >
                {isFav ? '★' : '☆'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
