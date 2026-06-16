import { useEffect, useState, useMemo, useCallback } from 'preact/hooks';
import { appPrefs, updatePrefs, subtitleEditorModalState } from '../../store';

interface SubtitleFile {
  name: string;
  ext: string;
  size: number;
  mtime: number;
}

interface VideoItem {
  id: string;
  name: string;
  filename: string;
  catPath: string;
  hasSubtitle: boolean;
  subtitles: SubtitleFile[];
}

const MODELS = [
  { id: 'tiny',   label: 'tiny',   desc: '~75 MB · fastest, least accurate' },
  { id: 'base',   label: 'base',   desc: '~142 MB · good balance' },
  { id: 'small',  label: 'small',  desc: '~466 MB · better accuracy' },
  { id: 'medium', label: 'medium', desc: '~1.5 GB · high accuracy' },
  { id: 'large',  label: 'large',  desc: '~2.9 GB · best accuracy' },
  { id: 'turbo',  label: 'turbo',  desc: '~809 MB · fast + accurate (recommended)' },
] as const;

function fmtSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export const SubtitlesView = () => {
  const [items, setItems] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'with' | 'without'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [regenerating, setRegenerating] = useState<Set<string>>(new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchStatus, setBatchStatus] = useState('');
  const [showModelConfig, setShowModelConfig] = useState(false);
  const [availableModels, setAvailableModels] = useState<Set<string>>(new Set());
  const [downloadingModels, setDownloadingModels] = useState<Set<string>>(new Set());

  const prefs = appPrefs.value;
  const whisperEnabled = prefs.whisperEnabled ?? true;
  const whisperModel = (prefs.whisperModel as string) || 'base';
  const whisperLanguage = (prefs.whisperLanguage as string) || 'auto';

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetch('/api/subtitles').then(r => r.json());
      setItems(Array.isArray(data) ? data : []);
    } catch {
      (window as any).toastError?.('Failed to load subtitle list');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadItems();
    fetch('/api/whisper/available-models')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.available)) setAvailableModels(new Set(d.available)); })
      .catch(() => {});
    // Poll whisper job status
    const es = new EventSource('/api/gen-whisper/status');
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.type === 'start') { setBatchRunning(true); setBatchStatus(`Generating… 0 / ${ev.total}`); }
        if (ev.type === 'progress') { setBatchRunning(true); setBatchStatus(`Generating… ${ev.done} / ${ev.total}: ${ev.current}`); }
        if (ev.type === 'done') { setBatchRunning(false); setBatchStatus(`Done — ${ev.done} generated, ${ev.skipped} skipped, ${ev.failed} failed`); loadItems(); }
        if (ev.type === 'stopped') { setBatchRunning(false); setBatchStatus(`Stopped — ${ev.done} generated, ${ev.failed} failed`); loadItems(); }
        if (ev.type === 'error') {
          (window as any).toastError?.(ev.error);
          if (ev.fatal) { setBatchRunning(false); setBatchStatus(`Error: ${ev.error}`); }
        }
        if (ev.type === 'idle') { setBatchRunning(false); }
      } catch {}
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, []);

  const filtered = useMemo(() => {
    let list = items;
    if (filterMode === 'with') list = list.filter(v => v.hasSubtitle);
    if (filterMode === 'without') list = list.filter(v => !v.hasSubtitle);
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(v => v.name.toLowerCase().includes(q) || v.catPath.toLowerCase().includes(q));
    }
    return list;
  }, [items, filterMode, query]);

  const withCount = useMemo(() => items.filter(v => v.hasSubtitle).length, [items]);
  const withoutCount = items.length - withCount;

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(v => v.id)));
    }
  };

  const regenerateSingle = async (id: string, name: string) => {
    setRegenerating(prev => new Set([...prev, id]));
    try {
      await fetch('/api/subtitles/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      });
      (window as any).toast?.(`Queued regeneration for "${name}"`);
    } catch {
      (window as any).toastError?.('Failed to queue');
    }
    setRegenerating(prev => { const s = new Set(prev); s.delete(id); return s; });
  };

  const regenerateSelected = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    try {
      const r = await fetch('/api/subtitles/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const d = await r.json();
      (window as any).toast?.(`Queued ${d.queued} video(s) for regeneration`);
      setSelected(new Set());
    } catch {
      (window as any).toastError?.('Failed to queue regeneration');
    }
  };

  const deleteSubtitle = async (id: string, name: string) => {
    if (!confirm(`Delete subtitle file(s) for "${name}"?`)) return;
    await fetch(`/api/subtitles/${id}/delete`, { method: 'POST' });
    (window as any).toast?.('Subtitle deleted');
    loadItems();
  };

  const openEditor = (id: string, name: string) => {
    subtitleEditorModalState.value = { visible: true, videoId: id, videoName: name };
  };

  const startBatch = () => {
    fetch('/api/gen-whisper/start', { method: 'POST' });
  };

  const stopBatch = () => {
    setBatchStatus('Stopping…');
    fetch('/api/gen-whisper/stop', { method: 'POST' });
  };

  const saveWhisperSettings = async (field: string, value: any) => {
    await updatePrefs({ [field]: value } as any);
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1200px' }}>
      {/* Header */}
      <div style={{ marginBottom: '18px' }}>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '4px' }}>Subtitles</h2>
        <div style={{ color: 'var(--tx2)', fontSize: '13px' }}>
          {items.length} videos · <span style={{ color: 'var(--ac)' }}>{withCount} with subtitles</span> · {withoutCount} without
        </div>
      </div>

      {/* Whisper Controls */}
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '8px', padding: '14px 16px', marginBottom: '18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={whisperEnabled}
                onChange={(e: any) => saveWhisperSettings('whisperEnabled', e.target.checked)}
              />
              Whisper Auto-generation
            </label>
            <span style={{ color: 'var(--tx3)', fontSize: '12px' }}>
              Model: <strong style={{ color: whisperEnabled ? 'var(--tx)' : 'var(--tx3)' }}>{whisperModel}</strong>
            </span>
            <span style={{ color: 'var(--tx3)', fontSize: '12px' }}>
              Language: <strong style={{ color: whisperEnabled ? 'var(--tx)' : 'var(--tx3)' }}>{whisperLanguage || 'auto'}</strong>
            </span>
            <button
              onClick={() => setShowModelConfig(v => !v)}
              style={{ fontSize: '11px', padding: '3px 8px', background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '4px', cursor: 'pointer', color: 'var(--tx2)' }}
            >{showModelConfig ? 'Hide config' : 'Configure'}</button>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {batchRunning ? (
              <button
                onClick={stopBatch}
                style={{ padding: '6px 14px', background: '#e84040', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
              >Stop</button>
            ) : (
              <button
                onClick={startBatch}
                disabled={!whisperEnabled}
                style={{ padding: '6px 14px', background: whisperEnabled ? 'var(--ac)' : 'var(--bg3)', color: whisperEnabled ? '#fff' : 'var(--tx3)', border: 'none', borderRadius: '6px', cursor: whisperEnabled ? 'pointer' : 'default', fontWeight: 600, fontSize: '13px' }}
              >Generate All Missing</button>
            )}
          </div>
        </div>

        {batchStatus && (
          <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--tx2)', paddingLeft: '2px' }}>{batchStatus}</div>
        )}

        {showModelConfig && (
          <div style={{ marginTop: '14px', borderTop: '1px solid var(--brd)', paddingTop: '14px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--tx2)', marginBottom: '8px' }}>Whisper Model</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {MODELS.map(m => (
                <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
                  <label
                    style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: whisperEnabled ? 'pointer' : 'default', opacity: whisperEnabled ? 1 : 0.5, fontSize: '12px', padding: '4px 8px', background: whisperModel === m.id ? 'var(--ac)' : 'var(--bg3)', color: whisperModel === m.id ? '#fff' : 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px' }}
                    title={m.desc}
                  >
                    <input
                      type="radio"
                      name="subtitleModel"
                      value={m.id}
                      checked={whisperModel === m.id}
                      disabled={!whisperEnabled}
                      onChange={() => saveWhisperSettings('whisperModel', m.id)}
                      style={{ margin: 0 }}
                    />
                    {m.label}
                  </label>
                  {availableModels.has(m.id) ? (
                    <span style={{ fontSize: '10px', color: '#4caf50', fontWeight: 600 }}>✓ ready</span>
                  ) : downloadingModels.has(m.id) ? (
                    <span style={{ fontSize: '10px', color: 'var(--tx3)' }}>downloading…</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setDownloadingModels(prev => new Set([...prev, m.id]));
                        fetch('/api/whisper/download-model', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: m.id }) })
                          .then(() => {
                            setDownloadingModels(prev => { const s = new Set(prev); s.delete(m.id); return s; });
                            setAvailableModels(prev => new Set([...prev, m.id]));
                          })
                          .catch(() => setDownloadingModels(prev => { const s = new Set(prev); s.delete(m.id); return s; }));
                      }}
                      style={{ fontSize: '10px', padding: '1px 5px', background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '3px', cursor: 'pointer', color: 'var(--tx2)', whiteSpace: 'nowrap' }}
                    >↓ download</button>
                  )}
                </div>
              ))}
            </div>
            <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--tx2)' }}>Language:</span>
              <input
                type="text"
                value={whisperLanguage}
                placeholder="auto"
                disabled={!whisperEnabled}
                onInput={(e: any) => saveWhisperSettings('whisperLanguage', e.target.value || 'auto')}
                style={{ fontSize: '12px', padding: '4px 8px', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px', width: '100px', opacity: whisperEnabled ? 1 : 0.5 }}
              />
              <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>ISO 639-1: en, it, fr, de, ja, zh … or "auto"</span>
            </div>
          </div>
        )}
      </div>

      {/* Filters & Search */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search videos…"
          value={query}
          onInput={(e: any) => setQuery(e.target.value)}
          style={{ padding: '6px 10px', fontSize: '13px', background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', minWidth: '200px' }}
        />
        {(['all', 'with', 'without'] as const).map(mode => (
          <button
            key={mode}
            onClick={() => setFilterMode(mode)}
            style={{ padding: '5px 12px', fontSize: '12px', background: filterMode === mode ? 'var(--ac)' : 'var(--bg2)', color: filterMode === mode ? '#fff' : 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '5px', cursor: 'pointer', fontWeight: filterMode === mode ? 600 : 400 }}
          >{mode === 'all' ? 'All' : mode === 'with' ? 'Has subtitles' : 'Missing subtitles'}</button>
        ))}
        {selected.size > 0 && (
          <button
            onClick={regenerateSelected}
            style={{ marginLeft: 'auto', padding: '6px 14px', background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
          >Regenerate {selected.size} selected</button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', paddingTop: '60px', color: 'var(--tx3)' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', paddingTop: '60px', color: 'var(--tx3)' }}>No videos found.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--brd)', color: 'var(--tx2)', textAlign: 'left' }}>
              <th style={{ padding: '8px', width: '36px' }}>
                <input
                  type="checkbox"
                  checked={selected.size === filtered.length && filtered.length > 0}
                  onChange={toggleSelectAll}
                />
              </th>
              <th style={{ padding: '8px' }}>Video</th>
              <th style={{ padding: '8px', width: '160px' }}>Folder</th>
              <th style={{ padding: '8px', width: '100px' }}>Status</th>
              <th style={{ padding: '8px', width: '140px' }}>Subtitle file</th>
              <th style={{ padding: '8px', width: '80px' }}>Size</th>
              <th style={{ padding: '8px', width: '110px' }}>Modified</th>
              <th style={{ padding: '8px', width: '140px' }} />
            </tr>
          </thead>
          <tbody>
            {filtered.map(item => {
              const sub = item.subtitles[0];
              const isSelected = selected.has(item.id);
              const isRegen = regenerating.has(item.id);
              return (
                <tr
                  key={item.id}
                  style={{ borderBottom: '1px solid var(--brd)', background: isSelected ? 'color-mix(in srgb, var(--ac) 8%, transparent)' : 'transparent' }}
                >
                  <td style={{ padding: '8px' }}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(item.id)} />
                  </td>
                  <td style={{ padding: '8px', fontWeight: 500, maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.name}>
                    {item.name}
                  </td>
                  <td style={{ padding: '8px', color: 'var(--tx3)', fontSize: '12px', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.catPath}>
                    {item.catPath || '—'}
                  </td>
                  <td style={{ padding: '8px' }}>
                    {item.hasSubtitle ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#4caf50', fontSize: '12px', fontWeight: 600 }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                        {sub?.ext?.replace('.', '').toUpperCase()}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--tx3)', fontSize: '12px' }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '8px', fontSize: '12px', color: 'var(--tx2)', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sub ? sub.name : '—'}
                  </td>
                  <td style={{ padding: '8px', fontSize: '12px', color: 'var(--tx3)' }}>
                    {sub ? fmtSize(sub.size) : '—'}
                  </td>
                  <td style={{ padding: '8px', fontSize: '12px', color: 'var(--tx3)' }}>
                    {sub ? fmtDate(sub.mtime) : '—'}
                  </td>
                  <td style={{ padding: '8px' }}>
                    <div style={{ display: 'flex', gap: '5px', justifyContent: 'flex-end' }}>
                      {item.hasSubtitle && (
                        <button
                          onClick={() => openEditor(item.id, item.name)}
                          title="Edit subtitle"
                          style={{ padding: '3px 8px', fontSize: '11px', background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '4px', cursor: 'pointer', color: 'var(--tx)' }}
                        >Edit</button>
                      )}
                      <button
                        onClick={() => regenerateSingle(item.id, item.name)}
                        disabled={isRegen || !whisperEnabled}
                        title={item.hasSubtitle ? 'Regenerate subtitle' : 'Generate subtitle'}
                        style={{ padding: '3px 8px', fontSize: '11px', background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '4px', cursor: whisperEnabled && !isRegen ? 'pointer' : 'default', color: whisperEnabled && !isRegen ? 'var(--tx)' : 'var(--tx3)', opacity: isRegen ? 0.6 : 1 }}
                      >{isRegen ? '…' : item.hasSubtitle ? 'Regen' : 'Generate'}</button>
                      {item.hasSubtitle && (
                        <button
                          onClick={() => deleteSubtitle(item.id, item.name)}
                          title="Delete subtitle file"
                          style={{ padding: '3px 8px', fontSize: '11px', background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '4px', cursor: 'pointer', color: '#e84040' }}
                        >Delete</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};
