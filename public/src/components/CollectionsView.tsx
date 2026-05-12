import { useState, useEffect } from 'preact/hooks';
import { currentVideo } from '../store';

interface Collection {
  name: string;
  count: number;
}

export const CollectionsView = () => {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [currentCollection, setCurrentCollection] = useState<string | null>(null);
  const [collectionVideos, setCollectionVideos] = useState<any[]>([]);

  useEffect(() => {
    loadCollections();
  }, []);

  const loadCollections = async () => {
    const r = await fetch('/api/collections');
    const data = await r.json();
    setCollections(data);
  };

  const handleCreate = async () => {
    const name = newCollectionName.trim();
    if (!name) return;
    const r = await fetch('/api/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (r.ok) {
      setNewCollectionName('');
      loadCollections();
      const w = window as any;
      if (w.toast) w.toast(`Playlist "${name}" created`);
    } else {
      const d = await r.json();
      const w = window as any;
      if (w.toast) w.toast(d.error || 'Failed');
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete playlist "${name}"?`)) return;
    const r = await fetch(`/api/collections/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (r.ok) {
      loadCollections();
      const w = window as any;
      if (w.toast) w.toast('Playlist deleted');
    } else {
      const w = window as any;
      if (w.toast) w.toast('Delete failed');
    }
  };

  const openDetail = async (name: string) => {
    setCurrentCollection(name);
    const r = await fetch(`/api/collections/${encodeURIComponent(name)}/videos`);
    const data = await r.json();
    setCollectionVideos(data);
  };

  if (currentCollection) {
    return (
      <div className="collections-view" style={{ padding: '24px' }}>
        <button className="back-btn" style={{ marginBottom: '16px' }} onClick={() => setCurrentCollection(null)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
          Back to Playlists
        </button>
        
        <h2 style={{ marginBottom: '24px', color: 'var(--ac)' }}>{currentCollection}</h2>
        
        {collectionVideos.length === 0 ? (
          <div className="collection-empty">No videos in this playlist.</div>
        ) : (
          <div className="video-grid">
            {collectionVideos.map(v => (
              <div key={v.id} className="video-card" onClick={() => {
                const w = window as any;
                if (w.openVid) w.openVid(v.id);
              }}>
                <div className="card-thumb" style={{ background: '#333' }}>
                  <img src={`/api/thumbs/${v.id}/0`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div className="card-title" style={{ padding: '10px', fontSize: '0.9rem' }}>{v.name}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="collections-view" style={{ padding: '24px' }}>
      <h2 style={{ marginBottom: '24px', color: 'var(--ac)' }}>Playlists</h2>
      
      {/* New Collection Row */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '24px' }}>
        <input 
          type="text" 
          value={newCollectionName} 
          onInput={(e: any) => setNewCollectionName(e.target.value)}
          placeholder="New playlist name..."
          style={{ flex: 1, background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px' }}
        />
        <button class="modal-btn modal-btn--primary" onClick={handleCreate}>Create</button>
      </div>

      {collections.length === 0 ? (
        <div className="collection-empty">No playlists yet. Create one above.</div>
      ) : (
        <div className="collection-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
          {collections.map(col => (
            <div 
              key={col.name} 
              className="collection-card" 
              onClick={() => openDetail(col.name)}
              style={{ background: 'var(--bg2)', padding: '16px', borderRadius: '8px', border: '1px solid var(--brd)', cursor: 'pointer', position: 'relative' }}
            >
              <div className="collection-card-name" style={{ fontWeight: 'bold', marginBottom: '5px' }}>{col.name}</div>
              <div className="collection-card-count" style={{ fontSize: '0.8rem', color: 'var(--tx2)' }}>{col.count} videos</div>
              <button 
                className="collection-delete" 
                onClick={(e) => { e.stopPropagation(); handleDelete(col.name); }}
                style={{ position: 'absolute', top: '10px', right: '10px', background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
