import { useEffect, useState } from 'preact/hooks';
import { effect } from '@preact/signals';
import { videos, loadVideos, loadPrefs, currentView, presetPickerState, sortMode, isShuffle, showConnectModal, isVaultUnlocked, folders, appReady, serverConnected } from './store';
import { PresetPicker } from './components/modals/PresetPicker';
import { OnboardingWizard } from './components/modals/OnboardingWizard';
import { ConnectModal } from './components/modals/ConnectModal';
import { DropOverlay } from './components/UI/DropOverlay';

export function App() {
  const [connLost, setConnLost] = useState(false);

  // Connection-lost detection: derived from the standing scan SSE stream
  // (server sends a heartbeat every 25s). This replaces the old /api/ping
  // 5-second polling loop — one standing connection instead of a poll churn
  // competing with media streams for the browser's per-origin socket pool.
  useEffect(() => {
    let panicFired = false;
    // If panic fires, the tab is closing — suppress the lost-connection banner
    const onBeforeUnload = () => { panicFired = true; };
    window.addEventListener('beforeunload', onBeforeUnload);

    const dispose = effect(() => {
      const up = serverConnected.value;
      if (panicFired) return;
      setConnLost(!up);
    });

    return () => {
      dispose();
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  useEffect(() => {
    // Show the shell immediately: skeletons handle every in-flight state, so
    // first paint must not wait on any network round-trip.
    appReady.value = true;

    // Non-critical startup work is pushed off the critical path so it doesn't
    // compete with /api/preload + /api/videos for connections or server CPU:
    //  - /api/ready triggers deferred heavy work server-side (initVideoMeta,
    //    background worker) — better started once the first paint is done.
    //  - /api/auto-sort walks the videos dir looking for loose files.
    const idle = (cb: () => void) =>
      ('requestIdleCallback' in window)
        ? (window as any).requestIdleCallback(cb, { timeout: 3000 })
        : setTimeout(cb, 3000);
    idle(() => {
      fetch('/api/ready', { method: 'POST' }).catch(() => {});
      fetch('/api/auto-sort', { method: 'POST' }).catch(() => {});
    });

    // Kick off preload immediately — fast metadata from DB
    fetch('/api/preload').then(r => r.json()).then(preload => {
      (window as any).__preloaded = preload;
      // Populate folder list immediately from DB index so sidebar shows names before full scan
      if (preload.catCounts && folders.value.length === 0) {
        const initial = Object.entries(preload.catCounts as Record<string, number>)
          .map(([p, count]) => ({ name: p.replace(/\//g, ' / '), path: p, count }))
          .sort((a, b) => {
            if (a.path === 'uncategorized') return -1;
            if (b.path === 'uncategorized') return 1;
            return a.name.localeCompare(b.name);
          });
        folders.value = initial;
      }
    }).catch(() => {});

    // Prefs (theme, cardSize, etc.) apply as they arrive; the shell is already
    // visible (appReady set above), skeletons cover the in-flight state and
    // loadVideos populates the grid when it finishes.
    loadPrefs().catch(() => {});
    loadVideos().catch(() => {});

    // Restore vault unlock state and auto-navigate if we're in the Vault profile
    fetch('/api/vault/status')
      .then(r => r.json())
      .then(s => { isVaultUnlocked.value = !!s.unlocked; })
      .catch(() => {});

    // The old PresetPicker first-run logic is replaced by OnboardingWizard
    // which is shown when no DB files exist (checked in OnboardingWizard component)

    // Load theme
    const saved = localStorage.getItem('theme') || '';
    if (saved) document.documentElement.setAttribute('data-theme', saved);

    // Also update button states if they exist
    document.querySelectorAll('.theme-btn').forEach(btn => {
      const b = btn as HTMLElement;
      b.classList.toggle('active', b.dataset.theme === saved);
    });

    // 1. Filter State Persistence
    const s = localStorage.getItem('aa_sort');
    if (s && ['date','name','size','duration'].includes(s)) {
      sortMode.value = s;
      (window as any).sort = s; // Compatibility
    }
    if (localStorage.getItem('aa_shuf') === '1') {
      isShuffle.value = true;
      (window as any).shuf = true; // Compatibility
    }

    // 2. Auto-Sort on Start — moved into the requestIdleCallback block above.

    // 3. Dummy Audio for first interaction
    const startDummyAudio = () => {
      const dummy = document.getElementById('dummy-audio') as HTMLAudioElement;
      if (dummy) dummy.play().catch(() => {});
      document.removeEventListener('click', startDummyAudio);
      document.removeEventListener('keydown', startDummyAudio);
    };
    document.addEventListener('click', startDummyAudio);
    document.addEventListener('keydown', startDummyAudio);

    // 4. Panoramic Mode startup
    if (localStorage.getItem('pan')) {
      document.body.classList.add('pan');
      const btn = document.getElementById('panBtn');
      if (btn) btn.classList.add('on');
    }

    // 5. Sidebar section collapse state
    ['library', 'browse', 'media', 'web', 'manage', 'cats', 'tags'].forEach(name => {
      if (localStorage.getItem('sc_' + name)) {
        const sec = document.getElementById(name + 'Section');
        const h = document.getElementById('sh3-' + name);
        if (sec) sec.classList.add('closed');
        if (h) h.classList.add('closed');
      }
    });
    // 6. Panic Key/Mouse listener
    const triggerPanic = () => {
      // Hide everything and stop all media immediately, then shut down the server.
      try {
        document.body.style.background = '#fff';
        document.body.style.color = '#fff';
        document.body.style.overflow = 'hidden';
        document.body.innerHTML = '';
      } catch (err) {
        console.error('Failed to hide page before panic:', err);
      }
      document.querySelectorAll('audio, video').forEach((media) => {
        try {
          (media as HTMLMediaElement).pause();
          if ((media as HTMLMediaElement).src) {
            (media as HTMLMediaElement).src = '';
          }
          media.removeAttribute('src');
          (media as HTMLMediaElement).load();
        } catch (_) {}
      });

      // Send panic to server — fire & forget
      fetch('/api/panic', { method: 'POST' }).catch(() => {});

      // Close the tab/window after a short delay
      setTimeout(() => {
        window.close();
      }, 200);
    };

    // Parse panic keys (stored as JSON array in localStorage)
    const getPanicKeys = (): string[] => {
      try {
        const keys = localStorage.getItem('panicKeys');
        return keys ? JSON.parse(keys) : [];
      } catch {
        // Fallback to single key for backward compatibility
        const single = localStorage.getItem('panicKey');
        return single ? [single] : [];
      }
    };

    // Check if event matches any panic key
    const checkPanicMatch = (e: { key?: string; code?: string; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean; button?: number }) => {
      const panicKeys = getPanicKeys();
      if (panicKeys.length === 0) return false;
      
      return panicKeys.some(panicKey => {
        const keys = panicKey.split('+');
        let match = true;
        let keyFound = false;
        
        for (const k of keys) {
          const kt = k.trim().toLowerCase();
          if (kt === 'ctrl') { if (!e.ctrlKey) match = false; }
          else if (kt === 'shift') { if (!e.shiftKey) match = false; }
          else if (kt === 'alt') { if (!e.altKey) match = false; }
          else if (kt === 'meta' || kt === 'win' || kt === 'cmd') { if (!e.metaKey) match = false; }
          else if (kt.startsWith('mouse')) {
            // e.g. "Mouse3" = middle button, "Mouse4" = back button, "Mouse5" = forward button
            keyFound = true;
            // Case-insensitive extract of button number
            const btnStr = kt.replace(/^mouse/i, '');
            const btnNum = parseInt(btnStr, 10);
            if (isNaN(btnNum) || e.button !== btnNum) match = false;
          }
          else {
            keyFound = true;
            const keyStr = (e.key || '').toLowerCase();
            const codeStr = (e.code || '').toLowerCase();
            if (keyStr !== kt && codeStr !== kt) match = false;
          }
        }
        // Must find at least one actual key/mouse in the string
        if (!keyFound) return false;
        return match;
      });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger panic when user is typing in an input/textarea/contenteditable
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return;
      // Don't trigger while the panic-capture input is focused (user is setting a new key)
      if (document.activeElement?.id === 'panic-key-capture') return;
      if (checkPanicMatch(e)) {
        e.preventDefault();
        e.stopPropagation();
        triggerPanic();
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      // Check if any stored panic key is a mouse button
      const panicKeys = getPanicKeys();
      const hasMouse = panicKeys.some(k => k.toLowerCase().startsWith('mouse'));
      if (!hasMouse) return;
      if (checkPanicMatch(e)) {
        e.preventDefault();
        e.stopPropagation();
        triggerPanic();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);

  return (
    <>
      <OnboardingWizard />
      <PresetPicker />
      {showConnectModal.value && <ConnectModal onClose={() => showConnectModal.value = false} />}
      <DropOverlay />
      {!appReady.value && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 99998,
          background: 'var(--bg, #0d0d0d)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: '20px',
          transition: 'opacity 0.3s',
        }}>
          <svg width="44" height="44" viewBox="0 0 44 44" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
            <circle cx="22" cy="22" r="18" stroke="var(--ac, #e040fb)" strokeWidth="3" strokeDasharray="80 30" strokeLinecap="round" />
          </svg>
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8rem', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Loading</div>
        </div>
      )}

      {connLost && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 99999,
          background: 'rgba(0,0,0,0.82)', display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: '16px', backdropFilter: 'blur(6px)',
        }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#e84040" strokeWidth="1.5">
            <path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.56 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>
          </svg>
          <div style={{ color: '#fff', fontSize: '1.2rem', fontWeight: 700 }}>Connection lost</div>
          <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.85rem' }}>The server stopped responding. Reconnecting…</div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ marginTop: '8px', background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '6px', padding: '9px 22px', fontSize: '14px', cursor: 'pointer', fontWeight: 600 }}
          >
            Reload
          </button>
        </div>
      )}
    </>
  );
}
