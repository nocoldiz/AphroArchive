import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { vaultUnlockModalState, switchProfile, isVaultUnlocked } from '../../store';

export const VaultUnlockModal = () => {
  const state = vaultUnlockModalState.value;
  const { visible, targetProfileAfterUnlock } = state;

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<any>({});
  // Salt mode: 'static' (default, portable) | 'random' (more secure, not portable)
  const [saltMode, setSaltMode] = useState<'static' | 'random'>('static');

  useEffect(() => {
    if (visible) {
      fetchStatus();
    }
  }, [visible]);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/vault/status');
      const data = await res.json();
      setStatus(data);
    } catch (e) {
      console.error('Failed to fetch vault status', e);
    }
  };

  const handleUnlock = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/vault/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Wrong password');
      } else {
        setPassword('');
        isVaultUnlocked.value = true;
        vaultUnlockModalState.value = { visible: false, targetProfileAfterUnlock: null };
        if (targetProfileAfterUnlock) {
          switchProfile(targetProfileAfterUnlock);
        }
      }
    } catch (e: any) {
      setError(e.message || 'Failed to unlock');
    } finally {
      setLoading(false);
    }
  };

  const handleSetup = async () => {
    setError('');
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/vault/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, useRandomSalt: saltMode === 'random' })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to setup');
      } else {
        setPassword('');
        setConfirmPassword('');
        fetchStatus();
      }
    } catch (e: any) {
      setError(e.message || 'Failed to setup');
    } finally {
      setLoading(false);
    }
  };

  if (!visible) return null;

  const isSetup = !status.configured;

  return (
    <div className="modal-overlay on">
      <div className="modal-dialog">
        <div className="modal-header">
          <h2>{isSetup ? 'Create Vault' : 'Vault Locked'}</h2>
        </div>
        <div className="modal-body">
          <p style={{ color: 'var(--tx2)', fontSize: '0.9rem', marginBottom: '24px' }}>
            {isSetup
              ? 'Set a master password to protect your encrypted files.'
              : 'Enter your password to access encrypted files.'}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <input
              type="password"
              value={password}
              onInput={(e: any) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (isSetup ? handleSetup() : handleUnlock())}
              placeholder="Password"
              style={{ padding: '10px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '6px' }}
            />

            {isSetup && (
              <>
                <input
                  type="password"
                  value={confirmPassword}
                  onInput={(e: any) => setConfirmPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSetup()}
                  placeholder="Confirm Password"
                  style={{ padding: '10px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '6px' }}
                />

                {/* ── Salt mode selector ── */}
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--brd)', borderRadius: '8px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--tx2)', marginBottom: '2px' }}>Encryption Salt</div>

                  {/* Static salt option */}
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="saltMode"
                      checked={saltMode === 'static'}
                      onChange={() => setSaltMode('static')}
                      style={{ marginTop: '2px', accentColor: 'var(--ac)', cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--tx)', fontWeight: 'bold' }}>Static salt <span style={{ fontWeight: 'normal', color: 'var(--ac)', fontSize: '0.75rem' }}>— Recommended</span></div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--tx3)', marginTop: '2px' }}>
                        Uses a fixed salt ("AphroArchive"). Any installation with the same password can open this vault.
                        Ideal for backups and moving between machines.
                      </div>
                    </div>
                  </label>

                  {/* Random salt option */}
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="saltMode"
                      checked={saltMode === 'random'}
                      onChange={() => setSaltMode('random')}
                      style={{ marginTop: '2px', accentColor: 'var(--ac)', cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--tx)', fontWeight: 'bold' }}>Random salt <span style={{ fontWeight: 'normal', color: '#f59e0b', fontSize: '0.75rem' }}>⚠ Portability limited</span></div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--tx3)', marginTop: '2px' }}>
                        Generates a unique random salt — slightly stronger against rainbow tables.
                        <strong style={{ color: '#f59e0b' }}> The vault cannot be opened on another installation</strong> without migrating the config file (<code>cache/vault.json</code>).
                      </div>
                    </div>
                  </label>
                </div>
              </>
            )}

            {error && <div style={{ color: '#e84040', fontSize: '0.8rem' }}>{error}</div>}
          </div>
        </div>
        <div className="modal-footer">
          <button
            class="modal-btn modal-btn--primary"
            onClick={isSetup ? handleSetup : handleUnlock}
            disabled={loading}
          >
            {loading ? 'Processing...' : (isSetup ? 'Create Vault' : 'Unlock')}
          </button>
          <button
            class="modal-btn"
            onClick={() => vaultUnlockModalState.value = { visible: false, targetProfileAfterUnlock: null }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
