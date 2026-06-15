'use strict';
// ═══════════════════════════════════════════════════════════════════
//  helpers.js — Pure utility functions shared across modules
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
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

  if (full.startsWith(path.resolve(VIDEOS_DIR))) {
    if (fs.existsSync(full)) return full;
    return null;
  }

  try {
    const { loadPrefs } = require('./db-server');
    const prefs = loadPrefs();
    if (prefs.sourceFolders) {
      for (const folder of prefs.sourceFolders) {
        if (full.startsWith(path.resolve(folder))) {
          if (fs.existsSync(full)) return full;
        }
      }
    }
  } catch (e) {
    // Handle potential errors
  }

  return null;
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
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
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

function serveStatic(req, res, filePath) {
  const resolved = path.resolve(PUBLIC_DIR, filePath);
  if (!resolved.startsWith(path.resolve(PUBLIC_DIR))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  let isFile = false;
  try { isFile = fs.statSync(resolved).isFile(); } catch {}
  if (!isFile) {
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    try {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(indexPath));
    } catch { res.writeHead(404); res.end('Not found'); }
    return;
  }
  const ext = path.extname(resolved).toLowerCase();
  const ct  = STATIC_MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': ct });
  if (IS_PKG) {
    res.end(fs.readFileSync(resolved));
  } else {
    fs.createReadStream(resolved).pipe(res);
  }
}

module.exports = {
  formatBytes, formatDuration,
  toId, fromId, safePath,
  wordMatch, wordMatchAny, channelMatchAny, actorMatches, actorMatchesAny,
  json, readBody,
  serveStatic,
};
