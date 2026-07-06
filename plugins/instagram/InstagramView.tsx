import { useState, useEffect, useRef, useMemo, useCallback } from 'preact/hooks';
import { allVideos, currentVideo, currentView, isMuted } from '../../public/src/store';
import { Video } from '../../public/src/types';
import './InstagramView.css';

// ─── helpers ─────────────────────────────────────────────────────────

const COLORS = ['#e84040', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#a855f7'];

const hashId = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const strColor = (s: string) => COLORS[hashId(s) % COLORS.length];
const initial = (s: string) => (s || '?').charAt(0).toUpperCase();

const timeAgo = (mtime: number) => {
  const m = Math.floor((Date.now() - (mtime || 0)) / 60000);
  if (mtime <= 0 || m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
};

const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

const formatBytes = (b?: number) => {
  if (!b) return '';
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
};

const readJson = (key: string, fallback: any) => {
  try { return JSON.parse(localStorage.getItem(key) || '') ?? fallback; } catch { return fallback; }
};

const IMG_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp'];
const PAGE_SIZE = 8;

interface VaultFile {
  id: string;
  name?: string;
  originalName?: string;
  folder?: string;
  type: string;
  ext?: string;
  mtime?: number;
  size?: number;
}

interface IgItem extends Partial<Video>, Partial<VaultFile> {
  _vault: boolean;
  id: string;
}

const isImgItem = (item: IgItem) => item._vault && IMG_EXTS.includes((item.ext || '').toLowerCase());
const thumbOf = (item: IgItem) => isImgItem(item) ? `/api/vault/stream/${item.id}` : (!item._vault ? `/api/thumbs/${item.id}/0` : '');
const streamOf = (item: IgItem) => item._vault ? `/api/vault/stream/${item.id}` : `/api/stream/${item.id}`;
const likeCountOf = (item: IgItem, liked: boolean) => (hashId(item.id) % 887) + 41 + ((item as any).rating || 0) * 350 + (liked ? 1 : 0);

// ─── icons ───────────────────────────────────────────────────────────

const HeartIcon = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
);
const CommentIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
);
const ShareIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
);
const SaveIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
);
const PlayGlyph = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
);

// ─── main view ───────────────────────────────────────────────────────

export const InstagramView = () => {
  const [vaultFiles, setVaultFiles] = useState<VaultFile[]>([]);
  const [vaultFolderMap, setVaultFolderMap] = useState<Record<string, string>>({});
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [vaultConfigured, setVaultConfigured] = useState(false);
  const [vaultOnly, setVaultOnly] = useState(false);
  const [hiddenTerms, setHiddenTerms] = useState<string[]>([]);

  const [curView, setCurView] = useState('feed');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [profileKey, setProfileKey] = useState<string | null>(null);
  const [activeStoryCategory, setActiveStoryCategory] = useState<string | null>(null);
  const [seenStories, setSeenStories] = useState<Set<string>>(() => new Set(readJson('ig_seen_stories', [])));

  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set(readJson('ig_saved', [])));
  const [savedOnly, setSavedOnly] = useState(false);

  const [curSort, setCurSort] = useState('date');
  const [isShuffled, setIsShuffled] = useState(true);
  const [shufSeed, setShufSeed] = useState(() => hashId(String(performance.now())));
  const [autoplayEnabled, setAutoplayEnabled] = useState(true);

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [curModal, setCurModal] = useState<{ id: string; isVault: boolean } | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);

  // ── init ──
  useEffect(() => {
    (async () => {
      try {
        const s = await (await fetch('/api/vault/status')).json();
        setVaultUnlocked(!!s.unlocked);
        setVaultConfigured(!!s.configured);
        if (s.unlocked) {
          await loadVaultFiles();
          // Vault favs are only readable while unlocked — asking earlier just 401s.
          const ids = await (await fetch('/api/vault/favs')).json();
          if (Array.isArray(ids)) setLikedIds(prev => new Set([...prev, ...ids]));
        }
      } catch {}
      try {
        const data = await (await fetch('/api/settings/lists')).json();
        if (Array.isArray(data.hidden)) setHiddenTerms(data.hidden);
      } catch {}
    })();

    const savedSort = localStorage.getItem('ig_sort');
    if (localStorage.getItem('ig_shuf') === '1' || !savedSort) setIsShuffled(true);
    else if (['date', 'duration', 'name', 'size'].includes(savedSort)) { setCurSort(savedSort); setIsShuffled(false); }
    if (localStorage.getItem('ig_autoplay') === '0') setAutoplayEnabled(false);
  }, []);

  // Favourited library videos start out liked.
  useEffect(() => {
    const favIds = allVideos.value.filter(v => v.fav).map(v => v.id);
    if (favIds.length) setLikedIds(prev => new Set([...prev, ...favIds]));
  }, [allVideos.value]);

  const loadVaultFiles = async () => {
    try {
      const items = await (await fetch('/api/vault/files')).json();
      if (Array.isArray(items)) {
        const map: Record<string, string> = {};
        items.filter((f: any) => f.type === 'folder').forEach((f: any) => { map[f.id] = f.name; });
        setVaultFolderMap(map);
        setVaultFiles(items.filter((f: any) => f.type !== 'folder'));
      }
    } catch {}
  };

  const vaultUser = useCallback((item: IgItem) =>
    (item.folder && vaultFolderMap[item.folder]) ? vaultFolderMap[item.folder] : 'Vault', [vaultFolderMap]);

  // ── feed pipeline ──
  const feedItems = useMemo(() => {
    const locals: IgItem[] = vaultOnly ? [] : allVideos.value.filter(v => !(v as any).isLink).map(v => ({ ...v, _vault: false, id: v.id }));
    const vault: IgItem[] = vaultFiles.map(f => ({ ...f, _vault: true, id: f.id }));
    let items = [...locals, ...vault];

    if (hiddenTerms.length) {
      items = items.filter(item => {
        const name = (item.name || item.originalName || '').toLowerCase();
        const cat = (item.category || '').toLowerCase();
        const tags = item.tags || [];
        return !hiddenTerms.some(term => {
          const t = term.toLowerCase();
          return name.includes(t) || cat === t || cat.startsWith(t + '/') || cat.startsWith(t + '\\') ||
            tags.some(tag => tag.toLowerCase() === t);
        });
      });
    }

    if (savedOnly) items = items.filter(i => savedIds.has(i.id));

    if (searchQ.trim()) {
      const q = searchQ.trim().toLowerCase();
      items = items.filter(i =>
        (i.name || i.originalName || '').toLowerCase().includes(q) ||
        (i.category || '').toLowerCase().includes(q) ||
        (i.tags || []).some(t => t.toLowerCase().includes(q)));
    }

    if (isShuffled) return items.sort((a, b) => hashId(a.id + shufSeed) - hashId(b.id + shufSeed));
    if (curSort === 'date') return items.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    if (curSort === 'duration') return items.sort((a, b) => (b.duration || 0) - (a.duration || 0));
    if (curSort === 'name') return items.sort((a, b) => (a.name || a.originalName || '').localeCompare(b.name || b.originalName || ''));
    if (curSort === 'size') return items.sort((a, b) => (b.size || 0) - (a.size || 0));
    return items;
  }, [allVideos.value, vaultFiles, vaultOnly, savedOnly, searchQ, curSort, isShuffled, shufSeed, hiddenTerms, savedIds]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [vaultOnly, savedOnly, searchQ, curSort, isShuffled, shufSeed]);

  const onContentScroll = () => {
    const el = contentRef.current;
    if (!el || curView !== 'feed') return;
    if (el.scrollHeight - el.clientHeight - el.scrollTop < 1200 && visibleCount < feedItems.length) {
      setVisibleCount(c => Math.min(c + PAGE_SIZE, feedItems.length));
    }
  };

  const visibleItems = feedItems.slice(0, visibleCount);
  const feedDone = visibleCount >= feedItems.length;

  // ── categories for stories / suggestions ──
  const categoryData = useMemo(() => {
    const map = new Map<string, { count: number; cover: string }>();
    for (const v of allVideos.value) {
      if ((v as any).isLink) continue;
      const c = v.category || 'Uncategorized';
      const cur = map.get(c);
      if (cur) cur.count++;
      else map.set(c, { count: 1, cover: `/api/thumbs/${v.id}/0` });
    }
    return [...map.entries()].map(([name, d]) => ({ name, ...d })).sort((a, b) => b.count - a.count);
  }, [allVideos.value]);

  const stories = categoryData.slice(0, 16);
  const suggestions = categoryData.slice(0, 5);

  // ── actions ──
  const toggleLike = async (id: string, isVault: boolean, forceOn = false) => {
    const already = likedIds.has(id);
    if (forceOn && already) return;
    setLikedIds(prev => {
      const next = new Set(prev);
      if (next.has(id) && !forceOn) next.delete(id); else next.add(id);
      return next;
    });
    try {
      await fetch(isVault ? `/api/vault/favs/${id}` : `/api/favourites/${encodeURIComponent(id)}`, { method: 'POST' });
    } catch {}
  };

  const toggleSave = (id: string) => {
    setSavedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem('ig_saved', JSON.stringify([...next]));
      return next;
    });
  };

  const sharePost = async (id: string) => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/video/${id}`);
      const w = window as any;
      if (w.toast) w.toast('Link copied to clipboard');
    } catch {}
  };

  const openModal = (id: string, isVault: boolean) => {
    setCurModal({ id, isVault });
    if (!isVault) {
      const item = allVideos.value.find(v => v.id === id);
      if (item) currentVideo.value = item as Video;
      fetch(`/api/history/${encodeURIComponent(id)}`, { method: 'POST' }).catch(() => {});
    }
  };

  const closeModal = () => {
    setCurModal(null);
    currentVideo.value = null;
  };

  const navModal = useCallback((dir: 1 | -1) => {
    setCurModal(m => {
      if (!m) return m;
      const idx = feedItems.findIndex(i => i.id === m.id);
      const nx = feedItems[idx + dir];
      return nx ? { id: nx.id, isVault: nx._vault } : m;
    });
  }, [feedItems]);

  // Keyboard navigation for the modal.
  useEffect(() => {
    if (!curModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
      else if (e.key === 'ArrowRight') navModal(1);
      else if (e.key === 'ArrowLeft') navModal(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [curModal, navModal]);

  const openStory = (cat: string) => {
    setActiveStoryCategory(cat);
    setSeenStories(prev => {
      const next = new Set(prev).add(cat);
      localStorage.setItem('ig_seen_stories', JSON.stringify([...next]));
      return next;
    });
  };

  const shuffleFeed = () => {
    setIsShuffled(true);
    setShufSeed(hashId(String(performance.now())));
    localStorage.setItem('ig_shuf', '1');
    localStorage.removeItem('ig_sort');
  };

  const setSort = (key: string) => {
    setCurSort(key);
    setIsShuffled(false);
    localStorage.setItem('ig_sort', key);
    localStorage.removeItem('ig_shuf');
  };

  const toggleAutoplay = () => {
    setAutoplayEnabled(a => {
      localStorage.setItem('ig_autoplay', a ? '0' : '1');
      return !a;
    });
  };

  const openProfile = (key: string) => { setProfileKey(key); setCurView('profile'); };

  // ── render ──
  return (
    <div className="ig-app">
      <nav className="ig-nav">
        <div className="ig-nav-logo">
          <svg viewBox="0 0 28 28" fill="none" width="28" height="28">
            <rect width="28" height="28" rx="6" fill="#e84040" />
            <polygon points="11,7 11,21 22,14" fill="#fff" />
          </svg>
          <span>AphroArchive</span>
        </div>
        <div className={`ig-nav-item ${curView === 'feed' && !searchOpen ? 'active' : ''}`} onClick={() => { setCurView('feed'); setSearchOpen(false); setSearchQ(''); }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
          <span>Home</span>
        </div>
        <div className={`ig-nav-item ${searchOpen ? 'active' : ''}`} onClick={() => { setCurView('feed'); setSearchOpen(o => !o); }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <span>Search</span>
        </div>
        <div className={`ig-nav-item ${curView === 'explore' ? 'active' : ''}`} onClick={() => { setCurView('explore'); setSearchOpen(false); }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" /><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" /></svg>
          <span>Explore</span>
        </div>
        <div className={`ig-nav-item ${savedOnly ? 'active' : ''}`} onClick={() => setSavedOnly(s => !s)}>
          <SaveIcon />
          <span>Saved</span>
        </div>
        <div className={`ig-nav-item ${vaultOnly ? 'vault-on' : ''}`} onClick={() => setVaultOnly(v => !v)}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
          <span>Vault Only</span>
        </div>
        <div className="ig-nav-spacer" />
        <div className="ig-nav-item" onClick={() => currentView.value = 'hub'}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
          <span>Back to Archive</span>
        </div>
      </nav>

      <div className="ig-content" ref={contentRef as any} onScroll={onContentScroll}>
        {curView === 'feed' && (
          <>
            <div className="ig-feed-col">
              {searchOpen && (
                <div className="ig-search-panel">
                  <input
                    type="text"
                    value={searchQ}
                    onInput={(e: any) => setSearchQ(e.target.value)}
                    placeholder="Search titles, categories and #tags"
                    autoFocus
                  />
                </div>
              )}

              <div className="ig-stories">
                {stories.map(s => (
                  <div className="ig-story" key={s.name} onClick={() => openStory(s.name)}>
                    <div className={`ig-story-ring ${seenStories.has(s.name) ? 'seen' : ''}`}>
                      <div className="ig-story-inner" style={{ background: strColor(s.name) }}>
                        {s.cover ? <img src={s.cover} loading="lazy" alt="" onError={(e: any) => { e.target.style.display = 'none'; }} /> : initial(s.name)}
                      </div>
                    </div>
                    <span className="ig-story-name">{s.name}</span>
                  </div>
                ))}
              </div>

              {vaultOnly && !vaultUnlocked ? (
                <VaultPrompt
                  configured={vaultConfigured}
                  onUnlocked={async () => {
                    setVaultUnlocked(true);
                    setVaultConfigured(true);
                    await loadVaultFiles();
                  }}
                />
              ) : (
                <>
                  {visibleItems.map(item => (
                    <PostCard
                      key={item.id}
                      item={item}
                      liked={likedIds.has(item.id)}
                      saved={savedIds.has(item.id)}
                      autoplay={autoplayEnabled}
                      onLike={() => toggleLike(item.id, item._vault)}
                      onDoubleLike={() => toggleLike(item.id, item._vault, true)}
                      onSave={() => toggleSave(item.id)}
                      onShare={() => sharePost(item.id)}
                      onOpen={() => openModal(item.id, item._vault)}
                      onOpenProfile={openProfile}
                      vaultUser={vaultUser}
                    />
                  ))}
                  {feedDone ? (
                    <div className="ig-caught-up">
                      <div className="ig-check-ring"><div>✓</div></div>
                      <span>You're all caught up</span>
                    </div>
                  ) : (
                    <div className="ig-loading"><div className="ig-spinner" /></div>
                  )}
                </>
              )}
            </div>

            <div className="ig-right">
              <div className="ig-account">
                <div className="ig-account-avatar" style={{ background: vaultOnly ? '#bc1888' : '#e84040' }}>
                  {vaultOnly ? 'V' : 'A'}
                </div>
                <div style={{ flex: 1 }}>
                  <div className="ig-account-name">{vaultOnly ? 'vault' : 'aphroarchive'}</div>
                  <div className="ig-account-sub">{vaultOnly ? 'Secure Storage' : 'Local Library'}</div>
                </div>
                {vaultConfigured && (
                  <button className="ig-sug-btn" onClick={() => setVaultOnly(v => !v)}>Switch</button>
                )}
              </div>

              <div className="ig-right-controls">
                <select className="ig-sort-select" title="Sort feed" value={isShuffled ? '' : curSort} onChange={(e: any) => setSort(e.target.value)}>
                  {isShuffled && <option value="">🔀 Shuffled</option>}
                  <option value="date">📅 Date</option>
                  <option value="duration">⏱ Duration</option>
                  <option value="name">🔤 Name</option>
                  <option value="size">📦 Size</option>
                </select>
                <button className="ig-tb-btn" onClick={shuffleFeed}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /></svg>
                  Shuffle
                </button>
                <button className={`ig-tb-btn ${autoplayEnabled ? 'active' : ''}`} onClick={toggleAutoplay}>
                  <PlayGlyph size={14} />
                  <span>Autoplay {autoplayEnabled ? 'On' : 'Off'}</span>
                </button>
              </div>

              <div className="ig-sug-header"><span>Suggested for you</span></div>
              <div className="ig-suggestions">
                {suggestions.map(s => (
                  <div className="ig-sug-item" key={s.name}>
                    <div className="ig-sug-avatar" style={{ background: strColor(s.name) }} onClick={() => openProfile(`cat:${s.name}`)}>
                      {initial(s.name)}
                    </div>
                    <div className="ig-sug-info">
                      <div className="ig-sug-name" onClick={() => openProfile(`cat:${s.name}`)}>{s.name}</div>
                      <div className="ig-sug-sub">{s.count} video{s.count !== 1 ? 's' : ''}</div>
                    </div>
                    <button className="ig-sug-btn" onClick={() => openProfile(`cat:${s.name}`)}>View</button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {curView === 'explore' && (
          <div className="ig-explore">
            <div className="ig-explore-grid">
              {feedItems.slice(0, 120).map((item, i) => (
                <ExploreTile
                  key={item.id}
                  item={item}
                  big={i % 10 === 2}
                  liked={likedIds.has(item.id)}
                  onOpen={() => openModal(item.id, item._vault)}
                />
              ))}
            </div>
          </div>
        )}

        {curView === 'profile' && profileKey && (
          <ProfileView
            profileKey={profileKey}
            vaultFiles={vaultFiles}
            vaultFolderMap={vaultFolderMap}
            likedIds={likedIds}
            onBack={() => setCurView('feed')}
            onOpen={openModal}
          />
        )}
      </div>

      {curModal && (
        <IgModal
          id={curModal.id}
          isVault={curModal.isVault}
          items={feedItems}
          fallbackItem={curModal.isVault
            ? vaultFiles.filter(f => f.id === curModal.id).map(f => ({ ...f, _vault: true, id: f.id }))[0]
            : allVideos.value.filter(v => v.id === curModal.id).map(v => ({ ...v, _vault: false, id: v.id }))[0]}
          vaultUser={vaultUser}
          liked={likedIds.has(curModal.id)}
          saved={savedIds.has(curModal.id)}
          onLike={() => toggleLike(curModal.id, curModal.isVault)}
          onSave={() => toggleSave(curModal.id)}
          onShare={() => sharePost(curModal.id)}
          onNav={navModal}
          onClose={closeModal}
          onOpenProfile={(key: string) => { closeModal(); openProfile(key); }}
        />
      )}

      {activeStoryCategory && (
        <StoryViewer
          category={activeStoryCategory}
          items={allVideos.value.filter(v => !(v as any).isLink && (v.category || 'Uncategorized') === activeStoryCategory)}
          onClose={() => setActiveStoryCategory(null)}
        />
      )}
    </div>
  );
};

// ─── vault unlock / setup ────────────────────────────────────────────

const VaultPrompt = ({ configured, onUnlocked }: any) => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  const submit = async () => {
    if (!password) return;
    if (!configured) {
      if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
      if (password !== confirm) { setError('Passwords do not match'); return; }
    }
    const r = await fetch(configured ? '/api/vault/unlock' : '/api/vault/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const d = await r.json();
    if (!r.ok) { setError(d.error || (configured ? 'Wrong password' : 'Setup failed')); return; }
    setError('');
    onUnlocked();
  };

  return (
    <div className="ig-vault-prompt">
      <h3>🔒 {configured ? 'Vault Locked' : 'Set Up Vault'}</h3>
      <p>{configured ? 'Enter your vault password to view encrypted content.' : 'Create a password to secure your encrypted content.'}</p>
      <input
        className="ig-vault-input"
        type="password"
        value={password}
        onInput={(e: any) => setPassword(e.target.value)}
        placeholder={configured ? 'Vault password' : 'New password (min 6 chars)'}
        onKeyDown={(e: any) => { if (e.key === 'Enter') submit(); }}
      />
      {!configured && (
        <input
          className="ig-vault-input"
          type="password"
          value={confirm}
          onInput={(e: any) => setConfirm(e.target.value)}
          placeholder="Confirm password"
          onKeyDown={(e: any) => { if (e.key === 'Enter') submit(); }}
        />
      )}
      <button className="ig-unlock-btn" onClick={submit}>{configured ? 'Unlock' : 'Create Vault'}</button>
      <div className="ig-vault-err">{error}</div>
    </div>
  );
};

// ─── post card ───────────────────────────────────────────────────────

const PostCard = ({ item, liked, saved, autoplay, onLike, onDoubleLike, onSave, onShare, onOpen, onOpenProfile, vaultUser }: any) => {
  const isVault = item._vault;
  const name = item.name || item.originalName || 'Untitled';
  const category = isVault ? vaultUser(item) : (item.category || 'Uncategorized');
  const color = strColor(category);
  const profKey = isVault ? `vault:${item.folder || '__root__'}` : `cat:${category}`;
  const isImg = isImgItem(item);
  const canPlay = !isImg;
  const thumb = thumbOf(item);

  const mediaRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [inView, setInView] = useState(false);
  const [everInView, setEverInView] = useState(false);
  const [muted, setMuted] = useState(true);
  const [heart, setHeart] = useState(0);
  const heartTimer = useRef<any>(null);

  // In-viewport autoplay, like the real feed: play when ≥60% visible, pause otherwise.
  useEffect(() => {
    if (!autoplay || !canPlay || !mediaRef.current) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        const on = e.intersectionRatio >= 0.6;
        setInView(on);
        if (on) setEverInView(true);
      },
      { threshold: [0, 0.6, 1] }
    );
    obs.observe(mediaRef.current);
    return () => obs.disconnect();
  }, [autoplay, canPlay]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (inView && autoplay) v.play().catch(() => {});
    else v.pause();
  }, [inView, autoplay, everInView]);

  useEffect(() => () => { if (heartTimer.current) clearTimeout(heartTimer.current); }, []);

  const burstLike = () => {
    onDoubleLike();
    setHeart(h => h + 1);
    if (heartTimer.current) clearTimeout(heartTimer.current);
    heartTimer.current = setTimeout(() => setHeart(0), 900);
  };

  return (
    <div className="ig-post">
      <div className="ig-post-header">
        <div className="ig-post-avatar" style={{ background: color }} onClick={() => onOpenProfile(profKey)}>{initial(category)}</div>
        <div className="ig-post-info">
          <div className="ig-post-username" onClick={() => onOpenProfile(profKey)}>{category}</div>
          <div className="ig-post-meta">{timeAgo(item.mtime || 0)}</div>
        </div>
        <button className="ig-post-menu" title="Share" onClick={onShare}>⋯</button>
      </div>

      <div className="ig-post-media" ref={mediaRef as any} onClick={onOpen} onDblClick={burstLike}>
        {isImg ? (
          <img src={thumb} alt="" loading="lazy" />
        ) : (
          <>
            {thumb ? <img src={thumb} alt="" loading="lazy" /> : (
              <div className="ig-placeholder">
                <PlayGlyph size={40} />
                <span style={{ fontSize: '12px', color: '#666' }}>{name}</span>
              </div>
            )}
            {autoplay && everInView && (
              <video
                ref={videoRef as any}
                src={streamOf(item)}
                muted={muted || isMuted.value}
                loop
                playsInline
                preload="metadata"
                poster={thumb || undefined}
              />
            )}
            {autoplay && everInView && (
              <button
                className="ig-mute-btn"
                title={muted ? 'Unmute' : 'Mute'}
                onClick={(e: any) => { e.stopPropagation(); setMuted(m => !m); }}
              >
                {muted ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M11 5L6 9H2v6h4l5 4V5z" /><line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" stroke-width="2" /><line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" stroke-width="2" /></svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" fill="none" stroke="currentColor" stroke-width="2" /></svg>
                )}
              </button>
            )}
          </>
        )}
        {isVault && <span className="ig-vault-tag">VAULT</span>}
        {item.duration > 0 && <span className="ig-duration-badge">{formatDuration(item.duration)}</span>}
        {heart > 0 && (
          <div className="ig-heart-burst">
            <svg width="96" height="96" viewBox="0 0 24 24" fill="#fff"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
          </div>
        )}
      </div>

      <div className="ig-post-actions">
        <button className={`ig-act-btn ${liked ? 'liked' : ''}`} title="Like" onClick={onLike}><HeartIcon /></button>
        <button className="ig-act-btn" title="Open" onClick={onOpen}><CommentIcon /></button>
        <button className="ig-act-btn" title="Share" onClick={onShare}><ShareIcon /></button>
        <div className="ig-spacer" />
        <button className={`ig-act-btn ${saved ? 'saved' : ''}`} title="Save" onClick={onSave}><SaveIcon /></button>
      </div>

      <div className="ig-post-likes">{likeCountOf(item, liked).toLocaleString()} likes</div>
      <div className="ig-post-caption"><strong>{category}</strong>{name}</div>
      {item.tags && item.tags.length > 0 && (
        <div className="ig-post-tags">{item.tags.map((t: string) => <span key={t}>#{t.replace(/\s+/g, '')}</span>)}</div>
      )}
      <div className="ig-post-time">{timeAgo(item.mtime || 0)} ago</div>
    </div>
  );
};

// ─── explore tile ────────────────────────────────────────────────────

const ExploreTile = ({ item, big, liked, onOpen }: any) => {
  const thumb = thumbOf(item);
  return (
    <div className={`ig-explore-item ${big ? 'big' : ''}`} onClick={onOpen}>
      {thumb ? <img src={thumb} alt="" loading="lazy" /> : (
        <div className="ig-explore-placeholder"><PlayGlyph size={32} /></div>
      )}
      <div className="ig-explore-overlay">
        <span className="ig-explore-stat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill={liked ? '#ff3040' : '#fff'}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
          {likeCountOf(item, liked).toLocaleString()}
        </span>
        {item.duration > 0 && <span className="ig-explore-stat"><PlayGlyph size={14} />{formatDuration(item.duration)}</span>}
      </div>
      {item._vault && <div className="ig-explore-vault" />}
    </div>
  );
};

// ─── profile view ────────────────────────────────────────────────────

const ProfileView = ({ profileKey, vaultFiles, vaultFolderMap, likedIds, onBack, onOpen }: any) => {
  const isVaultProfile = profileKey.startsWith('vault:');
  const id = profileKey.slice(profileKey.indexOf(':') + 1);
  const [tab, setTab] = useState<'posts' | 'liked'>('posts');

  let displayName: string;
  let items: IgItem[];
  if (isVaultProfile) {
    displayName = id === '__root__' ? 'Vault' : (vaultFolderMap[id] || 'Vault');
    items = vaultFiles.filter((f: any) => (f.folder || '__root__') === id).map((f: any) => ({ ...f, _vault: true, id: f.id }));
  } else {
    displayName = id;
    items = allVideos.value.filter(v => !(v as any).isLink && (v.category || 'Uncategorized') === id).map(v => ({ ...v, _vault: false, id: v.id }));
  }

  const likedItems = items.filter(i => likedIds.has(i.id));
  const shown = tab === 'liked' ? likedItems : items;
  const color = strColor(displayName);
  const totalDur = items.reduce((a: number, i: IgItem) => a + (i.duration || 0), 0);

  return (
    <div className="ig-profile">
      <button className="ig-profile-back" onClick={onBack}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
        Back
      </button>

      <div className="ig-profile-header">
        <div className="ig-profile-avatar" style={{ background: color }}>{initial(displayName)}</div>
        <div className="ig-profile-meta">
          <div className="ig-profile-name">{displayName}</div>
          <div className="ig-profile-stats">
            <div className="ig-profile-stat"><strong>{items.length}</strong>posts</div>
            <div className="ig-profile-stat"><strong>{likedItems.length}</strong>liked</div>
            {totalDur > 0 && <div className="ig-profile-stat"><strong>{Math.round(totalDur / 3600)}h</strong>watch time</div>}
          </div>
          <div className="ig-profile-bio">{isVaultProfile ? '🔒 Vault folder' : `Category · ${items.length} video${items.length !== 1 ? 's' : ''}`}</div>
        </div>
      </div>

      <div className="ig-profile-tabs">
        <div className={`ig-profile-tab ${tab === 'posts' ? 'active' : ''}`} onClick={() => setTab('posts')}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
          Posts
        </div>
        <div className={`ig-profile-tab ${tab === 'liked' ? 'active' : ''}`} onClick={() => setTab('liked')}>
          <HeartIcon size={12} />
          Liked
        </div>
      </div>

      <div className="ig-profile-grid">
        {shown.map((item: IgItem) => {
          const thumb = thumbOf(item);
          return (
            <div key={item.id} className="ig-profile-tile" onClick={() => onOpen(item.id, item._vault)}>
              {thumb ? <img src={thumb} loading="lazy" alt="" /> : (
                <div className="ig-profile-tile-ph"><PlayGlyph size={32} /></div>
              )}
              <div className="ig-profile-tile-overlay">
                <div className="ig-profile-tile-stat">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill={likedIds.has(item.id) ? '#ff3040' : '#fff'}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
                  {likeCountOf(item, likedIds.has(item.id)).toLocaleString()}
                </div>
                {!!item.duration && <div className="ig-profile-tile-stat"><PlayGlyph size={14} />{formatDuration(item.duration)}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── modal ───────────────────────────────────────────────────────────

const IgModal = ({ id, isVault, items, fallbackItem, vaultUser, liked, saved, onLike, onSave, onShare, onNav, onClose, onOpenProfile }: any) => {
  const item = items.find((i: IgItem) => i.id === id) || fallbackItem;
  if (!item) return null;

  const idx = items.findIndex((i: IgItem) => i.id === id);
  const name = item.name || item.originalName || 'Untitled';
  const category = isVault ? vaultUser(item) : (item.category || 'Uncategorized');
  const color = strColor(category);
  const isImg = isImgItem(item);
  const streamUrl = streamOf(item);
  const profKey = isVault ? `vault:${item.folder || '__root__'}` : `cat:${category}`;

  return (
    <div className="ig-modal" onClick={(e: any) => { if (e.target === e.currentTarget) onClose(); }}>
      <button className="ig-modal-close" onClick={onClose}>✕</button>
      {idx > 0 && (
        <button className="ig-modal-nav prev" title="Previous" onClick={() => onNav(-1)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
      )}
      {idx < items.length - 1 && (
        <button className="ig-modal-nav next" title="Next" onClick={() => onNav(1)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      )}
      <div className="ig-modal-inner">
        <div className="ig-modal-media">
          {isImg ? (
            <img src={streamUrl} alt={name} />
          ) : (
            <video key={id} src={streamUrl} controls autoPlay playsInline muted={isMuted.value} />
          )}
        </div>
        <div className="ig-modal-side">
          <div className="ig-modal-header">
            <div className="ig-post-avatar" style={{ background: color }} onClick={() => onOpenProfile(profKey)}>{initial(category)}</div>
            <div className="ig-modal-info">
              <div className="ig-modal-username">{category}</div>
              <div className="ig-modal-meta">{timeAgo(item.mtime || 0)}</div>
            </div>
          </div>
          <div className="ig-modal-body">
            <div className="ig-modal-title"><strong>{category}</strong>{name}</div>
            {item.duration > 0 && <div className="ig-modal-detail">Duration: {formatDuration(item.duration)}</div>}
            {item.size > 0 && <div className="ig-modal-detail">Size: {formatBytes(item.size)}</div>}
            {item.actors && item.actors.length > 0 && <div className="ig-modal-detail">With: {item.actors.join(', ')}</div>}
            {item.tags && item.tags.length > 0 && (
              <div className="ig-modal-detail" style={{ color: '#e0f1ff', marginTop: '8px' }}>
                {item.tags.map((t: string) => `#${t.replace(/\s+/g, '')}`).join(' ')}
              </div>
            )}
          </div>
          <div className="ig-modal-actions">
            <button className={`ig-act-btn ${liked ? 'liked' : ''}`} title="Like" onClick={onLike}><HeartIcon /></button>
            <button className="ig-act-btn" title="Share" onClick={onShare}><ShareIcon /></button>
            <div className="ig-spacer" />
            <button className={`ig-act-btn ${saved ? 'saved' : ''}`} title="Save" onClick={onSave}><SaveIcon /></button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── story viewer ────────────────────────────────────────────────────

const StoryViewer = ({ category, items, onClose }: any) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [duration, setDuration] = useState(8);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<any>(null);

  const currentItem = items[currentIndex];

  const handleNext = useCallback(() => {
    setCurrentIndex(i => {
      if (i < items.length - 1) return i + 1;
      onClose();
      return i;
    });
  }, [items.length, onClose]);

  const handlePrev = () => setCurrentIndex(i => Math.max(0, i - 1));

  useEffect(() => {
    if (!currentItem) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    const itemDuration = Math.min(currentItem.duration || 8, 30);
    setDuration(itemDuration);
    timerRef.current = setTimeout(handleNext, itemDuration * 1000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [currentIndex, currentItem, handleNext]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') handleNext();
      else if (e.key === 'ArrowLeft') handlePrev();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handleNext, onClose]);

  if (!currentItem) return null;

  const color = strColor(category);

  return (
    <div className="ig-story-viewer">
      <div className="ig-sv-stage">
        <div className="ig-sv-progress">
          {items.map((_: any, i: number) => (
            <div className="ig-sv-bar" key={`${i}-${currentIndex}`}>
              <div
                className={`ig-sv-bar-fill ${i < currentIndex ? 'done' : ''}`}
                style={i === currentIndex ? { animation: `svprogress ${duration}s linear forwards` } : undefined}
              />
            </div>
          ))}
        </div>

        <div className="ig-sv-header">
          <div className="ig-sv-user">
            <div className="ig-sv-avatar" style={{ background: color }}>{initial(category)}</div>
            <span className="ig-sv-name">{category}</span>
            <span style={{ fontSize: '13px', color: 'rgba(255,255,255,.7)' }}>{timeAgo(currentItem.mtime || 0)}</span>
          </div>
          <button className="ig-sv-close" onClick={onClose}>✕</button>
        </div>

        <div className="ig-sv-media">
          <video
            key={currentItem.id}
            ref={videoRef as any}
            src={`/api/stream/${currentItem.id}`}
            autoPlay
            muted={isMuted.value}
            playsInline
            poster={`/api/thumbs/${currentItem.id}/0`}
            onLoadedMetadata={(e: any) => {
              const dur = Math.min(e.target.duration || 8, 30);
              if (dur > 0) {
                setDuration(dur);
                if (timerRef.current) clearTimeout(timerRef.current);
                timerRef.current = setTimeout(handleNext, dur * 1000);
              }
            }}
            onEnded={handleNext}
          />
          <div className="ig-sv-zone prev" onClick={handlePrev} />
          <div className="ig-sv-zone next" onClick={handleNext} />
        </div>

        <div className="ig-sv-counter">{currentIndex + 1} / {items.length}</div>
      </div>
    </div>
  );
};
