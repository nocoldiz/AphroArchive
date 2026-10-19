import { useState, useEffect, useRef } from 'preact/hooks';
import { actorModalState } from '../../store';
import { useEscape } from './useEscape';

export const ActorModal = () => {
  const state = actorModalState.value;
  const [actors, setActors] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!state.visible) return;
    // Reset per-open state so the previous video's actors never flash, and
    // drop late responses when the modal is reopened for another video.
    let stale = false;
    setActors([]);
    setQuery('');
    if (state.vidId) {
      fetch(`/api/videos/${state.vidId}`)
        .then(r => r.json())
        .then(data => { if (!stale) setActors(data.actors || []); })
        .catch(() => {});
    }
    fetch('/api/actors')
      .then(r => r.json())
      .then(data => { if (!stale) setSuggestions(Array.isArray(data) ? data.map((a: any) => a.name) : []); })
      .catch(() => {});
    inputRef.current?.focus();
    return () => { stale = true; };
  }, [state.visible, state.vidId]);

  const handleClose = () => {
    actorModalState.value = { visible: false, vidId: null };
    setQuery('');
  };

  useEscape(state.visible, handleClose);

  const saveActors = async (newActors: string[]) => {
    setActors(newActors);
    if (!state.vidId) return;
    try {
      const r = await fetch(`/api/videos/${state.vidId}/meta`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actors: newActors }),
      });
      if (!r.ok) throw new Error();
    } catch {
      (window as any).toastError?.('Failed to save actors');
    }
  };

  const handleAddActor = async (actor: string) => {
    actor = actor.trim();
    if (!actor || actors.some(a => a.toLowerCase() === actor.toLowerCase())) return;
    setQuery('');
    await saveActors([...actors, actor]);
  };

  const handleRemoveActor = (actor: string) =>
    saveActors(actors.filter(a => a.toLowerCase() !== actor.toLowerCase()));

  const filteredSuggestions = suggestions.filter(s => {
    if (actors.some(a => a.toLowerCase() === s.toLowerCase())) return false;
    if (!query) return true;
    return s.toLowerCase().includes(query.toLowerCase());
  }).slice(0, 20);

  if (!state.visible) return null;

  return (
    <div className="modal-overlay on" style={{ zIndex: 1000 }} onClick={(e: any) => e.target === e.currentTarget && handleClose()}>
      <div className="modal-dialog" style={{ maxWidth: '400px' }}>
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Manage Actors</h2>
          <button className="ui-btn ui-btn--ghost ui-btn--icon" onClick={handleClose} aria-label="Close" title="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Current Actors */}
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '15px' }}>
          {actors.map(a => (
            <span key={a} className="p-tag" style={{ background: 'var(--bg3)', padding: '4px 8px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '5px' }}>
              {a}
              <button onClick={() => handleRemoveActor(a)} aria-label={`Remove ${a}`} style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
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
            onKeyDown={(e) => { if (e.key === 'Enter' && query.trim()) handleAddActor(query.trim()); }}
            placeholder="Add or search actors..."
          />
        </div>

        {/* Suggestions */}
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', maxHeight: '150px', overflowY: 'auto' }}>
          {filteredSuggestions.map(s => (
            <span
              key={s}
              className="p-tag-picker-item"
              onClick={() => handleAddActor(s)}
              style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}
            >
              {s}
            </span>
          ))}
          {query.trim() && !suggestions.some(s => s.toLowerCase() === query.trim().toLowerCase()) && (
            <span
              className="p-tag-picker-item"
              onClick={() => handleAddActor(query)}
              style={{ background: 'var(--ac)', color: '#fff', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}
            >
              Add "{query.trim()}"
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

if (typeof window !== 'undefined') {
  (window as any).openActorModal = (vidId: string) => {
    actorModalState.value = { visible: true, vidId };
  };
  (window as any).closeActorModal = () => {
    actorModalState.value = { visible: false, vidId: null };
  };
}
