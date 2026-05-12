import { useEffect } from 'preact/hooks';
import { videos, loadVideos, loadCategories, loadPrefs, currentView, presetPickerState } from './store';
import { PresetPicker } from './components/PresetPicker';

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
      <div style={{ 
        padding: '20px', 
        textAlign: 'center',
        background: 'rgba(0,0,0,0.8)',
        color: '#fff',
        borderTop: '2px solid var(--ac)',
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 99999
      }}>
        <h3>AphroArchive Preact Dashboard</h3>
        <p>View: {currentView.value} | Loaded Videos: {videos.value.length}</p>
        <button onClick={() => loadVideos()} style={{ background: 'var(--ac)', border: 'none', color: '#fff', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer' }}>
          Refresh Data
        </button>
      </div>
      <PresetPicker />
    </>
  );
}
