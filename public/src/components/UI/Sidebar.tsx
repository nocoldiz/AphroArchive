import { useState, useEffect, useRef } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { currentView, currentPhotoFolder, isSidebarOpen, isVaultUnlocked, activeProfile, isLoadingVideos, dbPendingOpen, appPrefs } from '../../store';
import { pluginsList, isPluginEnabled, loadPlugins, runPluginAction } from '../../plugins';
import { SidebarItem, FoldersFilter, TagsFilter, LinksFilter, FolderOptionsButton, type FoldersFilterControl } from './LibraryFilters';
import { getNavItems, navIcon, placementFor, pluginLocation, openMoveMenu, openSectionMoveMenu, sectionPlacementFor, FILTER_IDS, setItemPlacement, sortByOrder, setNavOrder, getNavOrder, activeDrag, type NavItem, type NavSection, type NavOrderKey } from './navItems';

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

const insertLine = (
  <div style={{ height: '2px', background: 'var(--ac)', margin: '1px 10px', borderRadius: '1px', pointerEvents: 'none' }} />
);

export const Sidebar = () => {
  const view = currentView.value;
  const isOpen = isSidebarOpen.value;

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragInsertId, setDragInsertId] = useState<string | null>(null);
  const dropInsertRef = useRef<string | null>(null);
  const dropSectionRef = useRef<NavSection | null>(null);

  useEffect(() => {
    const el = document.getElementById('side');
    if (el) {
      if (isOpen) el.classList.add('open');
      else el.classList.remove('open');
    }
  }, [isOpen]);

  useEffect(() => {
    const clear = () => { setDraggingId(null); setDragInsertId(null); activeDrag.id = ''; activeDrag.fromLoc = ''; };
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
  }, []);

  if (view === 'reddit') return null;

  const [libraryOpen, setLibraryOpen] = useState(() => sectionState('library'));
  const [manageOpen, setManageOpen] = useState(() => sectionState('manage'));
  const [mediaOpen, setMediaOpen] = useState(() => sectionState('media'));
  const [tagsOpen, setTagsOpen] = useState(() => sectionState('tags'));
  const [linksOpen, setLinksOpen] = useState(() => sectionState('links'));
  const [catsOpen, setCatsOpen] = useState(() => sectionState('cats'));
  const [folderQuery, setFolderQuery] = useState('');
  const [photoFolders, setPhotoFolders] = useState<{ path: string, name: string }[]>([]);
  const folderCtrlRef = useRef<FoldersFilterControl | null>(null);
  const [, folderForceUpdate] = useState(0);

  const toggleLibrary = makeToggle('library', setLibraryOpen);
  const toggleManage = makeToggle('manage', setManageOpen);
  const toggleMedia = makeToggle('media', setMediaOpen);
  const toggleTags = makeToggle('tags', setTagsOpen);
  const toggleLinks = makeToggle('links', setLinksOpen);
  const toggleCats = makeToggle('cats', setCatsOpen);

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
  const placements = (appPrefs.value.itemPlacements || {}) as Record<string, string>;

  const sidebarItems = navItems.filter(it => placementFor(it.id, it.defaultLoc) === 'sidebar' && !placements[it.id]);
  const explicitSidebarItems = navItems.filter(it => placements[it.id] === 'sidebar');

  const handleSectionDrop = (secKey: NavSection, sortedIds: string[]) => {
    const { id: draggedId, fromLoc } = activeDrag;
    if (!draggedId) return;

    if (fromLoc === 'topbar') {
      setItemPlacement(draggedId, 'sidebar');
      activeDrag.id = '';
      activeDrag.fromLoc = '';
      return;
    }

    if (fromLoc === 'sidebar') {
      const insertId = dropInsertRef.current;
      if (!insertId || insertId === draggedId) return;
      const filtered = sortedIds.filter(id => id !== draggedId);
      if (insertId.startsWith('__end_')) {
        filtered.push(draggedId);
      } else {
        const toIdx = filtered.indexOf(insertId);
        filtered.splice(toIdx === -1 ? filtered.length : toIdx, 0, draggedId);
      }
      setNavOrder(`sidebar_${secKey}` as NavOrderKey, filtered);
      activeDrag.id = '';
      activeDrag.fromLoc = '';
    }
  };

  const renderItemContent = (item: NavItem) => (
    <>
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
    </>
  );

  const sectionsMeta: { key: NavSection, label: string, open: boolean, toggle: () => void, id: string }[] = [
    { key: 'library', label: 'Library', open: libraryOpen, toggle: toggleLibrary, id: 'sh3-library' },
    { key: 'media', label: 'Media', open: mediaOpen, toggle: toggleMedia, id: 'sh3-media' },
    { key: 'tools', label: 'Tools', open: manageOpen, toggle: toggleManage, id: 'sh3-manage' },
  ];

  // All plugins whose effective location is sidebar
  const sidebarPlugins = pluginsList.value.filter(p => pluginLocation(p) === 'sidebar' && isPluginEnabled(p.id));

  // Sorted sidebar plugin order
  const pluginOrderKey: NavOrderKey = 'sidebar_plugins';
  const savedPluginOrder = getNavOrder(pluginOrderKey);
  const sortedSidebarPlugins = savedPluginOrder.length
    ? [...sidebarPlugins].sort((a, b) => {
        const ra = savedPluginOrder.indexOf(a.id);
        const rb = savedPluginOrder.indexOf(b.id);
        return (ra === -1 ? 9999 : ra) - (rb === -1 ? 9999 : rb);
      })
    : sidebarPlugins;
  const pluginSortedIds = sortedSidebarPlugins.map(p => p.id);

  const handlePluginDrop = () => {
    const { id: draggedId, fromLoc } = activeDrag;
    if (!draggedId || fromLoc !== 'sidebar') return;
    const insertId = dropInsertRef.current;
    if (!insertId || insertId === draggedId) return;
    const filtered = pluginSortedIds.filter(id => id !== draggedId);
    if (insertId === '__end_plugins') {
      filtered.push(draggedId);
    } else {
      const toIdx = filtered.indexOf(insertId);
      filtered.splice(toIdx === -1 ? filtered.length : toIdx, 0, draggedId);
    }
    setNavOrder(pluginOrderKey, filtered);
    activeDrag.id = '';
    activeDrag.fromLoc = '';
  };

  const navContent = (
    <>
      {sectionsMeta.map((sec, i) => {
        const sectionInTopbar = sectionPlacementFor(sec.key) === 'topbar';

        if (sectionInTopbar) {
          const detached = explicitSidebarItems.filter(it => it.section === sec.key);
          if (!detached.length) return null;
          return (
            <div key={sec.key}>
              {i > 0 && <div className="side-sep"></div>}
              <SectionHeader
                label={sec.label}
                id={sec.id}
                open={sec.open}
                onClick={sec.toggle}
                onContextMenu={(e) => { e.preventDefault(); openSectionMoveMenu(e, sec.key, sec.label, 'sidebar'); }}
              />
              <div className="side-section" style={{ display: sec.open ? 'block' : 'none' }}>
                {detached.map(item => (
                  <div key={item.id}>{renderItemContent(item)}</div>
                ))}
              </div>
            </div>
          );
        }

        const items = sidebarItems.filter(it => it.section === sec.key);
        const extraItems = explicitSidebarItems.filter(it => it.section === sec.key);
        const allItems = [...items, ...extraItems.filter(it => !items.find(x => x.id === it.id))];

        if (!allItems.length) return null;

        const orderKey = `sidebar_${sec.key}` as NavOrderKey;
        const sorted = sortByOrder(allItems, orderKey);
        const sortedIds = sorted.map(it => it.id);
        const endSentinel = `__end_${sec.key}`;

        return (
          <div key={sec.key}>
            {i > 0 && <div className="side-sep"></div>}
            <SectionHeader
              label={sec.label}
              id={sec.id}
              open={sec.open}
              onClick={sec.toggle}
              onContextMenu={(e) => { e.preventDefault(); openSectionMoveMenu(e, sec.key, sec.label, 'sidebar'); }}
            />
            <div
              className="side-section"
              style={{ display: sec.open ? 'block' : 'none' }}
              onDragOver={(e) => {
                if (activeDrag.fromLoc === 'topbar') e.preventDefault();
              }}
              onDrop={(e) => {
                if (activeDrag.fromLoc === 'topbar') {
                  e.preventDefault();
                  handleSectionDrop(sec.key, sortedIds);
                  setDragInsertId(null);
                  setDraggingId(null);
                }
              }}
            >
              {sorted.map((item, idx) => (
                <div key={item.id}>
                  {dragInsertId === item.id && insertLine}
                  <div
                    draggable
                    onDragStart={(e) => {
                      activeDrag.id = item.id;
                      activeDrag.fromLoc = 'sidebar';
                      e.dataTransfer!.effectAllowed = 'move';
                      e.dataTransfer!.setData('text/plain', item.id);
                      setDraggingId(item.id);
                    }}
                    onDragOver={(e) => {
                      if (activeDrag.fromLoc === 'topbar' || activeDrag.fromLoc === 'sidebar') {
                        e.preventDefault();
                        e.stopPropagation();
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const before = e.clientY < r.top + r.height / 2;
                        const insertId = before ? item.id : (sortedIds[idx + 1] ?? endSentinel);
                        dropInsertRef.current = insertId;
                        dropSectionRef.current = sec.key;
                        setDragInsertId(insertId);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleSectionDrop(sec.key, sortedIds);
                      setDragInsertId(null);
                      setDraggingId(null);
                    }}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setDragInsertId(null);
                      activeDrag.id = '';
                      activeDrag.fromLoc = '';
                    }}
                    style={{
                      opacity: draggingId === item.id ? 0.35 : 1,
                      cursor: 'grab',
                    }}
                  >
                    {renderItemContent(item)}
                  </div>
                </div>
              ))}
              {dragInsertId === endSentinel && insertLine}
            </div>
          </div>
        );
      })}

      {/* Sidebar plugins — each plugin with location:'sidebar' as its own draggable item */}
      {sortedSidebarPlugins.length > 0 && (
        <>
          <div className="side-sep"></div>
          {sortedSidebarPlugins.map((p, idx) => (
            <div key={p.id}>
              {dragInsertId === p.id && insertLine}
              <div
                draggable
                onDragStart={(e) => {
                  activeDrag.id = p.id;
                  activeDrag.fromLoc = 'sidebar';
                  e.dataTransfer!.effectAllowed = 'move';
                  e.dataTransfer!.setData('text/plain', p.id);
                  setDraggingId(p.id);
                }}
                onDragOver={(e) => {
                  if (activeDrag.fromLoc === 'sidebar') {
                    e.preventDefault();
                    e.stopPropagation();
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    const before = e.clientY < r.top + r.height / 2;
                    const insertId = before ? p.id : (pluginSortedIds[idx + 1] ?? '__end_plugins');
                    dropInsertRef.current = insertId;
                    setDragInsertId(insertId);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handlePluginDrop();
                  setDragInsertId(null);
                  setDraggingId(null);
                }}
                onDragEnd={() => {
                  setDraggingId(null);
                  setDragInsertId(null);
                  activeDrag.id = '';
                  activeDrag.fromLoc = '';
                }}
                style={{ opacity: draggingId === p.id ? 0.35 : 1, cursor: 'grab' }}
              >
                <SidebarItem
                  label={p.name}
                  icon={p.icon ? navIcon(<g dangerouslySetInnerHTML={{ __html: p.icon }} />, 13, iconStyle) : undefined}
                  onClick={() => runPluginAction(p, currentView)}
                  isActive={p.type === 'view' && currentView.value === p.view}
                  onContextMenu={(e) => { e.preventDefault(); openMoveMenu(e, p.id, p.name, 'sidebar'); }}
                />
              </div>
            </div>
          ))}
          {dragInsertId === '__end_plugins' && insertLine}
        </>
      )}
    </>
  );

  const showFolders = placementFor(FILTER_IDS.folders, 'topbar') === 'sidebar';
  const showTags = placementFor(FILTER_IDS.tags, 'sidebar') === 'sidebar' && !inVaultMode;
  const showLinks = placementFor(FILTER_IDS.links, 'topbar') === 'sidebar' && !inVaultMode;

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
                <button type="button" className="sidebar-heading-add"
                  title={folderCtrlRef.current?.isAllExpanded() ? 'Collapse all' : 'Expand all'}
                  onClick={(e) => {
                    e.stopPropagation();
                    const ctrl = folderCtrlRef.current;
                    if (!ctrl) return;
                    if (ctrl.isAllExpanded()) ctrl.collapseAll(); else ctrl.expandAll();
                    folderForceUpdate(n => n + 1);
                  }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    {folderCtrlRef.current?.isAllExpanded()
                      ? <><path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/></>
                      : <><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></>
                    }
                  </svg>
                </button>
                <FolderOptionsButton />
              </span>
            }
          />
          <div className="side-section" id="catsSection" style={{ display: catsOpen ? 'block' : 'none' }}>
            <div className="filter-dropdown-search sidebar-search">
              <input
                type="text"
                placeholder="Search folders…"
                value={folderQuery}
                onInput={(e: any) => setFolderQuery(e.currentTarget.value)}
                onClick={(e: any) => e.stopPropagation()}
              />
            </div>
            <FoldersFilter controlRef={folderCtrlRef} filter={folderQuery} />
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

      {showLinks && (
        <>
          <div className="side-sep" id="links-sep"></div>
          <SectionHeader
            label="Links"
            id="sh3-links"
            open={linksOpen}
            onClick={toggleLinks}
            onContextMenu={(e) => { e.preventDefault(); openMoveMenu(e, FILTER_IDS.links, 'Links', 'sidebar'); }}
          />
          <div className="side-section" id="linkList" style={{ display: linksOpen ? 'block' : 'none' }}>
            <LinksFilter />
          </div>
        </>
      )}
    </>
  );

  return (
    <>
      {isOpen && createPortal(
        <div className="sidebar-overlay" onClick={() => isSidebarOpen.value = false} />,
        document.body
      )}
      <div
        className="side-scroll"
        onDragOver={(e) => {
          if (activeDrag.fromLoc === 'topbar') e.preventDefault();
        }}
        onDrop={(e) => {
          if (activeDrag.fromLoc === 'topbar') {
            e.preventDefault();
            setItemPlacement(activeDrag.id, 'sidebar');
            activeDrag.id = '';
            activeDrag.fromLoc = '';
            setDragInsertId(null);
            setDraggingId(null);
          }
        }}
      >
        {navContent}
        {filterContent}
      </div>
    </>
  );
};
