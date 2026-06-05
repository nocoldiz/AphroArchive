import { useState } from 'preact/hooks';

const STORAGE_KEY = 'aphroarchive_server_url';

interface Props {
  onSave: (url: string) => void;
}

export function AndroidSetup({ onSave }: Props) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  async function connect() {
    setError('');
    let url = input.trim();
    if (!url) { setError('Enter a server address.'); return; }
    if (!url.startsWith('http')) url = 'http://' + url;
    try { new URL(url); } catch { setError('Invalid URL — example: http://192.168.1.100:3000'); return; }

    setChecking(true);
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(url + '/api/ping', { signal: ctrl.signal });
      clearTimeout(tid);
      if (!res.ok) { setChecking(false); setError('Server responded with error ' + res.status); return; }
    } catch (e: any) {
      setChecking(false);
      setError(e?.name === 'AbortError' ? 'Connection timed out' : 'Cannot reach server');
      return;
    }

    onSave(url);
  }

  const s: Record<string, any> = {
    wrap: { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', background: '#0a0a0a', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", color: '#e0e0e0' },
    logo: { fontSize: '48px', marginBottom: '8px' },
    h1: { fontSize: '26px', fontWeight: 700, letterSpacing: '-0.5px', marginBottom: '4px', color: '#fff' },
    sub: { fontSize: '13px', color: '#666', marginBottom: '40px' },
    card: { background: '#161616', border: '1px solid #2a2a2a', borderRadius: '14px', padding: '28px 24px', width: '100%', maxWidth: '380px' },
    label: { display: 'block', fontSize: '13px', color: '#888', marginBottom: '6px' },
    input: { width: '100%', background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: '8px', color: '#e0e0e0', fontSize: '15px', padding: '12px 14px', outline: 'none', boxSizing: 'border-box' },
    hint: { fontSize: '12px', color: '#555', marginTop: '8px', marginBottom: '20px' },
    btn: { width: '100%', background: checking ? '#555' : '#e0e0e0', color: '#0a0a0a', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 600, padding: '13px', cursor: checking ? 'default' : 'pointer' },
    err: { color: '#f04040', fontSize: '13px', marginTop: '12px', textAlign: 'center', minHeight: '20px' },
  };

  return (
    <div style={s.wrap}>
      <div style={s.logo}>🎬</div>
      <h1 style={s.h1}>AphroArchive</h1>
      <p style={s.sub}>Local Media Organizer</p>
      <div style={s.card}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '16px' }}>Connect to Server</div>
        <label style={s.label} for="srv-url">Server Address</label>
        <input
          id="srv-url"
          style={s.input}
          type="url"
          placeholder="http://192.168.1.100:3000"
          autocomplete="off"
          autocapitalize="none"
          spellcheck={false}
          value={input}
          onInput={(e: any) => setInput(e.target.value)}
          onKeyDown={(e: any) => e.key === 'Enter' && connect()}
        />
        <p style={s.hint}>Enter the IP and port where AphroArchive is running on your PC.</p>
        <button style={s.btn} onClick={connect} disabled={checking}>
          {checking ? 'Connecting…' : 'Connect'}
        </button>
        <div style={s.err}>{error}</div>
      </div>
    </div>
  );
}
