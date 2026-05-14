import { Search } from './Search';
import { currentView, isMuted, profiles, activeProfile, loadProfiles, switchProfile, profileModalState, isSidebarOpen } from '../../store';
import { useEffect } from 'preact/hooks';

export const Topbar = () => {
  const view = currentView.value;
  
  useEffect(() => {
    loadProfiles();
  }, []);

  if (view === 'instagram' || view === 'reddit') return null;

  const showHome = () => {
    currentView.value = 'hub';
  };

  const openImport = () => {
    if ((window as any).openImport) (window as any).openImport();
  };

  const toggleDual = () => {
    if ((window as any).toggleDual) (window as any).toggleDual();
  };

  const toggleMosaic = () => {
    if ((window as any).toggleMosaic) (window as any).toggleMosaic();
  };

  const toggleZapping = () => {
    if ((window as any).toggleZapping) (window as any).toggleZapping();
  };

  const togglePan = () => {
    if ((window as any).togglePan) (window as any).togglePan();
  };

  const handleGlobalFiles = (files: FileList | null) => {
    if (files && (window as any).handleGlobalFiles) {
      (window as any).handleGlobalFiles(files);
    }
  };

  return (
    <div className="topbar">
      <button className="burger-btn" onClick={() => isSidebarOpen.value = !isSidebarOpen.value} title="Toggle Sidebar">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
      <div className="logo" onClick={showHome} style={{ cursor: 'pointer' }}>
        <svg viewBox="0 0 28 28" fill="none" width="28" height="28">
          <rect width="28" height="28" rx="6" fill="#e84040" />
          <polygon points="11,7 11,21 22,14" fill="#fff" />
        </svg>
        AphroArchive
      </div>
      
      <div className="search-w">
        <Search />
      </div>

      <div className="tb-acts">
        <button 
          onClick={() => profileModalState.value = { visible: true }} 
          title="Switch Profile"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </button>

        <button id="importBtn" onClick={openImport} title="Import files" className="hsm">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </button>
        
        <button id="dualBtn" onClick={toggleDual} title="Dual mode">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="3" width="9" height="18" rx="1" />
            <rect x="13" y="3" width="9" height="18" rx="1" />
          </svg>
        </button>

        {['browse', 'player', 'home'].includes(view) && (
          <button id="mosBtn" onClick={toggleMosaic} title="Mosaic mode">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </button>
        )}

        <button id="zapBtn" onClick={toggleZapping} title="Zapping mode">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        </button>

        <button id="panBtn" onClick={togglePan} title="Panoramic mode">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </button>

        <button id="igBtn" onClick={() => currentView.value = 'instagram'} title="Instagram mode">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
            <circle cx="12" cy="12" r="4" />
            <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
          </svg>
        </button>

        <button id="rdBtn" onClick={() => currentView.value = 'reddit'} title="Reddit mode">
          <svg width="15" height="15" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="12" fill="#ff4500" />
            <ellipse cx="12" cy="15" rx="7" ry="4.5" fill="#fff" />
            <circle cx="9.5" cy="14.5" r="1.2" fill="#ff4500" />
            <circle cx="14.5" cy="14.5" r="1.2" fill="#ff4500" />
            <path d="M10 17.5 Q12 19 14 17.5" stroke="#ff4500" strokeWidth="1" strokeLinecap="round" fill="none" />
          </svg>
        </button>

        <button id="muteBtn" onClick={() => isMuted.value = !isMuted.value} title={isMuted.value ? "Unmute" : "Mute"} class={isMuted.value ? "on" : ""}>
          {isMuted.value ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 5L6 9H2v6h4l5 4V5z" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 5L6 9H2v6h4l5 4V5z" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.08" />
            </svg>
          )}
        </button>

        <input 
          type="file" 
          id="globalFileIn" 
          multiple
          accept="video/*,audio/*,.pdf,.txt,.doc,.docx,.md,.epub,.mp3,.flac,.wav,.ogg,.aac,.m4a,.wma,.opus,.aiff"
          style={{ display: 'none' }} 
          onChange={(e) => handleGlobalFiles((e.target as HTMLInputElement).files)}
        />
      </div>
    </div>
  );
};
