import { useState, useEffect } from 'preact/hooks';
import { presetPickerState, loadVideos, loadCategories } from '../../store';

interface Preset {
  id: string;
  name: string;
  description?: string;
  counts: {
    categories?: number;
    actors?: number;
    studios?: number;
    websites?: number;
  };
}

export const PresetPicker = () => {
  const state = presetPickerState.value;
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (state.visible) {
      fetch('/api/presets')
        .then(r => r.json())
        .then(data => {
          setPresets(data.profiles || []);
        })
        .catch(e => console.error('Failed to load presets', e));
    }
    setStatus('');
    setSelected(new Set());
  }, [state.visible]);

  const handleApply = async (selection: string[] | 'all' | 'blank', merge: boolean = state.mergeMode) => {
    setStatus('Applying…');
    try {
      if (!state.mergeMode && Array.isArray(selection)) {
        // Create a profile for each selected preset
        for (const p of selection) {
          await fetch('/api/profiles/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: p, preset: p }),
          });
        }
        // Switch to the first selected profile
        if (selection.length > 0) {
          await fetch('/api/profiles/switch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profile: selection[0] }),
          });
        }
      } else {
        const res = await fetch('/api/presets/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selection, merge }),
        });
        if (!res.ok) throw new Error('Server error');
      }

      presetPickerState.value = { ...state, visible: false };
      window.location.reload();
    } catch (e: any) {
      setStatus('Error: ' + e.message);
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
    <div className="modal-overlay on" style={{ zIndex: 30000, display: 'flex', position: 'fixed', inset: 0, alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }}>
      <div className="preset-dialog" style={{ background: 'var(--bg2)', padding: '20px', borderRadius: '8px', width: '500px', maxWidth: '90vw' }}>
        <div className="preset-dialog-hd">
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{state.mergeMode ? 'Change Database Preset' : 'Choose a Database Preset'}</h2>
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
                style={{ alignSelf: 'flex-start', marginTop: '4px' }}
              />
              <div className="preset-card-body" style={{ flex: 1 }}>
                <div className="preset-card-name" style={{ fontWeight: '500', color: 'var(--tx)' }}>{p.name}</div>
                {p.description && <div className="preset-card-desc" style={{ fontSize: '0.75rem', color: 'var(--tx2)', marginTop: '2px' }}>{p.description}</div>}
                <div className="preset-card-counts" style={{ fontSize: '0.7rem', color: 'var(--tx3)', marginTop: '4px', display: 'flex', gap: '8px' }}>
                  {p.counts.categories && <span>{p.counts.categories} categories</span>}
                  {p.counts.actors && <span>{p.counts.actors} actors</span>}
                  {p.counts.studios && <span>{p.counts.studios} studios</span>}
                  {p.counts.websites && <span>{p.counts.websites} websites</span>}
                </div>
              </div>
            </label>
          ))}
          {presets.length === 0 && <p style={{ color: 'var(--tx2)', fontSize: '0.85rem' }}>No presets found.</p>}
        </div>

        <div className="preset-dialog-footer" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--tx3)', flex: 1 }}>{status}</span>
          <button onClick={() => handleApply('blank', false)} style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }}>Start Blank</button>
          <button onClick={() => handleApply('all')} style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }}>Use All</button>
          <button
            onClick={() => handleApply(Array.from(selected))}
            disabled={selected.size === 0}
            style={{ background: selected.size === 0 ? 'var(--bg3)' : 'var(--ac)', border: 'none', color: selected.size === 0 ? 'var(--tx3)' : '#fff', padding: '6px 12px', borderRadius: '4px', cursor: selected.size === 0 ? 'default' : 'pointer' }}
          >
            {state.mergeMode ? 'Apply & Merge' : 'Apply Selected'}
          </button>
        </div>
      </div>
    </div>
  );
};
