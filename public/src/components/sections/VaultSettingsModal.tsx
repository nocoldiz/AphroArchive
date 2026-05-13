import { useState, useEffect, useRef } from 'preact/hooks';

const VAULT_PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.heic', '.heif']);
const VAULT_VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.flv', '.wmv']);

interface Props {
  files: any[];
  onClose: () => void;
}

export const VaultSettingsModal = ({ files, onClose }: Props) => {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selfDestruct, setSelfDestruct] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiProgress, setAiProgress] = useState('');
  const [abortAi, setAbortAi] = useState(false);
  const abortAiRef = useRef(false);

  useEffect(() => {
    abortAiRef.current = abortAi;
  }, [abortAi]);

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

  const startVaultAiTitles = async () => {
    const pool = files.filter(f => {
      const ext = (f.ext || '').toLowerCase();
      return VAULT_PHOTO_EXTS.has(ext) || VAULT_VIDEO_EXTS.has(ext);
    });

    if (!pool.length) {
      const w = window as any;
      if (w.toast) w.toast('No media files in vault to process');
      return;
    }

    setAiLoading(true);
    setAbortAi(false);
    abortAiRef.current = false;
    setAiProgress(`Starting…`);

    let count = 0;
    for (const f of pool) {
      if (abortAiRef.current) {
        setAiProgress(`Aborted`);
        break;
      }
      count++;
      setAiProgress(`Processing ${count} / ${pool.length}`);

      const source = VAULT_VIDEO_EXTS.has((f.ext || '').toLowerCase()) ? 'vault-video' : 'vault';
      try {
        await fetch('/api/vision/describe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source, id: f.id })
        });
      } catch (e) {
        console.error('Failed to describe file', f.id, e);
      }
    }

    setAiLoading(false);
    setAiProgress(prev => prev + ' - Finished');
    const w = window as any;
    if (w.toast) w.toast('AI Titles generation complete!');
  };

  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const doVaultDeleteVault = async () => {
    if (deleteConfirmText !== 'DELETE') return;
    
    setLoading(true);
    try {
      const r = await fetch('/api/vault/delete-vault', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error || 'Failed to delete vault');
      } else {
        const w = window as any;
        if (w.toast) w.toast('Vault deleted permanently');
        onClose();
        window.location.reload();
      }
    } catch (e: any) {
      setError(e.message || 'Failed to delete vault');
    } finally {
      setLoading(false);
    }
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
          {/* AI Titles */}
          <div>
            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '8px', fontWeight: 'bold' }}>AI Titles</label>
            <p style={{ fontSize: '0.8rem', color: 'var(--tx3)', marginBottom: '10px' }}>
              Generate a short subject title for every image and video using the configured AI Vision provider.
            </p>
            {aiLoading || aiProgress ? (
              <div style={{ fontSize: '0.85rem', color: 'var(--tx2)', marginBottom: '8px', padding: '6px 10px', background: 'var(--bg3)', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{aiProgress}</span>
                {aiLoading && (
                  <button onClick={() => setAbortAi(true)} style={{ background: 'none', border: 'none', color: 'var(--tx2)', cursor: 'pointer', fontSize: '0.8rem' }}>Stop</button>
                )}
              </div>
            ) : null}
            <button
              onClick={startVaultAiTitles}
              disabled={aiLoading}
              style={{ background: 'rgba(99,102,241,.2)', border: '1px solid rgba(99,102,241,.4)', color: 'rgba(255,255,255,.8)', padding: '10px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', width: '100%' }}
            >
              {aiLoading ? 'Processing...' : 'Generate AI Titles for All Media…'}
            </button>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--brd)', margin: '8px 0' }} />

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

          <hr style={{ border: 'none', borderTop: '1px solid var(--brd)', margin: '8px 0' }} />

          {/* Danger Zone */}
          <div>
            <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#e84040', marginBottom: '8px' }}>Danger Zone</div>
            <p style={{ fontSize: '0.8rem', color: 'var(--tx3)', marginBottom: '12px' }}>
              Permanently destroy the vault and <strong style={{ color: 'var(--tx2)' }}>all encrypted files</strong>. Files are cryptographically overwritten before deletion. This cannot be undone.
            </p>
            
            {showDeleteConfirm ? (
              <div style={{ background: 'rgba(232,64,64,0.05)', border: '1px solid rgba(232,64,64,0.2)', borderRadius: '8px', padding: '12px', marginBottom: '10px' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--tx2)', marginBottom: '8px' }}>Type <strong style={{ color: '#e84040', fontFamily: 'monospace' }}>DELETE</strong> to confirm:</div>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onInput={(e: any) => setDeleteConfirmText(e.target.value)}
                  placeholder="DELETE"
                  autocomplete="off"
                  spellcheck={false}
                  style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', padding: '8px', borderRadius: '4px', fontSize: '0.85rem', marginBottom: '10px' }}
                />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={doVaultDeleteVault}
                    disabled={deleteConfirmText !== 'DELETE' || loading}
                    style={{ flex: 1, background: '#e84040', border: 'none', color: '#fff', padding: '8px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 'bold', opacity: deleteConfirmText !== 'DELETE' ? 0.5 : 1 }}
                  >
                    Permanently Delete Vault
                  </button>
                  <button
                    onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); }}
                    style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                style={{ background: 'rgba(232,64,64,0.1)', border: '1px solid #e84040', color: '#e84040', padding: '10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 'bold', width: '100%' }}
              >
                Delete Vault…
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
