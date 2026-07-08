import { useState, useEffect } from 'preact/hooks';
import { addToPlaylistVideo, currentVideo } from '../../store';

interface Props {
  onClose: () => void;
}

interface Playlist {
  name: string;
  count: number;
}

export const AddToPlaylistModal = ({ onClose }: Props) => {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [newName, setNewName] = useState('');
  const video = addToPlaylistVideo.value || currentVideo.value;

  useEffect(() => {
    loadPlaylists();
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

  const handleAddToPlaylist = async (plName: string) => {
    if (!video) return;
    const r = await fetch(`/api/playlists/${encodeURIComponent(plName)}/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: video.id })
    });
    if (r.ok) {
      const w = window as any;
      if (w.toast) w.toast(`Added to playlist "${plName}"`);
      onClose();
    } else {
      const w = window as any;
      if (w.toast) w.toast('Failed to add to playlist');
    }
  };

  const handleCreateAndAdd = async () => {
    const name = newName.trim();
    if (!name || !video) return;

    // Create playlist
    const r = await fetch('/api/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });

    if (r.ok) {
      // Add video to the new playlist
      await handleAddToPlaylist(name);
    } else {
      const d = await r.json().catch(() => ({}));
      // If it already exists, just add to it rather than failing.
      if (r.status === 400 && playlists.some(p => p.name === name)) {
        await handleAddToPlaylist(name);
        return;
      }
      const w = window as any;
      if (w.toast) w.toast(d.error || 'Failed to create playlist');
    }
  };

  if (!video) return null;

  return (
    <div class="playlist-modal" id="playlist-modal" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10000 }} onClick={(e: any) => e.target.id === 'playlist-modal' && onClose()}>
      <div class="playlist-modal-box" style={{ background: 'var(--bg2)', padding: '24px', borderRadius: '12px', width: '360px', maxWidth: '95vw' }}>
        <h3 style={{ marginBottom: '16px' }}>Add to Playlist</h3>

        <div id="playlist-modal-list" style={{ maxHeight: '200px', overflowY: 'auto', marginBottom: '16px' }}>
          {playlists.length === 0 ? (
            <div style={{ color: 'var(--tx3)', fontSize: '0.9rem', textAlign: 'center', padding: '10px' }}>No playlists yet.</div>
          ) : (
            playlists.map(pl => (
              <div
                key={pl.name}
                onClick={() => handleAddToPlaylist(pl.name)}
                style={{ padding: '10px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', marginBottom: '8px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                onMouseOver={(e: any) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                onMouseOut={(e: any) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
              >
                <span>{pl.name}</span>
                <span style={{ fontSize: '0.8rem', color: 'var(--tx3)' }}>{pl.count} videos</span>
              </div>
            ))
          )}
        </div>

        <div class="playlist-modal-new" style={{ marginBottom: '16px' }}>
          <input
            type="text"
            value={newName}
            onInput={(e: any) => setNewName(e.target.value)}
            placeholder="New playlist name…"
            autocomplete="off"
            style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px' }}
            onKeyDown={(e: any) => e.key === 'Enter' && handleCreateAndAdd()}
          />
        </div>

        <div class="playlist-modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button class="playlist-cancel modal-btn" onClick={onClose}>Cancel</button>
          {newName.trim() && (
            <button class="btn-primary modal-btn modal-btn--primary" onClick={handleCreateAndAdd}>Create & Add</button>
          )}
        </div>
      </div>
    </div>
  );
};
