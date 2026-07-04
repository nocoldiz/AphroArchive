'use strict';
// ═══════════════════════════════════════════════════════════════════
//  books.js — Books upload, URL import, reading, and deletion
// ═══════════════════════════════════════════════════════════════════

const fs    = require('fs');
const path  = require('path');
const http  = require('http');
const https = require('https');
const zlib = require('zlib');
const { MEDIA_DIR, CACHE_DIR } = require('./config-server');
const { json, readBody, formatBytes, toId, fromId, isAllowedMediaPath } = require('./helpers-server');
const { loadBooksMeta, saveBooksMeta, loadMediaIndex } = require('./db-server');

function bookToId(p) { return toId(p); }
function bookFromId(id) { return fromId(id); }
function _invalidate() { try { require('./videos-server').invalidateScanCache(); } catch {} }

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
  // Title / type / url / chapters for uploaded & imported books live in
  // books_meta keyed by filename; the listing itself comes from media_index.
  let meta = {};
  try { meta = loadBooksMeta(); } catch {}
  const books = loadMediaIndex('book').map(m => {
    const mm = meta[m.filename] || {};
    return {
      id:       m.id,
      filename: m.filename,
      title:    m.title || mm.title || m.name,
      ext:      m.ext,
      size:     m.size,
      sizeF:    m.sizeF,
      date:     m.mtime,
      folder:   m.catPath || '',
      type:     mm.type || 'scanned',
      ...(mm.url ? { url: mm.url } : {}),
      ...(mm.chapters ? { chapters: mm.chapters } : {}),
    };
  });
  books.sort((a, b) => b.date - a.date);
  json(res, books);
}

async function apiBooksUpload(req, res) {
  const filename     = decodeURIComponent(req.headers['x-filename'] || 'book.txt');
  const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9.\-_ ()]/g, '_');
  const ext          = path.extname(safeFilename).toLowerCase();
  const allowed      = new Set(['.pdf', '.txt', '.doc', '.docx', '.md', '.epub', '.cbz']);
  if (!allowed.has(ext)) return json(res, { error: 'Unsupported file type. Allowed: pdf, txt, doc, docx, md, epub, cbz' }, 400);

  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  let outName = safeFilename, counter = 1;
  while (fs.existsSync(path.join(MEDIA_DIR, outName))) {
    outName = path.basename(safeFilename, ext) + ` (${counter++})` + ext;
  }

  const chunks = [];
  await new Promise((resolve, reject) => { req.on('data', c => chunks.push(c)); req.on('end', resolve); req.on('error', reject); });
  const data = Buffer.concat(chunks);
  const absPath = path.join(MEDIA_DIR, outName);
  fs.writeFileSync(absPath, data);

  const meta  = loadBooksMeta();
  const title = path.basename(outName, ext);
  meta[outName] = { title, ext, size: data.length, sizeF: formatBytes(data.length), date: Date.now(), type: 'upload' };
  saveBooksMeta(meta);
  _invalidate();
  json(res, { ok: true, id: bookToId(absPath), title });
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

    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    let safeTitle = title.replace(/[^a-zA-Z0-9 \-_.()]/g, '_').trim().slice(0, 80) || 'imported';
    let outName   = safeTitle + '.md';
    let counter   = 1;
    while (fs.existsSync(path.join(MEDIA_DIR, outName))) {
      outName = safeTitle + ` (${counter++}).md`;
    }

    const absPath = path.join(MEDIA_DIR, outName);
    fs.writeFileSync(absPath, content, 'utf-8');
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
    _invalidate();
    json(res, { ok: true, id: bookToId(absPath), title });
  } catch (e) {
    json(res, { error: 'Import failed: ' + e.message }, 500);
  }
}

function apiBooksRead(req, res, id) {
  const filePath = bookFromId(id);
  if (!filePath || !isAllowedMediaPath(filePath)) return json(res, { error: 'Invalid path' }, 403);
  if (!fs.existsSync(filePath)) return json(res, { error: 'Not found' }, 404);

  const filename = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
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

async function apiBooksWrite(req, res, id) {
  const filePath = bookFromId(id);
  if (!filePath || !isAllowedMediaPath(filePath)) return json(res, { error: 'Invalid path' }, 403);
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.txt' && ext !== '.md') return json(res, { error: 'Only txt/md files are editable' }, 400);
  const body = await readBody(req);
  const content = typeof body.content === 'string' ? body.content : '';
  fs.writeFileSync(filePath, content, 'utf-8');
  const filename = path.basename(filePath);
  const meta = loadBooksMeta();
  if (meta[filename]) { meta[filename].size = Buffer.byteLength(content); saveBooksMeta(meta); }
  _invalidate();
  json(res, { ok: true });
}

function apiBooksDelete(req, res, id) {
  const filePath = bookFromId(id);
  if (!filePath || !isAllowedMediaPath(filePath)) return json(res, { error: 'Invalid path' }, 403);
  try { fs.unlinkSync(filePath); } catch {}

  // Clean up CBZ cache if it exists (cache dir keyed by the stable id)
  const cacheDir = path.join(CACHE_DIR, 'cbz', id);
  if (fs.existsSync(cacheDir)) {
    try { fs.rmSync(cacheDir, { recursive: true, force: true }); } catch (e) { console.error('Failed to clean CBZ cache:', e); }
  }

  const meta = loadBooksMeta();
  delete meta[path.basename(filePath)];
  saveBooksMeta(meta);
  _invalidate();
  json(res, { ok: true });
}

// ── CBZ Support ──────────────────────────────────────────────────────

function extractCbz(filePath, outDir) {
  const fd = fs.openSync(filePath, 'r');
  const stat = fs.fstatSync(fd);
  const size = stat.size;
  
  const bufLen = Math.min(size, 1024);
  const buf = Buffer.alloc(bufLen);
  fs.readSync(fd, buf, 0, bufLen, size - bufLen);
  
  let eocdOffset = -1;
  for (let i = bufLen - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = size - bufLen + i;
      break;
    }
  }
  
  if (eocdOffset === -1) {
    fs.closeSync(fd);
    throw new Error('Not a valid ZIP file (EOCD not found)');
  }
  
  const eocd = Buffer.alloc(22);
  fs.readSync(fd, eocd, 0, 22, eocdOffset);
  const cdOffset = eocd.readUInt32LE(16);
  const cdSize = eocd.readUInt32LE(12);
  const cdCount = eocd.readUInt16LE(8);
  
  const cdBuf = Buffer.alloc(cdSize);
  fs.readSync(fd, cdBuf, 0, cdSize, cdOffset);
  
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  
  let p = 0;
  const files = [];
  for (let i = 0; i < cdCount; i++) {
    if (p + 46 > cdSize) break;
    if (cdBuf.readUInt32LE(p) !== 0x02014b50) break;
    
    const compression = cdBuf.readUInt16LE(p + 10);
    const compSize = cdBuf.readUInt32LE(p + 20);
    const uncompSize = cdBuf.readUInt32LE(p + 24);
    const nameLen = cdBuf.readUInt16LE(p + 28);
    const extraLen = cdBuf.readUInt16LE(p + 30);
    const commentLen = cdBuf.readUInt16LE(p + 32);
    const localOffset = cdBuf.readUInt32LE(p + 42);
    
    const filename = cdBuf.toString('utf-8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    
    if (/\.(jpg|jpeg|png|webp|gif)$/i.test(filename)) {
      const lh = Buffer.alloc(30);
      fs.readSync(fd, lh, 0, 30, localOffset);
      const lhNameLen = lh.readUInt16LE(26);
      const lhExtraLen = lh.readUInt16LE(28);
      const dataOffset = localOffset + 30 + lhNameLen + lhExtraLen;
      
      const compData = Buffer.alloc(compSize);
      fs.readSync(fd, compData, 0, compSize, dataOffset);
      
      let uncompData;
      if (compression === 0) {
        uncompData = compData;
      } else if (compression === 8) {
        try {
          uncompData = zlib.inflateRawSync(compData);
        } catch (e) {
          console.error(`Failed to inflate ${filename}: ${e.message}`);
          continue;
        }
      } else {
        continue;
      }
      
      const safeName = path.basename(filename);
      fs.writeFileSync(path.join(outDir, safeName), uncompData);
      files.push(safeName);
    }
  }
  
  fs.closeSync(fd);
  return files.sort();
}

function apiBooksCbzFiles(req, res, id) {
  const filePath = bookFromId(id);
  if (!filePath || !isAllowedMediaPath(filePath)) return json(res, { error: 'Invalid path' }, 403);
  if (!fs.existsSync(filePath)) return json(res, { error: 'Not found' }, 404);
  
  const cacheDir = path.join(CACHE_DIR, 'cbz', id);
  try {
    let files;
    if (fs.existsSync(cacheDir)) {
      files = fs.readdirSync(cacheDir).sort();
    } else {
      files = extractCbz(filePath, cacheDir);
    }
    json(res, { files });
  } catch (e) {
    json(res, { error: 'Failed to extract CBZ: ' + e.message }, 500);
  }
}

function apiBooksCbzFile(req, res, id, filepath) {
  const cacheDir = path.join(CACHE_DIR, 'cbz', id);
  const fp = path.join(cacheDir, path.basename(filepath));
  if (!fs.existsSync(fp)) return json(res, { error: 'Not found' }, 404);
  
  const ext = path.extname(filepath).toLowerCase();
  let mime = 'application/octet-stream';
  if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
  else if (ext === '.png') mime = 'image/png';
  else if (ext === '.webp') mime = 'image/webp';
  else if (ext === '.gif') mime = 'image/gif';
  
  const stat = fs.statSync(fp);
  res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size });
  fs.createReadStream(fp).pipe(res);
}

module.exports = {
  apiBooksList, apiBooksUpload, apiBooksImportUrl, apiBooksRead, apiBooksWrite, apiBooksDelete,
  apiBooksCbzFiles, apiBooksCbzFile,
};
