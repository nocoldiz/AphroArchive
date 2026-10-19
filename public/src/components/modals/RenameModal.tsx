import { useState, useEffect } from 'preact/hooks';
import { renameModalState, videos, allVideos, currentVideo } from '../../store';
import { renameVideo } from '../../api';
import { useEscape } from './useEscape';

export const RenameModal = () => {
  const state = renameModalState.value;
  const [name, setName] = useState(state.currentName);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset on every open, not only when the name changes — reopening for the
  // same video previously kept the half-typed name and the old error.
  useEffect(() => {
    if (!state.visible) return;
    setName(state.currentName);
    setError('');
    setSaving(false);
  }, [state.visible, state.vidId, state.currentName]);

  const handleClose = () => {
    renameModalState.value = { ...renameModalState.value, visible: false };
  };

  useEscape(state.visible, () => { if (!saving) handleClose(); });

  if (!state.visible) return null;

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || saving) return;

    setSaving(true);
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
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay on" onClick={(e: any) => e.target === e.currentTarget && !saving && handleClose()} style={{ zIndex: 20000 }}>
      <div className="modal-dialog" style={{ maxWidth: '400px' }}>
        <div className="modal-header"><h2>Rename</h2></div>
        <input
          type="text"
          value={name}
          onInput={(e: any) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          placeholder="New name..."
          autoFocus
        />
        {error && <div className="modal-error" style={{ display: 'block' }}>{error}</div>}
        <div className="modal-footer">
          <button className="modal-btn" onClick={handleClose} disabled={saving}>Cancel</button>
          <button className="modal-btn modal-btn--primary" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};
