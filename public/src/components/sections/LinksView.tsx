import { useState, useEffect, useRef } from 'preact/hooks';
import { memo } from 'preact/compat';
import { rebuildLinkVidIds, currentVideo, currentView } from '../../store';
import { SectionControls } from '../UI/SectionControls';

interface LinkItem {
  url: string;
  title: string;
  img?: string;
  fav?: boolean;
  scrapedVideoUrl?: string;
  hasVideo?: boolean;
  embedUrl?: string;
  hasEmbed?: boolean;
  category?: string;
  tags?: string[];
  addedAt?: number;
}

interface LinkCardProps {
  item: LinkItem;
  onRemove: (url: string) => void;
  onToggleStar: (url: string) => void;
  onUpdate: (url: string, updates: Partial<LinkItem>) => void;
  selected?: boolean;
  onToggleSelect?: (url: string) => void;
  activeCats?: ActiveCat[];
}

const LinkCardImpl = ({ item, onRemove, onToggleStar, onUpdate, onVault, selected, onToggleSelect, activeCats }: LinkCardProps & { onVault?: (url: string) => void }) => {
  const hostname = new URL(item.url).hostname;
  const hasPlayable = !!(item.scrapedVideoUrl || item.embedUrl);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(item.title);
  const [editCategory, setEditCategory] = useState(item.category || '');

  const startEdit = (e: any) => {
    e.stopPropagation();
    setEditTitle(item.title);
    setEditCategory(item.category || '');
    setEditing(true);
  };

  const saveEdit = (e: any) => {
    e.stopPropagation();
    const title = editTitle.trim() || item.title;
    onUpdate(item.url, { title, category: editCategory });
    setEditing(false);
  };

  const cancelEdit = (e: any) => {
    e.stopPropagation();
    setEditing(false);
  };

  const openPlayer = () => {
    currentVideo.value = {
      id: btoa(item.url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
      name: item.title,
      path: item.scrapedVideoUrl || '',
      relPath: item.url,
      category: item.category || 'Links',
      isLink: true,
      img: item.img,
      embedUrl: item.embedUrl,
      linkUrl: item.url,
    } as any;
    currentView.value = 'player';
  };

  return (
    <div class="bf-card" style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden', cursor: editing ? 'default' : 'pointer', position: 'relative' }} onClick={editing ? undefined : openPlayer}>
      <div style={{ height: '120px', background: 'var(--border)', position: 'relative' }}>
        {item.img ? (
          <img src={item.img} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>No Thumb</div>
        )}
        {/* External-link indicator when no playable source */}
        {!hasPlayable && (
          <div style={{ position: 'absolute', bottom: '6px', right: '6px', background: 'rgba(0,0,0,0.6)', borderRadius: '4px', padding: '2px 4px', display: 'flex', alignItems: 'center' }} title="No direct video — opens in browser">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </div>
        )}
        <input type="checkbox" class="bf-chk" aria-label="Select link" checked={selected || false} onChange={() => onToggleSelect?.(item.url)} onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: '10px', left: '10px' }} />
        
        {/* Star Button */}
        <button 
          class={`bm-star-btn ${item.fav ? 'st' : ''}`} 
          onClick={(e) => { e.stopPropagation(); onToggleStar(item.url); }}
          style={{ position: 'absolute', top: '10px', right: '40px', background: 'rgba(0,0,0,0.5)', border: 'none', color: item.fav ? 'var(--accent)' : 'white', borderRadius: '50%', width: '24px', height: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={item.fav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </button>

        {/* Vault Button */}
        {onVault && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onVault(item.url); }}
            style={{ position: 'absolute', top: '10px', right: '66px', background: 'rgba(0,0,0,0.5)', border: 'none', color: 'white', borderRadius: '50%', width: '24px', height: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' }}
            title="Move to Vault"
          >🔒</button>
        )}
        {/* Remove Button */}
        <button
          class="bf-card-rm"
          onClick={(e) => { e.stopPropagation(); onRemove(item.url); }}
          style={{ position: 'absolute', top: '10px', right: '10px', background: 'rgba(0,0,0,0.5)', border: 'none', color: 'white', borderRadius: '50%', width: '24px', height: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          ×
        </button>
      </div>
      <div style={{ padding: '10px' }} onClick={(e) => editing && e.stopPropagation()}>
        {editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <input
              type="text"
              value={editTitle}
              onInput={(e: any) => setEditTitle(e.target.value)}
              aria-label="Link title"
              style={{ width: '100%', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '4px', padding: '4px 6px', fontSize: '0.85rem' }}
            />
            <select
              value={editCategory}
              onChange={(e: any) => setEditCategory(e.target.value)}
              aria-label="Link category"
              style={{ width: '100%', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '4px', padding: '4px 6px', fontSize: '0.8rem' }}
            >
              <option value="">Uncategorized</option>
              {(activeCats || []).map(c => (
                <option key={c.name} value={c.name}>{c.path}</option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
              <button type="button" class="sort-btn" onClick={cancelEdit} style={{ fontSize: '0.75rem', padding: '3px 8px' }}>Cancel</button>
              <button type="button" class="sort-btn on" onClick={saveEdit} style={{ fontSize: '0.75rem', padding: '3px 8px' }}>Save</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div class="bf-card-title" style={{ flex: 1, fontSize: '0.9rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.title}>{item.title}</div>
              <button
                type="button"
                onClick={startEdit}
                title="Edit title / category"
                style={{ flexShrink: 0, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '5px', marginTop: '4px' }}>
              <img src={`https://www.google.com/s2/favicons?sz=12&domain_url=${encodeURIComponent(item.url)}`} width="12" height="12" loading="lazy" alt="" />
              {hostname}
            </div>
            {item.tags && item.tags.length > 0 && (
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '6px' }}>
                {item.tags.slice(0, 4).map(t => (
                  <span key={t} style={{ fontSize: '10px', background: 'var(--acg, rgba(255,255,255,0.06))', color: 'var(--ac, var(--accent))', borderRadius: '4px', padding: '1px 5px', border: '1px solid var(--ac, var(--accent))', opacity: 0.85 }}>
                    {t}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const LinkCard = memo(LinkCardImpl);

interface DownloadJob {
  id: string;
  url: string;
  title: string;
  status: 'queued' | 'running' | 'done' | 'error';
  progress?: number;
  speed?: string;
  eta?: string;
  error?: string;
}

interface ActiveCat { name: string; path: string; }

function matchTitleToCategory(title: string, cats: ActiveCat[]): string | null {
  const normalized = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const cat of cats) {
    const catKey = cat.path.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (catKey && normalized.includes(catKey)) return cat.name;
  }
  return null;
}

interface BmPickerProps {
  browser: 'chrome' | 'firefox';
  existingUrls: Set<string>;
  activeCats: ActiveCat[];
  onImport: (items: { title: string; url: string }[]) => void;
  onClose: () => void;
}

const tagWordMatch = (text: string, term: string) =>
  new RegExp('(?:^|[^a-z0-9])' + term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|[^a-z0-9])').test(text.toLowerCase());

const matchedTagName = (text: string, tagGroups: { displayName: string; terms: string[] }[]): string | null => {
  for (const g of tagGroups) {
    if (g.terms.some(t => tagWordMatch(text, t))) return g.displayName;
  }
  return null;
};

const matchedName = (
  b: { title: string; url: string },
  tagGroups: { displayName: string; terms: string[] }[],
  cats: ActiveCat[]
): string | null =>
  matchedTagName(b.title, tagGroups) || matchedTagName(b.url, tagGroups) ||
  matchTitleToCategory(b.title, cats) || matchTitleToCategory(b.url, cats);

const ROW_HEIGHT = 34;

const BookmarkPickerModal = ({ browser, existingUrls, activeCats, onImport, onClose }: BmPickerProps) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [bookmarks, setBookmarks] = useState<{ title: string; url: string }[]>([]);
  const [tagGroups, setTagGroups] = useState<{ displayName: string; terms: string[] }[]>([]);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<{ col: 'title' | 'domain'; dir: 'asc' | 'desc' }>({ col: 'title', dir: 'asc' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'sites' | 'all'>('sites');

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(400);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError('');
      try {
        const [bmRes, tagsRes] = await Promise.all([
          fetch(`/api/browser-favs?browser=${browser}&all=true`).then(r => r.json()),
          fetch('/api/db-tags').then(r => r.json()).catch(() => []),
        ]);
        if (bmRes.error) { setError(bmRes.error); setLoading(false); return; }
        const groups: { displayName: string; terms: string[] }[] = Array.isArray(tagsRes) ? tagsRes : [];
        const fresh: { title: string; url: string }[] = (bmRes.items || []).filter((b: any) => b.url && !existingUrls.has(b.url));
        setTagGroups(groups);
        setBookmarks(fresh);
        setSelected(new Set());
      } catch (e: any) { setError(e.message); }
      setLoading(false);
    })();
  }, [browser]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setContainerHeight(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewMode, loading]);

  const domainOf = (url: string) => { try { return new URL(url).hostname; } catch { return url; } };

  const term = filter.trim().toLowerCase();
  const filtered = term
    ? bookmarks.filter(b =>
        b.title.toLowerCase().includes(term) ||
        b.url.toLowerCase().includes(term) ||
        domainOf(b.url).toLowerCase().includes(term))
    : bookmarks;

  // Bookmarks whose title or URL contains a word found in a folder/category name or a tag
  const recognized = filtered.filter(b => matchedName(b, tagGroups, activeCats) !== null);
  const recognizedUrls = new Set(recognized.map(b => b.url));

  // Group recognized bookmarks by website for the default view
  const siteGroups = (() => {
    const map = new Map<string, { domain: string; urls: { title: string; url: string }[]; tags: Set<string> }>();
    for (const b of recognized) {
      const d = domainOf(b.url);
      let g = map.get(d);
      if (!g) { g = { domain: d, urls: [], tags: new Set() }; map.set(d, g); }
      g.urls.push(b);
      const mn = matchedName(b, tagGroups, activeCats);
      if (mn) g.tags.add(mn);
    }
    return [...map.values()].sort((a, b) => b.urls.length - a.urls.length || a.domain.localeCompare(b.domain));
  })();

  // Recognized rows always come first, then secondary sort by column
  const sorted = [...filtered].sort((a, b) => {
    const aTag = recognizedUrls.has(a.url);
    const bTag = recognizedUrls.has(b.url);
    if (aTag !== bTag) return aTag ? -1 : 1;
    const av = (sort.col === 'title' ? a.title : domainOf(a.url)).toLowerCase();
    const bv = (sort.col === 'title' ? b.title : domainOf(b.url)).toLowerCase();
    return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  const toggleSort = (col: 'title' | 'domain') =>
    setSort(prev => ({ col, dir: prev.col === col && prev.dir === 'asc' ? 'desc' : 'asc' }));

  const toggleRow = (url: string) =>
    setSelected(prev => { const n = new Set(prev); n.has(url) ? n.delete(url) : n.add(url); return n; });

  const setUrlsSelected = (urls: string[], select: boolean) =>
    setSelected(prev => {
      const n = new Set(prev);
      urls.forEach(u => select ? n.add(u) : n.delete(u));
      return n;
    });

  const toggleSite = (urls: string[]) => setUrlsSelected(urls, !urls.every(u => selected.has(u)));

  const allVisibleSelected = sorted.length > 0 && sorted.every(b => selected.has(b.url));
  const toggleAllVisible = () => setUrlsSelected(sorted.map(b => b.url), !allVisibleSelected);

  const allSitesSelected = recognized.length > 0 && recognized.every(b => selected.has(b.url));
  const toggleAllSites = () => setUrlsSelected(recognized.map(b => b.url), !allSitesSelected);

  const arrow = (col: 'title' | 'domain') =>
    sort.col !== col ? ' ↕' : sort.dir === 'asc' ? ' ↑' : ' ↓';

  const thStyle = (col: 'title' | 'domain'): any => ({
    padding: '8px 12px', textAlign: 'left', cursor: 'pointer',
    borderBottom: '1px solid var(--brd)', userSelect: 'none',
    color: sort.col === col ? 'var(--ac)' : 'var(--tx2)', whiteSpace: 'nowrap',
  });

  // Virtualization for the 'all bookmarks' table
  const overscan = 6;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - overscan);
  const visibleCount = Math.ceil(containerHeight / ROW_HEIGHT) + overscan * 2;
  const endIndex = Math.min(sorted.length, startIndex + visibleCount);
  const visibleRows = sorted.slice(startIndex, endIndex);
  const topPad = startIndex * ROW_HEIGHT;
  const bottomPad = (sorted.length - endIndex) * ROW_HEIGHT;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
      onClick={(e: any) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '12px', width: 'min(1000px,100%)', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>

        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--brd)', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <span style={{ fontWeight: 700, fontSize: '15px', flex: 1 }}>
            Import All {browser === 'chrome' ? 'Chrome' : 'Firefox'} Bookmarks
          </span>
          {!loading && !error && (
            <span style={{ fontSize: '12px', color: 'var(--tx3)' }}>
              {bookmarks.length} available
              {recognized.length > 0 && <span style={{ color: 'var(--ac)', marginLeft: '6px' }}>· {recognized.length} recognized</span>}
              <span style={{ marginLeft: '6px' }}>· {selected.size} selected</span>
            </span>
          )}
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '2px 6px' }}>✕</button>
        </div>

        {/* Filter + view toggle + bulk select */}
        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--brd)', display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Filter by title, URL or website…"
            aria-label="Filter bookmarks"
            value={filter}
            onInput={(e: any) => setFilter(e.target.value)}
            autoFocus
            style={{ flex: 1, minWidth: '160px', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '6px 10px', fontSize: '13px' }}
          />
          <div style={{ display: 'flex', borderRadius: '5px', overflow: 'hidden', border: '1px solid var(--brd)' }}>
            <button
              onClick={() => setViewMode('sites')}
              style={{ fontSize: '12px', padding: '5px 12px', background: viewMode === 'sites' ? 'var(--ac)' : 'var(--bg3)', border: 'none', cursor: 'pointer', color: viewMode === 'sites' ? '#fff' : 'var(--tx2)', whiteSpace: 'nowrap' }}
            >
              By Website
            </button>
            <button
              onClick={() => setViewMode('all')}
              style={{ fontSize: '12px', padding: '5px 12px', background: viewMode === 'all' ? 'var(--ac)' : 'var(--bg3)', border: 'none', cursor: 'pointer', color: viewMode === 'all' ? '#fff' : 'var(--tx2)', whiteSpace: 'nowrap' }}
            >
              All Bookmarks
            </button>
          </div>
          {viewMode === 'sites' ? (
            <>
              <button
                onClick={toggleAllSites}
                disabled={recognized.length === 0}
                style={{ fontSize: '12px', padding: '5px 12px', background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '5px', cursor: recognized.length ? 'pointer' : 'not-allowed', color: 'var(--tx2)', whiteSpace: 'nowrap', opacity: recognized.length ? 1 : 0.5 }}
              >
                {allSitesSelected ? 'Deselect all sites' : `Select all sites (${recognized.length})`}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setUrlsSelected(sorted.map(b => b.url), true)}
                style={{ fontSize: '12px', padding: '5px 12px', background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '5px', cursor: 'pointer', color: 'var(--tx2)', whiteSpace: 'nowrap' }}
              >
                Select all ({sorted.length})
              </button>
              <button
                onClick={() => setUrlsSelected(sorted.map(b => b.url), false)}
                style={{ fontSize: '12px', padding: '5px 12px', background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '5px', cursor: 'pointer', color: 'var(--tx2)', whiteSpace: 'nowrap' }}
              >
                Deselect all
              </button>
            </>
          )}
        </div>

        {/* Body */}
        <div ref={scrollRef} style={{ flex: 1, overflow: 'auto' }} onScroll={(e: any) => setScrollTop(e.target.scrollTop)}>
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--tx3)' }}>Loading bookmarks…</div>
          ) : error ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#e53935', fontSize: '13px' }}>{error}</div>
          ) : bookmarks.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--tx3)', fontSize: '13px' }}>
              No new bookmarks found — all are already imported
            </div>
          ) : viewMode === 'sites' ? (
            siteGroups.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--tx3)', fontSize: '13px' }}>
                No recognized websites — none of the bookmarked titles/URLs match a folder or tag name.{' '}
                <button
                  onClick={() => setViewMode('all')}
                  style={{ background: 'none', border: 'none', color: 'var(--ac)', cursor: 'pointer', textDecoration: 'underline', fontSize: '13px', padding: 0 }}
                >
                  Browse all bookmarks instead
                </button>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px', padding: '14px 20px' }}>
                {siteGroups.map(g => {
                  const urls = g.urls.map(b => b.url);
                  const selCount = urls.filter(u => selected.has(u)).length;
                  const allSel = selCount === urls.length;
                  return (
                    <div
                      key={g.domain}
                      onClick={() => toggleSite(urls)}
                      style={{ border: '1px solid var(--brd)', borderRadius: '8px', padding: '10px 12px', cursor: 'pointer', background: allSel ? 'var(--acg)' : selCount > 0 ? 'rgba(255,255,255,0.03)' : 'var(--bg3)', display: 'flex', flexDirection: 'column', gap: '6px' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          type="checkbox"
                          aria-label={`Select all from ${g.domain}`}
                          checked={allSel}
                          onChange={() => toggleSite(urls)}
                          onClick={(e: any) => e.stopPropagation()}
                        />
                        <img src={`https://www.google.com/s2/favicons?sz=16&domain_url=${encodeURIComponent('https://' + g.domain)}`} width="16" height="16" alt="" style={{ flexShrink: 0 }} />
                        <span style={{ fontWeight: 600, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.domain}>
                          {g.domain}
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--tx3)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <span>{urls.length} link{urls.length !== 1 ? 's' : ''}{selCount > 0 ? ` · ${selCount} selected` : ''}</span>
                        {[...g.tags].map(t => (
                          <span key={t} style={{ fontSize: '11px', background: 'var(--acg)', color: 'var(--ac)', borderRadius: '4px', padding: '1px 5px', whiteSpace: 'nowrap', border: '1px solid var(--ac)', opacity: 0.85 }}>
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : sorted.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--tx3)', fontSize: '13px' }}>
              No bookmarks match the filter
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: 'var(--bg3)', position: 'sticky', top: 0, zIndex: 1 }}>
                  <th style={{ padding: '8px 12px', borderBottom: '1px solid var(--brd)', width: '36px' }}>
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} title="Toggle all visible" />
                  </th>
                  <th style={thStyle('title')} onClick={() => toggleSort('title')}>Title{arrow('title')}</th>
                  <th style={{ ...thStyle('domain'), width: '200px' }} onClick={() => toggleSort('domain')}>Domain{arrow('domain')}</th>
                  <th style={{ padding: '8px 12px', borderBottom: '1px solid var(--brd)', width: '90px', color: 'var(--tx2)', fontSize: '11px', fontWeight: 500 }}>Match</th>
                </tr>
              </thead>
              <tbody>
                {topPad > 0 && (
                  <tr aria-hidden="true" style={{ height: `${topPad}px` }}>
                    <td colSpan={4} style={{ padding: 0, border: 'none', height: `${topPad}px` }} />
                  </tr>
                )}
                {visibleRows.map((b) => {
                  const isSelected = selected.has(b.url);
                  const i = bookmarks.indexOf(b);
                  const tag = matchedName(b, tagGroups, activeCats);
                  return (
                    <tr
                      key={b.url}
                      onClick={() => toggleRow(b.url)}
                      style={{ height: `${ROW_HEIGHT}px`, cursor: 'pointer', background: isSelected ? 'var(--acg)' : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}
                    >
                      <td style={{ padding: '7px 12px', borderBottom: '1px solid var(--brd)' }} onClick={(e: any) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Select ${b.title || b.url}`} checked={isSelected} onChange={() => toggleRow(b.url)} />
                      </td>
                      <td style={{ padding: '7px 12px', borderBottom: '1px solid var(--brd)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '460px' }} title={b.url}>
                        {b.title || '(no title)'}
                      </td>
                      <td style={{ padding: '7px 12px', borderBottom: '1px solid var(--brd)', color: 'var(--tx3)', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <img src={`https://www.google.com/s2/favicons?sz=14&domain_url=${encodeURIComponent(b.url)}`} width="14" height="14" alt="" style={{ flexShrink: 0 }} />
                          {domainOf(b.url)}
                        </div>
                      </td>
                      <td style={{ padding: '7px 12px', borderBottom: '1px solid var(--brd)' }}>
                        {tag && (
                          <span style={{ fontSize: '11px', background: 'var(--acg)', color: 'var(--ac)', borderRadius: '4px', padding: '2px 6px', whiteSpace: 'nowrap', border: '1px solid var(--ac)', opacity: 0.85 }}>
                            {tag}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {bottomPad > 0 && (
                  <tr aria-hidden="true" style={{ height: `${bottomPad}px` }}>
                    <td colSpan={4} style={{ padding: 0, border: 'none', height: `${bottomPad}px` }} />
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--brd)', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, background: 'var(--bg3)' }}>
          <span style={{ fontSize: '13px', color: 'var(--tx2)', flex: 1 }}>
            {selected.size > 0 ? `${selected.size} bookmark${selected.size !== 1 ? 's' : ''} selected` : 'No bookmarks selected'}
          </span>
          <button onClick={onClose} style={{ padding: '7px 16px', background: 'var(--bg2)', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Cancel</button>
          <button
            onClick={() => onImport(bookmarks.filter(b => selected.has(b.url)))}
            disabled={selected.size === 0}
            style={{ padding: '7px 16px', background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: selected.size > 0 ? 'pointer' : 'not-allowed', opacity: selected.size > 0 ? 1 : 0.45 }}
          >
            Import {selected.size > 0 ? `${selected.size} Bookmark${selected.size !== 1 ? 's' : ''}` : 'Selected'}
          </button>
        </div>
      </div>
    </div>
  );
};

export const LinksView = () => {
  const [items, setItems] = useState<LinkItem[]>([]);
  const [visibleItems, setVisibleItems] = useState<LinkItem[]>([]);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'title' | 'domain'>('newest');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [groupByCategory, setGroupByCategory] = useState(true);
  const [activeCats, setActiveCats] = useState<ActiveCat[]>([]);
  const [matchedCount, setMatchedCount] = useState(0);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [websites, setWebsites] = useState<any[]>([]);
  const [selectedWebsite, setSelectedWebsite] = useState<string>('');

  const [bmPickerBrowser, setBmPickerBrowser] = useState<'chrome' | 'firefox' | null>(null);
  const [importMenuOpen, setImportMenuOpen] = useState<'chrome' | 'firefox' | null>(null);

  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());

  const toggleSelect = (url: string) =>
    setSelectedUrls(prev => { const n = new Set(prev); n.has(url) ? n.delete(url) : n.add(url); return n; });
  const selectUrls = (urls: string[]) =>
    setSelectedUrls(prev => new Set([...prev, ...urls]));
  const deselectUrls = (urls: string[]) =>
    setSelectedUrls(prev => { const n = new Set(prev); urls.forEach(u => n.delete(u)); return n; });

  const dlPollerRef = useRef<any>(null);
  const [scrapeJob, setScrapeJob] = useState<{ running: boolean, total: number, done: number, failed: number, current: string } | null>(null);
  const scrapePollerRef = useRef<any>(null);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const r = await fetch('/api/links/scrape-status');
        const d = await r.json();
        setScrapeJob(d);
        if (d.running && !scrapePollerRef.current) {
          scrapePollerRef.current = setInterval(async () => {
            const r2 = await fetch('/api/links/scrape-status');
            const d2 = await r2.json();
            setScrapeJob(d2);
            if (!d2.running && scrapePollerRef.current) {
              clearInterval(scrapePollerRef.current);
              scrapePollerRef.current = null;
            }
          }, 1500);
        }
      } catch (e) {}
    };
    checkStatus();
    return () => { if (scrapePollerRef.current) clearInterval(scrapePollerRef.current); };
  }, []);

  const loadLinks = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/links/cache?limit=0');
      const d = await r.json();
      if (d.items) {
        setItems(d.items);
        updateMatches(d.items);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadLinks(); }, []);

  useEffect(() => {
    fetch('/api/websites')
      .then(r => r.json())
      .then(setWebsites)
      .catch(() => {});
    fetch('/api/folders')
      .then(r => r.json())
      .then(data => setActiveCats(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const updateMatches = (items: LinkItem[]) => {
    rebuildLinkVidIds(items);
    // Count matches
    const w = window as any;
    const vids = w.V || [];
    let count = 0;
    for (const item of items) {
      const haystack = item.url.toLowerCase();
      const isMatch = vids.some((v: any) => {
        const fname = v.name.toLowerCase().replace(/\.[^.]+$/, '');
        return haystack.includes(fname);
      });
      if (isMatch) count++;
    }
    setMatchedCount(count);
  };

  useEffect(() => {
    const term = search.trim().toLowerCase();
    let filtered = items;

    if (selectedWebsite) {
      filtered = filtered.filter(item => {
        try {
          const itemUrl = new URL(item.url);
          const webUrl = new URL(selectedWebsite);
          return itemUrl.hostname === webUrl.hostname || itemUrl.hostname.endsWith('.' + webUrl.hostname);
        } catch {
          return item.url.includes(selectedWebsite);
        }
      });
    }

    if (term) {
      filtered = filtered.filter(item => item.title.toLowerCase().includes(term) || item.url.toLowerCase().includes(term));
    }

    const domainOf = (item: LinkItem) => { try { return new URL(item.url).hostname; } catch { return item.url; } };
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'oldest': return (a.addedAt || 0) - (b.addedAt || 0);
        case 'title': return a.title.localeCompare(b.title);
        case 'domain': return domainOf(a).localeCompare(domainOf(b));
        default: return (b.addedAt || 0) - (a.addedAt || 0);
      }
    });

    setVisibleItems(sorted);
  }, [search, items, selectedWebsite, sortBy]);

  // Download poller
  useEffect(() => {
    const checkJobs = async () => {
      try {
        const r = await fetch('/api/download/jobs');
        const d = await r.json();
        setJobs(d);
        const active = d.some((j: any) => j.status === 'queued' || j.status === 'running');
        if (!active && dlPollerRef.current) {
          clearInterval(dlPollerRef.current);
          dlPollerRef.current = null;
        }
      } catch { }
    };

    const active = jobs.some(j => j.status === 'queued' || j.status === 'running');
    if (active && !dlPollerRef.current) {
      dlPollerRef.current = setInterval(checkJobs, 1500);
    }

    return () => {
      if (dlPollerRef.current) clearInterval(dlPollerRef.current);
    };
  }, [jobs]);

  const importFavs = async (browser: 'chrome' | 'firefox') => {
    setLoading(true);
    try {
      const r = await fetch(`/api/browser-favs?browser=${browser}`);
      const d = await r.json();
      if (d.items) {
        // Server already filters by category & tag names; just merge with existing items
        const existingUrls = new Set(items.map(it => it.url));
        const existingNames = new Set(items.map(it => (it.title || '').trim().toLowerCase()).filter(Boolean));
        const newItems = [...items];
        for (const item of d.items) {
          const nm = (item.title || '').trim().toLowerCase();
          if (!existingUrls.has(item.url) && !(nm && existingNames.has(nm))) {
            newItems.push(item);
            existingUrls.add(item.url);
            if (nm) existingNames.add(nm);
          }
        }
        
        setItems(newItems);
        updateMatches(newItems);
        
        // Save to cache
        await fetch('/api/links/cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: newItems })
        });
        
        const w = window as any;
        if (w.toast) w.toast(`Imported ${newItems.length - items.length} links`);
      } else if (d.cat_tag_empty) {
        const w = window as any;
        if (w.toast) w.toast('No categories or tags defined — add some first', 4000);
      }
    } catch { }
    setLoading(false);
  };

  const handlePickerImport = async (picked: { title: string; url: string }[]) => {
    setBmPickerBrowser(null);
    if (!picked.length) return;
    const existingUrls = new Set(items.map(it => it.url));
    const newItems = [...items];
    for (const bm of picked) {
      if (!existingUrls.has(bm.url)) {
        newItems.push({ url: bm.url, title: bm.title || bm.url });
        existingUrls.add(bm.url);
      }
    }
    setItems(newItems);
    updateMatches(newItems);
    await fetch('/api/links/cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: newItems }),
    });
    const w = window as any;
    if (w.toast) w.toast(`Imported ${picked.length} bookmark${picked.length !== 1 ? 's' : ''}`);
  };

  const clearAll = async () => {
    if (!items.length) return;
    if (!confirm(`Clear all ${items.length} imported links?`)) return;

    await fetch('/api/links/cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [] })
    });
    setItems([]);
    setVisibleItems([]);
    setMatchedCount(0);
    rebuildLinkVidIds([]);
  };

  const removeDuplicates = async () => {
    if (!items.length) return;
    const seenUrls = new Set<string>();
    const seenNames = new Set<string>();
    const cleaned: any[] = [];
    const removedUrls: string[] = [];
    for (const item of items) {
      const u = item.url;
      const nm = (item.title || '').trim().toLowerCase();
      if (!u || seenUrls.has(u) || (nm && seenNames.has(nm))) { if (u) removedUrls.push(u); continue; }
      seenUrls.add(u);
      if (nm) seenNames.add(nm);
      cleaned.push(item);
    }
    if (!removedUrls.length) {
      const w = window as any;
      if (w.toast) w.toast('No duplicates found (by link or name)');
      return;
    }
    if (!confirm(`Remove ${removedUrls.length} duplicate links (same URL or same name)? Keep ${cleaned.length}?`)) return;
    setItems(cleaned);
    updateMatches(cleaned);
    try {
      await fetch('/api/links/items', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: removedUrls })
      });
      const w = window as any;
      if (w.toast) w.toast(`Removed ${removedUrls.length} duplicates`);
    } catch (e: any) {
      alert('Error removing duplicates: ' + e.message);
    }
  };

  const removeItem = async (url: string) => {
    const newItems = items.filter(it => it.url !== url);
    setItems(newItems);
    updateMatches(newItems);
    await fetch('/api/links/item', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
  };

  const toggleStar = async (url: string) => {
    const item = items.find(it => it.url === url);
    if (!item) return;
    const fav = !item.fav;
    setItems(prev => prev.map(it => it.url === url ? { ...it, fav } : it));
    await fetch('/api/links/item', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, fav })
    });
  };

  const updateItem = async (url: string, updates: Partial<LinkItem>) => {
    setItems(prev => prev.map(it => it.url === url ? { ...it, ...updates } : it));
    await fetch('/api/links/item', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, ...updates })
    });
  };

  const moveSelectedToVault = async () => {
    const urls = [...selectedUrls];
    if (!urls.length) { alert('Select at least one link'); return; }
    const r = await fetch('/api/vault/move-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
    });
    if (r.ok) {
      setItems(prev => prev.filter(it => !urls.includes(it.url)));
      setSelectedUrls(new Set());
      const w = window as any;
      if (w.toast) w.toast(`${urls.length} link(s) moved to Vault`);
    }
  };

  const moveLinkToVault = async (url: string) => {
    const r = await fetch('/api/vault/move-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: [url] }),
    });
    if (r.ok) {
      setItems(prev => prev.filter(it => it.url !== url));
      const w = window as any;
      if (w.toast) w.toast('Link moved to Vault');
    }
  };

  const downloadSelected = async () => {
    const urls = [...selectedUrls];
    if (!urls.length) {
      alert('Select at least one link');
      return;
    }
    const r = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls, category: '' })
    });
    if (r.ok) {
      // Start poller
      const jobsRes = await fetch('/api/download/jobs');
      const jobsData = await jobsRes.json();
      setJobs(jobsData);
    }
  };

  const openAllVisible = () => {
    if (!visibleItems.length) return;
    const n = visibleItems.length;
    if (n > 10 && !confirm(`Open ${n} tabs?`)) return;
    visibleItems.forEach((item, i) => {
      setTimeout(() => {
        window.open(item.url, '_blank');
      }, i * 100);
    });
  };

  const copyAllVisible = () => {
    if (!visibleItems.length) return;
    const text = visibleItems.map(item => item.url).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      alert(`Copied ${visibleItems.length} URLs`);
    });
  };

  const copyAllLinks = () => {
    if (!items.length) return;
    const text = items.map(item => item.url).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      alert(`Copied ${items.length} URLs`);
    });
  };

  const saveToDb = async () => {
    if (!items.length) {
      alert('No links to save');
      return;
    }
    setLoading(true);
    try {
      const r = await fetch('/api/links/save-to-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      });
      const d = await r.json();
      if (d.ok) {
        const w = window as any;
        if (w.toast) w.toast(`Saved ${d.count} links to DB`);
      } else {
        alert('Failed to save links: ' + (d.error || 'Unknown error'));
      }
    } catch (e: any) {
      alert('Error saving links: ' + e.message);
    }
    setLoading(false);
  };

  const startScraping = async () => {
    try {
      const r = await fetch('/api/links/start-scraping', { method: 'POST' });
      const d = await r.json();
      if (d.ok) {
        const w = window as any;
        if (w.toast) w.toast('Scraping started');
      } else {
        alert('Failed to start scraping: ' + (d.error || 'Unknown error'));
      }
    } catch (e: any) {
      alert('Error starting scraping: ' + e.message);
    }
  };

  const rescrapeAll = async () => {
    if (!confirm('Clear all scraped data and rescrape everything from scratch?')) return;
    try {
      const r = await fetch('/api/links/rescrape-all', { method: 'POST' });
      const d = await r.json();
      if (d.ok) {
        const w = window as any;
        if (w.toast) w.toast('Rescraping all from start');
      }
    } catch (e: any) {
      alert('Error: ' + e.message);
    }
  };

  const total = items.length;
  const pct = total ? Math.round((matchedCount / total) * 100) : 0;

  const importFileRef = useRef<HTMLInputElement>(null);

  const exportLinksJson = async () => {
    const r = await fetch('/api/links/export');
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aphroarchive-links-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const onImportFileChange = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    (e.target as HTMLInputElement).value = '';
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const r = await fetch('/api/links/import-json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const d = await r.json();
      if (d.error) { alert('Import error: ' + d.error); return; }
      const w = window as any;
      if (w.toast) w.toast(`Imported: +${d.added} new · ${d.skipped} skipped · ${d.total} total`);
      await loadLinks();
    } catch (err: any) {
      alert('Failed to parse JSON: ' + err.message);
    }
  };

  return (
    <div class="import-favs-view on" style={{ padding: '20px' }}>
      <div class="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ margin: 0 }}>Links</h1>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          {importMenuOpen && <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setImportMenuOpen(null)} />}

          {(['chrome', 'firefox'] as const).map(browser => (
            <div key={browser} style={{ position: 'relative' }}>
              <button type="button" class="sort-btn" onClick={() => setImportMenuOpen(v => v === browser ? null : browser)}>
                {browser === 'chrome' ? 'Chrome' : 'Firefox'} ▾
              </button>
              {importMenuOpen === browser && (
                <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '8px', zIndex: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', minWidth: '220px', overflow: 'hidden' }}>
                  <button
                    type="button"
                    onClick={() => { setImportMenuOpen(null); importFavs(browser); }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', color: 'var(--tx)', cursor: 'pointer', fontSize: '13px' }}
                  >
                    Import Websites Bookmarks
                  </button>
                  <button
                    type="button"
                    onClick={() => { setImportMenuOpen(null); setBmPickerBrowser(browser); }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', borderTop: '1px solid var(--brd)', borderLeft: 'none', borderRight: 'none', borderBottom: 'none', color: 'var(--tx)', cursor: 'pointer', fontSize: '13px' }}
                  >
                    Import All Bookmarks…
                  </button>
                </div>
              )}
            </div>
          ))}
          <button class="sort-btn" onClick={exportLinksJson} title={`Export all ${items.length} links as JSON`}>Export JSON</button>
          <button class="sort-btn" onClick={() => importFileRef.current?.click()} title="Import links from JSON file">Import JSON</button>
          <input ref={importFileRef as any} type="file" accept=".json,application/json" aria-label="Import links from JSON file" style={{ display: 'none' }} onChange={onImportFileChange as any} />
          <button class="sort-btn" onClick={clearAll}>Clear All</button>
          <button class="sort-btn" onClick={removeDuplicates} title="Remove links that have duplicate URL or duplicate name/title">Remove Duplicates</button>
          <button class="sort-btn" onClick={saveToDb}>Save to DB</button>
          <button class="sort-btn" onClick={startScraping}>Start Scraping</button>
          <button class="sort-btn" onClick={rescrapeAll}>Rescrape All</button>
        </div>
      </div>

        <SectionControls 
          showSort={false}
          showStarred={false}
          showShuffle={false}
          showSource={false}
          showCardSize={false}
          showFilter={true}
          currentFilter={search}
          onFilterChange={setSearch}
        >
          <span className="sg-sep"></span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }} title="Filter by Website">
            <select 
              value={selectedWebsite} 
              onChange={(e: any) => setSelectedWebsite(e.target.value)}
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '3px 6px', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer' }}
            >
              <option value="">All Websites</option>
              {websites.map(w => (
                <option key={w.name} value={w.url}>{w.name}</option>
              ))}
            </select>
          </div>
          <span className="sg-sep"></span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }} title="Sort">
            <select
              value={sortBy}
              onChange={(e: any) => setSortBy(e.target.value)}
              aria-label="Sort links"
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '3px 6px', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer' }}
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="title">Title A-Z</option>
              <option value="domain">Domain A-Z</option>
            </select>
          </div>
          <span className="sg-sep"></span>
          <div className="ss-tabs" style={{ display: 'flex', gap: '4px', background: 'var(--bg3)', padding: '2px', borderRadius: '8px' }}>
            <button className={`ss-tab ${viewMode === 'grid' ? 'on' : ''}`} onClick={() => setViewMode('grid')} style={{ padding: '4px 8px', borderRadius: '4px', border: 'none', background: viewMode === 'grid' ? 'var(--ac)' : 'transparent', color: viewMode === 'grid' ? '#fff' : 'var(--tx2)', cursor: 'pointer', fontSize: '0.75rem' }}>Grid</button>
            <button className={`ss-tab ${viewMode === 'list' ? 'on' : ''}`} onClick={() => setViewMode('list')} style={{ padding: '4px 8px', borderRadius: '4px', border: 'none', background: viewMode === 'list' ? 'var(--ac)' : 'transparent', color: viewMode === 'list' ? '#fff' : 'var(--tx2)', cursor: 'pointer', fontSize: '0.75rem' }}>List</button>
          </div>
          <span className="sg-sep"></span>
          <button className={`sort-btn ${groupByCategory ? 'on' : ''}`} onClick={() => setGroupByCategory(g => !g)} title="Group by folder">
            Folders
          </button>
          <span className="sg-sep"></span>
          <button className="sort-btn" onClick={copyAllVisible} title="Copy URLs of currently visible/filtered links">Copy URLs</button>
          <button className="sort-btn" onClick={copyAllLinks} title="Copy URLs of all links, ignoring filters">Copy All Links</button>
          <button className="sort-btn" onClick={openAllVisible}>Open All</button>
          <span className="sg-sep"></span>
          <button
            className="sort-btn"
            onClick={() => {
              const allSelected = visibleItems.length > 0 && visibleItems.every(i => selectedUrls.has(i.url));
              allSelected ? deselectUrls(visibleItems.map(i => i.url)) : selectUrls(visibleItems.map(i => i.url));
            }}
            title="Select / deselect all visible links"
          >
            {visibleItems.length > 0 && visibleItems.every(i => selectedUrls.has(i.url)) ? 'Deselect All' : `Select All${selectedUrls.size ? ` (${selectedUrls.size})` : ''}`}
          </button>
          <button className="sort-btn" onClick={downloadSelected}>Download Selected</button>
          <button className="sort-btn" onClick={moveSelectedToVault} title="Move selected links to Vault">🔒 Vault Selected</button>
        </SectionControls>

      <div class="bf-stats" style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '15px' }}>
        <span>{visibleItems.length} links</span>
        <div class="bf-pct-wrap" style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
          <div class="bf-pct-bar" style={{ width: '200px', height: '10px', background: 'var(--border)', borderRadius: '5px', overflow: 'hidden' }}>
            <div class="bf-pct-fill" style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }}></div>
          </div>
          <span>{pct}% in library</span>
        </div>
        {scrapeJob && scrapeJob.running && (
          <div class="scrape-progress" style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Scraping: {scrapeJob.done}/{scrapeJob.total}</span>
            <div style={{ width: '150px', height: '10px', background: 'var(--border)', borderRadius: '5px', overflow: 'hidden' }}>
              <div style={{ width: `${Math.round((scrapeJob.done / (scrapeJob.total || 1)) * 100)}%`, height: '100%', background: 'var(--accent)' }}></div>
            </div>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }} title={scrapeJob.current}>{scrapeJob.current}</span>
          </div>
        )}
      </div>

      {loading ? (
        <div class="cv-loading">Loading links…</div>
      ) : visibleItems.length === 0 ? (
        <div class="empty-state">No links found</div>
      ) : (() => {
        const renderCard = (item: LinkItem) => (
          <LinkCard key={item.url} item={item} onRemove={removeItem} onToggleStar={toggleStar} onUpdate={updateItem} onVault={moveLinkToVault} selected={selectedUrls.has(item.url)} onToggleSelect={toggleSelect} activeCats={activeCats} />
        );
        const renderRow = (item: LinkItem) => (
          <div key={item.url} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', borderBottom: '1px solid var(--border)' }}>
            <input type="checkbox" class="bf-chk" checked={selectedUrls.has(item.url)} onChange={() => toggleSelect(item.url)} aria-label="Select link" />
            <img src={`https://www.google.com/s2/favicons?sz=16&domain_url=${encodeURIComponent(item.url)}`} width="16" height="16" alt="" />
            <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, color: 'var(--text)', textDecoration: 'none' }}>{item.title}</a>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{new URL(item.url).hostname}</span>
            <button class="btn" onClick={() => removeItem(item.url)}>Remove</button>
          </div>
        );

        if (groupByCategory) {
          const groups: Record<string, LinkItem[]> = {};
          for (const item of visibleItems) {
            const matched = activeCats.length > 0 ? matchTitleToCategory(item.title, activeCats) : null;
            const key = matched || item.category || 'Uncategorized';
            (groups[key] = groups[key] || []).push(item);
          }
          const sortedKeys = Object.keys(groups).sort((a, b) => {
            if (a === 'Uncategorized') return 1;
            if (b === 'Uncategorized') return -1;
            return a.localeCompare(b);
          });
          return (
            <>
              {sortedKeys.map(cat => {
                const folderUrls = groups[cat].map(i => i.url);
                const selectedCount = folderUrls.filter(u => selectedUrls.has(u)).length;
                const allFolderSelected = selectedCount === folderUrls.length;
                const someFolderSelected = selectedCount > 0 && !allFolderSelected;
                return (
                <div key={cat} style={{ marginBottom: '30px' }}>
                  <div style={{ margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      aria-label={`Select all in ${cat}`}
                      checked={allFolderSelected}
                      onChange={() => (allFolderSelected || someFolderSelected) ? deselectUrls(folderUrls) : selectUrls(folderUrls)}
                      ref={(el: HTMLInputElement | null) => { if (el) el.indeterminate = someFolderSelected; }}
                      style={{ cursor: 'pointer', width: '14px', height: '14px', flexShrink: 0 }}
                    />
                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {cat} <span style={{ fontWeight: 400, opacity: 0.6 }}>({groups[cat].length})</span>
                    </h3>
                  </div>
                  {viewMode === 'grid' ? (
                    <div class="bf-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '15px' }}>
                      {groups[cat].map(renderCard)}
                    </div>
                  ) : (
                    <div class="bf-list">{groups[cat].map(renderRow)}</div>
                  )}
                </div>
                );
              })}
            </>
          );
        }

        return viewMode === 'grid' ? (
          <div class="bf-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '15px' }}>
            {visibleItems.map(renderCard)}
          </div>
        ) : (
          <div class="bf-list">{visibleItems.map(renderRow)}</div>
        );
      })()}

      {/* Download Queue */}
      {jobs.length > 0 && (
        <div id="dlQueuePanel" style={{ marginTop: '40px', padding: '20px', background: 'var(--bg2)', borderRadius: '8px' }}>
          <h3>Download Queue</h3>
          <div class="dl-queue-list">
            {jobs.map(j => (
              <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ flex: 1 }}>{j.title}</span>
                <span style={{ color: j.status === 'done' ? 'green' : j.status === 'error' ? 'red' : 'inherit' }}>{j.status}</span>
                {j.status === 'running' && (
                  <div style={{ width: '100px', height: '10px', background: 'var(--border)', borderRadius: '5px', overflow: 'hidden' }}>
                    <div style={{ width: `${j.progress || 0}%`, height: '100%', background: 'var(--accent)' }}></div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {bmPickerBrowser && (
        <BookmarkPickerModal
          browser={bmPickerBrowser}
          existingUrls={new Set(items.map(it => it.url))}
          activeCats={activeCats}
          onImport={handlePickerImport}
          onClose={() => setBmPickerBrowser(null)}
        />
      )}
    </div>
  );
};
