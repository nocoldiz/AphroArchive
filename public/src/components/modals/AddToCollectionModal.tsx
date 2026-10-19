import { useState, useEffect } from 'preact/hooks';
import { currentVideo } from '../../store';
import { useEscape } from './useEscape';

interface Props {
  onClose: () => void;
}

interface Collection {
  name: string;
  count: number;
}

export const AddToCollectionModal = ({ onClose }: Props) => {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const video = currentVideo.value;

  useEffect(() => {
    fetch('/api/collections')
      .then(r => r.json())
      .then(data => setCollections(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  useEscape(true, () => { if (!busy) onClose(); });

  const toast = (msg: string) => (window as any).toast?.(msg);

  const addTo = async (colName: string) => {
    if (!video) return false;
    const r = await fetch(`/api/collections/${encodeURIComponent(colName)}/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: video.id })
    });
    if (!r.ok) { toast('Failed to add to playlist'); return false; }
    toast(`Added to playlist "${colName}"`);
    onClose();
    return true;
  };

  const handleAddToCollection = async (colName: string) => {
    if (busy) return;
    setBusy(true);
    try { await addTo(colName); }
    catch { toast('Failed to add to playlist'); }
    finally { setBusy(false); }
  };

  const handleCreateAndAdd = async () => {
    const name = newName.trim();
    if (!name || !video || busy) return;
    setBusy(true);
    try {
      const r = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (r.ok) {
        await addTo(name);
      } else {
        const d = await r.json().catch(() => ({}));
        toast(d.error || 'Failed to create playlist');
      }
    } catch {
      toast('Failed to create playlist');
    } finally {
      setBusy(false);
    }
  };

  if (!video) return null;

  return (
    <div className="modal-overlay on" id="collection-modal" style={{ zIndex: 10000 }} onClick={(e: any) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal-dialog" style={{ maxWidth: '360px' }}>
        <div className="modal-header"><h2>Add to Playlist</h2></div>

        <div id="collection-modal-list" style={{ maxHeight: '200px', overflowY: 'auto', marginBottom: '16px' }}>
          {collections.length === 0 ? (
            <div style={{ color: 'var(--tx3)', fontSize: '0.9rem', textAlign: 'center', padding: '10px' }}>No playlists yet.</div>
          ) : (
            collections.map(col => (
              <button
                key={col.name}
                type="button"
                className="collection-option"
                disabled={busy}
                onClick={() => handleAddToCollection(col.name)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
              >
                <span>{col.name}</span>
                <span style={{ fontSize: '0.8rem', color: 'var(--tx3)' }}>{col.count} videos</span>
              </button>
            ))
          )}
        </div>

        {/* No .collection-modal-new wrapper: it is display:none unless .on, which hid this input. */}
        <input
          type="text"
          value={newName}
          onInput={(e: any) => setNewName(e.target.value)}
          placeholder="New playlist name…"
          autocomplete="off"
          onKeyDown={(e: any) => e.key === 'Enter' && handleCreateAndAdd()}
        />

        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={busy}>Cancel</button>
          {newName.trim() && (
            <button className="modal-btn modal-btn--primary" onClick={handleCreateAndAdd} disabled={busy}>Create & Add</button>
          )}
        </div>
      </div>
    </div>
  );
};
