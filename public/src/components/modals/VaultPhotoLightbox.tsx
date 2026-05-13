export const VaultPhotoLightbox = () => {
  return (
    <div className="vault-photo-overlay" id="vaultPhotoOverlay" onClick={(e: any) => { if (e.target.id === 'vaultPhotoOverlay') (window as any).closeVaultPhoto && (window as any).closeVaultPhoto(); }}>
      <button className="vault-photo-close" onClick={() => (window as any).closeVaultPhoto && (window as any).closeVaultPhoto()}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <button className="vault-photo-nav vault-photo-prev" id="vaultPhotoPrev" onClick={() => (window as any).prevVaultPhoto && (window as any).prevVaultPhoto(true)}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      <img id="vaultPhotoImg" loading="lazy" decoding="async" fetchpriority="low" src="" alt="" />
      
      <button className="vault-photo-nav vault-photo-next" id="vaultPhotoNext" onClick={() => (window as any).nextVaultPhoto && (window as any).nextVaultPhoto(true)}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      <div className="vault-photo-bar">
        <div className="vault-photo-name" id="vaultPhotoName"></div>
        <div className="vault-slideshow-controls">
          <button className="vault-photo-nav vault-photo-fav" id="vaultPhotoFav" onClick={() => (window as any).toggleVaultPhotoFav && (window as any).toggleVaultPhotoFav()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
          <button className="vault-photo-nav vault-photo-del" id="vaultPhotoDel" onClick={() => (window as any).deleteVaultFileFromPlayer && (window as any).deleteVaultFileFromPlayer(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
          <button className="vault-ss-btn" id="vaultSsBtn" onClick={() => (window as any).toggleVaultSlideshow && (window as any).toggleVaultSlideshow()} title="Slideshow">
            <svg className="ss-icon-play" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21" />
            </svg>
            <svg className="ss-icon-pause" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ display: 'none' }}>
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          </button>
          <input className="vault-ss-interval" id="vaultSsInterval" type="number" min="1" max="60" defaultValue="4"
            title="Seconds per photo" onClick={(e: any) => e.stopPropagation()} onChange={(e: any) => (window as any).setVaultSsInterval && (window as any).setVaultSsInterval(e.target.value)} />
          <span className="vault-ss-unit">s</span>
          <button className="vault-ss-btn" id="vaultMetaBtn" onClick={() => (window as any).showVaultPhotoMeta && (window as any).showVaultPhotoMeta()} title="View metadata">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </button>
          <button className="vault-ss-btn" onClick={() => (window as any).downloadCurrentVaultPhoto && (window as any).downloadCurrentVaultPhoto()} title="Download">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          <button className="vault-ss-btn" onClick={() => (window as any).describeCurrentVaultPhoto && (window as any).describeCurrentVaultPhoto()} title="Describe with AI">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>
      </div>
      <div id="vaultPhotoDescPanel"
        style={{ display: 'none', padding: '8px 14px', background: 'rgba(0,0,0,.75)', fontSize: '0.8rem', color: '#eee', maxWidth: '640px', borderRadius: '6px', margin: '4px auto 0', lineHeight: 1.5, textAlign: 'center', cursor: 'pointer' }}
        onClick={(e: any) => { e.target.style.display = 'none'; }}></div>
      <div className="vault-ss-progress" id="vaultSsProgress">
        <div className="vault-ss-progress-bar" id="vaultSsProgressBar"></div>
      </div>
      <div className="vault-zoom-badge" id="vaultZoomBadge"></div>
      {/* Metadata panel */}
      <div className="vault-meta-panel" id="vaultMetaPanel">
        <div className="vault-meta-hdr">
          <span className="vault-meta-title">Image Metadata</span>
          <button className="vault-meta-close" onClick={() => (window as any).closeVaultPhotoMeta && (window as any).closeVaultPhotoMeta()}>&#x2715;</button>
        </div>
        <div className="vault-meta-body" id="vaultMetaBody"></div>
      </div>
    </div>
  );
};
