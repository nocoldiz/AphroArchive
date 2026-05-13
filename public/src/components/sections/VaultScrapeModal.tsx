import { useState, useEffect, useRef } from 'preact/hooks';

interface VaultFile {
  id: string;
  ext: string;
  name?: string;
  originalName: string;
}

interface Props {
  files: VaultFile[];
  onClose: () => void;
}

export const VaultScrapeModal = ({ files, onClose }: Props) => {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [abort, setAbort] = useState(false);
  const abortRef = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    abortRef.current = abort;
  }, [abort]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  const startScrape = async () => {
    const pngs = files.filter(f => (f.ext || '').toLowerCase() === '.png');
    if (!pngs.length) {
      const w = window as any;
      if (w.toast) w.toast('No PNG files in vault to scrape');
      return;
    }

    setLoading(true);
    setAbort(false);
    abortRef.current = false;
    setLogs([]);
    setProgress(0);
    setProgressText(`Scraping 0 / ${pngs.length} (0%)`);

    let count = 0;
    for (const f of pngs) {
      if (abortRef.current) {
        setLogs(prev => [...prev, 'Scrape aborted by user.']);
        break;
      }
      count++;
      const pct = Math.round((count / pngs.length) * 100);
      setProgress(pct);
      setProgressText(`Scraping ${count} / ${pngs.length} (${pct}%)`);

      const fileName = f.name || f.originalName;
      setLogs(prev => [...prev, `Scraping ${fileName}…`]);

      try {
        const r = await fetch('/api/vault/scrape/' + f.id, { method: 'POST' });
        const d = await r.json();
        if (!r.ok) {
          setLogs(prev => [...prev.slice(0, -1), `❌ ${fileName}: Error: ${d.error || 'Unknown'}`]);
        } else {
          setLogs(prev => [...prev.slice(0, -1), `✅ ${fileName}: ${d.message || 'Done'}`]);
        }
      } catch (e: any) {
        setLogs(prev => [...prev.slice(0, -1), `❌ ${fileName}: Failed: ${e.message}`]);
      }
    }

    setLoading(false);
    setProgressText(prev => prev + ' - Finished');
    const w = window as any;
    if (w.toast) w.toast('Scrape complete!');
  };

  const handleStop = () => {
    setAbort(true);
    abortRef.current = true;
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
      <div style={{ background: 'var(--bg2)', padding: '32px', borderRadius: '12px', width: '500px', border: '1px solid var(--brd)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ margin: 0 }}>Vault Auto-Scrape</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--tx2)', cursor: 'pointer', fontSize: '1.5rem' }}>✕</button>
        </div>

        <p style={{ color: 'var(--tx2)', fontSize: '0.9rem', marginBottom: '16px' }}>
          This will attempt to scrape metadata for all PNG files in the vault.
        </p>

        {loading && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--tx2)', marginBottom: '4px' }}>{progressText}</div>
            <div style={{ width: '100%', height: '8px', background: 'var(--bg3)', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ width: `${progress}%`, height: '100%', background: 'var(--ac)', transition: 'width 0.3s ease' }} />
            </div>
          </div>
        )}

        <div
          ref={logRef}
          style={{ height: '200px', background: 'var(--bg3)', padding: '12px', borderRadius: '6px', overflowY: 'auto', fontSize: '0.8rem', fontFamily: 'monospace', color: 'var(--tx)', marginBottom: '16px' }}
        >
          {logs.length === 0 ? (
            <div style={{ color: 'var(--tx3)' }}>Logs will appear here...</div>
          ) : (
            logs.map((log, i) => (
              <div key={i} style={{ marginBottom: '4px', color: log.startsWith('❌') ? '#e84040' : log.startsWith('✅') ? '#40e840' : 'var(--tx)' }}>
                {log}
              </div>
            ))
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          {!loading ? (
            <button
              onClick={startScrape}
              style={{ background: 'var(--ac)', border: 'none', color: '#fff', padding: '10px 20px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
            >
              Start Scrape
            </button>
          ) : (
            <button
              onClick={handleStop}
              style={{ background: '#e84040', border: 'none', color: '#fff', padding: '10px 20px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
            >
              Stop
            </button>
          )}
          <button
            onClick={onClose}
            style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '10px 20px', borderRadius: '6px', cursor: 'pointer' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
