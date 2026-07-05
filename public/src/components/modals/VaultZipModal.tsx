import { useState, useEffect, useRef } from 'preact/hooks';
import { vaultZipModalState } from '../../store';

export const VaultZipModal = () => {
  const state = vaultZipModalState.value;
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.visible) {
      if (inputRef.current) inputRef.current.focus();
    }
  }, [state.visible]);

  const handleClose = () => {
    vaultZipModalState.value = { visible: false, ids: [] };
    setPassword('');
    setLoading(false);
  };

  const handleDownload = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/vault/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: state.ids, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Download failed');
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
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      handleClose();
    } catch (e: any) {
      alert('Download failed: ' + e.message);
      setLoading(false);
    }
  };

  if (!state.visible) return null;

  return (
    <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
      <div className="modal-content" style={{ background: 'var(--bg2)', padding: '24px', borderRadius: '12px', border: '1px solid var(--brd)', width: '360px', maxWidth: '90%' }}>
        <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--tx)', marginBottom: '10px' }}>Download as ZIP</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--tx3)', marginBottom: '15px' }}>{state.ids.length} files selected</div>
        
        <label style={{ fontSize: '0.82rem', color: 'var(--tx2)', display: 'block', marginBottom: '5px' }}>
          Password <span style={{ opacity: 0.5 }}>(leave blank for no encryption)</span>
        </label>
        <input
          ref={inputRef}
          type="password"
          value={password}
          onInput={(e: any) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !loading) {
              handleDownload();
            } else if (e.key === 'Escape') {
              handleClose();
            }
          }}
          placeholder="Enter password..."
          style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '10px', borderRadius: '6px', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box', marginBottom: '20px' }}
        />

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={handleClose} style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx3)', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
          <button
            onClick={handleDownload}
            disabled={loading}
            style={{ background: 'var(--ac)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', opacity: loading ? 0.7 : 1 }}
          >
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
