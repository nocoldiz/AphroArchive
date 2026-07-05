import { useState, useEffect, useRef } from 'preact/hooks';
import { confirmDialog } from '../../dialog';

type IssueType = 'missing_file' | 'zero_duration' | 'missing_thumbs' | 'orphaned_meta';

interface HealthIssue {
  type: IssueType;
  id: string;
  name: string;
  path: string | null;
  catPath: string;
}

interface Summary {
  missing_file: number;
  zero_duration: number;
  missing_thumbs: number;
  orphaned_meta: number;
}

const TYPE_LABELS: Record<IssueType, string> = {
  missing_file:   'Missing files',
  zero_duration:  'Zero duration',
  missing_thumbs: 'Missing thumbnails',
  orphaned_meta:  'Orphaned metadata',
};

const TYPE_DESC: Record<IssueType, string> = {
  missing_file:   'File is in the database but no longer exists on disk.',
  zero_duration:  'File exists but has a zero or unknown duration in the cache.',
  missing_thumbs: 'File exists but has no complete thumbnail set.',
  orphaned_meta:  'Metadata entry in the database with no matching video file.',
};

const TYPE_COLOR: Record<IssueType, string> = {
  missing_file:   '#e84040',
  zero_duration:  '#e07c00',
  missing_thumbs: '#8b6fca',
  orphaned_meta:  '#5b9cf6',
};

export const LibraryHealthView = () => {
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<HealthIssue[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeFilter, setActiveFilter] = useState<IssueType | 'all'>('all');
  const [fixing, setFixing] = useState(false);
  const sseRef = useRef<EventSource | null>(null);

  const toast = (msg: string) => (window as any).toast?.(msg);

  const startScan = async () => {
    setResults(null);
    setSummary(null);
    setSelected(new Set());
    setActiveFilter('all');
    setProgress({ done: 0, total: 0 });
    setScanning(true);

    if (sseRef.current) sseRef.current.close();
    const sse = new EventSource('/api/library/health/status');
    sseRef.current = sse;

    sse.onmessage = async (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'start') {
          setProgress({ done: 0, total: 0 });
        } else if (msg.type === 'progress') {
          setProgress({ done: msg.done, total: msg.total });
        } else if (msg.type === 'done') {
          setScanning(false);
          sse.close();
          // Fetch full results
          const r = await fetch('/api/library/health/results');
          if (r.ok) {
            const data = await r.json();
            setResults(data.results);
            const s: Summary = { missing_file: 0, zero_duration: 0, missing_thumbs: 0, orphaned_meta: 0 };
            for (const issue of data.results) s[issue.type as IssueType]++;
            setSummary(s);
          }
          setProgress(null);
        } else if (msg.type === 'idle') {
          setScanning(false);
        }
      } catch {}
    };
    sse.onerror = () => { sse.close(); setScanning(false); };

    await fetch('/api/library/health/scan', { method: 'POST' }).catch(() => {});
  };

  useEffect(() => () => { sseRef.current?.close(); }, []);

  const filtered = results
    ? (activeFilter === 'all' ? results : results.filter(r => r.type === activeFilter))
    : [];

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(r => r.id + ':' + r.type)));
    }
  };

  const fix = async (action: string, issueType: IssueType) => {
    const ids = filtered
      .filter(r => r.type === issueType && selected.has(r.id + ':' + r.type))
      .map(r => r.id);
    if (!ids.length) { toast('No items selected for this action'); return; }
    setFixing(true);
    try {
      const r = await fetch('/api/library/health/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ids }),
      });
      const d = await r.json();
      if (d.ok) {
        toast(`Fixed ${d.fixed} ${d.fixed === 1 ? 'issue' : 'issues'}`);
        // Remove fixed items from results
        setResults(prev => prev ? prev.filter(item => !ids.includes(item.id) || item.type !== issueType) : prev);
        setSelected(new Set());
      } else {
        toast(d.error || 'Fix failed');
      }
    } catch { toast('Fix failed'); }
    setFixing(false);
  };

  const genThumbs = async () => {
    const ids = filtered
      .filter(r => r.type === 'missing_thumbs' && selected.has(r.id + ':' + r.type))
      .map(r => r.id);
    if (!ids.length) { toast('No items selected'); return; }
    toast(`Queuing thumbnail generation for ${ids.length} video(s)…`);
    for (const id of ids) {
      await fetch(`/api/thumbs/${id}/generate`, { method: 'POST' }).catch(() => {});
    }
    toast('Thumbnail generation started');
  };

  return (
    <div class="section-content" style={{ padding: '24px', maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <h2 style={{ margin: 0, fontWeight: 600, fontSize: '1.15rem' }}>Library Health</h2>
        <button
          class="btn-primary"
          disabled={scanning}
          onClick={startScan}
          style={{ marginLeft: 'auto' }}
        >
          {scanning ? 'Scanning…' : results ? 'Re-scan' : 'Scan Library'}
        </button>
      </div>

      {scanning && progress && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '13px', color: 'var(--tx3)', marginBottom: '6px' }}>
            Checking {progress.total > 0 ? `${progress.done} / ${progress.total}` : '…'} files
          </div>
          <div style={{ height: '4px', background: 'var(--bg3)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{
              width: progress.total > 0 ? `${Math.round(progress.done / progress.total * 100)}%` : '0%',
              height: '100%', background: 'var(--ac)', transition: 'width 0.3s',
            }} />
          </div>
        </div>
      )}

      {summary && (
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' }}>
          {(['all', 'missing_file', 'zero_duration', 'missing_thumbs', 'orphaned_meta'] as const).map(type => {
            const count = type === 'all'
              ? (results?.length ?? 0)
              : (summary[type] ?? 0);
            const active = activeFilter === type;
            return (
              <button
                key={type}
                onClick={() => setActiveFilter(type)}
                style={{
                  padding: '6px 12px', borderRadius: '20px', fontSize: '12px', cursor: 'pointer', fontWeight: active ? 600 : 400,
                  background: active ? (type === 'all' ? 'var(--ac)' : TYPE_COLOR[type]) : 'var(--bg3)',
                  color: active ? '#fff' : 'var(--tx2)',
                  border: active ? 'none' : '1px solid var(--brd)',
                }}
              >
                {type === 'all' ? 'All' : TYPE_LABELS[type]} ({count})
              </button>
            );
          })}
        </div>
      )}

      {results !== null && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--tx3)' }}>
          {results.length === 0
            ? <><div style={{ fontSize: '2rem', marginBottom: '8px' }}>✓</div><div>No issues found — library looks healthy!</div></>
            : <div>No issues matching this filter.</div>
          }
        </div>
      )}

      {filtered.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
              <input type="checkbox"
                checked={selected.size === filtered.length && filtered.length > 0}
                onChange={toggleAll}
              />
              Select all ({filtered.length})
            </label>
            {selected.size > 0 && (
              <span style={{ fontSize: '12px', color: 'var(--tx3)' }}>{selected.size} selected</span>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
              {(activeFilter === 'all' || activeFilter === 'orphaned_meta') && selected.size > 0 && (
                <button
                  class="btn-sm"
                  disabled={fixing}
                  onClick={() => fix('delete_orphaned_meta', 'orphaned_meta')}
                >
                  Delete orphaned metadata
                </button>
              )}
              {(activeFilter === 'all' || activeFilter === 'missing_file') && selected.size > 0 && (
                <button
                  class="btn-sm btn-danger"
                  disabled={fixing}
                  onClick={async () => {
                    if (!await confirmDialog('Remove selected missing-file entries from the database?')) return;
                    fix('delete_missing_files', 'missing_file');
                  }}
                >
                  Remove from DB
                </button>
              )}
              {(activeFilter === 'all' || activeFilter === 'missing_thumbs') && selected.size > 0 && (
                <button
                  class="btn-sm"
                  disabled={fixing}
                  onClick={genThumbs}
                >
                  Generate thumbnails
                </button>
              )}
            </div>
          </div>

          <div style={{ border: '1px solid var(--brd)', borderRadius: '8px', overflow: 'hidden' }}>
            {filtered.map((issue, i) => {
              const key = issue.id + ':' + issue.type;
              const isSelected = selected.has(key);
              return (
                <div
                  key={key}
                  onClick={() => toggleSelect(key)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: '10px',
                    padding: '10px 14px',
                    borderBottom: i < filtered.length - 1 ? '1px solid var(--brd)' : 'none',
                    background: isSelected ? 'rgba(var(--ac-rgb, 100,100,200), 0.08)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(key)}
                    onClick={e => e.stopPropagation()}
                    style={{ marginTop: '3px', flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: '11px', fontWeight: 600, padding: '2px 7px', borderRadius: '10px',
                        background: TYPE_COLOR[issue.type] + '22', color: TYPE_COLOR[issue.type],
                      }}>
                        {TYPE_LABELS[issue.type]}
                      </span>
                      <span style={{ fontWeight: 500, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '400px' }}>
                        {issue.name}
                      </span>
                      {issue.catPath && (
                        <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>{issue.catPath}</span>
                      )}
                    </div>
                    {issue.path && (
                      <div style={{ fontSize: '11px', color: 'var(--tx3)', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {issue.path}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {!scanning && results === null && (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--tx3)' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>🔍</div>
          <div style={{ marginBottom: '4px' }}>Run a scan to check for problems in your library.</div>
          <div style={{ fontSize: '12px' }}>Checks for missing files, broken metadata, zero-duration entries, and missing thumbnails.</div>
        </div>
      )}
    </div>
  );
};
