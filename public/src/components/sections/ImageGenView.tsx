import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { appPrefs } from '../../store';

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

// ── Prompt Generator: Static (non-AI wildcard) + AI templates ────────
// Static templates use __wildcard__ from db/wildcards/ + model specific prefixes
const PROMPT_TEMPLATES: Record<string, { label: string; template: string; desc: string }> = {
  'ponyxl-default': {
    label: 'PonyXL - Quality Portrait',
    template: 'score_9, score_8_up, score_7_up, score_6_up, source_pony, __subject__, __clothing__, __pose__, __expression__, __lighting__, __style__, detailed face, sharp focus, high quality',
    desc: 'PonyXL with score tags + wildcards'
  },
  'ponyxl-scene': {
    label: 'PonyXL - Full Scene',
    template: 'score_9, score_8_up, score_7_up, __subject__, __action__, __location__, __clothing__, __lighting__, __style__, intricate details, best quality',
    desc: 'PonyXL scene with action/location'
  },
  'flux-cinematic': {
    label: 'Flux - Cinematic',
    template: 'cinematic still of __subject__, __setting__, __clothing__, dramatic __lighting__, __style__, highly detailed, photoreal, 8k, moody atmosphere',
    desc: 'Natural language good for Flux'
  },
  'flux-creative': {
    label: 'Flux - Creative',
    template: '__subject__ in __setting__, wearing __clothing__, __pose__, beautiful __lighting__, artistic __style__, intricate, masterpiece',
    desc: 'Flux creative/artistic'
  },
  'sdxl-real': {
    label: 'SDXL - Photoreal',
    template: 'photorealistic, raw photo, __subject__, __clothing__, __pose__, __lighting__, sharp focus, 8k uhd, film grain, __style__',
    desc: 'Realistic SDXL/SD1.5 style'
  },
  'general-erotic': {
    label: 'General - Erotic / NSFW',
    template: 'beautiful __subject__, __body_type__, __clothing_state__, __act__, seductive __expression__, __setting__, __lighting__, detailed skin, erotic atmosphere, __style__',
    desc: 'Porn-friendly base using wildcards'
  },
  'custom': {
    label: 'Custom template (edit below)',
    template: '__subject__, __clothing__, __pose__, __lighting__, __style__',
    desc: 'Edit your own template with __wildcards__'
  },
};

const AI_TARGETS = [
  { id: 'ponyxl', label: 'PonyXL (score tags + detailed)' },
  { id: 'flux', label: 'Flux (natural language)' },
  { id: 'sd15', label: 'SD 1.5 / Realistic' },
  { id: 'sdxl', label: 'SDXL' },
  { id: 'general', label: 'General / Any' },
];

// Simple client-side wildcard resolver (mirrors imagegen.py logic)
async function resolveStaticPrompt(
  template: string,
  cache: Map<string, string[]>
): Promise<string> {
  let prompt = template;
  const pattern = /__([a-zA-Z0-9_\/\\-]+)__/g;

  // Collect needed wildcards
  const needed = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(template)) !== null) {
    needed.add(m[1]);
  }

  // Fetch missing full lines
  for (const name of needed) {
    if (!cache.has(name)) {
      try {
        const res = await fetch(`/api/imagegen/wildcards/${encodeURIComponent(name)}`);
        const data = await res.json();
        const lines: string[] = (data.lines || []).filter((l: string) => l && !l.startsWith('#'));
        cache.set(name, lines.length ? lines : [name]);
      } catch {
        cache.set(name, [name]); // fallback keep token
      }
    }
  }

  // Resolve with limited nesting (like py)
  for (let depth = 0; depth < 8; depth++) {
    const before = prompt;
    prompt = prompt.replace(pattern, (_match, name: string) => {
      const options = cache.get(name) || [name];
      if (options.length === 0) return name;
      // simple random
      return options[Math.floor(Math.random() * options.length)];
    });
    if (prompt === before) break;
  }

  return prompt.trim();
}

// Call the existing assistant for AI prompt gen (reuses openrouter key + current model)
async function generateAIPrompt(idea: string, target: string, isNsfw: boolean): Promise<string> {
  const system = `You are an expert prompt engineer specialized in creating high-quality, detailed prompts for text-to-image models.
Target: ${target}.
${target.includes('pony') ? 'Always start with quality tags like score_9, score_8_up, score_7_up, source_pony when appropriate.' : ''}
${target.includes('flux') ? 'Write in natural, descriptive, cinematic language. Avoid heavy token lists.' : ''}
${isNsfw ? 'The user wants explicit adult/porn content. Be direct, use anatomical terms, describe body, pose, act, expression, fluids, lighting in vivid detail.' : 'Keep tasteful unless user specifies otherwise.'}
Output ONLY the final prompt text. No explanations, no quotes. Make it 40-120 tokens long, highly detailed, optimized for the target model. You may use __wildcard__ syntax if it fits naturally from known wildcards like __subject__, __lighting__ etc.`;

  const userMsg = `Create a single excellent prompt for: ${idea || 'a beautiful scene'}.`;

  const resp = await fetch('/api/assistant/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMsg }
      ],
      model: undefined // let server use saved prefs
    })
  });

  if (!resp.ok) throw new Error('Assistant request failed');

  const reader = resp.body?.getReader();
  if (!reader) throw new Error('No stream');

  const decoder = new TextDecoder();
  let full = '';
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        if (parsed.delta) full += parsed.delta;
      } catch {}
    }
  }
  return full.trim() || 'Failed to generate prompt.';
}

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
  const comfyuiPath = appPrefs.value.comfyuiPath || '';

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

  // Prompt Generator (static non-AI wildcard + AI)
  const [genMode, setGenMode] = useState<'static' | 'ai'>('static');
  const [genTemplateKey, setGenTemplateKey] = useState<keyof typeof PROMPT_TEMPLATES>('ponyxl-default');
  const [customTemplate, setCustomTemplate] = useState('');
  const [genIdea, setGenIdea] = useState('');
  const [genTarget, setGenTarget] = useState('ponyxl');
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  // cache for full wildcard lines (used by static resolver)
  const wildcardFullCache = useRef(new Map<string, string[]>()).current;

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

  // ── Prompt Generator actions (after set* for closure safety) ──────
  const doStaticGenerate = async () => {
    setGenLoading(true);
    try {
      const key = genTemplateKey as keyof typeof PROMPT_TEMPLATES;
      let tpl = PROMPT_TEMPLATES[key]?.template || '';
      if (key === 'custom') {
        tpl = customTemplate.trim() || PROMPT_TEMPLATES['custom'].template;
      }
      const result = await resolveStaticPrompt(tpl, wildcardFullCache);
      setGeneratedPrompt(result);
    } catch (e) {
      setGeneratedPrompt('Error generating static prompt: ' + (e as Error).message);
    } finally {
      setGenLoading(false);
    }
  };

  const doAIGenerate = async () => {
    if (!genIdea.trim() && !confirm('No idea entered — generate a random one?')) return;
    setGenLoading(true);
    try {
      const idea = genIdea.trim() || 'a beautiful detailed scene';
      const result = await generateAIPrompt(idea, genTarget, true /* default to allowing nsfw per project theme */);
      setGeneratedPrompt(result);
    } catch (e) {
      setGeneratedPrompt('AI generation failed: ' + (e as Error).message + ' (check OpenRouter key in Settings or Assistant)');
    } finally {
      setGenLoading(false);
    }
  };

  const applyGenerated = (toField: 'prompt' | 'negative', mode: 'replace' | 'append') => {
    if (!generatedPrompt) return;
    const current = toField === 'prompt' ? params.prompt : params.negative;
    const newVal = mode === 'replace' ? generatedPrompt : (current ? current + ', ' + generatedPrompt : generatedPrompt);
    setParam(toField, newVal);
    setActiveField(toField);
  };

  const copyGenerated = () => {
    if (generatedPrompt) {
      navigator.clipboard?.writeText(generatedPrompt);
    }
  };

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
          {comfyuiPath && (
            <button
              type="button"
              onClick={async () => {
                const r = await fetch('/api/imagegen/comfyui/start', { method: 'POST' });
                const d = await r.json();
                if (d.error) alert(d.error);
                else if (!d.already) window.toast?.('ComfyUI started — open http://localhost:8188');
              }}
              title="Launch ComfyUI web UI"
              style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', whiteSpace: 'nowrap', fontSize: '11px' }}
            >ComfyUI ▶</button>
          )}
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

          {/* ── Prompt Generator (static non-AI + AI) ───────────────── */}
          <div style={{ border: '1px solid var(--brd)', borderRadius: '6px', background: 'var(--bg3)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '5px 8px', background: 'var(--bg2)', borderBottom: '1px solid var(--brd)' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--tx2)', flex: 1 }}>✨ Prompt Generator</span>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button onClick={() => setGenMode('static')} style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '3px', border: genMode==='static' ? '1px solid var(--ac)' : '1px solid var(--brd)', background: genMode==='static' ? 'var(--ac)' : 'transparent', color: genMode==='static' ? '#fff' : 'var(--tx2)', cursor: 'pointer' }}>Static</button>
                <button onClick={() => setGenMode('ai')} style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '3px', border: genMode==='ai' ? '1px solid var(--ac)' : '1px solid var(--brd)', background: genMode==='ai' ? 'var(--ac)' : 'transparent', color: genMode==='ai' ? '#fff' : 'var(--tx2)', cursor: 'pointer' }}>AI</button>
              </div>
            </div>

            {genMode === 'static' && (
              <div style={{ padding: '6px 8px', fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <select value={genTemplateKey} onChange={(e: any) => setGenTemplateKey(e.target.value)} style={{ width: '100%', background: 'var(--bg)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '2px 4px', fontSize: '11px' }}>
                  {Object.entries(PROMPT_TEMPLATES).map(([k, t]) => (
                    <option key={k} value={k}>{t.label}</option>
                  ))}
                </select>
                {genTemplateKey === 'custom' && (
                  <textarea value={customTemplate} onInput={(e: any) => setCustomTemplate(e.target.value)} placeholder="Custom: __subject__, __lighting__ ..." rows={2} style={{ width: '100%', fontSize: '10px', fontFamily: 'monospace', background: 'var(--bg)', border: '1px solid var(--brd)', borderRadius: '3px', padding: '3px' }} />
                )}
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button onClick={doStaticGenerate} disabled={genLoading} style={{ flex: 1, background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '4px', padding: '3px 6px', fontSize: '11px', cursor: 'pointer' }}>{genLoading ? '...' : 'Generate Static (wildcards)'}</button>
                  <button onClick={() => setGeneratedPrompt('')} style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '4px', padding: '3px 6px', fontSize: '11px' }}>Clear</button>
                </div>
              </div>
            )}

            {genMode === 'ai' && (
              <div style={{ padding: '6px 8px', fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <input value={genIdea} onInput={(e: any) => setGenIdea(e.target.value)} placeholder="Idea: 'cyberpunk hacker girl in rain'" style={{ width: '100%', fontSize: '11px', background: 'var(--bg)', border: '1px solid var(--brd)', borderRadius: '3px', padding: '3px 4px' }} />
                <select value={genTarget} onChange={(e: any) => setGenTarget(e.target.value)} style={{ width: '100%', background: 'var(--bg)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '2px 4px', fontSize: '11px' }}>
                  {AI_TARGETS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button onClick={doAIGenerate} disabled={genLoading} style={{ flex: 1, background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '4px', padding: '3px 6px', fontSize: '11px', cursor: 'pointer' }}>{genLoading ? 'Asking AI...' : 'Generate with AI'}</button>
                  <button onClick={() => setGeneratedPrompt('')} style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '4px', padding: '3px 6px', fontSize: '11px' }}>Clear</button>
                </div>
                <div style={{ fontSize: '9px', color: 'var(--tx3)' }}>Uses your Assistant OpenRouter key + model prefs. Good for Pony/Flux/SD.</div>
              </div>
            )}

            {generatedPrompt && (
              <div style={{ borderTop: '1px solid var(--brd)', padding: '6px 8px', background: 'var(--bg)' }}>
                <div style={{ fontSize: '10px', color: 'var(--tx3)', marginBottom: '2px' }}>Generated:</div>
                <div style={{ fontSize: '10px', fontFamily: 'monospace', background: 'var(--bg3)', padding: '4px', borderRadius: '3px', maxHeight: '60px', overflow: 'auto', whiteSpace: 'pre-wrap', border: '1px solid var(--brd)' }}>
                  {generatedPrompt}
                </div>
                <div style={{ display: 'flex', gap: '3px', marginTop: '4px', flexWrap: 'wrap' }}>
                  <button onClick={() => applyGenerated('prompt', 'replace')} style={{ fontSize: '9px', padding: '1px 5px', background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>→ Pos</button>
                  <button onClick={() => applyGenerated('prompt', 'append')} style={{ fontSize: '9px', padding: '1px 5px', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '3px', cursor: 'pointer' }}>Append Pos</button>
                  <button onClick={() => applyGenerated('negative', 'replace')} style={{ fontSize: '9px', padding: '1px 5px', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '3px', cursor: 'pointer' }}>→ Neg</button>
                  <button onClick={copyGenerated} style={{ fontSize: '9px', padding: '1px 5px', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '3px', cursor: 'pointer' }}>Copy</button>
                </div>
              </div>
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
