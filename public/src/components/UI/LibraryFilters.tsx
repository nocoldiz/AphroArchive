import { useState, useEffect, useMemo, useRef } from 'preact/hooks';
import { currentView, currentFolder, folders, currentTag, currentTagTerms, appPrefs, sourceFilter, allVideos, isVaultUnlocked, searchQuery, isLoadingVideos, activeProfile, dbPendingOpen, isSidebarOpen } from '../../store';
import { placementFor, openMoveMenu, FILTER_IDS } from './navItems';

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

export const SidebarItem = ({ id, label, icon, badge, onClick, onDragOver, onDragLeave, onDrop, onContextMenu, isActive, indent, depth, hasChildren, expanded, onToggleExpand }: SidebarItemProps) => {
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

const iconStyle = { verticalAlign: '-2px', marginRight: '5px' };

// Shared: the active video list filtered by the source filter (local/remote/all).
function useFilteredVids() {
  const sf = sourceFilter.value;
  const vids = allVideos.value;
  return useMemo(() => sf === 'local'
    ? vids.filter(v => !(v as any).isLink)
    : sf === 'remote'
    ? vids.filter(v => !!(v as any).isLink)
    : vids, [sf, vids]);
}

interface CatTreeNode { cat: any; children: CatTreeNode[] }

/**
 * Folders / categories filter body. Rendered both inside the sidebar (single
 * column layout) and inside the topbar "Folders" dropdown. `onNavigate` lets
 * the dropdown close itself after a folder is chosen (a no-op in the sidebar).
 */
export const FoldersFilter = ({ onNavigate }: { onNavigate?: () => void }) => {
  const inVaultMode = isVaultUnlocked.value && currentView.value === 'vault';
  const filteredVids = useFilteredVids();

  const [vaultFolders, setVaultFolders] = useState<{ id: string, name: string }[]>([]);
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

  const displayFolders = useMemo(() => folders.value
    .map(c => {
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
    .sort((a, b) => {
      if (a.path === 'uncategorized') return -1;
      if (b.path === 'uncategorized') return 1;
      return a.name.localeCompare(b.name);
    }), [folders.value, filteredVids]);

  const categoryTree = useMemo(() => {
    const hideEmpty = !!appPrefs.value.hideEmptyFolders;
    const list = hideEmpty ? displayFolders.filter(c => c.count > 0) : displayFolders;
    const byPath = new Map<string, CatTreeNode>();
    const roots: CatTreeNode[] = [];
    for (const c of list) byPath.set(c.path, { cat: c, children: [] });
    for (const node of byPath.values()) {
      const slash = node.cat.path.lastIndexOf('/');
      const parent = slash === -1 ? undefined : byPath.get(node.cat.path.slice(0, slash));
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }, [displayFolders, appPrefs.value.hideEmptyFolders]);

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

  const selectCategory = (catName: string) => {
    currentView.value = 'browse';
    currentFolder.value = catName;
    currentTag.value = null; currentTagTerms.value = [];
    searchQuery.value = '';
    isSidebarOpen.value = false;
    (window as any).cat = catName;
    if ((window as any).showCategory) (window as any).showCategory(catName);
    onNavigate?.();
  };

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

  return (
    <>
      {inVaultMode && vaultFolders.length > 0 && vaultFolders.map(f => (
        <SidebarItem
          key={`vf-${f.id}`}
          label={f.name}
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--ac)" strokeWidth={2} style={iconStyle}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>}
          onClick={() => { (window as any)._vaultSetFolder?.(f.id); onNavigate?.(); }}
          indent
        />
      ))}
      <SidebarItem
        label="All Videos"
        badge={filteredVids.length}
        onClick={() => {
          currentView.value = 'browse';
          currentFolder.value = '';
          currentTag.value = null; currentTagTerms.value = [];
          isSidebarOpen.value = false;
          onNavigate?.();
        }}
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
    </>
  );
};

let tagGroupsCache: { displayName: string, terms: string[] }[] | null = null;

/**
 * Tags filter body. Rendered both inside the sidebar and the topbar "Tags"
 * dropdown. Owns the tag-group fetch and exposes `_sidebarReloadTags`.
 */
export const TagsFilter = ({ onNavigate }: { onNavigate?: () => void }) => {
  const [tagGroups, setTagGroups] = useState<{ displayName: string, terms: string[] }[]>(() => tagGroupsCache || []);
  const filteredVids = useFilteredVids();

  const reloadTags = () => {
    fetch('/api/db-tags')
      .then(r => r.json())
      .then((data: any[]) => {
        const groups = data.map(g => ({ displayName: g.displayName, terms: g.terms || [] }));
        tagGroupsCache = groups;
        setTagGroups(groups);
      })
      .catch(() => {});
  };

  useEffect(() => {
    reloadTags();
    (window as any)._sidebarReloadTags = reloadTags;
    return () => { delete (window as any)._sidebarReloadTags; };
  }, [activeProfile.value]);

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

  const pinnedTagsList = useMemo(() => {
    const pins = appPrefs.value.pinnedTags || [];
    if (!pins.length) return [] as typeof displayTags;
    const byName = new Map(displayTags.map(t => [t.name, t]));
    return pins.map(n => byName.get(n)).filter(Boolean) as typeof displayTags;
  }, [appPrefs.value.pinnedTags, displayTags]);

  const selectTag = (t: { name: string, terms: string[] }) => {
    currentFolder.value = '';
    currentTag.value = t.name;
    currentTagTerms.value = t.terms;
    searchQuery.value = '';
    currentView.value = 'browse';
    isSidebarOpen.value = false;
    onNavigate?.();
  };

  const ctxMenu = (e: any, t: { name: string, terms: string[] }) => {
    e.preventDefault();
    if ((window as any).showContextMenu) {
      (window as any).showContextMenu(e, 'tag', { name: t.name, terms: t.terms, onRefresh: reloadTags });
    }
  };

  return (
    <>
      {pinnedTagsList.map(t => (
        <SidebarItem
          key={`pintag-${t.name}`}
          label={t.name}
          badge={t.count}
          icon={<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none" style={{ ...iconStyle, color: 'var(--ac)' }}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>}
          onClick={() => selectTag(t)}
          onContextMenu={(e) => ctxMenu(e, t)}
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
          onClick={() => selectTag(t)}
          onContextMenu={(e) => ctxMenu(e, t)}
          isActive={currentTag.value === t.name}
        />
      ))}
    </>
  );
};

const Chevron = ({ open }: { open: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
    style={{ marginLeft: '4px', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--tr)' }}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

/**
 * The two topbar dropdowns (Folders + Tags) shown right of the logo when the
 * sidebar layout is set to "dropdowns". Closes on outside click / Escape.
 */
export const FilterDropdowns = () => {
  const inVaultMode = isVaultUnlocked.value && currentView.value === 'vault';
  const [open, setOpen] = useState<null | 'folders' | 'tags'>(null);
  const ref = useRef<HTMLDivElement>(null);

  const showFolders = placementFor(FILTER_IDS.folders, 'sidebar') === 'topbar';
  const showTags = placementFor(FILTER_IDS.tags, 'sidebar') === 'topbar' && !inVaultMode;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(null);
  const addBtn = (onClick: () => void, title: string) => (
    <button type="button" className="sidebar-heading-add" title={title} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>
  );

  if (!showFolders && !showTags) return null;

  return (
    <div className="filter-dropdowns" ref={ref}>
      {showFolders && (
      <div className="filter-dropdown">
        <button
          type="button"
          className={`filter-dropdown-btn${open === 'folders' ? ' on' : ''}`}
          onClick={() => setOpen(o => o === 'folders' ? null : 'folders')}
          onContextMenu={(e) => { e.preventDefault(); openMoveMenu(e, FILTER_IDS.folders, 'Folders', 'topbar'); }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ marginRight: '6px' }}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
          {inVaultMode ? 'Encrypted Folders' : 'Folders'}
          {isLoadingVideos.value && <span className="sidebar-loading-spin" style={{ marginLeft: '6px' }} />}
          <Chevron open={open === 'folders'} />
        </button>
        {open === 'folders' && (
          <div className="filter-dropdown-menu">
            {!inVaultMode && (
              <div className="filter-dropdown-head">
                <span>Folders</span>
                {addBtn(() => (window as any).createFolder?.(), 'New folder')}
              </div>
            )}
            <div className="filter-dropdown-body">
              <FoldersFilter onNavigate={close} />
            </div>
          </div>
        )}
      </div>
      )}

      {showTags && (
        <div className="filter-dropdown">
          <button
            type="button"
            className={`filter-dropdown-btn${open === 'tags' ? ' on' : ''}`}
            onClick={() => setOpen(o => o === 'tags' ? null : 'tags')}
            onContextMenu={(e) => { e.preventDefault(); openMoveMenu(e, FILTER_IDS.tags, 'Tags', 'topbar'); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ marginRight: '6px' }}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /></svg>
            Tags
            <Chevron open={open === 'tags'} />
          </button>
          {open === 'tags' && (
            <div className="filter-dropdown-menu">
              <div className="filter-dropdown-head">
                <span>Tags</span>
                {addBtn(() => { currentView.value = 'database'; dbPendingOpen.value = { tab: 'folders', action: 'add' }; close(); }, 'New tag group')}
              </div>
              <div className="filter-dropdown-body">
                <TagsFilter onNavigate={close} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
