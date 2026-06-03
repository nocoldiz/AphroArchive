// public/src/characterPrompts.ts
// Centralized image/character prompt templates + advanced randomizer.
// Prompt generator (advanced mode dropdowns + Inspire) now uses HARDCODED_OPTIONS below.
// This means the generator UI no longer requires manually populating db/wildcards/ folder.
// (You can still put custom .txt there for __name__ resolution at runtime via imagegen.py,
// for the Static templates mode, or for manual insertion via the Wildcards panel.)
// The detailed combinatorial full-prompt templates have been removed from db/wildcards/.
// Builder uses the curated lists here + {combinatorial} where useful.
//
// Philosophy:
// - Compose using __wildcard__ tokens resolved at runtime (or preview) from db/wildcards/*.txt .
// - Model-specific prefix/suffix.
// - NSFW mode for explicit porn character prompts.
// - Combinatorial for many variants.
// - Static templates below also rely on the same wildcards.

// (types defined below; no import needed)

// ── Moved from ImageGenView (original static templates, kept for compatibility) ──
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
  // Optional cache (same shape as ImageGenView wildcardFullCache)
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

// ── Fragment pools (used to build prompts) ───
// These provide fallbacks + extra { | } choices. The main detail now comes from
// resolving the __wildcard__ tokens against the existing curated db/wildcards/*.txt
// (subject.txt, pose.txt, sexual_act.txt, clothing_state.txt, expression.txt, etc.).

const SFW_SUBJECT_POOL = [
  '__subject__',
  'beautiful {young woman|girl|model}, solo',
  '{stunning|attractive} {woman|person} with __hair__, __eyes__',
];

const NSFW_SUBJECT_POOL = [
  '__subject__',
  'gorgeous {nude|nearly nude} __subject__, {solo|1girl}',
  '{curvy|petite|voluptuous} __subject__ with __breasts__ and __ass__',
  'explicit {futanari|female} character, __subject__, erect __genitals__',
];

const SFW_BODY = [
  '__body_type__',
  'elegant figure, __hair__',
  'graceful pose, delicate features',
];

const NSFW_BODY = [
  '__body_type__, __breasts__, __ass__',
  'detailed anatomy, {shaved|trimmed} __genitals__',
  'oiled skin, {heavy|perky} __breasts__, wide hips',
  '__body_type__, {wet|dripping} __pussy__, {hard nipples|aroused}',
];

const COMMON_POSE = [
  '__pose__',
  '{standing|seated} contrapposto',
  'looking at viewer',
];

const NSFW_POSE = [
  '__pose__',
  '{on all fours, arching back|legs spread wide presenting|kneeling, hands behind back}',
  '{missionary with knees pulled up|doggy style, ass up|riding cowgirl, leaning forward|__pose__}',
  '__pose__ , ahegao body language, {trembling|orgasm} ',
];

const SFW_EXPR = ['__expression__', 'soft smile', 'confident gaze', 'playful wink'];
const NSFW_EXPR = ['__expression__', '__expression__ , ahegao', 'ecstatic orgasm face', 'seductive bite lip, bedroom eyes', 'desperate needy expression'];

const SFW_CLOTHING = ['__clothing__', 'elegant dress', 'casual outfit', 'lingerie'];
const NSFW_CLOTHING = ['__clothing_state__', 'completely nude', 'micro bikini', 'lingerie pulled aside, no panties', 'torn clothes, cum stains', 'schoolgirl uniform with skirt hiked'];

const SFW_ACT = ['posing', 'dancing', 'relaxing'];
const NSFW_ACT = [
  '__sexual_act__',
  '{fingering|spreading} __pussy__',
  '{deepthroat|titfuck|anal|creampie|breeding|__sexual_act__}',
  'multiple orgasms, {squirting|excessive fluids}',
  '{gangbang|threesome|double penetration|__action__}',
];

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
    base += `, {${pick(NSFW_BODY)} | ${pick(NSFW_ACT)}}`;
  }

  base = injectExtraCombinatorics(base, isNsfw);

  let prompt = `${prefix}${base}${suffix}`.replace(/\s+/g, ' ').trim();

  // Custom subject from Character Editor overrides __subject__ (fixed traits for the subject)
  if (customSubject) {
    prompt = prompt.replace(/__subject__/g, customSubject);
  }

  // Optional client-side __ resolve for nice preview (re-uses same logic pattern)
  if (resolveWildcards && wildcardCache) {
    // lightweight inline resolve (avoid circular; simple version of the one in ImageGenView)
    const pattern = /__([a-zA-Z0-9_\/\\-]+)__/g;
    const needed = new Set<string>();
    let m: RegExpExecArray | null;
    const tplForScan = prompt;
    while ((m = pattern.exec(tplForScan)) !== null) needed.add(m[1]);

    for (const name of needed) {
      if (!wildcardCache.has(name)) {
        try {
          const res = await fetch(`/api/imagegen/wildcards/${encodeURIComponent(name)}`);
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

export type BuilderNumChars = 1 | 2 | 3;

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
  nsfw: boolean;
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
  nsfw: true,
  numChars: 1,
  chars: [{ gender: 'girl', age: '20', ethnicity: '', body: '', breasts: '', clothing: '' }],
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

// Hardcoded options for the prompt generator (advanced builder dropdowns).
// These provide the choices for gender, hair, body, clothing, backgrounds, poses, etc.
// without requiring the db/wildcards/ folder or server fetches for the generator UI.
// (Runtime __wildcard__ resolution in prompts can still use the folder if present.)
// Folder is now optional for the "Prompt Generator" (advanced/static modes use these or templates).
export const HARDCODED_OPTIONS: Record<string, string[]> = {
  // Ported/enhanced from most useful cleaned wildcards in db/wildcards/ (Gender-All, ethnicity, body_type, breasts, clothing_*, expression, lighting, style, sexual_act, hair_*, Pupil-Color, background_*, setting, pose, Viewpoint, Quality-Modifiers, etc.)
  // These make the prompt generator self-contained. Folder still optional for runtime __name__ or custom augmentation.
  gender: ['girl', 'boy', 'female', 'male', 'agender', 'androgyne', 'androgynous', 'bigender', 'cis', 'cisgender', 'cis female', 'cis male', 'cis man', 'cis woman', 'cisgender female', 'cisgender male', 'cisgender man', 'cisgender woman', 'female to male', 'ftm', 'gender fluid', 'gender nonconforming', 'gender questioning', 'gender variant', 'genderqueer', 'intersex', 'male to female', 'mtf', 'neither', 'neutrois', 'non-binary', 'other', 'pangender', 'trans', 'trans female', 'trans male', 'trans man', 'trans person', 'trans woman', 'transfeminine', 'transgender', 'transgender female', 'transgender male', 'transgender man', 'transgender person', 'transgender woman', 'transmasculine', 'transsexual', 'transsexual female', 'transsexual male', 'transsexual man', 'transsexual person', 'transsexual woman', 'two-spirit'],
  ethnicity: ['asian beauty, smooth pale skin, dark hair', 'ebony goddess, rich dark skin, full lips', 'latina fire, caramel skin, thick curves', 'pale nordic, porcelain skin, light eyes', 'exotic middle eastern, olive skin, dark features', 'indian beauty, warm brown, expressive eyes', 'russian model, sharp features, platinum', 'japanese idol, flawless, cute yet lewd', 'mixed race, unique golden tone', 'tanned california surfer', 'ebony', 'asian', 'latina', 'caucasian', 'middle eastern', 'indian', 'nordic', 'african', 'european', 'hispanic'],
  eyeColor: ['amber eyes', 'amber-green eyes', 'black eyes', 'blue eyes', 'blue-green eyes', 'brown eyes', 'brown-grey eyes', 'gray eyes', 'gray-blue eyes', 'green eyes', 'green-brown eyes', 'grey-green eyes', 'hazel eyes', 'hazel-blue eyes', 'red eyes', 'violet eyes', 'violet-blue eyes'],
  hairColor: ['black', 'white', 'pale pink', 'light blue', 'light green', 'light cyan', 'light purple', 'pale golden', 'light blonde', 'brown', 'light aqua', 'pale magenta', 'pale violet', 'light pink', 'blonde', 'red', 'brunette', 'silver', 'platinum', 'raven'],
  hair: ['very short hair', 'short hair', 'medium hair', 'long hair', 'very long hair', 'curly hair', 'messy hair', 'straight hair', 'wavy hair', 'hair ornament', 'hairclip', 'hairband', 'hair ornament, hair flower', 'hair ornament, x hair ornament', 'hair ornament, star hair ornament', 'hair ornament, hair bell', 'hair ornament, frog hair ornament', 'hair ornament, heart hair ornament', 'hair ornament, butterfly hair ornament', 'hair ornament, crescent hair ornament', 'hair ornament, feather hair ornament', 'hair ornament, leaf hair ornament', 'hair ornament, skull hair ornament', 'hair ornament, cat hair ornament'],
  eyes: ['amber eyes', 'amber-green eyes', 'black eyes', 'blue eyes', 'blue-green eyes', 'brown eyes', 'brown-grey eyes', 'gray eyes', 'gray-blue eyes', 'green eyes', 'green-brown eyes', 'grey-green eyes', 'hazel eyes', 'hazel-blue eyes', 'red eyes', 'violet eyes', 'violet-blue eyes', 'almond eyes', 'round eyes', 'monolid eyes'],
  body: ['athletic toned, visible abs, strong legs', 'BBW, heavy and jiggly all over', 'body built for breeding, fertile hips, soft belly', 'chubby soft body, love handles, huge ass', 'curvy', 'fat', 'futanari build, feminine curves + package', 'giant', 'giantess', 'lewd exaggerated proportions, tiny waist huge tits and ass', 'miniboy', 'minigirl', 'muscular', 'muscular female', 'muscular yet feminine, defined arms', 'oiled shiny skin over thick curves', 'perfect pornstar body, enhanced curves', 'petite and delicate, 5\'1, small frame', 'plump', 'skinny', 'skinny with massive fake tits, disproportionate', 'slim and willowy, elegant proportions', 'slim thick hourglass figure, tiny waist', 'tall amazonian, long legs, powerful', 'thick and soft, wide hips, plush thighs', 'voluptuous and curvy, massive assets'],
  breasts: ['(flat chest)', '(medium breasts)', '(small breasts)', 'arm under', 'arms crossed under', 'asymmetrical breasts', 'average', 'bare', 'barely visible', 'beverage between', 'big', 'bouncing', 'bouncing breasts', 'breast expansion', 'breast smother', 'breastfeeding', 'breasts', 'breasts apart', 'breasts, (gigantic breasts)', 'breasts, (huge breasts)', 'breasts, (large breasts)', 'bulging', 'comparing', 'convex', 'countershade', 'covered', 'covering', 'cum between', 'cum on', 'cum on own', 'droopy breasts', 'exposed', 'featureless', 'firm breasts', 'flashing', 'flat chest', 'floating breasts', 'fluffy', 'freckles on', 'full', 'gigantic', 'gigantic breasts', 'glistening', 'groping', 'hands on own', 'hanging', 'hanging breasts', 'huge', 'hyper', 'lactating breasts', 'lactation', 'lactation through clothes', 'large', 'light', 'looking at', 'looking at own', 'lying on', 'medium', 'multiple breast smother', 'natural', 'object between', 'painted', 'penile', 'penis between', 'perky breasts', 'petite', 'pointy', 'pointy breasts', 'presenting', 'round', 'round breasts', 'sagging', 'sagging breasts', 'saliva on', 'shaking', 'sloshing', 'small', 'supernumerary', 'sweaty', 'swollen', 'tiny', 'unaligned breasts', 'veiny', 'veiny breasts', 'writing on'],
  clothing: ['completely nude, bare skin', 'lingerie pulled to the side', 'micro skirt hiked up, no panties', 'shirt ripped open, tits out', 'panties around one ankle', 'cum soaked and clinging', 'half off shoulder, disheveled', 'dress bunched at waist', 'stockings torn, runs', 'collar still on, everything else gone', 'bra pulled down under breasts', 'pants around knees, ass exposed', 'nude and covered in drying cum', 'clothes discarded on floor', 'still wearing heels only', 'blindfold and gag, rest naked', 'Bandeau bikini with a twisted front and a solid color', 'Bandeau bikini with a twist-front detail and a playful stripe pattern', 'Bandeau bikini with a twist-front detail and a tropical floral print', 'Bandeau bikini with a twist-front detail and a tropical palm leaf print', 'Crochet bikini with a halter-neck top and a geometric motif', 'Crochet bikini with a halter-neck top and a geometric pattern', 'Crochet bikini with a halter-neck top and matching bottoms', 'Crochet bikini with a high-neck top and matching bottoms', 'Crochet bikini with a scalloped edge and a bohemian-inspired print', 'Cut-out bandeau bikini with a front knot detail and a metallic finish', 'Cut-out bandeau bikini with a front knot detail and a tropical palm print', 'Cut-out bandeau bikini with a front tie detail and a geometric print', 'Cut-out bikini with a strappy back and a metallic sheen', 'Cut-out bikini with a strappy back and a metallic shimmer', 'Cut-out bikini with strappy details and a tropical fruit print', 'Cut-out bikini with strappy details and a tropical palm leaf print', 'Cut-out one-piece bikini with a lace-up back and a vibrant print', 'Cut-out one-piece bikini with a plunging neckline and a strappy back', 'Cut-out one-piece bikini with a plunging neckline and a strappy detail', 'Fringed bikini with a bandeau top and a bohemian-inspired print', 'Fringed bikini with a bandeau top and a playful print', 'Fringed bikini with a bandeau top and a playful tropical print', 'Fringed bikini with tassel accents and a bohemian print', 'Fringed bikini with tassel accents and a bohemian-inspired print', 'Fringed bikini with tassel accents and a boho-inspired print', 'Halter-neck bikini with a crochet overlay and boho-chic fringe trim', 'High-cut bikini with a Brazilian bottom and a tie-front top', 'High-cut bikini with cheeky bottoms and a tie-front detail', 'High-cut bikini with cheeky bottoms and a tie-front top', 'High-neck bikini with a crochet overlay and a boho-inspired print', 'High-neck bikini with a mesh panel and a tropical leaf print', 'High-neck bikini with a ribbed texture and a bold solid color', 'High-neck bikini with a ribbed texture and a solid color', 'High-neck bikini with mesh insets and a sleek black color', 'High-waisted bikini with a bandeau top and retro-inspired polka dot pattern', 'High-waisted bikini with a ruffled waistband and a solid pastel color', 'High-waisted bikini with a twisted bandeau top and a solid pastel color', 'Lace-up bikini with a crisscross front and a playful stripe pattern', 'Lace-up bikini with a crisscross front and a tropical leaf print', 'Lace-up bikini with a front knot detail and a vibrant geometric print', 'Mesh-insert bikini with a strappy back and a solid color', 'Mesh-panel bikini with a crisscross back and a solid color', 'Off-the-shoulder bikini with a flounce overlay and a feminine floral print', 'Off-the-shoulder bikini with a ruffled overlay and a floral print', 'Off-the-shoulder bikini with ruffled sleeves and a boho print', 'Off-the-shoulder bikini with ruffled sleeves and a boho-inspired print', 'Off-the-shoulder bikini with ruffled sleeves and a solid color design', 'Off-the-shoulder bikini with ruffled sleeves and a tropical print', 'Off-the-shoulder ruffled bikini with a feminine floral print', 'Off-the-shoulder ruffled bikini with a striped pattern', 'Off-the-shoulder ruffled bikini with a tropical palm print', 'One-shoulder bikini with a scalloped edge and a bold geometric pattern', 'One-shoulder bikini with a scalloped edge and a playful polka dot pattern', 'Plunge-neck bikini with a mesh insert and a vibrant abstract print', 'Plunge-neck bikini with a mesh panel and a tropical palm print', 'Plunge-neck bikini with a mesh panel and a vibrant abstract print', 'Plunge-neck bikini with mesh paneling and a palm leaf print', 'Plunge-neck bikini with mesh paneling and a tropical leaf print', 'Plunge-neck bikini with mesh paneling and a tropical palm print', 'Plunge-neck bikini with mesh paneling and an abstract print', 'Retro-inspired high-waisted bikini with a sweetheart neckline and polka dot print', 'Ruffled bikini with off-the-shoulder sleeves and a gingham check print', 'Scoop-neck bikini with a ribbed texture and a neon solid color', 'Scoop-neck bikini with a ribbed texture and a solid neon color', 'body suit', 'plug suit', 'flight suit', 'evening gown', 'dress', 'school uniform, skirt', 'nurses uniform, skirt', 'leather jacket, fishnets', 'pirate clothes', 'track and field clothes', 'bra and panties, lace', 'sarashi', 'delinquent clothes', 'police uniform', 'medieval peasant clothes', 'queen clothes, red cape', 'oversized shirt, no pants', 'pajamas', 'night shirt, no pants', 'cowboy clothes', 'victorian clothes', 'denim jacket, jeans', 't-shirt, jeans', 'crop top, yoga pants', 'bikini', 'one-piece swimsuit', 'micro-bikini', 'towel covering breasts and pussy', 'censoring goo', 'knight\'s armor', 'magician clothes', 'denim shorts, bikini top', 'bandaged chest', 'cowboy outfit', 'thighhighs, gloves, collar', 'hockey uniform', 'maid uniform', 'duster jacket', 'vampire costume', 'mummy costume', 'bondage gear', 'ribbons, gift wrapped'],
  expression: ['serious', 'determined', 'smirk', 'smile', 'light_smile', 'angry', 'grin', 'frown', 'evil_smile', 'confident', 'smug', 'happy', 'sad', 'worried', 'shouting', 'laughing', 'crying', 'scared', 'surprised', 'annoyed', 'crazy_smile', 'grimace', 'bored', 'tired', 'embarrassed', 'nervous', 'expressionless', 'deadpan', 'crazy_eyes', 'arrogant smirk, looking down', 'blushing shy, biting lower lip', 'bored / unimpressed (brat)', 'confident dominant stare', 'crying from pleasure, mascara run', 'desperate needy, pleading eyes', 'ecstatic orgasm, mouth open screaming', 'exhausted, eyes half closed', 'hungry for more, licking lips', 'playful wink and tongue tip', 'proud of the mess on her face', 'satisfied afterglow, lazy smile', 'seductive half lidded eyes, slight smile', 'shocked ahegao, eyes crossed', 'soft gentle smile, innocent', 'tongue hanging out, drooling'],
  background: ['grass', 'outdoors', 'rock', 'flower', 'bush', 'stone', 'leaves', 'roots', 'vines', 'moss', 'branch', 'pine_tree', 'ivy', 'fern', 'mushroom', 'fallen_leaves', 'water', 'reeds', 'log', 'boulder', 'overgrown', 'wildflowers', 'dead_tree', 'stump', 'pond', 'thorns', 'lily_pad', 'crystal', 'bioluminescent', 'giant_mushroom', 'forest', 'ruins', 'outdoors', 'mountain', 'castle', 'sky', 'desert', 'cave', 'temple', 'field', 'ocean', 'dungeon', 'tower', 'cliff', 'storm', 'canyon', 'bridge', 'lake', 'battlefield', 'graveyard', 'volcano', 'wetland', 'aurora', 'palace', 'village', 'floating_island', 'underground', 'shrine', 'wasteland', 'library', 'portal_(object', 'underwater'],
  setting: ['luxury modern bedroom, silk sheets', 'steamy shower, water running down body', 'dark dungeon, chains, dim torch light', 'public park at night, risky', 'classroom desk after hours', 'penthouse balcony overlooking city', 'cheap motel, neon sign glow', 'beach at sunset, sand on skin', 'a beach with palm trees', 'a castle on a hill', 'a desert landscape with sand dunes', 'a flower garden in full bloom', 'a forest with a winding river', 'a fountain in a city square', 'a lighthouse on a cliff by the sea', 'a mountainous location full of icy boulders and snow', 'a national park with wildlife', 'a place full of gardens suspended by ropes and chains', 'a place taken by nature full of mosses and vegetation', 'a place with lots of leaves on the ground and autumn colors', 'a place with a very vast nature with big trees and lots of vegetation', 'cyberpunk alley', 'ancient temple ruins', 'snowy mountain cabin', 'luxury yacht deck at night', 'abandoned industrial warehouse', 'rooftop garden overlooking city', 'steamy onsen hot spring', 'crystal cave with bioluminescence', 'overgrown jungle ruins'],
  action: ['fingering her dripping pussy', 'deepthroat blowjob, throat bulge', 'vaginal creampie, cum overflowing', 'hard anal pounding, gaped', 'double penetration, two cocks', 'facesitting, smothering', 'titfuck with massive cleavage', 'breeding press, legs pinned back', 'gangbang, covered in cum', 'rimming, tongue deep', 'scissoring, wet pussies grinding', 'handjob + cum on her face', 'futa on female, massive insertion', 'masturbating with huge dildo', 'squirting orgasm mid fuck', 'spanked red ass while fucked', 'choked lightly, eyes watering', 'tied in shibari, helpless', 'public use, strangers watching', 'pushing out creampie, pushing cum out', 'ahegao mid orgasm, body shaking', 'multiple loads, bukkake', 'internal creampie, belly slightly distended', 'lesbian 69', 'threesome', 'orgy', 'doggy style creampie', 'exhibitionism in public', 'bondage and discipline', 'cum play', 'penetration and insertions', 'stimulation with toys'],
  pose: ['contrapposto', 'standing', 'leaning_forward', 'leaning_back', 'arched_back', 'twisted_torso', 'leaning_to_the_side', 'sway_back', 'ahegao while in mating press', 'airplane arms', 'airplane_arms', 'akanbe', 'all fours', 'all_fours', 'animal pose', 'animal_pose', 'a-pose', 'arched back', 'archer pose', 'archer_pose', 'arm at side', 'arm behind back', 'arm behind head', 'arm up', 'arm_at_side', 'arm_behind_back', 'arm_behind_head', 'arm_hug', 'arm_support', 'arm_up', 'arms at side', 'arms behind back', 'arms behind head', 'arms up', 'arms_at_side', 'arms_behind_back', 'arms_up', 'baby carry', 'baby_carry', 'back-to-back', 'balancing', 'battoujutsu stance', 'battoujutsu_stance', 'bending over', 'bent over', 'bent over table or desk', 'bent_over', 'body bridge', 'body_bridge', 'bras d\'honneur', 'bras_d\'honneur', 'bunny pose', 'bunny_pose', 'butterfly sitting', 'butterfly_sitting', 'carried breast rest', 'carried_breast_rest', 'carrying', 'carrying over shoulder', 'carrying under arm', 'carrying_over_shoulder', 'carrying_under_arm', 'cheek-to-cheek', 'chest stand', 'chest_stand', 'child carry', 'child_carry', 'claw pose', 'claw_pose', 'cowering', 'cowgirl, leaning forward, tits hanging', 'crawling', 'crossed ankles', 'crossed arms', 'crossed legs', 'crossed_ankles', 'crossed_arms', 'crossed_legs', 'crouching', 'crucifixion', 'doggy style, looking back over shoulder', 'dojikko pose', 'dojikko_pose', 'dorsiflexion', 'dynamic_pose', 'eye contact', 'eye_contact', 'face down ass up, cheeks spread', 'faceplant', 'fetal position', 'fetal_position', 'fighting stance', 'fighting_stance', 'figure four sitting', 'figure_four_sitting', 'fireman\'s carry', 'fireman\'s_carry', 'flexing', 'folded', 'forehead-to-forehead', 'full scorpion', 'full_scorpion', 'gendou pose', 'gendou_pose', 'hands tied above head, stretched', 'handstand', 'head_down', 'head_rest', 'head_tilt', 'heads together', 'heads_together', 'headstand', 'heroic pose', 'holding hands', 'holding pussy open with both hands', 'holding_hands', 'horns pose', 'horns_pose', 'hug', 'hug_from_behind', 'hugging own legs', 'hugging_own_legs', 'indian style', 'indian_style', 'interlocked fingers', 'interlocked_fingers', 'inugami-ke no ichizoku pose', 'inugami-ke_no_ichizoku_pose', 'jojo pose', 'jojo_pose', 'jumping', 'kneeling', 'kneeling, back straight, hands on thighs', 'knees apart feet together', 'knees to chest', 'knees together feet apart', 'knees_apart_feet_together', 'knees_to_chest', 'knees_together_feet_apart', 'leaning back', 'leaning forward', 'leaning_back', 'leaning_forward', 'leg lift', 'leg lock', 'leg up', 'leg_lift', 'leg_lock', 'leg_up', 'legs apart', 'legs over head', 'legs spread wide, knees up, presenting', 'legs up', 'legs_apart', 'legs_over_head', 'legs_up', 'letter pose', 'letter_pose', 'looking_afar', 'looking_at_viewer', 'looking_to_the_side', 'lotus position', 'lotus_position', 'lying', 'lying down', 'missionary, legs folded to chest', 'object hug', 'object_hug', 'ojou-sama pose', 'ojou-sama_pose', 'on all fours, deep arch, ass up', 'on back', 'on knees with tongue out', 'on side', 'on stomach', 'on_back', 'on_side', 'on_stomach', 'one knee', 'one_knee', 'onna zuwari', 'outstretched arm', 'outstretched arms', 'outstretched leg', 'outstretched_arm', 'outstretched_arms', 'outstretched_hand', 'outstretched_leg', 'own hands clasped', 'own hands together', 'own_hands_clasped', 'own_hands_together', 'paw pose', 'paw_pose', 'pigeon pose', 'pigeon_pose', 'pigeon-toed', 'piggyback', 'plantar flexion', 'plantar_flexion', 'praise the sun', 'praise_the_sun', 'princess carry', 'princess_carry', 'prostration', 'proud pose', 'reaching', 'reclining', 'riding reverse, ass focus', 'running', 'saboten pose', 'saboten_pose', 'salute', 'scorpion pose', 'scorpion_pose', 'seiza', 'selfie angle, phone in hand, lewd pose', 'shoulder carry', 'shoulder_carry', 'shrugging', 'shushing', 'side view, one leg raised high', 'sitting', 'sitting on lap', 'sitting on person', 'sitting on shoulder', 'sitting_on_lap', 'sitting_on_person', 'sitting_on_shoulder', 'slouching', 'split', 'spread arms', 'spread eagle on bed', 'spread legs', 'spread_arms', 'spread_legs', 'squatting', 'squatting, knees out, pussy exposed', 'standing', 'standing contrapposto, hand on hip', 'standing on one leg', 'standing on shoulder', 'standing split', 'standing_on_one_leg', 'standing_on_shoulder', 'standing_split', 'star hands', 'star_hands', 'straddling', 'stretching', 'stroking_own_chin', 'superhero landing', 'superhero_landing', 'symmetrical hand pose', 'symmetrical_hand_pose', 'tail hug', 'tail_hug', 'thigh straddling', 'thigh_straddling', 'tiptoe kiss', 'tiptoe_kiss', 'tiptoes', 'top-down bottom-up', 'top-down_bottom-up', 't-pose', 'twisted torso', 'twisted_torso', 'upright straddle', 'upright_straddle', 'upside-down', 'v arms', 'v_arms', 'v_over_eye', 'victory pose', 'victory_pose', 'villain pose', 'villain_pose', 'w arms', 'w_arms', 'waist_hug', 'walking', 'wallwalking', 'wariza', 'wariza sitting on knees', 'watson cross', 'watson_cross_', 'waving', 'wing hug', 'wing_hug', 'yoga', 'yokozuwari', 'zombie pose', 'zombie_pose'],
  photography: ['aerial view', 'aiming at viewer', 'atmospheric perspective', 'bird\'s eye view', 'bird\'s-eye view', 'bird�?Ts-eye view', 'boom shot', 'camera view', 'close up', 'close-up', 'cowboy shot', 'crane shot', 'crotch shot', 'dolly shot', 'dolly zoom', 'downblouse', 'downpants', 'dutch angle', 'establishing shot', 'extreme close-up', 'extreme long shot', 'extreme perspective', 'eye level', 'eyewear view', 'facing viewer', 'first person view', 'fish-eye lens', 'fisheye', 'fisheye lens', 'fisheye-shot', 'afterimage', 'asymmetry', 'balance', 'bokeh', 'border', 'bust chart', 'character chart', 'chart', 'collage', 'column lineup', 'converging lines', 'cropped', 'depth of field', 'diagonal lines', 'diagram'],
  lighting: ['alpenglow', 'ambient lighting', 'ambient occlusion', 'artificial lighting', 'back light', 'back lighting', 'backlight', 'beautifully lit', 'belt of venus', 'bioluminiscent', 'bright light', 'bright rays', 'brilliant rays', 'candle light', 'celestial rays', 'chiaroscuro', 'cinematic lighting', 'crepuscular rays', 'dense light rays', 'diffuse lighting', 'dim light', 'directional lighting', 'dramatically lit', 'dynamic lighting', 'effulgent rays', 'fill light', 'flat light', 'flickering light', 'global illumination', 'glorious rays', 'glow in the dark', 'glow rays', 'glowwave', 'god rays', 'golden hour', 'hard light', 'hard lighting', 'high light', 'holographic', 'holography', 'iridescence', 'key light', 'lens flare', 'lighting', 'low light', 'luminescent rays', 'luminous rays', 'moody lighting', 'natural lighting', 'neon', 'neon pastel', 'polarized light', 'radiant', 'radiant beams', 'radiant light', 'radiant rays', 'rays of light', 'rays of sun', 'reflected lighting', 'refraction', 'rim light', 'shimmering rays', 'shining rays', 'side light', 'soft light', 'soft shaded', 'specular lighting', 'sun rays', 'sunbeams', 'sunrays shine upon it', 'sunshine rays', 'tenebrism', 'three point lighting', 'top light', 'volumetric lighting'],
  style: ['photorealistic, raw photo', 'oil painting, classical', 'watercolor, soft', 'digital art, sharp', 'anime style, cel shaded', 'pencil sketch, detailed', 'cinematic, filmic color grade', 'impressionist, painterly', 'concept art, illustrative', 'hyper detailed, 8k', 'score_9, score_8_up aesthetic', 'source_pony, pony diffusion', 'realistic skin texture, pores', 'studio ghibli inspired (light)', 'hentai, glossy anime', '3d render, octane', 'vintage pinup, 1950s', 'glamour photography, vogue', 'erotic comic book style', 'dark fantasy, frank frazetta'],
  quality: ['128-bit style graphics', '12k resolution', '16-bit', '16-bit style graphics', '16k 3d', '16k resolution', '1ms shutter speed', '20 megapixels', '256-bit style graphics', '2d sprite', '2k resolution', '32-bit style graphics', '32k resolution', '3840x2160', '3d', '4k', '4k resolution', '64-bit style graphics', '8-bit style graphics', '8k', '8k 3d', '8k resolution', '8k resolution / 16k resolution', 'absurd res', 'acid colors', 'aerial photograph', 'aesthetic', 'airbrush', 'ambient lighting', 'ambient occlusion', 'amiga style graphics', 'anti-aliasing', 'artstation', 'atari 2600 style graphics', 'atari 7800 style graphics', 'atari jaguar style graphics', 'atmospheric', 'augmented reality', 'award-winning', 'back lighting', 'backlight', 'beautiful', 'beautifully lit', 'bioluminiscent', 'biomorphic', 'biophilic', 'bitmap', 'blocky', 'blu-ray', 'bokeh', 'bounding volume hierarchy (bvh)', 'bryce 3d', 'candle light', 'cel shading', 'chromatic abberation', 'chromatic aberration', 'cinema 4d', 'cinematic light', 'cinematic lighting', 'commodore 64 style graphics', 'contest winner', 'crisp', 'cryengine', 'crystallized', 'cubic', 'dark', 'de-pixelated', 'dehazed', 'depth of field', 'desaturated', 'detailed', 'digital painting', 'direct lighting', 'dof', 'double exposure', 'dramatically lit', 'dreamcast style graphics', 'dynamic composition', 'dynamic lighting', 'dystopian', 'eldritch', 'elegant', 'eye strain', 'f 2.8 lens', 'faceted', 'feline', 'flat shading', 'fluo colors', 'foreboding', 'furry', 'fxaa', 'gamecube style graphics', 'geometric', 'glass', 'global illumination', 'golden hour', 'gpu (graphics processing unit)', 'hallucinogenic', 'hardware acceleration', 'hd', 'hd-dvd', 'hdr', 'hdr rendering', 'hi res', 'high chroma', 'high contrast', 'high definition', 'high resolution', 'high-res', 'highly detailed', 'hq', 'hyper detailed', 'hyper realistic', 'hypermaximalist', 'hypomorphic', 'indirect illumination', 'infectious', 'insanely detailed and intricate', 'intricate', 'intricate artwork', 'iridescence', 'isometric', 'kaleidoscopic', 'light propagation volumes (lpvs)', 'lighting', 'lomo effect', 'long exposure', 'low contrast', 'low-poly', 'low-res', 'lumen global illumination', 'macabre', 'manhattan distance', 'marbling', 'masterpiece', 'matte', 'maya', 'messy', 'metallic', 'microdisplacement', 'microscopic', 'monochromatic', 'moody lighting', 'motion capture', 'multiracial', 'nanite geometry', 'nebulous', 'nes style graphics', 'nintendo 64 (n64) style graphics', 'nvidia rtx', 'octane', 'octane render', 'oily', 'ornate', 'overgrown', 'path traced', 'path tracing', 'pbr material', 'phong shading', 'photon mapping', 'photorealistic', 'physically based rendering (pbr)', 'pixelated', 'pixellated', 'polarized light', 'polygonal', 'post processed', 'powerful', 'primary colors', 'prismatic', 'procedural', 'procedural generation', 'procedural texture', 'professional photoshoot', 'ps1 style graphics', 'ps2 style graphics', 'ps3 style graphics', 'ps4 style graphics', 'ps5 style graphics', 'radiant', 'raster graphics', 'rasterization', 'rasterized', 'ray traced', 'ray tracing', 'reflection', 'refraction', 'rendered with blender', 'retina display', 'rtx', 'rtx (real-time ray tracing)', 'screen space ambient occlusion', 'sega genesis style graphics', 'sepia', 'sfumato', 'shaded', 'shader', 'shadows', 'sharp focus', 'shot on nikon d750', 'simplified', 'skeletal animation', 'sketchfab', 'sketchup', 'skybox', 'smooth', 'smooth gradients', 'snes style graphics', 'soft shaded', 'sony playstation vita style graphics', 'sony psp style graphics', 'splash art', 'studio quality', 'stunning', 'stylized', 'super detailed', 'super sharp', 'super wide angle', 'superabsurd res', 'switch style graphics', 'terrain rendering', 'tesselation', 'textured', 'tilt-shift', 'ultra hd', 'ultrafine detail', 'unimaginable beauty', 'unreal engine', 'v-ray', 'vector graphics', 'vibrant color scheme', 'virtual reality', 'volumetric lighting', 'voronoi manhattan', 'voronoi minkowski', 'voxel', 'voxel engine', 'voxel geometry', 'voxel-based', 'voxelated', 'vray tracing', 'wii style graphics', 'wii u style graphics', 'wireframe model', 'wireframe rendering', 'xbox 360 style graphics', 'xbox one style graphics', 'xbox series s style graphics', 'xbox series x style graphics', 'xbox style graphics'],
};

// Optional aliases for legacy UI keys (map to above)
export const HARDCODED_OPTION_ALIASES: Record<string, string> = {
  nationality: 'ethnicity',
  eyeColor: 'eyeColor',
  hairColor: 'hairColor',
  bodyType: 'body',
  breastSize: 'breasts',
  clothes: 'clothing',
};

export function getNumSubjectsPhrase(n: BuilderNumChars, gender0?: string, gender1?: string): string {
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

export function buildPromptFromBuilder(state: BuilderState, wildcardCache?: Map<string, string[]>): string {
  const { target, nsfw, numChars, chars, background, setting, action, pose, photography, lighting, style, quality, useWildcardInspiration: useInsp } = state;

  const prefix = getModelPrefix(target, nsfw);
  const suffix = getModelSuffix(target, nsfw);

  const c0 = chars[0] || {};
  const c1 = chars[1] || {};
  const c2 = chars[2] || {};

  // Subjects header (pony friendly counts)
  const subjHeader = getNumSubjectsPhrase(numChars, c0.gender, c1?.gender);

  // Per char descriptors (use chosen or __token__)
  const charDescs: string[] = [];
  const charKeys: (keyof CharSpec)[] = ['gender', 'age', 'ethnicity', 'hair', 'eyes', 'body', 'breasts', 'clothing', 'expression'];
  for (let i = 0; i < numChars; i++) {
    const c = chars[i] || {};
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
    // Fill missing with tokens for inspiration
    if (useInsp) {
      if (!c.gender && i === 0) bits.push(pickOrToken('', 'gender', true));
      if (!c.body) bits.push(pickOrToken('', 'body_type', true));
      if (!c.clothing) bits.push('wearing ' + pickOrToken('', 'clothing_state', true));
      if (!c.expression) bits.push(pickOrToken('', 'expression', true));
    }
    const desc = bits.filter(Boolean).join(', ');
    charDescs.push(desc || (i === 0 ? pickOrToken('', 'subject', true) : ''));
  }

  // Scene
  const bg = pickOrToken(background, 'Background', useInsp);
  const setg = pickOrToken(setting, 'setting', useInsp);
  const scene = joinParts([bg, setg]);

  // Porn type / act
  const act = pickOrToken(action, 'sexual_act', useInsp);

  // Pose
  const ps = pickOrToken(pose, 'pose', useInsp);

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

  // Main body pieces (nsfw aware)
  const bodyPieces: string[] = [];
  if (nsfw) {
    if (numChars === 1) bodyPieces.push('{nude|__clothing_state__|detailed anatomy}');
    else bodyPieces.push('{interacting intimately|__sexual_act__}');
  }

  const promptCore = joinParts([
    subjHeader,
    subjectsLine,
    scene ? `in ${scene}` : '',
    act,
    ps,
    photo,
    bodyPieces.join(', '),
    lit,
    sty,
    qual,
  ]);

  let full = `${prefix}${promptCore}${suffix}`.replace(/\s*,\s*,/g, ',').replace(/\s+/g, ' ').trim();

  // Extra inspiration wildcards for variety if flag set and room
  if (useInsp && !/(__|score_)/i.test(full)) {
    full += ', __lighting__, __style__';
  }

  // Target specific tweaks
  if (target === 'ponyxl' && nsfw && !full.includes('score_')) {
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

// Helper to get a random value for a category (used by "inspire" buttons)
// Prefers HARDCODED_OPTIONS so the prompt generator does not require the wildcards folder.
export function pickRandomForCategory(cat: string, cache?: Map<string, string[]>): string {
  // 1. Hardcoded (primary, makes folder optional for generator)
  const hard = HARDCODED_OPTIONS[cat];
  if (hard && hard.length > 0) {
    return hard[Math.floor(Math.random() * hard.length)];
  }
  // 2. Fallback to alias
  const aliasKey = HARDCODED_OPTION_ALIASES[cat];
  if (aliasKey) {
    const hardAlias = HARDCODED_OPTIONS[aliasKey];
    if (hardAlias && hardAlias.length > 0) {
      return hardAlias[Math.floor(Math.random() * hardAlias.length)];
    }
  }
  // 3. Legacy cache (from folder, optional now)
  if (cache) {
    const names = BUILDER_CATEGORY_WILDCARDS[cat] || [cat];
    for (const n of names) {
      const lines = cache.get(n);
      if (lines && lines.length) {
        const usable = lines.filter(l => l && !l.startsWith('#'));
        if (usable.length) return usable[Math.floor(Math.random() * usable.length)];
      }
    }
  }
  return '';
}

// Convenience: create a builder state pre-filled with random choices from cache
export function inspireRandomBuilder(base: Partial<BuilderState> = {}, cache?: Map<string, string[]>): BuilderState {
  const st: BuilderState = { ...DEFAULT_BUILDER, ...base, chars: [...(base.chars || DEFAULT_BUILDER.chars)] };
  const num = st.numChars;
  st.chars = Array.from({ length: num }, (_, i) => ({ ...(st.chars[i] || {}) }));

  // randomize per char fields
  const charCats: (keyof CharSpec)[] = ['gender', 'age', 'ethnicity', 'hair', 'eyes', 'body', 'breasts', 'clothing', 'expression'];
  for (let i = 0; i < num; i++) {
    for (const k of charCats) {
      if (k === 'age') {
        if (!st.chars[i].age && Math.random() > 0.3) st.chars[i].age = AGE_PRESETS[Math.floor(Math.random() * AGE_PRESETS.length)];
      } else {
        const picked = pickRandomForCategory(k as string, cache || new Map());
        if (picked) (st.chars[i] as any)[k] = picked;
      }
    }
  }

  // globals
  const globals: (keyof BuilderState)[] = ['background', 'setting', 'action', 'pose', 'photography', 'lighting', 'style'];
  for (const g of globals) {
    if (!(st as any)[g]) {
      const picked = pickRandomForCategory(g as string, cache || new Map());
      if (picked) (st as any)[g] = picked;
    }
  }
  return st;
}
