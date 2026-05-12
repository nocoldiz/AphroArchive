// ─── Thumbnails View (Legacy) ───
async function showThumbnails(skipNav = false) {
  if (!skipNav) {
    closeAllViews();
    document.getElementById('thumbnails-sidebar')?.classList.add('on');
    document.getElementById('thumbnails-view')?.classList.add('on');
  }

  const view = document.getElementById('thumbnails-view');
  if (!view) return;

  const grid = document.getElementById('thumbnails-grid');
  grid.innerHTML = '<div class="loading">Loading thumbnails...</div>';

  if (!skipNav) {
    view.scrollIntoView({ behavior: 'smooth' });
  }

  try {
    const res = await fetch('/api/thumbnails');
    const data = await res.json();
    
    if (!data || data.length === 0) {
      grid.innerHTML = '<div class="empty-state"><h3>No thumbnails found</h3><p>Generate some by browsing your library.</p></div>';
      return;
    }

    grid.innerHTML = data.map(group => `
      <div class="thumb-group" style="background:var(--bg2); border-radius:10px; overflow:hidden; border:1px solid var(--brd); display:flex; flex-direction:column">
        <div style="padding:8px 12px; font-size:0.75rem; color:var(--tx3); border-bottom:1px solid var(--brd); overflow:hidden; text-overflow:ellipsis; white-space:nowrap">
          ${group.id}
        </div>
        <div style="display:grid; grid-template-columns:repeat(5, 1fr); gap:1px; padding:1px; background:var(--brd)">
          ${group.thumbs.map(t => `<img src="${t}" style="width:100%; aspect-ratio:16/9; object-fit:cover" loading="lazy">`).join('')}
        </div>
      </div>
    `).join('');
  } catch (e) {
    grid.innerHTML = `<div class="error">Failed to load: ${e.message}</div>`;
  }
}
