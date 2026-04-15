'use strict';
// ═══════════════════════════════════════════════════════════════════
//  books.js — Books upload, URL import, reading, and deletion
// ═══════════════════════════════════════════════════════════════════

const fs    = require('fs');
const path  = require('path');
const http  = require('http');
const https = require('https');
const { BOOKS_DIR } = require('./config-server');
const { json, readBody, formatBytes } = require('./helpers-server');
const { loadBooksMeta, saveBooksMeta } = require('./db-server');

function bookToId(filename) { return Buffer.from(filename).toString('base64url'); }
function bookFromId(id)     { return Buffer.from(id, 'base64url').toString('utf-8'); }

// ── HTML → plain text ────────────────────────────────────────────────

function htmlToText(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── URL fetch helper ─────────────────────────────────────────────────

function fetchUrl(rawUrl, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    const mod  = rawUrl.startsWith('https') ? https : http;
    const opts = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } };
    const req  = mod.get(rawUrl, opts, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchUrl(res.headers.location, redirects + 1));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

// ── Fanfiction.net scraper ────────────────────────────────────────────

async function scrapeFanfiction(storyUrl) {
  const { body }    = await fetchUrl(storyUrl);
  const titleM      = body.match(/<b class="xcontrast_txt">([^<]+)<\/b>/);
  const title       = titleM ? titleM[1].trim() : 'Untitled Story';
  const authorM     = body.match(/By:<\/span>\s*<a[^>]+href="\/u\/\d+\/[^"]*"[^>]*>([^<]+)<\/a>/);
  const author      = authorM ? authorM[1].trim() : '';
  const chapOpts    = body.match(/<option[^>]+value="\d+"[^>]*>/g);
  const totalChapters = chapOpts ? chapOpts.length : 1;

  function extractStoryText(html) {
    const m = html.match(/<div[^>]*\bid="storytext"[^>]*>([\s\S]+?)<\/div>\s*(?:<\/div>|<div\s)/);
    if (m) return m[1];
    const m2 = html.match(/<div[^>]*\bid="storytext"[^>]*>([\s\S]+)/);
    return m2 ? m2[1].replace(/<\/body[\s\S]*/, '') : '';
  }

  let content = `# ${title}\n`;
  if (author) content += `*by ${author}*\n`;
  content += `\n---\n\n`;

  const ch1NameM = body.match(/<option[^>]+value="1"[^>]*selected[^>]*>([^<]+)<\/option>/);
  const ch1Name  = ch1NameM ? ch1NameM[1].trim() : 'Chapter 1';
  content += `## ${ch1Name}\n\n${htmlToText(extractStoryText(body))}\n\n`;

  const storyIdM = storyUrl.match(/fanfiction\.net\/s\/(\d+)/);
  if (storyIdM && totalChapters > 1) {
    const storyId = storyIdM[1];
    const limit   = Math.min(totalChapters, 20);
    for (let ch = 2; ch <= limit; ch++) {
      try {
        const { body: cb }   = await fetchUrl(`https://www.fanfiction.net/s/${storyId}/${ch}/`);
        const chapNameM      = cb.match(new RegExp(`<option[^>]+value="${ch}"[^>]*selected[^>]*>([^<]+)<\\/option>`));
        const chapName       = chapNameM ? chapNameM[1].trim() : `Chapter ${ch}`;
        content += `## ${chapName}\n\n${htmlToText(extractStoryText(cb))}\n\n`;
      } catch {}
    }
  }
  return { title, author, content, chapters: Math.min(totalChapters, 20) };
}

async function scrapeGenericUrl(rawUrl) {
  const { body }  = await fetchUrl(rawUrl);
  const titleM    = body.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title     = titleM ? titleM[1].replace(/\s+/g, ' ').trim() : 'Imported Page';
  const cleaned   = body
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '');
  return { title, content: `# ${title}\n*Imported from: ${rawUrl}*\n\n---\n\n${htmlToText(cleaned)}` };
}

// ── Books API handlers ────────────────────────────────────────────────

function apiBooksList(req, res) {
  const meta  = loadBooksMeta();
  const books = Object.entries(meta)
    .map(([filename, m]) => ({ id: bookToId(filename), filename, ...m }))
    .sort((a, b) => b.date - a.date);
  json(res, books);
}

async function apiBooksUpload(req, res) {
  const filename     = decodeURIComponent(req.headers['x-filename'] || 'book.txt');
  const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9.\-_ ()]/g, '_');
  const ext          = path.extname(safeFilename).toLowerCase();
  const allowed      = new Set(['.pdf', '.txt', '.doc', '.docx', '.md', '.epub']);
  if (!allowed.has(ext)) return json(res, { error: 'Unsupported file type. Allowed: pdf, txt, doc, docx, md, epub' }, 400);

  let outName = safeFilename, counter = 1;
  while (fs.existsSync(path.join(BOOKS_DIR, outName))) {
    outName = path.basename(safeFilename, ext) + ` (${counter++})` + ext;
  }

  const chunks = [];
  await new Promise((resolve, reject) => { req.on('data', c => chunks.push(c)); req.on('end', resolve); req.on('error', reject); });
  const data = Buffer.concat(chunks);
  fs.writeFileSync(path.join(BOOKS_DIR, outName), data);

  const meta  = loadBooksMeta();
  const title = path.basename(outName, ext);
  meta[outName] = { title, ext, size: data.length, sizeF: formatBytes(data.length), date: Date.now(), type: 'upload' };
  saveBooksMeta(meta);
  json(res, { ok: true, id: bookToId(outName), title });
}

async function apiBooksImportUrl(req, res) {
  const body   = await readBody(req);
  const rawUrl = (body.url || '').trim();
  if (!rawUrl) return json(res, { error: 'Missing url' }, 400);
  if (!/^https?:\/\//.test(rawUrl)) return json(res, { error: 'Invalid URL' }, 400);

  try {
    let title, content, chapters;
    if (/fanfiction\.net\/s\/\d+/.test(rawUrl)) {
      const r = await scrapeFanfiction(rawUrl);
      title = r.title; content = r.content; chapters = r.chapters;
    } else {
      const r = await scrapeGenericUrl(rawUrl);
      title = r.title; content = r.content;
    }

    let safeTitle = title.replace(/[^a-zA-Z0-9 \-_.()]/g, '_').trim().slice(0, 80) || 'imported';
    let outName   = safeTitle + '.md';
    let counter   = 1;
    while (fs.existsSync(path.join(BOOKS_DIR, outName))) {
      outName = safeTitle + ` (${counter++}).md`;
    }

    fs.writeFileSync(path.join(BOOKS_DIR, outName), content, 'utf-8');
    const meta = loadBooksMeta();
    meta[outName] = {
      title, ext: '.md',
      size: Buffer.byteLength(content), sizeF: formatBytes(Buffer.byteLength(content)),
      date: Date.now(),
      type: /fanfiction\.net/.test(rawUrl) ? 'fanfiction' : 'url',
      url: rawUrl,
      ...(chapters ? { chapters } : {}),
    };
    saveBooksMeta(meta);
    json(res, { ok: true, id: bookToId(outName), title });
  } catch (e) {
    json(res, { error: 'Import failed: ' + e.message }, 500);
  }
}

function apiBooksRead(req, res, id) {
  const filename = bookFromId(id);
  const filePath = path.join(BOOKS_DIR, path.basename(filename));
  if (!filePath.startsWith(BOOKS_DIR + path.sep) && filePath !== BOOKS_DIR) {
    return json(res, { error: 'Invalid path' }, 400);
  }
  if (!fs.existsSync(filePath)) return json(res, { error: 'Not found' }, 404);

  const ext = path.extname(filename).toLowerCase();
  if (ext === '.pdf' || ext === '.epub') {
    const stat = fs.statSync(filePath);
    const mime = ext === '.pdf' ? 'application/pdf' : 'application/epub+zip';
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size, 'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"` });
    fs.createReadStream(filePath).pipe(res);
  } else {
    const content = fs.readFileSync(filePath, 'utf-8');
    const meta    = loadBooksMeta();
    const m       = meta[filename] || {};
    json(res, { title: m.title || path.basename(filename, ext), content, ext, type: m.type || 'upload' });
  }
}

function apiBooksDelete(req, res, id) {
  const filename = bookFromId(id);
  const filePath = path.join(BOOKS_DIR, path.basename(filename));
  if (!filePath.startsWith(BOOKS_DIR + path.sep) && filePath !== BOOKS_DIR) {
    return json(res, { error: 'Invalid path' }, 400);
  }
  try { fs.unlinkSync(filePath); } catch {}
  const meta = loadBooksMeta();
  delete meta[filename];
  saveBooksMeta(meta);
  json(res, { ok: true });
}

module.exports = {
  apiBooksList, apiBooksUpload, apiBooksImportUrl, apiBooksRead, apiBooksDelete,
};
