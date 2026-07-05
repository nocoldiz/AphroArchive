import { useState, useEffect, useRef } from 'preact/hooks';
import {
  type ModelTarget,
  MODEL_TARGETS,
  getModelLabel,
  type BuilderState,
  type BuilderNumChars,
  type CharSpec,
  DEFAULT_BUILDER,
  BUILDER_CATEGORY_WILDCARDS,
  AGE_PRESETS,
  buildPromptFromBuilder,
} from './characterPrompts';
import {
  inspireRandomBuilder,
  pickRandomForCategory,
  HARDCODED_OPTIONS,
  HARDCODED_OPTION_ALIASES,
  PROMPT_PRESETS,
  isNsfwPhrase,
  SFW_THRESHOLD,
  sanitizeBuilderStateForLevel,
} from './nsfwCharacterPrompts';

const PROMPT_SITES = [
  // ── General chat ──
  { id: 'chatgpt',    name: 'ChatGPT',      url: 'https://chatgpt.com/' },
  { id: 'claude',     name: 'Claude',       url: 'https://claude.ai/new' },
  { id: 'gemini',     name: 'Gemini',       url: 'https://gemini.google.com/app' },
  { id: 'grok',       name: 'Grok',         url: 'https://grok.com/' },
  { id: 'perplexity', name: 'Perplexity',   url: 'https://perplexity.ai/' },
  { id: 'mistral',    name: 'Le Chat',      url: 'https://chat.mistral.ai/chat' },
  { id: 'copilot',    name: 'Copilot',      url: 'https://copilot.microsoft.com/' },
  { id: 'deepseek',   name: 'DeepSeek',     url: 'https://chat.deepseek.com/' },
  { id: 'meta',       name: 'Meta AI',      url: 'https://www.meta.ai/' },
  { id: 'groq',       name: 'Groq',         url: 'https://chat.groq.com/' },
  { id: 'huggingchat',name: 'HuggingChat',  url: 'https://huggingface.co/chat/' },
  { id: 'poe',        name: 'Poe',          url: 'https://poe.com/' },
  { id: 'you',        name: 'You.com',      url: 'https://you.com/' },
  { id: 'phind',      name: 'Phind',        url: 'https://www.phind.com/' },
  { id: 'cohere',     name: 'Cohere',       url: 'https://coral.cohere.com/' },
  { id: 'qwen',       name: 'Qwen',         url: 'https://chat.qwenlm.ai/' },
  { id: 'kimi',       name: 'Kimi',         url: 'https://kimi.moonshot.cn/' },
  { id: 'venice',     name: 'Venice AI',    url: 'https://venice.ai/' },
  { id: 'pi',         name: 'Pi AI',        url: 'https://pi.ai/talk' },
  // ── Image generation ──
  { id: 'midjourney', name: 'Midjourney',   url: 'https://www.midjourney.com/imagine' },
  { id: 'ideogram',   name: 'Ideogram',     url: 'https://ideogram.ai/' },
  { id: 'leonardo',   name: 'Leonardo AI',  url: 'https://app.leonardo.ai/' },
  { id: 'playground', name: 'Playground',   url: 'https://playground.com/' },
  { id: 'fal',        name: 'fal.ai',       url: 'https://fal.ai/models' },
  // ── Local ──
  { id: 'comfyui',    name: 'ComfyUI',      url: 'http://127.0.0.1:8188', local: true },
  { id: 'a1111',      name: 'A1111',        url: 'http://127.0.0.1:7860', local: true },
  { id: 'lmchannel',   name: 'LM Studio',     url: 'http://localhost:1234',  local: true },
];

interface Prompt {
  id: string;
  title: string;
  text: string;
  tags?: string[];
  sites?: string[];
}

// ── Template / wildcard / combinatorial syntax helpers ─────────────────
// $NAME / $JOB / $CLOTHES  → global templates (Valorize drawer)
// __wildcard__             → resolves to a random line from a wildcard file
// {opt1|opt2|opt3}         → combinatorial group, expands to one variant per option

const PROMPT_TEMPLATE_VALUES_KEY = 'promptTemplateValues';

const TEMPLATE_REGEX = /\$[A-Z][A-Z0-9_]*/g;
const COMBO_REGEX = /\{[^{}]*\|[^{}]*\}/g;
const WILDCARD_TOKEN_REGEX = /__([a-zA-Z0-9_\-]+)__/g;
const HIGHLIGHT_REGEX = /(\$[A-Z][A-Z0-9_]*)|(__[a-zA-Z0-9_\-]+__)|(\{[^{}]*\|[^{}]*\})/g;

function hasComboGroup(text: string): boolean {
  return /\{[^{}]*\|[^{}]*\}/.test(text);
}

function hasWildcardToken(text: string): boolean {
  return /__[a-zA-Z0-9_\-]+__/.test(text);
}

function tokenizePromptCombos(text: string): { literals: string[]; groups: string[][] } {
  const groups: string[][] = [];
  const literals: string[] = [];
  let lastIndex = 0;
  for (const m of text.matchAll(COMBO_REGEX)) {
    literals.push(text.slice(lastIndex, m.index));
    groups.push(m[0].slice(1, -1).split('|').map(s => s.trim()).filter(Boolean));
    lastIndex = (m.index ?? 0) + m[0].length;
  }
  literals.push(text.slice(lastIndex));
  return { literals, groups };
}

function countCombinations(text: string): number {
  const { groups } = tokenizePromptCombos(text);
  if (!groups.length) return 1;
  return groups.reduce((acc, g) => acc * Math.max(1, g.length), 1);
}

function expandCombinations(text: string, max = 200): string[] {
  const { literals, groups } = tokenizePromptCombos(text);
  if (!groups.length) return [text];
  let results: string[] = [''];
  for (let i = 0; i < literals.length; i++) {
    results = results.map(r => r + literals[i]);
    if (i < groups.length) {
      const next: string[] = [];
      outer: for (const r of results) {
        for (const opt of groups[i]) {
          next.push(r + opt);
          if (next.length >= max) break outer;
        }
      }
      results = next;
    }
    if (results.length >= max) break;
  }
  return results.slice(0, max);
}

// Picks one random option per combinatorial group and resolves __wildcard__ tokens
// against the wildcards stored on the server (cached in `wildcardCache`).
async function resolveRandomPrompt(text: string, wildcardCache: Map<string, string[]>): Promise<string> {
  const { literals, groups } = tokenizePromptCombos(text);
  let result = '';
  for (let i = 0; i < literals.length; i++) {
    result += literals[i];
    if (i < groups.length && groups[i].length) {
      result += groups[i][Math.floor(Math.random() * groups[i].length)];
    }
  }
  const names = new Set<string>();
  for (const m of result.matchAll(WILDCARD_TOKEN_REGEX)) names.add(m[1]);
  for (const name of names) {
    if (!wildcardCache.has(name)) {
      try {
        const r = await fetch(`/api/prompts/wildcards/${encodeURIComponent(name)}`);
        if (r.ok) {
          const d = await r.json();
          wildcardCache.set(name, (d.lines || []).filter((x: string) => x && !x.startsWith('#')));
        }
      } catch { /* leave unresolved */ }
    }
  }
  return result.replace(WILDCARD_TOKEN_REGEX, (full, name) => {
    const lines = wildcardCache.get(name);
    return lines && lines.length ? lines[Math.floor(Math.random() * lines.length)] : full;
  });
}

// Renders $TEMPLATE (red), __wildcard__ (green) and {combo|combo} (pink) tokens as highlighted chips.
function renderPromptText(text: string) {
  const parts: any[] = [];
  let lastIndex = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  HIGHLIGHT_REGEX.lastIndex = 0;
  while ((m = HIGHLIGHT_REGEX.exec(text))) {
    if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));
    if (m[1]) {
      parts.push(<span key={key++} className="pt-token pt-token--template" title="Global template — set its value in the Templates drawer">{m[1]}</span>);
    } else if (m[2]) {
      parts.push(<span key={key++} className="pt-token pt-token--wildcard" title="Wildcard — resolves to a random line from this list">{m[2]}</span>);
    } else if (m[3]) {
      const opts = m[3].slice(1, -1).split('|').map(s => s.trim()).filter(Boolean);
      parts.push(<span key={key++} className="pt-token pt-token--combo" title={`${opts.length} options: ${opts.join(', ')}`}>{m[3]}</span>);
    }
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

// ── Shared wildcard types + helpers ───────────────────────────────────

interface WildcardFile { name: string; file: string; count: number; preview: string[]; }

async function loadCharOptions(cache: Map<string, string[]>, setter: (o: Record<string, string[]>) => void) {
  const out: Record<string, string[]> = { age: AGE_PRESETS.slice() };

  for (const [k, arr] of Object.entries(HARDCODED_OPTIONS)) {
    out[k] = (arr || []).slice(0, 100);
  }
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
            const res = await fetch(`/api/prompts/wildcards/${encodeURIComponent(name)}`);
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

// ── WildcardEditor modal ──────────────────────────────────────────────

function WildcardEditor({ name, onClose, onSaved }: { name: string; onClose: () => void; onSaved: () => void }) {
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!name) return;
    fetch(`/api/prompts/wildcards/${encodeURIComponent(name)}`).then(r => r.json()).then(d => setContent(d.content || '')).catch(() => {});
  }, [name]);
  const save = async () => {
    setSaving(true);
    await fetch(`/api/prompts/wildcards/${encodeURIComponent(name)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }).catch(() => {});
    setSaving(false); onSaved(); onClose();
  };
  const lineCount = content.split('\n').filter(l => l.trim() && !l.startsWith('#')).length;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '12px', width: 'min(520px, 94vw)', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontWeight: 700, fontSize: '14px', flex: 1 }}>Edit wildcard: <code style={{ color: 'var(--ac)' }}>{name}</code></span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', fontSize: '16px' }}>✕</button>
        </div>
        <textarea value={content} onInput={(e: any) => setContent(e.target.value)} rows={14} spellcheck={false} title="Wildcard content"
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

function WildcardsPanel({ wildcards, onRefresh, onInsert }: {
  wildcards: WildcardFile[]; onRefresh: () => void; onInsert: (token: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const deleteWc = async (name: string) => {
    if (!confirm(`Delete wildcard "${name}"?`)) return;
    await fetch(`/api/prompts/wildcards/${encodeURIComponent(name)}`, { method: 'DELETE' });
    onRefresh();
  };
  const createWc = async () => {
    const safe = newName.trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
    if (!safe) return;
    await fetch(`/api/prompts/wildcards/${encodeURIComponent(safe)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: `# ${safe} wildcard\n` }) });
    setNewName(''); setCreating(false); onRefresh(); setEditing(safe);
  };

  return (
    <div style={{ fontSize: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
        <span style={{ color: 'var(--tx3)', fontSize: '11px', flex: 1 }}>Insert <code style={{ color: 'var(--ac)' }}>__name__</code> into prompt</span>
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

// ── Prompt Builder Modal ──────────────────────────────────────────────

const PromptBuilderModal = ({ initial, onSave, onClose }: { initial: Prompt | null; onSave: (p: Partial<Prompt>) => void; onClose: () => void }) => {
  const [title, setTitle] = useState(initial?.title || '');
  const [tags, setTags] = useState((initial?.tags || []).join(', '));
  const [generatedPrompt, setGeneratedPrompt] = useState(initial?.text || '');

  const [builder, setBuilder] = useState<BuilderState>({ ...DEFAULT_BUILDER });
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [charOptions, setCharOptions] = useState<Record<string, string[]>>({});
  const [showBuilderDetails, setShowBuilderDetails] = useState(true);
  const [wildcards, setWildcards] = useState<WildcardFile[]>([]);

  const wildcardFullCache = useRef(new Map<string, string[]>()).current;
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadCharOptions(wildcardFullCache, setCharOptions).catch(() => {});
    fetch('/api/prompts/assets').then(r => r.json()).then(d => setWildcards(d.wildcards || [])).catch(() => {});
  }, []);

  const togglePin = (key: string) => {
    setPinned(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  };
  const isPinned = (key: string) => pinned.has(key);

  const updateBuilder = (patch: Partial<BuilderState>) => {
    setBuilder(b => {
      const next = { ...b, ...patch } as BuilderState;
      if (patch.numChars != null && patch.numChars !== b.numChars && !patch.chars) {
        const arr = [...(b.chars || [])];
        while (arr.length < patch.numChars) arr.push({});
        next.chars = arr.slice(0, patch.numChars);
      }
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

  const setNumChars = (n: BuilderNumChars) => updateBuilder({ numChars: n });

  const inspireBuilder = async () => {
    let opts = charOptions;
    if (Object.keys(opts).length < 5) {
      await loadCharOptions(wildcardFullCache, (o) => { opts = o; setCharOptions(o); });
    }
    const inspired = inspireRandomBuilder(builder, pinned, wildcardFullCache);
    setBuilder(inspired);
    const preview = buildPromptFromBuilder(inspired, wildcardFullCache);
    setGeneratedPrompt(preview);
  };

  const composeBuilderPrompt = () => {
    const p = buildPromptFromBuilder(builder, wildcardFullCache);
    setGeneratedPrompt(p);
    return p;
  };

  const clearBuilder = () => {
    setBuilder({ ...DEFAULT_BUILDER });
    setPinned(new Set());
  };

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
    const pool = lvl <= SFW_THRESHOLD ? (opts[cat] || []).filter((o: string) => !isNsfwPhrase(o)) : (opts[cat] || []);
    const picked = pickRandomForCategory(cat, wildcardFullCache, lvl) || (pool.length ? pool[Math.floor(Math.random() * pool.length)] : '') || '';
    if (!picked) return;
    if (isChar && charIdx != null) {
      const ckey = cat === 'bodyType' || cat === 'body' ? 'body' : (cat === 'breastSize' || cat === 'breasts' ? 'breasts' : cat);
      updateChar(charIdx, { [ckey]: picked } as any);
    } else {
      const keyMap: any = { background: 'background', setting: 'setting', action: 'action', pose: 'pose', photography: 'photography', lighting: 'lighting', style: 'style', quality: 'quality' };
      updateBuilder({ [keyMap[cat] || cat]: picked } as any);
    }
  };

  const applyPreset = (presetKey: string) => {
    if (!presetKey || !PROMPT_PRESETS[presetKey]) return;
    const p = PROMPT_PRESETS[presetKey];
    const patch: any = { ...p };
    ['background', 'setting', 'action', 'pose', 'photography', 'lighting', 'style', 'quality'].forEach(k => {
      if ((p as any)[k] !== undefined) patch[k] = (p as any)[k];
    });
    if (patch.nsfwLevel == null) {
      const declared = (p as any).nsfwScore;
      let suggested = (typeof declared === 'number' ? declared : 40);
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
  };

  const insertWildcard = (token: string) => {
    const ta = promptTextareaRef.current;
    if (!ta) { setGeneratedPrompt(p => p + (p ? ', ' : '') + token); return; }
    const s = ta.selectionStart ?? generatedPrompt.length;
    const e = ta.selectionEnd ?? generatedPrompt.length;
    const next = generatedPrompt.slice(0, s) + token + generatedPrompt.slice(e);
    setGeneratedPrompt(next);
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(s + token.length, s + token.length); });
  };

  const reloadWildcards = async () => {
    try { const r = await fetch('/api/prompts/assets').then(r => r.json()); setWildcards(r.wildcards || []); } catch {}
  };

  const handleSave = () => {
    const trimTitle = title.trim();
    const trimText = generatedPrompt.trim();
    if (!trimTitle || !trimText) { alert('Title and prompt text are required. Use "Compose Prompt" to generate text, or type directly in the text area.'); return; }
    onSave({
      id: initial?.id,
      title: trimTitle,
      tags: tags.split(',').map(s => s.trim()).filter(Boolean),
      text: trimText,
    });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '12px', width: 'min(1320px, 98vw)', maxHeight: '94vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>

        {/* Header */}
        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--brd)', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: '15px' }}>✨ {initial ? 'Edit Prompt' : 'New Prompt'}</span>
          <input
            type="text"
            placeholder="Title"
            value={title}
            onInput={(e: any) => setTitle(e.target.value)}
            style={{ flex: 1, minWidth: '160px', maxWidth: '280px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '6px 10px', borderRadius: '6px', fontSize: '0.9rem' }}
          />
          <input
            type="text"
            placeholder="Tags (comma separated)"
            value={tags}
            onInput={(e: any) => setTags(e.target.value)}
            style={{ flex: 1, minWidth: '160px', maxWidth: '240px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '6px 10px', borderRadius: '6px', fontSize: '0.85rem' }}
          />
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
            <button onClick={onClose} style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '5px', padding: '6px 14px', cursor: 'pointer', fontSize: '13px' }}>Cancel</button>
            <button onClick={handleSave} style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '5px', padding: '6px 16px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>Save Prompt</button>
          </div>
        </div>

        {/* Body — builder left, wildcards right */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* ── Builder ── */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

              {/* Global bar */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', padding: '8px 12px', background: 'var(--bg3)', borderRadius: '6px', border: '1px solid var(--brd)' }}>
                <span style={{ color: 'var(--tx3)', fontSize: '12px' }}>Target</span>
                <select value={builder.target} onChange={(e: any) => updateBuilder({ target: e.target.value as ModelTarget })} title="Target"
                  style={{ background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '3px 6px', fontSize: '12px' }}>
                  {MODEL_TARGETS.map(t => <option key={t} value={t}>{getModelLabel(t)}</option>)}
                </select>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
                  <span style={{ color: 'var(--tx3)' }}>NSFW</span>
                  <input
                    type="range" min={0} max={100} step={5}
                    value={builder.nsfwLevel ?? 55}
                    onChange={(e: any) => {
                      const lvl = parseInt(e.target.value, 10) || 0;
                      let patch: Partial<BuilderState> = { nsfwLevel: lvl, nsfw: lvl > 20 };
                      if (lvl <= SFW_THRESHOLD) {
                        const clean = sanitizeBuilderStateForLevel(builder, true);
                        patch = { ...patch, ...clean };
                      }
                      updateBuilder(patch);
                    }}
                    style={{ width: '110px', accentColor: (builder.nsfwLevel ?? 55) > 70 ? '#f66' : 'var(--ac)' }}
                    title="0 = SFW / artistic  •  50 = vanilla erotic  •  100 = absolute degenerate heavy fetish"
                  />
                  <span style={{ minWidth: 52, fontSize: '10px', color: (builder.nsfwLevel ?? 55) > 80 ? '#f66' : (builder.nsfwLevel ?? 55) > 40 ? '#ff69b4' : 'var(--tx2)', fontWeight: 600 }}>
                    {(builder.nsfwLevel ?? 55)}% {(builder.nsfwLevel ?? 55) <= 15 ? 'SFW' : (builder.nsfwLevel ?? 55) <= 35 ? 'tease' : (builder.nsfwLevel ?? 55) <= 55 ? 'erotic' : (builder.nsfwLevel ?? 55) <= 75 ? 'explicit' : (builder.nsfwLevel ?? 55) <= 88 ? 'fetish' : 'DEGEN'}
                  </span>
                </div>
                <span style={{ color: 'var(--tx3)', fontSize: '12px', marginLeft: '8px' }}>Characters</span>
                {[0,1,2,3].map(n => (
                  <button key={n} onClick={() => setNumChars(n as BuilderNumChars)}
                    style={{ fontSize: '12px', padding: '3px 10px', borderRadius: '4px', border: builder.numChars === n ? '1px solid var(--ac)' : '1px solid var(--brd)', background: builder.numChars === n ? 'var(--ac)' : 'var(--bg2)', color: builder.numChars === n ? '#fff' : 'var(--tx2)', cursor: 'pointer' }}>{n}</button>
                ))}
                <button onClick={inspireBuilder}
                  style={{ marginLeft: 'auto', background: '#c33', color: '#fff', border: 'none', borderRadius: '5px', padding: '5px 14px', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}>
                  🎲 Inspire All
                </button>
                <button onClick={clearBuilder} style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '4px', padding: '4px 10px', fontSize: '12px', cursor: 'pointer' }}>Clear</button>
              </div>

              {/* Scene Concept Presets */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg3)', borderRadius: '6px', padding: '8px 12px', border: '1px solid var(--brd)' }}>
                <span style={{ color: 'var(--tx3)', fontSize: '12px', fontWeight: 600 }}>🎭 Scene Concept</span>
                <select onChange={(e: any) => {
                  const v = e.target.value;
                  const currentLvl = builder.nsfwLevel ?? 0;
                  if (v === '__random__') {
                    const keys = Object.keys(PROMPT_PRESETS).filter(k => ((PROMPT_PRESETS[k] as any).nsfwScore ?? 0) <= currentLvl);
                    if (keys.length) applyPreset(keys[Math.floor(Math.random() * keys.length)]);
                    try { e.target.value = ''; } catch {}
                    return;
                  }
                  applyPreset(v);
                }} defaultValue=""
                  style={{ flex: 1, background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '4px 8px', fontSize: '12px' }}>
                  <option value="">— Choose a scene concept —</option>
                  <option value="__random__">— Random Preset —</option>
                  {Object.entries(PROMPT_PRESETS)
                    .filter(([, pr]) => ((pr as any).nsfwScore ?? 0) <= (builder.nsfwLevel ?? 0))
                    .map(([key, pr]) => (
                      <option key={key} value={key}>{key.replace(/-/g, ' ')} {pr.description ? '— ' + pr.description : ''}</option>
                    ))}
                </select>
                <span style={{ fontSize: '10px', color: 'var(--tx3)' }}>filtered by level</span>
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
                          <button onClick={() => togglePin(pinK)} title={pinnedNow ? 'Pinned (protected from Inspire All)' : 'Pin this field'} style={{ fontSize: '9px', padding: '0 1px', background: 'none', border: 'none', color: pinnedNow ? 'var(--ac)' : 'var(--tx3)', cursor: 'pointer' }}>📌</button>
                        );
                        const randBtn = (
                          <button onClick={() => randomizeOneCategory(cat, true, i)} title="random this field" style={{ fontSize: '9px', padding: '0 2px', background: 'none', border: 'none', color: 'var(--ac)', cursor: 'pointer' }}>🎲</button>
                        );
                        if (cat === 'age' || charKey === 'age') {
                          const ageStr = (val || '').toString();
                          const ageDisplay = ageStr && /^\d/.test(ageStr) ? ageStr : '';
                          return (
                            <div key={charKey} style={{ minWidth: '70px', flex: 1 }}>
                              <div style={{ fontSize: '10px', color: 'var(--tx3)', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '2px' }}>
                                {label}{pinBtn}{randBtn}
                              </div>
                              <input type="number" min={18} step={1} value={ageDisplay} placeholder="18+"
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
                              {label}{pinBtn}{randBtn}
                            </div>
                            <select value={cur} title={label} onChange={(e: any) => {
                              const v = e.target.value;
                              if (v === '__random__') { randomizeOneCategory(cat, true, i); return; }
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
              <div className="prompts-builder-2col" style={{ display: 'grid', gap: '12px' }}>
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
                          {cat === 'action' ? 'Action' : 'Pose'}
                          <button onClick={() => togglePin(cat)} title={pinnedNow ? 'Pinned (protected from Inspire All)' : 'Pin'} style={{ fontSize: '9px', padding: '0 1px', background: 'none', border: 'none', color: pinnedNow ? 'var(--ac)' : 'var(--tx3)', cursor: 'pointer' }}>📌</button>
                          <button onClick={() => randomizeOneCategory(cat, false)} style={{ fontSize: '9px', padding: '0 3px', background: 'none', border: 'none', color: 'var(--ac)', cursor: 'pointer' }}>🎲</button>
                        </div>
                        <select value={val} title={cat} onChange={(e: any) => {
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
                          <button onClick={() => togglePin(cat)} title={pinnedNow ? 'Pinned (protected from Inspire All)' : 'Pin'} style={{ fontSize: '9px', padding: '0 1px', background: 'none', border: 'none', color: pinnedNow ? 'var(--ac)' : 'var(--tx3)', cursor: 'pointer' }}>📌</button>
                          <button onClick={() => randomizeOneCategory(cat, false)} style={{ fontSize: '9px', padding: '0 3px', background: 'none', border: 'none', color: 'var(--ac)', cursor: 'pointer' }}>🎲</button>
                        </div>
                        <select value={val} title={cat} onChange={(e: any) => {
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
                <div className="prompts-photo-grid" style={{ display: 'grid', gap: '10px' }}>
                  {(['photography','lighting','style','quality'] as const).map(cat => {
                    const val = (builder as any)[cat] || '';
                    const opts = getSafeOptions(cat);
                    const token = (BUILDER_CATEGORY_WILDCARDS[cat]||[cat])[0];
                    const pinnedNow = isPinned(cat);
                    return (
                      <div key={cat}>
                        <div style={{ fontSize: '11px', color: 'var(--tx3)', marginBottom: '3px', display: 'flex', alignItems: 'center', gap: '3px', textTransform: 'capitalize' }}>
                          {cat}
                          <button onClick={() => togglePin(cat)} title={pinnedNow ? 'Pinned (protected from Inspire All)' : 'Pin'} style={{ fontSize: '9px', padding: '0 1px', background: 'none', border: 'none', color: pinnedNow ? 'var(--ac)' : 'var(--tx3)', cursor: 'pointer' }}>📌</button>
                          <button onClick={() => randomizeOneCategory(cat, false)} style={{ fontSize: '9px', padding: '0 2px', background: 'none', border: 'none', color: 'var(--ac)', cursor: 'pointer' }}>🎲</button>
                        </div>
                        <select value={val} title={cat} onChange={(e: any) => {
                          const v = e.target.value;
                          if (v === '__random__') { randomizeOneCategory(cat, false); return; }
                          updateBuilder({ [cat]: v } as any);
                        }} style={{ width: '100%', fontSize: '11px', padding: '3px 4px', background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '3px', color: 'var(--tx)' }}>
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
                <button onClick={composeBuilderPrompt} style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '5px', padding: '6px 14px', fontSize: '13px', cursor: 'pointer', fontWeight: 600 }}>Compose Prompt</button>
                <button onClick={() => { const p = composeBuilderPrompt(); if (p) navigator.clipboard?.writeText(p); }} style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '4px', padding: '5px 8px', fontSize: '12px', cursor: 'pointer' }}>Copy</button>
                <span style={{ fontSize: '10px', color: 'var(--tx3)', marginLeft: 'auto' }}>{Object.keys(BUILDER_CATEGORY_WILDCARDS).length}+ wildcard categories</span>
              </div>
            </div>

            {/* Prompt text area */}
            <div style={{ border: '1px solid var(--brd)', borderRadius: '6px', overflow: 'hidden', flexShrink: 0 }}>
              <div style={{ padding: '6px 12px', background: 'var(--bg3)', borderBottom: '1px solid var(--brd)', fontSize: '12px', color: 'var(--tx3)' }}>
                Prompt text — compose above or type directly
              </div>
              <textarea
                ref={promptTextareaRef}
                value={generatedPrompt}
                onInput={(e: any) => setGeneratedPrompt(e.target.value)}
                placeholder="Use 'Compose Prompt' to generate from the builder, or type your prompt here…"
                style={{ width: '100%', minHeight: '100px', resize: 'vertical', background: 'var(--bg2)', border: 'none', color: 'var(--tx)', padding: '10px 12px', fontSize: '13px', fontFamily: 'monospace', lineHeight: '1.6', boxSizing: 'border-box', outline: 'none', display: 'block' }}
              />
            </div>
          </div>

          {/* ── Wildcards panel (right column) ── */}
          <div style={{ width: '280px', flexShrink: 0, overflowY: 'auto', padding: '12px 14px', borderLeft: '1px solid var(--brd)', background: 'var(--bg3)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--tx2)', paddingBottom: '6px', borderBottom: '1px solid var(--brd)' }}>🃏 Wildcards ({wildcards.length})</div>
            <WildcardsPanel wildcards={wildcards} onRefresh={reloadWildcards} onInsert={insertWildcard} />
          </div>
        </div>
      </div>
    </div>
  );
};

// ── PromptsView ───────────────────────────────────────────────────────

export const PromptsView = () => {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [query, setQuery] = useState('');
  const [editPrompt, setEditPrompt] = useState<Prompt | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [sendPrompt, setSendPrompt] = useState<Prompt | null>(null);
  const [sendResponse, setSendResponse] = useState('');
  const [isMassImportOpen, setIsMassImportOpen] = useState(false);
  const [massImportText, setMassImportText] = useState('');
  const [showTemplateDrawer, setShowTemplateDrawer] = useState(false);
  const [templateValues, setTemplateValues] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem(PROMPT_TEMPLATE_VALUES_KEY) || '{}'); } catch { return {}; }
  });
  const [valorizedTexts, setValorizedTexts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');

  // Find & replace
  const [isFindReplaceOpen, setIsFindReplaceOpen] = useState(false);
  const [frFind, setFrFind] = useState('');
  const [frReplace, setFrReplace] = useState('');
  const [frCaseSensitive, setFrCaseSensitive] = useState(false);
  const [frRegex, setFrRegex] = useState(false);
  const [frBusy, setFrBusy] = useState(false);

  // Combinatorial expansion
  const [comboPrompt, setComboPrompt] = useState<Prompt | null>(null);
  const [comboSelected, setComboSelected] = useState<Set<number>>(new Set());
  const [comboBusy, setComboBusy] = useState(false);

  const txtInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const wildcardCacheRef = useRef(new Map<string, string[]>()).current;

  const w = window as any;

  useEffect(() => {
    loadPrompts();
  }, []);

  const loadPrompts = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/prompts');
      const data = await res.json();
      setPrompts(data);
    } catch (e) {
      console.error(e);
      setPrompts([]);
    } finally {
      setLoading(false);
    }
  };

  const getFilteredPrompts = () => {
    if (!query) return prompts;
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const include = tokens.filter(t => !t.startsWith('-'));
    const exclude = tokens.filter(t => t.startsWith('-')).map(t => t.slice(1)).filter(Boolean);
    return prompts.filter(p => {
      const hay = [p.title || '', p.text || '', ...(p.tags || [])].join(' ').toLowerCase();
      if (exclude.some(w => hay.includes(w))) return false;
      if (include.length && !include.some(w => hay.includes(w))) return false;
      return true;
    });
  };

  const savePrompt = async (p: Partial<Prompt>) => {
    try {
      const isEdit = !!p.id;
      const res = await fetch(isEdit ? `/api/prompts/${p.id}` : '/api/prompts', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p)
      });
      if (res.ok) {
        setIsAddModalOpen(false);
        setEditPrompt(null);
        loadPrompts();
        if (w.toast) w.toast(isEdit ? 'Saved' : 'Added');
      } else {
        if (w.toast) w.toast('Save failed');
      }
    } catch (e) {
      if (w.toast) w.toast('Save failed');
    }
  };

  const deletePrompt = async (id: string) => {
    if (!confirm('Delete this prompt?')) return;
    try {
      const res = await fetch(`/api/prompts/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setPrompts(prompts.filter(p => p.id !== id));
        if (w.toast) w.toast('Deleted');
      } else {
        if (w.toast) w.toast('Delete failed');
      }
    } catch (e) {
      if (w.toast) w.toast('Delete failed');
    }
  };

  const deleteAllPrompts = async () => {
    if (!confirm('Are you sure you want to delete ALL prompts? This action cannot be undone.')) return;
    try {
      const response = await fetch('/api/prompts/all', { method: 'DELETE' });
      if (response.ok) {
        setPrompts([]);
        if (w.toast) w.toast('All prompts deleted');
      } else {
        const err = await response.json();
        if (w.toast) w.toast('Error: ' + (err.error || 'Failed to delete'));
      }
    } catch (e) {
      if (w.toast) w.toast('Network error');
    }
  };

  const execSendPromptTo = async (serviceId: string) => {
    if (!sendPrompt) return;
    const text = valorizedTexts[sendPrompt.id] || sendPrompt.text;

    if (serviceId === '__comfyui__') {
      setSendResponse('Queuing in ComfyUI…');
      try {
        const r = await fetch('/api/prompts/send-comfyui', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        const d = await r.json();
        if (!r.ok) { setSendResponse('Error: ' + (d.error || r.status)); return; }
        setSendResponse('Queued in ComfyUI (prompt_id: ' + d.prompt_id + ')');
        if (w.toast) w.toast('Sent to ComfyUI');
      } catch (e: any) {
        setSendResponse('Error: ' + e.message);
      }
      return;
    }

    const site = PROMPT_SITES.find(s => s.id === serviceId);
    if (!site) return;
    await navigator.clipboard.writeText(text).catch(() => {});
    window.open(site.url, '_blank');
    if (w.toast) w.toast('Prompt copied — paste in ' + site.name, 2500);
    setSendPrompt(null);
  };

  const saveMassImport = async () => {
    const lines = massImportText.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) { if (w.toast) w.toast('Paste at least one prompt'); return; }
    let added = 0;
    for (const text of lines) {
      try {
        const r = await fetch('/api/prompts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
        if (r.ok) added++;
      } catch {}
    }
    setIsMassImportOpen(false);
    loadPrompts();
    if (w.toast) w.toast('Imported ' + added + ' prompt' + (added > 1 ? 's' : ''));
  };

  const scanTemplates = () => {
    const found = new Set<string>();
    prompts.forEach(p => { (p.text.match(TEMPLATE_REGEX) || []).forEach(m => found.add(m)); });
    found.delete('$START'); found.delete('$END');
    return [...found].sort();
  };

  // $START / $END are fixed templates: if given a value, it's prepended/appended
  // to every prompt's text (rather than substituted for a placeholder in the text).
  const computeValorizedTexts = (vals: Record<string, string[]>): Record<string, string> => {
    const newValorizedTexts: Record<string, string> = {};
    const startVals = (vals['START'] || []).filter(Boolean);
    const endVals = (vals['END'] || []).filter(Boolean);
    prompts.forEach(p => {
      const tpls = [...new Set(p.text.match(TEMPLATE_REGEX) || [])].filter(t => t !== '$START' && t !== '$END');
      let text = p.text;
      tpls.forEach(t => {
        const name = t.slice(1);
        const tplVals = vals[name];
        if (tplVals && tplVals.length) text = text.split(t).join(tplVals[Math.floor(Math.random() * tplVals.length)]);
      });
      if (startVals.length) text = startVals[Math.floor(Math.random() * startVals.length)] + ' ' + text;
      if (endVals.length) text = text + ' ' + endVals[Math.floor(Math.random() * endVals.length)];
      if (text !== p.text) newValorizedTexts[p.id] = text;
    });
    return newValorizedTexts;
  };

  const applyValorize = () => {
    const newValorizedTexts = computeValorizedTexts(templateValues);
    setValorizedTexts(newValorizedTexts);
    const count = Object.keys(newValorizedTexts).length;
    if (w.toast) w.toast(count ? 'Templates valorized in ' + count + ' prompt' + (count > 1 ? 's' : '') : 'No templates matched');
  };

  // Remember template values across sessions, and live-update the preview as you type.
  useEffect(() => {
    localStorage.setItem(PROMPT_TEMPLATE_VALUES_KEY, JSON.stringify(templateValues));
    if (Object.keys(templateValues).length === 0) { setValorizedTexts({}); return; }
    setValorizedTexts(computeValorizedTexts(templateValues));
  }, [templateValues, prompts]);

  const clearValorize = () => {
    setTemplateValues({});
    setValorizedTexts({});
    if (w.toast) w.toast('Valorization cleared');
  };

  // ── Find & Replace across all prompts ──────────────────────────────

  const buildFindReplaceRegex = (): RegExp | null => {
    if (!frFind) return null;
    try {
      const source = frRegex ? frFind : frFind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(source, frCaseSensitive ? 'g' : 'gi');
    } catch { return null; }
  };

  const findReplaceMatchInfo = () => {
    const re = buildFindReplaceRegex();
    if (!re) return { matches: 0, affected: 0, invalid: !!frFind && !!frRegex };
    let matches = 0, affected = 0;
    for (const p of prompts) {
      re.lastIndex = 0;
      const found = p.text.match(re);
      if (found && found.length) { matches += found.length; affected++; }
    }
    return { matches, affected, invalid: false };
  };

  const applyFindReplace = async () => {
    const re = buildFindReplaceRegex();
    if (!re) return;
    setFrBusy(true);
    let updated = 0;
    const next = [...prompts];
    for (let i = 0; i < next.length; i++) {
      const p = next[i];
      re.lastIndex = 0;
      if (!re.test(p.text)) continue;
      re.lastIndex = 0;
      const newText = p.text.replace(re, frReplace);
      if (newText === p.text) continue;
      try {
        const r = await fetch(`/api/prompts/${p.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: newText }) });
        if (r.ok) { next[i] = { ...p, text: newText }; updated++; }
      } catch {}
    }
    setPrompts(next);
    setFrBusy(false);
    setIsFindReplaceOpen(false);
    if (w.toast) w.toast(updated ? `Replaced in ${updated} prompt${updated !== 1 ? 's' : ''}` : 'No matches found');
  };

  // ── Combinatorial prompts: {opt1|opt2|opt3} ────────────────────────

  const rollPrompt = async (p: Prompt) => {
    const resolved = await resolveRandomPrompt(p.text, wildcardCacheRef);
    setValorizedTexts(v => ({ ...v, [p.id]: resolved }));
    if (w.toast) w.toast('Rolled a random variant — click 🎲 again to reroll');
  };

  const openComboModal = (p: Prompt) => {
    setComboPrompt(p);
    setComboSelected(new Set());
  };

  const toggleComboSelection = (idx: number) => {
    setComboSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const addSelectedCombosAsPrompts = async () => {
    if (!comboPrompt) return;
    const variants = expandCombinations(comboPrompt.text, 200);
    const selected = [...comboSelected].map(i => variants[i]).filter(Boolean);
    if (!selected.length) { if (w.toast) w.toast('Select at least one variant'); return; }
    setComboBusy(true);
    let added = 0;
    for (const text of selected) {
      try {
        const r = await fetch('/api/prompts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
        if (r.ok) added++;
      } catch {}
    }
    setComboBusy(false);
    setComboPrompt(null);
    loadPrompts();
    if (w.toast) w.toast('Added ' + added + ' prompt' + (added !== 1 ? 's' : ''));
  };

  // ── Random prompt ───────────────────────────────────────────────────

  const openRandomPrompt = () => {
    const pool = getFilteredPrompts();
    if (!pool.length) { if (w.toast) w.toast('No prompts to pick from'); return; }
    const p = pool[Math.floor(Math.random() * pool.length)];
    setExpandedIds(prev => new Set(prev).add(p.id));
    setSendPrompt(p);
  };

  const shufflePrompts = () => {
    setPrompts(prev => {
      const arr = [...prev];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    });
    if (w.toast) w.toast('Shuffled');
  };

  const handleTxtImport = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    input.value = '';
    if (!lines.length) { if (w.toast) w.toast('No prompts found in file'); return; }
    let added = 0;
    for (const line of lines) {
      try {
        const r = await fetch('/api/prompts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: line }) });
        if (r.ok) added++;
      } catch {}
    }
    loadPrompts();
    if (w.toast) w.toast('Imported ' + added + ' prompt' + (added !== 1 ? 's' : ''));
  };

  const exportJson = () => {
    const data = JSON.stringify(prompts, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'prompts.json'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleJsonImport = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    let data: any[];
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed)) throw new Error();
      data = parsed;
    } catch {
      if (w.toast) w.toast('Invalid JSON file');
      input.value = '';
      return;
    }
    input.value = '';
    let added = 0;
    for (const p of data) {
      if (!p.text) continue;
      try {
        const r = await fetch('/api/prompts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: p.text, sites: p.sites }) });
        if (r.ok) added++;
      } catch {}
    }
    loadPrompts();
    if (w.toast) w.toast('Imported ' + added + ' prompt' + (added !== 1 ? 's' : ''));
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const copyPromptText = (p: Prompt) => {
    const text = valorizedTexts[p.id] || p.text;
    navigator.clipboard?.writeText(text).then(() => { if (w.toast) w.toast('Copied'); });
  };

  const filteredPrompts = getFilteredPrompts();
  const templates = scanTemplates();

  return (
    <div className="prompts-view on">
      <input ref={txtInputRef} type="file" accept=".txt" aria-label="Import prompts from TXT file" style={{ display: 'none' }} onChange={handleTxtImport as any} />
      <input ref={jsonInputRef} type="file" accept=".json" aria-label="Import prompts from JSON file" style={{ display: 'none' }} onChange={handleJsonImport as any} />
      <div className="section-header">
        <h2>AI Prompts <span className="pt-count">{prompts.length}</span></h2>
        <div className="pt-toolbar">
          <div className="gallery-filter-wrap" style={{ display: 'flex', alignItems: 'center' }}>
            <input type="text" placeholder="Filter prompts…" value={query}
              onInput={(e: any) => setQuery(e.target.value)}
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '4px 10px', borderRadius: '999px', fontSize: '0.75rem', width: '150px' }}
            />
            {query && <span style={{ fontSize: '0.75rem', color: 'var(--tx3)', marginLeft: '8px' }}>{filteredPrompts.length} / {prompts.length}</span>}
          </div>
          <button className={`sort-btn ${showTemplateDrawer || Object.keys(valorizedTexts).length > 0 ? 'sort-btn--valorize-active' : ''}`} onClick={() => setShowTemplateDrawer(v => !v)} title="Global templates ($NAME, $JOB, …) and $START / $END — assign values to swap them across all prompts">🧩 Templates</button>
          <button className="sort-btn" onClick={openRandomPrompt} title="Pick a random prompt">🎲 Random</button>
          <button className="sort-btn" onClick={shufflePrompts} title="Shuffle the display order">🔀 Shuffle</button>
          <div className="pt-view-toggle">
            <button className={`pt-view-toggle-btn ${viewMode === 'card' ? 'active' : ''}`} onClick={() => setViewMode('card')} title="Card view">▦</button>
            <button className={`pt-view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`} onClick={() => setViewMode('list')} title="List view">☰</button>
          </div>
          <button className="sort-btn sort-btn--primary" onClick={() => setIsAddModalOpen(true)}>+ New Prompt</button>
          <button className="sort-btn" onClick={() => setIsMassImportOpen(true)}>Mass Import</button>
          <button className="sort-btn" onClick={() => txtInputRef.current?.click()} title="Import a .txt file — each line becomes a prompt">Import TXT</button>
          <button className="sort-btn" onClick={() => jsonInputRef.current?.click()} title="Import prompts from a JSON file">Import JSON</button>
          <button className="sort-btn" onClick={exportJson} title="Export all prompts as JSON">Export JSON</button>
          <button className="sort-btn" onClick={() => setIsFindReplaceOpen(true)} title="Find and replace a word or phrase across every prompt">Find &amp; Replace</button>
          <button className="sort-btn" onClick={() => {
            const text = filteredPrompts.map(p => valorizedTexts[p.id] || p.text).join('\n\n');
            navigator.clipboard.writeText(text).then(() => { if (w.toast) w.toast('Copied ' + filteredPrompts.length + ' prompts'); });
          }}>Copy All</button>
          <button className="sort-btn pt-danger-btn" onClick={deleteAllPrompts}>Delete All</button>
        </div>
      </div>

      {showTemplateDrawer && (
        <div className="pt-template-drawer">
          <div className="pt-template-drawer-head">
            <span className="pt-template-drawer-title">🧩 Global Templates</span>
            <span className="pt-template-drawer-hint">Recognized <span className="pt-token pt-token--template">$UPPERCASE</span> placeholders — set values and Apply to swap them across every prompt below.</span>
          </div>
          <div className="pt-template-drawer-body">
            {([['START', '$START — prepended to every prompt'], ['END', '$END — appended to every prompt']] as const).map(([name, label]) => (
              <div className="pt-template-row" key={name}>
                <div className="pt-template-name" style={{ color: '#e84040' }} title={label}>${name}</div>
                <textarea
                  className="pt-template-input"
                  placeholder={`One value per line — randomly ${name === 'START' ? 'prepended to' : 'appended to'} every prompt when valorized`}
                  value={(templateValues[name] || []).join('\n')}
                  onInput={(e: any) => {
                    const lines = e.target.value.split('\n').map((l: string) => l.trim()).filter(Boolean);
                    setTemplateValues({ ...templateValues, [name]: lines });
                  }}
                />
              </div>
            ))}
            {templates.length === 0 ? (
              <div className="pt-template-empty">No other $UPPERCASE template strings found in your prompts.</div>
            ) : (
              templates.map(t => {
                const name = t.slice(1);
                return (
                  <div className="pt-template-row" key={t}>
                    <div className="pt-template-name">{t}</div>
                    <textarea
                      className="pt-template-input"
                      placeholder="One value per line"
                      value={(templateValues[name] || []).join('\n')}
                      onInput={(e: any) => {
                        const lines = e.target.value.split('\n').map((l: string) => l.trim()).filter(Boolean);
                        setTemplateValues({ ...templateValues, [name]: lines });
                      }}
                    />
                  </div>
                );
              })
            )}
          </div>
          <div className="pt-template-drawer-actions">
            <button className="modal-btn" onClick={clearValorize} style={{ display: Object.keys(valorizedTexts).length > 0 ? '' : 'none' }}>Clear</button>
            <button className="btn-primary" onClick={applyValorize}>Apply</button>
          </div>
        </div>
      )}

      <div style={{ padding: '16px 0' }}>
        {loading && <div style={{ color: 'var(--tx2)', fontSize: '0.85rem' }}>Loading…</div>}
        {!loading && filteredPrompts.length === 0 && (
          <div style={{ color: 'var(--tx2)', fontSize: '0.85rem' }}>
            {prompts.length === 0 ? 'No prompts yet — click "New Prompt" to create one.' : 'No prompts match your filter.'}
          </div>
        )}
        {!loading && filteredPrompts.length > 0 && (
          <div className={`pt-card-list ${viewMode === 'list' ? 'pt-view-list' : ''}`}>
            {filteredPrompts.map(p => {
              const isValorized = !!valorizedTexts[p.id];
              const displayText = valorizedTexts[p.id] || p.text;
              const expanded = expandedIds.has(p.id);
              const comboCount = countCombinations(p.text);
              const canRoll = hasComboGroup(p.text) || hasWildcardToken(p.text);
              return (
                <div className="pt-card" key={p.id}>
                  <div className="pt-card-main">
                    <div className="pt-card-head">
                      <span className="pt-card-title">{p.title || '(untitled)'}</span>
                      {comboCount > 1 && (
                        <span className="pt-combo-badge" title={`${comboCount} possible combinations`}>⊞ {comboCount}</span>
                      )}
                      {(p.tags || []).length > 0 && (
                        <div className="pt-card-tags">
                          {(p.tags || []).map(t => <span key={t} className="pt-card-tag">{t}</span>)}
                        </div>
                      )}
                    </div>
                    <div
                      className={`pt-card-text ${expanded ? 'expanded' : ''} ${isValorized ? 'pt-card-text--valorized' : ''}`}
                      onClick={() => toggleExpanded(p.id)}
                      title={expanded ? 'Click to collapse' : 'Click to expand'}
                    >
                      {renderPromptText(displayText)}
                    </div>
                  </div>
                  <div className="pt-card-actions">
                    {canRoll && (
                      <button className="pt-btn" onClick={() => rollPrompt(p)} title="Roll a random variant (resolves {combo|combo} and __wildcards__)">🎲</button>
                    )}
                    {comboCount > 1 && (
                      <button className="pt-btn" onClick={() => openComboModal(p)} title="Expand all combinations">⊞</button>
                    )}
                    <button className="pt-btn" onClick={() => copyPromptText(p)} title="Copy prompt text">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                    <button className="pt-btn" onClick={() => setSendPrompt(p)} title="Send prompt">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    </button>
                    <button className="pt-btn" onClick={() => { setEditPrompt(p); setIsAddModalOpen(true); }} title="Edit">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button className="pt-btn pt-btn-del" onClick={() => deletePrompt(p.id)} title="Delete">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Prompt Builder Modal (New + Edit) */}
      {isAddModalOpen && (
        <PromptBuilderModal
          initial={editPrompt}
          onSave={(data) => savePrompt(data)}
          onClose={() => { setIsAddModalOpen(false); setEditPrompt(null); }}
        />
      )}

      {/* Send Modal */}
      {sendPrompt && (
        <div className="modal on" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10000 }}>
          <div className="modal-dialog" style={{ background: 'var(--bg2)', borderRadius: '12px', padding: '24px', width: '540px', maxWidth: '90%' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0 }}>Send Prompt</h3>
              <button className="modal-close" onClick={() => { setSendPrompt(null); setSendResponse(''); }} style={{ background: 'none', border: 'none', color: 'var(--tx2)', cursor: 'pointer' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <textarea className="modal-input" style={{ height: '120px', resize: 'vertical', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px', borderRadius: '4px' }}
                readOnly value={valorizedTexts[sendPrompt.id] || sendPrompt.text} />
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--tx2)', marginTop: '5px' }}>Web Services (Copies prompt & opens site)</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '8px' }}>
                {PROMPT_SITES.filter(s => !s.local).map(s => (
                  <button key={s.id} className="modal-btn"
                    style={{ padding: '6px 10px', fontSize: '0.8rem', background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '6px', cursor: 'pointer', color: 'var(--tx)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                    onClick={() => execSendPromptTo(s.id)}>{s.name}</button>
                ))}
              </div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--tx2)', marginTop: '5px' }}>Local Execution</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button className="pt-btn" style={{ padding: '8px 16px', fontSize: '0.85rem', whiteSpace: 'nowrap', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '4px', cursor: 'pointer' }} onClick={() => execSendPromptTo('__comfyui__')} title="Queue this prompt on your running ComfyUI instance (configure workflow in Settings)">
                  Send to ComfyUI
                </button>
              </div>
              {sendResponse && (
                <div style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '8px', padding: '12px', fontSize: '0.82rem', lineHeight: '1.6', whiteSpace: 'pre-wrap', maxHeight: '260px', overflowY: 'auto', color: 'var(--tx)' }}>
                  {sendResponse}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mass Import Modal */}
      {isMassImportOpen && (
        <div className="modal on" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10000 }}>
          <div className="modal-dialog" style={{ background: 'var(--bg2)', borderRadius: '12px', padding: '24px', width: '600px', maxWidth: '90%' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0 }}>Mass Import Prompts</h3>
              <button className="modal-close" onClick={() => setIsMassImportOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--tx2)', cursor: 'pointer' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--tx2)' }}>Paste prompts, one per line.</p>
              <textarea className="modal-input" style={{ height: '200px', resize: 'vertical', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px', borderRadius: '4px' }}
                value={massImportText} onInput={(e: any) => setMassImportText(e.target.value)} placeholder="Paste here…" />
              <div style={{ fontSize: '0.75rem', color: 'var(--tx3)' }}>
                {massImportText.split('\n').map(l => l.trim()).filter(Boolean).length} prompts detected
              </div>
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button className="modal-btn" onClick={() => setIsMassImportOpen(false)}>Cancel</button>
              <button className="btn-primary" onClick={saveMassImport}>Import</button>
            </div>
          </div>
        </div>
      )}

      {/* Find & Replace Modal */}
      {isFindReplaceOpen && (() => {
        const info = findReplaceMatchInfo();
        return (
          <div className="modal on" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10000 }}>
            <div className="modal-dialog" style={{ background: 'var(--bg2)', borderRadius: '12px', padding: '24px', width: '480px', maxWidth: '90%' }}>
              <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ margin: 0 }}>Find &amp; Replace</h3>
                <button className="modal-close" aria-label="Close" onClick={() => setIsFindReplaceOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--tx2)', cursor: 'pointer' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <div className="modal-body pt-fr-row">
                <input className="modal-input" placeholder="Find…" value={frFind}
                  onInput={(e: any) => setFrFind(e.target.value)}
                  style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px', borderRadius: '4px' }} autoFocus />
                <input className="modal-input" placeholder="Replace with…" value={frReplace}
                  onInput={(e: any) => setFrReplace(e.target.value)}
                  style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px', borderRadius: '4px' }} />
                <div className="pt-fr-checks">
                  <label><input type="checkbox" checked={frCaseSensitive} onChange={(e: any) => setFrCaseSensitive(e.target.checked)} /> Case sensitive</label>
                  <label><input type="checkbox" checked={frRegex} onChange={(e: any) => setFrRegex(e.target.checked)} /> Regex</label>
                </div>
                {frFind && (
                  <div className="pt-fr-info">
                    {info.invalid ? 'Invalid regular expression' :
                      `${info.matches} match${info.matches !== 1 ? 'es' : ''} in ${info.affected} prompt${info.affected !== 1 ? 's' : ''}`}
                  </div>
                )}
              </div>
              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                <button className="modal-btn" onClick={() => setIsFindReplaceOpen(false)}>Cancel</button>
                <button className="btn-primary" disabled={!frFind || info.matches === 0 || frBusy} onClick={applyFindReplace}>
                  {frBusy ? 'Replacing…' : 'Replace All'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Combinatorial Expansion Modal */}
      {comboPrompt && (() => {
        const variants = expandCombinations(comboPrompt.text, 200);
        const allSelected = comboSelected.size === variants.length && variants.length > 0;
        return (
          <div className="modal on" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10000 }}>
            <div className="modal-dialog" style={{ background: 'var(--bg2)', borderRadius: '12px', padding: '24px', width: '640px', maxWidth: '92%' }}>
              <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ margin: 0 }}>Expand Combinations ({variants.length}{countCombinations(comboPrompt.text) > 200 ? '+' : ''})</h3>
                <button className="modal-close" aria-label="Close" onClick={() => setComboPrompt(null)} style={{ background: 'none', border: 'none', color: 'var(--tx2)', cursor: 'pointer' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--tx3)' }}>{comboSelected.size} selected — pick variants to save as new prompts</span>
                  <button className="modal-btn" onClick={() => setComboSelected(allSelected ? new Set() : new Set(variants.map((_, i) => i)))}>
                    {allSelected ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                <div className="pt-combo-list">
                  {variants.map((v, i) => (
                    <label className="pt-combo-item" key={i}>
                      <input type="checkbox" checked={comboSelected.has(i)} onChange={() => toggleComboSelection(i)} />
                      <span>{renderPromptText(v)}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                <button className="modal-btn" onClick={() => setComboPrompt(null)}>Cancel</button>
                <button className="btn-primary" disabled={comboSelected.size === 0 || comboBusy} onClick={addSelectedCombosAsPrompts}>
                  {comboBusy ? 'Adding…' : `Add ${comboSelected.size || ''} as New Prompt${comboSelected.size === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
