import { useEffect, useRef } from 'preact/hooks';

// Calls `onEscape` when Escape is pressed while `active`. Always invokes the
// latest handler, so callers can pass inline closures. Call before any early
// return so the hook order stays stable.
export const useEscape = (active: boolean, onEscape: () => void) => {
  const ref = useRef(onEscape);
  ref.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') ref.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
};
