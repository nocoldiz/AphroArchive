import { useState, useEffect, useRef, useCallback } from 'preact/hooks';

// ── Types ─────────────────────────────────────────────────────────────

interface AssetFile { name: string; size: number; mtime?: number; }
interface WildcardFile { name: string; file: string; count: number; preview: string[]; }
interface LoraEntry  { name: string; strength: number; }

interface GenParams {
  model:         string;
  model_type:    'sd15' | 'sdxl';
  vae:           string;
  prompt:        string;
  negative:      string;
  width:         number;
  height:        number;
  steps:         number;
  cfg:           number;
  sampler:       string;
  seed:          number;
  batch:         number;
  combinatorial: boolean;
}

interface GalleryImage { name: string; size: number; mtime: number; }

interface EngineStatus {
  state: 'stopped' | 'idle' | 'loading' | 'generating' | 'queued' | 'error';
  step: number; total: number; pct: number; message: string;
  comboIdx?: number; comboTotal?: number;
}

// ── Constants ─────────────────────────────────────────────────────────

const SAMPLERS     = ['euler', 'euler_a', 'dpm++_2m', 'dpm++_sde', 'ddim', 'lcm', 'unipc'];
const SIZE_PRESETS = [
  { label: '512×512',  w: 512,  h: 512  },
  { label: '512×768',  w: 512,  h: 768  },
  { label: '768×512',  w: 768,  h: 512  },
  { label: '768×768',  w: 768,  h: 768  },
  { label: '1024×1024',w: 1024, h: 1024 },
  { label: '1024×1536',w: 1024, h: 1536 },
  { label: '1152×896', w: 1152, h: 896  },
];
const DEFAULT_NEGATIVE = 'lowres, bad anatomy, bad hands, text, error, cropped, worst quality, low quality, jpeg artifacts, signature, watermark, blurry';
const STATUS_DOT: Record<string, string> = {
  stopped: 'var(--tx3)', idle: '#4caf50', loading: '#ff9800',
  generating: 'var(--ac)', queued: '#2196f3', error: '#e53935',
};

// ── Count combinatorial combinations ─────────────────────────────────

function countCombos(prompt: string): number {
  let total = 1;
  const re = /\{([^{}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null) total *= m[1].split('|').length;
  return total;
}

// ── Insert text at textarea cursor ────────────────────────────────────

function insertAtCursor(
  ref: { current: HTMLTextAreaElement | null },
  current: string,
  insert: string,
  setter: (v: string) => void,
) {
  const el = ref.current;
  if (!el) { setter(current + insert); return; }
  const s   = el.selectionStart ?? current.length;
  const e   = el.selectionEnd   ?? current.length;
  const val = current.slice(0, s) + insert + current.slice(e);
  setter(val);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(s + insert.length, s + insert.length);
  });
}

// ── Slider ────────────────────────────────────────────────────────────

function Slider({ label, value, min, max, step = 1, unit = '', onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--tx2)', marginBottom: '2px' }}>
        <span>{label}</span>
        <b style={{ color: 'var(--tx)' }}>{value}{unit}</b>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onInput={(e: any) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--ac)', cursor: 'pointer' }} />
    </div>
  );
}

// ── WildcardEditor modal ──────────────────────────────────────────────

function WildcardEditor({ name, onClose, onSaved }: { name: string; onClose: () => void; onSaved: () => void }) {
  const [content, setContent] = useState('');
  const [saving, setSaving]   = useState(false);

  useEffect(() => {
    if (!name) return;
    fetch(`/api/imagegen/wildcards/${encodeURIComponent(name)}`)
      .then(r => r.json()).then(d => setContent(d.content || '')).catch(() => {});
  }, [name]);

  const save = async () => {
    setSaving(true);
    await fetch(`/api/imagegen/wildcards/${encodeURIComponent(name)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }).catch(() => {});
    setSaving(false);
    onSaved();
    onClose();
  };

  const lineCount = content.split('\n').filter(l => l.trim() && !l.startsWith('#')).length;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '12px', width: 'min(520px, 94vw)', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontWeight: 700, fontSize: '14px', flex: 1 }}>Edit wildcard: <code style={{ color: 'var(--ac)' }}>{name}</code></span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', fontSize: '16px' }}>✕</button>
        </div>
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--tx3)' }}>
          One option per line. Lines starting with <code>#</code> are comments. Use <code>___{name}___</code> in prompts.
        </p>
        <textarea
          value={content}
          onInput={(e: any) => setContent(e.target.value)}
          rows={14}
          spellcheck={false}
          style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '8px', fontSize: '13px', fontFamily: 'monospace', lineHeight: '1.5' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>{lineCount} option{lineCount !== 1 ? 's' : ''}</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={onClose} style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '6px', padding: '6px 14px', cursor: 'pointer', fontSize: '13px' }}>Cancel</button>
            <button onClick={save} disabled={saving} style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 16px', cursor: 'pointer', fontSize: '13px', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── WildcardsPanel ────────────────────────────────────────────────────

function WildcardsPanel({
  wildcards,
  onRefresh,
  onInsert,
  activeField,
}: {
  wildcards: WildcardFile[];
  onRefresh: () => void;
  onInsert: (token: string) => void;
  activeField: 'prompt' | 'negative';
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing]   = useState<string | null>(null);
  const [newName, setNewName]   = useState('');
  const [creating, setCreating] = useState(false);

  const deleteWc = async (name: string) => {
    if (!confirm(`Delete wildcard "${name}"?`)) return;
    await fetch(`/api/imagegen/wildcards/${encodeURIComponent(name)}`, { method: 'DELETE' });
    onRefresh();
  };

  const createWc = async () => {
    const safe = newName.trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
    if (!safe) return;
    await fetch(`/api/imagegen/wildcards/${encodeURIComponent(safe)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `# ${safe} wildcard\n` }),
    });
    setNewName(''); setCreating(false);
    onRefresh();
    setEditing(safe);
  };

  return (
    <div style={{ fontSize: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
        <span style={{ color: 'var(--tx3)', fontSize: '11px', flex: 1 }}>
          Click a wildcard to insert <code style={{ color: 'var(--ac)' }}>__name__</code> into {activeField} prompt
        </span>
        <button onClick={() => setCreating(v => !v)} title="New wildcard" style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', fontSize: '11px' }}>+ New</button>
      </div>

      {creating && (
        <div style={{ display: 'flex', gap: '5px', marginBottom: '6px' }}>
          <input
            value={newName} onInput={(e: any) => setNewName(e.target.value)}
            placeholder="wildcard_name"
            onKeyDown={(e: any) => e.key === 'Enter' && createWc()}
            style={{ flex: 1, background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '3px 6px', fontSize: '12px' }}
            autoFocus
          />
          <button onClick={createWc} style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '4px', padding: '3px 8px', cursor: 'pointer' }}>Create</button>
          <button onClick={() => setCreating(false)} style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx3)', borderRadius: '4px', padding: '3px 6px', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {wildcards.length === 0 ? (
        <div style={{ color: 'var(--tx3)', fontSize: '11px', padding: '8px 0' }}>
          No wildcards in <code>db/wildcards/</code>. Create one above.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          {wildcards.map(wc => (
            <div key={wc.name} style={{ background: 'var(--bg3)', borderRadius: '5px', border: '1px solid var(--brd)', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 7px' }}>
                {/* Insert token button */}
                <button
                  onClick={() => onInsert(`__${wc.name}__`)}
                  title={`Insert __${wc.name}__ into ${activeField} prompt`}
                  style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', color: 'var(--ac)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px', padding: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  __{wc.name}__
                </button>
                <span style={{ fontSize: '10px', color: 'var(--tx3)', flexShrink: 0 }}>{wc.count}</span>
                {/* Expand preview */}
                <button
                  onClick={() => setExpanded(v => v === wc.name ? null : wc.name)}
                  title="Preview options"
                  style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: '0 2px', fontSize: '11px' }}
                >{expanded === wc.name ? '▲' : '▼'}</button>
                {/* Edit */}
                <button
                  onClick={() => setEditing(wc.name)}
                  title="Edit"
                  style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: '0 2px', fontSize: '11px' }}
                >✏</button>
                {/* Delete */}
                <button
                  onClick={() => deleteWc(wc.name)}
                  title="Delete"
                  style={{ background: 'none', border: 'none', color: '#c44', cursor: 'pointer', padding: '0 2px', fontSize: '11px' }}
                >✕</button>
              </div>

              {expanded === wc.name && wc.preview.length > 0 && (
                <div style={{ padding: '3px 7px 6px', borderTop: '1px solid var(--brd)', display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                  {wc.preview.map((p, i) => (
                    <span key={i} style={{ background: 'var(--bg)', border: '1px solid var(--brd)', borderRadius: '3px', padding: '1px 5px', fontSize: '11px', color: 'var(--tx2)' }}>{p}</span>
                  ))}
                  {wc.count > wc.preview.length && (
                    <span style={{ fontSize: '11px', color: 'var(--tx3)', padding: '1px 4px' }}>+{wc.count - wc.preview.length} more</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <WildcardEditor name={editing} onClose={() => setEditing(null)} onSaved={onRefresh} />
      )}
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────

export const ImageGenView = () => {
  const [engineStatus, setEngineStatus] = useState<EngineStatus>({ state: 'stopped', step: 0, total: 0, pct: 0, message: 'Engine not started' });
  const [engineRunning, setEngineRunning] = useState(false);
  const [engineReady,   setEngineReady]   = useState(false);
  const [engineDevice,  setEngineDevice]  = useState('');
  const [queueLength,   setQueueLength]   = useState(0);

  const [models,    setModels]    = useState<AssetFile[]>([]);
  const [vaes,      setVaes]      = useState<AssetFile[]>([]);
  const [loras,     setLoras]     = useState<AssetFile[]>([]);
  const [wildcards, setWildcards] = useState<WildcardFile[]>([]);
  const [gallery,   setGallery]   = useState<GalleryImage[]>([]);
  const [lightbox,  setLightbox]  = useState<GalleryImage | null>(null);

  const [params, setParams] = useState<GenParams>({
    model: '', model_type: 'sd15', vae: '',
    prompt: '', negative: DEFAULT_NEGATIVE,
    width: 512, height: 768, steps: 20, cfg: 7.5,
    sampler: 'euler', seed: -1, batch: 1, combinatorial: false,
  });
  const [selectedLoras, setSelectedLoras] = useState<LoraEntry[]>([]);

  const [configOpen,   setConfigOpen]   = useState(false);
  const [wildcardsOpen,setWildcardsOpen]= useState(true);
  const [modelsDir,  setModelsDir]  = useState('');
  const [vaesDir,    setVaesDir]    = useState('');
  const [lorasDir,   setLorasDir]   = useState('');
  const [outputDir,  setOutputDir]  = useState('');

  // Which textarea is active (for wildcard insertion)
  const [activeField, setActiveField] = useState<'prompt' | 'negative'>('prompt');
  const promptRef   = useRef<HTMLTextAreaElement>(null);
  const negativeRef = useRef<HTMLTextAreaElement>(null);

  const [generating, setGenerating] = useState(false);
  const evsRef = useRef<EventSource | null>(null);

  // Combinatorial count
  const comboCount = params.combinatorial ? countCombos(params.prompt) : 1;
  const totalImages = comboCount * params.batch;

  // ── Load ────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    try {
      const [cfgRes, assetsRes, galleryRes] = await Promise.all([
        fetch('/api/imagegen/config').then(r => r.json()),
        fetch('/api/imagegen/assets').then(r => r.json()),
        fetch('/api/imagegen/gallery').then(r => r.json()),
      ]);
      setModels(assetsRes.models || []);
      setVaes(assetsRes.vaes || []);
      setLoras(assetsRes.loras || []);
      setWildcards(assetsRes.wildcards || []);
      setGallery(galleryRes || []);
      setModelsDir(cfgRes.modelsDir || '');
      setVaesDir(cfgRes.vaesDir || '');
      setLorasDir(cfgRes.lorasDir || '');
      setOutputDir(cfgRes.outputDir || '');
      if (cfgRes.model) setParams(p => ({ ...p, model: cfgRes.model, model_type: cfgRes.model_type || 'sd15', vae: cfgRes.vae || '' }));
      setEngineRunning(cfgRes.engine?.running || false);
      setEngineReady(cfgRes.engine?.ready || false);
      setEngineDevice(cfgRes.engine?.device || '');
      if (cfgRes.engine?.status) setEngineStatus(cfgRes.engine.status);
    } catch {}
  }, []);

  useEffect(() => { loadAll(); }, []);

  const reloadWildcards = async () => {
    try {
      const r = await fetch('/api/imagegen/assets').then(r => r.json());
      setWildcards(r.wildcards || []);
    } catch {}
  };

  // ── SSE ─────────────────────────────────────────────────────────

  useEffect(() => {
    const evs = new EventSource('/api/imagegen/progress');
    evsRef.current = evs;
    evs.onmessage = (e) => {
      try { handleMsg(JSON.parse(e.data)); } catch {}
    };
    return () => evs.close();
  }, []);

  const handleMsg = (msg: any) => {
    if (msg.queueLength != null) setQueueLength(msg.queueLength);
    switch (msg.type) {
      case 'init':
      case 'ready':
        setEngineRunning(true); setEngineReady(true);
        if (msg.device) setEngineDevice(msg.device);
        setEngineStatus({ state: 'idle', step: 0, total: 0, pct: 0, message: `Ready on ${msg.device || 'cpu'}` });
        break;
      case 'engine_stopped':
        setEngineRunning(false); setEngineReady(false);
        setEngineStatus({ state: 'stopped', step: 0, total: 0, pct: 0, message: 'Engine stopped' });
        setGenerating(false);
        break;
      case 'loading':
        setEngineStatus({ state: 'loading', step: 0, total: 0, pct: 0, message: `Loading ${msg.model}…` });
        break;
      case 'progress':
        setGenerating(true);
        setEngineStatus({
          state: 'generating', step: msg.step, total: msg.total, pct: msg.pct,
          message: `Step ${msg.step}/${msg.total}${(msg.combo_total||1) > 1 ? ` · image ${(msg.combo_idx||0)+1}/${msg.combo_total}` : ''}`,
          comboIdx: msg.combo_idx, comboTotal: msg.combo_total,
        });
        break;
      case 'done':
        setGenerating(false);
        setEngineStatus({ state: 'idle', step: 0, total: 0, pct: 100, message: `Done in ${msg.elapsed}s — ${msg.count} image(s)` });
        fetch('/api/imagegen/gallery').then(r => r.json()).then(setGallery).catch(() => {});
        break;
      case 'cancelled':
        setGenerating(false);
        setEngineStatus({ state: 'idle', step: 0, total: 0, pct: 0, message: 'Cancelled' });
        break;
      case 'error':
        setGenerating(false);
        setEngineStatus({ state: 'error', step: 0, total: 0, pct: 0, message: msg.message });
        break;
    }
  };

  // ── Actions ──────────────────────────────────────────────────────

  const startEngine = () => fetch('/api/imagegen/engine/start', { method: 'POST' }).then(() => { setEngineRunning(true); setEngineStatus(s => ({ ...s, state: 'loading', message: 'Starting…' })); });
  const stopEngine  = () => fetch('/api/imagegen/engine/stop',  { method: 'POST' });
  const cancel      = () => fetch('/api/imagegen/cancel',        { method: 'POST' });

  const generate = async () => {
    if (!params.model)        { alert('Select a model first'); return; }
    if (!params.prompt.trim()){ alert('Enter a prompt');        return; }

    if (!engineRunning) await startEngine();

    const body = {
      ...params,
      loras:          selectedLoras.map(l => l.name),
      lora_strengths: selectedLoras.map(l => l.strength),
    };
    const r = await fetch('/api/imagegen/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const d = await r.json();
    if (d.error) { alert(d.error); return; }
    setGenerating(true);
    setEngineStatus(s => ({ ...s, state: 'queued', message: 'Queued…' }));
  };

  const saveConfig = async () => {
    await fetch('/api/imagegen/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelsDir, vaesDir, lorasDir, outputDir, model: params.model, vae: params.vae, modelType: params.model_type }),
    });
    await loadAll();
    setConfigOpen(false);
  };

  const setParam = <K extends keyof GenParams>(k: K, v: GenParams[K]) => setParams(p => ({ ...p, [k]: v }));

  const addLora = (name: string) => {
    if (selectedLoras.find(l => l.name === name)) return;
    setSelectedLoras(p => [...p, { name, strength: 0.7 }]);
  };
  const removeLora    = (name: string) => setSelectedLoras(p => p.filter(l => l.name !== name));
  const setLoraStrength = (name: string, s: number) => setSelectedLoras(p => p.map(l => l.name === name ? { ...l, strength: s } : l));

  // Insert wildcard token into active field
  const insertWildcard = (token: string) => {
    if (activeField === 'prompt') {
      insertAtCursor(promptRef as any, params.prompt, token, v => setParam('prompt', v));
    } else {
      insertAtCursor(negativeRef as any, params.negative, token, v => setParam('negative', v));
    }
  };

  // Insert combinatorial syntax example
  const insertCombo = (field: 'prompt' | 'negative') => {
    const example = '{option1|option2|option3}';
    if (field === 'prompt') {
      insertAtCursor(promptRef as any, params.prompt, example, v => setParam('prompt', v));
    } else {
      insertAtCursor(negativeRef as any, params.negative, example, v => setParam('negative', v));
    }
  };

  // Lightbox keyboard
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
      if (e.key === 'ArrowRight') { const i = gallery.findIndex(x => x.name === lightbox.name); if (i < gallery.length-1) setLightbox(gallery[i+1]); }
      if (e.key === 'ArrowLeft')  { const i = gallery.findIndex(x => x.name === lightbox.name); if (i > 0) setLightbox(gallery[i-1]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, gallery]);

  const isWorking = generating || engineStatus.state === 'loading' || engineStatus.state === 'queued';

  // Detect wildcards in current prompt
  const promptWildcards = [...new Set([...(params.prompt.match(/__([a-zA-Z0-9_\-/]+)__/g) || []), ...(params.negative.match(/__([a-zA-Z0-9_\-/]+)__/g) || [])])];

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: 'var(--bg)' }}>

      {/* ══ LEFT PANEL ══════════════════════════════════════════════ */}
      <div style={{ width: '350px', minWidth: '300px', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--brd)', background: 'var(--bg2)', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--brd)', display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <span style={{ fontWeight: 700, fontSize: '14px', flex: 1 }}>🖼 Image Gen</span>
          <button onClick={() => setConfigOpen(v => !v)} title="Paths config" style={{ background: 'none', border: 'none', color: configOpen ? 'var(--ac)' : 'var(--tx3)', cursor: 'pointer', padding: '3px', fontSize: '14px' }}>⚙</button>
        </div>

        {/* Config */}
        {configOpen && (
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--brd)', background: 'var(--bg3)', display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px', flexShrink: 0 }}>
            {([['Models dir', modelsDir, setModelsDir], ['VAEs dir', vaesDir, setVaesDir], ['LoRAs dir', lorasDir, setLorasDir], ['Output dir', outputDir, setOutputDir]] as [string, string, (v: string) => void][]).map(([label, val, setter]) => (
              <div key={label}>
                <label style={{ color: 'var(--tx3)', display: 'block', marginBottom: '2px' }}>{label}</label>
                <input value={val} onInput={(e: any) => setter(e.target.value)} placeholder="Absolute path…"
                  style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '3px 6px' }} />
              </div>
            ))}
            <button onClick={saveConfig} style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '5px', padding: '5px 0', cursor: 'pointer' }}>Save &amp; Reload</button>
          </div>
        )}

        {/* Engine status */}
        <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--brd)', display: 'flex', alignItems: 'center', gap: '7px', fontSize: '11px', flexShrink: 0 }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: STATUS_DOT[engineStatus.state] || 'var(--tx3)', flexShrink: 0, display: 'inline-block' }} />
          <span style={{ flex: 1, color: 'var(--tx2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={engineStatus.message}>{engineStatus.message}</span>
          {engineDevice && <span style={{ color: 'var(--tx3)' }}>{engineDevice}</span>}
          {!engineRunning
            ? <button onClick={startEngine} style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', whiteSpace: 'nowrap' }}>Start</button>
            : <button onClick={stopEngine} style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', whiteSpace: 'nowrap' }}>Stop</button>
          }
        </div>

        {/* Progress bar */}
        {(engineStatus.state === 'generating' || engineStatus.state === 'loading') && (
          <div style={{ height: '3px', background: 'var(--bg3)', flexShrink: 0 }}>
            <div style={{ height: '100%', width: engineStatus.state === 'loading' ? '100%' : `${engineStatus.pct}%`, background: 'var(--ac)', transition: 'width 0.3s', animation: engineStatus.state === 'loading' ? 'igPulse 1.5s ease-in-out infinite' : 'none' }} />
          </div>
        )}

        <div style={{ flex: 1, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>

          {/* ── Positive prompt ──────────────────────── */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '3px' }}>
              <label style={{ fontSize: '12px', color: 'var(--tx2)', fontWeight: 600, flex: 1 }}>
                Positive prompt
                {activeField === 'prompt' && <span style={{ color: 'var(--ac)', marginLeft: '4px', fontSize: '10px' }}>← active</span>}
              </label>
              <button onClick={() => insertCombo('prompt')} title="Insert {a|b|c} combinatorial group" style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx3)', borderRadius: '4px', padding: '1px 5px', fontSize: '10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>{'{a|b}'}</button>
            </div>
            <textarea
              ref={promptRef as any}
              value={params.prompt}
              onInput={(e: any) => setParam('prompt', e.target.value)}
              onFocus={() => setActiveField('prompt')}
              placeholder="masterpiece, best quality, …  (use __wildcard__ or {a|b|c})"
              rows={5}
              style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', background: 'var(--bg3)', color: 'var(--tx)', border: `1px solid ${activeField === 'prompt' ? 'var(--ac)' : 'var(--brd)'}`, borderRadius: '6px', padding: '6px 8px', fontSize: '12px', fontFamily: 'inherit', lineHeight: '1.5' }}
            />
            {/* Wildcard chips in prompt */}
            {promptWildcards.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '3px' }}>
                {promptWildcards.map(wc => (
                  <span key={wc} style={{ background: 'var(--ac)', color: '#fff', borderRadius: '3px', padding: '1px 6px', fontSize: '10px', fontFamily: 'monospace' }}>{wc}</span>
                ))}
              </div>
            )}
          </div>

          {/* ── Negative prompt ──────────────────────── */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '3px' }}>
              <label style={{ fontSize: '12px', color: 'var(--tx2)', flex: 1 }}>
                Negative prompt
                {activeField === 'negative' && <span style={{ color: 'var(--ac)', marginLeft: '4px', fontSize: '10px' }}>← active</span>}
              </label>
              <button onClick={() => insertCombo('negative')} title="Insert {a|b|c} combinatorial group" style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx3)', borderRadius: '4px', padding: '1px 5px', fontSize: '10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>{'{a|b}'}</button>
            </div>
            <textarea
              ref={negativeRef as any}
              value={params.negative}
              onInput={(e: any) => setParam('negative', e.target.value)}
              onFocus={() => setActiveField('negative')}
              rows={3}
              style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', background: 'var(--bg3)', color: 'var(--tx)', border: `1px solid ${activeField === 'negative' ? 'var(--ac)' : 'var(--brd)'}`, borderRadius: '6px', padding: '6px 8px', fontSize: '12px', fontFamily: 'inherit', lineHeight: '1.5' }}
            />
          </div>

          {/* ── Combinatorial toggle ─────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '6px 8px', background: 'var(--bg3)', borderRadius: '6px', border: '1px solid var(--brd)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontSize: '12px', color: 'var(--tx2)', flex: 1 }}>
              <input type="checkbox" checked={params.combinatorial} onChange={(e: any) => setParam('combinatorial', e.target.checked)} />
              Combinatorial <code style={{ color: 'var(--ac)', fontSize: '11px' }}>{'{a|b|c}'}</code>
            </label>
            {params.combinatorial && comboCount > 1 && (
              <span style={{ fontSize: '11px', color: '#ff9800', fontWeight: 600, whiteSpace: 'nowrap' }}>{comboCount} combo{comboCount !== 1 ? 's' : ''} → {totalImages} img{totalImages !== 1 ? 's' : ''}</span>
            )}
          </div>

          {/* ── Wildcards panel ──────────────────────── */}
          <div style={{ border: '1px solid var(--brd)', borderRadius: '6px', overflow: 'hidden' }}>
            <button
              onClick={() => setWildcardsOpen(v => !v)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 9px', background: 'var(--bg3)', border: 'none', cursor: 'pointer', textAlign: 'left' }}
            >
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--tx2)', flex: 1 }}>🃏 Wildcards ({wildcards.length})</span>
              <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>{wildcardsOpen ? '▲' : '▼'}</span>
            </button>
            {wildcardsOpen && (
              <div style={{ padding: '8px 9px' }}>
                <WildcardsPanel
                  wildcards={wildcards}
                  onRefresh={reloadWildcards}
                  onInsert={insertWildcard}
                  activeField={activeField}
                />
              </div>
            )}
          </div>

          {/* ── Model ───────────────────────────────── */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--tx2)', marginBottom: '3px' }}>Model</label>
            <select value={params.model} onChange={(e: any) => setParam('model', e.target.value)}
              style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '5px', padding: '4px 7px', fontSize: '12px' }}>
              <option value="">— select model —</option>
              {models.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
            </select>
          </div>

          {/* Model type */}
          <div style={{ display: 'flex', gap: '5px' }}>
            {(['sd15', 'sdxl'] as const).map(t => (
              <button key={t} onClick={() => setParam('model_type', t)} style={{ flex: 1, background: params.model_type === t ? 'var(--ac)' : 'var(--bg3)', color: params.model_type === t ? '#fff' : 'var(--tx2)', border: '1px solid var(--brd)', borderRadius: '5px', padding: '3px', fontSize: '11px', cursor: 'pointer', textTransform: 'uppercase', fontWeight: 600 }}>{t}</button>
            ))}
          </div>

          {/* VAE */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--tx2)', marginBottom: '3px' }}>VAE (optional)</label>
            <select value={params.vae} onChange={(e: any) => setParam('vae', e.target.value)}
              style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '5px', padding: '4px 7px', fontSize: '12px' }}>
              <option value="">— built-in —</option>
              {vaes.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
            </select>
          </div>

          {/* Size presets */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--tx2)', marginBottom: '4px' }}>Size</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginBottom: '5px' }}>
              {SIZE_PRESETS.map(p => (
                <button key={p.label} onClick={() => { setParam('width', p.w); setParam('height', p.h); }}
                  style={{ background: params.width === p.w && params.height === p.h ? 'var(--ac)' : 'var(--bg3)', color: params.width === p.w && params.height === p.h ? '#fff' : 'var(--tx2)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '2px 5px', fontSize: '10px', cursor: 'pointer' }}>
                  {p.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              {(['width', 'height'] as const).map(k => (
                <div key={k} style={{ flex: 1 }}>
                  <label style={{ fontSize: '10px', color: 'var(--tx3)', display: 'block', marginBottom: '2px' }}>{k}</label>
                  <input type="number" min={64} max={2048} step={64} value={params[k]}
                    onInput={(e: any) => setParam(k, parseInt(e.target.value) || 512)}
                    style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '3px 5px', fontSize: '12px', textAlign: 'center' }} />
                </div>
              ))}
            </div>
          </div>

          <Slider label="Steps" value={params.steps} min={1} max={100} onChange={v => setParam('steps', v)} />
          <Slider label="CFG Scale" value={params.cfg} min={1} max={20} step={0.5} onChange={v => setParam('cfg', v)} />
          <Slider label="Batch" value={params.batch} min={1} max={8} onChange={v => setParam('batch', v)} />

          {/* Sampler */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--tx2)', marginBottom: '3px' }}>Sampler</label>
            <select value={params.sampler} onChange={(e: any) => setParam('sampler', e.target.value)}
              style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '5px', padding: '4px 7px', fontSize: '12px' }}>
              {SAMPLERS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Seed */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--tx2)', marginBottom: '3px' }}>Seed</label>
            <div style={{ display: 'flex', gap: '5px' }}>
              <input type="number" value={params.seed} onInput={(e: any) => setParam('seed', parseInt(e.target.value))}
                style={{ flex: 1, background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '5px', padding: '4px 7px', fontSize: '12px' }} />
              <button onClick={() => setParam('seed', -1)} title="Random" style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '5px', padding: '4px 7px', fontSize: '12px', cursor: 'pointer' }}>🎲</button>
            </div>
            <span style={{ fontSize: '10px', color: 'var(--tx3)' }}>-1 = random each time</span>
          </div>

          {/* LoRAs */}
          {loras.length > 0 && (
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--tx2)', marginBottom: '3px' }}>LoRAs</label>
              <select onChange={(e: any) => { addLora(e.target.value); e.target.value = ''; }}
                style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '5px', padding: '4px 7px', fontSize: '12px', marginBottom: '4px' }}>
                <option value="">+ Add LoRA…</option>
                {loras.filter(l => !selectedLoras.find(s => s.name === l.name)).map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
              </select>
              {selectedLoras.map(l => (
                <div key={l.name} style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '3px' }}>
                  <span style={{ flex: 1, fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
                  <input type="range" min={0} max={1} step={0.05} value={l.strength} onInput={(e: any) => setLoraStrength(l.name, parseFloat(e.target.value))} style={{ width: '60px', accentColor: 'var(--ac)' }} />
                  <span style={{ fontSize: '11px', color: 'var(--tx3)', width: '26px' }}>{l.strength.toFixed(2)}</span>
                  <button onClick={() => removeLora(l.name)} style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Generate button */}
        <div style={{ padding: '10px 12px', borderTop: '1px solid var(--brd)', flexShrink: 0 }}>
          {isWorking ? (
            <button onClick={cancel} style={{ width: '100%', background: '#c44', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
              ⏹ Cancel
            </button>
          ) : (
            <button onClick={generate} disabled={!params.model} style={{ width: '100%', background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', opacity: !params.model ? 0.5 : 1 }}>
              ✦ Generate {totalImages > 1 ? `(${totalImages} images)` : ''}
            </button>
          )}
          {queueLength > 0 && <div style={{ textAlign: 'center', fontSize: '11px', color: 'var(--tx3)', marginTop: '3px' }}>{queueLength} in queue</div>}
        </div>
      </div>

      {/* ══ RIGHT PANEL (gallery) ══════════════════════════════════ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--brd)', display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg2)', flexShrink: 0 }}>
          <span style={{ fontWeight: 600, fontSize: '13px', flex: 1 }}>Gallery <span style={{ color: 'var(--tx3)', fontWeight: 400, fontSize: '12px' }}>({gallery.length})</span></span>
          <button onClick={() => fetch('/api/imagegen/gallery').then(r => r.json()).then(setGallery)} style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', fontSize: '14px' }} title="Refresh">↺</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
          {gallery.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--tx3)', gap: '10px' }}>
              <span style={{ fontSize: '44px', opacity: 0.3 }}>🖼</span>
              <p style={{ margin: 0, fontSize: '13px' }}>Generated images will appear here</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '7px' }}>
              {gallery.map(img => (
                <div key={img.name}
                  style={{ position: 'relative', borderRadius: '7px', overflow: 'hidden', background: 'var(--bg3)', cursor: 'pointer', border: '2px solid transparent', transition: 'border-color 0.12s' }}
                  onClick={() => setLightbox(img)}
                  onMouseOver={(e: any) => e.currentTarget.style.borderColor = 'var(--ac)'}
                  onMouseOut={(e: any)  => e.currentTarget.style.borderColor = 'transparent'}
                >
                  <img src={`/api/imagegen/image/${encodeURIComponent(img.name)}`} alt={img.name} loading="lazy"
                    style={{ width: '100%', aspectRatio: `${params.width}/${params.height}`, objectFit: 'cover', display: 'block' }} />
                  <button
                    onClick={(e: any) => { e.stopPropagation(); fetch(`/api/imagegen/image/${encodeURIComponent(img.name)}`, { method: 'DELETE' }).then(() => setGallery(p => p.filter(i => i.name !== img.name))); }}
                    title="Delete"
                    style={{ position: 'absolute', top: '3px', right: '3px', background: 'rgba(0,0,0,0.55)', border: 'none', color: '#fff', borderRadius: '4px', padding: '1px 5px', cursor: 'pointer', fontSize: '11px', opacity: 0.8 }}
                  >✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ══ Lightbox ═══════════════════════════════════════════════ */}
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img src={`/api/imagegen/image/${encodeURIComponent(lightbox.name)}`} alt={lightbox.name}
            onClick={(e: any) => e.stopPropagation()}
            style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: '6px', boxShadow: '0 8px 40px rgba(0,0,0,0.8)' }} />
          <div style={{ position: 'absolute', bottom: '18px', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '8px' }}>
            {['◀', '▶'].map((arrow, di) => (
              <button key={arrow} onClick={(e: any) => { e.stopPropagation(); const i = gallery.findIndex(x => x.name === lightbox.name); const ni = i + (di === 0 ? -1 : 1); if (ni >= 0 && ni < gallery.length) setLightbox(gallery[ni]); }}
                style={{ background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: '5px', padding: '5px 12px', cursor: 'pointer' }}>{arrow}</button>
            ))}
            <a href={`/api/imagegen/image/${encodeURIComponent(lightbox.name)}`} download={lightbox.name} onClick={(e: any) => e.stopPropagation()}
              style={{ background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: '5px', padding: '5px 12px', textDecoration: 'none', fontSize: '13px' }}>⬇ Save</a>
          </div>
          <button onClick={() => setLightbox(null)} style={{ position: 'absolute', top: '14px', right: '14px', background: 'rgba(0,0,0,0.55)', border: 'none', color: '#fff', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer', fontSize: '15px' }}>✕</button>
        </div>
      )}

      <style>{`@keyframes igPulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }`}</style>
    </div>
  );
};
