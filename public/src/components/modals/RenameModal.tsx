import { useState, useEffect } from 'preact/hooks';
import { renameModalState, videos, allVideos, currentVideo } from '../../store';
import { renameVideo } from '../../api';

export const RenameModal = () => {
  const state = renameModalState.value;
  const [name, setName] = useState(state.currentName);
  const [error, setError] = useState('');

  useEffect(() => {
    setName(state.currentName);
    setError('');
  }, [state.currentName]);

  if (!state.visible) return null;

  const handleClose = () => {
    renameModalState.value = { ...state, visible: false };
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    try {
      if (state.vidId) {
        const res = await renameVideo(state.vidId, trimmedName);

        // Optimistic update
        const list = [...videos.value];
        const idx = list.findIndex(v => v.id === state.vidId);
        if (idx >= 0) {
          list[idx] = { ...list[idx], id: res.newId, name: trimmedName };
          videos.value = list;
        }

        const allList = [...allVideos.value];
        const idx2 = allList.findIndex(v => v.id === state.vidId);
        if (idx2 >= 0) {
          allList[idx2] = { ...allList[idx2], id: res.newId, name: trimmedName };
          allVideos.value = allList;
        }

        if (currentVideo.value && currentVideo.value.id === state.vidId) {
          currentVideo.value = { ...currentVideo.value, id: res.newId, name: trimmedName };
        }

        const w = window as any;
        if (w.toast) w.toast('Renamed successfully');
      }
      handleClose();
    } catch (e: any) {
      setError(e.message || 'Failed to rename');
    }
  };

  return (
    <div className="modal-overlay on" onClick={(e: any) => e.target === e.currentTarget && handleClose()} style={{ zIndex: 20000 }}>
      <div className="modal-content" style={{ background: 'var(--bg2)', padding: '20px', borderRadius: '8px', width: '400px' }}>
        <h3 style={{ marginTop: 0 }}>Rename</h3>
        <input
          type="text"
          value={name}
          onInput={(e: any) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          placeholder="New name..."
          style={{ width: '100%', padding: '8px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '4px' }}
          autoFocus
        />
        {error && <div style={{ color: '#e84040', fontSize: '0.8rem', marginTop: '4px' }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
          <button onClick={handleClose} style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSave} style={{ background: 'var(--ac)', border: 'none', color: '#fff', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }}>Save</button>
        </div>
      </div>
    </div>
  );
};
