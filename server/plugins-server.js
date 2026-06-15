'use strict';
// ═══════════════════════════════════════════════════════════════════
//  plugins-server.js — Plugin registry (reads plugins/*/meta.json
//                       and widgets/*/meta.json)
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { PLUGINS_DIR, WIDGETS_DIR } = require('./config-server');
const { json } = require('./helpers-server');

function readDir(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(dir, entry.name, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      results.push({ id: entry.name, ...meta });
    } catch (e) {}
  }
  return results;
}

function listPlugins() {
  return [...readDir(PLUGINS_DIR), ...readDir(WIDGETS_DIR)];
}

function apiGetPlugins(req, res) {
  json(res, { plugins: listPlugins() });
}

module.exports = { listPlugins, apiGetPlugins };
