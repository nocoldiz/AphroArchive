import { useState, useEffect, useMemo } from 'preact/hooks';
import { currentVideo, currentView, allVideos, appPrefs, tagModalState, actorModalState, showAddToCollectionModal, isMuted } from '../../public/src/store';
import './RedditView.css';

export const RedditView = () => {
  const [vids, setVids] = useState<any[]>([]);
  const [hiddenTerms, setHiddenTerms] = useState<string[]>([]);
  const [vaultItems, setVaultItems] = useState<any[]>([]);
  const [photos, setPhotos] = useState<any[]>([]);
  const [books, setBooks] = useState<any[]>([]);
  const [actors, setActors] = useState<any[]>([]);
  const [studios, setStudios] = useState<any[]>([]);
  const [tags, setTags] = useState<any[]>([]);
  
  const [curSub, setCurSub] = useState('all');
  const [curSort, setSort] = useState('hot');
  const [searchQ, setSearchQ] = useState('');
  const [feedPage, setFeedPage] = useState(0);
  const [feedLoading, setFeedLoading] = useState(false);
  
  const [subscriptions, setSubscriptions] = useState<Set<string>>(new Set(['__vault__']));
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  
  const [detailVideo, setDetailVideo] = useState<any | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);

  const [isNewPostOpen, setIsNewPostOpen] = useState(false);
  const [npTab, setNpTab] = useState<'media' | 'text'>('media');

  const [hotRnd] = useState(() => new Map());

  useEffect(() => {
    // Load subscriptions
    const s = localStorage.getItem('reddit_subs');
    if (s) setSubscriptions(new Set(JSON.parse(s)));
    
    // Load data
    loadAllData();
  }, []);

  const loadAllData = async () => {
    setFeedLoading(true);
    try {
      const [v, vStatus, p, b, a, st, t, lists] = await Promise.all([
        fetch('/api/videos?sort=date').then(r => r.json()),
        fetch('/api/vault/status').then(r => r.json()),
        fetch('/api/photos').then(r => r.json()),
        fetch('/api/books').then(r => r.json()),
        fetch('/api/actors').then(r => r.json()),
        fetch('/api/studios').then(r => r.json()),
        fetch('/api/tags').then(r => r.json()),
        fetch('/api/settings/lists').then(r => r.json())
      ]);

      setVids(v);
      setPhotos(p);
      setBooks(b);
      setActors(a);
      setStudios(st);
      setTags(t);
      if (lists.hidden) setHiddenTerms(lists.hidden);

      setVaultUnlocked(!!vStatus.unlocked);
      if (vStatus.unlocked) {
        const vItems = await fetch('/api/vault/files').then(r => r.json());
        if (Array.isArray(vItems)) {
          setVaultItems(vItems.filter(f => f.type !== 'folder').map(v => ({ ...v, _vault: true })));
        }
      }

      // Assign random weights for hot sort
      [...v, ...p, ...b].forEach(item => {
        const id = item.id || ('bk_' + item.name);
        if (!hotRnd.has(id)) hotRnd.set(id, Math.random());
      });

    } catch (err) {
      console.error('Failed to load Reddit mode data', err);
    }
    setFeedLoading(false);
  };

  const filteredItems = useMemo(() => {
    let list: any[] = [];
    
    if (curSub === '__photos__') {
      list = photos.map(p => ({ ...p, _photo: true, mtime: p.date || 0 }));
    } else if (curSub === '__books__') {
      list = books.map(b => ({ ...b, _book: true, id: 'bk_' + b.name, mtime: b.date || 0 }));
    } else if (curSub === '__vault__') {
      list = vaultItems;
    } else if (curSub === 'all') {
      list = [...vids.map(v => ({ ...v, _vault: false })), ...vaultItems];
    } else if (curSub.startsWith('cat:')) {
      const cat = curSub.slice(4);
      list = [...vids, ...vaultItems].filter(v => (v.category || 'Uncategorized') === cat);
    } else if (curSub.startsWith('tag:')) {
      const tag = curSub.slice(4);
      list = vids.filter(v => v.tags && v.tags.some((t: string) => t.toLowerCase() === tag.toLowerCase()));
    } else if (curSub.startsWith('actor:')) {
      const actor = curSub.slice(6);
      list = vids.filter(v => v.actors && v.actors.some((a: string) => a.toLowerCase() === actor.toLowerCase()));
    } else if (curSub.startsWith('studio:')) {
      const studio = curSub.slice(7);
      list = vids.filter(v => v.studio && v.studio.toLowerCase() === studio.toLowerCase());
    }

    if (hiddenTerms.length > 0) {
      list = list.filter(item => {
        const name = item.name || item.title || item.filename || '';
        const cat = item.category || '';
        const tags = item.tags || (item as any).videoMeta?.tags || [];
        
        const match = hiddenTerms.some(term => {
          const termLo = term.toLowerCase();
          if (name.toLowerCase().includes(termLo)) return true;
          const catLo = cat.toLowerCase();
          if (catLo === termLo || catLo.startsWith(termLo + '/') || catLo.startsWith(termLo + '\\')) return true;
          if (tags.some((t: string) => t.toLowerCase() === termLo)) return true;
          return false;
        });
        return !match;
      });
    }

    if (searchQ) {
      const q = searchQ.toLowerCase();
      list = list.filter(v => (v.name || v.title || v.filename || '').toLowerCase().includes(q));
    }

    if (curSort === 'new') {
      return list.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    } else if (curSort === 'top') {
      return list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else if (curSort === 'hot') {
      return list.sort((a, b) => (hotRnd.get(b.id) || 0) - (hotRnd.get(a.id) || 0));
    }
    
    return list;
  }, [curSub, curSort, searchQ, vids, vaultItems, photos, books, hotRnd, hiddenTerms]);

  const loadComments = async (videoId: string) => {
    setLoadingComments(true);
    try {
      const r = await fetch(`/api/comments/${encodeURIComponent(videoId)}`);
      const d = await r.json();
      setComments(d.comments || []);
    } catch {
      setComments([]);
    }
    setLoadingComments(false);
  };

  const openDetail = (video: any) => {
    setDetailVideo(video);
    loadComments(video.id);
  };

  const closeDetail = () => {
    setDetailVideo(null);
    setComments([]);
  };

  const handleVote = (id: string, dir: number) => {
    const w = window as any;
    if (w.toast) w.toast(`Voted ${dir > 0 ? 'up' : 'down'} on ${id}`);
  };

  const handleSave = async (id: string) => {
    const r = await fetch(`/api/favourites/${encodeURIComponent(id)}`, { method: 'POST' });
    const d = await r.json();
    const w = window as any;
    if (w.toast) w.toast(d.fav ? 'Saved to collection' : 'Removed from collection');
    
    // Refresh videos to update fav status
    loadAllData();
  };

  const toggleSubscribe = (sub: string) => {
    const newSubs = new Set(subscriptions);
    if (newSubs.has(sub)) {
      newSubs.delete(sub);
    } else {
      newSubs.add(sub);
    }
    setSubscriptions(newSubs);
    localStorage.setItem('reddit_subs', JSON.stringify([...newSubs]));
  };

  return (
    <div className="reddit-view" style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#1a1a1b', color: '#d7dadc' }}>
      <style>{`
        .rd-post-media:hover .thumb-actions {
          opacity: 1 !important;
          transform: translateY(0) !important;
        }
        .thumb-actions button {
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(4px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: white;
          border-radius: 50%;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background 0.2s, transform 0.2s, color 0.2s;
        }
        .thumb-actions button:hover {
          background: rgba(0, 0, 0, 0.8);
          transform: scale(1.1);
        }
        .thumb-actions button.fav-active {
          color: #ffb700;
        }
      `}</style>
      <header className="rd-header" style={{ display: 'flex', alignItems: 'center', padding: '10px 20px', background: '#1a1a1b', borderBottom: '1px solid #343536', position: 'sticky', top: 0, zIndex: 100 }}>
        <div className="rd-logo" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none', color: '#fff', fontWeight: 'bold' }}>
          <svg width="32" height="32" viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="16" fill="#ff4500"/>
            <ellipse cx="16" cy="20" rx="9" ry="5.5" fill="#fff"/>
            <circle cx="12.5" cy="19.5" r="1.5" fill="#ff4500"/>
            <circle cx="19.5" cy="19.5" r="1.5" fill="#ff4500"/>
            <path d="M13.5 22.5 Q16 24 18.5 22.5" stroke="#ff4500" stroke-width="1.2" stroke-linecap="round" fill="none"/>
            <circle cx="22" cy="10.5" r="2.5" fill="#fff"/>
            <path d="M16 7 Q19 5 22 8" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/>
            <circle cx="22" cy="7.5" r="1" fill="#ffd635"/>
          </svg>
          <span>AphroArchive</span>
        </div>
        
        <div className="rd-search" style={{ flex: 1, maxWidth: '600px', margin: '0 20px', position: 'relative' }}>
          <input 
            type="text" 
            value={searchQ}
            onInput={(e: any) => setSearchQ(e.target.value)}
            placeholder="Search AphroArchive" 
            style={{ width: '100%', background: '#272729', border: '1px solid #343536', borderRadius: '4px', padding: '8px 12px', paddingLeft: '35px', color: '#d7dadc' }}
          />
          <svg style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#818384' }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </div>

        <button className="rd-hdr-btn" onClick={() => currentView.value = 'hub'} style={{ background: '#272729', border: '1px solid #343536', color: '#d7dadc', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}>
          ← Archive
        </button>
      </header>

      <div className="rd-layout" style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <main className="rd-main" style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          {detailVideo ? (
            <div id="rd-detail">
              <button className="rd-back-btn" onClick={closeDetail} style={{ background: 'none', border: 'none', color: '#d7dadc', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '15px' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
                Back to feed
              </button>
              
              <div className="rd-post" style={{ background: '#1a1a1b', border: '1px solid #343536', borderRadius: '4px', padding: '15px' }}>
                <div className="rd-post-title" style={{ fontSize: '1.2rem', fontWeight: 'bold', marginBottom: '10px' }}>{detailVideo.name || detailVideo.title}</div>
                <div className="rd-post-media" style={{ marginBottom: '15px' }}>
                  {detailVideo._photo ? (
                    <img src={`/api/photos/${detailVideo.id}/img`} style={{ width: '100%', borderRadius: '4px' }} alt="" />
                  ) : (
                    <video src={detailVideo._vault ? `/api/vault/stream/${detailVideo.id}` : `/api/stream/${detailVideo.id}`} controls autoPlay style={{ width: '100%', borderRadius: '4px' }} muted={isMuted.value} />
                  )}
                </div>
                
                <div className="rd-comments-box">
                  <h4>Comments</h4>
                  {loadingComments ? (
                    <div className="rd-spinner">Loading comments...</div>
                  ) : comments.length === 0 ? (
                    <div style={{ color: '#818384' }}>No comments yet.</div>
                  ) : (
                    comments.map(c => (
                      <div key={c.id} style={{ borderLeft: '2px solid #343536', paddingLeft: '10px', marginBottom: '10px' }}>
                        <div style={{ fontSize: '0.8rem', color: '#818384' }}>{c.author || 'Anonymous'}</div>
                        <div>{c.text}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div id="rd-feed">
              <div className="rd-sortbar" style={{ display: 'flex', gap: '10px', marginBottom: '15px', background: '#1a1a1b', border: '1px solid #343536', borderRadius: '4px', padding: '10px' }}>
                {['hot', 'new', 'top'].map(s => (
                  <button 
                    key={s} 
                    className={`rd-sort-btn ${curSort === s ? 'active' : ''}`} 
                    onClick={() => setSort(s)}
                    style={{ background: curSort === s ? '#272729' : 'none', border: 'none', color: curSort === s ? '#fff' : '#818384', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer', textTransform: 'capitalize' }}
                  >
                    {s}
                  </button>
                ))}
              </div>

              <div id="rd-posts" style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                {feedLoading && feedPage === 0 ? (
                  <div className="rd-spinner">Loading posts...</div>
                ) : filteredItems.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px', color: '#818384' }}>No posts found.</div>
                ) : (
                  filteredItems.map(v => (
                    <div key={v.id || v.name} className="rd-post" style={{ background: '#1a1a1b', border: '1px solid #343536', borderRadius: '4px', display: 'flex' }}>
                      <div className="rd-vote-col" style={{ width: '40px', background: '#161617', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0', borderTopLeftRadius: '4px', borderBottomLeftRadius: '4px' }}>
                        <button className="rd-vote-btn" onClick={() => handleVote(v.id, 1)} style={{ background: 'none', border: 'none', color: '#818384', cursor: 'pointer' }}>▲</button>
                        <span style={{ fontSize: '0.8rem', fontWeight: 'bold', margin: '5px 0' }}>{Math.floor(hotRnd.get(v.id) * 100) || 0}</span>
                        <button className="rd-vote-btn" onClick={() => handleVote(v.id, -1)} style={{ background: 'none', border: 'none', color: '#818384', cursor: 'pointer' }}>▼</button>
                      </div>
                      
                      <div className="rd-post-body" style={{ flex: 1, padding: '15px', cursor: 'pointer' }} onClick={() => openDetail(v)}>
                        <div className="rd-post-meta" style={{ fontSize: '0.8rem', color: '#818384', marginBottom: '5px' }}>
                          <span style={{ color: '#ff4500', fontWeight: 'bold' }}>r/{v.category || 'all'}</span> • Posted by u/anonymous
                        </div>
                        <div className="rd-post-title" style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '10px' }}>{v.name || v.title || v.filename}</div>
                        
                        <div className="rd-post-media" style={{ position: 'relative', maxHeight: '400px', overflow: 'hidden', background: '#000', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {v._photo ? (
                            <img src={`/api/photos/${v.id}/img`} style={{ maxWidth: '100%', maxHeight: '400px' }} alt="" />
                          ) : v._book ? (
                            <div style={{ padding: '20px', color: '#818384' }}>📚 {v.title}</div>
                          ) : (
                            <>
                              <img src={`/api/thumbs/${v.id}/0`} style={{ maxWidth: '100%', maxHeight: '400px' }} alt="" />
                              <div className="thumb-actions" style={{ 
                                position: 'absolute', 
                                top: '5px', 
                                right: '5px', 
                                display: 'flex', 
                                gap: '5px', 
                                zIndex: 3,
                                opacity: 0,
                                transform: 'translateY(-5px)',
                                transition: 'opacity 0.2s ease, transform 0.2s ease'
                              }}>
                                <button onClick={(e) => { e.stopPropagation(); handleSave(v.id); }} title="Favourite" className={v.fav ? 'fav-active' : ''}>
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill={v.fav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); (window as any).openRen(v.id, v.name || v.title); }} title="Rename">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); (window as any).openMov(v.id, v.name || v.title, v.catPath || ''); }} title="Move to Category">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); currentVideo.value = v; showAddToCollectionModal.value = true; }} title="Add to Playlist">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); tagModalState.value = { visible: true, vidId: v.id, linkUrl: null }; }} title="Tags">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); actorModalState.value = { visible: true, vidId: v.id }; }} title="Actors">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                        
                        <div className="rd-post-actions" style={{ display: 'flex', gap: '15px', marginTop: '10px', color: '#818384', fontSize: '0.9rem' }}>
                          <span>💬 Comments</span>
                          <span onClick={(e) => { e.stopPropagation(); handleSave(v.id); }}>🔖 Save</span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </main>

        <aside className="rd-sidebar" style={{ width: '300px', borderLeft: '1px solid #343536', padding: '20px', overflowY: 'auto' }}>
          <div className="rd-sb-card" style={{ background: '#1a1a1b', border: '1px solid #343536', borderRadius: '4px', marginBottom: '20px' }}>
            <div style={{ height: '40px', background: '#ff4500', borderTopLeftRadius: '4px', borderTopRightRadius: '4px' }}></div>
            <div style={{ padding: '15px' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '10px' }}>r/{curSub.replace('cat:', '')}</div>
              <p style={{ fontSize: '0.9rem', color: '#818384' }}>Welcome to the Reddit Mode of AphroArchive.</p>
              <button className="rd-create-btn" onClick={() => setIsNewPostOpen(true)} style={{ width: '100%', background: '#ff4500', border: 'none', color: '#fff', padding: '10px', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer', marginTop: '10px' }}>
                Create Post
              </button>
            </div>
          </div>

          <div className="rd-sb-card" style={{ background: '#1a1a1b', border: '1px solid #343536', borderRadius: '4px' }}>
            <div style={{ padding: '15px', borderBottom: '1px solid #343536' }}>
              <div style={{ fontWeight: 'bold' }}>Communities</div>
            </div>
            <div style={{ padding: '10px' }}>
              {['all', '__photos__', '__books__', '__vault__'].map(s => (
                <div 
                  key={s} 
                  onClick={() => setCurSub(s)} 
                  style={{ padding: '8px', cursor: 'pointer', borderRadius: '4px', background: curSub === s ? '#272729' : 'none', color: curSub === s ? '#fff' : '#d7dadc' }}
                >
                  r/{s.replace('__', '').replace('__', '')}
                </div>
              ))}
              
              <div style={{ color: '#818384', fontSize: '0.8rem', padding: '8px', textTransform: 'uppercase', fontWeight: 'bold', marginTop: '10px' }}>Folders</div>
              {vids.map(v => v.category).filter((v, i, a) => v && a.indexOf(v) === i).slice(0, 10).map(cat => (
                <div 
                  key={cat} 
                  onClick={() => setCurSub(`cat:${cat}`)} 
                  style={{ padding: '8px', cursor: 'pointer', borderRadius: '4px', background: curSub === `cat:${cat}` ? '#272729' : 'none', color: curSub === `cat:${cat}` ? '#fff' : '#d7dadc' }}
                >
                  r/{cat}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {isNewPostOpen && (
        <div className="rd-np-modal" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setIsNewPostOpen(false)}>
          <div className="rd-np-box" style={{ background: '#1a1a1b', width: '500px', maxWidth: '95vw', borderRadius: '8px', padding: '20px', border: '1px solid #343536' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>New Post</div>
              <button onClick={() => setIsNewPostOpen(false)} style={{ background: 'none', border: 'none', color: '#818384', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
            </div>
            
            <p style={{ color: '#818384' }}>Porting of New Post functionality is in progress...</p>
          </div>
        </div>
      )}
    </div>
  );
};
