'use strict';
// ═══════════════════════════════════════════════════════════════════
//  helpers.js — Pure utility functions shared across modules
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { VIDEOS_DIR, PUBLIC_DIR, STATIC_MIME, IS_PKG } = require('./config');

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
  const full = path.resolve(VIDEOS_DIR, rel);
  if (!full.startsWith(path.resolve(VIDEOS_DIR))) return null;
  if (!fs.existsSync(full)) return null;
  return full;
}

// ── String matching ──────────────────────────────────────────────────

function wordMatch(name, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('\\b' + escaped + '\\b', 'i').test(name);
}
function wordMatchAny(name, terms) {
  return terms.some(t => wordMatch(name, t));
}

function actorMatches(videoName, actor) {
  const vn = videoName.toLowerCase();
  const an = actor.toLowerCase();
  if (vn.includes(an)) return true;
  const parts = an.split(/\s+/).filter(p => p.length > 1);
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

function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', c => d += c);
    req.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
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
  wordMatch, wordMatchAny, actorMatches, actorMatchesAny,
  json, readBody,
  serveStatic,
};
