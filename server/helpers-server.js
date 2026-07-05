'use strict';
// ═══════════════════════════════════════════════════════════════════
//  helpers.js — Pure utility functions shared across modules
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');
const { VIDEOS_DIR, PUBLIC_DIR, STATIC_MIME, IS_PKG } = require('./config-server');

// ── Formatting ───────────────────────────────────────────────────────

function formatBytes(b) {
  if (b === 0) return '0 B';
  const k = 1024, s = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(1) + ' ' + s[i];
}

function formatDuration(secs) {
  if (!secs || secs <= 0) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  return m + ':' + String(s).padStart(2, '0');
}

// ── HTTP range parsing ───────────────────────────────────────────────

// Parse a single-range HTTP `Range` header against a known content `size`.
// Returns:
//   null                  → no header / unparseable (caller serves the whole body)
//   { invalid: true }     → syntactically valid but unsatisfiable (caller → 416)
//   { start, end }        → inclusive byte offsets to serve (206)
// Supports `bytes=START-`, `bytes=START-END` and suffix `bytes=-N` (last N bytes).
function parseRange(rangeHeader, size) {
  if (!rangeHeader) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
  if (!m) return null;
  let start = m[1] === '' ? NaN : parseInt(m[1], 10);
  let end   = m[2] === '' ? NaN : parseInt(m[2], 10);
  if (Number.isNaN(start)) {
    // Suffix range: the last `end` bytes.
    if (Number.isNaN(end) || end <= 0) return { invalid: true };
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (Number.isNaN(end)) {
    end = size - 1;
  }
  if (start < 0 || end >= size || start > end) return { invalid: true };
  return { start, end };
}

// ── ID encoding ──────────────────────────────────────────────────────

function toId(rel)  { return Buffer.from(rel).toString('base64url'); }
function fromId(id) { return Buffer.from(id, 'base64url').toString('utf-8'); }

function safePath(id) {
  const rel  = fromId(id);
  let full;
  if (path.isAbsolute(rel)) {
    full = path.resolve(rel);
  } else {
    full = path.resolve(VIDEOS_DIR, rel);
  }

  const inside = (root) => {
    const r = path.resolve(root);
    return full === r || full.startsWith(r + path.sep);
  };

  if (inside(VIDEOS_DIR)) {
    if (fs.existsSync(full)) return full;
    return null;
  }

  try {
    const { loadPrefs } = require('./db-server');
    const prefs = loadPrefs();
    if (prefs.sourceFolders) {
      for (const folder of prefs.sourceFolders) {
        if (inside(folder)) {
          if (fs.existsSync(full)) return full;
        }
      }
    }
  } catch (e) {
    // Handle potential errors
  }

  // Temporarily opened folders (Open button) — not in the DB, but streamable.
  try {
    const { getOpenedRoots } = require('./opened-folders-server');
    for (const root of getOpenedRoots()) {
      if (full === root || full.startsWith(root + path.sep)) {
        if (fs.existsSync(full)) return full;
      }
    }
  } catch (e) {
    // opened-folders module not ready / unavailable
  }

  return null;
}

// ── Media path guard ─────────────────────────────────────────────────
// True if `fp` resolves inside the unified media folder (MEDIA_DIR) or any
// configured sourceFolder / temporarily-opened root. Shared by every media
// view (audio/books/photos/pages/files) for serve / read / delete guards.
function isAllowedMediaPath(fp) {
  if (!fp) return false;
  const resolved = path.resolve(fp);
  const inside = (root) => {
    const r = path.resolve(root);
    return resolved === r || resolved.startsWith(r + path.sep);
  };
  if (inside(VIDEOS_DIR)) return true;            // VIDEOS_DIR === MEDIA_DIR
  try {
    const { loadPrefs } = require('./db-server');
    for (const sf of (loadPrefs().sourceFolders || [])) {
      if (fs.existsSync(sf) && inside(sf)) return true;
    }
  } catch {}
  try {
    const { getOpenedRoots } = require('./opened-folders-server');
    for (const root of getOpenedRoots()) { if (inside(root)) return true; }
  } catch {}
  return false;
}

// ── String matching ──────────────────────────────────────────────────

const _matchCache = new Map();
function wordMatch(name, term) {
  let re = _matchCache.get(term);
  if (!re) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp('\\b' + escaped + '\\b', 'i');
    if (_matchCache.size > 1000) _matchCache.clear(); // simple LRU-ish
    _matchCache.set(term, re);
  }
  return re.test(name);
}
function wordMatchAny(name, terms) {
  return terms.some(t => wordMatch(name, t));
}

// Normalize a string for fuzzy channel matching: lowercase, strip spaces/dashes/underscores
const _normCache = new Map();
function normChannel(s) {
  let res = _normCache.get(s);
  if (!res) {
    res = s.toLowerCase().replace(/[\s\-_]+/g, '');
    if (_normCache.size > 2000) _normCache.clear();
    _normCache.set(s, res);
  }
  return res;
}
function channelMatchAny(name, terms) {
  const normName = normChannel(name);
  return terms.some(t => {
    if (wordMatch(name, t)) return true;
    const normT = normChannel(t);
    return normT.length > 2 && normName.includes(normT);
  });
}

const _actorPartsCache = new Map();
function actorMatches(videoName, actor) {
  if (typeof videoName !== 'string' || typeof actor !== 'string') return false;
  
  const vn = videoName.toLowerCase();
  const an = actor.toLowerCase();
  if (vn.includes(an)) return true;
  
  let parts = _actorPartsCache.get(an);
  if (!parts) {
    parts = an.split(/\s+/).filter(p => p.length > 1);
    if (_actorPartsCache.size > 2000) _actorPartsCache.clear();
    _actorPartsCache.set(an, parts);
  }
  
  return parts.length > 1 && parts.every(p => vn.includes(p));
}
function actorMatchesAny(videoName, terms) {
  return terms.some(t => actorMatches(videoName, t));
}

// ── HTTP helpers ─────────────────────────────────────────────────────

function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  // Compress large payloads (the full /api/videos list shrinks ~10x): a huge
  // uncompressed JSON body is one of the main contributors to the long first-
  // load spinner, especially over LAN/phone. res.req is the paired request.
  const acceptsGzip = /\bgzip\b/.test((res.req && res.req.headers['accept-encoding']) || '');
  if (acceptsGzip && body.length > 1024) {
    zlib.gzip(body, (err, gz) => {
      if (err || res.writableEnded) {
        try {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(body);
        } catch {}
        return;
      }
      try {
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
          'Content-Length': gz.length,
          'Vary': 'Accept-Encoding',
        });
        res.end(gz);
      } catch {}
    });
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

// Standard error response: always `{ error: "message" }` with a status code.
// Use this instead of plain-text / empty error bodies so the frontend can rely
// on a single shape.
function jsonError(res, message, status = 400) {
  json(res, { error: String(message || 'Error') }, status);
}

// ── Input length limits ──────────────────────────────────────────────
// Reasonable upper bounds for user-supplied strings, enforced server-side so a
// malformed/abusive client can't bloat the DB or JSON files.
const LIMITS = {
  name: 200,        // actor / channel / collection / folder names
  tag: 100,
  url: 2048,
  title: 500,
  note: 10000,
  text: 200000,     // free-form text blobs (text files, prompts)
  path: 4096,
};

// ── Lightweight body validation ──────────────────────────────────────
// schema: { field: { required?, type?, maxLength?, trim? } }
//   type: 'string' | 'number' | 'boolean' | 'array' | 'object'
// Returns { ok: true, value } with trimmed/normalised fields, or
// { ok: false, error } describing the first problem. Pair with jsonError:
//   const v = validateBody(body, {...}); if (!v.ok) return jsonError(res, v.error);
function validateBody(body, schema) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid request body' };
  const value = { ...body };
  for (const [field, rule] of Object.entries(schema)) {
    let val = body[field];
    const present = val !== undefined && val !== null && val !== '';
    if (!present) {
      if (rule.required) return { ok: false, error: `${field} is required` };
      continue;
    }
    if (rule.type) {
      const actual = Array.isArray(val) ? 'array' : typeof val;
      if (actual !== rule.type) return { ok: false, error: `${field} must be a ${rule.type}` };
    }
    if (typeof val === 'string') {
      if (rule.trim !== false) val = val.trim();
      if (rule.trim !== false && !val && rule.required) return { ok: false, error: `${field} is required` };
      const max = rule.maxLength || LIMITS[field];
      if (max && val.length > max) return { ok: false, error: `${field} is too long (max ${max} characters)` };
    }
    value[field] = val;
  }
  return { ok: true, value };
}

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    req.on('data', c => {
      total += c.length;
      if (total > MAX_BODY_BYTES) {
        req.socket?.destroy();
        resolve({});
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); } catch { resolve({}); }
    });
  });
}

// ── Static file server ───────────────────────────────────────────────

// Extensions worth compressing. Media/images are already compressed formats.
const COMPRESSIBLE_EXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.map', '.xml']);

// Vite emits content-hashed filenames under /assets/ (e.g. index-Dk3aX9.js):
// safe to cache forever. Everything else gets ETag revalidation, which turns
// repeat page loads into a burst of tiny 304s instead of re-downloading the
// entire bundle — the single biggest first-load win on this server.
function _staticHeaders(resolved, stat, ct) {
  const hashed = /[\\/]assets[\\/][^\\/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(resolved);
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  return {
    'Content-Type': ct,
    'ETag': etag,
    'Cache-Control': hashed
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  };
}

function _sendFile(req, res, resolved, stat, ct) {
  const headers = _staticHeaders(resolved, stat, ct);

  if (req.headers['if-none-match'] === headers.ETag) {
    res.writeHead(304, { 'ETag': headers.ETag, 'Cache-Control': headers['Cache-Control'] });
    res.end();
    return;
  }

  const ext = path.extname(resolved).toLowerCase();
  const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');

  if (acceptsGzip && COMPRESSIBLE_EXT.has(ext) && stat.size > 1024) {
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding' });
    const rs = fs.createReadStream(resolved);
    const gz = zlib.createGzip();
    rs.on('error', () => { try { res.destroy(); } catch {} });
    res.on('close', () => { try { rs.destroy(); } catch {} });
    rs.pipe(gz).pipe(res);
    return;
  }

  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  const rs = fs.createReadStream(resolved);
  rs.on('error', () => { try { res.destroy(); } catch {} });
  res.on('close', () => { try { rs.destroy(); } catch {} });
  rs.pipe(res);
}

function serveStatic(req, res, filePath) {
  const root = path.resolve(PUBLIC_DIR);
  const resolved = path.resolve(root, filePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  let stat = null;
  try { stat = fs.statSync(resolved); } catch {}
  if (!stat || !stat.isFile()) {
    // SPA fallback — index.html (revalidated with ETag, never hard-cached).
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    let iStat = null;
    try { iStat = fs.statSync(indexPath); } catch {}
    if (!iStat) { res.writeHead(404); res.end('Not found'); return; }
    _sendFile(req, res, indexPath, iStat, 'text/html; charset=utf-8');
    return;
  }
  const ext = path.extname(resolved).toLowerCase();
  const ct  = STATIC_MIME[ext] || 'application/octet-stream';
  // Streaming works in pkg snapshots too — readFileSync buffered the whole
  // file and blocked the event loop per asset request.
  _sendFile(req, res, resolved, stat, ct);
}

module.exports = {
  formatBytes, formatDuration, parseRange,
  toId, fromId, safePath, isAllowedMediaPath,
  wordMatch, wordMatchAny, channelMatchAny, actorMatches, actorMatchesAny,
  json, jsonError, readBody, validateBody, LIMITS,
  serveStatic,
};
