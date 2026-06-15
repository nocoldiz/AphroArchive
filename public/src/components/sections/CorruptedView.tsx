/** @jsxImportSource preact */
import { useState, useEffect, useRef } from 'preact/hooks';
import { isVaultUnlocked } from '../../store';

interface CorruptedItem {
  id: string;
  name: string;
  category?: string;
  folder?: string | null;
  size?: number;
  error: string;
}

const fmt = (bytes: number) => {
  if (!bytes) return '';
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  return (bytes / 1e3).toFixed(0) + ' KB';
};

interface ScanState {
  scanning: boolean;
  progress: { done: number; total: number } | null;
  results: CorruptedItem[] | null;
  skipped: number;
}

const empty: ScanState = { scanning: false, progress: null, results: null, skipped: 0 };

export const CorruptedView = () => {
  const vaultUnlocked = isVaultUnlocked.value;
  const [mode, setMode] = useState<'videos' | 'vault'>('videos');
  const [vid, setVid] = useState<ScanState>(empty);
  const [vlt, setVlt] = useState<ScanState>(empty);
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const sseRef = useRef<EventSource | null>(null);

  const toast = (msg: string) => (window as any).toast?.(msg);

  const isVault = mode === 'vault';
  const state = isVault ? vlt : vid;
  const setState = isVault ? setVlt : setVid;

  const base = isVault ? '/api/corrupted/vault' : '/api/corrupted';
  const deleteUrl = (id: string) => isVault ? `/api/vault/${id}` : `/api/videos/${id}`;

  const startScan = async () => {
    sseRef.current?.close();
    setDeleted(new Set());
    setState({ scanning: true, progress: { done: 0, total: 0 }, results: null, skipped: 0 });

    const sse = new EventSource(`${base}/status`);
    sseRef.current = sse;

    sse.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'start' || msg.type === 'progress') {
          setState(prev => ({ ...prev, progress: { done: msg.done || 0, total: msg.total || 0 } }));
        } else if (msg.type === 'done') {
          setState({ scanning: false, progress: null, results: Array.isArray(msg.results) ? msg.results : [], skipped: msg.skipped || 0 });
          sse.close();
        }
      } catch {}
    };
    sse.onerror = () => {
      sse.close();
      fetch(`${base}/results`)
        .then(r => r.json())
        .then(d => setState({ scanning: false, progress: null, results: Array.isArray(d) ? d : (d.results || []), skipped: d.skipped || 0 }))
        .catch(() => setState(prev => ({ ...prev, scanning: false, progress: null })));
    };

    await fetch(`${base}/scan`, { method: 'POST' }).catch(() => {
      sse.close();
      setState(prev => ({ ...prev, scanning: false, progress: null }));
    });
  };

  const stopScan = async () => {
    await fetch(`${base}/stop`, { method: 'POST' });
    sseRef.current?.close();
    setState(prev => ({ ...prev, scanning: false, progress: null }));
  };

  useEffect(() => () => { sseRef.current?.close(); }, []);

  const handleDelete = async (item: CorruptedItem) => {
    if (!confirm(`Permanently delete "${item.name}"?`)) return;
    setDeletingId(item.id);
    try {
      const r = await fetch(deleteUrl(item.id), { method: 'DELETE' });
      if (r.ok) {
        setDeleted(prev => new Set([...prev, item.id]));
        toast('Deleted');
      } else {
        toast('Delete failed');
      }
    } catch {
      toast('Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteAll = async () => {
    if (!visible.length) return;
    if (!confirm(`Permanently delete all ${visible.length} corrupted file${visible.length !== 1 ? 's' : ''}?`)) return;
    setDeletingAll(true);
    const newDeleted = new Set(deleted);
    let count = 0;
    for (const item of visible) {
      try {
        const r = await fetch(deleteUrl(item.id), { method: 'DELETE' });
        if (r.ok) { newDeleted.add(item.id); count++; }
      } catch {}
    }
    setDeleted(newDeleted);
    setDeletingAll(false);
    toast(`Deleted ${count} file${count !== 1 ? 's' : ''}`);
  };

  const visible = (state.results || []).filter(item => !deleted.has(item.id));

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <h2 style={{ margin: 0, fontWeight: 600, fontSize: '1.15rem', color: 'var(--ac)' }}>Corrupted Finder</h2>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          {state.scanning ? (
            <button
              onClick={stopScan}
              style={{ padding: '7px 14px', background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}
            >
              Stop
            </button>
          ) : (
            <button
              onClick={startScan}
              style={{ padding: '7px 14px', background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}
            >
              {state.results !== null ? 'Re-scan' : 'Run Scan'}
            </button>
          )}
          {!state.scanning && visible.length > 0 && (
            <button
              onClick={handleDeleteAll}
              disabled={deletingAll}
              style={{ padding: '7px 14px', background: 'transparent', color: '#c44', border: '1px solid #c44', borderRadius: '6px', cursor: deletingAll ? 'wait' : 'pointer', fontSize: '0.85rem', opacity: deletingAll ? 0.6 : 1 }}
            >
              {deletingAll ? 'Deleting…' : `Delete All (${visible.length})`}
            </button>
          )}
        </div>
      </div>

      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '20px', borderBottom: '1px solid var(--brd)', paddingBottom: '12px' }}>
        <button
          onClick={() => { sseRef.current?.close(); setMode('videos'); }}
          style={{ padding: '6px 14px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontSize: '0.85rem', background: mode === 'videos' ? 'var(--ac)' : 'var(--bg2)', color: mode === 'videos' ? '#fff' : 'var(--tx2)' }}
        >
          Videos
        </button>
        {vaultUnlocked && (
          <button
            onClick={() => { sseRef.current?.close(); setMode('vault'); }}
            style={{ padding: '6px 14px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontSize: '0.85rem', background: mode === 'vault' ? 'var(--ac)' : 'var(--bg2)', color: mode === 'vault' ? '#fff' : 'var(--tx2)' }}
          >
            Vault
          </button>
        )}
      </div>

      {state.scanning && state.progress && (
        <div style={{ marginBottom: '20px', background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '8px', padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--tx2)', marginBottom: '8px' }}>
            <span>{isVault ? 'Checking vault files…' : 'Probing videos with ffprobe…'}</span>
            <span>{state.progress.done} / {state.progress.total || '?'}</span>
          </div>
          <div style={{ height: '6px', background: 'var(--bg3)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{
              height: '100%', background: 'var(--ac)', borderRadius: '3px', transition: 'width 0.3s',
              width: state.progress.total ? `${(state.progress.done / state.progress.total) * 100}%` : '0%',
            }} />
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--tx3)', marginTop: '6px' }}>
            {isVault
              ? 'Files over 100 MB are skipped (AES-GCM requires reading the full ciphertext to verify).'
              : 'Checks each video file with ffprobe — may take a while for large libraries.'}
          </div>
        </div>
      )}

      {state.results !== null && !state.scanning && (
        <div style={{ fontSize: '0.85rem', color: 'var(--tx3)', marginBottom: '16px' }}>
          {visible.length === 0
            ? 'No corrupted files found.'
            : <><span style={{ color: '#e84040', fontWeight: 600 }}>{visible.length}</span> corrupted or unreadable file{visible.length !== 1 ? 's' : ''} found</>
          }
          {state.skipped > 0 && (
            <span style={{ marginLeft: '10px', color: 'var(--tx3)' }}>· {state.skipped} large file{state.skipped !== 1 ? 's' : ''} skipped (too large to fully verify)</span>
          )}
        </div>
      )}

      {state.results === null && !state.scanning && (
        <div style={{ textAlign: 'center', padding: '60px', color: 'var(--tx3)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '10px' }}>⚠</div>
          <div style={{ marginBottom: '4px' }}>
            {isVault
              ? 'Run a scan to find vault files that cannot be decrypted.'
              : 'Run a scan to find corrupted or unplayable videos.'}
          </div>
          <div style={{ fontSize: '12px' }}>
            {isVault
              ? 'Tries to decrypt each .enc file with AES-256-GCM and flags auth tag failures. Files over 100 MB are skipped.'
              : 'Uses ffprobe to check each file — no video stream, zero duration, or read errors are flagged.'}
          </div>
        </div>
      )}

      {visible.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {visible.map(item => (
            <div key={item.id} style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px' }}>
              {!isVault && (
                <div style={{ width: '72px', height: '45px', flexShrink: 0, borderRadius: '4px', overflow: 'hidden', background: 'var(--bg3)', position: 'relative' }}>
                  <img
                    src={`/api/thumbs/${item.id}/0`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    loading="lazy"
                    onError={(e: any) => { e.target.style.display = 'none'; }}
                    alt=""
                  />
                </div>
              )}
              {isVault && (
                <div style={{ width: '36px', height: '36px', flexShrink: 0, borderRadius: '4px', background: 'rgba(200,60,60,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>
                  🔒
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.name}
                </div>
                <div style={{ display: 'flex', gap: '10px', fontSize: '0.75rem', color: 'var(--tx3)', marginTop: '2px', flexWrap: 'wrap' }}>
                  <span style={{ color: '#e84040' }}>{item.error}</span>
                  {item.category && <span>{item.category}</span>}
                  {item.folder && <span>{item.folder}</span>}
                  {item.size ? <span>{fmt(item.size)}</span> : null}
                </div>
              </div>
              <button
                onClick={() => handleDelete(item)}
                disabled={deletingId === item.id}
                style={{ flexShrink: 0, background: 'none', border: '1px solid var(--brd)', color: '#c44', borderRadius: '4px', padding: '5px 12px', cursor: deletingId === item.id ? 'wait' : 'pointer', fontSize: '0.8rem' }}
              >
                {deletingId === item.id ? '…' : 'Delete'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
