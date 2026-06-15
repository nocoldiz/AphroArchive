import { useState, useEffect, useRef } from 'preact/hooks';
import { channelModalState } from '../../store';

export const ChannelModal = () => {
  const state = channelModalState.value;
  const [channel, setChannel] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.visible) {
      loadChannel();
      loadSuggestions();
      if (inputRef.current) inputRef.current.focus();
    }
  }, [state.visible, state.vidId]);

  const loadChannel = async () => {
    if (state.vidId) {
      const r = await fetch(`/api/videos/${state.vidId}`);
      const data = await r.json();
      setChannel(data.channel || null);
      setQuery(data.channel || '');
    }
  };

  const loadSuggestions = async () => {
    const r = await fetch('/api/channels');
    const data = await r.json();
    setSuggestions(data.map((s: any) => s.name) || []);
  };

  const handleClose = () => {
    channelModalState.value = { visible: false, vidId: null };
    setQuery('');
  };

  const handleSetChannel = async (selectedChannel: string) => {
    selectedChannel = selectedChannel.trim();
    setChannel(selectedChannel);

    if (state.vidId) {
      await fetch(`/api/videos/${state.vidId}/meta`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: selectedChannel }),
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
          <h3 style={{ margin: 0 }}>Select Channel</h3>
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
                handleSetChannel(query.trim());
              } else if (e.key === 'Escape') {
                handleClose();
              }
            }}
            placeholder="Type channel name..."
            style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px' }}
          />
        </div>

        {/* Suggestions */}
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', maxHeight: '150px', overflowY: 'auto', marginBottom: '20px' }}>
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

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button className="btn-cancel" onClick={handleClose} style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx3)', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
          <button className="btn-primary" onClick={() => handleSetChannel(query)} style={{ background: 'var(--ac)', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}>Set Channel</button>
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
