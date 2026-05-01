'use strict';
// ═══════════════════════════════════════════════════════════════════
//  videos.js — Video scanning, listing, and all video API handlers
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { exec } = require('child_process');
const {
  VIDEOS_DIR, VAULT_DIR, IGNORED_DIR, VIDEO_EXT, MIME,
  AUDIO_DIR, AUDIO_EXT, BOOKS_DIR, BOOK_EXT,
  PHOTOS_DIR, IMAGE_EXT,
} = require('./config-server');
const { toId, fromId, safePath, formatBytes, formatDuration, json, readBody, wordMatch, wordMatchAny, studioMatchAny, actorMatchesAny } = require('./helpers-server');
const {
  loadFavs, saveFavs,
  loadHistory, saveHistory,
  loadPrefs,
  loadVideoMeta, saveVideoMeta, setVideoMetaFields,
  loadThumbsCache, saveThumbsCache,
  loadHidden,
  loadActors, loadCategories, loadStudios,
  loadAudioMeta, saveAudioMeta,
  loadBooksMeta, saveBooksMeta,
  loadRatings,
} = require('./db-server');

// ── Video scan cache ─────────────────────────────────────────────────

let _scanCache = null;
let _watchDebounce = null;

function invalidateScanCache() {
  _scanCache = null;
}

function _onVideoDirChange() {
  if (_watchDebounce) clearTimeout(_watchDebounce);
  _watchDebounce = setTimeout(() => { _scanCache = null; }, 300);
}

try {
  fs.watch(VIDEOS_DIR, { recursive: true }, _onVideoDirChange);
} catch (e) {
  // fs.watch unavailable in this environment; cache is invalidated by explicit calls only
}

function cachedScan() {
  if (!_scanCache) _scanCache = scan(VIDEOS_DIR);
  return _scanCache;
}

// ── Video scanning ───────────────────────────────────────────────────

function scan(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (path.resolve(fp) === path.resolve(VAULT_DIR) || path.resolve(fp) === path.resolve(IGNORED_DIR)) continue;
      out.push(...scan(fp, base));
      continue;
    }
    if (!ent.isFile() || !VIDEO_EXT.has(path.extname(ent.name).toLowerCase())) continue;
    const rel = path.relative(base, fp);
    const cat = path.dirname(rel);
    const st  = fs.statSync(fp);
    out.push({
      id: toId(rel),
      name: path.basename(ent.name, path.extname(ent.name)),
      filename: ent.name,
      ext: path.extname(ent.name).toLowerCase(),
      rel, category: cat === '.' ? 'Uncategorized' : cat.replace(/[\\/]/g, ' / '),
      catPath: cat === '.' ? '' : cat,
      size: st.size, sizeF: formatBytes(st.size),
      modified: st.mtime.toISOString(), mtime: st.mtimeMs,
    });
  }
  return out;
}

function isVideoHidden(v, hiddenTerms) {
  return hiddenTerms.some(term => {
    if (wordMatch(v.name, term)) return true;
    const catLo = v.catPath.toLowerCase(), termLo = term.toLowerCase();
    return catLo === termLo || catLo.startsWith(termLo + '/') || catLo.startsWith(termLo + '\\');
  });
}

function allVideos() {
  const all    = cachedScan();
  const hidden = loadHidden();
  return hidden.length ? all.filter(v => !isVideoHidden(v, hidden)) : all;
}

// ── Video meta init (runs on startup) ───────────────────────────────

function initVideoMeta() {
  try {
    const meta       = loadVideoMeta();
    const videos     = scan(VIDEOS_DIR);
    let changed      = false;
    const categories = loadCategories();
    const studios    = loadStudios();
    const actors     = loadActors();
    let oldRatings   = {};
    try { oldRatings = loadRatings(); } catch {}

    for (const v of videos) {
      if (!meta[v.id]) {
        const detectedTags   = categories.filter(e => wordMatchAny(v.name, e.terms)).map(e => e.displayName);
        const detectedStudio = studios.find(e => studioMatchAny(v.name, e.terms));
        const detectedActors = actors.filter(e => actorMatchesAny(v.name, e.terms)).map(e => e.name);
        meta[v.id] = {
          title: v.name,
          actors: detectedActors,
          tags: detectedTags,
          studio: detectedStudio ? detectedStudio.name : '',
          rating: oldRatings[v.id] || null,
          category: v.catPath,
          note: '', date: v.modified,
        };
        changed = true;
      } else if (oldRatings[v.id] && !meta[v.id].rating) {
        meta[v.id].rating = oldRatings[v.id];
        changed = true;
      }
    }
    for (const id of Object.keys(meta)) {
      if (!videos.find(v => v.id === id)) { delete meta[id]; changed = true; }
    }
    if (changed) saveVideoMeta(meta);
  } catch (e) { console.error('initVideoMeta error:', e.message); }
}

// ── Video API handlers ───────────────────────────────────────────────

function apiVideos(req, res, params) {
  const videos      = allVideos();
  const favs        = loadFavs();
  const meta        = loadVideoMeta();
  const thumbsCache = loadThumbsCache();
  let list = videos.map(v => {
    const cached   = thumbsCache[v.id];
    const duration = cached?.duration || null;
    const vMeta    = meta[v.id] || {};
    return { ...v, fav: favs.includes(v.id), rating: vMeta.rating ?? null, duration, durationF: formatDuration(duration), tags: vMeta.tags || [] };
  });
  const q    = params.get('q');
  const cat  = params.get('category');
  const sort = params.get('sort') || 'date';
  const fav  = params.get('fav') === '1' || params.get('fav') === 'true';
  
  const relevance = new Map();
  if (q) {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    list = list.filter(v => {
      const vName = v.name.toLowerCase();
      const vCat  = v.category.toLowerCase();
      const vTags = (meta[v.id]?.tags || []).map(t => t.toLowerCase());
      
      const match = tokens.every(token =>
        vName.includes(token) ||
        vCat.includes(token) ||
        vTags.some(t => t.includes(token))
      );
      
      if (match) {
        let score = 0;
        tokens.forEach(token => {
          if (vName.includes(token)) score += 10;
          if (vName.startsWith(token)) score += 5;
          if (vCat.includes(token)) score += 3;
          if (vTags.some(t => t.includes(token))) score += 5;
        });
        if (vName.includes(q.toLowerCase())) score += 20;
        relevance.set(v.id, score);
      }
      return match;
    });
  }

  if (fav) {
    list = list.filter(v => v.fav);
  }
  
  // 1. Check for strict null instead of truthiness
  if (cat !== null) {
    if (cat === '__uncategorized__' || cat === '') {
      const defined = loadCategories();
      list = list.filter(v => v.catPath === '' && !defined.some(e => wordMatchAny(v.name, e.terms)));
    } else {
      const defined = loadCategories();
      const catLo = cat.toLowerCase();
      const matchingEntry = defined.find(e => e.name.toLowerCase() === catLo);
      const cl = cat.toLowerCase().replace(/\\/g, '/');
      list = list.filter(v => {
        const vp = v.catPath.toLowerCase().replace(/\\/g, '/');
        const isChild = vp === cl || vp.startsWith(cl + '/');
        return isChild || v.category === cat || (matchingEntry && v.catPath === '' && wordMatchAny(v.name, matchingEntry.terms));
      });
    }
  }
  if (sort === 'name')     list.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'size')     list.sort((a, b) => b.size - a.size);
  else if (sort === 'duration') list.sort((a, b) => (b.duration || 0) - (a.duration || 0));
  else if (q && relevance.size) {
    list.sort((a, b) => {
      const sA = relevance.get(a.id) || 0;
      const sB = relevance.get(b.id) || 0;
      if (sA !== sB) return sB - sA;
      return b.mtime - a.mtime;
    });
  }
  else list.sort((a, b) => b.mtime - a.mtime);
  json(res, list);
}

function apiCategories(req, res) {
  const videos = cachedScan();
  const hidden = loadHidden();
  const cats = [];

  function walk(dir, rel = '') {
    if (!fs.existsSync(dir)) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const subRel = rel ? path.join(rel, ent.name) : ent.name;
        const subRelFwd = subRel.replace(/\\/g, '/');
        const full = path.join(VIDEOS_DIR, subRel);
        
        if (path.resolve(full) === path.resolve(VAULT_DIR) || path.resolve(full) === path.resolve(IGNORED_DIR)) continue;
        if (hidden.some(t => t.toLowerCase() === ent.name.toLowerCase())) continue;

        // Recursive count
        const count = videos.filter(v => {
          const vp = v.catPath.toLowerCase();
          const cl = subRelFwd.toLowerCase();
          return vp === cl || vp.startsWith(cl + '/') || vp.startsWith(cl + '\\');
        }).length;

        cats.push({ name: subRel.replace(/[\\/]/g, ' / '), path: subRelFwd, count });
        walk(full, subRel);
      }
    } catch (e) {}
  }

  walk(VIDEOS_DIR);

  // Uncategorized count
  const defined = loadCategories();
  const uncatCount = videos.filter(v => v.catPath === '' && !defined.some(e => wordMatchAny(v.name, e.terms))).length;
  cats.unshift({ name: 'Uncategorized', path: '__uncategorized__', count: uncatCount });

  cats.sort((a, b) => {
    if (a.path === '__uncategorized__') return -1;
    if (b.path === '__uncategorized__') return 1;
    return a.name.localeCompare(b.name);
  });

  json(res, cats);
}

function apiMainCategories(req, res) {
  const hidden = loadHidden();
  const result = [{ name: 'Uncategorized', path: '' }];

  function walk(dir, rel = '') {
    if (!fs.existsSync(dir)) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const subRel = rel ? path.join(rel, ent.name) : ent.name;
        const full = path.join(VIDEOS_DIR, subRel);
        if (path.resolve(full) === path.resolve(VAULT_DIR) || path.resolve(full) === path.resolve(IGNORED_DIR)) continue;
        if (hidden.some(t => t.toLowerCase() === ent.name.toLowerCase())) continue;
        result.push({ name: subRel.replace(/[\\/]/g, ' / '), path: subRel.replace(/\\/g, '/') });
        walk(full, subRel);
      }
    } catch (e) {}
  }

  walk(VIDEOS_DIR);
  result.sort((a, b) => {
    if (a.path === '') return -1;
    if (b.path === '') return 1;
    return a.name.localeCompare(b.name);
  });
  json(res, result);
}

async function apiCreateCategory(req, res) {
  const body = await readBody(req);
  const name = (body.name || '').trim().replace(/[<>:"|?*]/g, '_');
  if (!name) return json(res, { error: 'Name required' }, 400);
  const dir = path.join(VIDEOS_DIR, name);
  if (fs.existsSync(dir)) return json(res, { error: 'Already exists' }, 409);
  try { fs.mkdirSync(dir, { recursive: true }); json(res, { ok: true, name }); }
  catch (e) { json(res, { error: e.message }, 500); }
}

function apiVideoDetail(req, res, id) {
  const videos = allVideos();
  const v      = videos.find(x => x.id === id);
  if (!v) return json(res, { error: 'Not found' }, 404);

  const favs  = loadFavs();
  const meta  = loadVideoMeta();
  const vMeta = meta[v.id] || {};
  const video = { ...v, fav: favs.includes(v.id), rating: vMeta.rating ?? null };

  const actors         = loadActors();
  const metaActors     = vMeta.actors || [];
  const filenameActors = actors.filter(e => actorMatchesAny(v.name, e.terms)).map(e => e.name);
  const combinedActors = [...new Set([...metaActors, ...filenameActors])];
  const metaTags       = vMeta.tags || [];

  const allTagSet = new Set();
  for (const entry of Object.values(meta)) {
    if (Array.isArray(entry.tags)) entry.tags.forEach(t => allTagSet.add(t));
  }
  loadCategories().forEach(e => allTagSet.add(e.displayName));

  const suggested = videos
    .filter(x => x.id !== v.id)
    .map(x => {
      let score      = 0;
      const xActors  = meta[x.id]?.actors || [];
      const shared   = combinedActors.filter(a => xActors.some(xa => xa.toLowerCase() === a.toLowerCase()));
      score += shared.length * 100;
      if (x.category === v.category) score += 50;
      return { video: x, score };
    })
    .sort((a, b) => b.score - a.score || Math.random() - 0.5)
    .slice(0, 12)
    .map(item => ({ ...item.video, fav: favs.includes(item.video.id), rating: meta[item.video.id]?.rating ?? null }));

  json(res, { video, suggested, actors: combinedActors, tags: metaTags, allCategories: [...allTagSet].sort(), studio: vMeta.studio || '' });
}

function apiStream(req, res, id) {
  const fp = safePath(id);
  if (!fp) { res.writeHead(404); res.end('Not found'); return; }
  const stat = fs.statSync(fp);
  const size = stat.size;
  const ext  = path.extname(fp).toLowerCase();
  const ct   = MIME[ext] || 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end   = endStr ? parseInt(endStr, 10) : size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': ct,
    });
    fs.createReadStream(fp, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': size, 'Content-Type': ct, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(fp).pipe(res);
  }
}

function apiDelete(req, res, id) {
  const fp = safePath(id);
  if (!fp) return json(res, { error: 'Not found' }, 404);
  try {
    fs.unlinkSync(fp);
    invalidateScanCache();
    const favs = loadFavs();
    const fi   = favs.indexOf(id);
    if (fi !== -1) { favs.splice(fi, 1); saveFavs(favs); }
    const cache = loadThumbsCache();
    if (cache[id]) { delete cache[id]; saveThumbsCache(cache); }
    const { THUMBS_DIR } = require('./config-server');
    const thumbDir = path.join(THUMBS_DIR, id);
    if (fs.existsSync(thumbDir)) fs.rmSync(thumbDir, { recursive: true, force: true });
    const meta = loadVideoMeta();
    if (meta[id]) { delete meta[id]; saveVideoMeta(meta); }
    json(res, { ok: true });
  } catch (e) { json(res, { error: e.message }, 500); }
}

async function apiRename(req, res, id) {
  const body    = await readBody(req);
  const newName = (body.newName || '').trim();
  if (!newName) return json(res, { error: 'Name required' }, 400);
  const fp  = safePath(id);
  if (!fp) return json(res, { error: 'Not found' }, 404);
  const dir  = path.dirname(fp);
  const ext  = path.extname(fp);
  const safe = newName.replace(/[<>:"/\\|?*]/g, '_');
  const np   = path.join(dir, safe + ext);
  if (fs.existsSync(np) && np !== fp) return json(res, { error: 'Name already exists' }, 409);
  try {
    fs.renameSync(fp, np);
    invalidateScanCache();
    const newRel = path.relative(VIDEOS_DIR, np);
    const newId  = toId(newRel);
    const favs = loadFavs();
    const fi   = favs.indexOf(id);
    if (fi !== -1) { favs[fi] = newId; saveFavs(favs); }
    const meta = loadVideoMeta();
    if (meta[id]) { meta[newId] = { ...meta[id], title: safe }; delete meta[id]; saveVideoMeta(meta); }
    json(res, { ok: true, newId });
  } catch (e) { json(res, { error: e.message }, 500); }
}

async function apiMove(req, res, id) {
  const body           = await readBody(req);
  const targetCategory = (body.category ?? '').trim();
  const fp             = safePath(id);
  if (!fp) return json(res, { error: 'Not found' }, 404);

  const targetDir      = targetCategory ? path.join(VIDEOS_DIR, targetCategory) : VIDEOS_DIR;
  const resolvedTarget = path.resolve(targetDir);
  if (!resolvedTarget.startsWith(path.resolve(VIDEOS_DIR))) return json(res, { error: 'Invalid category' }, 400);
  if (!fs.existsSync(resolvedTarget)) fs.mkdirSync(resolvedTarget, { recursive: true });

  const filename = path.basename(fp);
  const newPath  = path.join(resolvedTarget, filename);
  if (path.resolve(newPath) === path.resolve(fp)) return json(res, { error: 'Already in this category' }, 400);
  if (fs.existsSync(newPath)) return json(res, { error: 'A file with that name already exists in the target category' }, 409);

  try {
    fs.renameSync(fp, newPath);
    invalidateScanCache();
    const newRel = path.relative(VIDEOS_DIR, newPath);
    const newId  = toId(newRel);
    const favs = loadFavs();
    const fi   = favs.indexOf(id);
    if (fi !== -1) { favs[fi] = newId; saveFavs(favs); }
    const meta = loadVideoMeta();
    if (meta[id]) { meta[newId] = { ...meta[id] }; delete meta[id]; saveVideoMeta(meta); }
    json(res, { ok: true, newId });
  } catch (e) { json(res, { error: e.message }, 500); }
}

function apiAutoSort(req, res) {
  const systemDirs = new Set([path.basename(VAULT_DIR), path.basename(IGNORED_DIR)]);
  let folders;
  try {
    folders = fs.readdirSync(VIDEOS_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory() && !systemDirs.has(e.name))
      .map(e => e.name);
  } catch { return json(res, { moved: 0 }); }
  if (!folders.length) return json(res, { moved: 0 });

  let loose;
  try {
    loose = fs.readdirSync(VIDEOS_DIR, { withFileTypes: true })
      .filter(e => e.isFile() && VIDEO_EXT.has(path.extname(e.name).toLowerCase()))
      .map(e => e.name);
  } catch { return json(res, { moved: 0 }); }
  if (!loose.length) return json(res, { moved: 0 });

  const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  let moved = 0;
  const favs = loadFavs();
  let favsChanged = false;

  for (const filename of loose) {
    const nameNoExt = norm(path.basename(filename, path.extname(filename)));
    const match     = folders.find(folder => nameNoExt.includes(norm(folder)));
    if (!match) continue;
    const src = path.join(VIDEOS_DIR, filename);
    const dst = path.join(VIDEOS_DIR, match, filename);
    if (fs.existsSync(dst)) continue;
    try {
      fs.renameSync(src, dst);
      moved++;
      const oldId = toId(filename);
      const newId = toId(path.join(match, filename));
      const fi    = favs.indexOf(oldId);
      if (fi !== -1) { favs[fi] = newId; favsChanged = true; }
    } catch {}
  }
  if (favsChanged) saveFavs(favs);
  if (moved > 0) invalidateScanCache();
  json(res, { moved });
}

// ── Favourites / History / Ratings ───────────────────────────────────

function apiFavourites(req, res) {
  const favs   = loadFavs();
  const videos = allVideos();
  json(res, videos.filter(v => favs.includes(v.id)).map(v => ({ ...v, fav: true })));
}

function apiToggleFav(req, res, id) {
  const favs = loadFavs();
  const i    = favs.indexOf(id);
  if (i === -1) favs.push(id); else favs.splice(i, 1);
  saveFavs(favs);
  json(res, { fav: i === -1 });
}

function apiAddHistory(req, res, id) {
  if (loadPrefs().chronologyMode === 'dont-save') return json(res, { ok: true });
  const videos = allVideos();
  if (!videos.find(v => v.id === id)) return json(res, { ok: false });
  let h = loadHistory().filter(x => x !== id);
  h.unshift(id);
  if (h.length > 100) h = h.slice(0, 100);
  saveHistory(h);
  json(res, { ok: true });
}

function apiGetHistory(req, res) {
  const h      = loadHistory();
  const videos = allVideos();
  const map    = Object.fromEntries(videos.map(v => [v.id, v]));
  json(res, h.map(id => map[id]).filter(Boolean));
}

function apiClearHistory(req, res) {
  saveHistory([]);
  json(res, { ok: true });
}

async function apiSetRating(req, res, id) {
  const body  = await readBody(req);
  const stars = parseInt(body.stars, 10);
  if (!Number.isFinite(stars) || stars < 1 || stars > 5) return json(res, { error: 'stars must be 1–5' }, 400);
  setVideoMetaFields(id, { rating: stars });
  json(res, { ok: true, rating: stars });
}

function apiDeleteRating(req, res, id) {
  setVideoMetaFields(id, { rating: null });
  json(res, { ok: true });
}

async function apiUpdateVideoMeta(req, res, id) {
  const videos = allVideos();
  if (!videos.find(v => v.id === id)) return json(res, { error: 'Not found' }, 404);
  const body    = await readBody(req);
  const allowed = ['title', 'actors', 'tags', 'studio', 'rating', 'category', 'note', 'date'];
  const fields  = {};
  for (const key of allowed) { if (key in body) fields[key] = body[key]; }
  setVideoMetaFields(id, fields);
  json(res, { ok: true });
}

async function apiOpenFolder(req, res) {
  const body = await readBody(req);
  const id   = body.id || '';
  let folder;
  if (id) {
    const fp = safePath(id);
    if (!fp) return json(res, { error: 'Not found' }, 404);
    folder = path.dirname(fp);
  } else {
    folder = VIDEOS_DIR;
  }
  const cmd = process.platform === 'win32' ? `explorer "${folder}"`
    : process.platform === 'darwin' ? `open "${folder}"`
    : `xdg-open "${folder}"`;
  exec(cmd, () => {});
  json(res, { ok: true });
}

function apiDuplicates(req, res) {
  const videos = allVideos();
  const favs   = loadFavs();
  const bySize = new Map();
  for (const v of videos) {
    if (!bySize.has(v.size)) bySize.set(v.size, []);
    bySize.get(v.size).push({ ...v, fav: favs.includes(v.id) });
  }
  const groups = [...bySize.values()]
    .filter(g => g.length > 1)
    .sort((a, b) => b[0].size - a[0].size);
  json(res, groups);
}

// ── Tags ─────────────────────────────────────────────────────────────

function apiCategoriesOverview(req, res) {
  const videos = cachedScan();
  const meta   = loadVideoMeta();
  const hidden = loadHidden();

  // ── Categories (from folder structure) ──
  const catMap = new Map();
  for (const v of videos) {
    if (v.catPath === '') continue;
    if (!catMap.has(v.catPath)) catMap.set(v.catPath, { type: 'cat', name: v.category, path: v.catPath, count: 0, ids: [] });
    const e = catMap.get(v.catPath);
    e.count++;
    e.ids.push(v.id);
  }
  const filteredCats = [...catMap.values()].filter(c => {
    const lo = c.path.toLowerCase();
    return !hidden.some(t => { const tl = t.toLowerCase(); return lo === tl || lo.startsWith(tl + '/') || lo.startsWith(tl + '\\'); });
  });

  // ── Tags ──
  const folderNames = new Set(
    videos.filter(v => v.catPath !== '').map(v => v.catPath.split(/[/\\]/)[0].toLowerCase())
  );
  const tagMap = new Map();
  for (const v of videos) {
    for (const tag of (meta[v.id]?.tags || [])) {
      const lo = tag.toLowerCase();
      if (folderNames.has(lo)) continue;
      if (!tagMap.has(lo)) tagMap.set(lo, { type: 'tag', name: tag, count: 0, ids: [] });
      tagMap.get(lo).count++;
      tagMap.get(lo).ids.push(v.id);
    }
  }

  const result = [...filteredCats, ...tagMap.values()].map(e => {
    const thumbId = e.ids.length ? e.ids[Math.floor(Math.random() * e.ids.length)] : null;
    return { type: e.type, name: e.name, path: e.path || null, count: e.count, thumbId };
  });
  json(res, result);
}

function apiTags(req, res) {
  const meta    = loadVideoMeta();
  const videos  = allVideos();
  const folderNames = new Set(
    videos.filter(v => v.catPath !== '').map(v => v.catPath.split(/[/\\]/)[0].toLowerCase())
  );
  const tagMap = new Map();
  for (const v of videos) {
    const vMeta = meta[v.id] || {};
    for (const tag of (vMeta.tags || [])) {
      const lo = tag.toLowerCase();
      if (folderNames.has(lo)) continue;
      if (!tagMap.has(lo)) tagMap.set(lo, { name: tag, count: 0 });
      tagMap.get(lo).count++;
    }
  }
  json(res, [...tagMap.values()].sort((a, b) => a.name.localeCompare(b.name)));
}

function apiTagVideos(req, res, tagName) {
  const meta   = loadVideoMeta();
  const videos = allVideos();
  const favs   = loadFavs();
  const tagLo  = tagName.toLowerCase();
  
  const parsed = require('url').parse(req.url, true);
  const fav    = (parsed.query.fav === '1' || parsed.query.fav === 'true');

  let list = videos
    .filter(v => (meta[v.id]?.tags || []).some(t => t.toLowerCase() === tagLo))
    .map(v => ({ ...v, fav: favs.includes(v.id), rating: meta[v.id]?.rating ?? null }));
  
  if (fav) list = list.filter(v => v.fav);
  
  list.sort((a, b) => b.mtime - a.mtime);
  
  if (!list.length && !fav) return json(res, { error: 'Not found' }, 404);
  json(res, { tag: tagName, videos: list });
}

// ── DB-backed tag listing (grouped by displayName, matched on meta + filename) ──

function _catForName(name) {
  const cats  = loadCategories();
  const nameLo = name.toLowerCase();
  return cats.find(c => c.displayName.toLowerCase() === nameLo)
      || cats.find(c => c.terms.some(t => t.toLowerCase() === nameLo));
}

function apiDbTags(req, res) {
  const cats   = loadCategories();
  const meta   = loadVideoMeta();
  const videos = allVideos();
  const result = cats
    .map(cat => {
      const termsLo = cat.terms.map(t => t.toLowerCase());
      const count   = videos.filter(v => {
        const vTagsLo = (meta[v.id]?.tags || []).map(t => t.toLowerCase());
        return vTagsLo.some(t => termsLo.includes(t)) || wordMatchAny(v.name, cat.terms);
      }).length;
      return { displayName: cat.displayName, count, terms: cat.terms };
    })
    .filter(e => e.count > 0)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  json(res, result);
}

function apiDbTagVideos(req, res, name) {
  const cat = _catForName(name);
  if (!cat) return json(res, { error: 'Not found' }, 404);
  const meta    = loadVideoMeta();
  const videos  = allVideos();
  const favs    = loadFavs();
  const termsLo = cat.terms.map(t => t.toLowerCase());

  const parsed = require('url').parse(req.url, true);
  const fav    = (parsed.query.fav === '1' || parsed.query.fav === 'true');

  let list = videos
    .filter(v => {
      const vTagsLo = (meta[v.id]?.tags || []).map(t => t.toLowerCase());
      return vTagsLo.some(t => termsLo.includes(t)) || wordMatchAny(v.name, cat.terms);
    })
    .map(v => ({ ...v, fav: favs.includes(v.id), rating: meta[v.id]?.rating ?? null }));

  if (fav) list = list.filter(v => v.fav);

  list.sort((a, b) => b.mtime - a.mtime);

  if (!list.length && !fav) return json(res, { error: 'Not found' }, 404);
  json(res, { tag: cat.displayName, videos: list });
}

function apiVideoTags(req, res, id) {
  const meta = loadVideoMeta();
  json(res, { tags: meta[id]?.tags || [] });
}

function apiTagSuggestions(req, res) {
  const cats = loadCategories();
  const seen = new Set();
  const result = [];
  for (const c of cats) {
    if (c.displayName && !seen.has(c.displayName.toLowerCase())) {
      seen.add(c.displayName.toLowerCase());
      result.push(c.displayName);
    }
    // c.terms = [name, ...tags]; skip index 0 (name) if displayName already covers it
    for (let i = 0; i < c.terms.length; i++) {
      const t = c.terms[i];
      if (!seen.has(t.toLowerCase())) {
        seen.add(t.toLowerCase());
        result.push(t);
      }
    }
  }
  json(res, result.sort((a, b) => a.localeCompare(b)));
}

// ── Studios ──────────────────────────────────────────────────────────

function apiStudios(req, res) {
  const studios = loadStudios();
  const videos  = allVideos();
  const meta    = loadVideoMeta();
  const result  = studios
    .map(e => ({
      name: e.name,
      count: videos.filter(v => {
        const ms = (meta[v.id]?.studio || '').toLowerCase();
        return ms === e.name.toLowerCase() || wordMatchAny(v.name, e.terms);
      }).length,
      website: e.website,
      description: e.description,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  json(res, result);
}

function apiStudioVideos(req, res, studioName) {
  const studios = loadStudios();
  const entry   = studios.find(e => e.name.toLowerCase() === studioName.toLowerCase());
  if (!entry) return json(res, { error: 'Not found' }, 404);
  const videos   = allVideos();
  const meta     = loadVideoMeta();
  const favs     = loadFavs();
  const studioLo = entry.name.toLowerCase();

  const parsed = require('url').parse(req.url, true);
  const fav    = (parsed.query.fav === '1' || parsed.query.fav === 'true');

  let list = videos
    .filter(v => {
      const ms = (meta[v.id]?.studio || '').toLowerCase();
      return ms === studioLo || wordMatchAny(v.name, entry.terms);
    })
    .map(v => ({ ...v, fav: favs.includes(v.id), rating: meta[v.id]?.rating ?? null }));

  if (fav) list = list.filter(v => v.fav);

  list.sort((a, b) => b.mtime - a.mtime);

  json(res, { studio: entry.name, videos: list });
}

// ── Subtitles ────────────────────────────────────────────────────────

const SUBTITLE_EXT = new Set(['.srt', '.vtt']);

function apiSubtitles(req, res, id) {
  const fp = safePath(id);
  if (!fp) return json(res, []);
  const dir  = path.dirname(fp);
  const base = path.basename(fp, path.extname(fp));
  const found = [];
  try {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isFile()) continue;
      const ext = path.extname(ent.name).toLowerCase();
      if (!SUBTITLE_EXT.has(ext)) continue;
      const nameNoExt = ent.name.slice(0, -ext.length);
      // Accept exact match or "video.en.srt", "video.fr.vtt", etc.
      if (nameNoExt === base || nameNoExt.startsWith(base + '.')) {
        const label = nameNoExt.slice(base.length).replace(/^\./, '') || 'Default';
        found.push({ filename: ent.name, label, ext });
      }
    }
  } catch {}
  json(res, found);
}

function apiSubtitleFile(req, res, id, filename) {
  const fp = safePath(id);
  if (!fp) { res.writeHead(404); res.end('Not found'); return; }
  const dir      = path.dirname(fp);
  const base     = path.basename(fp, path.extname(fp));
  const ext      = path.extname(filename).toLowerCase();
  if (!SUBTITLE_EXT.has(ext)) { res.writeHead(400); res.end('Bad extension'); return; }
  const nameNoExt = filename.slice(0, -ext.length);
  if (nameNoExt !== base && !nameNoExt.startsWith(base + '.')) {
    res.writeHead(400); res.end('Filename mismatch'); return;
  }
  const full = path.resolve(dir, path.basename(filename));
  if (!full.startsWith(path.resolve(VIDEOS_DIR))) { res.writeHead(403); res.end('Forbidden'); return; }
  if (!fs.existsSync(full)) { res.writeHead(404); res.end('Not found'); return; }
  const ct = ext === '.vtt' ? 'text/vtt' : 'text/plain';
  res.writeHead(200, { 'Content-Type': ct });
  fs.createReadStream(full).pipe(res);
}

// ── Global import (video / audio / book by extension) ─────────────────

async function apiImport(req, res) {
  const filename     = decodeURIComponent(req.headers['x-filename'] || 'file');
  const categoryHdr  = (req.headers['x-category'] || '').trim();
  const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9.\-_ ()]/g, '_');
  const ext          = path.extname(safeFilename).toLowerCase();

  let destDir, kind;
  if (VIDEO_EXT.has(ext)) {
    const safeCat = categoryHdr ? categoryHdr.replace(/[^a-zA-Z0-9 \-_]/g, '').trim() : '';
    destDir = safeCat ? path.join(VIDEOS_DIR, safeCat) : VIDEOS_DIR;
    kind = 'video';
  }
  else if (AUDIO_EXT.has(ext)) { destDir = AUDIO_DIR;  kind = 'audio'; }
  else if (BOOK_EXT.has(ext))  { destDir = BOOKS_DIR;  kind = 'book';  }
  else if (IMAGE_EXT.has(ext)) { destDir = PHOTOS_DIR; kind = 'photo'; }
  else return json(res, { error: 'Unsupported file type: ' + ext }, 400);

  if (kind === 'video' && !path.resolve(destDir).startsWith(path.resolve(VIDEOS_DIR)))
    return json(res, { error: 'Invalid category' }, 400);

  fs.mkdirSync(destDir, { recursive: true });

  let outName = safeFilename, counter = 1;
  while (fs.existsSync(path.join(destDir, outName))) {
    outName = path.basename(safeFilename, ext) + ` (${counter++})` + ext;
  }

  const chunks = [];
  await new Promise((resolve, reject) => {
    req.on('data', c => chunks.push(c));
    req.on('end', resolve);
    req.on('error', reject);
  });
  const data = Buffer.concat(chunks);
  fs.writeFileSync(path.join(destDir, outName), data);

  let videoId = null;
  if (kind === 'video') {
    invalidateScanCache();
    videoId = toId(path.relative(VIDEOS_DIR, path.join(destDir, outName)));
  }

  if (kind === 'audio') {
    const meta = loadAudioMeta();
    meta[outName] = { title: path.basename(outName, ext), ext, size: data.length, sizeF: formatBytes(data.length), date: Date.now() };
    saveAudioMeta(meta);
  } else if (kind === 'book') {
    const meta = loadBooksMeta();
    meta[outName] = { title: path.basename(outName, ext), ext, size: data.length, sizeF: formatBytes(data.length), date: Date.now(), type: 'upload' };
    saveBooksMeta(meta);
  }
  json(res, { ok: true, kind, name: outName, id: videoId });
}

module.exports = {
  scan, cachedScan, allVideos, isVideoHidden, invalidateScanCache, initVideoMeta,
  apiVideos, apiCategories, apiCategoriesOverview, apiMainCategories, apiCreateCategory,
  apiVideoDetail, apiStream, apiDelete, apiRename, apiMove, apiAutoSort,
  apiFavourites, apiToggleFav,
  apiAddHistory, apiGetHistory, apiClearHistory,
  apiSetRating, apiDeleteRating,
  apiUpdateVideoMeta, apiOpenFolder, apiDuplicates,
  apiTags, apiTagVideos, apiVideoTags, apiTagSuggestions,
  apiDbTags, apiDbTagVideos,
  apiStudios, apiStudioVideos,
  apiSubtitles, apiSubtitleFile,
  apiImport,
};
