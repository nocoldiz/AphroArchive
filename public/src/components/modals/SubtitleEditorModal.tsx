import { useEffect, useState, useCallback } from 'preact/hooks';
import { subtitleEditorModalState } from '../../store';

interface Cue {
  id: string;
  start: string;
  end: string;
  text: string;
}

// ── Parsers ────────────────────────────────────────────────────────────

function parseVtt(raw: string): Cue[] {
  const cues: Cue[] = [];
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    // Skip non-cue lines (WEBVTT header, NOTE, STYLE, etc.)
    const line = lines[i].trim();
    if (line.includes('-->')) {
      const timeParts = line.split('-->').map(s => s.trim());
      const texts: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '') {
        texts.push(lines[i]);
        i++;
      }
      cues.push({
        id: String(cues.length + 1),
        start: timeParts[0],
        end: timeParts[1],
        text: texts.join('\n'),
      });
    } else {
      i++;
    }
  }
  return cues;
}

function parseSrt(raw: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = raw.replace(/\r\n/g, '\n').split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;
    let idx = 0;
    // Skip optional index line
    if (/^\d+$/.test(lines[0].trim())) idx = 1;
    const timeLine = lines[idx];
    if (!timeLine || !timeLine.includes('-->')) continue;
    const [start, end] = timeLine.split('-->').map(s => s.trim().replace(',', '.'));
    const text = lines.slice(idx + 1).join('\n');
    cues.push({ id: String(cues.length + 1), start, end, text });
  }
  return cues;
}

function serializeVtt(cues: Cue[]): string {
  const parts = ['WEBVTT\n'];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    parts.push(`\n${i + 1}\n${c.start} --> ${c.end}\n${c.text}\n`);
  }
  return parts.join('');
}

function serializeSrt(cues: Cue[]): string {
  return cues.map((c, i) =>
    `${i + 1}\n${c.start.replace('.', ',')} --> ${c.end.replace('.', ',')}\n${c.text}`
  ).join('\n\n') + '\n';
}

// ── Component ──────────────────────────────────────────────────────────

export const SubtitleEditorModal = () => {
  const state = subtitleEditorModalState.value;
  const [cues, setCues] = useState<Cue[]>([]);
  const [ext, setExt] = useState('.vtt');
  const [rawMode, setRawMode] = useState(false);
  const [rawText, setRawText] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!state.visible || !state.videoId) return;
    setLoading(true);
    setError('');
    setDirty(false);
    fetch(`/api/subtitles/${state.videoId}/content`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); setLoading(false); return; }
        const fileExt = data.ext || '.vtt';
        setExt(fileExt);
        setRawText(data.content);
        setCues(fileExt === '.srt' ? parseSrt(data.content) : parseVtt(data.content));
        setLoading(false);
      })
      .catch(() => { setError('Failed to load subtitle file'); setLoading(false); });
  }, [state.visible, state.videoId]);

  const close = () => {
    if (dirty && !confirm('You have unsaved changes. Close anyway?')) return;
    subtitleEditorModalState.value = { visible: false, videoId: '', videoName: '' };
    setCues([]);
    setRawText('');
    setDirty(false);
    setError('');
  };

  const updateCue = useCallback((idx: number, field: keyof Cue, val: string) => {
    setCues(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      return next;
    });
    setDirty(true);
  }, []);

  const addCue = (afterIdx: number) => {
    setCues(prev => {
      const next = [...prev];
      const newCue: Cue = { id: String(Date.now()), start: '00:00:00.000', end: '00:00:01.000', text: '' };
      next.splice(afterIdx + 1, 0, newCue);
      return next;
    });
    setDirty(true);
  };

  const removeCue = (idx: number) => {
    setCues(prev => prev.filter((_, i) => i !== idx));
    setDirty(true);
  };

  const toggleRaw = () => {
    if (!rawMode) {
      // switching to raw: serialize current cues
      setRawText(ext === '.srt' ? serializeSrt(cues) : serializeVtt(cues));
    } else {
      // switching back to visual: reparse
      setCues(ext === '.srt' ? parseSrt(rawText) : parseVtt(rawText));
    }
    setRawMode(r => !r);
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    const content = rawMode ? rawText : (ext === '.srt' ? serializeSrt(cues) : serializeVtt(cues));
    try {
      const r = await fetch(`/api/subtitles/${state.videoId}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, ext }),
      });
      const data = await r.json();
      if (data.ok) {
        setDirty(false);
        (window as any).toast?.('Subtitle saved');
      } else {
        (window as any).toastError?.('Save failed: ' + (data.error || 'unknown'));
      }
    } catch {
      (window as any).toastError?.('Save failed');
    }
    setSaving(false);
  };

  if (!state.visible) return null;

  return (
    <div class="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div class="modal-box" style={{ width: '90vw', maxWidth: '900px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', gap: 0 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--brd)', flexShrink: 0 }}>
          <div>
            <span style={{ fontWeight: 700, fontSize: '1rem' }}>Subtitle Editor</span>
            <span style={{ color: 'var(--tx2)', marginLeft: '10px', fontSize: '13px' }}>{state.videoName}</span>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={toggleRaw}
              style={{ fontSize: '12px', padding: '4px 10px', background: rawMode ? 'var(--ac)' : 'var(--bg3)', color: rawMode ? '#fff' : 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px', cursor: 'pointer' }}
            >{rawMode ? 'Visual' : 'Raw'}</button>
            <button
              onClick={save}
              disabled={saving || !dirty}
              style={{ fontSize: '12px', padding: '4px 14px', background: dirty ? 'var(--ac)' : 'var(--bg3)', color: dirty ? '#fff' : 'var(--tx3)', border: 'none', borderRadius: '4px', cursor: dirty ? 'pointer' : 'default', fontWeight: 600 }}
            >{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={close} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: 'var(--tx2)', lineHeight: 1 }}>✕</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 18px' }}>
          {loading && <p style={{ color: 'var(--tx3)', textAlign: 'center', paddingTop: '40px' }}>Loading…</p>}
          {error && <p style={{ color: 'var(--err, #e84040)', textAlign: 'center', paddingTop: '40px' }}>{error}</p>}

          {!loading && !error && rawMode && (
            <textarea
              style={{ width: '100%', minHeight: '400px', fontFamily: 'monospace', fontSize: '13px', background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px', resize: 'vertical', boxSizing: 'border-box' }}
              value={rawText}
              onInput={(e: any) => { setRawText(e.target.value); setDirty(true); }}
            />
          )}

          {!loading && !error && !rawMode && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--brd)', color: 'var(--tx2)' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', width: '40px' }}>#</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', width: '140px' }}>Start</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', width: '140px' }}>End</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Text</th>
                  <th style={{ width: '64px' }} />
                </tr>
              </thead>
              <tbody>
                {cues.map((cue, idx) => (
                  <tr key={cue.id} style={{ borderBottom: '1px solid var(--brd)' }}>
                    <td style={{ padding: '6px 8px', color: 'var(--tx3)', verticalAlign: 'top', paddingTop: '10px' }}>{idx + 1}</td>
                    <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>
                      <input
                        type="text"
                        value={cue.start}
                        onInput={(e: any) => updateCue(idx, 'start', e.target.value)}
                        style={{ fontFamily: 'monospace', fontSize: '12px', width: '100%', background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '4px 6px', boxSizing: 'border-box' }}
                      />
                    </td>
                    <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>
                      <input
                        type="text"
                        value={cue.end}
                        onInput={(e: any) => updateCue(idx, 'end', e.target.value)}
                        style={{ fontFamily: 'monospace', fontSize: '12px', width: '100%', background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '4px 6px', boxSizing: 'border-box' }}
                      />
                    </td>
                    <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>
                      <textarea
                        rows={Math.max(1, cue.text.split('\n').length)}
                        value={cue.text}
                        onInput={(e: any) => updateCue(idx, 'text', e.target.value)}
                        style={{ width: '100%', background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '4px 6px', fontFamily: 'inherit', fontSize: '13px', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.4 }}
                      />
                    </td>
                    <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <button
                          onClick={() => addCue(idx)}
                          title="Add cue below"
                          style={{ fontSize: '14px', lineHeight: 1, padding: '2px 6px', background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '3px', cursor: 'pointer', color: 'var(--tx2)' }}
                        >+</button>
                        <button
                          onClick={() => removeCue(idx)}
                          title="Remove cue"
                          style={{ fontSize: '12px', lineHeight: 1, padding: '2px 6px', background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '3px', cursor: 'pointer', color: 'var(--tx2)' }}
                        >✕</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {!loading && !error && !rawMode && cues.length === 0 && (
            <div style={{ textAlign: 'center', paddingTop: '40px' }}>
              <p style={{ color: 'var(--tx3)' }}>No cues found.</p>
              <button
                onClick={() => { setCues([{ id: '1', start: '00:00:00.000', end: '00:00:01.000', text: '' }]); setDirty(true); }}
                style={{ marginTop: '10px', padding: '6px 16px', background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
              >Add first cue</button>
            </div>
          )}
        </div>

        {/* Footer */}
        {!loading && !error && !rawMode && cues.length > 0 && (
          <div style={{ padding: '10px 18px', borderTop: '1px solid var(--brd)', flexShrink: 0 }}>
            <button
              onClick={() => addCue(cues.length - 1)}
              style={{ fontSize: '12px', padding: '4px 12px', background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '4px', cursor: 'pointer', color: 'var(--tx)' }}
            >+ Add cue</button>
            <span style={{ fontSize: '12px', color: 'var(--tx3)', marginLeft: '10px' }}>{cues.length} cues · {ext}</span>
          </div>
        )}
      </div>
    </div>
  );
};
