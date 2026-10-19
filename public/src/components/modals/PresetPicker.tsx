import { useState, useEffect } from 'preact/hooks';
import { presetPickerState } from '../../store';
import { useEscape } from './useEscape';

interface Preset {
  id: string;
  name: string;
  description?: string;
  counts: {
    categories?: number;
    actors?: number;
    channels?: number;
    websites?: number;
    links?: number;
  };
}

export const PresetPicker = () => {
  const state = presetPickerState.value;
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importLinks, setImportLinks] = useState(true);
  const [linkCount, setLinkCount] = useState(0); // 0 = import all
  const [status, setStatus] = useState('');
  const [applying, setApplying] = useState(false);
  const [currentTheme, setCurrentTheme] = useState(localStorage.getItem('theme') || 'orange');

  useEffect(() => {
    if (!state.visible) return;
    setLoading(true);
    setFetchError('');
    setStatus('');
    setApplying(false);
    setSelected(new Set());
    setImportLinks(true);
    setLinkCount(0);
    fetch('/api/presets')
      .then(r => {
        if (!r.ok) throw new Error(`Server error ${r.status}`);
        return r.json();
      })
      .then(data => {
        setPresets(data.profiles || []);
      })
      .catch(e => {
        console.error('Failed to load presets', e);
        setFetchError('Could not load presets. Is the server running?');
      })
      .finally(() => setLoading(false));
  }, [state.visible]);

  // Manual "change preset" (merge mode) can be dismissed; the first-run picker
  // stays modal and is left via Start Blank / Use All / Apply.
  const canDismiss = state.mergeMode && !applying;
  const close = () => { presetPickerState.value = { ...presetPickerState.value, visible: false }; };
  useEscape(state.visible, () => { if (canDismiss) close(); });

  const handleApply = async (selection: string[] | 'all' | 'blank', merge: boolean = state.mergeMode) => {
    if (applying) return;
    setApplying(true);
    setStatus('Applying…');
    try {
      const res = await fetch('/api/presets/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selection, merge, importLinks, linkCount: linkCount > 0 ? linkCount : -1 }),
      });
      if (!res.ok) throw new Error('Server error');

      presetPickerState.value = { ...state, visible: false };
      window.location.reload();
    } catch (e: any) {
      setStatus('Error: ' + e.message);
      setApplying(false);
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  if (!state.visible) return null;

  return (
    <div className="modal-overlay on" style={{ zIndex: 30000 }} onClick={(e: any) => e.target === e.currentTarget && canDismiss && close()}>
      <div className="modal-dialog" style={{ maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="modal-header">
          <h2>{state.mergeMode ? 'Change Database Preset' : 'Choose a Database Preset'}</h2>
          <p style={{ margin: '6px 0 0', fontSize: '0.83rem', color: 'var(--tx2)' }}>
            {state.mergeMode
              ? 'Pick presets to apply. Your custom entries will be preserved and merged.'
              : 'Pick one or more presets to populate your initial database, or start blank.'}
          </p>
        </div>

        <div className="preset-picker-list" style={{ margin: '16px 0', maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {presets.map(p => (
            <label key={p.id} className="preset-card" style={{ display: 'flex', gap: '8px', padding: '12px', background: 'var(--bg3)', borderRadius: '6px', cursor: 'pointer', border: selected.has(p.id) ? '1px solid var(--ac)' : '1px solid var(--brd)' }}>
              <input
                type="checkbox"
                checked={selected.has(p.id)}
                onChange={() => toggleSelect(p.id)}
                style={{ width: 'auto', padding: 0, flexShrink: 0, alignSelf: 'flex-start', marginTop: '4px' }}
              />
              <div className="preset-card-body" style={{ flex: 1 }}>
                <div className="preset-card-name" style={{ fontWeight: '500', color: 'var(--tx)' }}>{p.name}</div>
                {p.description && <div className="preset-card-desc" style={{ fontSize: '0.75rem', color: 'var(--tx2)', marginTop: '2px' }}>{p.description}</div>}
                <div className="preset-card-counts" style={{ fontSize: '0.7rem', color: 'var(--tx3)', marginTop: '4px', display: 'flex', gap: '8px' }}>
                  {p.counts.categories && <span>{p.counts.categories} folders</span>}
                  {p.counts.actors && <span>{p.counts.actors} actors</span>}
                  {p.counts.channels && <span>{p.counts.channels} channels</span>}
                  {p.counts.websites && <span>{p.counts.websites} websites</span>}
                  {p.counts.links && <span>{p.counts.links} links</span>}
                </div>
              </div>
            </label>
          ))}
          {loading && <p style={{ color: 'var(--tx2)', fontSize: '0.85rem' }}>Loading…</p>}
          {!loading && fetchError && <p style={{ color: 'var(--ac)', fontSize: '0.85rem' }}>{fetchError}</p>}
          {!loading && !fetchError && presets.length === 0 && <p style={{ color: 'var(--tx2)', fontSize: '0.85rem' }}>No presets found.</p>}
        </div>

        <div className="theme-selection" style={{ margin: '16px 0', borderTop: '1px solid var(--brd)', paddingTop: '12px' }}>
          <label style={{ fontSize: '0.85rem', color: 'var(--tx2)', display: 'block', marginBottom: '8px' }}>Select Theme:</label>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {['orange', 'blue', 'deepblue', 'light', 'xp', 'artdeco', 'ascii'].map(t => (
              <button
                key={t}
                onClick={() => {
                  (window as any).applyTheme(t);
                  setCurrentTheme(t);
                }}
                style={{ 
                  background: 'var(--bg3)', 
                  border: '1px solid var(--brd)', 
                  color: 'var(--tx)', 
                  padding: '4px 8px', 
                  borderRadius: '4px', 
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  borderColor: currentTheme === t ? 'var(--ac)' : 'var(--brd)',
                  fontWeight: currentTheme === t ? 'bold' : 'normal'
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {(() => {
          const totalLinks = Array.from(selected).reduce((n, id) => n + (presets.find(p => p.id === id)?.counts.links || 0), 0);
          if (totalLinks === 0) return null;
          return (
            <div style={{ margin: '0 0 12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: 'var(--tx2)', cursor: 'pointer' }}>
                <input type="checkbox" checked={importLinks} onChange={(e: any) => setImportLinks(e.target.checked)} style={{ width: 'auto', padding: 0 }} />
                Import curated bookmark links from selected presets
              </label>
              {importLinks && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', paddingLeft: '24px', fontSize: '0.8rem', color: 'var(--tx3)' }}>
                  <span>How many?</span>
                  <input
                    type="number" min={0} max={totalLinks} value={linkCount}
                    title="Number of links to import (0 = all)" placeholder="0"
                    onInput={(e: any) => setLinkCount(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    style={{ width: '70px', padding: '4px 6px' }}
                  />
                  <span>{linkCount > 0 ? `of ${totalLinks}` : `all ${totalLinks}`}</span>
                </div>
              )}
            </div>
          );
        })()}

        <div className="preset-dialog-footer" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--tx3)', flex: 1 }}>{status}</span>
          {state.mergeMode && <button className="modal-btn modal-btn--sm" onClick={close} disabled={applying}>Cancel</button>}
          <button className="modal-btn modal-btn--sm" onClick={() => handleApply('blank', false)} disabled={applying}>Start Blank</button>
          <button className="modal-btn modal-btn--sm" onClick={() => handleApply('all')} disabled={applying}>Use All</button>
          <button
            className="modal-btn modal-btn--sm modal-btn--primary"
            onClick={() => handleApply(Array.from(selected))}
            disabled={selected.size === 0 || applying}
          >
            {state.mergeMode ? 'Apply & Merge' : 'Apply Selected'}
          </button>
        </div>
      </div>
    </div>
  );
};
