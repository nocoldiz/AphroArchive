/**
 * Video Multiselect Selection Logic
 * Adapted from vault.js
 */

let isVideoDragging = false;
let vDragStartX, vDragStartY;


function initVideoShiftSelection() {
  if (window._videoShiftInitialized) return;
  window._videoShiftInitialized = true;

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') shiftKeyPressed = true;
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') shiftKeyPressed = false;
  });

  // Shift + hover: selecting multiple videos by sweeping over them
  document.addEventListener('mouseover', (e) => {
    if (!shiftKeyPressed) return;
    const card = e.target.closest('.video-card');
    if (!card) return;
    const id = card.dataset.id;
    if (!id || videoSel.has(id)) return;
    
    toggleVideoSel(id, true);
  });
}

function setupVideoDragSelection() {
  const grid = document.getElementById('video-grid');
  const box = document.getElementById('videoDragBox');
  if (!grid || !box) return;

  grid.addEventListener('mousedown', (e) => {
    // Only start drag selection if Shift is held or we are already in selection mode
    // and we clicked on the grid background (or we can allow starting on cards too)
    if (!e.shiftKey && !videoSelMode) return;
    if (e.button !== 0) return; // Only left click

    // If clicking a button or specific action inside a card, don't start drag
    if (e.target.closest('button') || e.target.closest('.card-actions')) return;

    e.preventDefault();
    isVideoDragging = true;
    vDragStartX = e.clientX;
    vDragStartY = e.clientY;

    box.style.display = 'block';
    box.style.width = '0px';
    box.style.height = '0px';
    box.style.left = vDragStartX + 'px';
    box.style.top = vDragStartY + 'px';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isVideoDragging) return;

    const x = Math.min(e.clientX, vDragStartX);
    const y = Math.min(e.clientY, vDragStartY);
    const w = Math.abs(e.clientX - vDragStartX);
    const h = Math.abs(e.clientY - vDragStartY);

    box.style.left = x + 'px';
    box.style.top = y + 'px';
    box.style.width = w + 'px';
    box.style.height = h + 'px';

    const boxRect = box.getBoundingClientRect();
    document.querySelectorAll('.video-card').forEach(card => {
      const cardRect = card.getBoundingClientRect();
      const match = !(boxRect.right < cardRect.left || boxRect.left > cardRect.right || 
                     boxRect.bottom < cardRect.top || boxRect.top > cardRect.bottom);
      
      const id = card.dataset.id;
      if (match) {
        if (!videoSel.has(id)) {
          toggleVideoSel(id, true);
        }
      }
    });
  });

  window.addEventListener('mouseup', () => {
    if (!isVideoDragging) return;
    isVideoDragging = false;
    box.style.display = 'none';
  });
}

function toggleVideoSel(id, forceSelect = false) {
  const card = document.querySelector(`.video-card[data-id="${id}"]`);
  
  if (forceSelect) {
    videoSel.add(id);
  } else {
    if (videoSel.has(id)) videoSel.delete(id);
    else videoSel.add(id);
  }

  if (videoSel.has(id)) {
    if (card) card.classList.add('selected');
  } else {
    if (card) card.classList.remove('selected');
  }

  videoSelMode = videoSel.size > 0;
  updateVideoSelBar();
}

function clearVideoSelection() {
  document.querySelectorAll('.video-card.selected').forEach(el => el.classList.remove('selected'));
  videoSel.clear();
  videoSelMode = false;
  updateVideoSelBar();
}

function updateVideoSelBar() {
  const bar = document.getElementById('videoSelBar');
  const count = document.getElementById('videoSelCount');
  if (!bar || !count) return;

  if (videoSel.size > 0) {
    bar.style.display = 'flex';
    count.textContent = `${videoSel.size} video${videoSel.size !== 1 ? 's' : ''} selected`;
  } else {
    bar.style.display = 'none';
  }
}

// ─── Bulk Operations ───

function showVideoSelMoveMenu(e) {
  e.stopPropagation();
  // Reuse the existing move menu logic but for multiple IDs
  // I need to see how openMov works in rename-move.js
  const rect = e.currentTarget.getBoundingClientRect();
  
  // We can't use openMov directly because it's for one video.
  // We'll create a custom bulk move menu or adapt the existing one.
  
  // For now, let's just trigger a custom event or call a function in rename-move.js
  if (typeof openBulkMove === 'function') {
    openBulkMove([...videoSel], rect);
  } else {
    toast('Bulk move not yet implemented');
  }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  initVideoShiftSelection();
  setupVideoDragSelection();
});
