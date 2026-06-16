import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import { memo } from 'preact/compat';
import { rebuildLinkVidIds, currentVideo, currentView, activeProfile, isVaultUnlocked, vaultGlobalView, syncLinkCache } from '../../store';
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
  onTagClick?: (tag: string) => void;
}

const LinkCardImpl = ({ item, onRemove, onToggleStar, onUpdate, onVault, selected, onToggleSelect, activeCats, onTagClick }: LinkCardProps & { onVault?: (url: string) => void }) => {
  const hostname = new URL(item.url).hostname;
  const hasPlayable = !!(item.scrapedVideoUrl || item.embedUrl);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(item.title);
  const [editCategory, setEditCategory] = useState(item.category || '');
  const [editTags, setEditTags] = useState((item.tags || []).join(', '));

  const startEdit = (e: any) => {
    e.stopPropagation();
    setEditTitle(item.title);
    setEditCategory(item.category || '');
    setEditTags((item.tags || []).join(', '));
    setEditing(true);
  };

  const saveEdit = (e: any) => {
    e.stopPropagation();
    const title = editTitle.trim() || item.title;
    const tags = editTags.split(',').map(t => t.trim()).filter(Boolean);
    onUpdate(item.url, { title, category: editCategory, tags });
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
            <input
              type="text"
              value={editTags}
              onInput={(e: any) => setEditTags(e.target.value)}
              placeholder="tags, comma separated"
              aria-label="Link tags"
              style={{ width: '100%', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '4px', padding: '4px 6px', fontSize: '0.8rem', boxSizing: 'border-box' }}
            />
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
                  <span
                    key={t}
                    onClick={onTagClick ? (e: any) => { e.stopPropagation(); onTagClick(t); } : undefined}
                    title={onTagClick ? `Filter by "${t}"` : t}
                    style={{ fontSize: '10px', background: 'var(--acg, rgba(255,255,255,0.06))', color: 'var(--ac, var(--accent))', borderRadius: '4px', padding: '1px 5px', border: '1px solid var(--ac, var(--accent))', opacity: 0.85, cursor: onTagClick ? 'pointer' : 'default' }}
                  >
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

  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return bookmarks;
    return bookmarks.filter(b =>
      b.title.toLowerCase().includes(term) ||
      b.url.toLowerCase().includes(term) ||
      domainOf(b.url).toLowerCase().includes(term));
  }, [bookmarks, filter]);

  const recognized = useMemo(() =>
    filtered.filter(b => matchedName(b, tagGroups, activeCats) !== null),
    [filtered, tagGroups, activeCats]
  );

  const recognizedUrls = useMemo(() => new Set(recognized.map(b => b.url)), [recognized]);

  const siteGroups = useMemo(() => {
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
  }, [recognized, tagGroups, activeCats]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const aTag = recognizedUrls.has(a.url);
    const bTag = recognizedUrls.has(b.url);
    if (aTag !== bTag) return aTag ? -1 : 1;
    const av = (sort.col === 'title' ? a.title : domainOf(a.url)).toLowerCase();
    const bv = (sort.col === 'title' ? b.title : domainOf(b.url)).toLowerCase();
    return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
  }), [filtered, sort, recognizedUrls]);

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
  const [viewMode, setViewMode] = useState<'table' | 'grouped' | 'grid'>('table');
  const [expandedSites, setExpandedSites] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(`links-expanded-sites-${activeProfile.value}`);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
  });
  const [activeCats, setActiveCats] = useState<ActiveCat[]>([]);
  const [matchedCount, setMatchedCount] = useState(0);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [websites, setWebsites] = useState<any[]>([]);
  const [selectedWebsite, setSelectedWebsite] = useState<string>('');

  const [bmPickerBrowser, setBmPickerBrowser] = useState<'chrome' | 'firefox' | null>(null);
  const [showWebsitesOnly, setShowWebsitesOnly] = useState(false);
  const [showNoTagsOnly, setShowNoTagsOnly] = useState(false);
  const [showFavsOnly, setShowFavsOnly] = useState(false);
  const [tagFilter, setTagFilter] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [addText, setAddText] = useState('');
  const [addCategory, setAddCategory] = useState('');
  const [adding, setAdding] = useState(false);

  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [bulkCategory, setBulkCategory] = useState('');

  const toggleSelect = (url: string) =>
    setSelectedUrls(prev => { const n = new Set(prev); n.has(url) ? n.delete(url) : n.add(url); return n; });
  const selectUrls = (urls: string[]) =>
    setSelectedUrls(prev => new Set([...prev, ...urls]));
  const deselectUrls = (urls: string[]) =>
    setSelectedUrls(prev => { const n = new Set(prev); urls.forEach(u => n.delete(u)); return n; });

  const dlPollerRef = useRef<any>(null);
  const [scrapeJob, setScrapeJob] = useState<{ running: boolean, total: number, done: number, failed: number, current: string } | null>(null);
  const scrapePollerRef = useRef<any>(null);

  const BATCH_SIZE = 500;
  const [totalCount, setTotalCount] = useState(0);
  const [allLoaded, setAllLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pendingSelectAll, setPendingSelectAll] = useState(false);
  const loadRemainingLinksRef = useRef<AbortController | null>(null);

  const TABLE_ROW_H = 33;
  const GRID_CARD_H = 225;
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [tableScrollTop, setTableScrollTop] = useState(0);
  const [tableContainerH, setTableContainerH] = useState(600);
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const [gridScrollTop, setGridScrollTop] = useState(0);
  const [gridContainerH, setGridContainerH] = useState(600);
  const [gridContainerW, setGridContainerW] = useState(800);

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
              loadLinks();
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
    setAllLoaded(false);
    loadRemainingLinksRef.current?.abort();
    try {
      const r = await fetch(`/api/links/cache?limit=${BATCH_SIZE}&page=1`);
      const d = await r.json();
      if (d.items) {
        setItems(d.items);
        setTotalCount(d.total);
        updateMatches(d.items);
        if (!d.hasMore) {
          setAllLoaded(true);
        } else {
          setLoading(false);
          loadRemainingLinks(d.items, d.total);
          return;
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const loadRemainingLinks = async (initialItems: LinkItem[], total: number) => {
    const controller = new AbortController();
    loadRemainingLinksRef.current = controller;
    setLoadingMore(true);
    let allItems = [...initialItems];
    let page = 2;
    while (allItems.length < total) {
      if (controller.signal.aborted) return;
      try {
        const r = await fetch(`/api/links/cache?limit=${BATCH_SIZE}&page=${page}`, { signal: controller.signal });
        const d = await r.json();
        if (!d.items || d.items.length === 0) break;
        allItems = [...allItems, ...d.items];
        setItems([...allItems]);
        if (!d.hasMore) break;
        page++;
      } catch (e: any) {
        if (e.name === 'AbortError') return;
        break;
      }
    }
    updateMatches(allItems);
    setAllLoaded(true);
    setLoadingMore(false);
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

  const websiteHostnames = useMemo(() =>
    new Set(websites.map((w: any) => { try { return new URL(w.url).hostname; } catch { return ''; } }).filter(Boolean)),
    [websites]
  );

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of items) for (const t of it.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [items]);

  const favCount = useMemo(() => items.filter(it => it.fav).length, [items]);

  const isRecognizedUrl = (url: string) => {
    try {
      const h = new URL(url).hostname;
      return websiteHostnames.has(h) || [...websiteHostnames].some(wh => h === wh || h.endsWith('.' + wh));
    } catch { return false; }
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

    if (showWebsitesOnly && websiteHostnames.size > 0) {
      filtered = filtered.filter(item => isRecognizedUrl(item.url));
    }

    if (showNoTagsOnly) {
      filtered = filtered.filter(item => !item.tags || item.tags.length === 0);
    }

    if (showFavsOnly) {
      filtered = filtered.filter(item => item.fav);
    }

    if (tagFilter) {
      filtered = filtered.filter(item => (item.tags || []).includes(tagFilter));
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
  }, [search, items, selectedWebsite, showWebsitesOnly, showNoTagsOnly, showFavsOnly, tagFilter, websiteHostnames, sortBy]);

  useEffect(() => {
    if (pendingSelectAll && allLoaded) {
      setSelectedUrls(new Set(items.map(i => i.url)));
      setPendingSelectAll(false);
    }
  }, [pendingSelectAll, allLoaded, items]);

  // Once the full link list is in memory, push it into the topbar/sidebar Links
  // dropdown's data source + localStorage cache so any save (add / edit / star /
  // tag / delete) reflects immediately and renders instantly on the next load.
  // Gated on allLoaded so a partial (paginating) list never overwrites the cache.
  useEffect(() => {
    if (allLoaded) syncLinkCache(items, items.length);
  }, [items, allLoaded]);

  useEffect(() => {
    const el = tableScrollRef.current;
    if (!el || viewMode !== 'table') return;
    const update = () => setTableContainerH(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewMode]);

  useEffect(() => {
    const el = gridScrollRef.current;
    if (!el || viewMode !== 'grid') return;
    const update = () => { setGridContainerH(el.clientHeight); setGridContainerW(el.clientWidth); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewMode]);

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


  const addBookmarks = async () => {
    const urls = addText
      .split(/[\s,]+/)
      .map(u => u.trim())
      .filter(u => /^https?:\/\//i.test(u));
    if (!urls.length) { alert('Paste at least one valid http(s) URL'); return; }
    setAdding(true);
    try {
      const r = await fetch('/api/links/import-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      });
      const d = await r.json();
      if (d.error) { alert('Add failed: ' + d.error); return; }
      // Apply the chosen category to the freshly-added links
      if (addCategory && d.added > 0) {
        await fetch('/api/links/move', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls, category: addCategory }),
        });
      }
      await loadLinks();
      setAddText('');
      setAddCategory('');
      setShowAdd(false);
      const w = window as any;
      if (w.toast) w.toast(`Added ${d.added} bookmark${d.added !== 1 ? 's' : ''}${d.skipped ? ` · ${d.skipped} skipped` : ''}`);
    } catch (e: any) {
      alert('Add failed: ' + e.message);
    } finally {
      setAdding(false);
    }
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

  const toast = (msg: string) => { const w = window as any; if (w.toast) w.toast(msg); };

  // Apply a bulk change to all selected links, updating local state optimistically.
  const bulkUpdate = async (
    payload: { addTags?: string[]; removeTags?: string[]; setTags?: string[]; category?: string; fav?: boolean },
    apply: (it: LinkItem) => LinkItem,
  ) => {
    const urls = [...selectedUrls];
    if (!urls.length) { toast('Select at least one link'); return; }
    const urlSet = new Set(urls);
    const next = items.map(it => urlSet.has(it.url) ? apply(it) : it);
    setItems(next);
    updateMatches(next);
    const r = await fetch('/api/links/bulk', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls, ...payload }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); alert('Bulk update failed: ' + (d.error || r.statusText)); await loadLinks(); }
    return urls.length;
  };

  const parseTags = (s: string) => s.split(',').map(t => t.trim()).filter(Boolean);

  const bulkAddTags = async () => {
    const tags = parseTags(bulkTagInput);
    if (!tags.length) { toast('Type one or more tags first'); return; }
    const n = await bulkUpdate({ addTags: tags }, it => ({ ...it, tags: [...new Set([...(it.tags || []), ...tags])] }));
    if (n) { setBulkTagInput(''); toast(`Added ${tags.length} tag(s) to ${n} link(s)`); }
  };

  const bulkRemoveTags = async () => {
    const tags = parseTags(bulkTagInput);
    if (!tags.length) { toast('Type one or more tags first'); return; }
    const n = await bulkUpdate({ removeTags: tags }, it => ({ ...it, tags: (it.tags || []).filter(t => !tags.includes(t)) }));
    if (n) { setBulkTagInput(''); toast(`Removed ${tags.length} tag(s) from ${n} link(s)`); }
  };

  const bulkSetTags = async () => {
    const tags = parseTags(bulkTagInput);
    const n = await bulkUpdate({ setTags: tags }, it => ({ ...it, tags: [...tags] }));
    if (n) { setBulkTagInput(''); toast(tags.length ? `Set tags on ${n} link(s)` : `Cleared tags on ${n} link(s)`); }
  };

  const bulkSetCategory = async () => {
    const n = await bulkUpdate({ category: bulkCategory }, it => ({ ...it, category: bulkCategory }));
    if (n) toast(bulkCategory ? `Moved ${n} link(s) to ${bulkCategory}` : `Cleared folder on ${n} link(s)`);
  };

  const bulkSetFav = async (fav: boolean) => {
    const n = await bulkUpdate({ fav }, it => ({ ...it, fav }));
    if (n) toast(`${fav ? 'Starred' : 'Unstarred'} ${n} link(s)`);
  };

  const deleteSelected = async () => {
    const urls = [...selectedUrls];
    if (!urls.length) { toast('Select at least one link'); return; }
    if (!confirm(`Delete ${urls.length} selected link(s)?`)) return;
    const urlSet = new Set(urls);
    const next = items.filter(it => !urlSet.has(it.url));
    setItems(next);
    updateMatches(next);
    setSelectedUrls(new Set());
    await fetch('/api/links/items', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
    });
    toast(`Deleted ${urls.length} link(s)`);
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
      if (w.toast) w.toast(`${urls.length} link(s) encrypted to Vault`);
    }
  };

  const encryptSelected = async () => {
    const urls = [...selectedUrls];
    if (!urls.length) { const w = window as any; if (w.toast) w.toast('Select at least one link'); return; }
    const r = await fetch('/api/vault/move-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
    });
    if (r.ok) {
      setItems(prev => prev.filter(it => !urls.includes(it.url)));
      setSelectedUrls(new Set());
      const w = window as any;
      if (w.toast) w.toast(`${urls.length} link(s) encrypted to Vault`);
    } else {
      const d = await r.json().catch(() => ({}));
      alert('Encrypt failed: ' + (d.error || r.statusText));
    }
  };

  const decryptSelected = async () => {
    const urls = [...selectedUrls];
    if (!urls.length) { const w = window as any; if (w.toast) w.toast('Select at least one link'); return; }
    const r = await fetch('/api/vault/restore-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
    });
    if (r.ok) {
      setItems(prev => prev.filter(it => !urls.includes(it.url)));
      setSelectedUrls(new Set());
      const w = window as any;
      if (w.toast) w.toast(`${urls.length} link(s) decrypted to public`);
    } else {
      const d = await r.json().catch(() => ({}));
      alert('Decrypt failed: ' + (d.error || r.statusText));
    }
  };

  const toggleSiteCollapse = (site: string) => {
    setExpandedSites(prev => {
      const next = new Set(prev);
      next.has(site) ? next.delete(site) : next.add(site);
      try {
        localStorage.setItem(`links-expanded-sites-${activeProfile.value}`, JSON.stringify([...next]));
      } catch {}
      return next;
    });
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
          <button type="button" class={`sort-btn${showAdd ? ' on' : ''}`} onClick={() => setShowAdd(v => !v)} title="Add a bookmark by URL">+ Add Bookmark</button>
          <button type="button" class="sort-btn" onClick={() => setBmPickerBrowser('chrome')}>Import from Chrome</button>
          <button type="button" class="sort-btn" onClick={() => setBmPickerBrowser('firefox')}>Import from Firefox</button>
          <button class="sort-btn" onClick={exportLinksJson} title={`Export all ${items.length} links as JSON`}>Export JSON</button>
          <button class="sort-btn" onClick={() => importFileRef.current?.click()} title="Import links from JSON file">Import JSON</button>
          <input ref={importFileRef as any} type="file" accept=".json,application/json" aria-label="Import links from JSON file" style={{ display: 'none' }} onChange={onImportFileChange as any} />
          <button class="sort-btn" onClick={clearAll}>Clear All</button>
          <button class="sort-btn" onClick={removeDuplicates} title="Remove links that have duplicate URL or duplicate name/title">Remove Duplicates</button>
          <button class="sort-btn" onClick={startScraping}>Start Scraping</button>
          <button class="sort-btn" onClick={rescrapeAll}>Rescrape All</button>
        </div>
      </div>

      {showAdd && (
        <div style={{ marginBottom: '16px', padding: '14px', background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <textarea
            value={addText}
            onInput={(e: any) => setAddText(e.target.value)}
            placeholder="Paste one or more URLs (separated by spaces, commas or new lines)…"
            aria-label="Bookmark URLs"
            autoFocus
            rows={3}
            onKeyDown={(e: any) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') addBookmarks(); }}
            style={{ width: '100%', resize: 'vertical', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '8px 10px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={addCategory}
              onChange={(e: any) => setAddCategory(e.target.value)}
              aria-label="Folder for new bookmarks"
              style={{ background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '6px 8px', fontSize: '13px' }}
            >
              <option value="">Auto / Uncategorized</option>
              {activeCats.map(c => (<option key={c.name} value={c.name}>{c.path}</option>))}
            </select>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>Ctrl+Enter to add</span>
            <button type="button" class="sort-btn" onClick={() => { setShowAdd(false); setAddText(''); }}>Cancel</button>
            <button type="button" class="sort-btn on" onClick={addBookmarks} disabled={adding || !addText.trim()}>{adding ? 'Adding…' : 'Add'}</button>
          </div>
        </div>
      )}

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
            {(['table', 'grouped', 'grid'] as const).map(m => (
              <button key={m} className={`ss-tab ${viewMode === m ? 'on' : ''}`} onClick={() => setViewMode(m)} style={{ padding: '4px 8px', borderRadius: '4px', border: 'none', background: viewMode === m ? 'var(--ac)' : 'transparent', color: viewMode === m ? '#fff' : 'var(--tx2)', cursor: 'pointer', fontSize: '0.75rem', textTransform: 'capitalize' }}>{m === 'grouped' ? 'By Site' : m.charAt(0).toUpperCase() + m.slice(1)}</button>
            ))}
          </div>
          <span className="sg-sep"></span>
          <button className="sort-btn" onClick={copyAllVisible} title="Copy URLs of currently visible/filtered links">Copy URLs</button>
          <button className="sort-btn" onClick={copyAllLinks} title="Copy URLs of all links, ignoring filters">Copy All Links</button>
          <button className="sort-btn" onClick={openAllVisible}>Open All</button>
          <span className="sg-sep"></span>
          <button
            className={`sort-btn${showWebsitesOnly ? ' on' : ''}`}
            onClick={() => setShowWebsitesOnly(v => !v)}
            title="Show only links from websites in your database"
          >
            Websites Only
          </button>
          <button
            className={`sort-btn${showNoTagsOnly ? ' on' : ''}`}
            onClick={() => setShowNoTagsOnly(v => !v)}
            title="Show only links without any tags"
          >
            No Tags
          </button>
          <button
            className={`sort-btn${showFavsOnly ? ' on' : ''}`}
            onClick={() => setShowFavsOnly(v => !v)}
            title="Show only starred bookmarks"
          >
            ★ Favourites{favCount ? ` (${favCount})` : ''}
          </button>
          {allTags.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }} title="Filter by tag">
              <select
                value={tagFilter}
                onChange={(e: any) => setTagFilter(e.target.value)}
                aria-label="Filter by tag"
                style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '3px 6px', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer' }}
              >
                <option value="">All Tags</option>
                {allTags.map(([t, n]) => (
                  <option key={t} value={t}>{t} ({n})</option>
                ))}
              </select>
            </div>
          )}
          <span className="sg-sep"></span>
          <button
            className="sort-btn"
            onClick={() => selectUrls(items.filter(i => isRecognizedUrl(i.url)).map(i => i.url))}
            title="Add all links from known database websites to selection"
            disabled={websiteHostnames.size === 0}
          >
            + Recognized
          </button>
          <button
            className="sort-btn"
            onClick={() => selectUrls(items.filter(i => !isRecognizedUrl(i.url)).map(i => i.url))}
            title="Add all links from unknown websites to selection"
          >
            + Unrecognized
          </button>
          <button
            className="sort-btn"
            onClick={() => {
              const allSelected = allLoaded && items.length > 0 && items.every(i => selectedUrls.has(i.url));
              if (allSelected) {
                setSelectedUrls(new Set());
                setPendingSelectAll(false);
              } else if (!allLoaded) {
                setPendingSelectAll(true);
              } else {
                setSelectedUrls(new Set(items.map(i => i.url)));
              }
            }}
            title="Select / deselect all links (including filtered-out ones)"
          >
            {pendingSelectAll
              ? `Selecting… (${items.length}/${totalCount})`
              : allLoaded && items.length > 0 && items.every(i => selectedUrls.has(i.url))
                ? 'Deselect All'
                : `Select All${selectedUrls.size ? ` (${selectedUrls.size})` : ''}`}
          </button>
          <button
            className="sort-btn"
            onClick={() => {
              const allVisibleSel = visibleItems.length > 0 && visibleItems.every(i => selectedUrls.has(i.url));
              allVisibleSel ? deselectUrls(visibleItems.map(i => i.url)) : selectUrls(visibleItems.map(i => i.url));
            }}
            title="Select / deselect only visible (filtered) links"
          >
            {visibleItems.length > 0 && visibleItems.every(i => selectedUrls.has(i.url)) ? 'Desel. Visible' : 'Select Visible'}
          </button>
        </SectionControls>

      <div class="bf-stats" style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '15px', flexWrap: 'wrap' }}>
        <span>{visibleItems.length} links</span>
        {tagFilter && (
          <button
            type="button"
            onClick={() => setTagFilter('')}
            title="Clear tag filter"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', background: 'var(--acg, rgba(255,255,255,0.06))', color: 'var(--ac, var(--accent))', border: '1px solid var(--ac, var(--accent))', borderRadius: '12px', padding: '2px 10px', cursor: 'pointer' }}
          >
            tag: {tagFilter} ✕
          </button>
        )}
        <div class="bf-pct-wrap" style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
          <div class="bf-pct-bar" style={{ width: '200px', height: '10px', background: 'var(--border)', borderRadius: '5px', overflow: 'hidden' }}>
            <div class="bf-pct-fill" style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }}></div>
          </div>
          <span>{pct}% in library</span>
        </div>
        {loadingMore && (
          <span style={{ fontSize: '12px', color: 'var(--tx3)' }}>Loading {items.length} / {totalCount}…</span>
        )}
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
      ) : viewMode === 'grid' ? (() => {
        const cardsPerRow = Math.max(1, Math.floor((gridContainerW + 15) / 215));
        const rowCount = Math.ceil(visibleItems.length / cardsPerRow);
        const OVERSCAN = 3;
        const startRow = Math.max(0, Math.floor(gridScrollTop / GRID_CARD_H) - OVERSCAN);
        const endRow = Math.min(rowCount, Math.ceil((gridScrollTop + gridContainerH) / GRID_CARD_H) + OVERSCAN);
        const visibleCards = visibleItems.slice(startRow * cardsPerRow, Math.min(visibleItems.length, endRow * cardsPerRow));
        const topPad = startRow * GRID_CARD_H;
        const bottomPad = (rowCount - endRow) * GRID_CARD_H;
        return (
          <div
            ref={gridScrollRef}
            style={{ overflow: 'auto', height: 'calc(100vh - 320px)', minHeight: '400px' }}
            onScroll={(e: any) => setGridScrollTop(e.currentTarget.scrollTop)}
          >
            <div class="bf-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '15px' }}>
              {topPad > 0 && <div style={{ gridColumn: '1 / -1', height: topPad }} />}
              {visibleCards.map(item => (
                <LinkCard key={item.url} item={item} onRemove={removeItem} onToggleStar={toggleStar} onUpdate={updateItem} onVault={moveLinkToVault} selected={selectedUrls.has(item.url)} onToggleSelect={toggleSelect} activeCats={activeCats} onTagClick={setTagFilter} />
              ))}
              {bottomPad > 0 && <div style={{ gridColumn: '1 / -1', height: bottomPad }} />}
            </div>
          </div>
        );
      })() : viewMode === 'table' ? (() => {
        const OVERSCAN = 8;
        const startIdx = Math.max(0, Math.floor(tableScrollTop / TABLE_ROW_H) - OVERSCAN);
        const endIdx = Math.min(visibleItems.length, Math.ceil((tableScrollTop + tableContainerH) / TABLE_ROW_H) + OVERSCAN);
        const visibleRows = visibleItems.slice(startIdx, endIdx);
        const topPad = startIdx * TABLE_ROW_H;
        const bottomPad = (visibleItems.length - endIdx) * TABLE_ROW_H;
        const allSel = visibleItems.length > 0 && visibleItems.every(i => selectedUrls.has(i.url));
        return (
          <div
            ref={tableScrollRef}
            style={{ overflow: 'auto', height: 'calc(100vh - 320px)', minHeight: '400px' }}
            onScroll={(e: any) => setTableScrollTop(e.currentTarget.scrollTop)}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--brd)', background: 'var(--bg3)', position: 'sticky', top: 0, zIndex: 1 }}>
                  <th style={{ padding: '7px 8px', width: '32px' }}>
                    <input type="checkbox" checked={allSel} onChange={() => allSel ? deselectUrls(visibleItems.map(i => i.url)) : selectUrls(visibleItems.map(i => i.url))} />
                  </th>
                  <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 600, fontSize: '12px', color: 'var(--tx2)' }}>Title</th>
                  <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 600, fontSize: '12px', color: 'var(--tx2)' }}>URL</th>
                  <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 600, fontSize: '12px', color: 'var(--tx2)' }}>Website</th>
                  <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 600, fontSize: '12px', color: 'var(--tx2)' }}>Tags</th>
                  <th style={{ width: '56px' }}></th>
                </tr>
              </thead>
              <tbody>
                {topPad > 0 && <tr style={{ height: topPad }}><td colSpan={6} style={{ padding: 0 }} /></tr>}
                {visibleRows.map((item, ri) => {
                  const i = startIdx + ri;
                  const hostname = (() => { try { return new URL(item.url).hostname; } catch { return item.url; } })();
                  return (
                    <tr
                      key={item.url}
                      onClick={() => { currentVideo.value = { id: btoa(item.url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), name: item.title, path: item.scrapedVideoUrl || '', relPath: item.url, category: item.category || 'Links', isLink: true, img: item.img, embedUrl: item.embedUrl, linkUrl: item.url } as any; currentView.value = 'player'; }}
                      style={{ height: TABLE_ROW_H, cursor: 'pointer', borderBottom: '1px solid var(--brd)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}
                    >
                      <td style={{ padding: '6px 8px' }} onClick={(e: any) => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedUrls.has(item.url)} onChange={() => toggleSelect(item.url)} aria-label={`Select ${item.title}`} />
                      </td>
                      <td style={{ padding: '6px 10px', maxWidth: '280px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                          <img src={`https://www.google.com/s2/favicons?sz=14&domain_url=${encodeURIComponent(item.url)}`} width="14" height="14" alt="" style={{ flexShrink: 0 }} loading="lazy" />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.title}>{item.title}</span>
                        </div>
                      </td>
                      <td style={{ padding: '6px 10px', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--tx3)', fontSize: '12px' }} title={item.url}>{item.url}</td>
                      <td style={{ padding: '6px 10px', color: 'var(--tx3)', whiteSpace: 'nowrap', fontSize: '12px' }}>{hostname}</td>
                      <td style={{ padding: '6px 10px' }}>
                        {item.tags && item.tags.length > 0 && (
                          <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                            {item.tags.slice(0, 3).map(t => (
                              <span key={t} onClick={(e: any) => { e.stopPropagation(); setTagFilter(t); }} title={`Filter by "${t}"`} style={{ fontSize: '10px', background: 'var(--acg, rgba(255,255,255,0.06))', color: 'var(--ac, var(--accent))', borderRadius: '4px', padding: '1px 5px', border: '1px solid var(--ac, var(--accent))', opacity: 0.85, whiteSpace: 'nowrap', cursor: 'pointer' }}>{t}</span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }} onClick={(e: any) => e.stopPropagation()}>
                        <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--tx3)', display: 'inline-flex', alignItems: 'center', marginRight: '6px' }} title="Open in browser">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                        </a>
                        <button type="button" onClick={() => removeItem(item.url)} style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: '0 2px', fontSize: '16px', lineHeight: 1 }} title="Remove">×</button>
                      </td>
                    </tr>
                  );
                })}
                {bottomPad > 0 && <tr style={{ height: bottomPad }}><td colSpan={6} style={{ padding: 0 }} /></tr>}
              </tbody>
            </table>
          </div>
        );
      })() : (() => {
        // Grouped by website — collapsible tables, all collapsed by default
        const groups: Record<string, LinkItem[]> = {};
        for (const item of visibleItems) {
          const key = (() => { try { return new URL(item.url).hostname; } catch { return 'Other'; } })();
          (groups[key] = groups[key] || []).push(item);
        }
        const sortedKeys = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length || a.localeCompare(b));
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {sortedKeys.map(site => {
              const siteUrls = groups[site].map(i => i.url);
              const selectedCount = siteUrls.filter(u => selectedUrls.has(u)).length;
              const allSiteSelected = selectedCount === siteUrls.length;
              const someSiteSelected = selectedCount > 0 && !allSiteSelected;
              const isExpanded = expandedSites.has(site);
              return (
                <div key={site} style={{ border: '1px solid var(--brd)', borderRadius: '6px', overflow: 'hidden' }}>
                  <div onClick={() => toggleSiteCollapse(site)} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '8px 12px', background: 'var(--bg3)', userSelect: 'none' }}>
                    <span style={{ fontSize: '10px', color: 'var(--tx3)', width: '10px', flexShrink: 0 }}>{isExpanded ? '▼' : '▶'}</span>
                    <input type="checkbox" aria-label={`Select all from ${site}`} checked={allSiteSelected} onChange={() => (allSiteSelected || someSiteSelected) ? deselectUrls(siteUrls) : selectUrls(siteUrls)} ref={(el: HTMLInputElement | null) => { if (el) el.indeterminate = someSiteSelected; }} onClick={(e: any) => e.stopPropagation()} style={{ cursor: 'pointer', flexShrink: 0 }} />
                    <img src={`https://www.google.com/s2/favicons?sz=14&domain_url=${encodeURIComponent('https://' + site)}`} width="14" height="14" alt="" style={{ flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, fontSize: '13px' }}>{site}</span>
                    <span style={{ fontSize: '12px', color: 'var(--tx3)' }}>({groups[site].length})</span>
                  </div>
                  {isExpanded && (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--brd)', background: 'var(--bg2)' }}>
                          <th style={{ padding: '6px 8px', width: '32px' }}>
                            <input type="checkbox" checked={allSiteSelected} onChange={() => (allSiteSelected || someSiteSelected) ? deselectUrls(siteUrls) : selectUrls(siteUrls)} ref={(el: HTMLInputElement | null) => { if (el) el.indeterminate = someSiteSelected; }} />
                          </th>
                          <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, fontSize: '11px', color: 'var(--tx2)' }}>Title</th>
                          <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, fontSize: '11px', color: 'var(--tx2)' }}>URL</th>
                          <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, fontSize: '11px', color: 'var(--tx2)' }}>Tags</th>
                          <th style={{ width: '56px' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {groups[site].map((item, i) => (
                          <tr
                            key={item.url}
                            onClick={() => { currentVideo.value = { id: btoa(item.url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), name: item.title, path: item.scrapedVideoUrl || '', relPath: item.url, category: item.category || 'Links', isLink: true, img: item.img, embedUrl: item.embedUrl, linkUrl: item.url } as any; currentView.value = 'player'; }}
                            style={{ cursor: 'pointer', borderBottom: '1px solid var(--brd)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}
                          >
                            <td style={{ padding: '5px 8px' }} onClick={(e: any) => e.stopPropagation()}>
                              <input type="checkbox" checked={selectedUrls.has(item.url)} onChange={() => toggleSelect(item.url)} aria-label={`Select ${item.title}`} />
                            </td>
                            <td style={{ padding: '5px 10px', maxWidth: '280px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                                <img src={`https://www.google.com/s2/favicons?sz=14&domain_url=${encodeURIComponent(item.url)}`} width="14" height="14" alt="" style={{ flexShrink: 0 }} loading="lazy" />
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.title}>{item.title}</span>
                              </div>
                            </td>
                            <td style={{ padding: '5px 10px', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--tx3)', fontSize: '12px' }} title={item.url}>{item.url}</td>
                            <td style={{ padding: '5px 10px' }}>
                              {item.tags && item.tags.length > 0 && (
                                <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                                  {item.tags.slice(0, 3).map(t => (
                                    <span key={t} style={{ fontSize: '10px', background: 'var(--acg, rgba(255,255,255,0.06))', color: 'var(--ac, var(--accent))', borderRadius: '4px', padding: '1px 5px', border: '1px solid var(--ac, var(--accent))', opacity: 0.85, whiteSpace: 'nowrap' }}>{t}</span>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }} onClick={(e: any) => e.stopPropagation()}>
                              <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--tx3)', display: 'inline-flex', alignItems: 'center', marginRight: '6px' }} title="Open in browser">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                              </a>
                              <button type="button" onClick={() => removeItem(item.url)} style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: '0 2px', fontSize: '16px', lineHeight: 1 }} title="Remove">×</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Mass-edit action bar */}
      {selectedUrls.size > 0 && (
        <div
          style={{
            position: 'sticky', bottom: 0, zIndex: 50, marginTop: '20px',
            background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '10px',
            boxShadow: '0 -4px 24px rgba(0,0,0,0.35)', padding: '12px 16px',
            display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
          }}
        >
          <strong style={{ fontSize: '13px', whiteSpace: 'nowrap' }}>{selectedUrls.size} selected</strong>
          <button class="sort-btn" onClick={() => setSelectedUrls(new Set())} title="Clear selection">Clear</button>

          <span className="sg-sep"></span>

          {/* Mass tagging */}
          <input
            type="text"
            value={bulkTagInput}
            onInput={(e: any) => setBulkTagInput(e.target.value)}
            onKeyDown={(e: any) => { if (e.key === 'Enter') bulkAddTags(); }}
            placeholder="tags, comma separated"
            aria-label="Bulk tags"
            list="bulk-tag-suggestions"
            style={{ minWidth: '180px', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '5px 8px', fontSize: '13px' }}
          />
          <datalist id="bulk-tag-suggestions">
            {allTags.map(([t]) => <option key={t} value={t} />)}
          </datalist>
          <button class="sort-btn" onClick={bulkAddTags} title="Add these tags to all selected links">+ Tags</button>
          <button class="sort-btn" onClick={bulkRemoveTags} title="Remove these tags from all selected links">– Tags</button>
          <button class="sort-btn" onClick={bulkSetTags} title="Replace tags on all selected links (empty clears them)">Set Tags</button>

          <span className="sg-sep"></span>

          {/* Mass move to folder */}
          <select
            value={bulkCategory}
            onChange={(e: any) => setBulkCategory(e.target.value)}
            aria-label="Bulk folder"
            style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '5px 8px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}
          >
            <option value="">Uncategorized</option>
            {activeCats.map(c => <option key={c.name} value={c.name}>{c.path}</option>)}
          </select>
          <button class="sort-btn" onClick={bulkSetCategory} title="Move all selected links to this folder">Move</button>

          <span className="sg-sep"></span>

          {/* Mass favourite */}
          <button class="sort-btn" onClick={() => bulkSetFav(true)} title="Star all selected">★ Star</button>
          <button class="sort-btn" onClick={() => bulkSetFav(false)} title="Unstar all selected">☆ Unstar</button>

          <span className="sg-sep"></span>

          <button class="sort-btn" onClick={downloadSelected}>Download</button>
          {isVaultUnlocked.value && vaultGlobalView.value ? (
            <button class="sort-btn" onClick={decryptSelected} title="Decrypt selected links back to public">Decrypt</button>
          ) : isVaultUnlocked.value ? (
            <button class="sort-btn" onClick={encryptSelected} title="Encrypt selected links into Vault">🔒 Vault</button>
          ) : (
            <button class="sort-btn" onClick={moveSelectedToVault} title="Move selected links to Vault">🔒 Vault</button>
          )}
          <button class="sort-btn" onClick={deleteSelected} style={{ color: '#e53935', borderColor: '#e53935' }} title="Delete all selected links">Delete</button>
        </div>
      )}

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
