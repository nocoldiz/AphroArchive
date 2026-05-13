import { useState, useEffect, useRef } from 'preact/hooks';

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
          <div className="ig-feed">
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
                vaultUser={vaultUser}
                timeAgo={timeAgo}
                strColor={strColor}
                initial={initial}
              />
            ))}

            {feedLoading && <div className="ig-loading"><div className="ig-spinner"></div></div>}
            {feedDone && <div className="ig-end-msg">You're all caught up</div>}
          </div>
        )}

        {curView === 'explore' && (
          <div className="ig-explore show">
            <div className="ig-explore-grid">
              {feedItems.map(item => (
                <ExploreTile key={item.id} item={item} onOpen={() => openModal(item.id, item._vault)} />
              ))}
            </div>
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
    </div>
  );
};

// Sub-components...
const PostCard = ({ item, liked, saved, onLike, onSave, onOpen, vaultUser, timeAgo, strColor, initial }: any) => {
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
        <div className="ig-post-avatar" style={{ background: color, cursor: 'pointer' }}>{initial(category)}</div>
        <div className="ig-post-info">
          <div className="ig-post-username" style={{ cursor: 'pointer' }}>{category}</div>
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
