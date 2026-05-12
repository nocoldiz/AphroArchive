import { currentView, currentCategory, categories } from '../store';

interface SidebarItemProps {
  id?: string;
  label: string;
  icon?: any;
  onClick: () => void;
  isActive?: boolean;
  indent?: boolean;
}

const SidebarItem = ({ id, label, icon, onClick, isActive, indent }: SidebarItemProps) => (
  <div 
    className={`sidebar-item ${isActive ? 'on' : ''}`} 
    id={id} 
    onClick={onClick}
    style={indent ? { paddingLeft: '32px', fontSize: '0.85rem' } : {}}
  >
    <span>{icon}{label}</span>
  </div>
);

const SectionHeader = ({ label, id, style }: { label: string, id: string, style?: any }) => (
  <h3 className="sidebar-heading" id={id} style={style}>
    {label}
    <svg className="sidebar-heading-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <path d="m6 9 6 6 6-6" />
    </svg>
  </h3>
);

export const Sidebar = () => {
  const setView = (view: string, legacyFn?: string) => {
    currentView.value = view;
    if (legacyFn && (window as any)[legacyFn]) {
      (window as any)[legacyFn]();
    }
  };

  const selectCategory = (catName: string) => {
    currentView.value = 'home';
    currentCategory.value = catName;
    // Compatibility
    (window as any).cat = catName;
    if ((window as any).showCategory) (window as any).showCategory(catName);
  };

  return (
    <div className="side-scroll">
      <SectionHeader label="Library" id="sh3-library" />
      <div className="side-section" id="librarySection">
        <SidebarItem id="fBtn" label="Favourites" icon={<i className="icon-star" />} onClick={() => setView('favourites', 'toggleFav')} isActive={currentView.value === 'favourites'} />
        <SidebarItem id="recent-sidebar" label="Recently Watched" icon={<i className="icon-clock" />} onClick={() => setView('recent', 'showRecent')} isActive={currentView.value === 'recent'} />
        <SidebarItem id="vault-sidebar" label="Vault" icon={<i className="icon-lock" />} onClick={() => setView('vault', 'showVault')} isActive={currentView.value === 'vault'} />
      </div>

      <div className="side-sep"></div>
      <SectionHeader label="Browse" id="sh3-browse" />
      <div className="side-section" id="browseSection">
        <SidebarItem label="All Videos" icon={<i className="icon-grid" />} onClick={() => selectCategory('')} isActive={currentView.value === 'home' && !currentCategory.value} />
        {categories.value.slice(0, 15).map(c => (
          <SidebarItem 
            key={c.name}
            label={c.name} 
            onClick={() => selectCategory(c.name)} 
            isActive={currentCategory.value === c.name}
            indent
          />
        ))}
        {categories.value.length > 15 && (
          <SidebarItem label="More Categories..." onClick={() => setView('categories', 'showCategoriesView')} />
        )}
      </div>

      <div className="side-sep" id="tags-sep" style={{ display: 'none' }}></div>
      <SectionHeader label="Tags" id="sh3-tags" style={{ display: 'none' }} />
      <div className="side-section" id="tagList"></div>

      <div className="side-sep"></div>
      <SectionHeader label="Media" id="sh3-media" />
      <div className="side-section" id="mediaSection">
        <SidebarItem label="Photos" icon={<i className="icon-image" />} onClick={() => setView('photos', 'showPhotos')} isActive={currentView.value === 'photos'} />
        <SidebarItem label="Thumbnails" icon={<i className="icon-grid" />} onClick={() => setView('thumbnails', 'showThumbnails')} isActive={currentView.value === 'thumbnails'} />
        <SidebarItem label="Pages" icon={<i className="icon-file" />} onClick={() => currentView.value = 'pages'} isActive={currentView.value === 'pages'} />
        <SidebarItem label="Audio" icon={<i className="icon-music" />} onClick={() => currentView.value = 'audio'} isActive={currentView.value === 'audio'} />
        <SidebarItem label="Books" icon={<i className="icon-book" />} onClick={() => currentView.value = 'books'} isActive={currentView.value === 'books'} />
      </div>

      <div className="side-sep"></div>
      <SectionHeader label="Web" id="sh3-web" />
      <div className="side-section" id="webSection">
        <SidebarItem label="Search Sites" icon={<i className="icon-search" />} onClick={() => currentView.value = 'search'} isActive={currentView.value === 'search'} />
      </div>

      <div className="side-sep"></div>
      <div className="side-section">
        <SidebarItem label="Settings" icon={<i className="icon-settings" />} onClick={() => currentView.value = 'settings'} isActive={currentView.value === 'settings'} />
      </div>
    </div>
  );
};
