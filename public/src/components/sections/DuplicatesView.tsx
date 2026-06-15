/** @jsxImportSource preact */
import { useState, useEffect, useRef } from 'preact/hooks';

interface VideoItem {
  id: string;
  name: string;
  size: number;
  duration?: number;
  category?: string;
  fav?: boolean;
  width?: number | null;
  height?: number | null;
}

type Group = VideoItem[];

const fmt = (bytes: number) => {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  return (bytes / 1e3).toFixed(0) + ' KB';
};

const fmtDur = (s: number) => {
  if (!s) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

function pickBest(group: VideoItem[]): string {
  // Prefer highest resolution (w×h). Fall back to largest size, then fav, then named category.
  const res = (v: VideoItem) => (v.width && v.height) ? v.width * v.height : 0;
  return group.reduce((best, v) => {
    const br = res(best), vr = res(v);
    if (vr !== br) return vr > br ? v : best;
    if (v.size !== best.size) return v.size > best.size ? v : best;
    if (v.fav && !best.fav) return v;
    const namedCat = (x: VideoItem) => x.category && x.category !== 'Uncategorized';
    if (namedCat(v) && !namedCat(best)) return v;
    return best;
  }).id;
}

export const DuplicatesView = () => {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'size' | 'visual'>('size');
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null);
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [keepingGroup, setKeepingGroup] = useState<number | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const loadSizeBased = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/duplicates');
      const data = await r.json();
      setGroups(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const loadVisualResults = async () => {
    try {
      const r = await fetch('/api/duplicates/results');
      const data = await r.json();
      setGroups(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (mode === 'size') {
      loadSizeBased();
    } else {
      setLoading(true);
      loadVisualResults().finally(() => setLoading(false));
    }
    return () => { esRef.current?.close(); };
  }, [mode]);

  const startVisualScan = async () => {
    esRef.current?.close();
    setScanProgress({ done: 0, total: 0 });
    setScanning(true);
    setGroups([]);

    try {
      await fetch('/api/duplicates/scan', { method: 'POST' });
    } catch (e) {
      setScanning(false);
      return;
    }

    const es = new EventSource('/api/duplicates/status');
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.type === 'progress' || ev.type === 'start') {
          setScanProgress({ done: ev.done || 0, total: ev.total || 0 });
        } else if (ev.type === 'done') {
          setGroups(Array.isArray(ev.groups) ? ev.groups : []);
          setScanning(false);
          setScanProgress(null);
          es.close();
        }
      } catch {}
    };

    es.onerror = () => {
      loadVisualResults();
      setScanning(false);
      setScanProgress(null);
      es.close();
    };
  };

  const stopScan = async () => {
    await fetch('/api/duplicates/stop', { method: 'POST' });
    esRef.current?.close();
    setScanning(false);
    setScanProgress(null);
  };

  const handleKeepBest = async (group: VideoItem[], groupIdx: number) => {
    const bestId = pickBest(group);
    const best = group.find(v => v.id === bestId)!;
    const toDelete = group.filter(v => v.id !== bestId);
    const resLabel = (best.width && best.height) ? ` (${best.width}×${best.height})` : '';
    if (!confirm(`Keep "${best.name}"${resLabel} and permanently delete the other ${toDelete.length} file${toDelete.length !== 1 ? 's' : ''}?`)) return;
    setKeepingGroup(groupIdx);
    const newDeleted = new Set(deleted);
    for (const v of toDelete) {
      try {
        const r = await fetch(`/api/videos/${v.id}`, { method: 'DELETE' });
        if (r.ok) newDeleted.add(v.id);
      } catch {}
    }
    setDeleted(newDeleted);
    setKeepingGroup(null);
    const w = window as any;
    if (w.toast) w.toast(`Kept best, deleted ${[...newDeleted].filter(id => toDelete.some(v => v.id === id)).length} duplicate${toDelete.length !== 1 ? 's' : ''}`);
  };

  const handleDelete = async (video: VideoItem) => {
    if (!confirm(`Delete "${video.name}"?\n\nThis will permanently remove the file.`)) return;
    setDeletingId(video.id);
    try {
      const r = await fetch(`/api/videos/${video.id}`, { method: 'DELETE' });
      if (r.ok) {
        setDeleted(prev => new Set([...prev, video.id]));
        const w = window as any;
        if (w.toast) w.toast('Deleted');
      } else {
        const w = window as any;
        if (w.toast) w.toast('Delete failed');
      }
    } catch {
      const w = window as any;
      if (w.toast) w.toast('Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  const visibleGroups = groups
    .map(g => g.filter(v => !deleted.has(v.id)))
    .filter(g => g.length > 1);

  const totalWasted = visibleGroups.reduce((sum, g) => {
    const maxSize = Math.max(...g.map(v => v.size));
    return sum + g.reduce((s, v) => s + v.size, 0) - maxSize;
  }, 0);

  return (
    <div style={{ padding: '24px', maxWidth: '1000px' }}>
      <h2 style={{ margin: '0 0 20px', color: 'var(--ac)' }}>Duplicate Finder</h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', borderBottom: '1px solid var(--brd)', paddingBottom: '10px' }}>
        <button
          className={`db-tab ${mode === 'size' ? 'on' : ''}`}
          onClick={() => { if (!scanning) setMode('size'); }}
          style={{ padding: '8px 16px', background: mode === 'size' ? 'var(--ac)' : 'transparent', color: mode === 'size' ? '#fff' : 'var(--tx2)', border: 'none', borderRadius: '4px', cursor: scanning ? 'not-allowed' : 'pointer' }}
        >
          Quick (size)
        </button>
        <button
          className={`db-tab ${mode === 'visual' ? 'on' : ''}`}
          onClick={() => { if (!scanning) setMode('visual'); }}
          style={{ padding: '8px 16px', background: mode === 'visual' ? 'var(--ac)' : 'transparent', color: mode === 'visual' ? '#fff' : 'var(--tx2)', border: 'none', borderRadius: '4px', cursor: scanning ? 'not-allowed' : 'pointer' }}
        >
          Visual scan
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
          {mode === 'visual' && !scanning && (
            <button
              onClick={startVisualScan}
              style={{ padding: '7px 14px', background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}
            >
              Run Scan
            </button>
          )}
          {scanning && (
            <button
              onClick={stopScan}
              style={{ padding: '7px 14px', background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}
            >
              Stop
            </button>
          )}
          {mode === 'size' && (
            <button
              onClick={loadSizeBased}
              style={{ padding: '7px 14px', background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}
            >
              Refresh
            </button>
          )}
        </div>
      </div>

      {/* Scan progress */}
      {scanning && scanProgress && (
        <div style={{ marginBottom: '20px', background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '8px', padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--tx2)', marginBottom: '8px' }}>
            <span>Scanning thumbnails for visual similarity…</span>
            <span>{scanProgress.done} / {scanProgress.total}</span>
          </div>
          <div style={{ height: '6px', background: 'var(--bg3)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'var(--ac)', borderRadius: '3px', transition: 'width 0.3s', width: scanProgress.total ? `${(scanProgress.done / scanProgress.total) * 100}%` : '0%' }} />
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--tx3)', marginTop: '6px' }}>
            Visual scan compares thumbnail frames — requires thumbnails to be generated first.
          </div>
        </div>
      )}

      {/* Summary */}
      {!loading && !scanning && visibleGroups.length > 0 && (
        <div style={{ marginBottom: '16px', fontSize: '0.85rem', color: 'var(--tx3)' }}>
          {visibleGroups.length} duplicate group{visibleGroups.length !== 1 ? 's' : ''} found
          {totalWasted > 0 && <> · <span style={{ color: 'var(--ac)' }}>{fmt(totalWasted)} potentially recoverable</span></>}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: 'var(--tx3)' }}>Loading…</div>
      ) : visibleGroups.length === 0 && !scanning ? (
        <div style={{ textAlign: 'center', padding: '60px', color: 'var(--tx3)' }}>
          {mode === 'size' ? 'No duplicate files found (by file size).' : 'No visual duplicates found. Run a scan to check.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {visibleGroups.map((group, gi) => {
            const bestId = pickBest(group);
            const isKeeping = keepingGroup === gi;
            return (
            <div key={gi} style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '10px', overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', background: 'var(--bg3)', borderBottom: '1px solid var(--brd)', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.8rem', color: 'var(--tx3)' }}>
                <span style={{ fontWeight: 600, color: 'var(--tx)' }}>Group {gi + 1}</span>
                <span>·</span>
                <span>{group.length} files</span>
                <span>·</span>
                <span>{fmt(group[0].size)} each</span>
                <button
                  onClick={() => handleKeepBest(group, gi)}
                  disabled={isKeeping}
                  title="Keep highest-resolution file and delete the rest"
                  style={{ marginLeft: 'auto', background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '5px', padding: '4px 12px', cursor: isKeeping ? 'wait' : 'pointer', fontSize: '0.78rem', fontWeight: 600, opacity: isKeeping ? 0.6 : 1 }}
                >
                  {isKeeping ? 'Deleting…' : 'Keep Best & Delete Rest'}
                </button>
              </div>
              {group.map((video, vi) => {
                const isBest = video.id === bestId;
                return (
                <div key={video.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', borderBottom: vi < group.length - 1 ? '1px solid var(--brd)' : 'none', background: isBest ? 'rgba(74,222,128,0.05)' : undefined }}>
                  <div style={{ width: '80px', height: '50px', flexShrink: 0, borderRadius: '4px', overflow: 'hidden', background: 'var(--bg3)' }}>
                    <img
                      src={`/api/thumbs/${video.id}/0`}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      loading="lazy"
                      onError={(e: any) => { e.target.style.display = 'none'; }}
                      alt=""
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {video.name}
                      {isBest && <span style={{ fontSize: '0.7rem', background: 'rgba(74,222,128,0.2)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.4)', borderRadius: '4px', padding: '1px 6px', flexShrink: 0 }}>★ keep</span>}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--tx3)', marginTop: '2px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                      <span>{fmt(video.size)}</span>
                      {video.width && video.height ? <span>{video.width}×{video.height}</span> : null}
                      {video.duration ? <span>{fmtDur(video.duration)}</span> : null}
                      {video.category ? <span>{video.category}</span> : null}
                      {video.fav && <span style={{ color: 'var(--ac)' }}>★ fav</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    <button
                      onClick={() => { const w = window as any; if (w.playVideo) w.playVideo(video.id, video.name); }}
                      title="Preview"
                      style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx3)', borderRadius: '4px', padding: '4px 10px', cursor: 'pointer', fontSize: '0.78rem' }}
                    >
                      ▶
                    </button>
                    {!isBest && (
                      <button
                        onClick={() => handleDelete(video)}
                        disabled={deletingId === video.id}
                        title="Delete this file"
                        style={{ background: 'none', border: '1px solid var(--brd)', color: '#c44', borderRadius: '4px', padding: '4px 10px', cursor: 'pointer', fontSize: '0.78rem' }}
                      >
                        {deletingId === video.id ? '…' : 'Delete'}
                      </button>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
