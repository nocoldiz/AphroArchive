import { useState, useEffect } from 'preact/hooks';
import { confirmDialog } from '../../dialog';

interface Playlist {
  name: string;
  count: number;
}

export const PlaylistsView = () => {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [currentPlaylist, setCurrentPlaylist] = useState<string | null>(null);
  const [playlistVideos, setPlaylistVideos] = useState<any[]>([]);

  useEffect(() => {
    loadPlaylists();
    const w = window as any;
    w.openPlaylistDetail = (name: string) => openDetail(name);
    return () => { if (w.openPlaylistDetail) delete w.openPlaylistDetail; };
  }, []);

  const loadPlaylists = async () => {
    try {
      const r = await fetch('/api/playlists');
      const data = await r.json();
      setPlaylists(Array.isArray(data) ? data : []);
    } catch {
      setPlaylists([]);
    }
  };

  const handleCreate = async () => {
    const name = newPlaylistName.trim();
    if (!name) return;
    const r = await fetch('/api/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (r.ok) {
      setNewPlaylistName('');
      loadPlaylists();
      const w = window as any;
      if (w.toast) w.toast(`Playlist "${name}" created`);
    } else {
      const d = await r.json();
      const w = window as any;
      if (w.toast) w.toast(d.error || 'Failed');
    }
  };

  const handleDeleteAll = async () => {
    if (playlists.length === 0) return;
    if (!await confirmDialog(`Delete all ${playlists.length} playlists? This cannot be undone.`)) return;
    const r = await fetch('/api/playlists', { method: 'DELETE' });
    const w = window as any;
    if (r.ok) {
      loadPlaylists();
      if (w.toast) w.toast('All playlists deleted');
    } else if (w.toast) {
      w.toast('Delete failed');
    }
  };

  const handleDelete = async (name: string) => {
    if (!await confirmDialog(`Delete playlist "${name}"?`)) return;
    const r = await fetch(`/api/playlists/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (r.ok) {
      loadPlaylists();
      const w = window as any;
      if (w.toast) w.toast('Playlist deleted');
    } else {
      const w = window as any;
      if (w.toast) w.toast('Delete failed');
    }
  };

  const openDetail = async (name: string) => {
    setCurrentPlaylist(name);
    try {
      const r = await fetch(`/api/playlists/${encodeURIComponent(name)}/videos`);
      const data = await r.json();
      setPlaylistVideos(Array.isArray(data) ? data : []);
    } catch {
      setPlaylistVideos([]);
    }
  };

  if (currentPlaylist) {
    return (
      <div className="playlists-view" style={{ padding: '24px' }}>
        <button className="back-btn" style={{ marginBottom: '16px' }} onClick={() => setCurrentPlaylist(null)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6" /></svg>
          Back to Playlists
        </button>

        <h2 style={{ marginBottom: '24px', color: 'var(--ac)' }}>{currentPlaylist}</h2>

        {playlistVideos.length === 0 ? (
          <div className="playlist-empty">No videos in this playlist.</div>
        ) : (
          <div className="video-grid">
            {playlistVideos.map(v => (
              <div key={v.id} className="video-card" onClick={() => {
                const w = window as any;
                if (w.openVid) w.openVid(v.id);
              }}>
                <div className="card-thumb">
                  <img src={`/api/thumbs/${v.id}/0`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div className="card-body">
                  <div className="card-title" title={v.name}>{v.name}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="playlists-view" style={{ padding: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', gap: '10px' }}>
        <h2 style={{ margin: 0, color: 'var(--ac)' }}>Playlists</h2>
        {playlists.length > 0 && (
          <button type="button" class="modal-btn" onClick={handleDeleteAll}>Delete All</button>
        )}
      </div>

      {/* New Playlist Row */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '24px' }}>
        <input
          type="text"
          value={newPlaylistName}
          onInput={(e: any) => setNewPlaylistName(e.target.value)}
          placeholder="New playlist name..."
          onKeyDown={(e: any) => e.key === 'Enter' && handleCreate()}
          style={{ flex: 1, background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px' }}
        />
        <button type="button" class="modal-btn modal-btn--primary" onClick={handleCreate}>Create</button>
      </div>

      {playlists.length === 0 ? (
        <div className="playlist-empty">No playlists yet. Create one above.</div>
      ) : (
        <div className="playlist-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
          {playlists.map(pl => (
            <div
              key={pl.name}
              className="playlist-card"
              onClick={() => openDetail(pl.name)}
              style={{ background: 'var(--bg2)', padding: '16px', borderRadius: '8px', border: '1px solid var(--brd)', cursor: 'pointer', position: 'relative' }}
            >
              <div className="playlist-card-name" style={{ fontWeight: 'bold', marginBottom: '5px' }}>{pl.name}</div>
              <div className="playlist-card-count" style={{ fontSize: '0.8rem', color: 'var(--tx2)' }}>{pl.count} videos</div>
              <button
                className="playlist-delete"
                onClick={(e) => { e.stopPropagation(); handleDelete(pl.name); }}
                style={{ position: 'absolute', top: '10px', right: '10px', background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
