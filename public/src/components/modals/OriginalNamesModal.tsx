import { useState, useEffect, useMemo, useRef } from 'preact/hooks';
import { originalNamesModalState, appPrefs, updatePrefs, refreshLibraryQuietly } from '../../store';
import { useEscape } from './useEscape';

interface Scene {
  id: string;
  title: string;
  code: string;
  date: string;
  duration: number | null;
  studio: string;
  parentStudio: string;
  performers: string[];
  url: string;
  image: string;
  matchedBy: 'oshash' | 'md5' | 'phash';
  distance: number;
  durationDiff: number | null;
}

interface Item {
  id: string;
  name: string;
  filename: string;
  ext: string;
  category: string;
  status: 'matched' | 'nomatch' | 'error';
  error: string;
  scenes: Scene[];
}

interface JobStatus {
  running: boolean;
  total?: number;
  done?: number;
  failed?: number;
  matched?: number;
  current?: string;
  error?: string;
}

const DEFAULT_TEMPLATE = '{studio} - {date} - {title}';
const TEMPLATE_KEY = 'originalNamesTemplate';
const TOKENS = ['{title}', '{studio}', '{network}', '{date}', '{year}', '{performers}', '{code}'];

function buildName(tpl: string, s: Scene): string {
  const vals: Record<string, string> = {
    title: s.title,
    studio: s.studio,
    network: s.parentStudio || s.studio,
    date: s.date,
    year: (s.date || '').slice(0, 4),
    performers: s.performers.slice(0, 4).join(', '),
    code: s.code,
  };
  return tpl
    .replace(/\{(\w+)\}/g, (_, k) => vals[k] ?? '')
    .replace(/[<>:"/\\|?*]/g, '')
    // Drop brackets and separators left over by empty fields.
    .replace(/\[\s*\]|\(\s*\)/g, '')
    .replace(/(\s*[-–_,]\s*){2,}/g, ' - ')
    .replace(/^[\s\-–_.,]+|[\s\-–_.,]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .slice(0, 180);
}

const matchLabel = (s: Scene) =>
  s.matchedBy === 'phash' ? `phash · ${s.distance} bit${s.distance === 1 ? '' : 's'}` : `exact ${s.matchedBy}`;

export const OriginalNamesModal = () => {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState<JobStatus>({ running: false });
  const [template, setTemplate] = useState(() => {
    try { return localStorage.getItem(TEMPLATE_KEY) || DEFAULT_TEMPLATE; } catch { return DEFAULT_TEMPLATE; }
  });
  const [picked, setPicked] = useState<Record<string, string>>({});   // video id → scene id
  const [edited, setEdited] = useState<Record<string, string>>({});   // video id → hand-edited name
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applyMeta, setApplyMeta] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState('');
  const [hasKey, setHasKey] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [endpoint, setEndpoint] = useState(appPrefs.value.stashboxEndpoint || '');
  const [apiKey, setApiKey] = useState(appPrefs.value.stashboxApiKey || '');
  const [useMd5, setUseMd5] = useState(!!appPrefs.value.stashboxUseMd5);
  const wasRunning = useRef(false);

  const close = () => { originalNamesModalState.value = { visible: false }; };
  useEscape(true, () => { if (!applying) close(); });

  const loadResults = async () => {
    try {
      const r = await fetch('/api/identify/results');
      const data = await r.json();
      const list: Item[] = data.items || [];
      setItems(list);
      setHasKey(!!data.config?.hasKey);
      if (!data.config?.hasKey) setShowSettings(true);
      if (!endpoint) setEndpoint(data.config?.endpoint || '');
      // Pre-select confident matches (exact hash, or phash within 4 bits).
      setSelected(new Set(list
        .filter(i => i.status === 'matched' && i.scenes[0] && (i.scenes[0].matchedBy !== 'phash' || i.scenes[0].distance <= 4))
        .map(i => i.id)));
    } catch { }
    setLoading(false);
  };

  useEffect(() => { loadResults(); }, []);

  // Follow a running identify job; reload the table when it finishes.
  useEffect(() => {
    let stopped = false;
    let timer: any;
    const poll = async () => {
      try {
        const s: JobStatus = await (await fetch('/api/identify/poll')).json();
        if (stopped) return;
        setJob(s);
        if (wasRunning.current && !s.running) loadResults();
        wasRunning.current = s.running;
      } catch { }
      if (!stopped) timer = setTimeout(poll, wasRunning.current ? 1500 : 5000);
    };
    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);

  useEffect(() => { try { localStorage.setItem(TEMPLATE_KEY, template); } catch { } }, [template]);

  const sceneFor = (it: Item) => it.scenes.find(s => s.id === picked[it.id]) || it.scenes[0];
  const newNameFor = (it: Item) => {
    if (edited[it.id] !== undefined) return edited[it.id];
    const s = sceneFor(it);
    return s ? buildName(template, s) : '';
  };

  const visible = useMemo(
    () => items.filter(i => showAll || i.status === 'matched'),
    [items, showAll],
  );
  const matchedCount = items.filter(i => i.status === 'matched').length;

  // Two selected videos in the same folder can't end up with the same name.
  const conflicts = useMemo(() => {
    const seen = new Map<string, string>();
    const bad = new Set<string>();
    for (const it of items) {
      if (!selected.has(it.id)) continue;
      const key = (it.category + '/' + newNameFor(it) + it.ext).toLowerCase();
      if (seen.has(key)) { bad.add(it.id); bad.add(seen.get(key)!); } else seen.set(key, it.id);
    }
    return bad;
  }, [items, selected, picked, edited, template]);

  const startJob = async (force = false) => {
    setMessage('');
    await fetch('/api/identify/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force }),
    }).catch(() => { });
    wasRunning.current = true;
    setJob({ running: true });
  };

  const saveSettings = async () => {
    await updatePrefs({ stashboxEndpoint: endpoint.trim(), stashboxApiKey: apiKey.trim(), stashboxUseMd5: useMd5 });
    setHasKey(!!apiKey.trim());
    setShowSettings(false);
    setMessage('Stash-box settings saved.');
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const allVisibleSelected = visible.length > 0 && visible.every(i => selected.has(i.id) || !i.scenes.length);
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(visible.filter(i => i.scenes.length).map(i => i.id)));

  const apply = async () => {
    const chosen = items.filter(i => selected.has(i.id) && i.scenes.length && !conflicts.has(i.id));
    const payload = chosen.map(it => {
      const name = newNameFor(it).trim();
      return { id: it.id, newName: name && name !== it.name ? name : '', sceneId: sceneFor(it)?.id, applyMeta };
    }).filter(p => p.newName || p.applyMeta);
    if (!payload.length) { setMessage('Nothing to change.'); return; }
    setApplying(true);
    setMessage('');
    try {
      const r = await fetch('/api/identify/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: payload }),
      });
      const data = await r.json();
      const results: { ok: boolean; error?: string }[] = data.results || [];
      const failed = results.filter(x => !x.ok);
      setMessage(failed.length
        ? `Updated ${results.length - failed.length} of ${results.length}. ${failed.length} failed: ${failed.slice(0, 3).map(f => f.error).join('; ')}`
        : `Updated ${results.length} video${results.length === 1 ? '' : 's'}.`);
      setEdited({});
      setPicked({});
      refreshLibraryQuietly();
      await loadResults();
    } catch (e: any) {
      setMessage('Failed: ' + (e.message || e));
    }
    setApplying(false);
  };

  const selCount = items.filter(i => selected.has(i.id) && i.scenes.length).length;
  const pct = job.total ? Math.round(((job.done || 0) / job.total) * 100) : 0;

  return (
    <div className="modal-overlay on" onClick={(e: any) => e.target === e.currentTarget && !applying && close()} style={{ zIndex: 20000 }}>
      <div className="modal-dialog" style={{ maxWidth: '1100px', width: '95%', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <h2 style={{ flex: 1 }}>Rename from original data</h2>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setShowSettings(v => !v)}>
            {showSettings ? 'Hide settings' : 'Stash-box settings'}
          </button>
        </div>

        <p style={{ fontSize: '0.8rem', color: 'var(--tx3)', margin: '0 0 12px' }}>
          Videos are recognised by their content fingerprint (oshash + perceptual hash, the same method Stash uses) and looked up on a stash-box database such as StashDB.
          Fingerprinting reads 25 frames per video, so the first run takes a while.
        </p>

        {showSettings && (
          <div style={{ border: '1px solid var(--brd)', borderRadius: '8px', padding: '12px', marginBottom: '12px', display: 'grid', gap: '8px' }}>
            <label className="ui-label">Endpoint
              <input className="ui-input" type="text" value={endpoint} placeholder="https://stashdb.org/graphql"
                onInput={(e: any) => setEndpoint(e.target.value)} />
            </label>
            <label className="ui-label">API key
              <input className="ui-input" type="password" value={apiKey} placeholder="From your stash-box account page"
                onInput={(e: any) => setApiKey(e.target.value)} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}>
              <input type="checkbox" checked={useMd5} onChange={(e: any) => setUseMd5(e.target.checked)} />
              Also send MD5 (reads every file in full; slow on large libraries)
            </label>
            <div style={{ fontSize: '0.75rem', color: 'var(--tx3)' }}>
              StashDB requires a free account: register at stashdb.org, then copy the API key from your user page.
            </div>
            <div><button type="button" className="ui-btn ui-btn--primary ui-btn--sm" onClick={saveSettings}>Save</button></div>
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginBottom: '10px' }}>
          {job.running ? (
            <button type="button" className="ui-btn ui-btn--sm" onClick={() => fetch('/api/identify/stop', { method: 'POST' })}>Stop</button>
          ) : (
            <>
              <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={!hasKey} onClick={() => startJob(false)}
                title="Look up videos that were not checked yet">Identify new videos</button>
              <button type="button" className="ui-btn ui-btn--sm" disabled={!hasKey} onClick={() => startJob(true)}
                title="Look every video up again (fingerprints are cached)">Re-check all</button>
            </>
          )}
          <span style={{ fontSize: '0.78rem', color: 'var(--tx3)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {job.running
              ? `${job.done || 0}/${job.total || '…'} (${pct}%) · ${job.matched || 0} matched${job.current ? ' · ' + job.current : ''}`
              : `${matchedCount} matched of ${items.length} checked`}
          </span>
        </div>
        {job.error && <div className="modal-error" style={{ display: 'block', marginBottom: '8px' }}>{job.error}</div>}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginBottom: '10px' }}>
          <label className="ui-label" style={{ flex: '1 1 300px' }}>Name template
            <input className="ui-input" type="text" value={template} onInput={(e: any) => { setTemplate(e.target.value); setEdited({}); }} />
          </label>
          <div style={{ fontSize: '0.72rem', color: 'var(--tx3)', flex: '1 1 260px' }}>
            {TOKENS.map(t => (
              <button key={t} type="button" className="ui-chip" style={{ margin: '2px' }}
                onClick={() => { setTemplate(v => (v ? v + ' ' : '') + t); setEdited({}); }}>{t}</button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--brd)', borderRadius: '8px', minHeight: '120px' }}>
          {loading ? (
            <div className="empty-state" style={{ padding: '24px' }}>Loading…</div>
          ) : !visible.length ? (
            <div className="empty-state" style={{ padding: '24px' }}>
              {items.length ? 'No matches yet.' : 'No videos have been identified yet. Click "Identify new videos" to start.'}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 1 }}>
                <tr style={{ textAlign: 'left', color: 'var(--tx3)' }}>
                  <th style={{ padding: '6px 8px', width: '28px' }}>
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} />
                  </th>
                  <th style={{ padding: '6px 8px' }}>Current name</th>
                  <th style={{ padding: '6px 8px' }}>Match</th>
                  <th style={{ padding: '6px 8px' }}>New name</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(it => {
                  const s = sceneFor(it);
                  const conflict = conflicts.has(it.id);
                  return (
                    <tr key={it.id} style={{ borderTop: '1px solid var(--brd)', verticalAlign: 'top' }}>
                      <td style={{ padding: '6px 8px' }}>
                        <input type="checkbox" disabled={!it.scenes.length} checked={selected.has(it.id)} onChange={() => toggle(it.id)} />
                      </td>
                      <td style={{ padding: '6px 8px', wordBreak: 'break-word', maxWidth: '280px' }} title={it.filename}>
                        {it.name}
                        {it.category && <div style={{ fontSize: '0.7rem', color: 'var(--tx3)' }}>{it.category}</div>}
                      </td>
                      <td style={{ padding: '6px 8px', maxWidth: '300px' }}>
                        {!s ? (
                          <span style={{ color: 'var(--tx3)' }}>{it.status === 'error' ? `Error: ${it.error}` : 'No match'}</span>
                        ) : (
                          <div style={{ display: 'flex', gap: '8px' }}>
                            {s.image && <img src={s.image} alt="" loading="lazy" referrerpolicy="no-referrer"
                              style={{ width: '64px', height: '36px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />}
                            <div style={{ minWidth: 0 }}>
                              {it.scenes.length > 1 ? (
                                <select className="ui-input" style={{ padding: '2px 4px', fontSize: '0.75rem', maxWidth: '220px' }}
                                  value={s.id}
                                  onChange={(e: any) => {
                                    setPicked({ ...picked, [it.id]: e.target.value });
                                    const { [it.id]: _, ...rest } = edited; setEdited(rest);
                                  }}>
                                  {it.scenes.map(c => <option key={c.id} value={c.id}>{c.title || '(untitled)'} — {c.studio}</option>)}
                                </select>
                              ) : (
                                <div style={{ fontWeight: 500 }}>{s.title || '(untitled)'}</div>
                              )}
                              <div style={{ fontSize: '0.7rem', color: 'var(--tx3)' }}>
                                {[s.studio, s.date, s.performers.slice(0, 3).join(', ')].filter(Boolean).join(' · ')}
                              </div>
                              <span className="ui-badge" style={{ fontSize: '0.65rem', color: s.matchedBy === 'phash' && s.distance > 4 ? 'var(--danger)' : undefined }}>
                                {matchLabel(s)}
                              </span>
                            </div>
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '6px 8px', minWidth: '240px' }}>
                        {s && (
                          <>
                            <input className="ui-input" type="text" value={newNameFor(it)}
                              style={{ width: '100%', borderColor: conflict ? 'var(--danger)' : undefined }}
                              onInput={(e: any) => setEdited({ ...edited, [it.id]: e.target.value })} />
                            {conflict && <div style={{ fontSize: '0.7rem', color: 'var(--danger)' }}>Same name as another selected video in this folder</div>}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {message && <div style={{ fontSize: '0.8rem', marginTop: '8px', color: 'var(--tx2)' }}>{message}</div>}

        <div className="modal-footer" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', marginRight: 'auto' }}>
            <input type="checkbox" checked={showAll} onChange={(e: any) => setShowAll(e.target.checked)} />
            Show unmatched
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}
            title="Studio is saved as the channel; performers are added to the actors">
            <input type="checkbox" checked={applyMeta} onChange={(e: any) => setApplyMeta(e.target.checked)} />
            Also save studio, performers and date
          </label>
          <button type="button" className="ui-btn" onClick={close} disabled={applying}>Close</button>
          <button type="button" className="ui-btn ui-btn--primary" onClick={apply} disabled={applying || !selCount || job.running}>
            {applying ? 'Applying…' : `Rename ${selCount} video${selCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
};
