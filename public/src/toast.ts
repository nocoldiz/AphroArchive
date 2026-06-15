// Global toast — the whole app calls window.toast(msg) but nothing ever
// registered it after the legacy bundle was removed, so every toast was
// silently dropped. Single element, reused across calls.
let toastEl: HTMLDivElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

type ToastType = 'info' | 'error' | 'success';
interface ToastOpts { duration?: number; type?: ToastType }

// Errors should linger so they can actually be read; info/success are brief.
const DEFAULT_DURATION: Record<ToastType, number> = {
  info: 2200,
  success: 2200,
  error: 5000,
};

export function toast(msg: string, opts?: number | ToastOpts) {
  if (typeof document === 'undefined') return;
  // Backwards-compatible: a bare number is still treated as a duration.
  const o: ToastOpts = typeof opts === 'number' ? { duration: opts } : (opts || {});
  const type = o.type || 'info';
  const duration = o.duration ?? DEFAULT_DURATION[type];

  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.remove('toast--error', 'toast--success');
  if (type === 'error') toastEl.classList.add('toast--error');
  else if (type === 'success') toastEl.classList.add('toast--success');
  // Force a reflow so re-triggering while visible restarts the transition
  toastEl.classList.remove('show');
  void toastEl.offsetWidth;
  toastEl.classList.add('show');
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => toastEl?.classList.remove('show'), duration);
}

// Convenience wrapper for failures with actionable guidance.
export function toastError(msg: string, duration?: number) {
  toast(msg, { type: 'error', duration });
}

if (typeof window !== 'undefined') {
  (window as any).toast = toast;
  (window as any).toastError = toastError;
}
