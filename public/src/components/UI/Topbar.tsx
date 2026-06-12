import { Search } from './Search';
import { DownloadManager } from './DownloadManager';
import { SyncManager } from './SyncManager';
import { currentView, isMuted, profiles, activeProfile, loadProfiles, switchProfile, profileModalState, isSidebarOpen, importModalState, isVaultUnlocked, vaultGlobalView } from '../../store';
import { zapOn, toggleZapping as _toggleZapping } from '../../zap';
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
    importModalState.value = { visible: true };
  };

  const toggleDual = () => {
    if ((window as any).toggleDual) (window as any).toggleDual();
  };

  const toggleMosaic = () => {
    if ((window as any).toggleMosaic) (window as any).toggleMosaic();
  };

  const toggleZapping = () => _toggleZapping();

  const togglePan = () => {
    if ((window as any).togglePan) (window as any).togglePan();
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
        <span className="logo-text">AphroArchive</span>
      </div>
      
      <div className="search-w">
        <Search />
      </div>

      {view === 'vault' && isVaultUnlocked.value && (
        <div
          className="vault-scope-toggle"
          style={{ display: 'flex', alignItems: 'center', gap: '6px', marginRight: '10px', background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '16px', padding: '3px' }}
          title="Vault-Only shows encrypted files; Global shows every file from all profiles and lets you import them into the Vault"
        >
          <button
            onClick={() => vaultGlobalView.value = false}
            style={{
              border: 'none', borderRadius: '13px', padding: '4px 12px', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600,
              background: !vaultGlobalView.value ? 'var(--ac)' : 'transparent',
              color: !vaultGlobalView.value ? '#fff' : 'var(--tx2)'
            }}
          >
            🔒 Vault Only
          </button>
          <button
            onClick={() => vaultGlobalView.value = true}
            style={{
              border: 'none', borderRadius: '13px', padding: '4px 12px', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600,
              background: vaultGlobalView.value ? 'var(--ac)' : 'transparent',
              color: vaultGlobalView.value ? '#fff' : 'var(--tx2)'
            }}
          >
            🌐 Global
          </button>
        </div>
      )}

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

        <SyncManager />
        <DownloadManager />

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

        <button id="zapBtn" onClick={toggleZapping} title="Zapping mode" class={zapOn.value ? 'on' : ''}>
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

        <button id="dlQueueBtn" onClick={() => currentView.value = 'download-queue'} title="Download Queue" class={view === 'download-queue' ? 'on' : ''}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
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

        <button id="assistantBtn" onClick={() => currentView.value = 'assistant'} title="Assistant" class={view === 'assistant' ? 'on' : ''}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
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

      </div>
    </div>
  );
};
