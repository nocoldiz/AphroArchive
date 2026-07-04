import { useState, useEffect, useMemo, useRef } from 'preact/hooks';
import { currentView, currentFolder, folders, currentTag, currentTagTerms, appPrefs, sourceFilter, allVideos, isVaultUnlocked, searchQuery, isLoadingVideos, activeProfile, dbPendingOpen, isSidebarOpen, closeOpenedFolder, unlockZipCategory, linkTotalCount } from '../../store';
import { placementFor, openMoveMenu, FILTER_IDS, sectionPlacementFor, openSectionMoveMenu, getNavItems, navIcon, type NavSection, isDropdownShrunken, toggleDropdownShrunken, pluginGroupLocation, pluginInGroup, PLUGINS_GROUP_ID } from './navItems';
import { pluginsList, isPluginEnabled, runPluginAction, type PluginMeta } from '../../plugins';
import { zapOn } from '../../zap';
import { isTVMode } from '../../tv-mode';

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
  action?: any;
}

export const SidebarItem = ({ id, label, icon, badge, onClick, onDragOver, onDragLeave, onDrop, onContextMenu, isActive, indent, depth, hasChildren, expanded, onToggleExpand, action }: SidebarItemProps) => {
  const isTree = depth !== undefined;
  const style: any = isTree
    ? { paddingLeft: `${16 + depth! * 16}px`, fontSize: '0.85rem' }
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
      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
        {badge !== undefined && <span className="count-badge">{badge}</span>}
        {action}
      </span>
    </div>
  );
};

const iconStyle = { verticalAlign: '-2px', marginRight: '5px' };

function useScopedVids(linksOnly: boolean) {
  const vids = allVideos.value;
  return useMemo(() => vids.filter(v => !!(v as any).isLink === linksOnly), [vids, linksOnly]);
}

interface CatTreeNode { cat: any; children: CatTreeNode[] }

export interface FoldersFilterControl {
  expandAll: () => void;
  collapseAll: () => void;
  isAllExpanded: () => boolean;
}

export const FoldersFilter = ({ onNavigate, filter = '', controlRef }: { onNavigate?: () => void, filter?: string, controlRef?: { current: FoldersFilterControl | null } }) => {
  const inVaultMode = isVaultUnlocked.value && currentView.value === 'vault';
  const filteredVids = useScopedVids(false);
  const fq = filter.trim().toLowerCase();

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
      if (c.path === 'uncategorized') {
        const count = filteredVids.filter((v: any) => !v.catPath || v.catPath === '').length;
        return { ...c, count };
      }
      const cl = c.path.toLowerCase();
      const local = filteredVids.filter(v => {
        const vp = ((v as any).catPath || '').toLowerCase();
        return vp === cl || vp.startsWith(cl + '/');
      }).length;
      const count = ((c.encrypted || c.partial) && local === 0) ? (c.count || 0) : local;
      return { ...c, count };
    })
    .sort((a, b) => {
      if (a.path === 'uncategorized') return -1;
      if (b.path === 'uncategorized') return 1;
      return a.name.localeCompare(b.name);
    }), [folders.value, filteredVids]);

  // A folder is hidden when its path equals, or lives under, any hiddenFolders
  // entry. Hidden folders vanish from the tree instantly (they still surface via
  // the pinned section if pinned). Vault mode ignores hiding.
  const isFolderHidden = useMemo(() => {
    const hidden = (inVaultMode ? [] : (appPrefs.value.hiddenFolders || []))
      .map(h => h.toLowerCase().replace(/\\/g, '/'));
    return (path: string) => {
      if (!hidden.length) return false;
      const p = path.toLowerCase().replace(/\\/g, '/');
      return hidden.some(h => p === h || p.startsWith(h + '/'));
    };
  }, [appPrefs.value.hiddenFolders, inVaultMode]);

  const categoryTree = useMemo(() => {
    const hideEmpty = !!appPrefs.value.hideEmptyFolders && !isLoadingVideos.value;
    let list = hideEmpty ? displayFolders.filter(c => c.count > 0) : displayFolders;
    list = list.filter(c => !isFolderHidden(c.path));
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
  }, [displayFolders, appPrefs.value.hideEmptyFolders, isLoadingVideos.value, isFolderHidden]);

  const expandablePaths = useMemo(() => {
    const paths: string[] = [];
    const collect = (nodes: CatTreeNode[]) => {
      for (const n of nodes) { if (n.children.length > 0) { paths.push(n.cat.path); collect(n.children); } }
    };
    collect(categoryTree);
    return paths;
  }, [categoryTree]);

  if (controlRef) {
    controlRef.current = {
      expandAll: () => {
        const next = new Set(expandablePaths);
        setExpandedFolders(next);
        localStorage.setItem('sidebarFolderExpanded', JSON.stringify([...next]));
      },
      collapseAll: () => {
        setExpandedFolders(new Set());
        localStorage.setItem('sidebarFolderExpanded', '[]');
      },
      isAllExpanded: () => expandablePaths.length > 0 && expandablePaths.every(p => expandedFolders.has(p)),
    };
  }

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
    sourceFilter.value = 'local';
    isSidebarOpen.value = false;
    (window as any).cat = catName;
    if ((window as any).showCategory) (window as any).showCategory(catName);
    onNavigate?.();
  };

  const renderCategoryNode = (node: CatTreeNode, depth: number): any => {
    const c = node.cat;
    const openIcon = c.opened
      ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--ac)" strokeWidth="2" style={{ marginRight: '5px', verticalAlign: '-1px' }}><path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v3" /><path d="M2 13.5 4 19a2 2 0 0 0 1.9 1.4h12.2A2 2 0 0 0 20 19l2-5.5a1 1 0 0 0-.95-1.5H2.95A1 1 0 0 0 2 13.5z" /></svg>
      : null;
    const zipIcon = (c as any).locked
      ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.2" style={{ marginRight: '5px', verticalAlign: '-1px' }}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      : (c as any).isZipMount
        ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--ac)" strokeWidth="2" style={{ marginRight: '5px', verticalAlign: '-1px' }}><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
        : null;
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
          icon={openIcon || zipIcon || lockIcon}
          badge={c.count}
          depth={depth}
          hasChildren={hasChildren}
          expanded={expanded}
          onToggleExpand={() => toggleFolderExpand(c.path)}
          action={depth === 0 && c.opened && c.openedRoot ? (
            <button
              type="button"
              title="Close opened folder"
              onClick={(e: any) => { e.preventDefault(); e.stopPropagation(); closeOpenedFolder(c.openedRoot!); }}
              style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tx3)', padding: '2px' }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          ) : undefined}
          onClick={() => (c as any).locked ? unlockZipCategory(c.path, c.name) : selectCategory(c.path)}
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

  if (fq) {
    const matches = displayFolders.filter(c => c.name.toLowerCase().includes(fq) && !isFolderHidden(c.path));
    return (
      <>
        {inVaultMode && vaultFolders.filter(f => f.name.toLowerCase().includes(fq)).map(f => (
          <SidebarItem
            key={`vf-${f.id}`}
            label={f.name}
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--ac)" strokeWidth={2} style={iconStyle}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>}
            onClick={() => { (window as any)._vaultSetFolder?.(f.id); onNavigate?.(); }}
            indent
          />
        ))}
        {matches.map(c => renderCategoryNode({ cat: c, children: [] }, 0))}
        {matches.length === 0 && (
          <div style={{ padding: '6px 16px', fontSize: '0.8rem', color: 'var(--tx3)' }}>No matching folders</div>
        )}
      </>
    );
  }

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
          sourceFilter.value = 'local';
          isSidebarOpen.value = false;
          onNavigate?.();
        }}
        isActive={!currentFolder.value && !currentTag.value && sourceFilter.value !== 'remote'}
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

type TagGroup = { displayName: string, terms: string[] };
type DisplayTag = { name: string, terms: string[], count: number };

let tagGroupsCache: TagGroup[] | null = null;
// Last computed dropdown list (names + counts) per scope, so reopening paints
// instantly from cache before the deferred revalidation recompute runs.
const computedTagsCache: Record<string, DisplayTag[]> = {};

function computeDisplayTags(groups: TagGroup[], vids: any[], hiddenTags: string[]): DisplayTag[] {
  const hidden = new Set(hiddenTags);
  return groups
    .filter(g => !hidden.has(g.displayName))
    .map(g => {
      const nameLo = g.displayName.toLowerCase();
      // Compile each term's matcher once per group rather than once per video.
      const regexes = g.terms.map(t =>
        new RegExp('(?:^|[^a-z0-9])' + t.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|[^a-z0-9])')
      );
      const count = vids.filter(v => {
        const vtags = (v.tags || []) as string[];
        if (vtags.some(t => t.toLowerCase() === nameLo)) return true;
        const vname = (v.name || '').toLowerCase();
        return regexes.some(re => re.test(vname));
      }).length;
      return { name: g.displayName, terms: g.terms, count };
    })
    .filter(t => t.count > 0)
    .sort((a, b) => b.count - a.count);
}

export const TagsFilter = ({ onNavigate, linksOnly = false, filter = '' }: { onNavigate?: () => void, linksOnly?: boolean, filter?: string }) => {
  const cacheKey = linksOnly ? 'links' : 'vids';
  const [tagGroups, setTagGroups] = useState<TagGroup[]>(() => tagGroupsCache || []);
  const [displayTags, setDisplayTags] = useState<DisplayTag[]>(() => computedTagsCache[cacheKey] || []);
  const filteredVids = useScopedVids(linksOnly);
  const fq = filter.trim().toLowerCase();

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

  // Recompute counts off the render path: the dropdown paints from the cached
  // list first, then this effect refreshes it (and repopulates the cache).
  useEffect(() => {
    const result = computeDisplayTags(tagGroups, filteredVids, appPrefs.value.hiddenTags || []);
    computedTagsCache[cacheKey] = result;
    setDisplayTags(result);
  }, [tagGroups, filteredVids, appPrefs.value.hiddenTags, cacheKey]);

  // After showing cached data, immediately request fresh tag data.
  useEffect(() => {
    reloadTags();
    (window as any)._sidebarReloadTags = reloadTags;
    return () => { delete (window as any)._sidebarReloadTags; };
  }, [activeProfile.value]);

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
    sourceFilter.value = linksOnly ? 'remote' : 'local';
    isSidebarOpen.value = false;
    onNavigate?.();
  };

  const ctxMenu = (e: any, t: { name: string, terms: string[] }) => {
    e.preventDefault();
    if ((window as any).showContextMenu) {
      (window as any).showContextMenu(e, 'tag', { name: t.name, terms: t.terms, onRefresh: reloadTags });
    }
  };

  const matchName = (name: string) => !fq || name.toLowerCase().includes(fq);

  return (
    <>
      <SidebarItem
        label="All Videos"
        badge={filteredVids.length}
        onClick={() => {
          currentView.value = 'browse';
          currentFolder.value = '';
          currentTag.value = null; currentTagTerms.value = [];
          sourceFilter.value = linksOnly ? 'remote' : 'local';
          isSidebarOpen.value = false;
          onNavigate?.();
        }}
        isActive={!currentFolder.value && !currentTag.value && sourceFilter.value !== (linksOnly ? 'local' : 'remote')}
      />
      {pinnedTagsList.filter(t => matchName(t.name)).map(t => (
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
      {displayTags.filter(t => !(appPrefs.value.pinnedTags || []).includes(t.name) && matchName(t.name)).map(t => (
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

export const LinksFilter = ({ onNavigate, filter = '' }: { onNavigate?: () => void, filter?: string }) => {
  const total = linkTotalCount.value;
  const fq = filter.trim().toLowerCase();
  return (
    <>
      {(!fq || 'all links'.includes(fq)) && (
      <SidebarItem
        label="All Links"
        badge={total || undefined}
        icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={iconStyle}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>}
        onClick={() => {
          currentView.value = 'links';
          currentFolder.value = '';
          currentTag.value = null; currentTagTerms.value = [];
          searchQuery.value = '';
          sourceFilter.value = 'remote';
          isSidebarOpen.value = false;
          if ((window as any).showImportFavs) (window as any).showImportFavs();
          onNavigate?.();
        }}
        isActive={currentView.value === 'links'}
      />
      )}
      <TagsFilter onNavigate={onNavigate} linksOnly filter={filter} />
    </>
  );
};

const Chevron = ({ open }: { open: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
    style={{ marginLeft: '4px', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--tr)' }}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

/** Button shown inside an open dropdown header to collapse its trigger to icon-only or expand it back. */
const ShrinkBtn = ({ dropdownId }: { dropdownId: string }) => {
  const shrunken = isDropdownShrunken(dropdownId);
  return (
    <button
      type="button"
      className="sidebar-heading-add"
      title={shrunken ? 'Show label' : 'Collapse to icon only'}
      onClick={(e: any) => { e.stopPropagation(); toggleDropdownShrunken(dropdownId); }}
      style={{ opacity: 0.7 }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        {shrunken
          ? <><polyline points="9 18 15 12 9 6"/><line x1="15" y1="18" x2="15" y2="6"/></>
          : <><polyline points="15 18 9 12 15 6"/><line x1="9" y1="18" x2="9" y2="6"/></>
        }
      </svg>
    </button>
  );
};

const sectionIconPaths: Record<NavSection, any> = {
  library: <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></>,
  media: <><rect x="2" y="2" width="20" height="20" rx="2" /><line x1="7" y1="2" x2="7" y2="22" /><line x1="17" y1="2" x2="17" y2="22" /><line x1="2" y1="12" x2="22" y2="12" /></>,
  tools: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
};

const sectionLabels: Record<NavSection, string> = { library: 'Library', media: 'Media', tools: 'Tools' };
const sectionOrder: NavSection[] = ['library', 'media', 'tools'];
const dropdownItemStyle = { verticalAlign: '-2px', marginRight: '5px' };

export const SectionDropdowns = () => {
  const [open, setOpen] = useState<NavSection | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const activeSections = sectionOrder.filter(s => sectionPlacementFor(s) === 'topbar');
  if (!activeSections.length) return null;

  const navItems = getNavItems();
  const placements = (appPrefs.value.itemPlacements || {}) as Record<string, string>;

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

  return (
    <div className="filter-dropdowns" ref={ref}>
      {activeSections.map(sec => {
        // Only items with no explicit placement belong in the dropdown
        const items = navItems.filter(it => it.section === sec && !placements[it.id]);
        const label = sectionLabels[sec];
        const shrinkId = `section-${sec}`;
        const shrunken = isDropdownShrunken(shrinkId);
        return (
          <div className="filter-dropdown" key={sec}>
            <button
              type="button"
              className={`filter-dropdown-btn${open === sec ? ' on' : ''}`}
              onClick={() => setOpen(o => o === sec ? null : sec)}
              onContextMenu={(e) => { e.preventDefault(); openSectionMoveMenu(e, sec, label, 'topbar'); }}
            >
              {navIcon(sectionIconPaths[sec], 14, { marginRight: shrunken ? '0' : '6px' })}
              {!shrunken && label}
              <Chevron open={open === sec} />
            </button>
            {open === sec && (
              <div className="filter-dropdown-menu">
                <div className="filter-dropdown-head">
                  <span>{label}</span>
                  <ShrinkBtn dropdownId={shrinkId} />
                </div>
                <div className="filter-dropdown-body">
                  {items.map(item => (
                    <SidebarItem
                      key={item.id}
                      label={item.label}
                      icon={navIcon(item.paths, 13, dropdownItemStyle)}
                      badge={item.badge}
                      isActive={item.isActive}
                      onClick={() => { item.onClick(); setOpen(null); }}
                      onContextMenu={(e) => { e.preventDefault(); openMoveMenu(e, item.id, item.label, 'topbar-dropdown'); }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

/** A single topbar dropdown grouping every plugin the user hasn't pinned elsewhere. */
export const PluginsDropdown = () => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const view = currentView.value;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (pluginGroupLocation() !== 'topbar') return null;

  const plugins = pluginsList.value.filter(p =>
    pluginInGroup(p) && isPluginEnabled(p.id) && (!p.contexts || p.contexts.includes(view))
  );
  if (!plugins.length) return null;

  const shrinkId = PLUGINS_GROUP_ID;
  const shrunken = isDropdownShrunken(shrinkId);

  const isActive = (p: PluginMeta) => {
    if (p.type === 'toggle' && p.toggleAction === 'toggleZapping') return zapOn.value;
    if (p.type === 'toggle' && p.toggleAction === 'toggleTVMode') return isTVMode.value;
    if (p.type === 'view') return view === p.view;
    return false;
  };

  return (
    <div className="filter-dropdowns" ref={ref}>
      <div className="filter-dropdown">
        <button
          type="button"
          className={`filter-dropdown-btn${open ? ' on' : ''}`}
          onClick={() => setOpen(o => !o)}
          onContextMenu={(e) => { e.preventDefault(); openMoveMenu(e, PLUGINS_GROUP_ID, 'Plugins', 'topbar'); }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ marginRight: shrunken ? '0' : '6px' }}>
            <path d="M4 7h3a2 2 0 0 0 2-2 2 2 0 0 1 4 0 2 2 0 0 0 2 2h3a1 1 0 0 1 1 1v3a2 2 0 0 0 2 2 2 2 0 0 1 0 4 2 2 0 0 0-2 2v3a1 1 0 0 1-1 1h-3a2 2 0 0 1-2-2 2 2 0 0 0-4 0 2 2 0 0 1-2 2H4a1 1 0 0 1-1-1v-3a2 2 0 0 0-2-2 2 2 0 0 1 0-4 2 2 0 0 0 2-2V8a1 1 0 0 1 1-1z" />
          </svg>
          {!shrunken && 'Plugins'}
          <Chevron open={open} />
        </button>
        {open && (
          <div className="filter-dropdown-menu">
            <div className="filter-dropdown-head">
              <span>Plugins</span>
              <ShrinkBtn dropdownId={shrinkId} />
            </div>
            <div className="filter-dropdown-body">
              {plugins.map(p => (
                <SidebarItem
                  key={p.id}
                  label={p.name}
                  icon={p.icon
                    ? navIcon(<g dangerouslySetInnerHTML={{ __html: p.icon }} />, 13, dropdownItemStyle)
                    : navIcon(<circle cx="12" cy="12" r="5" />, 13, dropdownItemStyle)}
                  isActive={isActive(p)}
                  onClick={() => { runPluginAction(p, currentView); setOpen(false); }}
                  onContextMenu={(e) => { e.preventDefault(); openMoveMenu(e, p.id, p.name, 'topbar-dropdown'); }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const FilterDropdowns = () => {
  const inVaultMode = isVaultUnlocked.value && currentView.value === 'vault';
  const view = currentView.value;
  const [open, setOpen] = useState<null | 'folders' | 'tags' | 'links'>(null);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const folderCtrlRef = useRef<FoldersFilterControl | null>(null);
  const [, folderForceUpdate] = useState(0);

  const showFolders = placementFor(FILTER_IDS.folders, 'topbar') === 'topbar';
  const showTags = placementFor(FILTER_IDS.tags, 'sidebar') === 'topbar' && !inVaultMode;
  const showLinks = placementFor(FILTER_IDS.links, 'topbar') === 'topbar' && !inVaultMode;

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

  const close = () => { setOpen(null); setQuery(''); };
  const toggle = (which: 'folders' | 'tags' | 'links') =>
    setOpen(o => { const next = o === which ? null : which; setQuery(''); return next; });
  const searchBar = (placeholder: string) => (
    <div className="filter-dropdown-search">
      <input
        type="text"
        placeholder={placeholder}
        value={query}
        autoFocus
        onInput={(e: any) => setQuery(e.currentTarget.value)}
        onClick={(e: any) => e.stopPropagation()}
      />
    </div>
  );
  const addBtn = (onClick: () => void, title: string) => (
    <button type="button" className="sidebar-heading-add" title={title} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>
  );

  if (!showFolders && !showTags && !showLinks) return null;

  return (
    <div className="filter-dropdowns" ref={ref}>
      {showFolders && (
      <div className="filter-dropdown">
        <button
          type="button"
          className={`filter-dropdown-btn${open === 'folders' ? ' on' : ''}`}
          onClick={() => toggle('folders')}
          onContextMenu={(e) => { e.preventDefault(); openMoveMenu(e, FILTER_IDS.folders, 'Folders', 'topbar'); }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ marginRight: isDropdownShrunken('filter-folders') ? '0' : '6px' }}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
          {!isDropdownShrunken('filter-folders') && (inVaultMode ? 'Encrypted Folders' : 'Folders')}
          {isLoadingVideos.value && <span className="sidebar-loading-spin" style={{ marginLeft: '6px' }} />}
          <Chevron open={open === 'folders'} />
        </button>
        {open === 'folders' && (
          <div className="filter-dropdown-menu">
            <div className="filter-dropdown-head">
              <span>{inVaultMode ? 'Encrypted Folders' : 'Folders'}</span>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                {!inVaultMode && addBtn(() => (window as any).createFolder?.(), 'New folder')}
                <button type="button" className="sidebar-heading-add"
                  title={folderCtrlRef.current?.isAllExpanded() ? 'Collapse all' : 'Expand all'}
                  onClick={(e: any) => {
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
                <ShrinkBtn dropdownId="filter-folders" />
              </div>
            </div>
            {searchBar('Search folders…')}
            <div className="filter-dropdown-body">
              <FoldersFilter onNavigate={close} filter={query} controlRef={folderCtrlRef} />
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
            onClick={() => toggle('tags')}
            onContextMenu={(e) => { e.preventDefault(); openMoveMenu(e, FILTER_IDS.tags, 'Tags', 'topbar'); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ marginRight: isDropdownShrunken('filter-tags') ? '0' : '6px' }}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /></svg>
            {!isDropdownShrunken('filter-tags') && 'Tags'}
            <Chevron open={open === 'tags'} />
          </button>
          {open === 'tags' && (
            <div className="filter-dropdown-menu">
              <div className="filter-dropdown-head">
                <span>Tags</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {addBtn(() => { currentView.value = 'database'; dbPendingOpen.value = { tab: 'folders', action: 'add' }; close(); }, 'New tag group')}
                  <ShrinkBtn dropdownId="filter-tags" />
                </div>
              </div>
              {searchBar('Search tags…')}
              <div className="filter-dropdown-body">
                <TagsFilter onNavigate={close} filter={query} />
              </div>
            </div>
          )}
        </div>
      )}

      {showLinks && (
        <div className="filter-dropdown">
          <button
            type="button"
            className={`filter-dropdown-btn${open === 'links' ? ' on' : ''}`}
            onClick={() => toggle('links')}
            onContextMenu={(e) => { e.preventDefault(); openMoveMenu(e, FILTER_IDS.links, 'Links', 'topbar'); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ marginRight: isDropdownShrunken('filter-links') ? '0' : '6px' }}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
            {!isDropdownShrunken('filter-links') && 'Links'}
            <Chevron open={open === 'links'} />
          </button>
          {open === 'links' && (
            <div className="filter-dropdown-menu">
              <div className="filter-dropdown-head">
                <span>Links</span>
                <ShrinkBtn dropdownId="filter-links" />
              </div>
              {searchBar('Search links…')}
              <div className="filter-dropdown-body">
                <LinksFilter onNavigate={close} filter={query} />
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
};
