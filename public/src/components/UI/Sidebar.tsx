import { useState, useEffect, useMemo, useRef } from 'preact/hooks';
import { currentView, currentFolder, folders, currentTag, currentTagTerms, appPrefs, showConnectModal, isSidebarOpen, sourceFilter, allVideos, currentPhotoFolder, dbPendingOpen, isVaultUnlocked, activeProfile, switchProfile, searchQuery, isLoadingVideos, linkTotalCount, mediaCounts } from '../../store';
import { pluginsList, isPluginEnabled, loadPlugins, runPluginAction } from '../../plugins';

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
  depth?: number;
  hasChildren?: boolean;
  expanded?: boolean;
  onToggleExpand?: (e: any) => void;
}

const SidebarItem = ({ id, label, icon, badge, onClick, onDragOver, onDragLeave, onDrop, onContextMenu, isActive, indent, depth, hasChildren, expanded, onToggleExpand }: SidebarItemProps) => {
  const isTree = depth !== undefined;
  const style: any = isTree
    ? { paddingLeft: depth! > 0 ? `${depth! * 16}px` : undefined, fontSize: '0.85rem' }
    : indent ? { paddingLeft: '32px', fontSize: '0.85rem' } : {};
  return (
    <div
      className={`sidebar-item ${isActive ? 'on' : ''}`}
      id={id}
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
      style={style}
    >
      <span style={{ display: 'flex', alignItems: 'center', minWidth: 0, overflow: 'hidden' }}>
        {isTree && (
          hasChildren ? (
            <svg
              className="sidebar-folder-chevron"
              width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
              style={{ marginRight: '4px', flexShrink: 0, transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform var(--tr)' }}
              onClick={(e: any) => { e.preventDefault(); e.stopPropagation(); onToggleExpand?.(e); }}
            >
              <path d="m9 6 6 6-6 6" />
            </svg>
          ) : (
            <span style={{ display: 'inline-block', width: '14px', flexShrink: 0 }} />
          )
        )}
        {icon}<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      </span>
      {badge !== undefined && <span className="count-badge">{badge}</span>}
    </div>
  );
};

const SectionHeader = ({ label, id, open, style, onClick, action }: { label: string, id: string, open?: boolean, style?: any, onClick?: () => void, action?: any }) => (
  <h3 className={`sidebar-heading${open === false ? ' closed' : ''}`} id={id} style={style} onClick={onClick}>
    {label}
    <svg className="sidebar-heading-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="m6 9 6 6 6-6" />
    </svg>
    {action}
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

  const [tagGroups, setTagGroups] = useState<{ displayName: string, terms: string[] }[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(() => sectionState('library'));
  const [manageOpen, setManageOpen] = useState(() => sectionState('manage'));
  const [browseOpen, setBrowseOpen] = useState(() => sectionState('browse'));
  const [mediaOpen, setMediaOpen] = useState(() => sectionState('media'));
  const [tagsOpen, setTagsOpen] = useState(() => sectionState('tags'));
  const [catsOpen, setCatsOpen] = useState(() => sectionState('cats'));
  const [photoFolders, setPhotoFolders] = useState<{ path: string, name: string }[]>([]);
  const [photoFoldersOpen, setPhotoFoldersOpen] = useState(true);
  const [vaultFolders, setVaultFolders] = useState<{ id: string, name: string }[]>([]);
  const [vaultFoldersOpen, setVaultFoldersOpen] = useState(() => sectionState('vaultFolders'));
  const [pluginsOpen, setPluginsOpen] = useState(() => sectionState('plugins'));

  const scrollRef = useRef<HTMLDivElement>(null);
  const filterScrollRef = useRef<HTMLDivElement>(null);

  const toggleLibrary = makeToggle('library', setLibraryOpen);
  const toggleManage = makeToggle('manage', setManageOpen);
  const toggleBrowse = makeToggle('browse', setBrowseOpen);
  const toggleMedia = makeToggle('media', setMediaOpen);
  const toggleTags = makeToggle('tags', setTagsOpen);
  const toggleCats = makeToggle('cats', setCatsOpen);
  const toggleVaultFolders = makeToggle('vaultFolders', setVaultFoldersOpen);
  const togglePlugins = makeToggle('plugins', setPluginsOpen);

  useEffect(() => {
    loadPlugins();
  }, []);

  // Update sticky top offsets so headings stack instead of overlap
  useEffect(() => {
    [scrollRef, filterScrollRef].forEach(ref => {
      const container = ref.current;
      if (!container) return;
      const headings = container.querySelectorAll<HTMLElement>('.sidebar-heading');
      const total = headings.length;
      let offset = 0;
      headings.forEach((el, i) => {
        el.style.top = `${offset}px`;
        el.style.zIndex = String(20 + total - i);
        offset += el.offsetHeight || 30;
      });
    });
  });

  const inVaultMode = isVaultUnlocked.value && currentView.value === 'vault';
  const isTwoPane = appPrefs.value.sidebarLayout !== 'default';

  useEffect(() => {
    const el = document.getElementById('side');
    if (el) el.classList.toggle('two-pane', isTwoPane);
  }, [isTwoPane]);

  const linkCount = linkTotalCount.value;
  const mc = mediaCounts.value;

  const reloadTags = () => {
    fetch('/api/db-tags')
      .then(r => r.json())
      .then((data: any[]) => setTagGroups(data.map(g => ({ displayName: g.displayName, terms: g.terms || [] }))))
      .catch(() => {});
  };

  useEffect(() => {
    reloadTags();

    fetch('/api/photos/folders')
      .then(r => r.json())
      .then(setPhotoFolders)
      .catch(() => {});

    (window as any)._sidebarReloadTags = reloadTags;
    return () => { delete (window as any)._sidebarReloadTags; };
  }, [activeProfile.value]);

  useEffect(() => {
    if (!isVaultUnlocked.value) { setVaultFolders([]); return; }
    fetch('/api/vault/files')
      .then(r => r.json())
      .then((items: any[]) => {
        if (!Array.isArray(items)) return;
        setVaultFolders(items.filter(f => f.type === 'folder').map(f => ({ id: f.id, name: f.name || f.originalName })));
      })
      .catch(() => {});
  }, [isVaultUnlocked.value]);



  const setView = (view: string, legacyFn?: string) => {
    currentView.value = view;
    isSidebarOpen.value = false;
    if (legacyFn && (window as any)[legacyFn]) {
      (window as any)[legacyFn]();
    }
  };

  const renderSectionPlugins = (section: string) =>
    pluginsList.value
      .filter(p => p.location === 'sidebar' && p.sidebarSection === section && isPluginEnabled(p.id))
      .map(p => (
        <SidebarItem
          key={p.id}
          label={p.name}
          icon={p.icon ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              style={{ verticalAlign: '-2px', marginRight: '5px' }}
              dangerouslySetInnerHTML={{ __html: p.icon }}
            />
          ) : undefined}
          onClick={() => runPluginAction(p, currentView)}
          isActive={p.type === 'view' && currentView.value === p.view}
        />
      ));

  const selectCategory = (catName: string) => {
    currentView.value = 'browse';
    currentFolder.value = catName;
    currentTag.value = null; currentTagTerms.value = [];
    searchQuery.value = '';
    isSidebarOpen.value = false;
    // Compatibility
    (window as any).cat = catName;
    if ((window as any).showCategory) (window as any).showCategory(catName);
  };

  const iconStyle = { verticalAlign: '-2px', marginRight: '5px' };

  const renderCategoryNode = (node: CatTreeNode, depth: number): any => {
    const c = node.cat;
    const lockIcon = inVaultMode
      ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--ac)" strokeWidth="2.5" style={{ marginRight: '5px', verticalAlign: '-1px' }}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      : c.partial
        ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#e84040" strokeWidth="3" style={{ marginRight: '5px', verticalAlign: '-1px' }}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
        : c.encrypted
          ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '5px', opacity: 0.7, verticalAlign: '-1px' }}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          : null;
    const hasChildren = node.children.length > 0;
    const expanded = expandedFolders.has(c.path);
    const label = depth === 0 ? c.name : (c.name.split(' / ').pop() || c.name);
    return (
      <div key={c.path}>
        <SidebarItem
          label={label}
          icon={lockIcon}
          badge={c.count}
          depth={depth}
          hasChildren={hasChildren}
          expanded={expanded}
          onToggleExpand={() => toggleFolderExpand(c.path)}
          onClick={() => selectCategory(c.path)}
          onContextMenu={(e) => {
            e.preventDefault();
            if ((window as any).showContextMenu) {
              (window as any).showContextMenu(e, 'folder', { path: c.path, name: c.name, encrypted: !!c.encrypted, partial: !!c.partial });
            }
          }}
          onDragOver={!inVaultMode ? (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            e.currentTarget.classList.add('drop-over');
          } : undefined}
          onDragLeave={!inVaultMode ? (e) => {
            e.currentTarget.classList.remove('drop-over');
          } : undefined}
          onDrop={!inVaultMode ? (e) => {
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
                if ((window as any).loadVideos) (window as any).loadVideos();
              } else {
                alert(data.error || 'Move failed');
              }
            })
            .catch(err => console.error('Move failed', err));
          } : undefined}
          isActive={currentFolder.value === c.path}
        />
        {hasChildren && expanded && node.children.map(child => renderCategoryNode(child, depth + 1))}
      </div>
    );
  };

  // Use the counts already provided by the server's categories API — no client-side recomputation
  const sf = sourceFilter.value;
  const vids = allVideos.value;
  const filteredVids = useMemo(() => sf === 'local'
    ? vids.filter(v => !(v as any).isLink)
    : sf === 'remote'
    ? vids.filter(v => !!(v as any).isLink)
    : vids, [sf, vids]);

  const displayFolders = useMemo(() => folders.value
    .map(c => {
      // Use the count from the server response; if missing (e.g. for link-only cats), compute from filteredVids
      let count = c.count || 0;
      if (count === 0 && c.path !== 'uncategorized') {
        count = filteredVids.filter(v => {
          const vp = ((v as any).catPath || '').toLowerCase();
          const cl = c.path.toLowerCase();
          return vp === cl || vp.startsWith(cl + '/');
        }).length;
      }
      return { ...c, count };
    })
    // The Vault is a superuser: it sees every category across the system,
    // so vault mode applies no category filtering.
    .sort((a, b) => {
      if (a.path === 'uncategorized') return -1;
      if (b.path === 'uncategorized') return 1;
      return a.name.localeCompare(b.name);
    }), [folders.value, filteredVids]);

  // Build a folder tree from the flat category list. Categories with `count === 0`
  // are dropped when the user enables "hide empty folders" — their (also-empty) subtrees go with them.
  interface CatTreeNode { cat: typeof displayFolders[number]; children: CatTreeNode[] }
  const categoryTree = useMemo(() => {
    const hideEmpty = !!appPrefs.value.hideEmptyFolders;
    const list = hideEmpty ? displayFolders.filter(c => c.count > 0) : displayFolders;
    const byPath = new Map<string, CatTreeNode>();
    const roots: CatTreeNode[] = [];
    for (const c of list) {
      byPath.set(c.path, { cat: c, children: [] });
    }
    for (const node of byPath.values()) {
      const slash = node.cat.path.lastIndexOf('/');
      const parent = slash === -1 ? undefined : byPath.get(node.cat.path.slice(0, slash));
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }, [displayFolders, appPrefs.value.hideEmptyFolders]);

  // Pinned folders surface at the top of the Folders list. Preserve the
  // user's pin order; drop any pins whose folder no longer exists.
  const pinnedCats = useMemo(() => {
    const pins = appPrefs.value.pinnedFolders || [];
    if (!pins.length) return [] as typeof displayFolders;
    const byPath = new Map(displayFolders.map(c => [c.path, c]));
    return pins.map(p => byPath.get(p)).filter(Boolean) as typeof displayFolders;
  }, [appPrefs.value.pinnedFolders, displayFolders]);

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    try { return new Set<string>(JSON.parse(localStorage.getItem('sidebarFolderExpanded') || '[]')); } catch { return new Set<string>(); }
  });
  const toggleFolderExpand = (path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      localStorage.setItem('sidebarFolderExpanded', JSON.stringify([...next]));
      return next;
    });
  };

  // Count per tag group: pre-computed v.tags match OR live name-match against group terms
  const displayTags = useMemo(() => tagGroups
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
    .sort((a, b) => b.count - a.count), [tagGroups, appPrefs.value.hiddenTags, filteredVids]);

  // Pinned tags surface at the top of the Tags list, in pin order.
  const pinnedTagsList = useMemo(() => {
    const pins = appPrefs.value.pinnedTags || [];
    if (!pins.length) return [] as typeof displayTags;
    const byName = new Map(displayTags.map(t => [t.name, t]));
    return pins.map(n => byName.get(n)).filter(Boolean) as typeof displayTags;
  }, [appPrefs.value.pinnedTags, displayTags]);

  const opacityStyle = { transition: 'opacity 0.25s ease', opacity: isLoadingVideos.value ? 0.4 : 1 } as const;

  const navContent = (
    <>
      {/* Library */}
      <SectionHeader label="Library" id="sh3-library" open={libraryOpen} onClick={toggleLibrary} />
      <div className="side-section" id="librarySection" style={{ display: libraryOpen ? 'block' : 'none' }}>
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
          id="download-queue-sidebar"
          label="Download Queue"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>}
          onClick={() => setView('download-queue')}
          isActive={currentView.value === 'download-queue'}
        />
        {renderSectionPlugins('library')}
      </div>

      {/* Browse */}
      <><div className="side-sep"></div>
      <SectionHeader label="Browse" id="sh3-browse" open={browseOpen} onClick={toggleBrowse} />
      <div style={{ display: browseOpen ? 'block' : 'none' }}>
        <div className="side-section" id="browseSection">
          <SidebarItem
            id="categories-view-sidebar"
            label="Folders"
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>}
            onClick={() => setView('folders', 'showCategoriesView')}
            isActive={currentView.value === 'folders'}
          />
          <SidebarItem
            id="actor-sidebar"
            label="Actors"
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" /></svg>}
            onClick={() => setView('actors', 'showActors')}
            isActive={currentView.value === 'actors'}
          />
          <SidebarItem
            id="channel-sidebar"
            label="Channels"
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><rect x="2" y="7" width="20" height="15" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /><line x1="12" y1="12" x2="12" y2="16" /><line x1="10" y1="14" x2="14" y2="14" /></svg>}
            onClick={() => setView('channels', 'showChannels')}
            isActive={currentView.value === 'channels'}
          />
          <SidebarItem
            id="chapters-sidebar"
            label="Chapters"
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>}
            onClick={() => setView('chapters', 'showChaptersView')}
            isActive={currentView.value === 'chapters'}
          />
        </div>
        <SidebarItem
          id="search-sites-sidebar"
          label="Search"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /><path d="M11 8v6M8 11h6" /></svg>}
          onClick={() => setView('search', 'showSearchSites')}
          isActive={currentView.value === 'search'}
        />
        <SidebarItem
          id="import-favs-sidebar"
          label="Links"
          badge={linkCount > 0 ? linkCount : undefined}
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>}
          onClick={() => setView('links', 'showImportFavs')}
          isActive={currentView.value === 'links'}
        />
        {renderSectionPlugins('browse')}
      </div>
      </>

      {/* Media */}
      <><div className="side-sep"></div>
      <SectionHeader label="Media" id="sh3-media" open={mediaOpen} onClick={toggleMedia} />
      <div className="side-section" id="mediaSection" style={{ display: mediaOpen ? 'block' : 'none' }}>
        <SidebarItem
          id="videos-media-sidebar"
          label="Videos"
          badge={vids.filter(v => !(v as any).isLink).length || undefined}
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><path d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9A2.25 2.25 0 0 0 13.5 5.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>}
          onClick={() => setView('hub', 'goHome')}
          isActive={currentView.value === 'hub' && !currentFolder.value}
        />
        <SidebarItem
          id="series-sidebar"
          label="Series"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><rect x="2" y="7" width="20" height="15" rx="2" /><polyline points="17 2 12 7 7 2" /></svg>}
          onClick={() => setView('series')}
          isActive={currentView.value === 'series'}
        />
        <SidebarItem
          id="photos-sidebar"
          label="Photos"
          badge={mc.photos || undefined}
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
          id="screenshots-sidebar"
          label="Screenshots"
          badge={mc.screenshots || undefined}
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>}
          onClick={() => setView('screenshots')}
          isActive={currentView.value === 'screenshots'}
        />
        <SidebarItem
          id="audio-sidebar"
          label="Audio"
          badge={mc.audio || undefined}
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>}
          onClick={() => setView('audio', 'showAudio')}
          isActive={currentView.value === 'audio'}
        />
        <SidebarItem
          id="books-sidebar"
          label="Books"
          badge={mc.books || undefined}
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>}
          onClick={() => setView('books', 'showBooks')}
          isActive={currentView.value === 'books'}
        />
        <SidebarItem
          id="files-sidebar"
          label="Files"
          badge={mc.files || undefined}
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>}
          onClick={() => setView('files')}
          isActive={currentView.value === 'files'}
        />
        <SidebarItem
          id="pages-sidebar"
          label="Pages"
          badge={mc.pages || undefined}
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></svg>}
          onClick={() => setView('pages', 'showPages')}
          isActive={currentView.value === 'pages'}
        />
        <SidebarItem
          id="thumbnails-sidebar"
          label="Thumbnails"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>}
          onClick={() => setView('thumbnails')}
          isActive={currentView.value === 'thumbnails'}
        />
        {renderSectionPlugins('media')}
      </div>
      </>

      {/* Plugins — only plugins without a sidebarSection (unplaced plugins) */}
      {pluginsList.value.some(p => p.location === 'sidebar' && !p.sidebarSection && isPluginEnabled(p.id)) && <>
        <div className="side-sep"></div>
        <SectionHeader label="Plugins" id="sh3-plugins" open={pluginsOpen} onClick={togglePlugins} />
        <div className="side-section" id="pluginsSection" style={{ display: pluginsOpen ? 'block' : 'none' }}>
          {pluginsList.value.filter(p => p.location === 'sidebar' && !p.sidebarSection && isPluginEnabled(p.id)).map(p => (
            <SidebarItem
              key={p.id}
              label={p.name}
              icon={p.icon ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  style={{ verticalAlign: '-2px', marginRight: '5px' }}
                  dangerouslySetInnerHTML={{ __html: p.icon }}
                />
              ) : undefined}
              onClick={() => runPluginAction(p, currentView)}
              isActive={p.type === 'view' && currentView.value === p.view}
            />
          ))}
        </div>
      </>}

      {/* Tools */}
      <div className="side-sep"></div>
      <SectionHeader label="Tools" id="sh3-manage" open={manageOpen} onClick={toggleManage} />
      <div className="side-section" id="manageSection" style={{ display: manageOpen ? 'block' : 'none' }}>
        <SidebarItem
          id="subtitles-sidebar"
          label="Subtitles"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M6 11h4"/><path d="M6 15h8"/><path d="M16 3l-4-2-4 2"/></svg>}
          onClick={() => setView('subtitles')}
          isActive={currentView.value === 'subtitles'}
        />
        <SidebarItem
          id="categorizer-sidebar"
          label="Categorizer"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>}
          onClick={() => setView('categorizer')}
          isActive={currentView.value === 'categorizer'}
        />
        <SidebarItem
          id="duplicates-sidebar"
          label="Duplicates"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>}
          onClick={() => setView('duplicates')}
          isActive={currentView.value === 'duplicates'}
        />
        {renderSectionPlugins('tools')}
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
    </>
  );

  const filterContent = (
    <>
      {/* Vault folders — shown only when vault is open */}
      {inVaultMode && vaultFolders.length > 0 && (
        <>
          <div className="side-sep"></div>
          <SectionHeader
            label="Vault Folders"
            id="sh3-vault-folders"
            open={vaultFoldersOpen}
            onClick={toggleVaultFolders}
          />
          <div className="side-section" id="vaultFoldersSection" style={{ display: vaultFoldersOpen ? 'block' : 'none' }}>
            {vaultFolders.map(f => (
              <SidebarItem
                key={f.id}
                label={f.name}
                icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--ac)" strokeWidth={2} style={iconStyle}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>}
                onClick={() => { (window as any)._vaultSetFolder?.(f.id); }}
                indent
              />
            ))}
          </div>
        </>
      )}

      {/* Categories — encrypted-only in vault mode */}
      {(!inVaultMode || displayFolders.length > 0) && (
        <>
          <div className="side-sep"></div>
          <SectionHeader
            label={inVaultMode ? 'Encrypted Folders' : 'Folders'}
            id="sh3-cats"
            open={catsOpen}
            onClick={toggleCats}
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
            <SidebarItem
              label="All Videos"
              badge={filteredVids.length}
              onClick={() => { currentView.value = 'browse'; currentFolder.value = ''; currentTag.value = null; currentTagTerms.value = []; isSidebarOpen.value = false; }}
              isActive={!currentFolder.value && !currentTag.value}
            />
            {pinnedCats.map(c => (
              <SidebarItem
                key={`pin-${c.path}`}
                label={c.name}
                badge={c.count}
                icon={<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none" style={{ ...iconStyle, color: 'var(--ac)' }}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>}
                onClick={() => selectCategory(c.path)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if ((window as any).showContextMenu) {
                    (window as any).showContextMenu(e, 'folder', { path: c.path, name: c.name, encrypted: !!c.encrypted, partial: !!c.partial });
                  }
                }}
                isActive={currentFolder.value === c.path}
              />
            ))}
            {categoryTree.map(node => renderCategoryNode(node, 0))}
            {inVaultMode && displayFolders.length === 0 && (
              <div style={{ padding: '6px 16px', fontSize: '0.8rem', color: 'var(--tx3)' }}>No encrypted folders</div>
            )}
          </div>
        </>
      )}

      {/* Tags — hidden in vault mode */}
      {!inVaultMode && (
        <>
          <div className="side-sep" id="tags-sep"></div>
          <SectionHeader
            label="Tags"
            id="sh3-tags"
            open={tagsOpen}
            onClick={toggleTags}
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
            {pinnedTagsList.map(t => (
              <SidebarItem
                key={`pintag-${t.name}`}
                label={t.name}
                badge={t.count}
                icon={<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none" style={{ ...iconStyle, color: 'var(--ac)' }}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>}
                onClick={() => {
                  currentFolder.value = '';
                  currentTag.value = t.name;
                  currentTagTerms.value = t.terms;
                  searchQuery.value = '';
                  currentView.value = 'browse';
                  isSidebarOpen.value = false;
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if ((window as any).showContextMenu) {
                    (window as any).showContextMenu(e, 'tag', { name: t.name, terms: t.terms, onRefresh: reloadTags });
                  }
                }}
                isActive={currentTag.value === t.name}
              />
            ))}
            {displayTags.filter(t => !(appPrefs.value.pinnedTags || []).includes(t.name)).map(t => (
              <SidebarItem
                key={t.name}
                id={`tag-${t.name}`}
                label={t.name}
                badge={t.count}
                icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /></svg>}
                onClick={() => {
                  currentFolder.value = '';
                  currentTag.value = t.name;
                  currentTagTerms.value = t.terms;
                  searchQuery.value = '';
                  currentView.value = 'browse';
                  isSidebarOpen.value = false;
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if ((window as any).showContextMenu) {
                    (window as any).showContextMenu(e, 'tag', { name: t.name, terms: t.terms, onRefresh: reloadTags });
                  }
                }}
                isActive={currentTag.value === t.name}
              />
            ))}
          </div>
        </>
      )}
    </>
  );

  if (isTwoPane) {
    return (
      <>
        {isOpen && <div className="sidebar-overlay" onClick={() => isSidebarOpen.value = false} />}
        <div ref={scrollRef} className="side-scroll side-nav-pane" style={opacityStyle}>
          {navContent}
        </div>
        <div ref={filterScrollRef} className="side-scroll side-filter-pane" style={opacityStyle}>
          {filterContent}
        </div>
      </>
    );
  }

  return (
    <>
      {isOpen && <div className="sidebar-overlay" onClick={() => isSidebarOpen.value = false} />}
      <div ref={scrollRef} className="side-scroll" style={opacityStyle}>
        {navContent}
        {filterContent}
      </div>
    </>
  );
};
