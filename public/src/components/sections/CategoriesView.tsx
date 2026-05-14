import { useState, useEffect } from 'preact/hooks';
import { currentCategory, currentTag, currentView, cardSize } from '../../store';
import { SectionControls } from '../UI/SectionControls';

interface CategoryOverviewItem {
  type: 'cat' | 'tag';
  name: string;
  path: string;
  count: number;
  thumbId?: string;
  encrypted?: boolean;
  partial?: boolean;
}

export const CategoriesView = () => {
  const [data, setData] = useState<CategoryOverviewItem[]>([]);
  const [sort, setSort] = useState<'name' | 'count-desc' | 'count-asc' | 'duration-desc'>('name');
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/categories-overview')
      .then(r => r.json())
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        setData([]);
        setLoading(false);
      });
  }, []);

  const filteredData = filter.trim()
    ? data.filter(item => item.name.toLowerCase().includes(filter.toLowerCase()))
    : data;

  const sortedData = [...filteredData];
  if (sort === 'name') {
    sortedData.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sort === 'count-desc') {
    sortedData.sort((a, b) => b.count - a.count);
  } else if (sort === 'count-asc') {
    sortedData.sort((a, b) => a.count - b.count);
  } else if (sort === 'duration-desc') {
    sortedData.sort((a, b) => ((b as any).duration || 0) - ((a as any).duration || 0));
  }

  const w = window as any;

  return (
    <div id="categories-view" class="categories-view on" style={{ padding: '20px' }}>
      <div class="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600 }}>Categories & Tags</h1>
        <SectionControls
          showStarred={false}
          showShuffle={false}
          showSource={false}
          showFilter={true}
          sortOptions={[
            { value: 'name', label: 'Name' },
            { value: 'count-desc', label: 'Count (High)' },
            { value: 'count-asc', label: 'Count (Low)' },
            { value: 'duration-desc', label: 'Duration' }
          ]}
          currentSort={sort}
          onSortChange={(val) => setSort(val as any)}
          currentFilter={filter}
          onFilterChange={setFilter}
        />
      </div>

      {loading ? (
        <div class="cv-loading">Loading…</div>
      ) : sortedData.length === 0 ? (
        <div id="cvEmpty" class="empty-state">No categories or tags found</div>
      ) : (
        <div class="cv-grid" id="cvGrid" style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize.value}px, 1fr))`, gap: '20px' }}>
          {sortedData.map(item => {
            const thumbSrc = item.thumbId ? `/api/thumbs/${item.thumbId}/0` : '';
            const onclick = () => {
              if (item.type === 'cat') {
                currentCategory.value = item.path;
                currentView.value = 'browse';
              } else {
                currentTag.value = item.name;
                currentView.value = 'tag';
              }
            };
            const onContextMenu = (e: MouseEvent) => {
              if (item.type === 'cat' && w.showContextMenu) {
                w.showContextMenu(e, 'category', {
                  path: item.path,
                  name: item.name,
                  encrypted: !!item.encrypted,
                  partial: !!item.partial
                });
              }
            };

            return (
              <div 
                class="cv-card" 
                onClick={onclick} 
                onContextMenu={onContextMenu}
                style={{ cursor: 'pointer' }}
              >
                {item.partial ? (
                  <svg class="lock-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e84040" stroke-width="3" style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 2, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))' }}>
                    <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><line x1="2" y1="2" x2="22" y2="22"/>
                  </svg>
                ) : item.encrypted ? (
                  <svg class="lock-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 2, color: 'white', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))' }}>
                    <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                ) : null}
                
                {thumbSrc ? (
                  <img class="cv-thumb" src={thumbSrc} alt="" loading="lazy" onError={(e: any) => e.target.style.display='none'} />
                ) : (
                  <div class="cv-thumb cv-thumb--empty"></div>
                )}
                
                <div class="cv-overlay">
                  <span class="cv-type">
                    {item.type === 'cat' ? (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                    ) : (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                    )}
                  </span>
                  <div class="cv-info">
                    <span class="cv-name">{item.name}</span>
                    <span class="cv-count">{item.count}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
