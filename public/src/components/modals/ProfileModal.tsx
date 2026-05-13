import { useState, useEffect } from 'preact/hooks';
import { profileModalState, profiles, activeProfile, switchProfile } from '../../store';

interface Preset {
  id: string;
  name: string;
}

export const ProfileModal = () => {
  const state = profileModalState.value;
  const [presets, setPresets] = useState<Preset[]>([]);
  const [newName, setNewName] = useState('');
  const [selectedPreset, setSelectedPreset] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (state.visible) {
      fetch('/api/presets')
        .then(r => r.json())
        .then(data => setPresets(data.profiles || []))
        .catch(e => console.error(e));
    }
  }, [state.visible]);

  const handleCreate = async () => {
    if (!newName.trim()) { alert('Name required'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/profiles/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), preset: selectedPreset || undefined }),
      });
      if (!res.ok) throw new Error('Server error');
      
      profileModalState.value = { visible: false };
      window.location.reload();
    } catch (e: any) {
      alert('Error: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRename = async (oldName: string) => {
    const n = prompt(`Rename profile "${oldName}" to:`, oldName);
    if (!n || n === oldName) return;
    
    try {
      const res = await fetch('/api/profiles/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldName, newName: n }),
      });
      if (!res.ok) throw new Error('Server error');
      
      window.location.reload();
    } catch (e: any) {
      alert('Error: ' + e.message);
    }
  };

  if (!state.visible) return null;

  return (
    <div className="modal-overlay on" style={{ zIndex: 30000, display: 'flex', position: 'fixed', inset: 0, alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }}>
      <div className="preset-dialog" style={{ background: 'var(--bg2)', padding: '20px', borderRadius: '12px', width: '400px', maxWidth: '90vw', border: '1px solid var(--brd)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Switch Profile</h2>
          <button onClick={() => profileModalState.value = { visible: false }} style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', fontSize: '1.5rem' }}>&times;</button>
        </div>

        {/* Profiles List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
          {profiles.value.map(p => (
            <div 
              key={p} 
              onClick={() => { if (p !== activeProfile.value) switchProfile(p); }}
              style={{ 
                padding: '12px', 
                background: p === activeProfile.value ? 'var(--bg3)' : 'var(--bg2)', 
                border: p === activeProfile.value ? '1px solid var(--ac)' : '1px solid var(--brd)',
                borderRadius: '6px',
                cursor: p === activeProfile.value ? 'default' : 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontWeight: p === activeProfile.value ? 'bold' : 'normal' }}>{p}</span>
                {p === activeProfile.value && <span style={{ fontSize: '0.8rem', color: 'var(--ac)' }}>Active</span>}
              </div>
              <button 
                onClick={(e) => { e.stopPropagation(); handleRename(p); }} 
                style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: '4px' }}
                title="Rename Profile"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
              </button>
            </div>
          ))}
        </div>

        {/* Add New Profile */}
        <div style={{ borderTop: '1px solid var(--brd)', paddingTop: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '1rem' }}>Add New User / Profile</h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--tx3)', marginBottom: '4px' }}>Profile Name</label>
              <input 
                type="text" 
                value={newName} 
                onInput={(e: any) => setNewName(e.target.value)}
                style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '8px' }}
                placeholder="e.g. My Collection"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--tx3)', marginBottom: '4px' }}>Initial Preset (Optional)</label>
              <select 
                value={selectedPreset} 
                onChange={(e: any) => setSelectedPreset(e.target.value)}
                style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '8px' }}
              >
                <option value="">Empty (Blank)</option>
                {presets.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <button 
              onClick={handleCreate}
              disabled={loading || !newName.trim()}
              style={{ 
                background: (!newName.trim() || loading) ? 'var(--bg3)' : 'var(--ac)', 
                color: (!newName.trim() || loading) ? 'var(--tx3)' : '#fff', 
                border: 'none', 
                padding: '10px', 
                borderRadius: '6px', 
                cursor: (!newName.trim() || loading) ? 'default' : 'pointer',
                fontWeight: 'bold',
                marginTop: '10px'
              }}
            >
              {loading ? 'Creating…' : 'Create & Switch'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
