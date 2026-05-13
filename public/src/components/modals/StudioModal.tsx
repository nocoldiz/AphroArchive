import { useState, useEffect, useRef } from 'preact/hooks';
import { studioModalState } from '../../store';

export const StudioModal = () => {
  const state = studioModalState.value;
  const [studio, setStudio] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.visible) {
      loadStudio();
      loadSuggestions();
      if (inputRef.current) inputRef.current.focus();
    }
  }, [state.visible, state.vidId]);

  const loadStudio = async () => {
    if (state.vidId) {
      const r = await fetch(`/api/videos/${state.vidId}`);
      const data = await r.json();
      setStudio(data.studio || null);
      setQuery(data.studio || '');
    }
  };

  const loadSuggestions = async () => {
    const r = await fetch('/api/studios');
    const data = await r.json();
    setSuggestions(data.map((s: any) => s.name) || []);
  };

  const handleClose = () => {
    studioModalState.value = { visible: false, vidId: null };
    setQuery('');
  };

  const handleSetStudio = async (selectedStudio: string) => {
    selectedStudio = selectedStudio.trim();
    setStudio(selectedStudio);

    if (state.vidId) {
      await fetch(`/api/videos/${state.vidId}/meta`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studio: selectedStudio }),
      });
    }

    handleClose();
  };

  const filteredSuggestions = suggestions.filter(s => {
    if (!query) return true;
    return s.toLowerCase().includes(query.toLowerCase());
  }).slice(0, 20);

  if (!state.visible) return null;

  return (
    <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
      <div className="modal-content" style={{ background: 'var(--bg2)', padding: '24px', borderRadius: '12px', border: '1px solid var(--brd)', width: '400px', maxWidth: '90%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ margin: 0 }}>Select Studio</h3>
          <button onClick={handleClose} style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Input */}
        <div style={{ marginBottom: '15px' }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onInput={(e: any) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && query.trim()) {
                handleSetStudio(query.trim());
              } else if (e.key === 'Escape') {
                handleClose();
              }
            }}
            placeholder="Type studio name..."
            style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px' }}
          />
        </div>

        {/* Suggestions */}
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', maxHeight: '150px', overflowY: 'auto', marginBottom: '20px' }}>
          {filteredSuggestions.map(s => (
            <span
              key={s}
              className="p-tag-picker-item"
              onClick={() => handleSetStudio(s)}
              style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', color: s === studio ? 'var(--ac)' : 'var(--tx)' }}
            >
              {s}
            </span>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button className="btn-cancel" onClick={handleClose} style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx3)', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
          <button className="btn-primary" onClick={() => handleSetStudio(query)} style={{ background: 'var(--ac)', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}>Set Studio</button>
        </div>
      </div>
    </div>
  );
};

if (typeof window !== 'undefined') {
  (window as any).openStudioModal = (vidId: string) => {
    studioModalState.value = { visible: true, vidId };
  };
  (window as any).closeStudioModal = () => {
    studioModalState.value = { visible: false, vidId: null };
  };
}
