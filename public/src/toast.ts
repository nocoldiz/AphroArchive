// Global toast — the whole app calls window.toast(msg) but nothing ever
// registered it after the legacy bundle was removed, so every toast was
// silently dropped. Single element, reused across calls.
let toastEl: HTMLDivElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function toast(msg: string, duration = 2200) {
  if (typeof document === 'undefined') return;
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  // Force a reflow so re-triggering while visible restarts the transition
  toastEl.classList.remove('show');
  void toastEl.offsetWidth;
  toastEl.classList.add('show');
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => toastEl?.classList.remove('show'), duration);
}

if (typeof window !== 'undefined') {
  (window as any).toast = toast;
}
