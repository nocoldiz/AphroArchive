import { useState, useEffect } from 'preact/hooks';

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
  const [sort, setSort] = useState<'name' | 'count-desc' | 'count-asc'>('name');
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

  const sortedData = [...data];
  if (sort === 'name') {
    sortedData.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sort === 'count-desc') {
    sortedData.sort((a, b) => b.count - a.count);
  } else if (sort === 'count-asc') {
    sortedData.sort((a, b) => a.count - b.count);
  }

  const w = window as any;

  return (
    <div class="categories-view on" style={{ padding: '20px' }}>
      <div class="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600 }}>Categories & Tags</h1>
        <div class="sort-buttons" style={{ display: 'flex', gap: '10px' }}>
          <button 
            class={`btn cv-sort-btn ${sort === 'name' ? 'on' : ''}`} 
            onClick={() => setSort('name')}
          >
            Name
          </button>
          <button 
            class={`btn cv-sort-btn ${sort === 'count-desc' ? 'on' : ''}`} 
            onClick={() => setSort('count-desc')}
          >
            Count (High)
          </button>
          <button 
            class={`btn cv-sort-btn ${sort === 'count-asc' ? 'on' : ''}`} 
            onClick={() => setSort('count-asc')}
          >
            Count (Low)
          </button>
        </div>
      </div>

      {loading ? (
        <div class="cv-loading">Loading…</div>
      ) : sortedData.length === 0 ? (
        <div id="cvEmpty" class="empty-state">No categories or tags found</div>
      ) : (
        <div class="cv-grid" id="cvGrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px' }}>
          {sortedData.map(item => {
            const thumbSrc = item.thumbId ? `/api/thumbs/${item.thumbId}/0` : '';
            const onclick = () => {
              if (item.type === 'cat') {
                if (w.selCat) w.selCat(item.path);
              } else {
                if (w.openTag) w.openTag(item.name);
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
