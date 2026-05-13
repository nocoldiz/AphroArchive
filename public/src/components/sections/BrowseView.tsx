import { VideoGrid } from '../UI/VideoGrid';

export const BrowseView = () => {
  return (
    <div className="browse-view on" id="browse-view">
      <div className="section-header">
        <h2 id="section-title">All Videos</h2><span id="result-count"></span>
        <div className="section-controls">
          <button class="sort-btn on" data-s="date" onClick={(e: any) => (window as any).setSort && (window as any).setSort('date', e.target)}>Recent</button>
          <button class="sort-btn" data-s="name" onClick={(e: any) => (window as any).setSort && (window as any).setSort('name', e.target)}>Name</button>
          <button class="sort-btn" data-s="size" onClick={(e: any) => (window as any).setSort && (window as any).setSort('size', e.target)}>Size</button>
          <button class="sort-btn" data-s="duration" onClick={(e: any) => (window as any).setSort && (window as any).setSort('duration', e.target)}>Length</button>
          <button class="sort-btn" id="favFilterBtn" onClick={() => (window as any).toggleStarredFilter && (window as any).toggleStarredFilter()}>Starred Only</button>
          <button class="sort-btn" id="shBtn" onClick={() => (window as any).toggleShuf && (window as any).toggleShuf()}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '3px', verticalAlign: '-1px' }}>
              <path d="M16 3h5v5" />
              <path d="M4 20 21 3" />
              <path d="M21 16v5h-5" />
              <path d="M15 15l5.1 5.1" />
              <path d="M4 4l5 5" />
            </svg>Shuffle
          </button>
          <span class="sg-sep"></span>
          <button class="sort-btn src-btn on" data-src="both" onClick={() => (window as any).setSrcFilter && (window as any).setSrcFilter('both')}>Both</button>
          <button class="sort-btn src-btn" data-src="local" onClick={() => (window as any).setSrcFilter && (window as any).setSrcFilter('local')}>Local</button>
          <button class="sort-btn src-btn" data-src="remote" onClick={() => (window as any).setSrcFilter && (window as any).setSrcFilter('remote')}>Remote</button>
          <span class="sg-sep" id="clearRecentSep" style={{ display: 'none' }}></span>
          <button class="sort-btn" id="clearRecentBtn" style={{ display: 'none' }} onClick={() => (window as any).clearRecent && (window as any).clearRecent()}>Clear History</button>
          <span class="sg-sep"></span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }} class="card-size-control" title="Card size">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
            </svg>
            <input type="range" id="card-size-slider" class="card-size-slider" min="140" max="500" step="10"
              defaultValue="270" onInput={(e: any) => (window as any).setCardSize && (window as any).setCardSize(e.target.value)}
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
              onInput={(e: any) => (window as any).onGalleryFilter && (window as any).onGalleryFilter(e.target.value)}
              autocomplete="off" spellcheck={false}
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '4px 10px', borderRadius: '999px', fontSize: '0.75rem', width: '120px', transition: 'all 0.2s', outline: 'none' }}
              onFocus={(e: any) => { e.target.style.width = '180px'; e.target.style.borderColor = 'var(--ac)'; }}
              onBlur={(e: any) => { if (!e.target.value) e.target.style.width = '120px'; e.target.style.borderColor = 'var(--brd)'; }} />
          </div>
        </div>
      </div>

      <VideoGrid />

      {/* Extra search result sections (photos / audio / books) */}
      <div id="search-extra-photos" style={{ display: 'none' }}>
        <h3 class="search-extra-heading">Photos</h3>
        <div id="search-extra-photos-grid" class="ph-grid"></div>
      </div>
      <div id="search-extra-audio" style={{ display: 'none' }}>
        <h3 class="search-extra-heading">Audio</h3>
        <div id="search-extra-audio-grid" class="au-grid"></div>
      </div>
      <div id="search-extra-books" style={{ display: 'none' }}>
        <h3 class="search-extra-heading">Books</h3>
        <div id="search-extra-books-grid" class="bk-grid"></div>
      </div>
    </div>
  );
};
