import { useState, useEffect } from 'preact/hooks';
import { currentView, currentCategory, categories, currentTag, currentTagTerms, appPrefs, showConnectModal, isSidebarOpen, sourceFilter, allVideos, currentPhotoFolder, dbPendingOpen } from '../../store';

interface SidebarItemProps {
  id?: string;
  label: string;
  icon?: any;
  badge?: number;
  onClick: () => void;
  onDragOver?: (e: any) => void;
  onDragLeave?: (e: any) => void;
  onDrop?: (e: any) => void;
  onContextMenu?: (e: any) => void;
  isActive?: boolean;
  indent?: boolean;
}

const SidebarItem = ({ id, label, icon, badge, onClick, onDragOver, onDragLeave, onDrop, onContextMenu, isActive, indent }: SidebarItemProps) => (
  <div
    className={`sidebar-item ${isActive ? 'on' : ''}`}
    id={id}
    onClick={onClick}
    onDragOver={onDragOver}
    onDragLeave={onDragLeave}
    onDrop={onDrop}
    onContextMenu={onContextMenu}
    style={indent ? { paddingLeft: '32px', fontSize: '0.85rem' } : {}}
  >
    <span>{icon}{label}</span>
    {badge !== undefined && <span className="count-badge">{badge}</span>}
  </div>
);

const SectionHeader = ({ label, id, style, onClick, action }: { label: string, id: string, style?: any, onClick?: () => void, action?: any }) => {
  const handleClick = () => {
    if (onClick) {
      onClick();
    } else if ((window as any).toggleSection) {
      const section = id.replace('sh3-', '');
      (window as any).toggleSection(section);
    }
  };

  return (
    <h3 className="sidebar-heading" id={id} style={style} onClick={handleClick}>
      {label}
      <svg className="sidebar-heading-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="m6 9 6 6 6-6" />
      </svg>
      {action}
    </h3>
  );
};

export const Sidebar = () => {
  const view = currentView.value;
  const isOpen = isSidebarOpen.value;

  useEffect(() => {
    const el = document.getElementById('side');
    if (el) {
      if (isOpen) {
        el.classList.add('open');
      } else {
        el.classList.remove('open');
      }
    }
  }, [isOpen]);
  if (view === 'reddit') return null;

  const [linkCount, setLinkCount] = useState(0);
  const [tagGroups, setTagGroups] = useState<{ displayName: string, terms: string[] }[]>([]);
  const [tagsOpen, setTagsOpen] = useState(true);
  const [catsOpen, setCatsOpen] = useState(true);
  const [photoFolders, setPhotoFolders] = useState<{ path: string, name: string }[]>([]);
  const [photoFoldersOpen, setPhotoFoldersOpen] = useState(true);

  useEffect(() => {
    fetch('/api/links/cache')
      .then(r => r.json())
      .then(d => setLinkCount(d.total || (d.items ? d.items.length : 0)))
      .catch(() => {});

    fetch('/api/db-tags')
      .then(r => r.json())
      .then((data: any[]) => setTagGroups(data.map(g => ({ displayName: g.displayName, terms: g.terms || [] }))))
      .catch(() => {});

    fetch('/api/photos/folders')
      .then(r => r.json())
      .then(setPhotoFolders)
      .catch(() => {});
  }, []);



  const setView = (view: string, legacyFn?: string) => {
    currentView.value = view;
    isSidebarOpen.value = false;
    if (legacyFn && (window as any)[legacyFn]) {
      (window as any)[legacyFn]();
    }
  };

  const selectCategory = (catName: string) => {
    currentView.value = 'browse';
    currentCategory.value = catName;
    currentTag.value = null; currentTagTerms.value = [];
    isSidebarOpen.value = false;
    // Compatibility
    (window as any).cat = catName;
    if ((window as any).showCategory) (window as any).showCategory(catName);
  };

  const iconStyle = { verticalAlign: '-2px', marginRight: '5px' };

  // Derive filtered counts from allVideos + sourceFilter so badges update when filter changes
  const sf = sourceFilter.value;
  const vids = allVideos.value;
  const filteredVids = sf === 'local'
    ? vids.filter(v => !(v as any).isLink)
    : sf === 'remote'
    ? vids.filter(v => !!(v as any).isLink)
    : vids;

  const catCountMap = new Map<string, number>();
  let uncategorizedCount = 0;
  for (const v of filteredVids) {
    const cp = ((v as any).catPath as string) || '';
    if (!cp) {
      uncategorizedCount++;
      continue;
    }
    const parts = cp.split('/');
    let cur = '';
    for (const p of parts) {
      cur = cur ? cur + '/' + p : p;
      catCountMap.set(cur, (catCountMap.get(cur) || 0) + 1);
    }
  }
  const displayCategories = categories.value
    .map(c => ({ ...c, count: c.path === 'uncategorized' ? uncategorizedCount : (catCountMap.get(c.path) || 0) }))
    .sort((a, b) => {
      // Keep Uncategorized at the top
      if (a.path === 'uncategorized') return -1;
      if (b.path === 'uncategorized') return 1;
      // Sort the rest by name
      return a.name.localeCompare(b.name);
    });

  // Count per tag group: pre-computed v.tags match OR live name-match against group terms
  const displayTags = tagGroups
    .filter(g => !(appPrefs.value.hiddenTags || []).includes(g.displayName))
    .map(g => {
      const nameLo = g.displayName.toLowerCase();
      const count = filteredVids.filter(v => {
        const vtags = ((v as any).tags || []) as string[];
        if (vtags.some(t => t.toLowerCase() === nameLo)) return true;
        const vname = ((v as any).name || '').toLowerCase();
        return g.terms.some(t =>
          new RegExp('(?:^|[^a-z0-9])' + t.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|[^a-z0-9])').test(vname)
        );
      }).length;
      return { name: g.displayName, terms: g.terms, count };
    })
    .filter(t => t.count > 0)
    .sort((a, b) => b.count - a.count);

  return (
    <>
      {isOpen && <div className="sidebar-overlay" onClick={() => isSidebarOpen.value = false} />}
      <div className="side-scroll">
      {/* Library */}
      <SectionHeader label="Library" id="sh3-library" />
      <div className="side-section" id="librarySection">
        <SidebarItem
          id="home-sidebar"
          label="Home"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>}
          onClick={() => setView('hub')}
          isActive={currentView.value === 'hub'}
        />
        <SidebarItem
          id="fBtn"
          label="Favourites"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>}
          onClick={() => setView('favourites', 'toggleFav')}
          isActive={currentView.value === 'favourites'}
        />
        <SidebarItem
          id="recent-sidebar"
          label="Recently Watched"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>}
          onClick={() => setView('recent', 'showRecent')}
          isActive={currentView.value === 'recent'}
        />
        <SidebarItem
          id="collections-sidebar"
          label="Playlist"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /></svg>}
          onClick={() => setView('collections', 'showCollections')}
          isActive={currentView.value === 'collections'}
        />
        <SidebarItem
          id="vault-sidebar"
          label="Vault"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>}
          onClick={() => setView('vault', 'showVault')}
          isActive={currentView.value === 'vault'}
        />
      </div>

      {/* Manage */}
      <div className="side-sep"></div>
      <SectionHeader label="Manage" id="sh3-manage" />
      <div className="side-section" id="manageSection">
        <SidebarItem
          id="database-sidebar"
          label="Database"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>}
          onClick={() => setView('database', 'showDatabase')}
          isActive={currentView.value === 'database'}
        />
        <SidebarItem
          id="connect-sidebar"
          label="Connect"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><path d="M5 12.55a11 11 0 0 1 14.08 0" /><path d="M1.42 9a16 16 0 0 1 21.16 0" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><circle cx="12" cy="20" r="1" fill="currentColor" /></svg>}
          onClick={() => showConnectModal.value = true}
          isActive={false}
        />
        <SidebarItem
          id="settings-sidebar"
          label="Settings"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>}
          onClick={() => setView('settings', 'showSettings')}
          isActive={currentView.value === 'settings'}
        />
      </div>

      {/* Browse */}
      <div className="side-sep"></div>
      <SectionHeader label="Browse" id="sh3-browse" />
      <div className="side-section" id="browseSection">
        <SidebarItem
          id="categories-view-sidebar"
          label="Folders"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>}
          onClick={() => setView('categories', 'showCategoriesView')}
          isActive={currentView.value === 'categories'}
        />
        <SidebarItem
          id="actor-sidebar"
          label="Actors"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" /></svg>}
          onClick={() => setView('actors', 'showActors')}
          isActive={currentView.value === 'actors'}
        />
        <SidebarItem
          id="studio-sidebar"
          label="Studios"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><rect x="2" y="7" width="20" height="15" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /><line x1="12" y1="12" x2="12" y2="16" /><line x1="10" y1="14" x2="14" y2="14" /></svg>}
          onClick={() => setView('studios', 'showStudios')}
          isActive={currentView.value === 'studios'}
        />
        <SidebarItem
          id="chapters-sidebar"
          label="Chapters"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>}
          onClick={() => setView('chapters', 'showChaptersView')}
          isActive={currentView.value === 'chapters'}
        />
      </div>

      {/* Media */}
      <div className="side-sep"></div>
      <SectionHeader label="Media" id="sh3-media" />
      <div className="side-section" id="mediaSection">
        <SidebarItem
          id="videos-media-sidebar"
          label="Videos"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><path d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9A2.25 2.25 0 0 0 13.5 5.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>}
          onClick={() => setView('hub', 'goHome')}
          isActive={currentView.value === 'hub' && !currentCategory.value}
        />
        <SidebarItem
          id="thumbnails-sidebar"
          label="Thumbnails"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>}
          onClick={() => setView('thumbnails')}
          isActive={currentView.value === 'thumbnails'}
        />
        <SidebarItem
          id="imagegen-sidebar"
          label="Image Gen"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>}
          onClick={() => setView('imagegen')}
          isActive={currentView.value === 'imagegen'}
        />
        <SidebarItem
          id="photos-sidebar"
          label="Photos"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>}
          onClick={() => { currentPhotoFolder.value = ''; setView('photos', 'showPhotos'); setPhotoFoldersOpen(true); }}
          isActive={currentView.value === 'photos' && !currentPhotoFolder.value}
        />
        {photoFolders.length > 0 && currentView.value === 'photos' && photoFoldersOpen && photoFolders.map(f => (
          <SidebarItem
            key={f.path}
            label={f.name}
            onClick={() => { currentPhotoFolder.value = f.path; currentView.value = 'photos'; isSidebarOpen.value = false; }}
            isActive={currentPhotoFolder.value === f.path}
            indent
          />
        ))}
        <SidebarItem
          id="audio-sidebar"
          label="Audio"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>}
          onClick={() => setView('audio', 'showAudio')}
          isActive={currentView.value === 'audio'}
        />
        <SidebarItem
          id="pages-sidebar"
          label="Pages"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></svg>}
          onClick={() => setView('pages', 'showPages')}
          isActive={currentView.value === 'pages'}
        />
        <SidebarItem
          id="books-sidebar"
          label="Books"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>}
          onClick={() => setView('books', 'showBooks')}
          isActive={currentView.value === 'books'}
        />
        <SidebarItem
          id="prompts-sidebar"
          label="Prompts"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>}
          onClick={() => setView('prompts', 'showPrompts')}
          isActive={currentView.value === 'prompts'}
        />
      </div>

      {/* Web */}
      <div className="side-sep"></div>
      <SectionHeader label="Web" id="sh3-web" />
      <div className="side-section" id="webSection">
        <SidebarItem
          id="import-favs-sidebar"
          label="Links"
          badge={linkCount > 0 ? linkCount : undefined}
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>}
          onClick={() => setView('links', 'showImportFavs')}
          isActive={currentView.value === 'links'}
        />
        <SidebarItem
          id="search-sites-sidebar"
          label="Search"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /><path d="M11 8v6M8 11h6" /></svg>}
          onClick={() => setView('search', 'showSearchSites')}
          isActive={currentView.value === 'search'}
        />
      </div>

      {/* Categories & Tags */}
      <div className="side-sep"></div>
      <SectionHeader
        label="Folders"
        id="sh3-cats"
        onClick={() => setCatsOpen(v => !v)}
        action={
          <button className="sidebar-heading-add" title="New folder" onClick={(e) => { e.stopPropagation(); (window as any).createCategory(); }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        }
      />
      <div className="side-section" id="catsSection" style={{ display: catsOpen ? 'block' : 'none' }}>
        {displayCategories.map(c => {
          let lockIcon = null;
          if (c.partial) {
            lockIcon = <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#e84040" strokeWidth="3" style={{ marginRight: '5px', verticalAlign: '-1px' }}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><line x1="2" y1="2" x2="22" y2="22"/></svg>;
          } else if (c.encrypted) {
            lockIcon = <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '5px', opacity: 0.7, verticalAlign: '-1px' }}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>;
          }
          return (
            <SidebarItem
              key={c.name}
              label={c.name}
              icon={lockIcon}
              badge={c.count}
              onClick={() => selectCategory(c.path)}
              onContextMenu={(e) => {
                e.preventDefault();
                if ((window as any).showContextMenu) {
                  (window as any).showContextMenu(e, 'category', { path: c.path, name: c.name, encrypted: !!c.encrypted, partial: !!c.partial });
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                e.currentTarget.classList.add('drop-over');
              }}
              onDragLeave={(e) => {
                e.currentTarget.classList.remove('drop-over');
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('drop-over');
                const id = e.dataTransfer.getData('text/plain');
                if (!id) return;
                fetch(`/api/videos/${id}/move`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ category: c.path })
                })
                .then(r => r.json())
                .then(data => {
                  if (data.ok) {
                    // Refresh videos
                    if ((window as any).loadVideos) (window as any).loadVideos();
                  } else {
                    alert(data.error || 'Move failed');
                  }
                })
                .catch(err => console.error('Move failed', err));
              }}
              isActive={currentCategory.value === c.path}
              indent
            />
          );
        })}
      </div>

      <div className="side-sep" id="tags-sep"></div>
      <SectionHeader
        label="Tags"
        id="sh3-tags"
        onClick={() => setTagsOpen(v => !v)}
        action={
          <button type="button" className="sidebar-heading-add" title="New tag group" onClick={(e) => { e.stopPropagation(); currentView.value = 'database'; dbPendingOpen.value = { tab: 'categories', action: 'add' }; }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        }
      />
      <div className="side-section" id="tagList" style={{ display: tagsOpen ? 'block' : 'none' }}>
        {displayTags.map(t => (
          <SidebarItem
            key={t.name}
            id={`tag-${t.name}`}
            label={t.name}
            badge={t.count}
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /></svg>}
            onClick={() => {
              currentCategory.value = '';
              currentTag.value = t.name;
              currentTagTerms.value = t.terms;
              currentView.value = 'browse';
              isSidebarOpen.value = false;
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              if ((window as any).showContextMenu) {
                (window as any).showContextMenu(e, 'tag', { name: t.name });
              }
            }}
            isActive={currentTag.value === t.name}
            indent
          />
        ))}
      </div>
      </div>
    </>
  );
};
