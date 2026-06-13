'use strict';
// ═══════════════════════════════════════════════════════════════════
//  plugins-server.js — Plugin registry (reads plugins/*/meta.json)
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { PLUGINS_DIR } = require('./config-server');
const { json } = require('./helpers-server');

function listPlugins() {
  if (!fs.existsSync(PLUGINS_DIR)) return [];
  const plugins = [];
  for (const entry of fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(PLUGINS_DIR, entry.name, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      plugins.push({ id: entry.name, ...meta });
    } catch (e) {}
  }
  return plugins;
}

function apiGetPlugins(req, res) {
  json(res, { plugins: listPlugins() });
}

module.exports = { listPlugins, apiGetPlugins };
