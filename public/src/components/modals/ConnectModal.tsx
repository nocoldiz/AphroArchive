import { useState, useEffect, useRef } from 'preact/hooks';

declare var QRCode: any;

interface Props {
  onClose: () => void;
}

export const ConnectModal = ({ onClose }: Props) => {
  const [networkEnabled, setNetworkEnabled] = useState(false);
  const [remoteMode, setRemoteMode] = useState(false);
  const [localUrl, setLocalUrl] = useState('');
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
    if (localUrl && qrRef.current && typeof QRCode !== 'undefined') {
      qrRef.current.innerHTML = '';
      new QRCode(qrRef.current, {
        text: localUrl,
        width: 160,
        height: 160,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: 2 // QRErrorCorrectLevel.M
      });
      // Add border radius to the generated canvas/img
      const child = qrRef.current.querySelector('canvas, img');
      if (child) {
        (child as HTMLElement).style.borderRadius = '8px';
        (child as HTMLElement).style.display = 'block';
        (child as HTMLElement).style.margin = '0 auto';
      }
    }
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

        {/* Body shown only when network is enabled */}
        {networkEnabled && (
          <div id="connectModalBody" style={{ marginTop: '16px' }}>
            <p id="connectUrl" style={{ fontSize: '0.8rem', color: 'var(--tx2)', marginBottom: '16px', wordBreak: 'break-all' }}>{localUrl}</p>
            <div ref={qrRef} style={{ display: 'inline-block', background: '#fff', padding: '8px', borderRadius: '12px', marginBottom: '16px' }} />
            
            <div class="rm-row" onClick={toggleRemoteMode} style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', cursor: 'pointer' }}>
              <div class={`rm-toggle ${remoteMode ? 'on' : ''}`} style={{ width: '40px', height: '20px', background: remoteMode ? 'var(--ac)' : '#555', borderRadius: '10px', position: 'relative', transition: 'background 0.3s' }}>
                <div style={{ width: '16px', height: '16px', background: '#fff', borderRadius: '50%', position: 'absolute', top: '2px', left: remoteMode ? '22px' : '2px', transition: 'left 0.3s' }} />
              </div>
              <div style={{ textAlign: 'left' }}>
                <div class="rm-label" style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Remote Mode — {remoteMode ? 'on' : 'off'}</div>
                <div class="rm-desc" style={{ fontSize: '0.8rem', color: 'var(--tx3)' }}>Videos you pick play on the main device</div>
              </div>
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
