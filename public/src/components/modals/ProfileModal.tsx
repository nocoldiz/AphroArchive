import { useState, useEffect } from 'preact/hooks';
import { profileModalState, profiles, activeProfile, switchProfile, loadProfiles, reloadAppData, tempProfiles, activeTempProfile, activateTempProfile, exitTempProfile, type TempProfile } from '../../store';

interface Preset {
  id: string;
  name: string;
  hasFolders?: boolean;
  counts?: { folders?: number };
}

export const ProfileModal = () => {
  const state = profileModalState.value;
  const [presets, setPresets] = useState<Preset[]>([]);
  const [newName, setNewName] = useState('');
  const [selectedPreset, setSelectedPreset] = useState('');
  const [createFolders, setCreateFolders] = useState(false);
  const [cloneSource, setCloneSource] = useState('');
  const [loading, setLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (state.visible) {
      fetch('/api/presets')
        .then(r => r.text())
        .then(text => {
          try { setPresets(JSON.parse(text).profiles || []); } catch {}
        })
        .catch(() => {});
    }
  }, [state.visible]);

  const close = () => profileModalState.value = { visible: false };

  const handleCreate = async () => {
    if (!newName.trim()) { alert('Name required'); return; }
    setLoading(true);
    try {
      if (cloneSource) {
        const r = await fetch('/api/profiles/clone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceName: cloneSource, newName: newName.trim() }),
        });
        if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'Clone failed'); }
        await loadProfiles();
        setNewName('');
        setCloneSource('');
      } else {
        const presetMeta = presets.find(p => p.id === selectedPreset);
        const wantFolders = !!(selectedPreset && presetMeta?.hasFolders && createFolders);
        const r = await fetch('/api/profiles/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName.trim(), preset: selectedPreset || undefined, createFolders: wantFolders }),
        });
        if (!r.ok) throw new Error('Server error');
        const d = await r.json();
        activeProfile.value = d.current;
        const w = window as any;
        if (wantFolders && d.foldersCreated && w.toast) w.toast(`Created ${d.foldersCreated} folders from preset`);
        await loadProfiles();
        await reloadAppData();
        close();
      }
    } catch (e: any) {
      alert('Error: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRename = async (oldName: string) => {
    const n = prompt(`Rename "${oldName}" to:`, oldName);
    if (!n || n === oldName) return;
    try {
      const r = await fetch('/api/profiles/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldName, newName: n }),
      });
      if (!r.ok) throw new Error('Server error');
      const d = await r.json();
      activeProfile.value = d.current;
      await loadProfiles();
    } catch (e: any) {
      alert('Error: ' + e.message);
    }
  };

  const handleDelete = async (name: string) => {
    setDeleteConfirm(null);
    try {
      const r = await fetch('/api/profiles/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'Delete failed'); }
      const w = window as any;
      if (w.toast) w.toast(`Profile "${name}" deleted`);
      await loadProfiles();
    } catch (e: any) {
      alert('Error: ' + e.message);
    }
  };

  if (!state.visible) return null;

  const switchableProfiles = profiles.value.filter(p => p !== 'Vault');

  return (
    <div className="modal-overlay on" style={{ zIndex: 30000, display: 'flex', position: 'fixed', inset: 0, alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }}>
      <div className="preset-dialog" style={{ background: 'var(--bg2)', padding: '20px', borderRadius: '12px', width: '420px', maxWidth: '90vw', border: '1px solid var(--brd)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Switch Profile</h2>
          <button type="button" onClick={close} style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', fontSize: '1.5rem' }}>&times;</button>
        </div>

        {/* Profiles List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
          {profiles.value.map(p => {
            const isActive = !activeTempProfile.value && p === activeProfile.value;
            return (
            <div
              key={p}
              onClick={() => { if (!isActive) switchProfile(p); }}
              style={{
                padding: '12px',
                background: isActive ? 'var(--bg3)' : 'var(--bg2)',
                border: isActive ? '1px solid var(--ac)' : '1px solid var(--brd)',
                borderRadius: '6px',
                cursor: isActive ? 'default' : 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontWeight: isActive ? 'bold' : 'normal' }}>{p}</span>
                {isActive && <span style={{ fontSize: '0.8rem', color: 'var(--ac)' }}>Active</span>}
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {p !== 'Vault' && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleRename(p); }}
                    style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: '4px' }}
                    title="Rename"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                  </button>
                )}
                {p !== 'Vault' && p !== activeProfile.value && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirm(p); }}
                    style={{ background: 'none', border: 'none', color: '#e84040', cursor: 'pointer', padding: '4px' }}
                    title="Delete profile"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                  </button>
                )}
              </div>
            </div>
          );
          })}

          {/* Temporary profiles — ephemeral, scoped to one folder/tag, gone on close */}
          {tempProfiles.value.map((tp: TempProfile) => {
            const isActive = activeTempProfile.value?.kind === tp.kind && activeTempProfile.value?.value === tp.value;
            return (
              <div
                key={`${tp.kind}:${tp.value}`}
                onClick={() => { if (!isActive) activateTempProfile(tp); }}
                style={{
                  padding: '12px',
                  background: isActive ? 'var(--bg3)' : 'var(--bg2)',
                  border: isActive ? '1px solid var(--ac)' : '1px dashed var(--brd)',
                  borderRadius: '6px',
                  cursor: isActive ? 'default' : 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontWeight: isActive ? 'bold' : 'normal' }}>{tp.name}</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--tx3)', textTransform: 'uppercase' }}>temp · {tp.kind}</span>
                  {isActive && <span style={{ fontSize: '0.8rem', color: 'var(--ac)' }}>Active</span>}
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    tempProfiles.value = tempProfiles.value.filter(x => !(x.kind === tp.kind && x.value === tp.value));
                    if (isActive) exitTempProfile();
                  }}
                  style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: '4px', fontSize: '1.1rem', lineHeight: 1 }}
                  title="Remove temp profile"
                >&times;</button>
              </div>
            );
          })}

          {activeTempProfile.value && (
            <button
              type="button"
              onClick={() => exitTempProfile()}
              style={{ background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '8px', cursor: 'pointer' }}
            >
              ← Exit temp profile (back to {activeProfile.value})
            </button>
          )}
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
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--tx3)', marginBottom: '4px' }}>Clone from existing profile (optional)</label>
              <select
                value={cloneSource}
                title="Clone source profile"
                onChange={(e: any) => { setCloneSource(e.target.value); if (e.target.value) setSelectedPreset(''); }}
                style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '8px' }}
              >
                <option value="">— none —</option>
                {switchableProfiles.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              {cloneSource && <p style={{ margin: '4px 0 0', fontSize: '0.7rem', color: 'var(--tx3)' }}>Categories, tags, channels and websites will be copied. Videos and links will not.</p>}
            </div>

            {!cloneSource && (
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--tx3)', marginBottom: '4px' }}>Initial Preset (Optional)</label>
                <select
                  value={selectedPreset}
                  title="Initial preset"
                  onChange={(e: any) => setSelectedPreset(e.target.value)}
                  style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '8px' }}
                >
                  <option value="">Empty (Blank)</option>
                  {presets.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {(() => {
                  const meta = presets.find(p => p.id === selectedPreset);
                  if (!meta?.hasFolders) return null;
                  return (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', fontSize: '0.8rem', color: 'var(--tx2)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={createFolders} onChange={(e: any) => setCreateFolders(e.target.checked)} />
                      Create folder structure on disk ({meta.counts?.folders || 0} folders)
                    </label>
                  );
                })()}
              </div>
            )}

            <button
              type="button"
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
                marginTop: '4px'
              }}
            >
              {loading ? 'Creating…' : cloneSource ? `Clone "${cloneSource}" → "${newName || '…'}"` : 'Create & Switch'}
            </button>
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 40000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)' }}>
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '10px', padding: '24px', width: '320px', textAlign: 'center' }}>
            <p style={{ margin: '0 0 16px', fontWeight: 600 }}>Delete profile "{deleteConfirm}"?</p>
            <p style={{ margin: '0 0 20px', fontSize: '0.85rem', color: 'var(--tx3)' }}>This permanently deletes the database. This cannot be undone.</p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button type="button" onClick={() => handleDelete(deleteConfirm)} style={{ background: '#e84040', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px 20px', cursor: 'pointer', fontWeight: 600 }}>Delete</button>
              <button type="button" onClick={() => setDeleteConfirm(null)} style={{ background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '8px 20px', cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
