import { useEffect } from 'preact/hooks';
import { videos, loadVideos, loadCategories, loadPrefs, currentView, presetPickerState, sortMode, isShuffle } from './store';
import { PresetPicker } from './components/modals/PresetPicker';
import { ProfileModal } from './components/modals/ProfileModal';
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
  }, []);

  return (
    <>

      <PresetPicker />
      <ProfileModal />
      <DropOverlay />
    </>
  );
}
