import { couchMode, selectedVideoIds } from './store';

// ─── Couch mode keyboard harness (10-foot / TV UI) ────────────────────
// The video grid already moves focus between cards on arrow keys once a card
// is focused (see VideoGrid's onKey). Couch mode adds the two pieces a
// remote-only experience still needs:
//   1. Seed focus — the very first arrow press lands on the first card so the
//      user never has to reach for a mouse to "get in" to the grid.
//   2. Back — Backspace (and Escape) steps back through navigation history,
//      the way a remote's Back button does, so you can leave a video or a
//      folder without a pointer.
// It runs in the CAPTURE phase so seeding happens before the grid's own
// (bubble-phase) handler; when a card is already focused we bow out and let
// the grid drive the move.

const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t || !t.tagName) return false;
  const tag = t.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable === true;
}

function focusableCards(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('.video-grid .video-card, .video-list-view .video-list-row')
  );
}

function onKey(e: KeyboardEvent) {
  if (!couchMode.value) return;
  if (e.altKey || e.ctrlKey || e.metaKey) return; // leave shortcuts alone
  if (isTyping(e.target)) return;

  // ── Back ────────────────────────────────────────────────────────────
  if (e.key === 'Backspace' || e.key === 'Escape') {
    // Escape has prior claims: exiting fullscreen and clearing an active
    // multi-selection. Defer to those; only treat it as Back otherwise.
    if (e.key === 'Escape') {
      if (document.fullscreenElement) return;
      if (selectedVideoIds.value.size > 0) return;
      // Let open modals/dialogs/lightboxes handle their own Escape close.
      if (document.querySelector('.modal.on, .modal-overlay.on, .ph-lightbox.on')) return;
    }
    e.preventDefault();
    e.stopPropagation();
    window.history.back();
    return;
  }

  // ── Seed focus ──────────────────────────────────────────────────────
  if (ARROWS.includes(e.key)) {
    const active = document.activeElement as HTMLElement | null;
    const onCard = !!active &&
      (active.classList.contains('video-card') || active.classList.contains('video-list-row'));
    if (onCard) return; // grid's own handler takes it from here

    // Don't seed while a card-less interactive view (player, settings) is up —
    // only the browsing grids benefit, and only when they actually rendered.
    const cards = focusableCards();
    if (!cards.length) return;

    e.preventDefault();
    e.stopPropagation(); // suppress the grid's bubble handler for this same press
    cards[0].focus();
    cards[0].scrollIntoView({ block: 'nearest' });
  }
}

export function initCouchMode() {
  window.addEventListener('keydown', onKey, true);
}
