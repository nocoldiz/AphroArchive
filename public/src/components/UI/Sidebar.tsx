import { useState, useEffect } from 'preact/hooks';
import { currentView, currentPhotoFolder, isSidebarOpen, isVaultUnlocked, activeProfile, isLoadingVideos, dbPendingOpen } from '../../store';
import { pluginsList, isPluginEnabled, loadPlugins, runPluginAction } from '../../plugins';
import { SidebarItem, FoldersFilter, TagsFilter } from './LibraryFilters';
import { getNavItems, navIcon, placementFor, pluginLocation, openMoveMenu, FILTER_IDS, type NavItem, type NavSection } from './navItems';

const SectionHeader = ({ label, id, open, style, onClick, action, onContextMenu }: { label: string, id: string, open?: boolean, style?: any, onClick?: () => void, action?: any, onContextMenu?: (e: any) => void }) => (
  <h3 className={`sidebar-heading${open === false ? ' closed' : ''}`} id={id} style={style} onClick={onClick} onContextMenu={onContextMenu}>
    <span className="sidebar-heading-label">{label}</span>
    {action}
    <svg className="sidebar-heading-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="m6 9 6 6 6-6" />
    </svg>
  </h3>
);

const LS_KEY = 'sidebarSections';

function loadSections(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
}

function sectionState(key: string, defaultOpen = true): boolean {
  const s = loadSections();
  return key in s ? s[key] : defaultOpen;
}

function persistSection(key: string, open: boolean) {
  const s = loadSections();
  s[key] = open;
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}

function makeToggle(key: string, setter: (fn: (v: boolean) => boolean) => void) {
  return () => setter(prev => {
    const next = !prev;
    persistSection(key, next);
    return next;
  });
}

const iconStyle = { verticalAlign: '-2px', marginRight: '5px' };

export const Sidebar = () => {
  const view = currentView.value;
  const isOpen = isSidebarOpen.value;

  useEffect(() => {
    const el = document.getElementById('side');
    if (el) {
      if (isOpen) el.classList.add('open');
      else el.classList.remove('open');
    }
  }, [isOpen]);
  if (view === 'reddit') return null;

  const [libraryOpen, setLibraryOpen] = useState(() => sectionState('library'));
  const [manageOpen, setManageOpen] = useState(() => sectionState('manage'));
  const [browseOpen, setBrowseOpen] = useState(() => sectionState('browse'));
  const [mediaOpen, setMediaOpen] = useState(() => sectionState('media'));
  const [tagsOpen, setTagsOpen] = useState(() => sectionState('tags'));
  const [catsOpen, setCatsOpen] = useState(() => sectionState('cats'));
  const [photoFolders, setPhotoFolders] = useState<{ path: string, name: string }[]>([]);
  const [pluginsOpen, setPluginsOpen] = useState(() => sectionState('plugins'));

  const toggleLibrary = makeToggle('library', setLibraryOpen);
  const toggleManage = makeToggle('manage', setManageOpen);
  const toggleBrowse = makeToggle('browse', setBrowseOpen);
  const toggleMedia = makeToggle('media', setMediaOpen);
  const toggleTags = makeToggle('tags', setTagsOpen);
  const toggleCats = makeToggle('cats', setCatsOpen);
  const togglePlugins = makeToggle('plugins', setPluginsOpen);

  useEffect(() => {
    loadPlugins();
  }, []);

  const inVaultMode = isVaultUnlocked.value && currentView.value === 'vault';

  useEffect(() => {
    fetch('/api/photos/folders')
      .then(r => r.json())
      .then(setPhotoFolders)
      .catch(() => {});
  }, [activeProfile.value]);

  const navItems = getNavItems();
  const sidebarItems = navItems.filter(it => placementFor(it.id, it.defaultLoc) === 'sidebar');

  const renderItem = (item: NavItem) => (
    <div key={item.id}>
      <SidebarItem
        id={item.id}
        label={item.label}
        icon={navIcon(item.paths, 13, iconStyle)}
        badge={item.badge}
        onClick={item.onClick}
        isActive={item.isActive}
        onContextMenu={(e) => { e.preventDefault(); openMoveMenu(e, item.id, item.label, 'sidebar'); }}
      />
      {item.id === 'photos-sidebar' && currentView.value === 'photos' && photoFolders.length > 0 && photoFolders.map(f => (
        <SidebarItem
          key={f.path}
          label={f.name}
          onClick={() => { currentPhotoFolder.value = f.path; currentView.value = 'photos'; isSidebarOpen.value = false; }}
          isActive={currentPhotoFolder.value === f.path}
          indent
        />
      ))}
    </div>
  );

  const renderSectionPlugins = (section: NavSection) =>
    pluginsList.value
      .filter(p => pluginLocation(p) === 'sidebar' && p.sidebarSection === section && isPluginEnabled(p.id))
      .map(p => (
        <SidebarItem
          key={p.id}
          label={p.name}
          icon={p.icon ? navIcon(<g dangerouslySetInnerHTML={{ __html: p.icon }} />, 13, iconStyle) : undefined}
          onClick={() => runPluginAction(p, currentView)}
          isActive={p.type === 'view' && currentView.value === p.view}
          onContextMenu={(e) => { e.preventDefault(); openMoveMenu(e, p.id, p.name, 'sidebar'); }}
        />
      ));

  const sectionsMeta: { key: NavSection, label: string, open: boolean, toggle: () => void, id: string }[] = [
    { key: 'library', label: 'Library', open: libraryOpen, toggle: toggleLibrary, id: 'sh3-library' },
    { key: 'browse', label: 'Browse', open: browseOpen, toggle: toggleBrowse, id: 'sh3-browse' },
    { key: 'media', label: 'Media', open: mediaOpen, toggle: toggleMedia, id: 'sh3-media' },
    { key: 'tools', label: 'Tools', open: manageOpen, toggle: toggleManage, id: 'sh3-manage' },
  ];

  const opacityStyle = { transition: 'opacity 0.25s ease', opacity: isLoadingVideos.value ? 0.4 : 1 } as const;

  const navContent = (
    <>
      {sectionsMeta.map((sec, i) => {
        const items = sidebarItems.filter(it => it.section === sec.key);
        const hasPlugins = pluginsList.value.some(p => pluginLocation(p) === 'sidebar' && p.sidebarSection === sec.key && isPluginEnabled(p.id));
        if (!items.length && !hasPlugins) return null;
        return (
          <div key={sec.key}>
            {i > 0 && <div className="side-sep"></div>}
            <SectionHeader label={sec.label} id={sec.id} open={sec.open} onClick={sec.toggle} />
            <div className="side-section" style={{ display: sec.open ? 'block' : 'none' }}>
              {items.map(renderItem)}
              {renderSectionPlugins(sec.key)}
            </div>
          </div>
        );
      })}

      {/* Unplaced sidebar plugins (no sidebarSection) get their own section */}
      {pluginsList.value.some(p => pluginLocation(p) === 'sidebar' && !p.sidebarSection && isPluginEnabled(p.id)) && (
        <>
          <div className="side-sep"></div>
          <SectionHeader label="Plugins" id="sh3-plugins" open={pluginsOpen} onClick={togglePlugins} />
          <div className="side-section" id="pluginsSection" style={{ display: pluginsOpen ? 'block' : 'none' }}>
            {pluginsList.value.filter(p => pluginLocation(p) === 'sidebar' && !p.sidebarSection && isPluginEnabled(p.id)).map(p => (
              <SidebarItem
                key={p.id}
                label={p.name}
                icon={p.icon ? navIcon(<g dangerouslySetInnerHTML={{ __html: p.icon }} />, 13, iconStyle) : undefined}
                onClick={() => runPluginAction(p, currentView)}
                isActive={p.type === 'view' && currentView.value === p.view}
                onContextMenu={(e) => { e.preventDefault(); openMoveMenu(e, p.id, p.name, 'sidebar'); }}
              />
            ))}
          </div>
        </>
      )}
    </>
  );

  const showFolders = placementFor(FILTER_IDS.folders, 'sidebar') === 'sidebar';
  const showTags = placementFor(FILTER_IDS.tags, 'sidebar') === 'sidebar' && !inVaultMode;

  const filterContent = (
    <>
      {showFolders && (
        <>
          <div className="side-sep"></div>
          <SectionHeader
            label={inVaultMode ? 'Encrypted Folders' : 'Folders'}
            id="sh3-cats"
            open={catsOpen}
            onClick={toggleCats}
            onContextMenu={(e) => { e.preventDefault(); openMoveMenu(e, FILTER_IDS.folders, 'Folders', 'sidebar'); }}
            action={
              <span className="sidebar-heading-actions">
                {isLoadingVideos.value && <span className="sidebar-loading-spin" />}
                {!inVaultMode && (
                  <button type="button" className="sidebar-heading-add" title="New folder" onClick={(e) => { e.stopPropagation(); (window as any).createFolder(); }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                )}
              </span>
            }
          />
          <div className="side-section" id="catsSection" style={{ display: catsOpen ? 'block' : 'none' }}>
            <FoldersFilter />
          </div>
        </>
      )}

      {showTags && (
        <>
          <div className="side-sep" id="tags-sep"></div>
          <SectionHeader
            label="Tags"
            id="sh3-tags"
            open={tagsOpen}
            onClick={toggleTags}
            onContextMenu={(e) => { e.preventDefault(); openMoveMenu(e, FILTER_IDS.tags, 'Tags', 'sidebar'); }}
            action={
              <button type="button" className="sidebar-heading-add" title="New tag group" onClick={(e) => { e.stopPropagation(); currentView.value = 'database'; dbPendingOpen.value = { tab: 'folders', action: 'add' }; }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            }
          />
          <div className="side-section" id="tagList" style={{ display: tagsOpen ? 'block' : 'none' }}>
            <TagsFilter />
          </div>
        </>
      )}
    </>
  );

  return (
    <>
      {isOpen && <div className="sidebar-overlay" onClick={() => isSidebarOpen.value = false} />}
      <div className="side-scroll" style={opacityStyle}>
        {navContent}
        {filterContent}
      </div>
    </>
  );
};
