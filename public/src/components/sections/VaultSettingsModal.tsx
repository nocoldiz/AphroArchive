import { useState, useEffect } from 'preact/hooks';

interface Props {
  onClose: () => void;
}

export const VaultSettingsModal = ({ onClose }: Props) => {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selfDestruct, setSelfDestruct] = useState(false);

  useEffect(() => {
    fetch('/api/settings/prefs')
      .then(r => r.json())
      .then(prefs => {
        setSelfDestruct(!!prefs.vaultSelfDestruct);
      })
      .catch(() => {});
  }, []);

  const handleToggleSelfDestruct = async (enabled: boolean) => {
    setSelfDestruct(enabled);
    await fetch('/api/settings/prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vaultSelfDestruct: enabled })
    });
    const w = window as any;
    if (w.toast) w.toast(enabled ? 'Self-destruct enabled' : 'Self-destruct disabled');
  };

  const handleChangePw = async () => {
    setError('');
    if (!oldPw || !newPw || !newPw2) { setError('All fields required'); return; }
    if (newPw !== newPw2) { setError('New passwords do not match'); return; }
    if (newPw.length < 6) { setError('New password must be at least 6 chars'); return; }

    setLoading(true);
    try {
      const r = await fetch('/api/vault/change-pw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPw, newPw })
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error || 'Failed to change password');
      } else {
        const w = window as any;
        if (w.toast) w.toast('Password changed successfully!');
        onClose();
      }
    } catch (e: any) {
      setError(e.message || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
      <div style={{ background: 'var(--bg2)', padding: '32px', borderRadius: '12px', width: '400px', border: '1px solid var(--brd)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ margin: 0 }}>Vault Settings</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--tx2)', cursor: 'pointer', fontSize: '1.5rem' }}>✕</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '8px' }}>Change Password</label>
            <input
              type="password"
              placeholder="Old Password"
              value={oldPw}
              onInput={(e: any) => setOldPw(e.target.value)}
              style={{ padding: '10px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '6px', width: '100%', marginBottom: '8px' }}
            />
            <input
              type="password"
              placeholder="New Password"
              value={newPw}
              onInput={(e: any) => setNewPw(e.target.value)}
              style={{ padding: '10px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '6px', width: '100%', marginBottom: '8px' }}
            />
            <input
              type="password"
              placeholder="Confirm New Password"
              value={newPw2}
              onInput={(e: any) => setNewPw2(e.target.value)}
              style={{ padding: '10px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '6px', width: '100%' }}
            />
            {error && <div style={{ color: '#e84040', fontSize: '0.8rem', marginTop: '8px' }}>{error}</div>}
            <button
              onClick={handleChangePw}
              disabled={loading}
              style={{ background: 'var(--ac)', border: 'none', color: '#fff', padding: '10px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', marginTop: '12px', width: '100%' }}
            >
              {loading ? 'Changing...' : 'Change Password'}
            </button>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--brd)', margin: '8px 0' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 'bold' }}>Self-Destruct</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--tx3)' }}>Delete vault data on 3 failed attempts</div>
            </div>
            <input
              type="checkbox"
              checked={selfDestruct}
              onChange={(e: any) => handleToggleSelfDestruct(e.target.checked)}
              style={{ cursor: 'pointer', width: '20px', height: '20px' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
