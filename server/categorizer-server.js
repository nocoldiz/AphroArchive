'use strict';
// ═══════════════════════════════════════════════════════════════════
//  categorizer-server.js — Filename → folder matching engine
//
//  Shared by the Categorizer view, the Settings categorize modal, the
//  page-load auto-sort and download / feed auto-filing, so every entry
//  point files a video the same way.
//
//  Signals, strongest first:
//   1. Folder name / alias / registered category tag found in the filename
//      (exact phrase, then stemmed, glued "JaneDoe"/"jane_doe", unordered
//      words, token prefix, then typo-tolerant fuzzy).
//   2. The same match against the video's metadata (title, channel, actors, tags).
//   3. Tokens learned from videos already filed: a word that almost only
//      appears in one folder's filenames points new files to that folder.
//  Deeper subfolders win over their parents when both match, a matching
//  parent confirms a subfolder, and near-ties between unrelated folders
//  lower the confidence instead of guessing silently.
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { VIDEOS_DIR, VAULT_DIR, IGNORED_DIR } = require('./config-server');
const { loadPrefs, loadFolderMappings, loadVideoMeta } = require('./db-server');

const MIN_SCORE  = 50;   // below this a folder is not proposed at all
const HIGH_SCORE = 85;   // safe to move without review
const MED_SCORE  = 65;

// Filename tokens that carry no meaning for filing.
const NOISE = new Set([
  '1080p', '720p', '480p', '360p', '2160p', '1080', '720', '480', '360', '2160', '4k', '8k', 'uhd', 'fhd', 'hd', 'sd', 'hq', 'lq',
  'x264', 'x265', 'h264', 'h265', 'hevc', 'avc', 'aac', 'ac3', 'dts', 'mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'm4v', 'flv',
  'web', 'webrip', 'webdl', 'dl', 'bluray', 'brrip', 'bdrip', 'hdrip', 'dvdrip', 'rip', 'remux', 'proper', 'repack', 'hdr', 'fps', 'kbps',
  'www', 'com', 'net', 'org', 'http', 'https', 'the', 'and', 'a', 'an', 'of', 'in', 'on', 'with', 'to', 'for', 'by', 'from', 'at', 'is',
  'new', 'full', 'video', 'videos', 'clip', 'clips', 'part', 'pt', 'scene', 'episode', 'ep', 'vol', 'volume', 'copy', 'final', 'edit',
]);

// Folder names too generic to be matched by name alone.
const GENERIC_FOLDERS = new Set([
  'misc', 'miscellaneous', 'other', 'others', 'new', 'video', 'videos', 'clip', 'clips', 'temp', 'tmp', 'download', 'downloads',
  'uncategorized', 'unsorted', 'various', 'random', 'stuff', 'all', 'old', 'hd', 'sd', 'part', 'best', 'favorites', 'favourites',
  'inbox', 'todo', 'to sort', 'sort', 'archive', 'backup', 'hidden', 'private', 'movies', 'films', 'media',
]);

// ── Text normalisation ────────────────────────────────────────────────

// Diacritics stripped, camelCase and letter/digit boundaries split, every
// non-alphanumeric run collapsed to a single space.
function normalize(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Cheap plural stripping so "Comedies" matches "comedy" and "Cats" matches "cat".
function stem(t) {
  if (t.length <= 3) return t;
  if (t.endsWith('ies') && t.length > 4) return t.slice(0, -3) + 'y';
  if (/(ches|shes|sses|xes|zes)$/.test(t)) return t.slice(0, -2);
  if (t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us') && !t.endsWith('is')) return t.slice(0, -1);
  return t;
}

function prepareText(raw) {
  const norm   = normalize(raw);
  const tokens = norm ? norm.split(' ') : [];
  const stems  = tokens.map(stem);
  // Character offset in `compact` where each token starts, so a glued match
  // ("janedoe") is only accepted when it begins on a word boundary.
  const starts = new Set();
  let off = 0;
  for (const t of tokens) { starts.add(off); off += t.length; }
  return {
    tokens, stems, starts,
    joined:     ' ' + tokens.join(' ') + ' ',
    stemJoined: ' ' + stems.join(' ') + ' ',
    compact:    tokens.join(''),
  };
}

function prepareTerm(raw) {
  const norm = normalize(raw);
  if (!norm) return null;
  const tokens = norm.split(' ');
  const compact = tokens.join('');
  if (compact.length < 2) return null;
  if (tokens.length === 1 && (GENERIC_FOLDERS.has(norm) || NOISE.has(norm))) return null;
  if (GENERIC_FOLDERS.has(norm)) return null;
  return {
    raw: String(raw), norm, tokens, compact,
    stems: tokens.map(stem),
    phrase: ' ' + norm + ' ',
    stemPhrase: ' ' + tokens.map(stem).join(' ') + ' ',
  };
}

// Optimal-string-alignment distance (Levenshtein + adjacent transposition),
// so "comdey" and "comedy" are one edit apart.
function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev2 = null, prev = new Array(n + 1), cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
    }
    [prev2, prev, cur] = [prev, cur, prev2 || new Array(n + 1)];
  }
  return prev[n];
}

function similarity(a, b) {
  const max = Math.max(a.length, b.length);
  return max ? 1 - editDistance(a, b) / max : 0;
}

// ── Term scoring ──────────────────────────────────────────────────────

// Score one folder term against a prepared text. 0 = no match.
function scoreTerm(text, term) {
  if (!text.tokens.length) return 0;
  const len = term.compact.length;
  // Very short terms ("VR", "3D") only count as a whole word.
  if (len <= 3) return text.joined.includes(term.phrase) ? 92 : 0;

  if (text.joined.includes(term.phrase)) return 100;
  if (text.stemJoined.includes(term.stemPhrase)) return 95;

  // Glued words: "JaneDoe", "jane_doe", "janedoe2021" — must start on a word boundary.
  if (term.tokens.length > 1 && len >= 5) {
    let idx = text.compact.indexOf(term.compact);
    while (idx !== -1) {
      if (text.starts.has(idx)) return 90;
      idx = text.compact.indexOf(term.compact, idx + 1);
    }
  }

  if (term.tokens.length > 1) {
    // Every word present, any order ("Doe Jane").
    const set = new Set(text.stems);
    if (term.stems.every(s => set.has(s))) return 80;
  } else {
    // Single-word term as the start of a longer token ("comedyclub").
    if (len >= 5 && text.tokens.some(t => t.length > len && t.startsWith(term.compact))) return 70;
  }

  // Typo-tolerant match on same-length token windows: 1 edit for short
  // terms, 2 for long ones (a swap of adjacent letters counts as one edit).
  if (len >= 5) {
    const n = term.tokens.length;
    const budget = len >= 9 ? 2 : 1;
    let best = Infinity;
    for (let i = 0; i + n <= text.tokens.length; i++) {
      const win = text.tokens.slice(i, i + n).join('');
      // Typos rarely hit the first letter; skipping those keeps big libraries fast.
      if (win[0] !== term.compact[0] || Math.abs(win.length - len) > budget) continue;
      const d = editDistance(win, term.compact);
      if (d < best) best = d;
    }
    if (best <= budget) return best === 1 ? 68 : 60;
  }
  return 0;
}

// Longer terms are more specific; a 4-letter match is trusted a bit less.
function lengthWeight(term) {
  return Math.min(1, 0.8 + term.compact.length * 0.04);
}

// ── Folder candidates ─────────────────────────────────────────────────

function isSkippedDir(full, name) {
  if (String(name).toLowerCase() === 'hidden' || name.startsWith('.')) return true;
  const r = path.resolve(full);
  return r === path.resolve(VAULT_DIR) || r === path.resolve(IGNORED_DIR);
}

function libraryRoots() {
  const prefs = loadPrefs();
  return [VIDEOS_DIR, ...(prefs.sourceFolders || []).filter(sf => { try { return fs.existsSync(sf); } catch { return false; } })];
}

// Every existing folder (any depth) across the given roots, deduped by relative path.
function listFolders(roots = libraryRoots()) {
  const seen = new Set();
  const out = [];
  const walk = (dir, rel) => {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      if (isSkippedDir(full, e.name)) continue;
      const relPath = rel ? rel + '/' + e.name : e.name;
      const key = relPath.toLowerCase();
      if (!seen.has(key)) { seen.add(key); out.push(relPath); }
      walk(full, relPath);
    }
  };
  for (const r of roots) walk(r, '');
  return out;
}

// Alternate spellings of a folder name: "01 - Comedy" → "Comedy",
// "Jane Doe (2019)" → "Jane Doe", "The Office" → "Office", "Doe, Jane" → "Jane Doe".
function folderAliases(leaf) {
  const out = new Set([leaf]);
  const noNum = leaf.replace(/^\s*\d+\s*[-._)\]]\s*/, '');
  out.add(noNum);
  const noParen = noNum.replace(/\s*[([{][^)\]}]*[)\]}]\s*/g, ' ').trim();
  out.add(noParen);
  if (/^the\s+/i.test(noParen)) out.add(noParen.replace(/^the\s+/i, ''));
  const comma = noParen.match(/^([^,]+),\s*([^,]+)$/);
  if (comma) out.add(`${comma[2]} ${comma[1]}`);
  for (const part of noParen.split(/\s+(?:&|and|\+|\/)\s+|\s*[|;]\s*/i)) if (part && part !== noParen) out.add(part);
  return [...out].filter(Boolean);
}

function buildCandidates(folderPaths) {
  // Category DB rows: name / display name → registered tags.
  const tagsByName = new Map();
  for (const c of loadFolderMappings()) {
    for (const k of [c.name, c.displayName]) if (k) {
      const key = String(k).toLowerCase();
      tagsByName.set(key, [...(tagsByName.get(key) || []), ...(c.terms || [])]);
    }
  }
  return folderPaths.map(relPath => {
    const parts = relPath.split('/');
    const leaf  = parts[parts.length - 1];
    const rawTerms = [
      ...folderAliases(leaf),
      ...(tagsByName.get(leaf.toLowerCase()) || []),
      ...(tagsByName.get(relPath.toLowerCase()) || []),
    ];
    const seen = new Set();
    const terms = [];
    for (const t of rawTerms) {
      const p = prepareTerm(t);
      if (p && !seen.has(p.norm)) { seen.add(p.norm); terms.push(p); }
    }
    const ancestors = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
    return { relPath, leaf, depth: parts.length - 1, terms, ancestors };
  });
}

// ── Learned tokens ────────────────────────────────────────────────────

const usefulToken = t => t.length >= 3 && !NOISE.has(t) && !/^\d+$/.test(t);

// For every folder, the words that (almost) only appear in the names of
// videos already filed there. Returns Map<folderPath, Map<token, precision>>.
function learnTokens(videos) {
  const perFolder = new Map();
  const total = new Map();
  for (const v of videos) {
    const toks = new Set(prepareText(v.name).stems.filter(usefulToken));
    for (const t of toks) total.set(t, (total.get(t) || 0) + 1);
    if (!v.catPath) continue;
    let m = perFolder.get(v.catPath);
    if (!m) { m = new Map(); perFolder.set(v.catPath, m); }
    for (const t of toks) m.set(t, (m.get(t) || 0) + 1);
  }
  const out = new Map();
  for (const [folder, counts] of perFolder) {
    const keep = new Map();
    for (const [t, c] of counts) {
      if (c < 3) continue;
      const precision = c / total.get(t);
      if (precision >= 0.85) keep.set(t, precision);
    }
    if (keep.size) out.set(folder, keep);
  }
  return out;
}

// ── Matcher ───────────────────────────────────────────────────────────

// Build a matcher over the current folder tree. `videos` (the scan) enables
// learned-token matching; omit it for a quick name-only match.
function createMatcher({ folders, videos } = {}) {
  const candidates = buildCandidates(folders || listFolders());
  const byPath = new Map(candidates.map(c => [c.relPath, c]));
  const learned = videos ? learnTokens(videos) : new Map();
  let meta = {};
  try { meta = loadVideoMeta() || {}; } catch {}

  // Direct term score of one candidate for the prepared texts.
  const direct = (c, texts) => {
    let best = 0, term = '', how = 'name';
    for (const { text, weight, source } of texts) {
      for (const t of c.terms) {
        const s = scoreTerm(text, t) * lengthWeight(t) * weight;
        if (s > best) { best = s; term = t.raw; how = source; }
      }
    }
    return { score: best, term, how };
  };

  const learnedScore = (c, text) => {
    const toks = learned.get(c.relPath);
    if (!toks) return { score: 0, term: '' };
    const hits = [];
    for (const s of new Set(text.stems)) { const p = toks.get(s); if (p) hits.push([s, p]); }
    if (!hits.length) return { score: 0, term: '' };
    hits.sort((a, b) => b[1] - a[1]);
    const score = Math.min(80, 52 + hits[0][1] * 14 + (hits.length - 1) * 5);
    return { score, term: hits.slice(0, 3).map(h => h[0]).join(', ') };
  };

  // Rank every folder for a video. Returns sorted [{ path, score, term, how }].
  const rank = (name, id) => {
    const texts = [{ text: prepareText(name), weight: 1, source: 'name' }];
    const m = id && meta[id];
    if (m) {
      const extra = [m.title, m.channel, ...(m.actors || []), ...(m.tags || [])].filter(Boolean).join(' | ');
      if (extra) texts.push({ text: prepareText(extra), weight: 0.95, source: 'metadata' });
    }
    const raw = new Map();
    for (const c of candidates) {
      const d = direct(c, texts);
      const l = learnedScore(c, texts[0].text);
      const r = l.score > d.score ? { score: l.score, term: l.term, how: 'learned' } : d;
      if (r.score > 0) raw.set(c.relPath, r);
    }
    const out = [];
    for (const [p, r] of raw) {
      const c = byPath.get(p);
      // A matching parent folder confirms a subfolder match.
      const confirmed = c.ancestors.some(a => (raw.get(a)?.score || 0) >= MIN_SCORE);
      const score = Math.min(100, r.score + (confirmed ? 5 : 0));
      out.push({ path: p, score: Math.round(score), term: r.term, how: r.how, depth: c.depth });
    }
    // Specific first: a subfolder beats its parent unless clearly weaker.
    out.sort((a, b) => (b.score + b.depth * 3) - (a.score + a.depth * 3) || b.term.length - a.term.length);
    return out;
  };

  // Best folder from a ranking, or null. Adds confidence + near-miss alternatives.
  const pick = (all) => {
    const ranked = all.filter(r => r.score >= MIN_SCORE);
    if (!ranked.length) return null;
    const best = { ...ranked[0] };
    const related = p => p === best.path || best.path.startsWith(p + '/') || p.startsWith(best.path + '/');
    const rival = ranked.find(r => !related(r.path));
    best.ambiguous = !!rival && rival.score >= best.score - 6;
    // Two unrelated folders nearly tied: never auto-trust the pick.
    const effective = best.ambiguous ? Math.min(best.score - 15, HIGH_SCORE - 1) : best.score;
    best.confidence = effective >= HIGH_SCORE ? 'high' : effective >= MED_SCORE ? 'medium' : 'low';
    best.alternatives = ranked.filter(r => r.path !== best.path).slice(0, 4).map(r => ({ path: r.path, score: r.score }));
    return best;
  };

  const match = (name, id) => pick(rank(name, id));

  // How well a ranked video fits the folder it already sits in (0 = not at all).
  const fitIn = (ranked, folder) => {
    if (!folder) return 0;
    const r = ranked.find(x => x.path === folder || folder.startsWith(x.path + '/'));
    return r ? r.score : 0;
  };

  return { candidates, match, rank, pick, fitIn };
}

// ── Plan ──────────────────────────────────────────────────────────────

// Two modes, neither of which invents folders or guesses:
//  'uncategorized' → files sitting at a library root are filed into the best
//     (deepest) matching folder; unrecognised files stay in the media root.
//  'all' → every filed video (or only those under the top-level folders in
//     `scope`) is moved when another folder fits clearly better than the one
//     it sits in; otherwise it stays put.
// A match that ties with an unrelated folder counts as not recognised.
// Returns { moves, folders } where each move is
// { id, name, fromPath, toPath, score, confidence, term, how }.
function buildPlan(videos, mode = 'uncategorized', { scope } = {}) {
  const folders = listFolders();
  const local = videos.filter(v => !v.isLink && !v.encrypted);
  const matcher = createMatcher({ folders, videos: local });
  const inScope = Array.isArray(scope) && scope.length ? new Set(scope.map(s => String(s).toLowerCase())) : null;
  const moves = [];

  for (const v of local) {
    const from = v.catPath || '';
    if (mode === 'all') {
      if (inScope && !inScope.has(from.split('/')[0].toLowerCase())) continue;
    } else if (from) continue;

    const ranked = matcher.rank(v.name, v.id);
    const hit = matcher.pick(ranked);
    if (!hit || hit.ambiguous || hit.path === from) continue;
    if (from) {
      if (from.startsWith(hit.path + '/')) continue; // never move up to a parent
      // Refining into a subfolder is always fine; jumping to an unrelated
      // folder needs a confident match that clearly beats the current one.
      const refine = hit.path.startsWith(from + '/');
      if (!refine && (hit.confidence === 'low' || hit.score < matcher.fitIn(ranked, from) + 10)) continue;
    }
    moves.push({
      id: v.id, name: v.name, fromPath: from, toPath: hit.path,
      score: hit.score, confidence: hit.confidence, term: hit.term, how: hit.how,
    });
  }

  moves.sort((a, b) => a.toPath.localeCompare(b.toPath) || b.score - a.score);
  return { moves, folders };
}

// Quick single-file lookup for downloads / feed imports. Only confident
// matches are returned so unattended filing never guesses.
function bestFolderFor(filename, { minConfidence = 'medium' } = {}) {
  try {
    const stemName = path.basename(filename, path.extname(filename));
    const hit = createMatcher().match(stemName);
    if (!hit) return null;
    if (minConfidence === 'high' && hit.confidence !== 'high') return null;
    if (minConfidence === 'medium' && hit.confidence === 'low') return null;
    return hit.path;
  } catch (e) {
    console.error('[categorizer] bestFolderFor:', e.message);
    return null;
  }
}

module.exports = {
  normalize, prepareText, prepareTerm, scoreTerm, similarity,
  listFolders, libraryRoots, createMatcher, buildPlan, bestFolderFor,
  MIN_SCORE, HIGH_SCORE, MED_SCORE,
};
