// Drive headless Edge over CDP through every route; report console errors,
// uncaught exceptions and failed HTTP requests per route.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:3997';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROUTES = ['/', '/browse', '/vault', '/collections', '/settings', '/actors', '/studios', '/links', '/database',
  '/photos', '/books', '/audio', '/thumbnails', '/categories', '/chapters', '/download-queue', '/prompts',
  '/assistant', '/categorizer', '/duplicates', '/instagram', '/reddit', '/mosaic', '/favourites', '/recent',
  '/search', '/pages', '/scraper', '/channels', '/files', '/screenshots', '/corrupted', '/home', '/folders'];

const profile = mkdtempSync(join(tmpdir(), 'edgecdp-'));
const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let wsUrl;
for (let i = 0; i < 40 && !wsUrl; i++) {
  try { const t = await (await fetch('http://127.0.0.1:9333/json')).json(); wsUrl = t.find(x => x.type === 'page')?.webSocketDebuggerUrl; } catch {}
  if (!wsUrl) await sleep(250);
}
const ws = new WebSocket(wsUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map(); const events = [];
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else events.push(d); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable'); await send('Page.enable');

const report = [];
for (const route of ROUTES) {
  events.length = 0;
  await send('Page.navigate', { url: BASE + route });
  await sleep(3500);
  const problems = [];
  for (const e of events) {
    if (e.method === 'Runtime.exceptionThrown') problems.push('EXCEPTION ' + (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text).split('\n')[0]);
    if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') problems.push('console.error ' + e.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
    if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') problems.push('log ' + e.params.entry.text.slice(0, 200) + (e.params.entry.url ? ' ' + e.params.entry.url : ''));
    if (e.method === 'Network.responseReceived' && e.params.response.status >= 400) problems.push(`HTTP ${e.params.response.status} ${e.params.response.url.replace(BASE, '')}`);
    if (e.method === 'Network.loadingFailed' && !e.params.canceled) problems.push('NETFAIL ' + e.params.errorText);
  }
  const { result } = (await send('Runtime.evaluate', { expression: "document.querySelector('#main-root')?.innerText.trim().length || 0", returnByValue: true })).result;
  report.push({ route, textLen: result.value, problems: [...new Set(problems)] });
}
ws.close(); edge.kill();
for (const r of report) console.log(`${r.problems.length ? '✗' : '✓'} ${r.route.padEnd(16)} text=${String(r.textLen).padStart(5)} ${r.problems.join(' | ')}`);
process.exit(0);
