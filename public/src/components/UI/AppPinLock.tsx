import { useEffect, useState } from 'preact/hooks';
import { appPinLocked, verifyAppPin, getAppPinInactivityMin, getAppPinLen } from '../../store';

// Full-screen gate shown over the whole library when the app PIN lock is
// engaged (on startup, and again after N minutes of inactivity). Separate from
// the vault password — see store.ts for the storage/hashing rationale.
export function AppPinLock() {
  const locked = appPinLocked.value;
  const [entry, setEntry] = useState('');
  const [error, setError] = useState(false);

  // Inactivity auto-lock. Re-armed whenever `locked` flips so the countdown
  // restarts after each unlock. No-op when inactivity is 0 (startup-only lock).
  useEffect(() => {
    const mins = getAppPinInactivityMin();
    if (!mins || locked) return;
    let timer: number | undefined;
    const reset = () => {
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(() => { appPinLocked.value = true; }, mins * 60000);
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      if (timer) clearTimeout(timer);
      events.forEach(e => window.removeEventListener(e, reset));
    };
  }, [locked]);

  // On lock: pause any playing media and clear stale entry.
  useEffect(() => {
    if (!locked) return;
    document.querySelectorAll('audio, video').forEach(m => {
      try { (m as HTMLMediaElement).pause(); } catch { /* ignore */ }
    });
    setEntry('');
    setError(false);
  }, [locked]);

  const submit = (pin: string) => {
    if (verifyAppPin(pin)) {
      appPinLocked.value = false;
      setEntry('');
      setError(false);
    } else {
      setError(true);
      setEntry('');
    }
  };

  const press = (digit: string) => {
    setError(false);
    setEntry(prev => {
      const next = (prev + digit).slice(0, 12);
      const expected = getAppPinLen();
      // Auto-submit at the known length for the familiar phone-unlock feel.
      if (expected && next.length === expected) setTimeout(() => submit(next), 60);
      return next;
    });
  };

  const backspace = () => { setError(false); setEntry(prev => prev.slice(0, -1)); };

  // Physical keyboard support (digits / backspace / enter). Capture phase so it
  // wins over any app-level shortcuts while the gate is up.
  useEffect(() => {
    if (!locked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') { e.preventDefault(); press(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); backspace(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (entry) submit(entry); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [locked, entry]);

  if (!locked) return null;

  const expected = getAppPinLen();
  const dotCount = expected || Math.max(entry.length, 4);
  const dots = Array.from({ length: dotCount }, (_, i) => i < entry.length);
  const keypad = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100000,
      background: 'var(--bg, #0d0d0d)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: '28px',
      userSelect: 'none',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
        <i className="icon-lock" style={{ fontSize: '2rem', color: 'var(--ac, #e040fb)' }} />
        <div style={{ color: 'var(--tx, #fff)', fontSize: '1.05rem', fontWeight: 700, letterSpacing: '0.02em' }}>
          Enter PIN
        </div>
      </div>

      {/* Entered-digit indicator */}
      <div style={{ display: 'flex', gap: '14px', minHeight: '16px', animation: error ? 'pinShake 0.4s' : undefined }}>
        {dots.map((filled, i) => (
          <span key={i} style={{
            width: '14px', height: '14px', borderRadius: '50%',
            background: filled ? (error ? '#e84040' : 'var(--ac, #e040fb)') : 'transparent',
            border: `2px solid ${error ? '#e84040' : filled ? 'var(--ac, #e040fb)' : 'var(--tx3, #666)'}`,
            transition: 'background 0.1s, border-color 0.1s',
          }} />
        ))}
      </div>

      {error && (
        <div style={{ color: '#e84040', fontSize: '0.82rem', marginTop: '-14px' }}>Incorrect PIN</div>
      )}

      {/* Number pad */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 72px)', gap: '14px' }}>
        {keypad.map((k, i) => {
          if (k === '') return <span key={i} />;
          const isBack = k === '⌫';
          return (
            <button
              key={i}
              type="button"
              onClick={() => (isBack ? backspace() : press(k))}
              style={{
                width: '72px', height: '72px', borderRadius: '50%',
                border: '1px solid var(--brd, #333)',
                background: 'var(--bg3, #1c1c1c)',
                color: 'var(--tx, #fff)',
                fontSize: isBack ? '1.3rem' : '1.6rem', fontWeight: 500,
                cursor: 'pointer', transition: 'background 0.1s',
              }}
              onMouseDown={e => (e.currentTarget.style.background = 'var(--ac, #e040fb)')}
              onMouseUp={e => (e.currentTarget.style.background = 'var(--bg3, #1c1c1c)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg3, #1c1c1c)')}
            >
              {k}
            </button>
          );
        })}
      </div>

      {!expected && (
        <button
          type="button"
          class="modal-btn modal-btn--primary"
          onClick={() => entry && submit(entry)}
          style={{ minWidth: '120px' }}
        >
          Unlock
        </button>
      )}

      <style>{`@keyframes pinShake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}`}</style>
    </div>
  );
}
