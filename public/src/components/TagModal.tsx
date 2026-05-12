import { useState, useEffect, useRef } from 'preact/hooks';
import { tagModalState } from '../store';

export const TagModal = () => {
  const state = tagModalState.value;
  const [tags, setTags] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.visible) {
      loadTags();
      loadSuggestions();
      if (inputRef.current) inputRef.current.focus();
    }
  }, [state.visible, state.vidId, state.bmUrl]);

  const loadTags = async () => {
    if (state.vidId) {
      const r = await fetch(`/api/videos/${state.vidId}/tags`);
      const data = await r.json();
      setTags(data.tags || []);
    } else if (state.bmUrl) {
      // Handle bookmark tags if needed, or assume empty for now
      setTags([]);
    }
  };

  const loadSuggestions = async () => {
    const r = await fetch('/api/tag-suggestions');
    const data = await r.json();
    setSuggestions(data || []);
  };

  const handleClose = () => {
    tagModalState.value = { visible: false, vidId: null, bmUrl: null };
    setQuery('');
  };

  const handleAddTag = async (tag: string) => {
    tag = tag.trim();
    if (!tag || tags.some(t => t.toLowerCase() === tag.toLowerCase())) return;
    
    const newTags = [...tags, tag];
    setTags(newTags);
    
    if (state.vidId) {
      await fetch(`/api/videos/${state.vidId}/meta`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: newTags }),
      });
    }
    
    setQuery('');
  };

  const handleRemoveTag = async (tag: string) => {
    const newTags = tags.filter(t => t.toLowerCase() !== tag.toLowerCase());
    setTags(newTags);
    
    if (state.vidId) {
      await fetch(`/api/videos/${state.vidId}/meta`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: newTags }),
      });
    }
  };

  const filteredSuggestions = suggestions.filter(s => {
    if (tags.some(t => t.toLowerCase() === s.toLowerCase())) return false;
    if (!query) return true;
    return s.toLowerCase().includes(query.toLowerCase());
  }).slice(0, 20);

  if (!state.visible) return null;

  return (
    <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
      <div className="modal-content" style={{ background: 'var(--bg2)', padding: '24px', borderRadius: '12px', border: '1px solid var(--brd)', width: '400px', maxWidth: '90%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ margin: 0 }}>Manage Tags</h3>
          <button onClick={handleClose} style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Current Tags */}
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '15px' }}>
          {tags.map(t => (
            <span key={t} className="p-tag" style={{ background: 'var(--bg3)', padding: '4px 8px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '5px' }}>
              {t}
              <button onClick={() => handleRemoveTag(t)} style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </span>
          ))}
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
                handleAddTag(query.trim());
              } else if (e.key === 'Escape') {
                handleClose();
              }
            }}
            placeholder="Add or search tags..."
            style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px' }}
          />
        </div>

        {/* Suggestions */}
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', maxHeight: '150px', overflowY: 'auto' }}>
          {filteredSuggestions.map(s => (
            <span 
              key={s} 
              className="p-tag-picker-item" 
              onClick={() => handleAddTag(s)}
              style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}
            >
              {s}
            </span>
          ))}
          {query && !suggestions.some(s => s.toLowerCase() === query.toLowerCase()) && (
            <span 
              className="p-tag-picker-item" 
              onClick={() => handleAddTag(query)}
              style={{ background: 'var(--ac)', color: '#fff', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}
            >
              Add "{query}"
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

if (typeof window !== 'undefined') {
  (window as any).openTagModal = (vidId: string) => {
    tagModalState.value = { visible: true, vidId, bmUrl: null };
  };
  (window as any).closeTagModal = () => {
    tagModalState.value = { visible: false, vidId: null, bmUrl: null };
  };
}
