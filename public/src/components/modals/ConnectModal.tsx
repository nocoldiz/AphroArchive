import { useState, useEffect, useRef } from 'preact/hooks';
import { ensureQRCode } from '../../utils';

interface Props {
  onClose: () => void;
}

export const ConnectModal = ({ onClose }: Props) => {
  const [networkEnabled, setNetworkEnabled] = useState(false);
  const [remoteMode, setRemoteMode] = useState(false);
  const [localUrl, setLocalUrl] = useState('');
  const [verify, setVerify] = useState<{ ok?: boolean; error?: string; checking?: boolean }>({});
  const qrRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Fetch prefs
    fetch('/api/settings/prefs')
      .then(r => r.json())
      .then(prefs => {
        setNetworkEnabled(!!prefs.networkEnabled);
      })
      .catch(() => {});

    // Fetch local IP
    fetch('/api/local-ip')
      .then(r => r.json())
      .then(data => {
        if (data.url) setLocalUrl(data.url);
      })
      .catch(() => {});

    // Read remote mode from localStorage
    setRemoteMode(localStorage.getItem('remoteMode') === 'true');
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    (async () => {
      if (!localUrl || !qrRef.current) return;
      try {
        await ensureQRCode();
        const QR = (window as any).QRCode;
        if (!QR) return;
        qrRef.current.innerHTML = '';
        const canvas = document.createElement('canvas');
        canvas.style.borderRadius = '8px';
        canvas.style.display = 'block';
        canvas.style.margin = '0 auto';
        qrRef.current.appendChild(canvas);
        await QR.toCanvas(canvas, localUrl, { width: 160, margin: 1, color: { dark: '#000000', light: '#ffffff' } });
      } catch (e) {
        console.warn('QR code generation failed:', e);
      }
    })();
  }, [localUrl, networkEnabled]);

  const toggleNetworkAccess = async () => {
    const next = !networkEnabled;
    setNetworkEnabled(next);
    await fetch('/api/settings/prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ networkEnabled: next })
    });
    const w = window as any;
    if (w.toast) w.toast(next ? 'Network access enabled' : 'Network access disabled');
  };

  const toggleRemoteMode = () => {
    const next = !remoteMode;
    setRemoteMode(next);
    localStorage.setItem('remoteMode', next.toString());
    
    // Trigger storage event or direct call to update listener
    window.dispatchEvent(new Event('storage'));
    
    const w = window as any;
    if (w.toast) w.toast(next ? 'Remote Mode enabled' : 'Remote Mode disabled');
  };

  const doVerify = async (url: string) => {
    if (!url) return;
    setVerify({ checking: true });
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(url + '/api/ping', { signal: controller.signal });
      clearTimeout(tid);
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data && data.ok) { setVerify({ ok: true }); return; }
      }
      if (res.status === 403) {
        const txt = await res.text().catch(() => '');
        const msg = txt.includes('Network access is disabled') ? 'Network access disabled' : 'Forbidden';
        setVerify({ ok: false, error: msg }); return;
      }
      setVerify({ ok: false, error: 'HTTP ' + res.status });
    } catch (e: any) {
      const msg = e?.name === 'AbortError' ? 'Timeout' : 'Unreachable';
      setVerify({ ok: false, error: msg });
    }
  };

  // Auto-verify when localUrl updates
  useEffect(() => {
    if (localUrl && networkEnabled) {
      doVerify(localUrl);
    } else {
      setVerify({});
    }
  }, [localUrl, networkEnabled]);

  return (
    <div class="collection-modal" id="connectModal" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={(e: any) => e.target.id === 'connectModal' && onClose()}>
      <div class="collection-modal-box" style={{ textAlign: 'center', width: '360px', maxWidth: '95vw' }}>
        <h3 style={{ marginBottom: '12px' }}>Connect from another device</h3>
        
        {/* Network access toggle */}
        <div class="rm-row" onClick={toggleNetworkAccess} style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', cursor: 'pointer' }}>
          <div class={`rm-toggle ${networkEnabled ? 'on' : ''}`} style={{ width: '40px', height: '20px', background: networkEnabled ? 'var(--ac)' : '#555', borderRadius: '10px', position: 'relative', transition: 'background 0.3s' }}>
            <div style={{ width: '16px', height: '16px', background: '#fff', borderRadius: '50%', position: 'absolute', top: '2px', left: networkEnabled ? '22px' : '2px', transition: 'left 0.3s' }} />
          </div>
          <div style={{ textAlign: 'left' }}>
            <div class="rm-label" style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Network access — {networkEnabled ? 'enabled' : 'disabled'}</div>
            <div class="rm-desc" style={{ fontSize: '0.8rem', color: 'var(--tx3)' }}>{networkEnabled ? 'Devices on your network can connect' : 'Server only accepts connections from this machine'}</div>
          </div>
        </div>

        {/* QR + URL — shown whenever we have a local URL */}
        {localUrl && (
          <div style={{ marginTop: '16px' }}>
            <div ref={qrRef} style={{ display: 'inline-block', background: '#fff', padding: '8px', borderRadius: '12px', marginBottom: '10px' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginBottom: '8px' }}>
              <p style={{ fontSize: '0.72rem', color: 'var(--tx2)', wordBreak: 'break-all', margin: 0 }}>{localUrl}</p>
              {networkEnabled && <button type="button" onClick={() => doVerify(localUrl)} title="Re-verify" style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx3)', fontSize: '0.65rem', padding: '1px 4px', borderRadius: '3px', cursor: 'pointer' }}>↻</button>}
            </div>
            {networkEnabled && (() => {
              if (verify.checking) return <div style={{ fontSize: '0.7rem', color: 'var(--tx3)', marginBottom: '8px' }}>Verifying…</div>;
              if (verify.ok) return <div style={{ fontSize: '0.7rem', color: '#4ade80', marginBottom: '8px' }}>✓ Remote URL verified</div>;
              if (verify.error) return <div style={{ fontSize: '0.7rem', color: '#f87171', marginBottom: '8px' }}>✗ {verify.error}</div>;
              return null;
            })()}
          </div>
        )}

        {/* Remote mode + network body — only when network enabled */}
        {networkEnabled && localUrl && (
          <div class="rm-row" onClick={toggleRemoteMode} style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', cursor: 'pointer' }}>
            <div class={`rm-toggle ${remoteMode ? 'on' : ''}`} style={{ width: '40px', height: '20px', background: remoteMode ? 'var(--ac)' : '#555', borderRadius: '10px', position: 'relative', transition: 'background 0.3s' }}>
              <div style={{ width: '16px', height: '16px', background: '#fff', borderRadius: '50%', position: 'absolute', top: '2px', left: remoteMode ? '22px' : '2px', transition: 'left 0.3s' }} />
            </div>
            <div style={{ textAlign: 'left' }}>
              <div class="rm-label" style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Remote Mode — {remoteMode ? 'on' : 'off'}</div>
              <div class="rm-desc" style={{ fontSize: '0.8rem', color: 'var(--tx3)' }}>Videos you pick play on the main device</div>
            </div>
          </div>
        )}

        <div style={{ marginTop: '20px' }}>
          <button class="modal-btn" onClick={onClose} style={{ width: '100%' }}>Close</button>
        </div>
      </div>
    </div>
  );
};
