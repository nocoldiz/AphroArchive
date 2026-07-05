import { useState, useEffect, useMemo, useRef, useCallback } from 'preact/hooks';
import { currentVideo, currentView, tagModalState, actorModalState, showAddToCollectionModal, isMuted } from '../../public/src/store';
import './RedditView.css';

// ─── helpers ─────────────────────────────────────────────────────────

const hashId = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const COLORS = ['#ff4500', '#0079d3', '#00a6a5', '#94e044', '#ffb000', '#ff66ac', '#7193ff', '#ffd635', '#46d160', '#cc3600'];
const subColor = (s: string) => COLORS[hashId(s) % COLORS.length];

const timeAgo = (mtime: number) => {
  const m = Math.floor((Date.now() - (mtime || 0)) / 60000);
  if (mtime <= 0 || m < 1) return 'just now';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`;
  return `${Math.floor(mo / 12)} year${Math.floor(mo / 12) === 1 ? '' : 's'} ago`;
};

const fmtScore = (n: number) => n >= 10000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;

const fmtDuration = (secs: number) => {
  if (!secs) return '';
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = Math.floor(secs % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

const readJson = (key: string, fallback: any) => {
  try { return JSON.parse(localStorage.getItem(key) || '') ?? fallback; } catch { return fallback; }
};

const toast = (msg: string) => { const w = window as any; if (w.toast) w.toast(msg); };

type RdItem = {
  id: string;
  kind: 'video' | 'vault' | 'photo' | 'book';
  name: string;
  category: string;
  rating?: number;
  tags?: string[];
  actors?: string[];
  channel?: string;
  note?: string;
  mtime: number;
  duration?: number;
  size?: number;
  fav?: boolean;
  ext?: string;
  catPath?: string;
};

const PAGE_SIZE = 25;
const IMG_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp'];

const thumbSrc = (item: RdItem): string => {
  if (item.kind === 'photo') return `/api/photos/${item.id}/img`;
  if (item.kind === 'video') return `/api/thumbs/${item.id}/0`;
  if (item.kind === 'vault' && IMG_EXTS.includes((item.ext || '').toLowerCase())) return `/api/vault/stream/${item.id}`;
  return '';
};

const streamSrc = (item: RdItem): string => {
  if (item.kind === 'vault') return `/api/vault/stream/${item.id}`;
  if (item.kind === 'video') return `/api/stream/${item.id}`;
  return '';
};

// ─── icons ───────────────────────────────────────────────────────────

const Icon = ({ d, size = 20 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d={d} />
  </svg>
);

const UpArrow = () => <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M10 3l7 8h-4v6H7v-6H3l7-8z" /></svg>;
const DownArrow = () => <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M10 17l-7-8h4V3h6v6h4l-7 8z" /></svg>;

// ─── main view ───────────────────────────────────────────────────────

export const RedditView = () => {
  const [vids, setVids] = useState<RdItem[]>([]);
  const [photos, setPhotos] = useState<RdItem[]>([]);
  const [books, setBooks] = useState<RdItem[]>([]);
  const [vaultItems, setVaultItems] = useState<RdItem[]>([]);
  const [vaultFavs, setVaultFavs] = useState<Set<string>>(new Set());
  const [hiddenTerms, setHiddenTerms] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [curSub, setCurSub] = useState('home');
  const [curSort, setCurSort] = useState('hot');
  const [searchQ, setSearchQ] = useState('');
  const [commFilter, setCommFilter] = useState('');
  const [viewMode, setViewMode] = useState<'card' | 'compact'>(() => (localStorage.getItem('rd_viewmode') as any) || 'card');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [joined, setJoined] = useState<Set<string>>(() => new Set(readJson('reddit_subs', [])));
  const [votes, setVotes] = useState<Record<string, number>>(() => readJson('rd_votes', {}));

  const [detail, setDetail] = useState<RdItem | null>(null);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => { loadAllData(); }, []);

  const loadAllData = async () => {
    setLoading(true);
    try {
      const [v, vStatus, p, b, lists] = await Promise.all([
        fetch('/api/videos?sort=date').then(r => r.json()).catch(() => []),
        fetch('/api/vault/status').then(r => r.json()).catch(() => ({})),
        fetch('/api/photos').then(r => r.json()).catch(() => []),
        fetch('/api/books').then(r => r.json()).catch(() => []),
        fetch('/api/settings/lists').then(r => r.json()).catch(() => ({}))
      ]);

      setVids((Array.isArray(v) ? v : []).map((x: any) => ({ ...x, kind: 'video' as const })));
      setPhotos((Array.isArray(p) ? p : []).map((x: any) => ({ ...x, kind: 'photo' as const, category: 'photos', mtime: x.date || x.mtime || 0 })));
      setBooks((Array.isArray(b) ? b : []).map((x: any) => ({ ...x, kind: 'book' as const, id: x.id || `bk_${x.name || x.title}`, name: x.title || x.name, category: 'books', mtime: x.date || x.mtime || 0 })));
      if (Array.isArray(lists.hidden)) setHiddenTerms(lists.hidden);

      if (vStatus.unlocked) {
        const [vItems, vFavs] = await Promise.all([
          fetch('/api/vault/files').then(r => r.json()).catch(() => []),
          fetch('/api/vault/favs').then(r => r.json()).catch(() => [])
        ]);
        if (Array.isArray(vItems)) {
          setVaultItems(vItems.filter((f: any) => f.type !== 'folder').map((f: any) => ({
            ...f, kind: 'vault' as const, name: f.name || f.originalName || 'Untitled', category: 'vault'
          })));
        }
        if (Array.isArray(vFavs)) setVaultFavs(new Set(vFavs));
      }
    } catch (err) {
      console.error('Reddit mode: failed to load data', err);
    }
    setLoading(false);
  };

  // ── communities (categories with counts) ──
  const communities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of vids) {
      const c = v.category || 'Uncategorized';
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [vids]);

  const scoreOf = useCallback((item: RdItem) =>
    (hashId(item.id) % 943) + 27 + (item.rating || 0) * 212 + (votes[item.id] || 0), [votes]);

  // ── feed pipeline ──
  const feedItems = useMemo(() => {
    let list: RdItem[] = [];
    if (curSub === 'home') {
      const joinedCats = [...joined].filter(j => j.startsWith('cat:')).map(j => j.slice(4));
      list = joinedCats.length ? vids.filter(v => joinedCats.includes(v.category || 'Uncategorized')) : [...vids];
      if (joined.has('__vault__') || !joinedCats.length) list = [...list, ...vaultItems];
    } else if (curSub === 'all') {
      list = [...vids, ...vaultItems, ...photos, ...books];
    } else if (curSub === 'popular') {
      list = vids.filter(v => (v.rating || 0) >= 3);
      if (!list.length) list = [...vids];
    } else if (curSub === '__photos__') {
      list = photos;
    } else if (curSub === '__books__') {
      list = books;
    } else if (curSub === '__vault__') {
      list = vaultItems;
    } else if (curSub.startsWith('cat:')) {
      const cat = curSub.slice(4);
      list = vids.filter(v => (v.category || 'Uncategorized') === cat);
    }

    if (hiddenTerms.length) {
      list = list.filter(item => {
        const name = (item.name || '').toLowerCase();
        const cat = (item.category || '').toLowerCase();
        const tags = item.tags || [];
        return !hiddenTerms.some(term => {
          const t = term.toLowerCase();
          return name.includes(t) || cat === t || cat.startsWith(t + '/') || cat.startsWith(t + '\\') ||
            tags.some(tag => tag.toLowerCase() === t);
        });
      });
    }

    if (searchQ.trim()) {
      const q = searchQ.trim().toLowerCase();
      list = list.filter(v =>
        (v.name || '').toLowerCase().includes(q) ||
        (v.category || '').toLowerCase().includes(q) ||
        (v.tags || []).some(t => t.toLowerCase().includes(q)));
    }

    const now = Date.now();
    const ageDays = (v: RdItem) => Math.max(0, (now - (v.mtime || 0)) / 86400000);
    const sorted = [...list];
    if (curSort === 'new') sorted.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    else if (curSort === 'top') sorted.sort((a, b) => scoreOf(b) - scoreOf(a));
    else if (curSort === 'best') sorted.sort((a, b) => ((b.rating || 0) - (a.rating || 0)) || ((b.mtime || 0) - (a.mtime || 0)));
    else if (curSort === 'rising') sorted.sort((a, b) =>
      ((b.rating || 0) * 4 - Math.min(30, ageDays(b))) - ((a.rating || 0) * 4 - Math.min(30, ageDays(a))));
    else /* hot */ sorted.sort((a, b) =>
      ((b.rating || 0) * 9 + (hashId(b.id) % 23) - Math.min(60, ageDays(b)) * 0.4) -
      ((a.rating || 0) * 9 + (hashId(a.id) % 23) - Math.min(60, ageDays(a)) * 0.4));
    return sorted;
  }, [curSub, curSort, searchQ, vids, vaultItems, photos, books, hiddenTerms, joined, scoreOf]);

  // Reset paging when the feed changes; keep scroll at top.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [curSub, curSort, searchQ]);

  const onMainScroll = () => {
    const el = mainRef.current;
    if (!el || detail) return;
    if (el.scrollHeight - el.clientHeight - el.scrollTop < 900 && visibleCount < feedItems.length) {
      setVisibleCount(c => Math.min(c + PAGE_SIZE, feedItems.length));
    }
  };

  // ── actions ──
  const castVote = async (item: RdItem, dir: 1 | -1) => {
    const prev = votes[item.id] || 0;
    const next = prev === dir ? 0 : dir;
    const newVotes = { ...votes, [item.id]: next };
    setVotes(newVotes);
    localStorage.setItem('rd_votes', JSON.stringify(newVotes));

    if (item.kind === 'video') {
      const stars = Math.max(0, Math.min(5, (item.rating || 0) + (next - prev)));
      try {
        if (stars === 0) await fetch(`/api/ratings/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
        else await fetch(`/api/ratings/${encodeURIComponent(item.id)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stars })
        });
        const patch = (v: RdItem) => v.id === item.id ? { ...v, rating: stars || undefined } : v;
        setVids(vs => vs.map(patch));
        setDetail(d => d && d.id === item.id ? { ...d, rating: stars || undefined } : d);
      } catch {}
    }
  };

  const toggleSave = async (item: RdItem) => {
    try {
      if (item.kind === 'video') {
        const d = await (await fetch(`/api/favourites/${encodeURIComponent(item.id)}`, { method: 'POST' })).json();
        setVids(vs => vs.map(v => v.id === item.id ? { ...v, fav: !!d.fav } : v));
        setDetail(dd => dd && dd.id === item.id ? { ...dd, fav: !!d.fav } : dd);
        toast(d.fav ? 'Post saved' : 'Post unsaved');
      } else if (item.kind === 'vault') {
        await fetch(`/api/vault/favs/${item.id}`, { method: 'POST' });
        setVaultFavs(prev => {
          const nx = new Set(prev);
          if (nx.has(item.id)) { nx.delete(item.id); toast('Post unsaved'); } else { nx.add(item.id); toast('Post saved'); }
          return nx;
        });
      }
    } catch {}
  };

  const sharePost = async (item: RdItem) => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/video/${item.id}`);
      toast('Link copied to clipboard');
    } catch { toast('Could not copy link'); }
  };

  const toggleJoin = (sub: string) => {
    setJoined(prev => {
      const nx = new Set(prev);
      if (nx.has(sub)) nx.delete(sub); else nx.add(sub);
      localStorage.setItem('reddit_subs', JSON.stringify([...nx]));
      return nx;
    });
  };

  const openDetail = (item: RdItem) => {
    setDetail(item);
    if (mainRef.current) mainRef.current.scrollTop = 0;
    if (item.kind === 'video') fetch(`/api/history/${encodeURIComponent(item.id)}`, { method: 'POST' }).catch(() => {});
  };

  const goToSub = (sub: string) => {
    setDetail(null);
    setCurSub(sub);
  };

  const isSaved = (item: RdItem) =>
    item.kind === 'vault' ? vaultFavs.has(item.id) : !!item.fav;

  const setMode = (m: 'card' | 'compact') => {
    setViewMode(m);
    localStorage.setItem('rd_viewmode', m);
  };

  // ── sub-info for right sidebar ──
  const subInfo = useMemo(() => {
    if (curSub.startsWith('cat:')) {
      const cat = curSub.slice(4);
      const items = vids.filter(v => (v.category || 'Uncategorized') === cat);
      return {
        name: cat,
        desc: `Everything filed under ${cat} in your archive.`,
        count: items.length,
        duration: items.reduce((a, v) => a + (v.duration || 0), 0)
      };
    }
    const names: Record<string, [string, string]> = {
      home: ['Home', 'Your personal frontpage, built from the communities you joined.'],
      popular: ['popular', 'The best-rated videos across the whole archive.'],
      all: ['all', 'Every video, photo, book and vault file in one feed.'],
      __photos__: ['photos', 'Your photo library as a feed.'],
      __books__: ['books', 'Your book collection as a feed.'],
      __vault__: ['vault', 'Encrypted vault files. Unlock the vault to see them.']
    };
    const [name, desc] = names[curSub] || [curSub, ''];
    return { name, desc, count: feedItems.length, duration: feedItems.reduce((a, v) => a + (v.duration || 0), 0) };
  }, [curSub, vids, feedItems]);

  const topCommunities = communities.slice(0, 5);
  const filteredCommunities = commFilter
    ? communities.filter(c => c.name.toLowerCase().includes(commFilter.toLowerCase()))
    : communities;

  const suggested = useMemo(() => {
    if (!detail) return [];
    return vids
      .filter(v => v.id !== detail.id && (v.category || 'Uncategorized') === (detail.category || 'Uncategorized'))
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, 8);
  }, [detail, vids]);

  return (
    <div className="reddit-view">
      <header className="rd-header">
        <div className="rd-logo" onClick={() => { setDetail(null); goToSub('home'); }}>
          <svg width="30" height="30" viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="16" fill="#ff4500" />
            <ellipse cx="16" cy="20" rx="9" ry="5.5" fill="#fff" />
            <circle cx="12.5" cy="19.5" r="1.5" fill="#ff4500" />
            <circle cx="19.5" cy="19.5" r="1.5" fill="#ff4500" />
            <path d="M13.5 22.5 Q16 24 18.5 22.5" stroke="#ff4500" stroke-width="1.2" stroke-linecap="round" fill="none" />
            <circle cx="22" cy="10.5" r="2.5" fill="#fff" />
            <path d="M16 7 Q19 5 22 8" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round" />
            <circle cx="22" cy="7.5" r="1" fill="#ffd635" />
          </svg>
          <span>aphroarchive</span>
        </div>

        <div className="rd-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input
            type="text"
            value={searchQ}
            onInput={(e: any) => setSearchQ(e.target.value)}
            placeholder={curSub.startsWith('cat:') ? `Search in r/${curSub.slice(4)}` : 'Search AphroArchive'}
          />
        </div>

        <button className="rd-hdr-btn solid" onClick={() => currentView.value = 'hub'}>Back to Archive</button>
      </header>

      <div className="rd-layout">
        {/* ── left: feeds + communities ── */}
        <aside className="rd-left">
          <div className="rd-left-section">
            <div className="rd-left-title">Feeds</div>
            {[
              ['home', 'Home', 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
              ['popular', 'Popular', 'M23 6l-9.5 9.5-5-5L1 18'],
              ['all', 'All', 'M4 6h16M4 12h16M4 18h16']
            ].map(([key, label, d]) => (
              <div key={key} className={`rd-left-item ${curSub === key ? 'active' : ''}`} onClick={() => goToSub(key)}>
                <Icon d={d} size={18} />
                <span className="rd-comm-name">{label}</span>
              </div>
            ))}
          </div>

          <div className="rd-left-section">
            <div className="rd-left-title">Media</div>
            {[
              ['__photos__', 'r/photos'],
              ['__books__', 'r/books'],
              ['__vault__', 'r/vault']
            ].map(([key, label]) => (
              <div key={key} className={`rd-left-item ${curSub === key ? 'active' : ''}`} onClick={() => goToSub(key)}>
                <span className="rd-comm-icon" style={{ background: subColor(label) }}>{label.charAt(2).toUpperCase()}</span>
                <span className="rd-comm-name">{label}</span>
              </div>
            ))}
          </div>

          <div className="rd-left-section">
            <div className="rd-left-title">Communities</div>
            <div className="rd-comm-filter">
              <input
                type="text"
                value={commFilter}
                onInput={(e: any) => setCommFilter(e.target.value)}
                placeholder="Filter communities"
              />
            </div>
            {filteredCommunities.map(c => {
              const key = `cat:${c.name}`;
              return (
                <div key={key} className={`rd-left-item ${curSub === key ? 'active' : ''}`} onClick={() => goToSub(key)}>
                  <span className="rd-comm-icon" style={{ background: subColor(c.name) }}>{c.name.charAt(0).toUpperCase()}</span>
                  <span className="rd-comm-name">r/{c.name}</span>
                  <span className="rd-comm-count">{c.count}</span>
                  <button
                    className={`rd-join-star ${joined.has(key) ? 'joined' : ''}`}
                    title={joined.has(key) ? 'Leave' : 'Join'}
                    onClick={(e) => { e.stopPropagation(); toggleJoin(key); }}
                  >★</button>
                </div>
              );
            })}
          </div>
        </aside>

        {/* ── center: feed / detail ── */}
        <main className="rd-main" ref={mainRef as any} onScroll={onMainScroll}>
          {detail ? (
            <DetailPage
              item={detail}
              vote={votes[detail.id] || 0}
              score={scoreOf(detail)}
              saved={isSaved(detail)}
              suggested={suggested}
              votesMap={votes}
              scoreOf={scoreOf}
              onBack={() => setDetail(null)}
              onVote={castVote}
              onSave={toggleSave}
              onShare={sharePost}
              onOpenSub={goToSub}
              onOpen={openDetail}
              onNoteSaved={(id: string, note: string) => {
                setVids(vs => vs.map(v => v.id === id ? { ...v, note } : v));
                setDetail(d => d && d.id === id ? { ...d, note } : d);
              }}
            />
          ) : (
            <>
              <div className="rd-sortbar">
                {[
                  ['best', 'Best', 'M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4-6.2-4.6-6.2 4.6 2.4-7.4L2 9.4h7.6z'],
                  ['hot', 'Hot', 'M12 2c1 4-4 5-4 10a4 4 0 0 0 8 0c0-2-1-3-1-3s3 1 3 5a6 6 0 0 1-12 0c0-7 6-8 6-12z'],
                  ['new', 'New', 'M12 6v6l4 2M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20z'],
                  ['top', 'Top', 'M12 19V5M5 12l7-7 7 7'],
                  ['rising', 'Rising', 'M23 6l-9.5 9.5-5-5L1 18M17 6h6v6']
                ].map(([key, label, d]) => (
                  <button key={key} className={`rd-sort-btn ${curSort === key ? 'active' : ''}`} onClick={() => setCurSort(key)}>
                    <Icon d={d} size={18} />{label}
                  </button>
                ))}
                <div className="rd-sortbar-spacer" />
                <button className={`rd-viewmode-btn ${viewMode === 'card' ? 'active' : ''}`} title="Card view" onClick={() => setMode('card')}>
                  <Icon d="M3 5h18v6H3zM3 13h18v6H3z" size={18} />
                </button>
                <button className={`rd-viewmode-btn ${viewMode === 'compact' ? 'active' : ''}`} title="Compact view" onClick={() => setMode('compact')}>
                  <Icon d="M3 5h18M3 9h18M3 13h18M3 17h18" size={18} />
                </button>
              </div>

              {loading ? (
                <div className="rd-spinner" />
              ) : feedItems.length === 0 ? (
                <div className="rd-empty">
                  <div style={{ fontSize: '28px', marginBottom: '8px' }}>¯\_(ツ)_/¯</div>
                  {curSub === '__vault__' ? 'The vault is locked or empty. Unlock it from the Vault view first.' : 'There are no posts here.'}
                </div>
              ) : (
                <>
                  {feedItems.slice(0, visibleCount).map(item => (
                    <PostCard
                      key={item.id}
                      item={item}
                      compact={viewMode === 'compact'}
                      vote={votes[item.id] || 0}
                      score={scoreOf(item)}
                      saved={isSaved(item)}
                      onVote={castVote}
                      onSave={toggleSave}
                      onShare={sharePost}
                      onOpen={openDetail}
                      onOpenSub={goToSub}
                    />
                  ))}
                  {visibleCount < feedItems.length
                    ? <div className="rd-spinner" />
                    : <div className="rd-feed-end">You've reached the end of the feed — {feedItems.length} post{feedItems.length === 1 ? '' : 's'}</div>}
                </>
              )}
            </>
          )}
        </main>

        {/* ── right: about + top communities ── */}
        <aside className="rd-right">
          <div className="rd-sb-card">
            <div className="rd-sb-banner" style={curSub.startsWith('cat:') ? { background: subColor(curSub.slice(4)) } : undefined} />
            <div className="rd-sb-body">
              <div className="rd-sb-title">
                <span className="rd-comm-icon" style={{ background: subColor(subInfo.name), width: '34px', height: '34px', fontSize: '16px' }}>
                  {subInfo.name.charAt(0).toUpperCase()}
                </span>
                r/{subInfo.name}
              </div>
              <div className="rd-sb-desc">{subInfo.desc}</div>
              <div className="rd-sb-stats">
                <div className="rd-sb-stat"><strong>{subInfo.count}</strong>Posts</div>
                {subInfo.duration > 0 && <div className="rd-sb-stat"><strong>{Math.round(subInfo.duration / 3600)}h</strong>Watch time</div>}
              </div>
              {curSub.startsWith('cat:') && (
                <button className="rd-sb-btn" onClick={() => toggleJoin(curSub)}>
                  {joined.has(curSub) ? 'Joined' : 'Join'}
                </button>
              )}
              <button className="rd-sb-btn outline" onClick={() => { setCurSort('new'); setDetail(null); }}>
                Latest Posts
              </button>
            </div>
          </div>

          <div className="rd-sb-card">
            <div className="rd-sb-body" style={{ paddingBottom: '4px' }}>
              <div className="rd-left-title" style={{ padding: '0 0 8px' }}>Top Communities</div>
            </div>
            {topCommunities.map((c, i) => (
              <div key={c.name} className="rd-top-comm-row" onClick={() => goToSub(`cat:${c.name}`)}>
                <span className="rd-top-comm-rank">{i + 1}</span>
                <span className="rd-comm-icon" style={{ background: subColor(c.name) }}>{c.name.charAt(0).toUpperCase()}</span>
                <span className="rd-top-comm-name">r/{c.name}</span>
                <span className="rd-comm-count">{c.count}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
};

// ─── post card ───────────────────────────────────────────────────────

const PostCard = ({ item, compact, vote, score, saved, onVote, onSave, onShare, onOpen, onOpenSub }: any) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const hoverTimer = useRef<any>(null);
  const canStream = item.kind === 'video';
  const thumb = thumbSrc(item);
  const author = item.channel || 'archive';

  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen]);

  const startPreview = () => {
    if (!canStream) return;
    hoverTimer.current = setTimeout(() => setPreview(true), 350);
  };
  const stopPreview = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setPreview(false);
  };

  const meta = (
    <div className="rd-post-meta">
      <span
        className="rd-sub-link"
        onClick={(e: any) => { e.stopPropagation(); onOpenSub(item.kind === 'video' ? `cat:${item.category || 'Uncategorized'}` : `__${item.category}__`); }}
      >
        r/{item.category || 'Uncategorized'}
      </span>
      <span>•</span>
      <span>Posted by u/{author}</span>
      <span>{timeAgo(item.mtime)}</span>
    </div>
  );

  if (compact) {
    return (
      <div className="rd-post compact" onClick={() => onOpen(item)}>
        <VoteRail item={item} vote={vote} score={score} onVote={onVote} />
        <div className="rd-post-body">
          {thumb
            ? <img className="rd-compact-thumb" src={thumb} loading="lazy" alt="" />
            : <div className="rd-compact-thumb-ph">{item.kind === 'book' ? '📚' : '🔒'}</div>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="rd-post-title">{item.name}</div>
            {meta}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rd-post" onClick={() => onOpen(item)}>
      <VoteRail item={item} vote={vote} score={score} onVote={onVote} />
      <div className="rd-post-body">
        {meta}
        <div className="rd-post-title">{item.name}</div>

        {(item.tags?.length || item.kind === 'vault') ? (
          <div className="rd-flairs">
            {item.kind === 'vault' && <span className="rd-flair nsfw">VAULT</span>}
            {(item.tags || []).slice(0, 5).map((t: string) => (
              <span key={t} className="rd-flair" onClick={(e: any) => e.stopPropagation()}>{t}</span>
            ))}
          </div>
        ) : null}

        <div className="rd-post-media" onMouseEnter={startPreview} onMouseLeave={stopPreview}>
          {preview && canStream ? (
            <video src={streamSrc(item)} autoPlay muted loop playsInline preload="metadata" poster={thumb} />
          ) : thumb ? (
            <img src={thumb} loading="lazy" alt="" />
          ) : (
            <div className="rd-media-placeholder">
              <span style={{ fontSize: '32px' }}>{item.kind === 'book' ? '📚' : '🔒'}</span>
              <span>{item.kind === 'book' ? 'Book' : 'Encrypted vault file'}</span>
            </div>
          )}
          {item.duration > 0 && <span className="rd-media-duration">{fmtDuration(item.duration)}</span>}
        </div>

        <div className="rd-post-actions" onClick={(e: any) => e.stopPropagation()}>
          <button className="rd-act-btn" onClick={() => onOpen(item)}>
            <Icon d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" size={16} />
            {(item.actors?.length || 0) + (item.note ? 1 : 0)} Comments
          </button>
          <button className="rd-act-btn" onClick={() => onShare(item)}>
            <Icon d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" size={16} />
            Share
          </button>
          <button className={`rd-act-btn ${saved ? 'saved' : ''}`} onClick={() => onSave(item)}>
            <Icon d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" size={16} />
            {saved ? 'Saved' : 'Save'}
          </button>
          {item.kind === 'video' && (
            <div className="rd-menu-wrap">
              <button className="rd-act-btn" onClick={() => setMenuOpen(o => !o)}>•••</button>
              {menuOpen && <PostMenu item={item} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const VoteRail = ({ item, vote, score, onVote }: any) => (
  <div className="rd-vote-col" onClick={(e: any) => e.stopPropagation()}>
    <button className={`rd-vote-btn up ${vote === 1 ? 'voted' : ''}`} title="Upvote" onClick={() => onVote(item, 1)}><UpArrow /></button>
    <span className={`rd-score ${vote === 1 ? 'up' : vote === -1 ? 'down' : ''}`}>{fmtScore(score)}</span>
    <button className={`rd-vote-btn down ${vote === -1 ? 'voted' : ''}`} title="Downvote" onClick={() => onVote(item, -1)}><DownArrow /></button>
  </div>
);

const PostMenu = ({ item }: any) => {
  const w = window as any;
  const entries: [string, string, () => void][] = [
    ['Add tags', 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z', () => { tagModalState.value = { visible: true, vidId: item.id, linkUrl: null }; }],
    ['Edit actors', 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8z', () => { actorModalState.value = { visible: true, vidId: item.id }; }],
    ['Add to collection', 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', () => { currentVideo.value = item; showAddToCollectionModal.value = true; }],
    ['Rename', 'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z', () => { if (w.openRen) w.openRen(item.id, item.name); }],
    ['Move to community', 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z', () => { if (w.openMov) w.openMov(item.id, item.name, item.catPath || ''); }]
  ];
  return (
    <div className="rd-menu">
      {entries.map(([label, d, fn]) => (
        <div key={label} className="rd-menu-item" onClick={fn}>
          <Icon d={d} size={16} />{label}
        </div>
      ))}
    </div>
  );
};

// ─── detail (post page) ──────────────────────────────────────────────

const DetailPage = ({ item, vote, score, saved, suggested, votesMap, scoreOf, onBack, onVote, onSave, onShare, onOpenSub, onOpen, onNoteSaved }: any) => {
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);
  const thumb = thumbSrc(item);
  const stream = streamSrc(item);
  const author = item.channel || 'archive';

  const postComment = async () => {
    const text = comment.trim();
    if (!text || item.kind !== 'video' || posting) return;
    setPosting(true);
    try {
      const note = item.note ? `${item.note}\n${text}` : text;
      const r = await fetch(`/api/videos/${encodeURIComponent(item.id)}/meta`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note })
      });
      if (r.ok) {
        onNoteSaved(item.id, note);
        setComment('');
        toast('Comment saved to video notes');
      }
    } catch {}
    setPosting(false);
  };

  const noteLines = (item.note || '').split('\n').filter((l: string) => l.trim());

  return (
    <div>
      <button className="rd-back-btn" onClick={onBack}>
        <Icon d="M19 12H5M12 19l-7-7 7-7" size={16} />
        Back to feed
      </button>

      <div className="rd-post rd-detail-post">
        <VoteRail item={item} vote={vote} score={score} onVote={onVote} />
        <div className="rd-post-body">
          <div className="rd-post-meta">
            <span className="rd-sub-link" onClick={() => onOpenSub(item.kind === 'video' ? `cat:${item.category || 'Uncategorized'}` : `__${item.category}__`)}>
              r/{item.category || 'Uncategorized'}
            </span>
            <span>•</span>
            <span>Posted by u/{author}</span>
            <span>{timeAgo(item.mtime)}</span>
          </div>
          <div className="rd-post-title">{item.name}</div>

          {(item.tags?.length || item.kind === 'vault') ? (
            <div className="rd-flairs">
              {item.kind === 'vault' && <span className="rd-flair nsfw">VAULT</span>}
              {(item.tags || []).map((t: string) => <span key={t} className="rd-flair">{t}</span>)}
            </div>
          ) : null}

          <div className="rd-detail-media">
            {item.kind === 'photo' || (item.kind === 'vault' && IMG_EXTS.includes((item.ext || '').toLowerCase())) ? (
              <img src={item.kind === 'photo' ? `/api/photos/${item.id}/img` : stream} alt="" />
            ) : item.kind === 'book' ? (
              <div className="rd-media-placeholder"><span style={{ fontSize: '48px' }}>📚</span><span>{item.name}</span></div>
            ) : (
              <video src={stream} controls autoPlay playsInline poster={thumb} muted={isMuted.value} />
            )}
          </div>

          <div className="rd-detail-info">
            {item.duration > 0 && <span>⏱ {fmtDuration(item.duration)}</span>}
            {item.size > 0 && <span>💾 {item.size < 1073741824 ? `${(item.size / 1048576).toFixed(1)} MB` : `${(item.size / 1073741824).toFixed(2)} GB`}</span>}
            {item.rating > 0 && <span>{'★'.repeat(item.rating)}{'☆'.repeat(5 - item.rating)}</span>}
          </div>

          <div className="rd-post-actions">
            <button className="rd-act-btn" onClick={() => onShare(item)}>
              <Icon d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" size={16} />
              Share
            </button>
            <button className={`rd-act-btn ${saved ? 'saved' : ''}`} onClick={() => onSave(item)}>
              <Icon d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" size={16} />
              {saved ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      <div className="rd-comments-box">
        <div className="rd-comments-title">
          {noteLines.length + (item.actors?.length || 0)} Comments
        </div>

        {item.kind === 'video' && (
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
            <input
              type="text"
              value={comment}
              onInput={(e: any) => setComment(e.target.value)}
              onKeyDown={(e: any) => { if (e.key === 'Enter') postComment(); }}
              placeholder="Add a comment (saved to the video's notes)"
              style={{ flex: 1, background: '#272729', border: '1px solid #343536', borderRadius: '4px', padding: '10px 12px', color: '#d7dadc', fontSize: '14px', outline: 'none' }}
            />
            <button className="rd-hdr-btn solid" disabled={posting} onClick={postComment}>Comment</button>
          </div>
        )}

        {noteLines.map((line: string, i: number) => (
          <div key={`note-${i}`} className="rd-comment">
            <span className="rd-comment-avatar" style={{ background: '#0079d3' }}>Y</span>
            <div className="rd-comment-body">
              <div className="rd-comment-author">u/you</div>
              <div className="rd-comment-text">{line}</div>
            </div>
          </div>
        ))}
        {(item.actors || []).map((a: string) => (
          <div key={a} className="rd-comment">
            <span className="rd-comment-avatar" style={{ background: subColor(a) }}>{a.charAt(0).toUpperCase()}</span>
            <div className="rd-comment-body">
              <div className="rd-comment-author">u/{a.replace(/\s+/g, '_')}</div>
              <div className="rd-comment-text">Appears in this video.</div>
            </div>
          </div>
        ))}
        {!noteLines.length && !(item.actors?.length) && (
          <div style={{ color: '#818384', fontSize: '13px' }}>No comments yet. Be the first to share what you think!</div>
        )}
      </div>

      {suggested.length > 0 && (
        <>
          <div className="rd-more-title">More from r/{item.category || 'Uncategorized'}</div>
          {suggested.map((s: RdItem) => (
            <PostCard
              key={s.id}
              item={s}
              compact
              vote={votesMap[s.id] || 0}
              score={scoreOf(s)}
              saved={!!s.fav}
              onVote={onVote}
              onSave={onSave}
              onShare={onShare}
              onOpen={onOpen}
              onOpenSub={onOpenSub}
            />
          ))}
        </>
      )}
    </div>
  );
};
