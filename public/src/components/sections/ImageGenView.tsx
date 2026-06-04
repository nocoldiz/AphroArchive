import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { appPrefs, imagegenInputState, activeProfile } from '../../store';
import {
  PROMPT_TEMPLATES,
  MODEL_TARGETS,
  type ModelTarget,
  quickRandomCharacterPrompt,
  getModelLabel,
  countCombinations as countCombs,
  // New advanced builder
  type BuilderState,
  type BuilderNumChars,
  type CharSpec,
  DEFAULT_BUILDER,
  BUILDER_CATEGORY_WILDCARDS,
  AGE_PRESETS,
  buildPromptFromBuilder,
  inspireRandomBuilder,
  pickRandomForCategory,
  HARDCODED_OPTIONS,
  HARDCODED_OPTION_ALIASES,
  PROMPT_PRESETS,
  isNsfwPhrase,
  SFW_THRESHOLD,
  sanitizeBuilderStateForLevel,
} from '../../characterPrompts';

// ── Types ─────────────────────────────────────────────────────────────

interface AssetFile { name: string; size: number; mtime?: number; }
interface WildcardFile { name: string; file: string; count: number; preview: string[]; }
interface LoraEntry  { name: string; strength: number; }

interface GenParams {
  model:         string;
  model_type:    'sd15' | 'sdxl' | 'pony' | 'flux';
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
}

interface GalleryImage { name: string; size: number; mtime: number; }
interface InputImage { url: string; serverPath: string; name: string; }

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
const SPEED_PRESETS = [
  { label: 'Ultra Fast',   steps: 4,  cfg: 1.0, sampler: 'lcm' },
  { label: 'Fast',         steps: 8,  cfg: 2.0, sampler: 'lcm' },
  { label: 'Balanced',     steps: 20, cfg: 7.0, sampler: 'euler' },
  { label: 'Quality',      steps: 30, cfg: 8.0, sampler: 'dpm++_2m' },
  { label: 'High Quality', steps: 40, cfg: 9.0, sampler: 'dpm++_sde' },
];
const DEFAULT_NEGATIVE = 'lowres, bad anatomy, bad hands, text, error, cropped, worst quality, low quality, jpeg artifacts, signature, watermark, blurry';
const STATUS_DOT: Record<string, string> = {
  stopped: 'var(--tx3)', idle: '#4caf50', loading: '#ff9800',
  generating: 'var(--ac)', queued: '#2196f3', error: '#e53935',
};

async function resolveStaticPrompt(template: string, cache: Map<string, string[]>): Promise<string> {
  let prompt = template;
  const pattern = /__([a-zA-Z0-9_\/\\-]+)__/g;
  const needed = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(template)) !== null) needed.add(m[1]);
  for (const name of needed) {
    if (!cache.has(name)) {
      try {
        const res = await fetch(`/api/imagegen/wildcards/${encodeURIComponent(name)}`);
        const data = await res.json();
        const lines: string[] = (data.lines || []).filter((l: string) => l && !l.startsWith('#'));
        cache.set(name, lines.length ? lines : [name]);
      } catch { cache.set(name, [name]); }
    }
  }
  for (let depth = 0; depth < 8; depth++) {
    const before = prompt;
    prompt = prompt.replace(pattern, (_match, name: string) => {
      const options = cache.get(name) || [name];
      return options[Math.floor(Math.random() * options.length)];
    });
    if (prompt === before) break;
  }
  return prompt.trim();
}

function countCombos(prompt: string): number {
  let total = 1;
  const re = /\{([^{}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null) total *= m[1].split('|').length;
  return total;
}

// Load options for the character editor + new builder dropdowns.
// PRIMARY source: HARDCODED_OPTIONS in characterPrompts.ts (so the prompt generator
// no longer requires manually maintaining files in db/wildcards/ folder).
// The optional server fetch only augments with any extra custom wildcards the user may have.
async function loadCharOptions(cache: Map<string, string[]>, setter: (o: Record<string, string[]>) => void) {
  const out: Record<string, string[]> = { age: AGE_PRESETS.slice() };

  // 1. Hardcoded (always present, folder/network not required for generator)
  for (const [k, arr] of Object.entries(HARDCODED_OPTIONS)) {
    out[k] = (arr || []).slice(0, 100);
  }
  // aliases used by legacy char editor and current selects
  for (const [alias, target] of Object.entries(HARDCODED_OPTION_ALIASES)) {
    if (HARDCODED_OPTIONS[target] && !out[alias]) {
      out[alias] = HARDCODED_OPTIONS[target].slice(0, 80);
    }
  }
  if (HARDCODED_OPTIONS['hairColor'] && !out['hairColor']) out['hairColor'] = HARDCODED_OPTIONS['hairColor'].slice(0, 60);
  if (HARDCODED_OPTIONS['body'] && !out['bodyType']) out['bodyType'] = HARDCODED_OPTIONS['body'].slice(0, 60);
  if (HARDCODED_OPTIONS['breasts'] && !out['breastSize']) out['breastSize'] = HARDCODED_OPTIONS['breasts'].slice(0, 50);
  if ((HARDCODED_OPTIONS['clothing'] || HARDCODED_OPTIONS['clothes']) && !out['clothes']) {
    out['clothes'] = (HARDCODED_OPTIONS['clothing'] || HARDCODED_OPTIONS['clothes']).slice(0, 80);
  }
  if (HARDCODED_OPTIONS['eyeColor'] && !out['eyeColor']) out['eyeColor'] = HARDCODED_OPTIONS['eyeColor'].slice(0, 40);
  if ((HARDCODED_OPTIONS['nationality'] || HARDCODED_OPTIONS['ethnicity']) && !out['nationality']) {
    out['nationality'] = (HARDCODED_OPTIONS['nationality'] || HARDCODED_OPTIONS['ethnicity']).slice(0, 50);
  }
  if (HARDCODED_OPTIONS['ethnicity'] && !out['ethnicity']) out['ethnicity'] = HARDCODED_OPTIONS['ethnicity'].slice(0, 50);

  // 2. Optional: augment from server (custom wildcards) — best effort only.
  // If folder is empty or server not running the imagegen routes, we simply ignore.
  try {
    const map: Record<string, string[]> = {
      gender: ['Gender-All', 'Gender'],
      nationality: ['Nationality-Race', 'ethnicity'],
      eyeColor: ['Pupil-Color', 'eyes'],
      hairColor: ['haircolor'],
      bodyType: ['body_type'],
      breastSize: ['breasts'],
      clothes: ['clothing_state', 'Outfits', 'full_outfits', 'Lingerie', 'Costumes'],
    };
    for (const [cat, names] of Object.entries(BUILDER_CATEGORY_WILDCARDS)) {
      if (!map[cat]) map[cat] = names;
    }
    for (const [k, names] of Object.entries(map)) {
      for (const name of names) {
        if (!cache.has(name)) {
          try {
            const res = await fetch(`/api/imagegen/wildcards/${encodeURIComponent(name)}`);
            if (res.ok) {
              const data = await res.json();
              const l: string[] = (data.lines || []).filter((x: string) => x && !x.startsWith('#'));
              if (l.length) cache.set(name, l);
            }
          } catch { /* folder is optional */ }
        }
        const got = cache.get(name);
        if (got && got.length) {
          const current = new Set(out[k] || []);
          got.forEach((x: string) => { if (x && !x.startsWith('#')) current.add(x); });
          out[k] = Array.from(current).slice(0, 120);
        }
      }
    }
  } catch { /* never break the prompt generator */ }

  setter(out);
}

function buildCustomSubject(ov: Record<string, string>): string {
  const p: string[] = [];
  const age = (ov.age || '').trim();
  if (age) p.push(/^\d/.test(age) || age.toLowerCase().includes('year') ? age : age + ' year old');
  const nat = (ov.nationality || '').trim();
  if (nat) p.push(nat);
  const g = (ov.gender || 'woman').trim();
  if (g) p.push(g);
  const eye = (ov.eyeColor || '').trim();
  if (eye) p.push(eye + ' eyes');
  const hair = (ov.hairColor || '').trim();
  if (hair) p.push(hair + ' hair');
  const body = (ov.bodyType || '').trim();
  if (body) p.push(body);
  const br = (ov.breastSize || '').trim();
  if (br) p.push(br + ' breasts');
  let s = p.join(', ').replace(/\s*,\s*,/g, ',').trim();
  const cl = (ov.clothes || '').trim();
  if (cl) s += (s ? ', wearing ' : 'wearing ') + cl;
  return s ? ('beautiful ' + s).replace(/,\s*$/, '') : '';
}

function insertAtCursor(ref: { current: HTMLTextAreaElement | null }, current: string, insert: string, setter: (v: string) => void) {
  const el = ref.current;
  if (!el) { setter(current + insert); return; }
  const s = el.selectionStart ?? current.length;
  const e = el.selectionEnd ?? current.length;
  setter(current.slice(0, s) + insert + current.slice(e));
  requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + insert.length, s + insert.length); });
}

// ── Slider ────────────────────────────────────────────────────────────

function Slider({ label, value, min, max, step = 1, unit = '', onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--tx2)', marginBottom: '2px' }}>
        <span>{label}</span><b style={{ color: 'var(--tx)' }}>{value}{unit}</b>
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
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!name) return;
    fetch(`/api/imagegen/wildcards/${encodeURIComponent(name)}`).then(r => r.json()).then(d => setContent(d.content || '')).catch(() => {});
  }, [name]);
  const save = async () => {
    setSaving(true);
    await fetch(`/api/imagegen/wildcards/${encodeURIComponent(name)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }).catch(() => {});
    setSaving(false); onSaved(); onClose();
  };
  const lineCount = content.split('\n').filter(l => l.trim() && !l.startsWith('#')).length;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '12px', width: 'min(520px, 94vw)', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontWeight: 700, fontSize: '14px', flex: 1 }}>Edit wildcard: <code style={{ color: 'var(--ac)' }}>{name}</code></span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', fontSize: '16px' }}>✕</button>
        </div>
        <textarea value={content} onInput={(e: any) => setContent(e.target.value)} rows={14} spellcheck={false}
          style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '8px', fontSize: '13px', fontFamily: 'monospace', lineHeight: '1.5' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>{lineCount} option{lineCount !== 1 ? 's' : ''}</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={onClose} style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '6px', padding: '6px 14px', cursor: 'pointer', fontSize: '13px' }}>Cancel</button>
            <button onClick={save} disabled={saving} style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 16px', cursor: 'pointer', fontSize: '13px', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── WildcardsPanel ────────────────────────────────────────────────────

function WildcardsPanel({ wildcards, onRefresh, onInsert, activeField }: {
  wildcards: WildcardFile[]; onRefresh: () => void; onInsert: (token: string) => void; activeField: 'prompt' | 'negative';
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const deleteWc = async (name: string) => {
    if (!confirm(`Delete wildcard "${name}"?`)) return;
    await fetch(`/api/imagegen/wildcards/${encodeURIComponent(name)}`, { method: 'DELETE' });
    onRefresh();
  };
  const createWc = async () => {
    const safe = newName.trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
    if (!safe) return;
    await fetch(`/api/imagegen/wildcards/${encodeURIComponent(safe)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: `# ${safe} wildcard\n` }) });
    setNewName(''); setCreating(false); onRefresh(); setEditing(safe);
  };

  return (
    <div style={{ fontSize: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
        <span style={{ color: 'var(--tx3)', fontSize: '11px', flex: 1 }}>Insert <code style={{ color: 'var(--ac)' }}>__name__</code> into {activeField}</span>
        <button onClick={() => setCreating(v => !v)} style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', fontSize: '11px' }}>+ New</button>
      </div>
      {creating && (
        <div style={{ display: 'flex', gap: '5px', marginBottom: '6px' }}>
          <input value={newName} onInput={(e: any) => setNewName(e.target.value)} placeholder="wildcard_name"
            onKeyDown={(e: any) => e.key === 'Enter' && createWc()}
            style={{ flex: 1, background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '3px 6px', fontSize: '12px' }} autoFocus />
          <button onClick={createWc} style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '4px', padding: '3px 8px', cursor: 'pointer' }}>Create</button>
          <button onClick={() => setCreating(false)} style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx3)', borderRadius: '4px', padding: '3px 6px', cursor: 'pointer' }}>✕</button>
        </div>
      )}
      {wildcards.length === 0 ? (
        <div style={{ color: 'var(--tx3)', fontSize: '11px', padding: '8px 0' }}>No wildcards in <code>db/wildcards/</code>.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          {wildcards.map(wc => (
            <div key={wc.name} style={{ background: 'var(--bg3)', borderRadius: '5px', border: '1px solid var(--brd)', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 7px' }}>
                <button onClick={() => onInsert(`__${wc.name}__`)} title={`Insert __${wc.name}__`}
                  style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', color: 'var(--ac)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px', padding: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  __{wc.name}__
                </button>
                <span style={{ fontSize: '10px', color: 'var(--tx3)', flexShrink: 0 }}>{wc.count}</span>
                <button onClick={() => setExpanded(v => v === wc.name ? null : wc.name)}
                  style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: '0 2px', fontSize: '11px' }}>{expanded === wc.name ? '▲' : '▼'}</button>
                <button onClick={() => setEditing(wc.name)}
                  style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: '0 2px', fontSize: '11px' }}>✏</button>
                <button onClick={() => deleteWc(wc.name)}
                  style={{ background: 'none', border: 'none', color: '#c44', cursor: 'pointer', padding: '0 2px', fontSize: '11px' }}>✕</button>
              </div>
              {expanded === wc.name && wc.preview.length > 0 && (
                <div style={{ padding: '3px 7px 6px', borderTop: '1px solid var(--brd)', display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                  {wc.preview.map((p, i) => <span key={i} style={{ background: 'var(--bg)', border: '1px solid var(--brd)', borderRadius: '3px', padding: '1px 5px', fontSize: '11px', color: 'var(--tx2)' }}>{p}</span>)}
                  {wc.count > wc.preview.length && <span style={{ fontSize: '11px', color: 'var(--tx3)', padding: '1px 4px' }}>+{wc.count - wc.preview.length} more</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {editing && <WildcardEditor name={editing} onClose={() => setEditing(null)} onSaved={onRefresh} />}
    </div>
  );
}

// ── Gallery Drawer ────────────────────────────────────────────────────

function GalleryDrawer({ gallery, open, onClose, onDeleteImage, onLightbox, genWidth, genHeight }: {
  gallery: GalleryImage[];
  open: boolean;
  onClose: () => void;
  onDeleteImage: (name: string) => void;
  onLightbox: (img: GalleryImage) => void;
  genWidth: number;
  genHeight: number;
}) {
  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          onClick={onClose}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100 }}
        />
      )}

      {/* Drawer panel */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: open ? '62vh' : '0',
        background: 'var(--bg2)',
        borderTop: '1px solid var(--brd)',
        zIndex: 1101,
        transition: 'height 0.28s cubic-bezier(0.4,0,0.2,1)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: open ? '0 -8px 32px rgba(0,0,0,0.35)' : 'none',
      }}>
        {/* Drawer handle bar */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--brd)', flexShrink: 0 }}>
          <span style={{ fontWeight: 600, fontSize: '13px', flex: 1 }}>
            Generated Images
            <span style={{ color: 'var(--tx3)', fontWeight: 400, fontSize: '12px', marginLeft: '6px' }}>{gallery.length}</span>
          </span>
          <button
            onClick={() => fetch('/api/imagegen/gallery').then(r => r.json()).then(() => {})}
            style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', fontSize: '14px', padding: '4px 8px' }}
            title="Refresh"
          >↺</button>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', fontSize: '16px', padding: '4px 8px', lineHeight: 1 }}>
            ✕
          </button>
        </div>

        {/* Gallery content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
          {gallery.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--tx3)', gap: '10px' }}>
              <span style={{ fontSize: '40px', opacity: 0.25 }}>🖼</span>
              <p style={{ margin: 0, fontSize: '13px' }}>Generated images will appear here</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '8px' }}>
              {gallery.map(img => (
                <div key={img.name}
                  style={{ position: 'relative', borderRadius: '7px', overflow: 'hidden', background: 'var(--bg3)', cursor: 'pointer', border: '2px solid transparent', transition: 'border-color 0.12s' }}
                  onClick={() => onLightbox(img)}
                  onMouseOver={(e: any) => e.currentTarget.style.borderColor = 'var(--ac)'}
                  onMouseOut={(e: any) => e.currentTarget.style.borderColor = 'transparent'}
                >
                  <img
                    src={`/api/imagegen/image/${encodeURIComponent(img.name)}`}
                    alt={img.name}
                    loading="lazy"
                    style={{ width: '100%', aspectRatio: `${genWidth}/${genHeight}`, objectFit: 'cover', display: 'block' }}
                  />
                  <button
                    onClick={(e: any) => { e.stopPropagation(); onDeleteImage(img.name); }}
                    title="Delete"
                    style={{ position: 'absolute', top: '4px', right: '4px', background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer', fontSize: '11px' }}
                  >✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
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
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [params, setParams] = useState<GenParams>({
    model: '', model_type: 'sd15', vae: '',
    prompt: '', negative: DEFAULT_NEGATIVE,
    width: 512, height: 768, steps: 20, cfg: 7.5,
    sampler: 'euler', seed: -1, batch: 1,
  });
  const [selectedLoras, setSelectedLoras] = useState<LoraEntry[]>([]);

  const [configOpen,    setConfigOpen]    = useState(false);
  const [wildcardsOpen, setWildcardsOpen] = useState(true);
  const [modelsDir, setModelsDir] = useState('');
  const [vaesDir,   setVaesDir]   = useState('');
  const [lorasDir,  setLorasDir]  = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [devicePref, setDevicePref] = useState<'auto'|'cpu'|'cuda'|'mps'>('auto');

  const [activeField, setActiveField] = useState<'prompt' | 'negative'>('prompt');
  const promptRef   = useRef<HTMLTextAreaElement>(null);
  const negativeRef = useRef<HTMLTextAreaElement>(null);

  const [genMode, setGenMode] = useState<'static' | 'advanced'>('static');
  const [genTemplateKey, setGenTemplateKey] = useState<keyof typeof PROMPT_TEMPLATES>('ponyxl-default');
  const [customTemplate, setCustomTemplate] = useState('');
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const wildcardFullCache = useRef(new Map<string, string[]>()).current;

  const [advTarget, setAdvTarget] = useState<ModelTarget>('ponyxl');
  const [advNsfw, setAdvNsfw] = useState(true);
  const [advPrompt, setAdvPrompt] = useState('');
  const [advLoading, setAdvLoading] = useState(false);

  // Character Editor state for building fixed subject traits (legacy small editor)
  const [charOverrides, setCharOverrides] = useState<Record<string, string>>({});
  const [charOptions, setCharOptions] = useState<Record<string, string[]>>({});
  const [showCharEditor, setShowCharEditor] = useState(true);

  // Full advanced customizable builder state (dropdown series for settings, background, porn type, photography, multi-char etc)
  const [builder, setBuilder] = useState<BuilderState>({ ...DEFAULT_BUILDER });
  const [builderPreview, setBuilderPreview] = useState('');
  const [showBuilderDetails, setShowBuilderDetails] = useState(true);
  // Pinned fields (by key e.g. 'gender-0', 'age-1', 'action', 'background') are protected from master "Inspire All" shuffle
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const togglePin = (key: string) => {
    setPinned(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const isPinned = (key: string) => pinned.has(key);

  const [generating, setGenerating] = useState(false);
  const [promptGenOpen, setPromptGenOpen] = useState(false);

  // ── Img2img / input image state ──────────────────────────────────
  const [inputImages, setInputImages]   = useState<InputImage[]>([]);
  const [imgMode, setImgMode]           = useState<'txt2img' | 'img2img'>('txt2img');
  const [imgStrength, setImgStrength]   = useState(0.65);
  const [imgPanelOpen, setImgPanelOpen] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [massGenOpen, setMassGenOpen] = useState(false);
  const [massGenCount, setMassGenCount] = useState(10);
  const [massGenResults, setMassGenResults] = useState<string[]>([]);
  const [massGenLoading, setMassGenLoading] = useState(false);
  const evsRef = useRef<EventSource | null>(null);

  const comboCount  = countCombos(params.prompt);
  const totalImages = comboCount * params.batch;

  // ── Load ────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    try {
      if (appPrefs.value.comfyuiPath) {
        await fetch('/api/imagegen/comfyui/sync', { method: 'POST' }).catch(() => {});
      }
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
      setDevicePref((cfgRes.device || 'auto') as 'auto'|'cpu'|'cuda'|'mps');
      if (cfgRes.model) setParams(p => ({ ...p, model: cfgRes.model, model_type: cfgRes.modelType || 'sd15', vae: cfgRes.vae || '' }));
      setEngineRunning(cfgRes.engine?.running || false);
      setEngineReady(cfgRes.engine?.ready || false);
      setEngineDevice(cfgRes.engine?.device || '');
      if (cfgRes.engine?.status) setEngineStatus(cfgRes.engine.status);
    } catch {}
  }, []);

  useEffect(() => { loadAll(); }, []);
  useEffect(() => { if (comfyuiPath) loadAll(); }, [comfyuiPath]);

  // Consume imagegenInputState set by ContextMenu or PlayerView
  useEffect(() => {
    const pending = imagegenInputState.value;
    if (!pending) return;
    imagegenInputState.value = null;

    const { imageUrl, imagePath } = pending;
    if (imagePath) {
      // Already has a server path (from frame capture)
      const name = imagePath.split(/[\\/]/).pop() || 'input.jpg';
      setInputImages([{ url: imageUrl, serverPath: imagePath, name }]);
      setImgMode('img2img');
      setImgPanelOpen(true);
    } else if (imageUrl) {
      // Photo from context menu — fetch and upload
      (async () => {
        try {
          const blob = await fetch(imageUrl).then(r => r.blob());
          const ext = blob.type.includes('png') ? '.png' : '.jpg';
          const fname = 'photo' + ext;
          const r = await fetch('/api/imagegen/upload', {
            method: 'POST',
            headers: { 'x-filename': fname, 'Content-Type': blob.type },
            body: blob,
          });
          const d = await r.json();
          if (d.ok) {
            setInputImages([{ url: URL.createObjectURL(blob), serverPath: d.path, name: d.name }]);
            setImgMode('img2img');
            setImgPanelOpen(true);
          }
        } catch { /* best-effort */ }
      })();
    }
  }, []);

  // Preload character editor options on startup so selects are ready in prompt builder
  useEffect(() => {
    loadCharOptions(wildcardFullCache, setCharOptions).catch(() => {});
  }, []);

  // Auto-refresh builder preview when selections change (cheap, keeps UI live).
  // Also update generatedPrompt so "generated prompt" footer + apply buttons reflect live changes on dropdown edits.
  useEffect(() => {
    if (genMode !== 'advanced') return;
    try {
      const p = buildPromptFromBuilder(builder, undefined); // no resolve for speed, Compose can resolve
      setBuilderPreview(p);
      setGeneratedPrompt(p);
    } catch {}
  }, [builder, genMode]);

  const reloadWildcards = async () => {
    try { const r = await fetch('/api/imagegen/assets').then(r => r.json()); setWildcards(r.wildcards || []); } catch {}
  };

  // ── SSE ─────────────────────────────────────────────────────────

  useEffect(() => {
    const evs = new EventSource('/api/imagegen/progress');
    evsRef.current = evs;
    evs.onmessage = (e) => { try { handleMsg(JSON.parse(e.data)); } catch {} };
    return () => evs.close();
  }, []);

  const handleMsg = (msg: any) => {
    if (msg.queueLength != null) setQueueLength(msg.queueLength);
    switch (msg.type) {
      case 'init': case 'ready':
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
        setEngineStatus({ state: 'generating', step: msg.step, total: msg.total, pct: msg.pct,
          message: `Step ${msg.step}/${msg.total}${(msg.combo_total||1) > 1 ? ` · image ${(msg.combo_idx||0)+1}/${msg.combo_total}` : ''}`,
          comboIdx: msg.combo_idx, comboTotal: msg.combo_total });
        break;
      case 'done':
        setGenerating(false);
        setEngineStatus({ state: 'idle', step: 0, total: 0, pct: 100, message: `Done in ${msg.elapsed}s — ${msg.count} image(s)` });
        if (activeProfile.value === 'Vault' && msg.paths?.length) {
          // Auto-encrypt into vault when vault profile is active
          Promise.all((msg.paths as string[]).map(p =>
            fetch('/api/imagegen/encrypt-generated', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename: p.split(/[\\/]/).pop() }),
            }).catch(() => {})
          )).then(() => {
            fetch('/api/imagegen/gallery').then(r => r.json()).then(d => { setGallery(d); setDrawerOpen(true); }).catch(() => {});
          });
        } else {
          fetch('/api/imagegen/gallery').then(r => r.json()).then(d => { setGallery(d); setDrawerOpen(true); }).catch(() => {});
        }
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

  const buildGenerateBody = (imagePath = '') => ({
    ...params,
    loras: selectedLoras.map(l => l.name),
    lora_strengths: selectedLoras.map(l => l.strength),
    mode: (imagePath || (imgMode === 'img2img' && inputImages.length > 0)) ? 'img2img' : 'txt2img',
    image_path: imagePath || (imgMode === 'img2img' && inputImages.length > 0 ? inputImages[0].serverPath : ''),
    strength: imgStrength,
  });

  const generate = async () => {
    if (!params.model)        { alert('Select a model first'); return; }
    if (!params.prompt.trim()){ alert('Enter a prompt');        return; }
    if (!engineRunning) await startEngine();
    const body = buildGenerateBody();
    const r = await fetch('/api/imagegen/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if (d.error) { alert(d.error); return; }
    setGenerating(true);
    setEngineStatus(s => ({ ...s, state: 'queued', message: 'Queued…' }));
  };

  // Generate with same prompt for each input image (batch mode)
  const generateBatch = async () => {
    if (!params.model)        { alert('Select a model first'); return; }
    if (!params.prompt.trim()){ alert('Enter a prompt');        return; }
    if (inputImages.length === 0) { alert('Load at least one image'); return; }
    if (!engineRunning) await startEngine();
    setBatchRunning(true);
    for (const img of inputImages) {
      const body = buildGenerateBody(img.serverPath);
      const r = await fetch('/api/imagegen/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.error) { alert(`Batch error: ${d.error}`); break; }
    }
    setGenerating(true);
    setEngineStatus(s => ({ ...s, state: 'queued', message: `Batch: ${inputImages.length} images queued…` }));
    setBatchRunning(false);
  };

  const saveConfig = async () => {
    await fetch('/api/imagegen/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelsDir, vaesDir, lorasDir, outputDir, model: params.model, vae: params.vae, modelType: params.model_type, device: devicePref }) });
    await loadAll(); setConfigOpen(false);
  };

  const setParam = <K extends keyof GenParams>(k: K, v: GenParams[K]) => setParams(p => ({ ...p, [k]: v }));

  const autoDetectType = (name: string): GenParams['model_type'] => {
    const n = name.toLowerCase();
    if (n.includes('flux')) return 'flux';
    if (n.includes('pony') || n.includes('pdxl')) return 'pony';
    if (n.includes('xl') || n.includes('sdxl')) return 'sdxl';
    if (n.endsWith('.gguf')) return 'flux';
    return 'sd15';
  };

  const selectModel = (name: string) => {
    setParams(p => ({ ...p, model: name, model_type: autoDetectType(name) }));
  };
  const addLora = (name: string) => { if (selectedLoras.find(l => l.name === name)) return; setSelectedLoras(p => [...p, { name, strength: 0.7 }]); };
  const removeLora = (name: string) => setSelectedLoras(p => p.filter(l => l.name !== name));
  const setLoraStrength = (name: string, s: number) => setSelectedLoras(p => p.map(l => l.name === name ? { ...l, strength: s } : l));

  const doStaticGenerate = async () => {
    setGenLoading(true);
    try {
      const key = genTemplateKey as keyof typeof PROMPT_TEMPLATES;
      let tpl = PROMPT_TEMPLATES[key]?.template || '';
      if (key === 'custom') tpl = customTemplate.trim() || PROMPT_TEMPLATES['custom'].template;
      setGeneratedPrompt(await resolveStaticPrompt(tpl, wildcardFullCache));
    } catch (e) { setGeneratedPrompt('Error: ' + (e as Error).message); }
    finally { setGenLoading(false); }
  };

  const doAdvancedRandomize = async () => {
    setAdvLoading(true);
    try {
      const subj = Object.keys(charOverrides).length > 0 ? buildCustomSubject(charOverrides) : undefined;
      const result = await quickRandomCharacterPrompt(advTarget, advNsfw, wildcardFullCache, subj || undefined);
      setAdvPrompt(result); setGeneratedPrompt(result);
    } catch (e) { const msg = 'Failed: ' + (e as Error).message; setAdvPrompt(msg); setGeneratedPrompt(msg); }
    finally { setAdvLoading(false); }
  };

  async function randomizeChar() {
    let opts = charOptions;
    if (Object.keys(opts).length === 0) {
      await loadCharOptions(wildcardFullCache, (o) => { opts = o; setCharOptions(o); });
    }
    const next: Record<string, string> = {};
    Object.keys(opts).forEach(k => {
      const pool = opts[k] || [];
      const usable = pool[0] === '' ? pool.slice(1) : pool;
      if (usable.length > 0) {
        next[k] = usable[Math.floor(Math.random() * usable.length)];
      }
    });
    setCharOverrides(next);
  }

  // ── New rich builder handlers (dropdowns + wildcard inspiration) ─────
  const updateBuilder = (patch: Partial<BuilderState>) => {
    setBuilder(b => {
      const next = { ...b, ...patch } as BuilderState;
      // keep chars length in sync if numChars changes (only for manual num buttons; presets provide their own chars array)
      if (patch.numChars != null && patch.numChars !== b.numChars && !patch.chars) {
        const arr = [...(b.chars || [])];
        while (arr.length < patch.numChars) arr.push({});
        next.chars = arr.slice(0, patch.numChars);
      }
      // ensure nsfwLevel always present (migration / old partials)
      if (typeof next.nsfwLevel !== 'number') {
        next.nsfwLevel = (typeof b.nsfwLevel === 'number' ? b.nsfwLevel : (next.nsfw ? 70 : 10));
      }
      next.nsfw = next.nsfwLevel > 20;
      return next;
    });
  };

  const updateChar = (idx: number, patch: Partial<CharSpec>) => {
    setBuilder(b => {
      const chars = [...(b.chars || [])];
      chars[idx] = { ...(chars[idx] || {}), ...patch };
      return { ...b, chars };
    });
  };

  const setNumChars = (n: BuilderNumChars) => {
    updateBuilder({ numChars: n });
  };

  const inspireBuilder = async () => {
    let opts = charOptions;
    if (Object.keys(opts).length < 5) {
      await loadCharOptions(wildcardFullCache, (o) => { opts = o; setCharOptions(o); });
    }
    const inspired = inspireRandomBuilder(builder, pinned, wildcardFullCache);
    setBuilder(inspired);
    setAdvTarget(inspired.target);
    setAdvNsfw(inspired.nsfw);
    // also live preview
    const preview = buildPromptFromBuilder(inspired, wildcardFullCache);
    setBuilderPreview(preview);
    setGeneratedPrompt(preview);
  };

  const composeBuilderPrompt = (resolvePreview = false) => {
    const p = buildPromptFromBuilder(builder, resolvePreview ? wildcardFullCache : undefined);
    setBuilderPreview(p);
    setGeneratedPrompt(p);
    return p;
  };

  const doMassGenerate = async () => {
    setMassGenLoading(true);
    try {
      const results: string[] = [];
      if (genMode === 'advanced') {
        const template = buildPromptFromBuilder(builder, undefined);
        for (let i = 0; i < massGenCount; i++) {
          results.push(await resolveStaticPrompt(template, wildcardFullCache));
        }
      } else {
        const key = genTemplateKey as keyof typeof PROMPT_TEMPLATES;
        let tpl = PROMPT_TEMPLATES[key]?.template || '';
        if (key === 'custom') tpl = customTemplate.trim() || PROMPT_TEMPLATES['custom'].template;
        for (let i = 0; i < massGenCount; i++) {
          results.push(await resolveStaticPrompt(tpl, wildcardFullCache));
        }
      }
      setMassGenResults(results);
    } catch (e) {
      alert('Mass generate failed: ' + (e as Error).message);
    } finally {
      setMassGenLoading(false);
    }
  };

  const applyBuilderToPrompt = (toField: 'prompt' | 'negative', mode: 'replace' | 'append') => {
    const p = builderPreview || composeBuilderPrompt(true);
    if (!p) return;
    const current = toField === 'prompt' ? params.prompt : params.negative;
    setParam(toField, mode === 'replace' ? p : (current ? current + ', ' + p : p));
    setActiveField(toField);
  };

  const clearBuilder = () => {
    setBuilder({ ...DEFAULT_BUILDER }); // starts at nsfwLevel 0
    setBuilderPreview('');
    setPinned(new Set());
  };

  // Filter options shown in builder dropdowns + random picks when slider is at SFW/none.
  // Ensures the prompt generator UI never offers/picks NSFW words when level <= SFW_THRESHOLD.
  const getSafeOptions = (cat: string): string[] => {
    const raw = charOptions[cat] || [];
    const lvl = builder.nsfwLevel ?? 55;
    if (lvl > SFW_THRESHOLD) return raw;
    return raw.filter((o: string) => !isNsfwPhrase(o));
  };

  const randomizeOneCategory = async (cat: string, isChar: boolean, charIdx?: number) => {
    let opts = charOptions;
    if (!opts[cat] || opts[cat].length === 0) {
      await loadCharOptions(wildcardFullCache, (o) => { opts = o; setCharOptions(o); });
    }
    const lvl = builder.nsfwLevel ?? 55;
    let pool = (opts[cat] || []);
    if (lvl <= SFW_THRESHOLD) {
      pool = pool.filter((o: string) => !isNsfwPhrase(o));
    }
    const picked = pickRandomForCategory(cat, wildcardFullCache, lvl) || (pool.length ? pool[Math.floor(Math.random() * pool.length)] : '') || '';
    if (!picked) return;
    if (isChar && charIdx != null) {
      const ckey = cat === 'bodyType' || cat === 'body' ? 'body' : (cat === 'breastSize' || cat === 'breasts' ? 'breasts' : cat);
      updateChar(charIdx, { [ckey]: picked } as any);
    } else {
      // map some legacy keys
      const keyMap: any = { background: 'background', setting: 'setting', action: 'action', pose: 'pose', photography: 'photography', lighting: 'lighting', style: 'style' };
      const bkey = keyMap[cat] || cat;
      updateBuilder({ [bkey]: picked } as any);
    }
    // refresh preview
    setTimeout(() => composeBuilderPrompt(false), 0);
  };

  const insertBuilderAsTokens = () => {
    // Insert several __ from builder choices or defaults for inspiration
    const tokens: string[] = [];
    if (builder.background) tokens.push(`__${Object.keys(BUILDER_CATEGORY_WILDCARDS.background || ['Background'])[0]}__`); else tokens.push('__Background__');
    if (builder.setting) tokens.push(`__setting__`);
    if (builder.action) tokens.push('__sexual_act__');
    if (builder.lighting) tokens.push('__lighting__');
    if (builder.style) tokens.push('__style__');
    if (builder.pose) tokens.push('__pose__');
    const tokStr = tokens.join(', ');
    insertAtCursor(promptRef as any, params.prompt, tokStr ? ', ' + tokStr : '', v => setParam('prompt', v));
    setActiveField('prompt');
  };

  const applyPreset = (presetKey: string) => {
    if (!presetKey || !PROMPT_PRESETS[presetKey]) return;
    const p = PROMPT_PRESETS[presetKey];
    // Apply to builder state (will update dropdowns reactively)
    const patch: any = { ...p };
    if (p.numChars) patch.numChars = p.numChars;
    if (p.chars) patch.chars = p.chars;
    // Only set fields that exist in builder UI
    ['background', 'setting', 'action', 'pose', 'photography', 'lighting', 'style', 'quality'].forEach(k => {
      if ((p as any)[k] !== undefined) patch[k] = (p as any)[k];
    });

    // Use the preset's declared nsfwScore as the suggested starting level (so the concept remains visible after apply).
    // Slider can then be moved independently; dropping it will sanitize fields + hide this concept from future dropdowns.
    if (patch.nsfwLevel == null) {
      const declared = (p as any).nsfwScore;
      let suggested = (typeof declared === 'number' ? declared : 40);
      // fallback regex only if no score was assigned (should not happen now)
      if (typeof declared !== 'number') {
        const k = presetKey.toLowerCase();
        if (/(bondage|latex|fetish|bukkake|gang|glory|watersport|public|exhibition|degen|extreme)/.test(k)) suggested = 82;
        else if (/(anal|creampie|milf|school|strap|pegging|futa|huge)/.test(k)) suggested = 68;
        else if (/(vanilla|solo|romantic|sensual)/.test(k)) suggested = 48;
      }
      patch.nsfwLevel = suggested;
      patch.nsfw = suggested > 20;
    }

    updateBuilder(patch);
    // Auto compose preview (slider change + fields will also live-update)
    setTimeout(() => {
      try { composeBuilderPrompt(false); } catch {}
    }, 50);
  };

  const applyGenerated = (toField: 'prompt' | 'negative', mode: 'replace' | 'append') => {
    if (!generatedPrompt) return;
    const current = toField === 'prompt' ? params.prompt : params.negative;
    setParam(toField, mode === 'replace' ? generatedPrompt : (current ? current + ', ' + generatedPrompt : generatedPrompt));
    setActiveField(toField);
  };

  const insertWildcard = (token: string) => {
    if (activeField === 'prompt') insertAtCursor(promptRef as any, params.prompt, token, v => setParam('prompt', v));
    else insertAtCursor(negativeRef as any, params.negative, token, v => setParam('negative', v));
  };

  const insertCombo = (field: 'prompt' | 'negative') => {
    const example = '{option1|option2|option3}';
    if (field === 'prompt') insertAtCursor(promptRef as any, params.prompt, example, v => setParam('prompt', v));
    else insertAtCursor(negativeRef as any, params.negative, example, v => setParam('negative', v));
  };

  const uploadFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (!arr.length) return;
    const results: InputImage[] = [];
    for (const file of arr) {
      try {
        const r = await fetch('/api/imagegen/upload', {
          method: 'POST',
          headers: { 'x-filename': file.name, 'Content-Type': file.type },
          body: file,
        });
        const d = await r.json();
        if (d.ok) results.push({ url: URL.createObjectURL(file), serverPath: d.path, name: file.name });
      } catch { /* skip failed */ }
    }
    if (results.length) {
      setInputImages(prev => [...prev, ...results]);
      setImgMode('img2img');
    }
  };

  const onFileInputChange = (e: any) => {
    if (e.target.files?.length) uploadFiles(e.target.files);
    e.target.value = '';
  };

  const onDropZone = (e: any) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
  };

  const removeInputImage = (idx: number) => {
    setInputImages(prev => {
      const next = prev.filter((_, i) => i !== idx);
      if (next.length === 0) setImgMode('txt2img');
      return next;
    });
  };

  const deleteImage = (name: string) => {
    fetch(`/api/imagegen/image/${encodeURIComponent(name)}`, { method: 'DELETE' }).then(() => setGallery(p => p.filter(i => i.name !== name)));
  };

  // Lightbox keyboard nav
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
      if (e.key === 'ArrowRight') { const i = gallery.findIndex(x => x.name === lightbox.name); if (i < gallery.length - 1) setLightbox(gallery[i + 1]); }
      if (e.key === 'ArrowLeft')  { const i = gallery.findIndex(x => x.name === lightbox.name); if (i > 0) setLightbox(gallery[i - 1]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, gallery]);

  const isWorking = generating || engineStatus.state === 'loading' || engineStatus.state === 'queued';
  const promptWildcards = [...new Set([...(params.prompt.match(/__([a-zA-Z0-9_\-/]+)__/g) || []), ...(params.negative.match(/__([a-zA-Z0-9_\-/]+)__/g) || [])])];

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg)' }}>

      {/* ══ Header ══════════════════════════════════════════════════ */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--brd)', background: 'var(--bg2)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontWeight: 700, fontSize: '15px' }}>Image Gen</span>

        {/* Engine status inline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: STATUS_DOT[engineStatus.state] || 'var(--tx3)', flexShrink: 0, display: 'inline-block' }} />
          <span style={{ fontSize: '12px', color: 'var(--tx2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={engineStatus.message}>{engineStatus.message}</span>
          {engineDevice && <span style={{ fontSize: '11px', color: 'var(--tx3)', flexShrink: 0 }}>{engineDevice}{devicePref && devicePref !== 'auto' ? ` (pref:${devicePref})` : ''}</span>}
        </div>

        {!engineRunning
          ? <button onClick={startEngine} style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '5px', padding: '4px 12px', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap' }}>Start Engine</button>
          : <button onClick={stopEngine}  style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '5px', padding: '4px 12px', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap' }}>Stop</button>
        }
        {comfyuiPath && (
          <button onClick={async () => { const r = await fetch('/api/imagegen/comfyui/start', { method: 'POST' }); const d = await r.json(); if (d.error) alert(d.error); else if (!d.already) (window as any).toast?.('ComfyUI started'); }}
            style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '5px', padding: '4px 10px', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap' }}>ComfyUI ▶</button>
        )}
        <button onClick={() => setConfigOpen(v => !v)} title="Paths config"
          style={{ background: configOpen ? 'var(--ac)' : 'none', color: configOpen ? '#fff' : 'var(--tx3)', border: '1px solid var(--brd)', borderRadius: '5px', padding: '4px 10px', cursor: 'pointer', fontSize: '12px' }}>⚙ Config</button>
      </div>

      {/* Progress bar */}
      {(engineStatus.state === 'generating' || engineStatus.state === 'loading') && (
        <div style={{ height: '3px', background: 'var(--bg3)', flexShrink: 0 }}>
          <div style={{ height: '100%', width: engineStatus.state === 'loading' ? '100%' : `${engineStatus.pct}%`, background: 'var(--ac)', transition: 'width 0.3s', animation: engineStatus.state === 'loading' ? 'igPulse 1.5s ease-in-out infinite' : 'none' }} />
        </div>
      )}

      {/* Config panel */}
      {configOpen && (
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--brd)', background: 'var(--bg3)', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '8px', flexShrink: 0 }}>
          {([['Models dir', modelsDir, setModelsDir], ['VAEs dir', vaesDir, setVaesDir], ['LoRAs dir', lorasDir, setLorasDir], ['Output dir', outputDir, setOutputDir]] as [string, string, (v: string) => void][]).map(([label, val, setter]) => (
            <div key={label}>
              <label style={{ color: 'var(--tx3)', display: 'block', marginBottom: '2px', fontSize: '11px' }}>{label}</label>
              <input value={val} onInput={(e: any) => setter(e.target.value)} placeholder="Absolute path…"
                style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '4px 7px', fontSize: '12px' }} />
            </div>
          ))}
          <div>
            <label style={{ color: 'var(--tx3)', display: 'block', marginBottom: '2px', fontSize: '11px' }}>Device (for image gen engine)</label>
            <select
              value={devicePref}
              onChange={(e: any) => setDevicePref(e.target.value as 'auto'|'cpu'|'cuda'|'mps')}
              style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '4px 7px', fontSize: '12px' }}
            >
              <option value="auto">Auto (GPU if available)</option>
              <option value="cuda">CUDA (NVIDIA GPU)</option>
              <option value="mps">MPS (Apple)</option>
              <option value="cpu">CPU only</option>
            </select>
            <div style={{ fontSize: '10px', color: 'var(--tx3)', marginTop: '1px' }}>Change requires engine stop/start</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px' }}>
            <button onClick={saveConfig} style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '5px', padding: '6px 16px', cursor: 'pointer', fontSize: '12px', flex: 1 }}>Save &amp; Reload</button>
            {comfyuiPath && (
              <button onClick={async () => {
                const r = await fetch('/api/imagegen/comfyui/sync', { method: 'POST' });
                const d = await r.json();
                if (d.error) { alert(d.error); return; }
                setModelsDir(d.modelsDir || ''); setVaesDir(d.vaesDir || ''); setLorasDir(d.lorasDir || '');
                await loadAll();
              }} title={`Sync dirs from ComfyUI: ${comfyuiPath}`}
                style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '5px', padding: '6px 10px', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap' }}>
                ↺ ComfyUI
              </button>
            )}
          </div>
          {comfyuiPath && (
            <div style={{ fontSize: '10px', color: 'var(--tx3)', gridColumn: '1 / -1' }}>
              ComfyUI: <code style={{ color: 'var(--ac)' }}>{comfyuiPath}</code> — click ↺ ComfyUI to sync model dirs
            </div>
          )}
        </div>
      )}

      {/* ══ Main content (scrollable) ════════════════════════════════ */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

        {/* Two-column grid for prompts + params */}
        <div className="imagegen-cols" style={{ display: 'grid', gap: '14px', alignItems: 'start' }}>

          {/* ── LEFT: Prompts + Generator + Wildcards ───────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

            {/* ── Input Image (img2img) panel ─────────────────── */}
            <div style={{ border: '1px solid var(--brd)', borderRadius: '6px', overflow: 'hidden' }}>
              <button onClick={() => setImgPanelOpen(v => !v)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 10px', background: inputImages.length > 0 ? 'rgba(var(--ac-rgb,83,139,255),0.12)' : 'var(--bg2)', border: 'none', cursor: 'pointer' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: inputImages.length > 0 ? 'var(--ac)' : 'var(--tx2)', flex: 1 }}>
                  🖼 Input Image{inputImages.length > 1 ? ` (${inputImages.length})` : inputImages.length === 1 ? ' (1)' : ''}
                  {imgMode === 'img2img' && inputImages.length > 0 && <span style={{ marginLeft: '6px', fontSize: '10px', color: 'var(--ac)' }}>img2img</span>}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>{imgPanelOpen ? '▲' : '▼'}</span>
              </button>

              {imgPanelOpen && (
                <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {/* Mode toggle */}
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {(['txt2img', 'img2img'] as const).map(m => (
                      <button key={m} onClick={() => setImgMode(m)}
                        style={{ flex: 1, padding: '4px', fontSize: '12px', fontWeight: 600, borderRadius: '4px', border: imgMode === m ? '1px solid var(--ac)' : '1px solid var(--brd)', background: imgMode === m ? 'var(--ac)' : 'var(--bg2)', color: imgMode === m ? '#fff' : 'var(--tx2)', cursor: 'pointer' }}>
                        {m}
                      </button>
                    ))}
                  </div>

                  {imgMode === 'img2img' && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--tx2)', marginBottom: '2px' }}>
                        <span>Denoising strength</span>
                        <b style={{ color: 'var(--tx)' }}>{imgStrength.toFixed(2)}</b>
                      </div>
                      <input type="range" min={0.01} max={1} step={0.01} value={imgStrength} title="Denoising strength"
                        onInput={(e: any) => setImgStrength(parseFloat(e.target.value))}
                        style={{ width: '100%', accentColor: 'var(--ac)' }} />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--tx3)' }}>
                        <span>subtle</span><span>full regen</span>
                      </div>
                    </div>
                  )}

                  {/* Drop zone */}
                  <div
                    onDragOver={(e: any) => e.preventDefault()}
                    onDrop={onDropZone}
                    onClick={() => fileInputRef.current?.click()}
                    style={{ border: '2px dashed var(--brd)', borderRadius: '6px', padding: '12px', textAlign: 'center', cursor: 'pointer', background: 'var(--bg3)', fontSize: '12px', color: 'var(--tx3)' }}>
                    Drop images here or click to browse<br />
                    <span style={{ fontSize: '10px' }}>Multiple images = batch generation (same prompt for each)</span>
                  </div>
                  <input ref={fileInputRef as any} type="file" accept="image/*" multiple title="Select images" style={{ display: 'none' }} onChange={onFileInputChange} />

                  {/* Loaded images */}
                  {inputImages.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {inputImages.map((img, idx) => (
                        <div key={idx} style={{ position: 'relative', width: '72px', height: '72px', borderRadius: '5px', overflow: 'hidden', border: '2px solid var(--brd)', flexShrink: 0 }}>
                          <img src={img.url} alt={img.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          <button onClick={() => removeInputImage(idx)}
                            style={{ position: 'absolute', top: '1px', right: '1px', background: 'rgba(0,0,0,0.65)', border: 'none', color: '#fff', borderRadius: '3px', width: '16px', height: '16px', fontSize: '10px', cursor: 'pointer', lineHeight: '1', padding: '0' }}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {inputImages.length > 1 && (
                    <div style={{ fontSize: '11px', color: 'var(--ac)', background: 'rgba(var(--ac-rgb,83,139,255),0.1)', borderRadius: '4px', padding: '5px 8px', border: '1px solid var(--ac)' }}>
                      {inputImages.length} images loaded — use <b>Batch Generate</b> to run the same prompt on each
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Positive prompt */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <label style={{ fontSize: '12px', color: 'var(--tx2)', fontWeight: 600, flex: 1 }}>
                  Positive prompt
                  {activeField === 'prompt' && <span style={{ color: 'var(--ac)', marginLeft: '4px', fontSize: '10px' }}>← active</span>}
                </label>
                <button onClick={() => insertCombo('prompt')} title="Insert {a|b|c}" style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx3)', borderRadius: '4px', padding: '1px 6px', fontSize: '10px', cursor: 'pointer' }}>{'{a|b}'}</button>
              </div>
              <textarea ref={promptRef as any} value={params.prompt} onInput={(e: any) => setParam('prompt', e.target.value)}
                onFocus={() => setActiveField('prompt')} placeholder="masterpiece, best quality, …  (use __wildcard__ or {a|b|c})"
                rows={6} style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', background: 'var(--bg2)', color: 'var(--tx)', border: `1px solid ${activeField === 'prompt' ? 'var(--ac)' : 'var(--brd)'}`, borderRadius: '6px', padding: '7px 9px', fontSize: '13px', fontFamily: 'inherit', lineHeight: '1.5' }} />
              {promptWildcards.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '4px' }}>
                  {promptWildcards.map(wc => <span key={wc} style={{ background: 'var(--ac)', color: '#fff', borderRadius: '3px', padding: '1px 6px', fontSize: '10px', fontFamily: 'monospace' }}>{wc}</span>)}
                </div>
              )}
            </div>

            {/* Negative prompt */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <label style={{ fontSize: '12px', color: 'var(--tx2)', flex: 1 }}>
                  Negative prompt
                  {activeField === 'negative' && <span style={{ color: 'var(--ac)', marginLeft: '4px', fontSize: '10px' }}>← active</span>}
                </label>
                <button onClick={() => insertCombo('negative')} title="Insert {a|b|c}" style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx3)', borderRadius: '4px', padding: '1px 6px', fontSize: '10px', cursor: 'pointer' }}>{'{a|b}'}</button>
              </div>
              <textarea ref={negativeRef as any} value={params.negative} onInput={(e: any) => setParam('negative', e.target.value)}
                onFocus={() => setActiveField('negative')} rows={3}
                style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', background: 'var(--bg2)', color: 'var(--tx)', border: `1px solid ${activeField === 'negative' ? 'var(--ac)' : 'var(--brd)'}`, borderRadius: '6px', padding: '7px 9px', fontSize: '13px', fontFamily: 'inherit', lineHeight: '1.5' }} />
            </div>

            {/* Combo count display */}
            {comboCount > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 10px', background: 'var(--bg2)', borderRadius: '6px', border: '1px solid var(--brd)' }}>
                <span style={{ fontSize: '11px', color: '#ff9800', fontWeight: 600 }}>{comboCount} combos → {totalImages} imgs</span>
              </div>
            )}

            {/* Prompt Generator — opens modal */}
            <button onClick={() => {
              setPromptGenOpen(true);
              // start fresh at 0 (none) every time the generator modal is opened
              setBuilder({ ...DEFAULT_BUILDER, nsfwLevel: 0, nsfw: false });
              setBuilderPreview('');
              setPinned(new Set());
            }}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '9px 13px', background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '6px', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--tx2)', flex: 1 }}>✨ Prompt Generator</span>
              {generatedPrompt && <span style={{ fontSize: '10px', color: 'var(--ac)' }}>prompt ready</span>}
              <span style={{ fontSize: '11px', color: 'var(--tx3)', textTransform: 'capitalize' }}>{genMode}</span>
              <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>open →</span>
            </button>
            {generatedPrompt && (
              <div style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '8px 10px' }}>
                <div style={{ fontSize: '10px', color: 'var(--tx3)', marginBottom: '3px' }}>Generated:</div>
                <div style={{ fontSize: '11px', fontFamily: 'monospace', background: 'var(--bg3)', padding: '5px', borderRadius: '3px', maxHeight: '50px', overflow: 'auto', whiteSpace: 'pre-wrap', border: '1px solid var(--brd)', color: 'var(--tx2)' }}>{generatedPrompt}</div>
                <div style={{ display: 'flex', gap: '4px', marginTop: '5px', flexWrap: 'wrap' }}>
                  <button onClick={() => applyGenerated('prompt', 'replace')} style={{ fontSize: '10px', padding: '2px 6px', background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>→ Pos</button>
                  <button onClick={() => applyGenerated('prompt', 'append')} style={{ fontSize: '10px', padding: '2px 6px', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '3px', cursor: 'pointer' }}>Append</button>
                  <button onClick={() => applyGenerated('negative', 'replace')} style={{ fontSize: '10px', padding: '2px 6px', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '3px', cursor: 'pointer' }}>→ Neg</button>
                  <button onClick={() => navigator.clipboard?.writeText(generatedPrompt)} style={{ fontSize: '10px', padding: '2px 6px', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '3px', cursor: 'pointer' }}>Copy</button>
                  <button onClick={() => setGeneratedPrompt('')} style={{ fontSize: '10px', padding: '2px 6px', background: 'none', color: 'var(--tx3)', border: '1px solid var(--brd)', borderRadius: '3px', cursor: 'pointer', marginLeft: 'auto' }}>✕</button>
                </div>
              </div>
            )}
            {/* Wildcards panel */}
            <div style={{ border: '1px solid var(--brd)', borderRadius: '6px', overflow: 'hidden' }}>
              <button onClick={() => setWildcardsOpen(v => !v)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 10px', background: 'var(--bg2)', border: 'none', cursor: 'pointer' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--tx2)', flex: 1 }}>🃏 Wildcards ({wildcards.length})</span>
                <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>{wildcardsOpen ? '▲' : '▼'}</span>
              </button>
              {wildcardsOpen && (
                <div style={{ padding: '8px 10px' }}>
                  <WildcardsPanel wildcards={wildcards} onRefresh={reloadWildcards} onInsert={insertWildcard} activeField={activeField} />
                </div>
              )}
            </div>
          </div>

          {/* ── RIGHT: Model + Params ────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

            {/* Model */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--tx2)', marginBottom: '4px', fontWeight: 600 }}>Model</label>
              <select value={params.model} onChange={(e: any) => selectModel(e.target.value)}
                style={{ width: '100%', background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '5px', padding: '5px 8px', fontSize: '13px' }}>
                <option value="">— select model —</option>
                {models.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
              </select>
            </div>

            {/* Model type */}
            <div style={{ display: 'flex', gap: '6px' }}>
              {(['sd15', 'sdxl', 'pony', 'flux'] as const).map(t => (
                <button key={t} onClick={() => setParam('model_type', t)}
                  style={{ flex: 1, background: params.model_type === t ? 'var(--ac)' : 'var(--bg2)', color: params.model_type === t ? '#fff' : 'var(--tx2)', border: '1px solid var(--brd)', borderRadius: '5px', padding: '4px', fontSize: '12px', cursor: 'pointer', textTransform: 'uppercase', fontWeight: 600 }}>{t}</button>
              ))}
            </div>

            {/* VAE */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--tx2)', marginBottom: '4px' }}>VAE (optional)</label>
              <select value={params.vae} onChange={(e: any) => setParam('vae', e.target.value)}
                style={{ width: '100%', background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '5px', padding: '5px 8px', fontSize: '13px' }}>
                <option value="">— built-in —</option>
                {vaes.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
              </select>
            </div>

            {/* Size presets */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--tx2)', marginBottom: '5px' }}>Size</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
                {SIZE_PRESETS.map(p => (
                  <button key={p.label} onClick={() => { setParam('width', p.w); setParam('height', p.h); }}
                    style={{ background: params.width === p.w && params.height === p.h ? 'var(--ac)' : 'var(--bg2)', color: params.width === p.w && params.height === p.h ? '#fff' : 'var(--tx2)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '3px 7px', fontSize: '11px', cursor: 'pointer' }}>
                    {p.label}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {(['width', 'height'] as const).map(k => (
                  <div key={k} style={{ flex: 1 }}>
                    <label style={{ fontSize: '11px', color: 'var(--tx3)', display: 'block', marginBottom: '2px' }}>{k}</label>
                    <input type="number" min={64} max={2048} step={64} value={params[k]}
                      onInput={(e: any) => setParam(k, parseInt(e.target.value) || 512)}
                      style={{ width: '100%', background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '4px 6px', fontSize: '13px', textAlign: 'center' }} />
                  </div>
                ))}
              </div>
            </div>

            {/* Speed/Quality presets */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--tx2)', marginBottom: '5px' }}>Speed / Quality Preset</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
                {SPEED_PRESETS.map(p => {
                  const isActive = params.steps === p.steps && params.cfg === p.cfg && params.sampler === p.sampler;
                  return (
                    <button key={p.label} onClick={() => setParams(prev => ({ ...prev, steps: p.steps, cfg: p.cfg, sampler: p.sampler }))}
                      style={{ background: isActive ? 'var(--ac)' : 'var(--bg2)', color: isActive ? '#fff' : 'var(--tx2)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '3px 7px', fontSize: '11px', cursor: 'pointer' }}>
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <Slider label="Steps" value={params.steps} min={1} max={100} onChange={v => setParam('steps', v)} />
            <Slider label="CFG Scale" value={params.cfg} min={1} max={20} step={0.5} onChange={v => setParam('cfg', v)} />
            <Slider label="Batch" value={params.batch} min={1} max={8} onChange={v => setParam('batch', v)} />

            {/* Sampler */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--tx2)', marginBottom: '4px' }}>Sampler</label>
              <select value={params.sampler} onChange={(e: any) => setParam('sampler', e.target.value)}
                style={{ width: '100%', background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '5px', padding: '5px 8px', fontSize: '13px' }}>
                {SAMPLERS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Seed */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--tx2)', marginBottom: '4px' }}>Seed</label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input type="number" value={params.seed} onInput={(e: any) => setParam('seed', parseInt(e.target.value))}
                  style={{ flex: 1, background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '5px', padding: '5px 8px', fontSize: '13px' }} />
                <button onClick={() => setParam('seed', -1)} title="Random"
                  style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '5px', padding: '5px 10px', fontSize: '13px', cursor: 'pointer' }}>🎲</button>
              </div>
              <span style={{ fontSize: '10px', color: 'var(--tx3)' }}>-1 = random</span>
            </div>

            {/* LoRAs */}
            {loras.length > 0 && (
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--tx2)', marginBottom: '4px' }}>LoRAs</label>
                <select onChange={(e: any) => { addLora(e.target.value); e.target.value = ''; }}
                  style={{ width: '100%', background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '5px', padding: '5px 8px', fontSize: '13px', marginBottom: '5px' }}>
                  <option value="">+ Add LoRA…</option>
                  {loras.filter(l => !selectedLoras.find(s => s.name === l.name)).map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
                </select>
                {selectedLoras.map(l => (
                  <div key={l.name} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <span style={{ flex: 1, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
                    <input type="range" min={0} max={1} step={0.05} value={l.strength} onInput={(e: any) => setLoraStrength(l.name, parseFloat(e.target.value))} style={{ width: '70px', accentColor: 'var(--ac)' }} />
                    <span style={{ fontSize: '11px', color: 'var(--tx3)', width: '28px' }}>{l.strength.toFixed(2)}</span>
                    <button onClick={() => removeLora(l.name)} style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', fontSize: '13px' }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Generate button ──────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {isWorking ? (
            <button onClick={cancel} style={{ flex: 1, background: '#c44', color: '#fff', border: 'none', borderRadius: '8px', padding: '12px', fontSize: '15px', fontWeight: 600, cursor: 'pointer' }}>
              ⏹ Cancel
            </button>
          ) : (
            <>
              <button onClick={generate} disabled={!params.model}
                style={{ flex: 1, background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '8px', padding: '12px', fontSize: '15px', fontWeight: 600, cursor: 'pointer', opacity: !params.model ? 0.5 : 1 }}>
                ✦ {imgMode === 'img2img' && inputImages.length > 0 ? 'Img2Img' : 'Generate'} {totalImages > 1 ? `(${totalImages} images)` : ''}
              </button>
              {inputImages.length > 1 && (
                <button onClick={generateBatch} disabled={!params.model || batchRunning}
                  style={{ background: '#9333ea', color: '#fff', border: 'none', borderRadius: '8px', padding: '12px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: (!params.model || batchRunning) ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                  ⚡ Batch ({inputImages.length}×)
                </button>
              )}
            </>
          )}

          {/* Gallery drawer trigger */}
          <button
            onClick={() => setDrawerOpen(v => !v)}
            style={{
              background: drawerOpen ? 'var(--ac)' : 'var(--bg2)',
              color: drawerOpen ? '#fff' : 'var(--tx2)',
              border: '1px solid var(--brd)',
              borderRadius: '8px',
              padding: '12px 16px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
            </svg>
            Gallery
            {gallery.length > 0 && (
              <span style={{ background: drawerOpen ? 'rgba(255,255,255,0.25)' : 'var(--ac)', color: '#fff', borderRadius: '10px', padding: '1px 7px', fontSize: '11px' }}>{gallery.length}</span>
            )}
          </button>

          {queueLength > 0 && <span style={{ fontSize: '11px', color: 'var(--tx3)', whiteSpace: 'nowrap' }}>{queueLength} queued</span>}
        </div>
      </div>

      {/* ══ Gallery Drawer ═══════════════════════════════════════════ */}
      <GalleryDrawer
        gallery={gallery}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onDeleteImage={deleteImage}
        onLightbox={img => { setLightbox(img); }}
        genWidth={params.width}
        genHeight={params.height}
      />

      {/* ══ Lightbox ═════════════════════════════════════════════════ */}
      {lightbox && (
        <div onClick={() => setLightbox(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img src={`/api/imagegen/image/${encodeURIComponent(lightbox.name)}`} alt={lightbox.name}
            onClick={(e: any) => e.stopPropagation()}
            style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: '6px', boxShadow: '0 8px 40px rgba(0,0,0,0.8)' }} />
          <div style={{ position: 'absolute', bottom: '18px', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '8px' }}>
            {['◀', '▶'].map((arrow, di) => (
              <button key={arrow} onClick={(e: any) => { e.stopPropagation(); const i = gallery.findIndex(x => x.name === lightbox.name); const ni = i + (di === 0 ? -1 : 1); if (ni >= 0 && ni < gallery.length) setLightbox(gallery[ni]); }}
                style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: '5px', padding: '6px 14px', cursor: 'pointer' }}>{arrow}</button>
            ))}
            <a href={`/api/imagegen/image/${encodeURIComponent(lightbox.name)}`} download={lightbox.name} onClick={(e: any) => e.stopPropagation()}
              style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: '5px', padding: '6px 14px', textDecoration: 'none', fontSize: '13px' }}>⬇ Save</a>
          </div>
          <button onClick={() => setLightbox(null)}
            style={{ position: 'absolute', top: '14px', right: '14px', background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', fontSize: '15px' }}>✕</button>
        </div>
      )}

      {/* ══ Prompt Generator Modal ══════════════════════════════════ */}
      {promptGenOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
          onClick={(e: any) => { if (e.target === e.currentTarget) setPromptGenOpen(false); }}>
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '12px', width: 'min(960px, 98vw)', maxHeight: '94vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>

            {/* Header */}
            <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--brd)', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
              <span style={{ fontWeight: 700, fontSize: '15px', flex: 1 }}>✨ Prompt Generator</span>
              <div style={{ display: 'flex', gap: '4px' }}>
                {(['static', 'advanced'] as const).map(m => (
                  <button key={m} onClick={() => setGenMode(m)}
                    style={{ fontSize: '12px', padding: '4px 12px', borderRadius: '5px', border: genMode === m ? '1px solid var(--ac)' : '1px solid var(--brd)', background: genMode === m ? 'var(--ac)' : 'transparent', color: genMode === m ? '#fff' : 'var(--tx2)', cursor: 'pointer', textTransform: 'capitalize' }}>
                    {m === 'static' ? 'Template' : 'Builder'}
                  </button>
                ))}
              </div>
              <button onClick={() => setMassGenOpen(true)}
                style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '5px', padding: '4px 12px', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap' }}>
                📋 Mass Generate
              </button>
              <button onClick={() => setPromptGenOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '2px 4px' }}>✕</button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

              {/* ── Template mode ── */}
              {genMode === 'static' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: 'var(--tx2)', marginBottom: '5px', fontWeight: 600 }}>Template</label>
                    <select value={genTemplateKey} onChange={(e: any) => setGenTemplateKey(e.target.value)}
                      style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '5px', padding: '6px 8px', fontSize: '13px' }}>
                      {Object.entries(PROMPT_TEMPLATES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
                    </select>
                  </div>
                  {genTemplateKey === 'custom' && (
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', color: 'var(--tx2)', marginBottom: '5px' }}>Custom template</label>
                      <textarea value={customTemplate} onInput={(e: any) => setCustomTemplate(e.target.value)} placeholder="Custom: __subject__, __lighting__ ..." rows={4}
                        style={{ width: '100%', boxSizing: 'border-box', fontSize: '13px', fontFamily: 'monospace', background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '5px', padding: '8px', resize: 'vertical', color: 'var(--tx)' }} />
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={doStaticGenerate} disabled={genLoading} style={{ flex: 1, background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '5px', padding: '8px', fontSize: '13px', cursor: 'pointer', fontWeight: 600 }}>{genLoading ? '…' : 'Generate (resolve wildcards)'}</button>
                    <button onClick={() => setGeneratedPrompt('')} style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '5px', padding: '8px 14px', fontSize: '13px', cursor: 'pointer' }}>Clear</button>
                  </div>
                </div>
              )}

              {/* ── Advanced builder mode ── */}
              {genMode === 'advanced' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

                  {/* Global bar */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', padding: '8px 12px', background: 'var(--bg3)', borderRadius: '6px', border: '1px solid var(--brd)' }}>
                    <span style={{ color: 'var(--tx3)', fontSize: '12px' }}>Target</span>
                    <select value={builder.target} onChange={(e: any) => { const t = e.target.value as ModelTarget; updateBuilder({ target: t }); setAdvTarget(t); }}
                      style={{ background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '3px 6px', fontSize: '12px' }}>
                      {MODEL_TARGETS.map(t => <option key={t} value={t}>{getModelLabel(t)}</option>)}
                    </select>
                    {/* Slider replaces old binary NSFW checkbox. Controls how much NSFW / degeneracy is injected (0 = SFW artistic/none ... 100 = degen). Scene concepts in the dropdown below are filtered/hidden unless their nsfwScore <= current level. */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
                      <span style={{ color: 'var(--tx3)' }}>NSFW</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={builder.nsfwLevel ?? 55}
                        onChange={(e: any) => {
                          const lvl = parseInt(e.target.value, 10) || 0;
                          const isHot = lvl > 20;
                          let patch: Partial<BuilderState> = { nsfwLevel: lvl, nsfw: isHot };
                          if (lvl <= SFW_THRESHOLD) {
                            // clean any NSFW words from current fields so UI + generated prompt stay SFW
                            const clean = sanitizeBuilderStateForLevel(builder, true);
                            patch = { ...patch, ...clean };
                          }
                          updateBuilder(patch);
                          setAdvNsfw(isHot);
                        }}
                        style={{ width: '110px', accentColor: (builder.nsfwLevel ?? 55) > 70 ? '#f66' : 'var(--ac)' }}
                        title="0 = SFW / artistic  •  50 = vanilla erotic  •  100 = absolute degenerate heavy fetish"
                      />
                      <span style={{ minWidth: 52, fontSize: '10px', color: (builder.nsfwLevel ?? 55) > 80 ? '#f66' : (builder.nsfwLevel ?? 55) > 40 ? '#ff69b4' : 'var(--tx2)', fontWeight: 600 }}>
                        {(builder.nsfwLevel ?? 55)}% { (builder.nsfwLevel ?? 55) <= 15 ? 'SFW' : (builder.nsfwLevel ?? 55) <= 35 ? 'tease' : (builder.nsfwLevel ?? 55) <= 55 ? 'erotic' : (builder.nsfwLevel ?? 55) <= 75 ? 'explicit' : (builder.nsfwLevel ?? 55) <= 88 ? 'fetish' : 'DEGEN' }
                      </span>
                    </div>
                    <span style={{ color: 'var(--tx3)', fontSize: '12px', marginLeft: '8px' }}>Characters</span>
                    {[0,1,2,3].map(n => (
                      <button key={n} onClick={() => setNumChars(n as BuilderNumChars)}
                        style={{ fontSize: '12px', padding: '3px 10px', borderRadius: '4px', border: builder.numChars === n ? '1px solid var(--ac)' : '1px solid var(--brd)', background: builder.numChars === n ? 'var(--ac)' : 'var(--bg2)', color: builder.numChars === n ? '#fff' : 'var(--tx2)', cursor: 'pointer' }}>{n}</button>
                    ))}
                    <button onClick={inspireBuilder} disabled={advLoading}
                      style={{ marginLeft: 'auto', background: '#c33', color: '#fff', border: 'none', borderRadius: '5px', padding: '5px 14px', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}>
                      🎲 Inspire All
                    </button>
                    <button onClick={clearBuilder} style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '4px', padding: '4px 10px', fontSize: '12px', cursor: 'pointer' }}>Clear</button>
                  </div>

                  {/* Presets are now neutral scene *concepts*. The NSFW slider above dials from SFW artistic to max degenerate heavy fetish in the final prompt. */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg3)', borderRadius: '6px', padding: '8px 12px', border: '1px solid var(--brd)' }}>
                    <span style={{ color: 'var(--tx3)', fontSize: '12px', fontWeight: 600 }}>🎭 Scene Concept</span>
                    <select onChange={(e: any) => {
                      const v = e.target.value;
                      const currentLvl = builder.nsfwLevel ?? 0;
                      if (v === '__random__') {
                        const keys = Object.keys(PROMPT_PRESETS).filter(k => {
                          const pr = PROMPT_PRESETS[k] as any;
                          return (pr.nsfwScore ?? 0) <= currentLvl;
                        });
                        if (keys.length) {
                          const rk = keys[Math.floor(Math.random() * keys.length)];
                          applyPreset(rk);
                        }
                        // reset visual to placeholder after random
                        try { e.target.value = ''; } catch {}
                        return;
                      }
                      applyPreset(v);
                    }} defaultValue=""
                      style={{ flex: 1, background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '4px 8px', fontSize: '12px' }}>
                      <option value="">— Choose a scene concept (only those matching current level are shown) —</option>
                      <option value="__random__">— Random Preset —</option>
                      {Object.entries(PROMPT_PRESETS)
                        .filter(([, pr]) => ((pr as any).nsfwScore ?? 0) <= (builder.nsfwLevel ?? 0))
                        .map(([key, pr]) => (
                          <option key={key} value={key}>{key.replace(/-/g, ' ')} {pr.description ? '— ' + pr.description : ''}</option>
                        ))}
                    </select>
                    <span style={{ fontSize: '10px', color: 'var(--tx3)' }}>concepts filtered by level</span>
                  </div>

                  {/* Characters */}
                  <div style={{ border: '1px solid var(--brd)', borderRadius: '6px', overflow: 'hidden' }}>
                    <div style={{ padding: '7px 12px', background: 'var(--bg3)', borderBottom: '1px solid var(--brd)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '13px', color: 'var(--tx2)', fontWeight: 600, flex: 1 }}>{builder.numChars > 0 ? `👤 Characters (${builder.numChars})` : '🏞️ Scenery only (no characters)'}</span>
                      <button onClick={() => setShowBuilderDetails(v => !v)} style={{ fontSize: '11px', padding: '2px 8px', background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '3px', cursor: 'pointer', color: 'var(--tx3)' }}>{showBuilderDetails ? 'collapse' : 'expand'}</button>
                    </div>
                    {showBuilderDetails && builder.numChars > 0 && (
                      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {Array.from({ length: builder.numChars }).map((_, i) => {
                          const c = builder.chars[i] || {};
                          const charOpts = (k: string) => getSafeOptions(k);
                          const mkSel = (label: string, val: string | undefined, cat: string, charKey: keyof CharSpec) => {
                            const opts = charOpts(cat);
                            const tokenName = BUILDER_CATEGORY_WILDCARDS[cat]?.[0] || cat;
                            const cur = val || '';
                            const pinK = `${String(charKey)}-${i}`;
                            const pinnedNow = isPinned(pinK);
                            const pinBtn = (
                              <button onClick={() => togglePin(pinK)} title={pinnedNow ? 'Pinned (protected from Inspire All shuffle)' : 'Pin this field (keep during master shuffle)'} style={{ fontSize: '9px', padding: '0 1px', background: 'none', border: 'none', color: pinnedNow ? 'var(--ac)' : 'var(--tx3)', cursor: 'pointer' }}>📌</button>
                            );
                            const randBtn = (
                              <button onClick={() => randomizeOneCategory(cat, true, i)} title="random this field" style={{ fontSize: '9px', padding: '0 2px', background: 'none', border: 'none', color: 'var(--ac)', cursor: 'pointer' }}>🎲</button>
                            );
                            // Special numeric typable age field (min 18). Randomize via 🎲 still works (picks from AGE_PRESETS numeric).
                            if (cat === 'age' || charKey === 'age') {
                              const ageStr = (val || '').toString();
                              const ageDisplay = ageStr && /^\d/.test(ageStr) ? ageStr : '';
                              return (
                                <div key={charKey} style={{ minWidth: '70px', flex: 1 }}>
                                  <div style={{ fontSize: '10px', color: 'var(--tx3)', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '2px' }}>
                                    {label}
                                    {pinBtn}
                                    {randBtn}
                                  </div>
                                  <input
                                    type="number"
                                    min={18}
                                    step={1}
                                    value={ageDisplay}
                                    placeholder="18+"
                                    onChange={(e: any) => {
                                      const v = e.target.value;
                                      const num = v ? Math.max(18, parseInt(v, 10) || 18) : '';
                                      updateChar(i, { age: num ? String(num) : '' } as any);
                                    }}
                                    style={{ width: '100%', fontSize: '11px', padding: '2px 4px', background: 'var(--bg)', border: '1px solid var(--brd)', borderRadius: '3px', color: 'var(--tx)' }}
                                  />
                                </div>
                              );
                            }
                            return (
                              <div key={charKey} style={{ minWidth: '90px', flex: 1 }}>
                                <div style={{ fontSize: '10px', color: 'var(--tx3)', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '2px' }}>
                                  {label}
                                  {pinBtn}
                                  {randBtn}
                                </div>
                                <select value={cur} onChange={(e: any) => {
                                  const v = e.target.value;
                                  if (v === '__random__') {
                                    randomizeOneCategory(cat, true, i);
                                    return;
                                  }
                                  updateChar(i, { [charKey]: v } as any);
                                }}
                                  style={{ width: '100%', fontSize: '11px', padding: '3px 4px', background: 'var(--bg)', border: '1px solid var(--brd)', borderRadius: '3px', color: 'var(--tx)' }}>
                                  <option value="">—</option>
                                  <option value="__random__">— Random —</option>
                                  <option value={`__${tokenName}__`}>__{tokenName}__</option>
                                  {opts.slice(0, 60).map((o, j) => <option key={j} value={o}>{o.length > 26 ? o.slice(0,24)+'…' : o}</option>)}
                                </select>
                              </div>
                            );
                          };
                          return (
                            <div key={i} style={{ background: 'var(--bg3)', borderRadius: '5px', padding: '8px 10px', border: '1px solid var(--brd)' }}>
                              <div style={{ fontSize: '11px', color: 'var(--ac)', fontWeight: 600, marginBottom: '6px' }}>Character {i+1}</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                {mkSel('Gender', c.gender, 'gender', 'gender')}
                                {mkSel('Age', c.age, 'age', 'age')}
                                {mkSel('Ethnicity', c.ethnicity, 'ethnicity', 'ethnicity')}
                                {mkSel('Hair', c.hair, 'hair', 'hair')}
                                {mkSel('Eyes', c.eyes, 'eyes', 'eyes')}
                                {mkSel('Body', c.body, 'body', 'body')}
                                {mkSel('Breasts', c.breasts, 'breasts', 'breasts')}
                                {mkSel('Clothing', c.clothing, 'clothing', 'clothing')}
                                {mkSel('Expression', c.expression, 'expression', 'expression')}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Act/Pose + Background — 2 col */}
                  <div className="imagegen-builder-2col" style={{ display: 'grid', gap: '12px' }}>
                    <div style={{ border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px 12px', background: 'var(--bg3)' }}>
                      <div style={{ fontSize: '13px', color: 'var(--tx2)', fontWeight: 600, marginBottom: '8px' }}>{builder.numChars > 0 ? '🔥 Act + Pose' : '🏞️ Scene & Atmosphere'}</div>
                      {(['action','pose'] as const).map(cat => {
                        const val = (builder as any)[cat] || '';
                        const opts = getSafeOptions(cat);
                        const token = (BUILDER_CATEGORY_WILDCARDS[cat]||[cat])[0];
                        const pinnedNow = isPinned(cat);
                        return (
                          <div key={cat} style={{ marginBottom: '8px' }}>
                            <div style={{ fontSize: '11px', color: 'var(--tx3)', marginBottom: '3px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              {cat === 'action' ? (builder.numChars > 0 ? 'Action' : 'Action') : 'Pose'}
                              <button onClick={() => togglePin(cat)} title={pinnedNow ? 'Pinned (protected from Inspire All)' : 'Pin (keep during master shuffle)'} style={{ fontSize: '9px', padding: '0 1px', background: 'none', border: 'none', color: pinnedNow ? 'var(--ac)' : 'var(--tx3)', cursor: 'pointer' }}>📌</button>
                              <button onClick={()=>randomizeOneCategory(cat, false)} style={{ fontSize: '9px', padding: '0 3px', background: 'none', border: 'none', color: 'var(--ac)', cursor: 'pointer' }}>🎲</button>
                            </div>
                            <select value={val} onChange={(e:any)=>{
                              const v = e.target.value;
                              if (v === '__random__') { randomizeOneCategory(cat, false); return; }
                              updateBuilder({ [cat]: v } as any);
                            }} style={{ width: '100%', fontSize: '12px', padding: '4px 6px', background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '4px', color: 'var(--tx)' }}>
                              <option value="">—</option>
                              <option value="__random__">— Random —</option>
                              <option value={`__${token}__`}>__{token}__</option>
                              {opts.slice(0,55).map((o,j)=><option key={j} value={o}>{o}</option>)}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px 12px', background: 'var(--bg3)' }}>
                      <div style={{ fontSize: '13px', color: 'var(--tx2)', fontWeight: 600, marginBottom: '8px' }}>🌆 Background / Setting</div>
                      {(['background','setting'] as const).map(cat => {
                        const val = (builder as any)[cat] || '';
                        const opts = getSafeOptions(cat);
                        const token = (BUILDER_CATEGORY_WILDCARDS[cat]||[cat])[0];
                        const pinnedNow = isPinned(cat);
                        return (
                          <div key={cat} style={{ marginBottom: '8px' }}>
                            <div style={{ fontSize: '11px', color: 'var(--tx3)', marginBottom: '3px', display: 'flex', alignItems: 'center', gap: '4px', textTransform: 'capitalize' }}>
                              {cat}
                              <button onClick={() => togglePin(cat)} title={pinnedNow ? 'Pinned (protected from Inspire All)' : 'Pin (keep during master shuffle)'} style={{ fontSize: '9px', padding: '0 1px', background: 'none', border: 'none', color: pinnedNow ? 'var(--ac)' : 'var(--tx3)', cursor: 'pointer' }}>📌</button>
                              <button onClick={()=>randomizeOneCategory(cat, false)} style={{ fontSize: '9px', padding: '0 3px', background: 'none', border: 'none', color: 'var(--ac)', cursor: 'pointer' }}>🎲</button>
                            </div>
                            <select value={val} onChange={(e:any)=>{
                              const v = e.target.value;
                              if (v === '__random__') { randomizeOneCategory(cat, false); return; }
                              updateBuilder({ [cat]: v } as any);
                            }} style={{ width: '100%', fontSize: '12px', padding: '4px 6px', background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '4px', color: 'var(--tx)' }}>
                              <option value="">—</option>
                              <option value="__random__">— Random —</option>
                              <option value={`__${token}__`}>__{token}__</option>
                              {opts.slice(0,55).map((o,j)=><option key={j} value={o}>{o}</option>)}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Photography / Lighting / Style / Quality */}
                  <div style={{ border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px 12px', background: 'var(--bg3)' }}>
                    <div style={{ fontSize: '13px', color: 'var(--tx2)', fontWeight: 600, marginBottom: '8px' }}>📷 Photography / Lighting / Style</div>
                    <div className="imagegen-photo-grid" style={{ display: 'grid', gap: '10px' }}>
                      {(['photography','lighting','style','quality'] as const).map(cat => {
                        const val = (builder as any)[cat] || '';
                        const opts = getSafeOptions(cat);
                        const token = (BUILDER_CATEGORY_WILDCARDS[cat]||[cat])[0];
                        const pinnedNow = isPinned(cat);
                        return (
                          <div key={cat}>
                            <div style={{ fontSize: '11px', color: 'var(--tx3)', marginBottom: '3px', display: 'flex', alignItems: 'center', gap: '3px', textTransform: 'capitalize' }}>
                              {cat}
                              <button onClick={() => togglePin(cat)} title={pinnedNow ? 'Pinned (protected from Inspire All)' : 'Pin (keep during master shuffle)'} style={{ fontSize:'9px', padding:'0 1px', background:'none', border:'none', color: pinnedNow ? 'var(--ac)' : 'var(--tx3)', cursor:'pointer' }}>📌</button>
                              <button onClick={()=>randomizeOneCategory(cat,false)} style={{ fontSize:'9px', padding:'0 2px', background:'none', border:'none', color:'var(--ac)', cursor:'pointer' }}>🎲</button>
                            </div>
                            <select value={val} onChange={(e:any)=>{
                              const v = e.target.value;
                              if (v === '__random__') { randomizeOneCategory(cat, false); return; }
                              updateBuilder({ [cat]: v } as any);
                            }} style={{ width:'100%', fontSize:'11px', padding:'3px 4px', background:'var(--bg2)', border:'1px solid var(--brd)', borderRadius:'3px', color:'var(--tx)' }}>
                              <option value="">—</option>
                              <option value="__random__">— Random —</option>
                              <option value={`__${token}__`}>__{token}__</option>
                              {opts.slice(0,50).map((o,j)=><option key={j} value={o}>{o.length>26?o.slice(0,24)+'…':o}</option>)}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Compose actions */}
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', padding: '10px 12px', background: 'var(--bg3)', borderRadius: '6px', border: '1px solid var(--brd)' }}>
                    <button onClick={() => composeBuilderPrompt(true)} style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '5px', padding: '6px 14px', fontSize: '13px', cursor: 'pointer', fontWeight: 600 }}>Compose Prompt</button>
                    <button onClick={() => { applyBuilderToPrompt('prompt', 'replace'); setPromptGenOpen(false); }} style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '4px', padding: '5px 10px', fontSize: '12px', cursor: 'pointer' }}>→ Positive (replace)</button>
                    <button onClick={() => { applyBuilderToPrompt('prompt', 'append'); setPromptGenOpen(false); }} style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '4px', padding: '5px 10px', fontSize: '12px', cursor: 'pointer' }}>Append Positive</button>
                    <button onClick={() => { applyBuilderToPrompt('negative', 'replace'); setPromptGenOpen(false); }} style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '4px', padding: '5px 10px', fontSize: '12px', cursor: 'pointer' }}>→ Negative</button>
                    <button onClick={insertBuilderAsTokens} style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '4px', padding: '5px 8px', fontSize: '12px', cursor: 'pointer' }}>Insert __tokens__</button>
                    <button onClick={() => { const p = composeBuilderPrompt(false); if (p) navigator.clipboard?.writeText(p); }} style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '4px', padding: '5px 8px', fontSize: '12px', cursor: 'pointer' }}>Copy</button>
                    <span style={{ fontSize: '10px', color: 'var(--tx3)', marginLeft: 'auto' }}>{Object.keys(BUILDER_CATEGORY_WILDCARDS).length}+ wildcard categories</span>
                  </div>

                  {/* Legacy */}
                  <details style={{ fontSize: '11px' }}>
                    <summary style={{ color: 'var(--tx3)', cursor: 'pointer' }}>Legacy quick traits</summary>
                    <div style={{ paddingTop: '6px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <button onClick={doAdvancedRandomize} disabled={advLoading} style={{ fontSize: '11px', padding: '3px 8px', background: advNsfw ? '#c33' : 'var(--ac)', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>{advLoading ? '…' : '🎲 Quick Random (legacy)'}</button>
                      <button onClick={randomizeChar} style={{ fontSize: '11px', padding: '3px 8px', background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>🎲 Traits</button>
                      <button onClick={() => setCharOverrides({})} style={{ fontSize: '11px', padding: '3px 8px', background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '3px', cursor: 'pointer' }}>Reset traits</button>
                    </div>
                  </details>
                </div>
              )}
            </div>

            {/* Footer — generated prompt */}
            {generatedPrompt && (
              <div style={{ padding: '12px 18px', borderTop: '1px solid var(--brd)', flexShrink: 0, background: 'var(--bg3)' }}>
                <div style={{ fontSize: '11px', color: 'var(--tx3)', marginBottom: '4px' }}>Generated prompt:</div>
                <div style={{ fontSize: '12px', fontFamily: 'monospace', background: 'var(--bg2)', padding: '7px 10px', borderRadius: '5px', maxHeight: '80px', overflow: 'auto', whiteSpace: 'pre-wrap', border: '1px solid var(--brd)', color: 'var(--tx)' }}>{generatedPrompt}</div>
                <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
                  <button onClick={() => { applyGenerated('prompt', 'replace'); setPromptGenOpen(false); }} style={{ fontSize: '12px', padding: '4px 10px', background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>→ Positive (replace)</button>
                  <button onClick={() => { applyGenerated('prompt', 'append'); setPromptGenOpen(false); }} style={{ fontSize: '12px', padding: '4px 10px', background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px', cursor: 'pointer' }}>Append Positive</button>
                  <button onClick={() => { applyGenerated('negative', 'replace'); setPromptGenOpen(false); }} style={{ fontSize: '12px', padding: '4px 10px', background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px', cursor: 'pointer' }}>→ Negative</button>
                  <button onClick={() => navigator.clipboard?.writeText(generatedPrompt)} style={{ fontSize: '12px', padding: '4px 10px', background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px', cursor: 'pointer' }}>Copy</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ Mass Prompt Generation Modal ════════════════════════════ */}
      {massGenOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
          onClick={(e: any) => { if (e.target === e.currentTarget) setMassGenOpen(false); }}>
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '12px', width: 'min(740px, 98vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--brd)', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
              <span style={{ fontWeight: 700, fontSize: '15px', flex: 1 }}>📋 Mass Prompt Generation</span>
              <button onClick={() => setMassGenOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '2px 4px' }}>✕</button>
            </div>
            <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '14px', flex: 1, overflowY: 'auto' }}>
              <div style={{ fontSize: '12px', color: 'var(--tx2)', background: 'var(--bg3)', borderRadius: '6px', padding: '10px 12px', border: '1px solid var(--brd)' }}>
                {genMode === 'advanced'
                  ? 'Uses current builder settings as a template — wildcard fields are resolved randomly each time.'
                  : 'Resolves wildcards in the selected template randomly each time.'}
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <label style={{ fontSize: '13px', color: 'var(--tx2)', whiteSpace: 'nowrap' }}>Generate</label>
                <input type="number" min={1} max={100} value={massGenCount}
                  onInput={(e: any) => setMassGenCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 10)))}
                  style={{ width: '70px', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '5px 8px', fontSize: '13px', textAlign: 'center' }} />
                <label style={{ fontSize: '13px', color: 'var(--tx2)' }}>prompts</label>
                <button onClick={doMassGenerate} disabled={massGenLoading}
                  style={{ marginLeft: 'auto', background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '5px', padding: '6px 20px', fontSize: '13px', cursor: 'pointer', fontWeight: 600, opacity: massGenLoading ? 0.6 : 1 }}>
                  {massGenLoading ? 'Generating…' : 'Generate'}
                </button>
              </div>
              {massGenResults.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--tx3)', flex: 1 }}>{massGenResults.length} prompts — select all and copy, or use individual buttons below</span>
                    <button onClick={() => navigator.clipboard?.writeText(massGenResults.join('\n\n'))}
                      style={{ background: 'var(--ac)', border: 'none', color: '#fff', borderRadius: '4px', padding: '4px 12px', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}>Copy All</button>
                    <button onClick={() => navigator.clipboard?.writeText(massGenResults.join('\n'))}
                      style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '4px', padding: '4px 12px', fontSize: '12px', cursor: 'pointer' }}>Copy (1/line)</button>
                  </div>
                  <textarea readOnly value={massGenResults.map((p, i) => `[${i+1}] ${p}`).join('\n\n')}
                    style={{ flex: 1, minHeight: '320px', width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.6', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px', resize: 'vertical' }} />
                  <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                    {massGenResults.map((p, i) => (
                      <button key={i} onClick={() => { setParam('prompt', p); setMassGenOpen(false); }} title={p}
                        style={{ fontSize: '11px', padding: '3px 9px', background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '3px', cursor: 'pointer', color: 'var(--tx2)' }}>
                        Use #{i+1}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes igPulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }`}</style>
    </div>
  );
};
