import { VideoGrid } from '../UI/VideoGrid';
import { galleryFilter, sortMode, isShuffle, favFilter, recentVideos, currentView, cardSize } from '../../store';
import { SearchExtras } from '../UI/SearchExtras';

export const BrowseView = () => {
  return (
    <div className="browse-view on" id="browse-view">
      <div className="section-header">
        <h2 id="section-title">All Videos</h2><span id="result-count"></span>
        <div className="section-controls">
          <button class={`sort-btn ${sortMode.value === 'date' && !isShuffle.value ? 'on' : ''}`} onClick={() => { sortMode.value = 'date'; isShuffle.value = false; }}>Recent</button>
          <button class={`sort-btn ${sortMode.value === 'name' && !isShuffle.value ? 'on' : ''}`} onClick={() => { sortMode.value = 'name'; isShuffle.value = false; }}>Name</button>
          <button class={`sort-btn ${sortMode.value === 'size' && !isShuffle.value ? 'on' : ''}`} onClick={() => { sortMode.value = 'size'; isShuffle.value = false; }}>Size</button>
          <button class={`sort-btn ${sortMode.value === 'duration' && !isShuffle.value ? 'on' : ''}`} onClick={() => { sortMode.value = 'duration'; isShuffle.value = false; }}>Length</button>
          <button class={`sort-btn ${favFilter.value ? 'on' : ''}`} id="favFilterBtn" onClick={() => favFilter.value = !favFilter.value}>Starred Only</button>
          <button class={`sort-btn ${isShuffle.value ? 'on' : ''}`} id="shBtn" onClick={() => isShuffle.value = !isShuffle.value}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '3px', verticalAlign: '-1px' }}>
              <path d="M16 3h5v5" />
              <path d="M4 20 21 3" />
              <path d="M21 16v5h-5" />
              <path d="M15 15l5.1 5.1" />
              <path d="M4 4l5 5" />
            </svg>Shuffle
          </button>
          <span class="sg-sep"></span>
          <button class="sort-btn src-btn on" data-src="both">Both</button>
          <button class="sort-btn src-btn" data-src="local">Local</button>
          <button class="sort-btn src-btn" data-src="remote">Remote</button>
          <span class="sg-sep" id="clearRecentSep" style={{ display: currentView.value === 'recent' ? 'inline' : 'none' }}></span>
          <button class="sort-btn" id="clearRecentBtn" style={{ display: currentView.value === 'recent' ? 'inline-block' : 'none' }} onClick={async () => {
            if (confirm('Clear watch history?')) {
              await fetch('/api/history', { method: 'DELETE' });
              recentVideos.value = [];
              if ((window as any).toast) (window as any).toast('History cleared');
            }
          }}>Clear History</button>
          <span class="sg-sep"></span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }} class="card-size-control" title="Card size">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
            </svg>
            <input type="range" id="card-size-slider" class="card-size-slider" min="140" max="500" step="10"
              value={cardSize.value} onInput={(e: any) => cardSize.value = parseInt(e.target.value, 10)}
              style={{ width: '72px', cursor: 'pointer', accentColor: 'var(--ac)', verticalAlign: 'middle' }} />
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
            </svg>
          </div>
          <span class="sg-sep"></span>
          <div class="gallery-filter-wrap" style={{ display: 'flex', alignItems: 'center' }}>
            <input type="text" id="gallery-filter" placeholder="Filter current view…"
              onInput={(e: any) => galleryFilter.value = e.target.value}
              autocomplete="off" spellcheck={false}
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '4px 10px', borderRadius: '999px', fontSize: '0.75rem', width: '120px', transition: 'all 0.2s', outline: 'none' }}
              onFocus={(e: any) => { e.target.style.width = '180px'; e.target.style.borderColor = 'var(--ac)'; }}
              onBlur={(e: any) => { if (!e.target.value) e.target.style.width = '120px'; e.target.style.borderColor = 'var(--brd)'; }} />
          </div>
        </div>
      </div>

      <VideoGrid />
      <SearchExtras />
    </div>
  );
};
