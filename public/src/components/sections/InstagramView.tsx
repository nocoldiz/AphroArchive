import { useState, useEffect, useRef, useMemo } from 'preact/hooks';

const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};
import { allVideos, appPrefs, currentVideo, currentView, isMuted } from '../../store';
import { Video } from '../../types';
import { AiComments } from '../UI/AiComments';
import './InstagramView.css';

interface VaultFile {
  id: string;
  name?: string;
  originalName?: string;
  folder?: string;
  type: string;
  ext?: string;
  mtime?: number;
  size?: number;
  durationF?: string;
}

interface IgItem extends Partial<Video>, Partial<VaultFile> {
  _vault: boolean;
  id: string;
}

export const InstagramView = () => {
  const [vaultFiles, setVaultFiles] = useState<VaultFile[]>([]);
  const [vaultFolderMap, setVaultFolderMap] = useState<Record<string, string>>({});
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [vaultConfigured, setVaultConfigured] = useState(false);
  const [vaultOnly, setVaultOnly] = useState(false);
  const [feedPage, setFeedPage] = useState(0);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedDone, setFeedDone] = useState(false);
  const [curView, setCurView] = useState('feed');
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [curModal, setCurModal] = useState<{ id: string; isVault: boolean } | null>(null);
  const [curSort, setCurSort] = useState('date');
  const [isShuffled, setIsShuffled] = useState(false);
  const [shuffledOrder, setShuffledOrder] = useState<IgItem[]>([]);
  const [autoplayEnabled, setAutoplayEnabled] = useState(true);
  const [savedOnly, setSavedOnly] = useState(false);
  const [profileKey, setProfileKey] = useState<string | null>(null);
  const [activeStoryCategory, setActiveStoryCategory] = useState<string | null>(null);
  const [feedItems, setFeedItems] = useState<IgItem[]>([]);
  const [visibleItems, setVisibleItems] = useState<IgItem[]>([]);

  const feedObserver = useRef<IntersectionObserver | null>(null);
  const PAGE_SIZE = 10;

  const COLORS = ['#e84040', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#a855f7'];

  const strColor = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return COLORS[Math.abs(h) % COLORS.length];
  };

  const initial = (s: string) => (s || '?').charAt(0).toUpperCase();

  const timeAgo = (mtime: number) => {
    const d = Date.now() - mtime, m = Math.floor(d / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h';
    const days = Math.floor(h / 24);
    if (days < 7) return days + 'd';
    if (days < 30) return Math.floor(days / 7) + 'w';
    return Math.floor(days / 30) + 'mo';
  };

  const formatBytes = (b?: number) => {
    if (!b) return '';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
  };

  useEffect(() => {
    init();
    return () => {
      if (feedObserver.current) feedObserver.current.disconnect();
    };
  }, []);

  const init = async () => {
    await checkVaultStatus();
    await loadVaultFavs();
    restoreIgState();
  };

  const restoreIgState = () => {
    const savedSort = localStorage.getItem('ig_sort');
    const savedShuf = localStorage.getItem('ig_shuf');
    const savedAuto = localStorage.getItem('ig_autoplay');

    if (savedShuf === '1') {
      setIsShuffled(true);
    } else if (savedSort && ['date', 'duration', 'name', 'size'].includes(savedSort)) {
      setCurSort(savedSort);
      setIsShuffled(false);
    } else {
      setIsShuffled(true);
    }

    if (savedAuto === '0') {
      setAutoplayEnabled(false);
    }
  };

  const loadVaultFavs = async () => {
    try {
      const ids = await fetch('/api/vault/favs').then(r => r.json());
      if (Array.isArray(ids)) {
        setLikedIds(prev => {
          const next = new Set(prev);
          ids.forEach(id => next.add(id));
          return next;
        });
      }
    } catch { }
  };

  const checkVaultStatus = async () => {
    try {
      const s = await (await fetch('/api/vault/status')).json();
      setVaultUnlocked(!!s.unlocked);
      setVaultConfigured(!!s.configured);
      if (s.unlocked) await loadVaultFiles();
    } catch { }
  };

  const loadVaultFiles = async () => {
    try {
      const items = await (await fetch('/api/vault/files')).json();
      if (!items.error) {
        const folders = items.filter((f: any) => f.type === 'folder');
        const map: Record<string, string> = {};
        folders.forEach((f: any) => { map[f.id] = f.name; });
        setVaultFolderMap(map);
        setVaultFiles(items.filter((f: any) => f.type !== 'folder'));
      }
    } catch { }
  };

  const vaultUser = (item: IgItem) => {
    if (item.folder && vaultFolderMap[item.folder]) return vaultFolderMap[item.folder];
    return 'Vault';
  };

  const getRawItems = (): IgItem[] => {
    let items: IgItem[];
    if (vaultOnly) {
      items = vaultFiles.map(f => ({ ...f, _vault: true, id: f.id }));
    } else {
      const vids = allVideos.value.map(v => ({ ...v, _vault: false, id: v.id }));
      const vlt = vaultFiles.map(f => ({ ...f, _vault: true, id: f.id }));
      items = [...vids, ...vlt];
    }
    if (savedOnly) items = items.filter(i => savedIds.has(i.id));
    return items;
  };

  const getFeedItems = (): IgItem[] => {
    const items = getRawItems();
    if (isShuffled) {
      if (shuffledOrder.length === items.length) return shuffledOrder;
      const shuf = [...items].sort(() => Math.random() - .5);
      setShuffledOrder(shuf);
      return shuf;
    }

    if (curSort === 'date') return [...items].sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    if (curSort === 'duration') return [...items].sort((a, b) => (b.duration || 0) - (a.duration || 0));
    if (curSort === 'name') return [...items].sort((a, b) => (a.name || a.originalName || '').localeCompare(b.name || b.originalName || ''));
    if (curSort === 'size') return [...items].sort((a, b) => (b.size || 0) - (a.size || 0));
    return items;
  };

  const categories = useMemo(() => {
    const cats = [...new Set(allVideos.value.map(v => v.category || 'Uncategorized'))].filter(Boolean).slice(0, 14);
    return cats;
  }, [allVideos.value]);

  const suggestions = useMemo(() => {
    const cats = [...new Set(allVideos.value.map(v => v.category || 'Uncategorized'))].slice(0, 5);
    return cats;
  }, [allVideos.value]);

  useEffect(() => {
    const items = getFeedItems();
    setFeedItems(items);
    setFeedPage(0);
    setFeedDone(false);
    setVisibleItems(items.slice(0, PAGE_SIZE));
    setFeedPage(1);
  }, [allVideos.value, vaultFiles, vaultOnly, savedOnly, curSort, isShuffled]);

  const loadMore = () => {
    if (feedLoading || feedDone) return;
    setFeedLoading(true);
    const start = feedPage * PAGE_SIZE;
    const slice = feedItems.slice(start, start + PAGE_SIZE);

    if (!slice.length) {
      setFeedDone(true);
      setFeedLoading(false);
      return;
    }

    setVisibleItems(prev => [...prev, ...slice]);
    setFeedPage(prev => prev + 1);
    setFeedLoading(false);
    if (start + PAGE_SIZE >= feedItems.length) {
      setFeedDone(true);
    }
  };

  useEffect(() => {
    const handleScroll = () => {
      if (curView !== 'feed' || feedDone || feedLoading) return;
      if (document.documentElement.scrollHeight - window.innerHeight - window.scrollY < 600) {
        loadMore();
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [curView, feedDone, feedLoading, feedItems, feedPage]);

  const toggleLike = async (id: string, isVault: boolean) => {
    setLikedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

    try {
      const endpoint = isVault ? `/api/vault/favs/${id}` : `/api/favourites/${id}`;
      await fetch(endpoint, { method: 'POST' });
    } catch { }
  };

  const toggleSave = (id: string) => {
    setSavedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const openModal = (id: string, isVault: boolean) => {
    setCurModal({ id, isVault });
    const item = isVault ? vaultFiles.find(f => f.id === id) : allVideos.value.find(v => v.id === id);
    if (item && !isVault) {
      currentVideo.value = item as Video;
    }
  };

  const closeModal = () => {
    setCurModal(null);
    currentVideo.value = null;
  };

  const shuffleFeed = () => {
    setIsShuffled(true);
    localStorage.setItem('ig_shuf', '1');
    localStorage.removeItem('ig_sort');
    const items = getRawItems();
    setShuffledOrder([...items].sort(() => Math.random() - .5));
  };

  const setSort = (key: string) => {
    setCurSort(key);
    setIsShuffled(false);
    localStorage.setItem('ig_sort', key);
    localStorage.removeItem('ig_shuf');
  };

  // Render methods...
  return (
    <div className="ig-app">
      {/* Sidebar */}
      <nav className="ig-nav">
        <div className="ig-nav-logo">
          <svg viewBox="0 0 28 28" fill="none" width="28" height="28">
            <rect width="28" height="28" rx="6" fill="#e84040" />
            <polygon points="11,7 11,21 22,14" fill="#fff" />
          </svg>
          <span className="ig-nav-logo-text">AphroArchive</span>
        </div>
        <div className={`ig-nav-item ${curView === 'feed' ? 'active' : ''}`} onClick={() => setCurView('feed')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
          <span>Feed</span>
        </div>
        <div className={`ig-nav-item ${curView === 'explore' ? 'active' : ''}`} onClick={() => setCurView('explore')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <span>Explore</span>
        </div>
        <div className={`ig-nav-item ${vaultOnly ? 'vault-on' : ''}`} onClick={() => setVaultOnly(!vaultOnly)}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
          <span>Vault Only</span>
        </div>
        <div className="ig-nav-spacer"></div>
        <div className="ig-nav-item" onClick={() => currentView.value = 'home'}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
          <span>Back to Archive</span>
        </div>
      </nav>

      {/* Main Content */}
      <div className="ig-content">
        {curView === 'feed' && (
          <>
            <div className="ig-feed" style={{ flex: 'none', width: '680px', maxWidth: '100%', padding: '24px 12px', display: 'flex', flexDirection: 'column' }}>
              {/* Stories */}
              <div className="ig-stories" style={{ display: 'flex', gap: '14px', overflowX: 'auto', padding: '8px 0 20px', scrollbarWidth: 'none', borderBottom: '1px solid #262626', marginBottom: '16px', flexShrink: 0 }}>
                {categories.map(cat => {
                  const color = strColor(cat);
                  return (
                    <div className="ig-story" key={cat} onClick={() => setActiveStoryCategory(cat)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', flexShrink: 0, cursor: 'pointer' }}>
                      <div className="ig-story-ring" style={{ width: '58px', height: '58px', borderRadius: '50%', padding: '2px', background: 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)' }}>
                        <div className="ig-story-inner" style={{ width: '100%', height: '100%', borderRadius: '50%', border: '2px solid #000', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '18px', background: color }}>
                          {initial(cat)}
                        </div>
                      </div>
                      <span className="ig-story-name" style={{ fontSize: '12px', color: '#a8a8a8', maxWidth: '64px', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat}</span>
                    </div>
                  );
                })}
              </div>

              {/* Feed items */}
              {visibleItems.map(item => (
                <PostCard
                  key={item.id}
                  item={item}
                  liked={likedIds.has(item.id)}
                  saved={savedIds.has(item.id)}
                  onLike={() => toggleLike(item.id, item._vault)}
                  onSave={() => toggleSave(item.id)}
                  onOpen={() => openModal(item.id, item._vault)}
                  onOpenProfile={(key: string) => { setProfileKey(key); setCurView('profile'); }}
                  vaultUser={vaultUser}
                  timeAgo={timeAgo}
                  strColor={strColor}
                  initial={initial}
                />
              ))}

              {feedLoading && <div className="ig-loading"><div className="ig-spinner"></div></div>}
              {feedDone && <div className="ig-end-msg">You're all caught up</div>}
            </div>

            {/* Right Sidebar */}
            <div className="ig-right" style={{ width: '300px', flexShrink: 0, padding: '24px 20px 24px 0', position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' }}>
              <div className="ig-account" style={{ display: 'flex', alignItems: 'center', gap: '14px', paddingBottom: '20px' }}>
                <div className="ig-account-avatar" style={{ width: '56px', height: '56px', borderRadius: '50%', background: vaultOnly ? '#bc1888' : '#e84040', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '22px', flexShrink: 0 }}>
                  {vaultOnly ? 'V' : 'A'}
                </div>
                <div style={{ flex: 1 }}>
                  <div className="ig-account-name" style={{ fontWeight: '600', fontSize: '14px' }}>{vaultOnly ? 'Vault Profile' : 'AphroArchive'}</div>
                  <div className="ig-account-sub" style={{ fontSize: '12px', color: '#a8a8a8' }}>{vaultOnly ? 'Secure Storage' : 'Local Library'}</div>
                </div>
                {vaultConfigured && (
                  <button 
                    className="ig-sug-btn" 
                    onClick={() => setVaultOnly(!vaultOnly)}
                    style={{ background: 'none', border: 'none', color: '#0095f6', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}
                  >
                    Switch
                  </button>
                )}
              </div>

              {/* Controls */}
              <div className="ig-right-controls" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px', paddingBottom: '20px', borderBottom: '1px solid #262626' }}>
                <select 
                  value={curSort} 
                  onChange={(e: any) => setSort(e.target.value)}
                  style={{ width: '100%', background: '#1a1a1a', border: '1px solid #333', color: '#fff', padding: '6px 12px', borderRadius: '20px', fontSize: '13px', cursor: 'pointer' }}
                >
                  <option value="date">📅 Date</option>
                  <option value="duration">⏱ Duration</option>
                  <option value="name">🔤 Name</option>
                  <option value="size">📦 Size</option>
                </select>
                
                <button className="ig-tb-btn" style={{ width: '100%', justifyContent: 'flex-start', gap: '8px', background: '#1a1a1a', border: '1px solid #333', color: '#fff', padding: '6px 12px', borderRadius: '20px', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center' }} onClick={shuffleFeed} title="Shuffle">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/></svg>
                  Shuffle
                </button>
                <button className="ig-tb-btn" style={{ width: '100%', justifyContent: 'flex-start', gap: '8px', background: '#1a1a1a', border: '1px solid #333', color: '#fff', padding: '6px 12px', borderRadius: '20px', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center' }} onClick={() => setAutoplayEnabled(!autoplayEnabled)} title="Toggle autoplay">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5,3 19,12 5,21"/></svg>
                  <span>Autoplay {autoplayEnabled ? 'On' : 'Off'}</span>
                </button>
                <button className="ig-tb-btn" style={{ width: '100%', justifyContent: 'flex-start', gap: '8px', background: '#1a1a1a', border: '1px solid #333', color: '#fff', padding: '6px 12px', borderRadius: '20px', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center' }} onClick={() => setSavedOnly(!savedOnly)} title="View saved only">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                  <span>{savedOnly ? 'Showing Saved' : 'Saved Only'}</span>
                </button>
              </div>

              <div className="ig-sug-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}><span style={{ fontSize: '14px', fontWeight: '600', color: '#a8a8a8' }}>Suggested</span></div>
              <div className="ig-suggestions">
                {suggestions.map(cat => {
                  const color = strColor(cat);
                  const count = allVideos.value.filter(v => (v.category||'Uncategorized') === cat).length;
                  return (
                    <div className="ig-sug-item" key={cat} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                      <div className="ig-sug-avatar" style={{ width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '12px', color: '#fff', flexShrink: 0, background: color, cursor: 'pointer' }} onClick={() => { setProfileKey(`cat:${cat}`); setCurView('profile'); }}><span>{initial(cat)}</span></div>
                      <div className="ig-sug-info" style={{ flex: 1, minWidth: 0 }}>
                        <div className="ig-sug-name" style={{ fontSize: '13px', fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }} onClick={() => { setProfileKey(`cat:${cat}`); setCurView('profile'); }}><span>{cat}</span></div>
                        <div className="ig-sug-sub" style={{ fontSize: '12px', color: '#a8a8a8' }}>{count} video{count!==1?'s':''}</div>
                      </div>
                      <button className="ig-sug-btn" style={{ background: 'none', border: 'none', color: '#0095f6', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }} onClick={() => { setProfileKey(`cat:${cat}`); setCurView('profile'); }}>View</button>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )

        {curView === 'explore' && (
          <div className="ig-explore show">
            <div className="ig-explore-grid">
              {feedItems.map(item => (
                <ExploreTile key={item.id} item={item} onOpen={() => openModal(item.id, item._vault)} />
              ))}
            </div>
          </div>
        )}

        {curView === 'profile' && profileKey && (
          <div className="ig-profile show" style={{ padding: '24px 24px 24px 32px', flex: 1, minWidth: 0 }}>
            <button className="ig-profile-back" onClick={() => setCurView('feed')} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'none', border: 'none', color: '#a8a8a8', cursor: 'pointer', fontSize: '14px', marginBottom: '16px', padding: 0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
              Back
            </button>
            {(() => {
              const isVaultProfile = profileKey.startsWith('vault:');
              const id = profileKey.slice(profileKey.indexOf(':') + 1);
              let displayName = '';
              let items: IgItem[] = [];
              if (isVaultProfile) {
                displayName = id === '__root__' ? 'Vault' : (vaultFolderMap[id] || 'Vault');
                items = vaultFiles.filter(f => (f.folder || '__root__') === id).map(f => ({ ...f, _vault: true, id: f.id }));
              } else {
                displayName = id;
                items = allVideos.value.filter(v => (v.category || 'Uncategorized') === id).map(v => ({ ...v, _vault: false, id: v.id }));
              }
              const color = strColor(displayName);
              const postCount = items.length;
              const likedCount = items.filter(i => likedIds.has(i.id)).length;

              const getThumbSrc = (item: IgItem) => {
                const isVault = item._vault;
                const ext = (item.ext || '').toLowerCase();
                const isImgFile = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp'].includes(ext);
                if (isVault && isImgFile) return '/api/vault/stream/' + item.id;
                if (!isVault) return '/api/thumbs/' + item.id + '/0';
                return '';
              };

              return (
                <>
                  <div className="ig-profile-header" style={{ display: 'flex', alignItems: 'center', gap: '28px', paddingBottom: '24px', borderBottom: '1px solid #262626', marginBottom: '20px' }}>
                    <div className="ig-profile-avatar" style={{ background: color, width: '86px', height: '86px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '32px', color: '#fff', flexShrink: 0 }}>{initial(displayName)}</div>
                    <div className="ig-profile-meta" style={{ flex: 1 }}>
                      <div className="ig-profile-name" style={{ fontSize: '20px', fontWeight: '300', marginBottom: '12px' }}>{displayName}</div>
                      <div className="ig-profile-stats" style={{ display: 'flex', gap: '28px', marginBottom: '10px' }}>
                        <div className="ig-profile-stat" style={{ fontSize: '14px' }}><strong style={{ display: 'block', fontSize: '16px', fontWeight: '700' }}>{postCount}</strong> posts</div>
                        <div className="ig-profile-stat" style={{ fontSize: '14px' }}><strong style={{ display: 'block', fontSize: '16px', fontWeight: '700' }}>{likedCount}</strong> liked</div>
                        {isVaultProfile && <div className="ig-profile-stat" style={{ fontSize: '14px' }}><strong style={{ display: 'block', fontSize: '16px', fontWeight: '700' }}>🔒</strong> vault</div>}
                      </div>
                      <div className="ig-profile-bio" style={{ fontSize: '13px', color: '#a8a8a8' }}>
                        {isVaultProfile ? 'Vault folder' : `Category · ${postCount} video${postCount !== 1 ? 's' : ''}`}
                      </div>
                    </div>
                  </div>
                  <div className="ig-profile-tabs" style={{ display: 'flex', borderTop: '1px solid #262626', marginBottom: '16px' }}>
                    <div className="ig-profile-tab active" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '12px', borderTop: '1px solid #fff', fontSize: '12px', fontWeight: '600', color: '#fff', cursor: 'pointer', letterSpacing: '.8px', textTransform: 'uppercase', marginTop: '-1px' }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                      Posts
                    </div>
                  </div>
                  <div className="ig-profile-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '3px' }}>
                    {items.map(item => (
                      <div key={item.id} className="ig-profile-tile" onClick={() => openModal(item.id, item._vault)} style={{ aspectRatio: '1', position: 'relative', background: '#1a1a1a', overflow: 'hidden', cursor: 'pointer' }}>
                        {getThumbSrc(item) ? (
                          <img src={getThumbSrc(item)} loading="lazy" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        ) : (
                          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333' }}>
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polygon points="5,3 19,12 5,21"/></svg>
                          </div>
                        )}
                        <div className="ig-profile-tile-overlay" style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', opacity: 0, transition: 'opacity 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.opacity = '1'} onMouseLeave={(e) => e.currentTarget.style.opacity = '0'}>
                          <div className="ig-profile-tile-stat" style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#fff', fontWeight: '700' }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill={likedIds.has(item.id) ? '#ed4956' : 'white'} stroke={likedIds.has(item.id) ? '#ed4956' : 'white'} strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* Modal */}
      {curModal && (
        <IgModal
          id={curModal.id}
          isVault={curModal.isVault}
          onClose={closeModal}
          vaultFiles={vaultFiles}
          allVideos={allVideos.value}
          vaultUser={vaultUser}
          timeAgo={timeAgo}
          strColor={strColor}
          initial={initial}
          formatBytes={formatBytes}
          liked={likedIds.has(curModal.id)}
          saved={savedIds.has(curModal.id)}
          onLike={() => toggleLike(curModal.id, curModal.isVault)}
          onSave={() => toggleSave(curModal.id)}
        />
      )}

      {/* Story Viewer */}
      {activeStoryCategory && (
        <StoryViewer
          category={activeStoryCategory}
          items={allVideos.value.filter(v => (v.category || 'Uncategorized') === activeStoryCategory)}
          onClose={() => setActiveStoryCategory(null)}
          strColor={strColor}
          initial={initial}
        />
      )}
    </div>
  );
};

// Sub-components...

const StoryViewer = ({ category, items, onClose, strColor, initial }: any) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [duration, setDuration] = useState(8); // default 8s
  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<any>(null);

  const currentItem = items[currentIndex];

  useEffect(() => {
    if (!currentItem) return;
    
    // Reset timer and progress
    if (timerRef.current) clearTimeout(timerRef.current);
    
    const itemDuration = currentItem.duration || 8;
    setDuration(itemDuration);
    
    timerRef.current = setTimeout(() => {
      handleNext();
    }, itemDuration * 1000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [currentIndex, currentItem]);

  const handleNext = () => {
    if (currentIndex < items.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      onClose();
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  if (!currentItem) return null;

  const color = strColor(category);
  const streamUrl = `/api/stream/${currentItem.id}`;
  const thumbSrc = `/api/thumbs/${currentItem.id}/0`;

  return (
    <div className="ig-story-viewer open" style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 2000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <style>{`
        @keyframes svprogress {
          from { width: 0%; }
          to { width: 100%; }
        }
      `}</style>
      {/* Progress Bars */}
      <div className="ig-sv-progress" style={{ position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', gap: '4px', padding: '10px 12px 0', zIndex: 10 }}>
        {items.map((_: any, i: number) => (
          <div className="ig-sv-bar" key={i} style={{ flex: 1, height: '2px', background: 'rgba(255,255,255,.35)', borderRadius: '2px', overflow: 'hidden' }}>
            <div 
              className={`ig-sv-bar-fill ${i < currentIndex ? 'done' : i === currentIndex ? 'active' : ''}`} 
              style={{ 
                height: '100%', 
                background: '#fff', 
                width: i < currentIndex ? '100%' : '0%',
                animation: i === currentIndex ? `svprogress ${duration}s linear forwards` : 'none'
              }}
            />
          </div>
        ))}
      </div>

      <div className="ig-sv-header" style={{ position: 'absolute', top: '22px', left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', zIndex: 10 }}>
        <div className="ig-sv-user" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div className="ig-sv-avatar" style={{ width: '34px', height: '34px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '14px', color: '#fff', flexShrink: 0, background: color }}>{initial(category)}</div>
          <span className="ig-sv-name" style={{ fontSize: '14px', fontWeight: '600', textShadow: '0 1px 3px rgba(0,0,0,.6)' }}>{category}</span>
        </div>
        <button className="ig-sv-close" onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '24px', cursor: 'pointer', lineHeight: 1, textShadow: '0 1px 3px rgba(0,0,0,.6)' }}>✕</button>
      </div>

      <div className="ig-sv-media" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
        <video 
          ref={videoRef}
          src={streamUrl} 
          autoPlay 
          playsInline 
          style={{ width: '100%', height: '100%', objectFit: 'contain', maxWidth: '500px', display: 'block' }}
          poster={thumbSrc}
          onLoadedMetadata={(e: any) => {
            const dur = e.target.duration;
            if (dur && dur > 0) setDuration(dur);
          }}
          onEnded={handleNext}
        />
        
        {/* Zones */}
        <div id="ig-sv-prev" onClick={handlePrev} style={{ position: 'absolute', top: 0, bottom: 0, width: '35%', cursor: 'pointer', zIndex: 5, left: 0 }} />
        <div id="ig-sv-next" onClick={handleNext} style={{ position: 'absolute', top: 0, bottom: 0, width: '35%', cursor: 'pointer', zIndex: 5, right: 0 }} />
      </div>

      <div className="ig-sv-counter" style={{ position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)', fontSize: '13px', color: 'rgba(255,255,255,.7)', zIndex: 10, textShadow: '0 1px 3px rgba(0,0,0,.6)' }}>
        {currentIndex + 1} / {items.length}
      </div>
    </div>
  );
};

const PostCard = ({ item, liked, saved, onLike, onSave, onOpen, onOpenProfile, vaultUser, timeAgo, strColor, initial }: any) => {
  const isVault = item._vault;
  const name = item.name || item.originalName || 'Untitled';
  const category = isVault ? vaultUser(item) : (item.category || 'Uncategorized');
  const color = strColor(category);
  const mtime = item.mtime || 0;
  const ext = (item.ext || '').toLowerCase();
  const isImgFile = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp'].includes(ext);

  let thumbSrc = '';
  if (isVault && isImgFile) {
    thumbSrc = '/api/vault/stream/' + item.id;
  } else if (!isVault) {
    thumbSrc = '/api/thumbs/' + item.id + '/0';
  }

  return (
    <div className="ig-post">
      <div className="ig-post-header">
        <div className="ig-post-avatar" style={{ background: color, cursor: 'pointer' }} onClick={() => onOpenProfile(isVault ? `vault:${item.folder || '__root__'}` : `cat:${category}`)}>{initial(category)}</div>
        <div className="ig-post-info">
          <div className="ig-post-username" style={{ cursor: 'pointer' }} onClick={() => onOpenProfile(isVault ? `vault:${item.folder || '__root__'}` : `cat:${category}`)}>{category}</div>
          <div className="ig-post-meta">{timeAgo(mtime)}</div>
        </div>
        <button className="ig-post-menu" title="More">⋮</button>
      </div>
      <div className="ig-post-media" onClick={onOpen}>
        {thumbSrc ? <img src={thumbSrc} alt="" loading="lazy" /> : (
          <div className="ig-placeholder">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="1.5"><polygon points="5,3 19,12 5,21" /></svg>
            <span style={{ fontSize: '12px', color: '#444' }}>{name}</span>
          </div>
        )}
        <div className="ig-play-overlay">
          <div className="ig-play-btn"><svg width="22" height="22" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21" /></svg></div>
        </div>
        {isVault && <span className="ig-vault-tag">VAULT</span>}
        {item.duration > 0 && <span className="ig-duration-badge">{formatDuration(item.duration)}</span>}
      </div>
      <div className="ig-post-actions">
        <button className={`ig-act-btn ${liked ? 'liked' : ''}`} onClick={onLike}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
        </button>
        <button className="ig-act-btn" onClick={onOpen}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
        </button>
        <div className="ig-spacer"></div>
        <button className={`ig-act-btn ${saved ? 'saved' : ''}`} onClick={onSave}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
        </button>
      </div>
      <div className="ig-post-likes">{liked ? '❤ Liked' : ''}</div>
      <div className="ig-post-caption"><strong>{category}</strong>{name}</div>
      {item.tags && item.tags.length > 0 && (
        <div className="ig-post-tags">{item.tags.map((t: string) => `#${t}`).join(' ')}</div>
      )}
      <div className="ig-post-time">{timeAgo(mtime)} ago</div>
    </div>
  );
};

const ExploreTile = ({ item, onOpen }: any) => {
  const isVault = item._vault;
  const ext = (item.ext || '').toLowerCase();
  const isImg = isVault && ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp'].includes(ext);
  const thumbSrc = isVault && isImg ? '/api/vault/stream/' + item.id : (!isVault ? '/api/thumbs/' + item.id + '/0' : '');

  return (
    <div className="ig-explore-item" onClick={onOpen}>
      {thumbSrc ? <img src={thumbSrc} alt="" loading="lazy" /> : (
        <div className="ig-explore-placeholder">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="1.5"><polygon points="5,3 19,12 5,21" /></svg>
        </div>
      )}
      <div className="ig-explore-overlay">
        <span><svg width="16" height="16" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21" /></svg></span>
      </div>
      {isVault && <div className="ig-explore-vault"></div>}
    </div>
  );
};

const IgModal = ({ id, isVault, onClose, vaultFiles, allVideos, vaultUser, timeAgo, strColor, initial, formatBytes, liked, saved, onLike, onSave }: any) => {
  const item = isVault ? vaultFiles.find((f: any) => f.id === id) : allVideos.find((v: any) => v.id === id);
  if (!item) return null;

  const name = item.name || item.originalName || 'Untitled';
  const category = isVault ? vaultUser(item) : (item.category || 'Uncategorized');
  const color = strColor(category);
  const ext = (item.ext || '').toLowerCase();
  const isImgVault = isVault && ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp'].includes(ext);
  const streamUrl = isVault ? '/api/vault/stream/' + id : '/api/stream/' + id;

  return (
    <div className="ig-modal open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <button className="ig-modal-close" onClick={onClose}>✕</button>
      <div className="ig-modal-inner">
        <div className="ig-modal-media">
          {isImgVault ? (
            <img src={streamUrl} alt={name} />
          ) : (
            <video src={streamUrl} controls autoPlay style={{ maxWidth: 'min(860px,65vw)', maxHeight: '90vh' }} muted={isMuted.value} />
          )}
        </div>
        <div className="ig-modal-side">
          <div className="ig-modal-header">
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '13px', color: '#fff' }}>
              {initial(category)}
            </div>
            <div className="ig-modal-info">
              <div className="ig-modal-username">{category}</div>
              <div className="ig-modal-meta">{timeAgo(item.mtime || 0)}</div>
            </div>
          </div>
          <div className="ig-modal-body">
            <div className="ig-modal-title"><strong>{category}</strong>{name}</div>
            {item.duration > 0 && <div className="ig-modal-detail">Duration: {formatDuration(item.duration)}</div>}
            {item.size && <div className="ig-modal-detail">Size: {formatBytes(item.size)}</div>}
            {item.tags && item.tags.length > 0 && (
              <div className="ig-modal-detail" style={{ color: '#a8a8a8', marginTop: '8px' }}>
                {item.tags.map((t: string) => `#${t}`).join(' ')}
              </div>
            )}

            {/* AI Comments Component */}
            <AiComments />
          </div>
          <div className="ig-modal-actions">
            <button className={`ig-act-btn ${liked ? 'liked' : ''}`} onClick={onLike}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
            </button>
            <div style={{ flex: 1 }}></div>
            <button className={`ig-act-btn ${saved ? 'saved' : ''}`} onClick={onSave}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
