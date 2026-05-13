import { useEffect } from 'preact/hooks';
import { videos, loadVideos, loadCategories, loadPrefs, currentView, presetPickerState } from './store';
import { PresetPicker } from './components/modals/PresetPicker';
import { DropOverlay } from './components/UI/DropOverlay';

export function App() {
  useEffect(() => {
    loadVideos();
    loadCategories();
    loadPrefs();
    
    // Check if preset picker is needed on startup
    fetch('/api/presets')
      .then(r => r.json())
      .then(data => {
        if (data.needed) {
          presetPickerState.value = { visible: true, mergeMode: false };
        }
      })
      .catch(e => console.error('Failed to check presets', e));
  }, []);

  return (
    <>

      <PresetPicker />
      <DropOverlay />
    </>
  );
}
