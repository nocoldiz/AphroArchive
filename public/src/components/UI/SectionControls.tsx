import { sortMode, isShuffle, favFilter, galleryFilter, cardSize } from '../../store';

interface SectionControlsProps {
  showSort?: boolean;
  showStarred?: boolean;
  showShuffle?: boolean;
  showSource?: boolean;
  showClearHistory?: boolean;
  showCardSize?: boolean;
  showFilter?: boolean;
  
  sortOptions?: { value: string, label: string }[];
  
  // Overrides
  currentSort?: string;
  onSortChange?: (mode: string) => void;
  
  currentShuffle?: boolean;
  onShuffleChange?: (val: boolean) => void;
  
  currentStarred?: boolean;
  onStarredChange?: (val: boolean) => void;
  
  currentFilter?: string;
  onFilterChange?: (val: string) => void;
  
  currentCardSize?: number;
  onCardSizeChange?: (val: number) => void;
  
  onClearHistory?: () => void;
  children?: any;
}

export const SectionControls = ({
  showSort = true,
  showStarred = true,
  showShuffle = true,
  showSource = true,
  showClearHistory = false,
  showCardSize = true,
  showFilter = true,
  sortOptions = [
    { value: 'date', label: 'Recent' },
    { value: 'name', label: 'Name' },
    { value: 'size', label: 'Size' },
    { value: 'duration', label: 'Length' }
  ],
  currentSort,
  onSortChange,
  currentShuffle,
  onShuffleChange,
  currentStarred,
  onStarredChange,
  currentFilter,
  onFilterChange,
  currentCardSize,
  onCardSizeChange,
  onClearHistory,
  children
}: SectionControlsProps) => {
  const sMode = currentSort !== undefined ? currentSort : sortMode.value;
  const setSMode = onSortChange || ((val: string) => { sortMode.value = val; isShuffle.value = false; });
  
  const shuffle = currentShuffle !== undefined ? currentShuffle : isShuffle.value;
  const setShuffle = onShuffleChange || ((val: boolean) => isShuffle.value = val);
  
  const starred = currentStarred !== undefined ? currentStarred : favFilter.value;
  const setStarred = onStarredChange || ((val: boolean) => favFilter.value = val);
  
  const filter = currentFilter !== undefined ? currentFilter : galleryFilter.value;
  const setFilter = onFilterChange || ((val: string) => galleryFilter.value = val);
  
  const cSize = currentCardSize !== undefined ? currentCardSize : cardSize.value;
  const setCSize = onCardSizeChange || ((val: number) => cardSize.value = val);

  return (
    <div className="section-controls">
      {showSort && sortOptions.map(opt => (
        <button 
          key={opt.value}
          className={`sort-btn ${sMode === opt.value && !shuffle ? 'on' : ''}`} 
          onClick={() => setSMode(opt.value)}
        >
          {opt.label}
        </button>
      ))}
      
      {showStarred && (
        <button className={`sort-btn ${starred ? 'on' : ''}`} onClick={() => setStarred(!starred)}>Starred Only</button>
      )}
      
      {showShuffle && (
        <button className={`sort-btn ${shuffle ? 'on' : ''}`} onClick={() => setShuffle(!shuffle)}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '3px', verticalAlign: '-1px' }}>
            <path d="M16 3h5v5" />
            <path d="M4 20 21 3" />
            <path d="M21 16v5h-5" />
            <path d="M15 15l5.1 5.1" />
            <path d="M4 4l5 5" />
          </svg>Shuffle
        </button>
      )}
      
      {showSource && (
        <>
          <span className="sg-sep"></span>
          <button className="sort-btn src-btn on" data-src="both">Both</button>
          <button className="sort-btn src-btn" data-src="local">Local</button>
          <button className="sort-btn src-btn" data-src="remote">Remote</button>
        </>
      )}
      
      {showClearHistory && (
        <>
          <span className="sg-sep"></span>
          <button className="sort-btn" onClick={onClearHistory}>Clear History</button>
        </>
      )}
      
      {showCardSize && (
        <>
          <span className="sg-sep"></span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }} className="card-size-control" title="Card size">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
            </svg>
            <input type="range" className="card-size-slider" min="140" max="500" step="10"
              value={cSize} onInput={(e: any) => setCSize(parseInt(e.target.value, 10))}
              style={{ width: '72px', cursor: 'pointer', accentColor: 'var(--ac)', verticalAlign: 'middle' }} />
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
            </svg>
          </div>
        </>
      )}
      
      {showFilter && (
        <>
          <span className="sg-sep"></span>
          <div className="gallery-filter-wrap" style={{ display: 'flex', alignItems: 'center' }}>
            <input type="text" placeholder="Filter current view…"
              value={filter}
              onInput={(e: any) => setFilter(e.target.value)}
              autocomplete="off" spellcheck={false}
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '4px 10px', borderRadius: '999px', fontSize: '0.75rem', width: '120px', transition: 'all 0.2s', outline: 'none' }}
              onFocus={(e: any) => { e.target.style.width = '180px'; e.target.style.borderColor = 'var(--ac)'; }}
              onBlur={(e: any) => { if (!e.target.value) e.target.style.width = '120px'; e.target.style.borderColor = 'var(--brd)'; }} />
          </div>
        </>
      )}
      {children}
    </div>
  );
};
