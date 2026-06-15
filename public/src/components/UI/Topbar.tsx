import { Search } from './Search';
import { DownloadManager } from './DownloadManager';
import { SyncManager } from './SyncManager';
import { FilterDropdowns, SectionDropdowns } from './LibraryFilters';
import { currentView, isMuted, profileModalState, isSidebarOpen, importModalState, isVaultUnlocked, vaultGlobalView, loadVideos, sidebarCollapsed, activeProfile, loadProfiles, openExternalFolder } from '../../store';
import { zapOn } from '../../zap';
import { pluginsList, isPluginEnabled, loadPlugins, runPluginAction } from '../../plugins';
import { getNavItems, navIcon, placementFor, pluginLocation, openMoveMenu, sectionPlacementFor } from './navItems';
import { useEffect } from 'preact/hooks';


export const Topbar = () => {
  const view = currentView.value;

  useEffect(() => {
    loadProfiles();
    loadPlugins();
  }, []);

  if (view === 'instagram' || view === 'reddit') return null;

  // Nav items the user moved out of the sidebar; rendered as icons after search.
  // Exclude items whose whole section is already shown as a dropdown.
  const movedNavItems = getNavItems().filter(it =>
    placementFor(it.id, it.defaultLoc) === 'topbar' && sectionPlacementFor(it.section) !== 'topbar'
  );
  const movedPlugins = pluginsList.value
    .filter(p => pluginLocation(p) === 'topbar' && isPluginEnabled(p.id))
    .filter(p => !p.contexts || p.contexts.includes(view));

  const showHome = () => {
    currentView.value = 'hub';
  };

  const openImport = () => {
    importModalState.value = { visible: true };
  };

  const togglePan = () => {
    if ((window as any).togglePan) (window as any).togglePan();
  };

  return (
    <div className="topbar">
      <button className="burger-btn" onClick={() => isSidebarOpen.value = !isSidebarOpen.value} title="Toggle Sidebar" aria-label="Toggle sidebar">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
      <button
        className="rail-toggle"
        onClick={() => sidebarCollapsed.value = !sidebarCollapsed.value}
        title={sidebarCollapsed.value ? 'Expand sidebar' : 'Collapse sidebar to icons'}
        aria-label={sidebarCollapsed.value ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
        </svg>
      </button>
      <div className="logo" onClick={showHome} style={{ cursor: 'pointer' }}>
        <svg viewBox="0 0 28 28" fill="none" width="28" height="28">
          <rect width="28" height="28" rx="6" fill="#e84040" />
          <polygon points="11,7 11,21 22,14" fill="#fff" />
        </svg>
        <span className="logo-text">AphroArchive</span>
      </div>

      <FilterDropdowns />
      <SectionDropdowns />

      <div className="search-w">
        <Search />
      </div>

      <div className="tb-moved">
        {movedNavItems.map(item => (
          <button
            key={item.id}
            id={item.id}
            onClick={item.onClick}
            onContextMenu={(e) => { e.preventDefault(); openMoveMenu(e, item.id, item.label, 'topbar'); }}
            title={item.label}
            class={item.isActive ? 'on' : ''}
          >
            {navIcon(item.paths, 15)}
          </button>
        ))}
        {movedPlugins.map(p => {
          const isActive = p.type === 'toggle' && p.toggleAction === 'toggleZapping'
            ? zapOn.value
            : p.type === 'view' && view === p.view;
          return (
            <button
              key={p.id}
              id={`plugin-${p.id}`}
              onClick={() => runPluginAction(p, currentView)}
              onContextMenu={(e) => { e.preventDefault(); openMoveMenu(e, p.id, p.name, 'topbar'); }}
              title={p.name}
              class={isActive ? 'on' : ''}
            >
              {p.icon && (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  dangerouslySetInnerHTML={{ __html: p.icon }}
                />
              )}
            </button>
          );
        })}
      </div>

      {activeProfile.value === 'Vault' && isVaultUnlocked.value && (
        <div
          className="vault-scope-toggle"
          style={{ display: 'flex', alignItems: 'center', gap: '6px', marginRight: '10px', background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '16px', padding: '3px' }}
          title="Vault-Only shows encrypted files; Global shows every file from all profiles and lets you import them into the Vault"
        >
          <button
            onClick={() => { vaultGlobalView.value = false; loadVideos(); }}
            style={{
              border: 'none', borderRadius: '13px', padding: '4px 12px', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600,
              background: !vaultGlobalView.value ? 'var(--ac)' : 'transparent',
              color: !vaultGlobalView.value ? '#fff' : 'var(--tx2)'
            }}
          >
            🔒 Vault Only
          </button>
          <button
            onClick={() => { vaultGlobalView.value = true; loadVideos(); }}
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

        <button id="openFolderBtn" onClick={openExternalFolder} title="Open a folder temporarily (without importing)" className="hsm">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v3" />
            <path d="M2 13.5 4 19a2 2 0 0 0 1.9 1.4h12.2A2 2 0 0 0 20 19l2-5.5a1 1 0 0 0-.95-1.5H2.95A1 1 0 0 0 2 13.5z" />
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

        <button id="panBtn" onClick={togglePan} title="Panoramic mode">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
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
