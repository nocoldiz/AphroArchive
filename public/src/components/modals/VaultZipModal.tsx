import { useState, useEffect, useRef } from 'preact/hooks';
import { vaultZipModalState } from '../../store';
import { useEscape } from './useEscape';

export const VaultZipModal = () => {
  const state = vaultZipModalState.value;
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!state.visible) return;
    setPassword('');
    setError('');
    setLoading(false);
    inputRef.current?.focus();
  }, [state.visible]);

  const handleClose = () => {
    vaultZipModalState.value = { visible: false, ids: [] };
    setPassword('');
    setError('');
    setLoading(false);
  };

  // Closing mid-request would leave the download running with no feedback.
  const dismiss = () => { if (!loading) handleClose(); };
  useEscape(state.visible, dismiss);

  const handleDownload = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/vault/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: state.ids, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Download failed');
        setLoading(false);
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vault-export-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoking synchronously can cancel the download in some browsers.
      setTimeout(() => window.URL.revokeObjectURL(url), 10000);
      handleClose();
    } catch (e: any) {
      setError('Download failed: ' + (e?.message || 'network error'));
      setLoading(false);
    }
  };

  if (!state.visible) return null;

  return (
    <div className="modal-overlay on" style={{ zIndex: 1000 }} onClick={(e: any) => e.target === e.currentTarget && dismiss()}>
      <div className="modal-dialog" style={{ maxWidth: '360px' }}>
        <div className="modal-header">
          <h2>Download as ZIP</h2>
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--tx3)', marginBottom: '15px' }}>{state.ids.length} files selected</div>

        <label className="ui-label">
          Password <span style={{ opacity: 0.5 }}>(leave blank for no encryption)</span>
        </label>
        <input
          ref={inputRef}
          type="password"
          value={password}
          onInput={(e: any) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleDownload(); }}
          placeholder="Enter password..."
        />
        {error && <div className="modal-error" style={{ display: 'block' }}>{error}</div>}

        <div className="modal-footer">
          <button className="modal-btn" onClick={dismiss} disabled={loading}>Cancel</button>
          <button className="modal-btn modal-btn--primary" onClick={handleDownload} disabled={loading}>
            {loading ? 'Generating...' : 'Download ZIP'}
          </button>
        </div>
      </div>
    </div>
  );
};

if (typeof window !== 'undefined') {
  (window as any).openVaultZipModal = (ids: string[]) => {
    vaultZipModalState.value = { visible: true, ids };
  };
  (window as any).closeVaultZipModal = () => {
    vaultZipModalState.value = { visible: false, ids: [] };
  };
}
