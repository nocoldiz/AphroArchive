// public/src/characterPrompts.ts
// Centralized image/character prompt templates + advanced randomizer.
// Prompt generator (advanced mode dropdowns + Inspire) now uses HARDCODED_OPTIONS below.
// This means the generator UI no longer requires manually populating db/wildcards/ folder.
// (You can still put custom .txt there for __name__ resolution, for the Static
// templates mode, or for manual insertion via the Wildcards panel.)
// The detailed combinatorial full-prompt templates have been removed from db/wildcards/.
// Builder uses the curated lists here + {combinatorial} where useful.
//
// Philosophy:
// - Compose using __wildcard__ tokens resolved at runtime (or preview) from db/wildcards/*.txt .
// - Model-specific prefix/suffix.
// - NSFW mode for explicit porn character prompts.
// - Combinatorial for many variants.
// - Static templates below also rely on the same wildcards.
//
// NOTE: NSFW-specific data (HARDCODED_OPTIONS, PROMPT_PRESETS, fragment pools,
// SFW_THRESHOLD, isNsfwPhrase, sanitizeBuilderStateForLevel, pickRandomForCategory,
// inspireRandomBuilder) has been moved to nsfwCharacterPrompts.ts.

// (types defined below; no import needed)

// ── Original static templates, kept for compatibility ──
// Static templates use __wildcard__ from db/wildcards/ + model specific prefixes
export const PROMPT_TEMPLATES: Record<string, { label: string; template: string; desc: string }> = {
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

export const AI_TARGETS = [
  { id: 'ponyxl', label: 'PonyXL (score tags + detailed)' },
  { id: 'flux', label: 'Flux (natural language)' },
  { id: 'sd15', label: 'SD 1.5 / Realistic' },
  { id: 'sdxl', label: 'SDXL' },
  { id: 'general', label: 'General / Any' },
];

// ── Advanced Randomizer Types & Targets ─────────────────────────────────

export const MODEL_TARGETS = ['ponyxl', 'flux', 'sdxl', 'sd15', 'general'] as const;
export type ModelTarget = typeof MODEL_TARGETS[number];

export interface RandGenOptions {
  target: ModelTarget;
  isNsfw: boolean;
  // If true, attempt to resolve some __wildcards__ client-side for preview (requires cache/fetcher)
  resolveWildcards?: boolean;
  // Optional cache of wildcard name → resolved lines
  wildcardCache?: Map<string, string[]>;
  /** If provided, replaces __subject__ (and similar) with this fixed description built by character editor */
  customSubject?: string;
}

// ── Model-specific base prefixes / styles (adapts the prompt "base") ────

export function getModelPrefix(target: ModelTarget, isNsfw: boolean): string {
  switch (target) {
    case 'ponyxl':
      return isNsfw
        ? 'score_9, score_8_up, score_7_up, score_6_up, source_pony, '
        : 'score_9, score_8_up, score_7_up, source_pony, ';
    case 'flux':
      return isNsfw
        ? 'highly detailed explicit cinematic photograph of '
        : 'cinematic still of ';
    case 'sdxl':
    case 'sd15':
      return isNsfw
        ? 'photorealistic, raw photo, explicit, '
        : 'photorealistic, raw photo, ';
    case 'general':
    default:
      return isNsfw ? 'masterpiece, best quality, explicit character, ' : 'masterpiece, best quality, ';
  }
}

export function getModelSuffix(target: ModelTarget, isNsfw: boolean): string {
  if (target === 'ponyxl') {
    return isNsfw ? ', intricate pussy details, best quality, sharp focus, 8k' : ', detailed face, sharp focus, high quality';
  }
  if (target === 'flux') {
    return isNsfw ? ', ultra detailed skin texture, sensual atmosphere, 8k' : ', moody atmosphere, intricate, photoreal';
  }
  return isNsfw ? ', detailed skin, erotic, sharp focus' : ', sharp focus, high quality';
}

// Graduated NSFW intensity tags driven by the new slider (0 = SFW/artistic ... 100 = absolute degenerate heavy fetish).
// This is appended to prompts built from presets + dropdowns in the advanced builder.
// Replaces the old binary NSFW checkbox for the prompt presets / builder flow.
export function getNsfwIntensity(level: number): string {
  if (level <= 10) return 'elegant pose, artistic composition, tasteful, soft lighting';
  if (level <= 25) return 'sensual, alluring, teasing, pinup style, subtle eroticism';
  if (level <= 40) return 'erotic, seductive, revealing, aroused body language';
  if (level <= 55) return 'explicit nudity, detailed anatomy, sexual tension, wet skin';
  if (level <= 70) return 'highly explicit, penetration, fluids, orgasm face, ahegao';
  if (level <= 82) return 'depraved, cum play, light bondage, toys, heavy fetish gear';
  if (level <= 92) return 'extreme fetish, bukkake, public use, mind break, rough, degradation';
  // max degenerate (DEGEN mode 93-100) — very fucked up extreme non-con, sci-fi horror, torture, kidnapping themes
  return 'utterly degenerate filth, absolute heavy fetish, extreme insertions, watersports, fisting, destroyed holes, no limits, full public toilet use, mind shattered, broken mind, living cumdump onahole, kidnapped victim, alien abduction and experimentation, invasive deep probing, oviposition egg implantation, parasitic body infestation, forced medical torture exam, bright surgical lights interrogation chair, non-con vivisection play, electroshock orgasm torture, nipple and clit torture with weights, urethral sounding and stretching, stomach bulge from massive insertions, mind break through pain pleasure overload, tears despair ahegao, bound gagged in dark van, captive human breeding slave, tentacle monster gang use, slime creature all-hole invasion, body modification while conscious, branding ownership marking, snuff fantasy meat toilet, extreme degradation objectification, public use after capture, belly distended alien spawn, psychological torment sensory overload';
}

// ── Fragment pools (used to build prompts) ───
// These provide fallbacks + extra { | } choices. The main detail now comes from
// resolving the __wildcard__ tokens against the existing curated db/wildcards/*.txt
// (subject.txt, pose.txt, sexual_act.txt, clothing_state.txt, expression.txt, etc.).
// NSFW fragment pools have been moved to nsfwCharacterPrompts.ts.

const SFW_SUBJECT_POOL = [
  '__subject__',
  'beautiful {young woman|girl|model}, solo',
  '{stunning|attractive} {woman|person} with __hair__, __eyes__',
];

const SFW_BODY = [
  '__body_type__',
  'elegant figure, __hair__',
  'graceful pose, delicate features',
];

const COMMON_POSE = [
  '__pose__',
  '{standing|seated} contrapposto',
  'looking at viewer',
];

const SFW_EXPR = ['__expression__', 'soft smile', 'confident gaze', 'playful wink'];

const SFW_CLOTHING = ['__clothing__', 'elegant dress', 'casual outfit', 'lingerie'];

const SFW_ACT = ['posing', 'dancing', 'relaxing'];

const LIGHTING_STYLE = ', __lighting__, __style__';

// ── Combinatorial bases for the randomizer (now wildcard-driven) ──
// Bases are intentionally lighter / rely on __wildcard__ tokens from the curated
// db/wildcards/ (subject, body_type, pose, sexual_act, clothing_state, expression,
// lighting, style, setting, breasts, ass, pussy, cock, etc.).
// The removed detailed combinatorial templates (long full-prompt lines) are no
// longer used; variety + explicitness now comes from the wildcards + { | } combos.

const PONY_BASES = [
  'score_9, score_8_up, score_7_up, source_pony, {masterpiece|best quality}, __subject__, {solo female|1girl}, __body_type__, {__clothing__|__clothing_state__}, __pose__, __expression__, __lighting__, __style__',
  'score_9, score_8_up, score_7_up, source_pony, __subject__ with __hair__ and __eyes__, __body_type__, __pose__, __expression__, detailed face, __lighting__',
  // NSFW
  'score_9, score_8_up, score_7_up, source_pony, {explicit|highly detailed}, __subject__, {nude|__clothing_state__}, {__breasts__ , __ass__ | massive __breasts__ , phat ass}, {detailed __pussy__ | spread __pussy__ , __genitals__ }, __pose__, __expression__, {__sexual_act__ | __action__}, {cum on __breasts__ | creampie}, __lighting__, __style__',
  'score_9, score_8_up, score_7_up, source_pony, __subject__, {futanari|female}, {__genitals__ | huge cock and balls | wet pussy}, {on knees presenting|legs held open|__pose__}, {anal|creampie|__sexual_act__}, ahegao, __lighting__, 8k',
];

const FLUX_BASES = [
  'cinematic still of {a beautiful|an elegant} __subject__ with __hair__, __eyes__, __body_type__, wearing {__clothing__|__clothing_state__}, {graceful|thoughtful|__expression__}, __pose__, in __setting__, dramatic __lighting__, __style__, highly detailed, photoreal',
  // NSFW
  'ultra explicit close-up photograph of __subject__ , {completely nude|__clothing_state__}, {spreading her __pussy__ | presenting __pussy__ , __genitals__}, {__breasts__ | thick thighs , __ass__}, {ahegao|__expression__}, {legs spread|__pose__}, {__sexual_act__ | fluids , orgasm}, sensual __lighting__, sharp detail, 8k',
  'photorealistic portrait of __subject__, {nude|__clothing_state__}, {detailed __pussy__ | __genitals__}, {oiled skin|__body_type__}, {__sexual_act__}, {__expression__}, __lighting__, __style__',
];

const SD_BASES = [
  'photorealistic, raw photo, __subject__, __body_type__, __hair__, __eyes__, {__clothing__|__clothing_state__}, __pose__, __expression__, {soft natural light|__lighting__}, __style__, sharp focus, 8k',
  // NSFW
  'raw explicit photo, __subject__ {nude|__clothing_state__ , legs spread}, {detailed __pussy__ | __genitals__ , __cock__}, {__breasts__ | __ass__}, {__pose__ | __sexual_act__}, {ahegao|__expression__}, {cum | fluids}, __lighting__, sharp detail',
];

const GENERAL_BASES = [
  'masterpiece, best quality, __subject__, __clothing__, __pose__, __expression__, __lighting__, __style__',
  'beautiful character, __hair__ , __eyes__, __body_type__, {elegant|__setting__}, __pose__',
  // NSFW
  'explicit character, __subject__ {nude|__clothing_state__}, {__pussy__ | __genitals__ | __breasts__ , __ass__}, {__pose__ | __sexual_act__}, {ahegao|__expression__}, __lighting__, __style__',
];

// ── Main generator implementation ──────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function injectExtraCombinatorics(base: string, isNsfw: boolean): string {
  // Randomly wrap 1-3 segments with extra { | } to boost combo count without destroying structure.
  let p = base;
  const extras: string[] = isNsfw
    ? ['{detailed|glistening|dripping wet}', '{spread|presenting|wide open}', '{shaking|quivering|trembling}', '{thick|hot|sticky}']
    : ['{soft|warm|dramatic}', '{elegant|graceful|confident}'];
  for (let i = 0; i < 2; i++) {
    const ex = pick(extras);
    // crude but effective: insert before some __ or common words
    if (p.includes('__')) {
      p = p.replace(/(__[a-z_]+__)/, `${ex} $1`);
    } else {
      p = p.replace(/, /, `, ${ex} `);
    }
  }
  return p;
}

export async function generateAdvancedRandomCharacterPrompt(
  opts: RandGenOptions
): Promise<string> {
  const { target, isNsfw, resolveWildcards = false, wildcardCache, customSubject } = opts;

  const prefix = getModelPrefix(target, isNsfw);
  const suffix = getModelSuffix(target, isNsfw);

  let bases: string[];
  switch (target) {
    case 'ponyxl': bases = PONY_BASES; break;
    case 'flux':   bases = FLUX_BASES; break;
    case 'sdxl':
    case 'sd15':   bases = SD_BASES; break;
    case 'general':
    default:       bases = GENERAL_BASES; break;
  }

  // Prefer NSFW-flavored bases when isNsfw (they are mixed in the arrays above)
  let base = pick(bases);
  // If we picked a "safe" one in NSFW mode, bias toward more explicit by appending a nsfw fragment
  if (isNsfw && !/(pussy|cock|cum|creampie|nude|spread|fuck|anal|orgasm|ahegao)/i.test(base)) {
    base += `, {${pick(SFW_BODY)} | ${pick(SFW_ACT)}}`;
  }

  base = injectExtraCombinatorics(base, isNsfw);

  let prompt = `${prefix}${base}${suffix}`.replace(/\s+/g, ' ').trim();

  // Custom subject from Character Editor overrides __subject__ (fixed traits for the subject)
  if (customSubject) {
    prompt = prompt.replace(/__subject__/g, customSubject);
  }

  // Optional client-side __ resolve for nice preview (re-uses same logic pattern)
  if (resolveWildcards && wildcardCache) {
    // lightweight inline resolve (avoid circular imports)
    const pattern = /__([a-zA-Z0-9_\/\\-]+)__/g;
    const needed = new Set<string>();
    let m: RegExpExecArray | null;
    const tplForScan = prompt;
    while ((m = pattern.exec(tplForScan)) !== null) needed.add(m[1]);

    for (const name of needed) {
      if (!wildcardCache.has(name)) {
        try {
          const res = await fetch(`/api/prompts/wildcards/${encodeURIComponent(name)}`);
          const data = await res.json();
          const lines: string[] = (data.lines || []).filter((l: string) => l && !l.startsWith('#'));
          wildcardCache.set(name, lines.length ? lines : [name]);
        } catch {
          wildcardCache.set(name, [name]);
        }
      }
    }

    for (let d = 0; d < 6; d++) {
      const before = prompt;
      prompt = prompt.replace(pattern, (_match, name: string) => {
        const opts = wildcardCache.get(name) || [name];
        return opts.length ? opts[Math.floor(Math.random() * opts.length)] : name;
      });
      if (prompt === before) break;
    }
  }

  // Guarantee at least a couple of { | } groups for combinatorial power if missing
  if (!/\{[^}]+\|[^}]+\}/.test(prompt)) {
    const boost = isNsfw
      ? ` {nude|__clothing_state__} {detailed wet __pussy__|spread, aroused} `
      : ` {elegant attire|__clothing__} {soft smile|confident gaze} `;
    prompt = prompt.replace(/(__expression__|__pose__)/, `$1${boost}`);
  }

  return prompt;
}

// ── Convenience: quick random without options object (used by UI) ──────
export async function quickRandomCharacterPrompt(target: ModelTarget, isNsfw: boolean, cache?: Map<string, string[]>, customSubject?: string): Promise<string> {
  return generateAdvancedRandomCharacterPrompt({ target, isNsfw, resolveWildcards: !!cache, wildcardCache: cache, customSubject });
}

// Re-export count helper (dupe of view for sharing; keeps UI light)
export function countCombinations(prompt: string): number {
  let total = 1;
  const re = /\{([^{}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null) total *= m[1].split('|').length;
  return total;
}

// Small helper for UI labels
export function getModelLabel(t: ModelTarget): string {
  const map: Record<ModelTarget, string> = {
    ponyxl: 'PonyXL (score tags)',
    flux: 'Flux (natural prose)',
    sdxl: 'SDXL',
    sd15: 'SD 1.5 / Realistic',
    general: 'General / Any',
  };
  return map[t] || t;
}

// ── Advanced Customizable Prompt Builder ──────────────────────────────
// Supports choosing via dropdowns from wildcards: backgrounds, settings,
// photography styles, porn types/acts, lighting, clothing, multi-char with
// gender/age/ethnicity/body/clothing per character. Takes inspiration from
// many wildcards by allowing __token__ fallbacks and random inspire.

export type BuilderNumChars = 0 | 1 | 2 | 3;

export interface CharSpec {
  gender?: string;
  age?: string;
  ethnicity?: string;
  hair?: string;
  eyes?: string;
  body?: string;
  breasts?: string;
  clothing?: string;
  expression?: string;
}

export interface BuilderState {
  target: ModelTarget;
  nsfw: boolean;               // derived from nsfwLevel > 20 for model prefixes etc.
  nsfwLevel: number;           // 0 (SFW / artistic) — 100 (absolute degenerate, heavy fetish). Replaces binary NSFW choice for presets.
  numChars: BuilderNumChars;
  chars: CharSpec[];           // length == numChars
  // Global scene / porn / photo
  background?: string;
  setting?: string;
  action?: string;             // "type of porn" / sexual act
  pose?: string;
  photography?: string;        // type of photography / viewpoint / composition
  lighting?: string;
  style?: string;
  quality?: string;            // extra quality booster
  // If true, builder will insert extra random __wildcard__ for uncustomized aspects
  useWildcardInspiration: boolean;
}

export const DEFAULT_BUILDER: BuilderState = {
  target: 'ponyxl',
  nsfw: false,
  nsfwLevel: 0,   // default: start at pure SFW / none when modal opened (user slides up for heat)
  numChars: 0,
  chars: [],
  background: '',
  setting: '',
  action: '',
  pose: '',
  photography: '',
  lighting: '',
  style: '',
  quality: '',
  useWildcardInspiration: true,
};

// Logical categories -> candidate wildcard filenames (tried in order)
export const BUILDER_CATEGORY_WILDCARDS: Record<string, string[]> = {
  gender: ['Gender-All', 'Gender'],
  ethnicity: ['Nationality-Race', 'ethnicity'],
  body: ['body_type', 'Female-Hourglass', 'Male-Muscular'],
  breasts: ['breasts'],
  hair: ['haircolor', 'hair_lengths', 'hair_ornaments', 'hair', 'hairtexture'],
  eyes: ['Pupil-Color', 'eyes', 'Eye-Shape'],
  clothing: ['clothing_state', 'Outfits', 'full_outfits', 'Lingerie', 'Costumes', 'bikini_styles', 'dress_styles', 'underwear_styles', 'tshirt_styles', 'onepiece_styles', 'twopiece_styles', 'fashionable_styles', 'stewardess_outfit_styles', 'wedding_styles'],
  expression: ['expression', 'Misc-Emotions', 'Lust'],
  background: ['Background', 'background_generic', 'background_abstract_generic', 'background_elements_nature', 'background_nature', 'Environment', 'Buildings-and-Rooms', 'Country-City', 'Planets-and-Space', 'Fantasy-Landscape'],
  setting: ['setting'],
  action: ['sexual_act', 'Sex-Positions', 'action', 'Group-Sex', 'Penetration-and-Insertions', 'Cum-Play'],
  pose: ['pose', 'Bondage-Positions'],
  photography: ['Viewpoint', 'Composition', 'POV', 'Glamour-Shots', 'Boudoir'],
  lighting: ['lighting', 'Ambience', 'Hardlight', 'Weather'],
  style: ['style'],
  quality: ['Quality-Modifiers', 'quality'],
};

// Age presets (no good wildcard for numeric ages; combine with descriptors)
export const AGE_PRESETS = ['18', '19', '20', '21', '22', '23', '24', '25', '26', '28', '30', 'young adult', 'early 20s', 'mid 20s', 'late 20s', '30s', 'mature', 'milf', 'teen (18+)', 'college age'];

export function getNumSubjectsPhrase(n: BuilderNumChars, gender0?: string, gender1?: string): string {
  if (n === 0) {
    return 'scenery, landscape, environment, no people, empty scene, atmospheric background';
  }
  if (n === 1) {
    const g = (gender0 || 'girl').toLowerCase();
    if (g.includes('boy') || g.includes('male') || g === 'man') return '1boy, solo male';
    if (g.includes('girl') || g.includes('female') || g === 'woman') return '1girl, solo';
    return 'solo';
  }
  if (n === 2) {
    const g0 = (gender0 || 'girl').toLowerCase();
    const g1 = (gender1 || 'boy').toLowerCase();
    const isF0 = g0.includes('girl') || g0.includes('female') || g0.includes('woman');
    const isF1 = g1.includes('girl') || g1.includes('female') || g1.includes('woman');
    if (isF0 && isF1) return '2girls, yuri, couple';
    if (!isF0 && !isF1) return '2boys, yaoi, couple';
    return '1girl, 1boy, couple, hetero';
  }
  return `${n}people, group, orgy`;
}

function pickOrToken(val: string | undefined, tokenName: string, useInsp: boolean): string {
  if (val && val.trim()) return val.trim();
  if (useInsp) return `__${tokenName}__`;
  return '';
}

function joinParts(parts: (string | undefined | null)[]): string {
  return parts.filter(p => p && p.trim()).map(p => p!.trim()).join(', ');
}

// buildPromptFromBuilder uses SFW_THRESHOLD, isNsfwPhrase, sanitizeBuilderStateForLevel
// from nsfwCharacterPrompts.ts. This is a direct import (not circular) because
// nsfwCharacterPrompts imports types only from characterPrompts.
import { SFW_THRESHOLD, isNsfwPhrase, sanitizeBuilderStateForLevel } from './nsfwCharacterPrompts';

export function buildPromptFromBuilder(state: BuilderState, wildcardCache?: Map<string, string[]>): string {
  const { target, nsfw: oldNsfw = true, nsfwLevel = 0, numChars, chars, background, setting, action, pose, photography, lighting, style, quality, useWildcardInspiration: useInsp } = state;

  let numCharsSafe = (numChars ?? 0) as BuilderNumChars;
  if (numCharsSafe < 0) numCharsSafe = 0;
  if (numCharsSafe > 3) numCharsSafe = 3;

  // Slider (0-100) is the source of truth for "amount of NSFW". Derive binary for prefixes/suffixes.
  const level = Math.max(0, Math.min(100, Math.round(nsfwLevel)));
  const isNsfw = level > 20;
  const isSafe = level <= SFW_THRESHOLD;

  // When slider at "none"/SFW, sanitize any NSFW words that may be lingering in state (from prior preset/inspire at higher level)
  // so the generator *never* emits them in final prompt.
  const sanitizePatch = isSafe ? sanitizeBuilderStateForLevel(state, true) : {};
  const effChars = sanitizePatch.chars || chars;
  const effAction = (sanitizePatch as any).action !== undefined ? (sanitizePatch as any).action : action;
  const effPose = (sanitizePatch as any).pose !== undefined ? (sanitizePatch as any).pose : pose;

  const prefix = getModelPrefix(target, isNsfw);
  const suffix = getModelSuffix(target, isNsfw);

  const c0 = effChars[0] || {};
  const c1 = effChars[1] || {};

  // Subjects header (pony friendly counts)
  const subjHeader = getNumSubjectsPhrase(numCharsSafe, c0.gender, c1?.gender);

  // Per char descriptors (use chosen or __token__)
  const charDescs: string[] = [];
  const charKeys: (keyof CharSpec)[] = ['gender', 'age', 'ethnicity', 'hair', 'eyes', 'body', 'breasts', 'clothing', 'expression'];
  for (let i = 0; i < numCharsSafe; i++) {
    const c = effChars[i] || {};
    const bits: string[] = [];
    const isTok = (s?: string) => !!s && s.startsWith('__') && s.endsWith('__');
    if (c.age) {
      const a = c.age;
      bits.push(isTok(a) ? a : (/^\d/.test(a) ? `${a} year old` : a));
    }
    if (c.ethnicity) bits.push(c.ethnicity);
    if (c.gender) bits.push(c.gender);
    if (c.hair) bits.push(isTok(c.hair) ? c.hair : (c.hair.toLowerCase().includes('hair') ? c.hair : c.hair + ' hair'));
    if (c.eyes) bits.push(isTok(c.eyes) ? c.eyes : (c.eyes.toLowerCase().includes('eye') ? c.eyes : c.eyes + ' eyes'));
    if (c.body) bits.push(c.body);
    if (c.breasts) bits.push(isTok(c.breasts) ? c.breasts : (c.breasts.toLowerCase().includes('breast') ? c.breasts : c.breasts + ' breasts'));
    if (c.clothing) bits.push(isTok(c.clothing) ? c.clothing : ('wearing ' + c.clothing));
    if (c.expression) bits.push(c.expression);
    // Fill missing with tokens for inspiration (use safer token names when in SFW mode)
    if (useInsp) {
      if (!c.gender && i === 0) bits.push(pickOrToken('', 'gender', true));
      if (!c.body) bits.push(pickOrToken('', 'body_type', true));
      if (!c.clothing) {
        const clothTok = isSafe ? 'clothing' : 'clothing_state';
        bits.push('wearing ' + pickOrToken('', clothTok, true));
      }
      if (!c.expression) bits.push(pickOrToken('', 'expression', true));
    }
    const desc = bits.filter(Boolean).join(', ');
    charDescs.push(desc || (i === 0 ? pickOrToken('', 'subject', true) : ''));
  }

  // Scene
  const bg = pickOrToken(background, 'Background', useInsp);
  const setg = pickOrToken(setting, 'setting', useInsp);
  const scene = joinParts([bg, setg]);

  // Porn type / act -- never include sexual_act token or value when slider is SFW/none
  let act = '';
  const rawAct = effAction || '';
  if (!isSafe) {
    act = pickOrToken(rawAct, 'sexual_act', useInsp);
  } else if (rawAct && !rawAct.startsWith('__') && !isNsfwPhrase(rawAct)) {
    act = rawAct;
  }

  // Pose -- sanitize explicit, and avoid token insertion for safety when SFW
  let ps = pickOrToken(effPose, 'pose', useInsp && !isSafe);
  if (isSafe && ps && isNsfwPhrase(ps)) ps = '';

  if (numCharsSafe === 0) {
    act = '';
    ps = '';
  }

  // Photography / view / composition
  const photo = pickOrToken(photography, 'Viewpoint', useInsp);

  // Lighting
  const lit = pickOrToken(lighting, 'lighting', useInsp);

  // Style / art
  const sty = pickOrToken(style, 'style', useInsp);

  // Quality
  const qual = quality || (useInsp ? pickOrToken('', 'Quality-Modifiers', true) : '');

  // Assemble core subject line(s)
  const subjectsLine = charDescs.filter(Boolean).join(' and ');

  // Main body pieces (now graduated by slider instead of binary)
  const bodyPieces: string[] = [];
  if (level > 25 && numCharsSafe > 0) {
    if (numCharsSafe === 1) {
      bodyPieces.push(level > 65 ? '{nude|__clothing_state__|detailed anatomy, wet, aroused}' : '{revealing|sheer|artistic nude}');
    } else {
      bodyPieces.push(level > 65 ? '{interacting intimately|__sexual_act__}' : 'intimate / sensual interaction');
    }
  } else if (numCharsSafe === 0 && level > 15) {
    // for pure scenery at moderate+ levels, add atmospheric descriptors
    bodyPieces.push('atmospheric, detailed environment, immersive scenery');
  }

  const promptCore = joinParts([
    subjHeader,
    subjectsLine,
    scene ? (numCharsSafe > 0 ? `in ${scene}` : scene) : '',
    act,
    ps,
    photo,
    bodyPieces.join(', '),
    lit,
    sty,
    qual,
  ]);

  let full = `${prefix}${promptCore}${suffix}`.replace(/\s*,\s*,/g, ',').replace(/\s+/g, ' ').trim();

  // === KEY: graduated NSFW amount from the slider (the whole point of the rework) ===
  // This lets presets be "scene concepts" (vanilla solo, bondage pose, public daring, etc.)
  // while the slider dials from SFW artistic all the way to absolute degenerate heavy fetish.
  const intensity = getNsfwIntensity(level);
  if (intensity) {
    // insert before the model suffix so it participates in quality/style
    if (suffix && full.endsWith(suffix)) {
      full = full.slice(0, -suffix.length) + ', ' + intensity + suffix;
    } else {
      full += ', ' + intensity;
    }
  }

  // Extra inspiration wildcards for variety if flag set and room
  if (useInsp && !/(__|score_)/i.test(full)) {
    full += ', __lighting__, __style__';
  }

  // Target specific tweaks (use computed isNsfw)
  if (target === 'ponyxl' && isNsfw && !full.includes('score_')) {
    full = 'score_9, score_8_up, score_7_up, source_pony, ' + full;
  }

  // If cache provided, optionally lightly resolve some __ for preview (same as before)
  if (wildcardCache) {
    const pattern = /__([a-zA-Z0-9_\/\\-]+)__/g;
    // only resolve a few to keep some randomness server side
    let resolved = full;
    const needed = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(full)) !== null) needed.add(m[1]);
    // note: caller should have preloaded into cache
    for (const name of needed) {
      const opts = wildcardCache.get(name);
      if (opts && opts.length) {
        // replace only first occurrence to leave others as tokens? or all for preview
        resolved = resolved.replace(new RegExp(`__${name}__`, 'g'), () => opts[Math.floor(Math.random() * opts.length)]);
      }
    }
    full = resolved;
  }

  return full;
}