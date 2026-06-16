'use strict';
// ═══════════════════════════════════════════════════════════════════
//  logger.js — Minimal structured logger
//
//  Adds a timestamp + level to every line and can be silenced/tuned via
//  the LOG_LEVEL env var (error | warn | info | debug). Setting LOG_LEVEL
//  to "silent" (or "none"/"off") disables all output — useful in PKG/prod.
//
//    const log = require('./logger-server');
//    log.info('server started', { port });
//    log.warn('ffprobe failed', err);
//    log.error('request failed', err);
// ═══════════════════════════════════════════════════════════════════

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

function resolveLevel() {
  const raw = String(process.env.LOG_LEVEL || '').toLowerCase().trim();
  if (raw === 'none' || raw === 'off') return LEVELS.silent;
  if (raw in LEVELS) return LEVELS[raw];
  return LEVELS.info; // default
}

let threshold = resolveLevel();

const COLORS = { error: '\x1b[31m', warn: '\x1b[33m', info: '\x1b[36m', debug: '\x1b[90m' };
const RESET = '\x1b[0m';

function emit(level, args) {
  if (LEVELS[level] > threshold) return;
  const ts = new Date().toISOString();
  const tag = `${COLORS[level] || ''}[${ts}] ${level.toUpperCase()}${RESET}`;
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(tag, ...args);
}

module.exports = {
  error: (...a) => emit('error', a),
  warn:  (...a) => emit('warn', a),
  info:  (...a) => emit('info', a),
  debug: (...a) => emit('debug', a),
  setLevel(name) { if (name in LEVELS) threshold = LEVELS[name]; },
  get level() { return threshold; },
  LEVELS,
};
