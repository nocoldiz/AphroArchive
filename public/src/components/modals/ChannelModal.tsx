import { useState, useEffect, useRef } from 'preact/hooks';
import { channelModalState } from '../../store';
import { useEscape } from './useEscape';

export const ChannelModal = () => {
  const state = channelModalState.value;
  const [channel, setChannel] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!state.visible) return;
    // Reset per-open state and ignore late responses for a previous video.
    let stale = false;
    setChannel(null);
    setQuery('');
    setSaving(false);
    if (state.vidId) {
      fetch(`/api/videos/${state.vidId}`)
        .then(r => r.json())
        .then(data => {
          if (stale) return;
          setChannel(data.channel || null);
          setQuery(data.channel || '');
        })
        .catch(() => {});
    }
    fetch('/api/channels')
      .then(r => r.json())
      .then(data => { if (!stale) setSuggestions(Array.isArray(data) ? data.map((s: any) => s.name) : []); })
      .catch(() => {});
    inputRef.current?.focus();
    return () => { stale = true; };
  }, [state.visible, state.vidId]);

  const handleClose = () => {
    channelModalState.value = { visible: false, vidId: null };
    setQuery('');
  };

  useEscape(state.visible, handleClose);

  const handleSetChannel = async (selectedChannel: string) => {
    if (saving) return;
    selectedChannel = selectedChannel.trim();
    setChannel(selectedChannel);

    if (state.vidId) {
      setSaving(true);
      try {
        const r = await fetch(`/api/videos/${state.vidId}/meta`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel: selectedChannel }),
        });
        if (!r.ok) throw new Error();
      } catch {
        setSaving(false);
        (window as any).toastError?.('Failed to set channel');
        return;
      }
      setSaving(false);
    }

    handleClose();
  };

  const filteredSuggestions = suggestions.filter(s => {
    if (!query) return true;
    return s.toLowerCase().includes(query.toLowerCase());
  }).slice(0, 20);

  if (!state.visible) return null;

  return (
    <div className="modal-overlay on" style={{ zIndex: 1000 }} onClick={(e: any) => e.target === e.currentTarget && handleClose()}>
      <div className="modal-dialog" style={{ maxWidth: '400px' }}>
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Select Channel</h2>
          <button className="ui-btn ui-btn--ghost ui-btn--icon" onClick={handleClose} aria-label="Close" title="Close">
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
            onKeyDown={(e) => { if (e.key === 'Enter' && query.trim()) handleSetChannel(query.trim()); }}
            placeholder="Type channel name..."
          />
        </div>

        {/* Suggestions */}
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', maxHeight: '150px', overflowY: 'auto' }}>
          {filteredSuggestions.map(s => (
            <span
              key={s}
              className="p-tag-picker-item"
              onClick={() => handleSetChannel(s)}
              style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', color: s === channel ? 'var(--ac)' : 'var(--tx)' }}
            >
              {s}
            </span>
          ))}
        </div>

        <div className="modal-footer">
          <button className="modal-btn" onClick={handleClose}>Cancel</button>
          <button className="modal-btn modal-btn--primary" onClick={() => handleSetChannel(query)} disabled={saving}>Set Channel</button>
        </div>
      </div>
    </div>
  );
};

if (typeof window !== 'undefined') {
  (window as any).openChannelModal = (vidId: string) => {
    channelModalState.value = { visible: true, vidId };
  };
  (window as any).closeChannelModal = () => {
    channelModalState.value = { visible: false, vidId: null };
  };
}
