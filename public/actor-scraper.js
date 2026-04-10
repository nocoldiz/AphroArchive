// ─── Actor Scraper Module ─────────────────────────────────────────
const ActorScraper = (() => {
  let actors = [];
  const scraping = new Set();

  // ── Helpers ──────────────────────────────────────────────────────
  function eh(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function ea(s) { return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }
  function rowId(name) { return 'scr-' + name.replace(/[^a-zA-Z0-9]/g, '_'); }
  function photoSrc(name) { return '/api/actor-photos/' + encodeURIComponent(name) + '/img'; }

  // ── Render ───────────────────────────────────────────────────────
  function renderRow(a) {
    const busy = scraping.has(a.name);
    return `<div class="scr-row" id="${rowId(a.name)}">
      <div class="scr-photo">
        ${a.hasPhoto
          ? `<img src="${photoSrc(a.name)}" alt="${eh(a.name)}" class="scr-img">`
          : `<div class="scr-avatar"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg></div>`
        }
      </div>
      <div class="scr-name">${eh(a.name)}</div>
      <div class="scr-status ${a.hasPhoto ? 'scr-ok' : 'scr-miss'}">${a.hasPhoto ? '✓ Cached' : '✗ Missing'}</div>
      <button class="scr-btn" onclick="ActorScraper.scrape('${ea(a.name)}')" ${busy ? 'disabled' : ''}>
        ${busy ? '<span class="scr-spin">↻</span> Scraping…' : (a.hasPhoto ? 'Refresh' : 'Scrape')}
      </button>
    </div>`;
  }

  function render() {
    const grid = document.getElementById('scraperGrid');
    if (!actors.length) {
      grid.innerHTML = '<div class="es" style="padding:40px 20px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg><h3>No actors found</h3><p>Add actor names to actors.txt — one per line</p></div>';
      document.getElementById('scraperScrapeAll').style.display = 'none';
      return;
    }
    const missing = actors.filter(a => !a.hasPhoto).length;
    document.getElementById('scraperInfo').textContent =
      actors.length + ' actor' + (actors.length !== 1 ? 's' : '') +
      (missing ? ' · ' + missing + ' missing photo' + (missing !== 1 ? 's' : '') : ' · all photos cached');
    const btn = document.getElementById('scraperScrapeAll');
    btn.style.display = '';
    btn.textContent = missing ? 'Scrape All Missing (' + missing + ')' : 'Refresh All';
    grid.innerHTML = actors.map(renderRow).join('');
  }

  function refreshRow(name) {
    const a = actors.find(a => a.name === name);
    if (!a) return;
    const el = document.getElementById(rowId(name));
    if (el) el.outerHTML = renderRow(a);
  }

  // ── API ──────────────────────────────────────────────────────────
  async function load() {
    document.getElementById('scraperGrid').innerHTML = '<div class="dup-scan">Loading actors…</div>';
    const res = await fetch('/api/actor-photos');
    actors = await res.json();
    render();
  }

  async function scrape(name) {
    if (scraping.has(name)) return;
    scraping.add(name);
    refreshRow(name);
    try {
      const res = await fetch('/api/actor-photos/' + encodeURIComponent(name) + '/scrape', { method: 'POST' });
      const d = await res.json();
      if (d.ok) {
        const a = actors.find(a => a.name === name);
        if (a) a.hasPhoto = true;
        if (typeof toast === 'function') toast('Photo saved for ' + name);
      } else {
        if (typeof toast === 'function') toast('Failed for ' + name + ': ' + (d.error || 'Unknown error'));
      }
    } catch (e) {
      if (typeof toast === 'function') toast('Error: ' + e.message);
    }
    scraping.delete(name);
    refreshRow(name);
    // Update header info
    const missing = actors.filter(a => !a.hasPhoto).length;
    const info = document.getElementById('scraperInfo');
    if (info) info.textContent =
      actors.length + ' actor' + (actors.length !== 1 ? 's' : '') +
      (missing ? ' · ' + missing + ' missing photo' + (missing !== 1 ? 's' : '') : ' · all photos cached');
    const btn = document.getElementById('scraperScrapeAll');
    if (btn) btn.textContent = missing ? 'Scrape All Missing (' + missing + ')' : 'Refresh All';
  }

  async function scrapeAll() {
    const targets = actors.filter(a => !a.hasPhoto && !scraping.has(a.name));
    if (!targets.length) { if (typeof toast === 'function') toast('Nothing to scrape'); return; }
    if (typeof toast === 'function') toast('Scraping ' + targets.length + ' actor' + (targets.length !== 1 ? 's' : '') + '…');
    for (const a of targets) {
      await scrape(a.name);
      await new Promise(r => setTimeout(r, 600)); // polite rate limit
    }
  }

  // ── Public API ───────────────────────────────────────────────────
  return { load, scrape, scrapeAll };
})();
