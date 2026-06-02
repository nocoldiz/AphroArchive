import { useEffect } from 'preact/hooks';
import { videos, loadVideos, loadCategories, loadPrefs, currentView, presetPickerState, sortMode, isShuffle, showConnectModal } from './store';
import { PresetPicker } from './components/modals/PresetPicker';
import { ProfileModal } from './components/modals/ProfileModal';
import { ConnectModal } from './components/modals/ConnectModal';
import { DropOverlay } from './components/UI/DropOverlay';

export function App() {
  useEffect(() => {
    loadVideos();
    loadCategories();
    loadPrefs();
    
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

    // 2. Auto-Sort on Start
    fetch('/api/auto-sort', { method: 'POST' }).catch(() => {});

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

    // Check if preset picker is needed on startup
    fetch('/api/presets')
      .then(r => {
        if (!r.ok) {
          throw new Error(`HTTP error! status: ${r.status}`);
        }
        return r.text(); // Read as plain text first
      })
      .then(text => {
        try {
          const data = JSON.parse(text); // Parse JSON manually
          if (data.needed) {
            presetPickerState.value = { visible: true, mergeMode: false };
          }
        } catch (e) {
          console.error('Invalid JSON response:', text); // Log raw response
          throw e; // Re-throw the error for debugging
        }
      })
      .catch(e => console.error('Failed to check presets', e));
    // 6. Panic Key/Mouse listener
    const triggerPanic = () => {
      // Send panic to server — fire & forget
      fetch('/api/panic', { method: 'POST' }).catch(() => {});
      // Close the tab/window
      setTimeout(() => {
        window.close();
        // Fallback if window.close() is blocked (most browsers)
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

      <PresetPicker />
      <ProfileModal />
      {showConnectModal.value && <ConnectModal onClose={() => showConnectModal.value = false} />}
      <DropOverlay />
    </>
  );
}
