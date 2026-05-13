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
        body: JSON.stringify({ password })
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

  return (
    <div className="modal on" style={{ display: 'flex' }}>
      <div className="modal-content" style={{ width: '400px' }}>
        <div className="modal-header">
          <h2>{status.configured ? 'Vault Locked' : 'Create Vault'}</h2>
        </div>
        <div className="modal-body">
          <p style={{ color: 'var(--tx2)', fontSize: '0.9rem', marginBottom: '24px' }}>
            {status.configured
              ? 'Enter your password to access encrypted files.'
              : 'Set a master password. It cannot be changed or recovered.'}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <input
              type="password"
              value={password}
              onInput={(e: any) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (status.configured ? handleUnlock() : handleSetup())}
              placeholder="Password"
              style={{ padding: '10px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '6px' }}
            />

            {!status.configured && (
              <input
                type="password"
                value={confirmPassword}
                onInput={(e: any) => setConfirmPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSetup()}
                placeholder="Confirm Password"
                style={{ padding: '10px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '6px' }}
              />
            )}

            {error && <div style={{ color: '#e84040', fontSize: '0.8rem' }}>{error}</div>}
          </div>
        </div>
        <div className="modal-footer">
          <button
            class="modal-btn modal-btn--primary"
            onClick={status.configured ? handleUnlock : handleSetup}
            disabled={loading}
          >
            {loading ? 'Processing...' : (status.configured ? 'Unlock' : 'Create Vault')}
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
