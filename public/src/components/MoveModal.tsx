import { useState, useEffect } from 'preact/hooks';
import { moveModalState, loadVideos } from '../store';
import { moveVideo } from '../api';
import { Category } from '../types';

export const MoveModal = () => {
  const state = moveModalState.value;
  const [mainCats, setMainCats] = useState<Category[]>([]);
  const [error, setError] = useState('');
  const [newCat, setNewCat] = useState('');

  useEffect(() => {
    if (state.visible) {
      fetch('/api/main-categories')
        .then(r => r.json())
        .then(data => setMainCats(data))
        .catch(e => setError('Failed to load categories'));
    }
    setError('');
    setNewCat('');
  }, [state.visible]);

  if (!state.visible) return null;

  const handleClose = () => {
    moveModalState.value = { ...state, visible: false };
  };

  const handleMove = async (targetCat: string) => {
    try {
      if (state.vidIds.length > 0) {
        const w = window as any;
        if (w.toast) w.toast(`Moving ${state.vidIds.length} videos...`);
        
        for (const id of state.vidIds) {
          await moveVideo(id, targetCat);
        }

        // Refresh lists
        await loadVideos();
        
        if (w.toast) w.toast(`Moved to ${targetCat || 'Uncategorized'}`);
      }
      handleClose();
    } catch (e: any) {
      setError(e.message || 'Failed to move');
    }
  };

  const handleMoveNew = () => {
    const trimmed = newCat.trim();
    if (!trimmed) return;
    const safe = trimmed.replace(/[<>:"|?*]/g, '_');
    handleMove(safe);
  };

  return (
    <div className="modal-overlay on" onClick={(e: any) => e.target === e.currentTarget && handleClose()} style={{ zIndex: 20000 }}>
      <div className="modal-content" style={{ background: 'var(--bg2)', padding: '20px', borderRadius: '8px', width: '400px', maxHeight: '80vh', overflowY: 'auto' }}>
        <h3 style={{ marginTop: 0 }}>Move To</h3>
        {state.vidIds.length > 1 && <div style={{ color: 'var(--tx2)', marginBottom: '12px' }}>Moving {state.vidIds.length} videos</div>}
        
        <div className="move-list" style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' }}>
          {mainCats.map(c => {
            const isCur = c.path === state.currentCategory;
            return (
              <div 
                key={c.path} 
                className={`move-item ${isCur ? 'cur' : ''}`} 
                onClick={() => !isCur && handleMove(c.path)}
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '8px', 
                  padding: '8px', 
                  borderRadius: '4px', 
                  cursor: isCur ? 'default' : 'pointer',
                  background: isCur ? 'rgba(255,255,255,0.05)' : 'transparent',
                  color: isCur ? 'var(--tx3)' : 'var(--tx)'
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <span>{c.name}</span>
                {isCur && <span style={{ marginLeft: 'auto', fontSize: '0.75rem' }}>Current</span>}
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <input 
            type="text" 
            value={newCat} 
            onInput={(e: any) => setNewCat(e.target.value)} 
            onKeyDown={(e) => e.key === 'Enter' && handleMoveNew()}
            placeholder="New category..."
            style={{ flex: 1, padding: '8px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '4px' }}
          />
          <button onClick={handleMoveNew} style={{ background: 'var(--ac)', border: 'none', color: '#fff', padding: '8px 12px', borderRadius: '4px', cursor: 'pointer' }}>Create & Move</button>
        </div>

        {error && <div style={{ color: '#e84040', fontSize: '0.8rem', marginTop: '8px' }}>{error}</div>}
        
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
          <button onClick={handleClose} style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
};
