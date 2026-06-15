'use strict';

const $ = (id) => document.getElementById(id);
const send = (msg) => browser.runtime.sendMessage(msg);

const serverDot = $('serverDot');
const serverUrlInput = $('serverUrl');
const serverHint = $('serverHint');
const statusEl = $('status');

let online = false;
let settings = { minPhotoSize: 150, serverUrl: 'http://localhost:3000', defaultFilter: '' };
let detected = { videos: [], photos: [], page: '', title: '', kind: 'html', contentType: '' };
let photoState = []; // [{ url, w, h, selected }]
let activeTab = null; // { id, url, title }

const setStatus = (text) => { statusEl.textContent = text || ''; };
const IMG_EXT_RE = /\.(jpe?g|png|gif|webp|avif|bmp|jfif)(?:$|\?)/i;

// ── server connection ────────────────────────────────────────────────
async function refreshServer() {
  Aphro.setBase(serverUrlInput.value);
  try {
    const info = await Aphro.checkServer();
    online = true;
    document.body.classList.remove('offline');
    serverDot.className = 'dot ok';
    serverHint.textContent = info.available
      ? `Connected · yt-dlp ${info.version || 'ready'} · saves to videos/downloads`
      : 'Connected · yt-dlp NOT found on server';
  } catch {
    online = false;
    document.body.classList.add('offline');
    serverDot.className = 'dot err';
    serverHint.textContent = 'AphroArchive not reachable — server features hidden.';
  }
  renderVideos();
}

// ── detection ────────────────────────────────────────────────────────
async function loadDetected() {
  detected = await send({ type: 'GET_DETECTED' }) || { videos: [], photos: [], page: '', title: '', kind: 'html' };
  renderVideos();
  renderPhotos();
  renderPageActions();
}

// Hide audio-only tracks and per-quality HLS variant playlists; sort the rest
// so directly-downloadable progressive videos come first, highest-res on top.
function displayVideos() {
  return (detected.videos || [])
    .filter(v => !v.audioOnly && !v.variant)
    .sort((a, b) => (a.stream - b.stream) || ((b.height || 0) - (a.height || 0)));
}

function renderVideos() {
  const list = $('videos');
  list.innerHTML = '';
  const vids = displayVideos();
  $('vidCount').textContent = vids.length;
  if (!vids.length) {
    list.innerHTML = '<li class="empty">No videos detected on this page.</li>';
    return;
  }
  vids.forEach((v, i) => {
    const li = document.createElement('li');

    const main = document.createElement('div');
    main.className = 'media-main';
    const title = document.createElement('div');
    title.className = 'media-title';
    const res = v.height ? ` · ${v.width}×${v.height}` : '';
    title.textContent = (v.title || v.url.split('/').pop().split('?')[0] || v.url) + res;
    const sub = document.createElement('div');
    sub.className = 'media-sub';
    sub.textContent = v.url;
    main.appendChild(title);
    main.appendChild(sub);
    li.appendChild(main);

    const isHls = v.stream && Hls.isHls(v.url);
    const isDash = v.stream && !isHls;
    if (!v.stream && i === 0) { const t = document.createElement('span'); t.className = 'tag best'; t.textContent = 'best'; li.appendChild(t); }
    if (isHls) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'HLS'; li.appendChild(t); }
    if (isDash) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'DASH'; li.appendChild(t); }
    if (v.sniffed) { const t = document.createElement('span'); t.className = 'tag sniff'; t.textContent = 'net'; li.appendChild(t); }

    const btn = document.createElement('button');
    btn.textContent = '⬇';
    // HLS is rejoined client-side (works offline). DASH still needs the server.
    if (isDash && !online) { btn.disabled = true; btn.title = 'DASH needs AphroArchive running'; }
    btn.addEventListener('click', () => downloadVideo(v));
    li.appendChild(btn);

    list.appendChild(li);
  });
}

// When the server is running, hand streams (and Twitter/twimg media generally)
// to yt-dlp via the page URL — it resolves the best muxed quality far better
// than a raw variant playlist would.
function serverUrlFor(v) {
  const usesPage = v.stream || /(\.|\/)twimg\.com/i.test(v.url);
  return (usesPage && detected.page) ? detected.page : v.url;
}

async function downloadVideo(v) {
  // HLS package → rejoin the segments into one file locally (works offline).
  if (v.stream && Hls.isHls(v.url)) return rejoinHls(v);

  // DASH: no client-side joiner yet — hand to the server when available.
  if (v.stream) {
    if (online) {
      try { await Aphro.addDownloads([serverUrlFor(v)]); setStatus('Queued on AphroArchive.'); loadJobs(); }
      catch (e) { setStatus('Error: ' + e.message); }
    } else setStatus('DASH streams need AphroArchive running.');
    return;
  }

  // Progressive single file.
  if (online) {
    try { await Aphro.addDownloads([serverUrlFor(v)]); setStatus('Queued on AphroArchive (videos/downloads).'); loadJobs(); }
    catch (e) { setStatus('Error: ' + e.message); }
  } else {
    try { await browser.downloads.download({ url: v.url }); setStatus('Download started.'); }
    catch (e) { setStatus('Error: ' + e.message); }
  }
}

// Fetch every segment of an HLS stream and rejoin them into one video file.
async function rejoinHls(v) {
  setStatus('Reading playlist…');
  try {
    const { blob, ext } = await Hls.download(v.url, {
      onProgress: (d, t) => setStatus(`Joining segments… ${Math.round(d / t * 100)}% (${d}/${t})`)
    });
    const base = (v.title || pageTitle() || 'video').split('/').pop().split('?')[0].replace(/\.[^.]+$/, '');
    const name = safeName(base, ext);
    const url = URL.createObjectURL(blob);
    await browser.downloads.download({ url, filename: name, saveAs: true });
    setStatus(`Saved joined video — ${(blob.size / 1048576).toFixed(1)} MB.`);
  } catch (e) {
    setStatus('Join failed: ' + (e.message || e));
  }
}

$('sendVideosBtn').addEventListener('click', async () => {
  // De-dupe (Twitter collapses to a single tweet-page URL for the server).
  const urls = [...new Set(displayVideos().map(serverUrlFor))];
  if (!urls.length) return;
  try {
    const r = await Aphro.addDownloads(urls);
    setStatus(`Queued ${r.ids ? r.ids.length : urls.length} item(s).`);
    loadJobs();
  } catch (e) { setStatus('Error: ' + e.message); }
});

// ── this-page actions (server only) ──────────────────────────────────
function renderPageActions() {
  const kind = detected.kind || 'html';
  $('pageKindBadge').textContent = kind;
  $('saveBookBtn').classList.toggle('hidden', kind !== 'text');
  $('sendThisVideoBtn').classList.toggle('hidden', kind !== 'video');
  $('sendThisPhotoBtn').classList.toggle('hidden', kind !== 'image');
  // Saving rendered HTML only makes sense for real pages.
  $('savePageBtn').classList.toggle('hidden', kind !== 'html');
}

const pageUrl = () => detected.page || (activeTab && activeTab.url) || '';
const pageTitle = () => detected.title || (activeTab && activeTab.title) || 'page';

function safeName(name, fallbackExt) {
  let n = (name || '').trim().replace(/[^a-zA-Z0-9._\- ]/g, '_').slice(0, 100) || 'untitled';
  if (fallbackExt && !/\.[a-z0-9]{1,5}$/i.test(n)) n += fallbackExt;
  return n;
}

$('addSiteBtn').addEventListener('click', async () => {
  const url = pageUrl();
  if (!url) return setStatus('No page URL.');
  let origin = url, host = url;
  try { const u = new URL(url); origin = u.origin; host = u.hostname; } catch {}
  try {
    await Aphro.addWebsite(pageTitle() || host, origin);
    setStatus(`Added "${host}" to websites DB.`);
  } catch (e) { setStatus('Error: ' + e.message); }
});

$('savePageBtn').addEventListener('click', async () => {
  if (!activeTab) return;
  try {
    const r = await browser.tabs.sendMessage(activeTab.id, { type: 'GET_PAGE_HTML' });
    if (!r || !r.html) throw new Error('Could not read page HTML.');
    await Aphro.savePage(safeName(r.title || pageTitle(), '.html'), r.html);
    setStatus('Saved page to Pages.');
  } catch (e) { setStatus('Error: ' + e.message); }
});

$('saveBookBtn').addEventListener('click', async () => {
  const url = pageUrl();
  try {
    const blob = await (await fetch(url)).blob();
    let name = safeName(decodeURIComponent(url.split('/').pop().split('?')[0]) || pageTitle(), '.txt');
    if (!/\.(pdf|txt|doc|docx|md|epub|cbz)$/i.test(name)) name = name.replace(/\.[^.]+$/, '') + '.txt';
    await Aphro.saveBook(name, blob);
    setStatus(`Saved "${name}" to Books.`);
  } catch (e) { setStatus('Error: ' + e.message); }
});

$('sendThisVideoBtn').addEventListener('click', async () => {
  const url = pageUrl();
  try {
    await Aphro.addDownloads([url]);
    setStatus('Sent video to library (videos/downloads).');
    loadJobs();
  } catch (e) { setStatus('Error: ' + e.message); }
});

$('sendThisPhotoBtn').addEventListener('click', async () => {
  const url = pageUrl();
  try {
    const blob = await (await fetch(url)).blob();
    await Aphro.uploadPhoto(blob, photoFilename(url, 0));
    setStatus('Sent photo to gallery.');
  } catch (e) { setStatus('Error: ' + e.message); }
});

$('rescanBtn').addEventListener('click', async () => {
  await send({ type: 'RESCAN_ACTIVE' });
  setTimeout(loadDetected, 600);
});

// ── photos ───────────────────────────────────────────────────────────
function renderPhotos() {
  const min = settings.minPhotoSize || 0;
  const all = detected.photos || [];
  // Keep images that are either big enough, or of unknown size (lazy/bg).
  const kept = all.filter(p => (p.w === 0 && p.h === 0) || (p.w >= min || p.h >= min));
  photoState = kept.map(p => ({ ...p, selected: true }));

  $('photoCount').textContent = photoState.length;
  $('photoNote').textContent = min ? `min ${min}px · ${all.length - kept.length} skipped` : '';

  const grid = $('photos');
  grid.innerHTML = '';
  if (!photoState.length) {
    grid.innerHTML = '<div class="empty">No photos detected.</div>';
    return;
  }
  photoState.forEach((p) => {
    const cell = document.createElement('div');
    cell.className = 'photo-cell';
    cell.title = p.url + (p.w ? ` (${p.w}×${p.h})` : '');

    const img = document.createElement('img');
    img.src = p.url;
    img.loading = 'lazy';
    cell.appendChild(img);

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = true;
    chk.addEventListener('change', () => { p.selected = chk.checked; cell.classList.toggle('off', !chk.checked); });
    cell.appendChild(chk);

    cell.addEventListener('click', (e) => {
      if (e.target === chk) return;
      chk.checked = !chk.checked;
      p.selected = chk.checked;
      cell.classList.toggle('off', !chk.checked);
    });

    grid.appendChild(cell);
  });
}

$('photoSelectAll').addEventListener('change', (e) => {
  const on = e.target.checked;
  photoState.forEach(p => p.selected = on);
  for (const cell of $('photos').children) {
    const chk = cell.querySelector('input');
    if (chk) { chk.checked = on; cell.classList.toggle('off', !on); }
  }
});

const selectedPhotos = () => photoState.filter(p => p.selected);

function photoFilename(url, idx) {
  let name = '';
  try { name = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch {}
  if (!name || !IMG_EXT_RE.test(name)) name = `image-${idx + 1}.jpg`;
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

$('dlPhotosBtn').addEventListener('click', async () => {
  const sel = selectedPhotos();
  if (!sel.length) return setStatus('No photos selected.');
  let n = 0;
  for (const p of sel) {
    try { await browser.downloads.download({ url: p.url }); n++; } catch {}
  }
  setStatus(`Started ${n} download(s).`);
});

$('zipPhotosBtn').addEventListener('click', async () => {
  const sel = selectedPhotos();
  if (!sel.length) return setStatus('No photos selected.');
  setStatus(`Zipping ${sel.length} photo(s)…`);
  const files = {};
  const used = new Set();
  let ok = 0;
  for (let i = 0; i < sel.length; i++) {
    try {
      const buf = new Uint8Array(await (await fetch(sel[i].url)).arrayBuffer());
      let name = photoFilename(sel[i].url, i);
      while (used.has(name)) name = name.replace(/(\.[^.]+)?$/, `_${i}$1`);
      used.add(name);
      files[name] = buf;
      ok++;
    } catch {}
  }
  if (!ok) return setStatus('Could not fetch any photos.');
  const zipped = fflate.zipSync(files, { level: 0 });
  const host = (() => { try { return new URL(detected.page || location.href).hostname; } catch { return 'photos'; } })();
  const blob = new Blob([zipped], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  await browser.downloads.download({ url, filename: `photos-${host}.zip`, saveAs: true });
  setStatus(`Zipped ${ok} photo(s).`);
});

$('sendPhotosBtn').addEventListener('click', async () => {
  const sel = selectedPhotos();
  if (!sel.length) return setStatus('No photos selected.');
  setStatus(`Sending ${sel.length} photo(s) to gallery…`);
  let n = 0;
  for (let i = 0; i < sel.length; i++) {
    try {
      const blob = await (await fetch(sel[i].url)).blob();
      await Aphro.uploadPhoto(blob, photoFilename(sel[i].url, i));
      n++;
    } catch {}
  }
  setStatus(`Sent ${n}/${sel.length} photo(s) to gallery.`);
});

// ── scraped links (legacy) ───────────────────────────────────────────
function buildFilterRegex() {
  const pattern = $('filter').value.trim();
  if (!pattern) return null;
  try { return new RegExp(pattern, 'i'); } catch { return null; }
}

async function getFilteredUrls() {
  const links = await send({ type: 'GET_LINKS' });
  const re = buildFilterRegex();
  return Object.values(links).filter(l => !re || re.test(l.url)).sort((a, b) => b.ts - a.ts);
}

async function refreshLinks() {
  const filtered = await getFilteredUrls();
  $('count').textContent = filtered.length;
  const listEl = $('links');
  listEl.innerHTML = '';
  for (const l of filtered) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.className = 'url';
    span.textContent = l.url;
    span.title = l.text ? `${l.text}\n${l.url}` : l.url;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', async () => { await send({ type: 'REMOVE_LINK', url: l.url }); refreshLinks(); });
    li.appendChild(span);
    li.appendChild(removeBtn);
    listEl.appendChild(li);
  }
}

$('scrapeBtn').addEventListener('click', async () => {
  const btn = $('scrapeBtn');
  btn.disabled = true; btn.textContent = 'Scraping…';
  try { await send({ type: 'SCRAPE_TAB' }); }
  catch (err) {
    btn.textContent = err.message || 'Failed';
    setTimeout(() => { btn.textContent = 'Scrape Current Page'; btn.disabled = false; }, 1500);
    return;
  }
  btn.disabled = false; btn.textContent = 'Scrape Current Page';
  refreshLinks();
});

$('copyBtn').addEventListener('click', async () => {
  const filtered = await getFilteredUrls();
  await navigator.clipboard.writeText(filtered.map(l => l.url).join('\n'));
  setStatus('Copied to clipboard.');
});

$('exportBtn').addEventListener('click', async () => {
  const filtered = await getFilteredUrls();
  const blob = new Blob([filtered.map(l => l.url).join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  await browser.downloads.download({ url, filename: 'scraped-links.txt', saveAs: true });
});

$('sendLinksBtn').addEventListener('click', async () => {
  const filtered = await getFilteredUrls();
  if (!filtered.length) return setStatus('No links to send.');
  try {
    const r = await Aphro.importLinks(filtered.map(l => l.url));
    setStatus(`Sent ${r.added ?? filtered.length} link(s) to AphroArchive.`);
  } catch (e) { setStatus('Error: ' + e.message); }
});

$('clearBtn').addEventListener('click', async () => {
  if (!confirm('Clear all scraped links?')) return;
  await send({ type: 'CLEAR_LINKS' });
  refreshLinks();
});

$('filter').addEventListener('input', refreshLinks);

for (const radio of document.querySelectorAll('input[name="mode"]')) {
  radio.addEventListener('change', (e) => send({ type: 'SET_MODE', mode: e.target.value }));
}

// ── queue ────────────────────────────────────────────────────────────
async function loadJobs() {
  if (!online) return;
  try {
    const jobs = await Aphro.getJobs();
    $('jobCount').textContent = jobs.length;
    const box = $('jobs');
    box.innerHTML = '';
    if (!jobs.length) { box.innerHTML = '<div class="empty">Queue is empty.</div>'; return; }
    for (const j of jobs.slice().reverse()) {
      const row = document.createElement('div');
      row.className = 'media-row';
      const main = document.createElement('div');
      main.className = 'media-main';
      const t = document.createElement('div');
      t.className = 'media-title';
      t.textContent = j.title || j.url;
      const s = document.createElement('div');
      s.className = 'media-sub';
      const prog = j.status === 'running' ? ` ${Math.round(j.progress || 0)}% ${j.speed || ''}` : '';
      s.textContent = `${j.status}${prog}${j.error ? ' · ' + j.error : ''}`;
      main.appendChild(t); main.appendChild(s);
      row.appendChild(main);
      box.appendChild(row);
    }
  } catch { /* ignore */ }
}

$('refreshJobsBtn').addEventListener('click', loadJobs);

// ── collapsible sections ─────────────────────────────────────────────
for (const head of document.querySelectorAll('.sec-head')) {
  head.addEventListener('click', () => {
    const sec = head.parentElement;
    const open = sec.getAttribute('data-open') === '1';
    sec.setAttribute('data-open', open ? '0' : '1');
    sec.querySelector('.caret').textContent = open ? '▸' : '▾';
    if (!open && sec.classList.contains('gated-sec')) loadJobs();
  });
}

$('optionsLink').addEventListener('click', (e) => { e.preventDefault(); browser.runtime.openOptionsPage(); });

// server URL edits
serverUrlInput.addEventListener('change', async () => {
  settings.serverUrl = serverUrlInput.value.trim();
  await send({ type: 'SET_SETTINGS', settings: { serverUrl: settings.serverUrl } });
  refreshServer();
});
$('testBtn').addEventListener('click', refreshServer);

// react to background-pushed link/storage changes
browser.storage.onChanged.addListener((changes) => { if (changes.scrapedLinks) refreshLinks(); });

// ── init ─────────────────────────────────────────────────────────────
(async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab) activeTab = { id: tab.id, url: tab.url, title: tab.title };

  settings = await send({ type: 'GET_SETTINGS' });
  const mode = await send({ type: 'GET_MODE' });
  for (const radio of document.querySelectorAll('input[name="mode"]')) radio.checked = radio.value === mode;
  serverUrlInput.value = settings.serverUrl || 'http://localhost:3000';
  if (settings.defaultFilter) $('filter').value = settings.defaultFilter;

  await loadDetected();
  refreshLinks();
  await refreshServer();
  loadJobs();
})();
