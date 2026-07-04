import { useState, useEffect, useMemo } from 'preact/hooks';
import { moveModalState, loadVideos, videos, allVideos, selectedVideoIds, videoSelMode } from '../../store';
import { moveVideo } from '../../api';
import { Video } from '../../types';

interface MainFolder { name: string; path: string; isExternal?: boolean }
interface VaultFolder { id: string; name: string; parent: string | null }

interface TreeNode {
  key: string;      // unique key (category path or vault folder id)
  label: string;    // leaf name
  target: string;   // value sent to the move API
  depth: number;
  children: TreeNode[];
  isExternal?: boolean;
}

const sortTree = (nodes: TreeNode[]) => {
  nodes.sort((a, b) => a.label.localeCompare(b.label));
  nodes.forEach(n => sortTree(n.children));
};

const buildMainTree = (cats: MainFolder[]): TreeNode[] => {
  const byPath = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  const ensure = (p: string): TreeNode => {
    const found = byPath.get(p);
    if (found) return found;
    const segs = p.split('/');
    const node: TreeNode = { key: p, label: segs[segs.length - 1], target: p, depth: segs.length - 1, children: [] };
    byPath.set(p, node);
    if (segs.length > 1) ensure(segs.slice(0, -1).join('/')).children.push(node);
    else roots.push(node);
    return node;
  };
  for (const c of cats) {
    if (!c.path) continue;
    const n = ensure(c.path);
    n.isExternal = !!c.isExternal;
  }
  sortTree(roots);
  return roots;
};

const buildVaultTree = (folders: VaultFolder[]): TreeNode[] => {
  const byId = new Map<string, TreeNode>(folders.map(f => [f.id, { key: f.id, label: f.name, target: f.id, depth: 0, children: [] }]));
  const roots: TreeNode[] = [];
  for (const f of folders) {
    const node = byId.get(f.id)!;
    const parent = f.parent ? byId.get(f.parent) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const setDepth = (nodes: TreeNode[], d: number) => nodes.forEach(n => { n.depth = d; setDepth(n.children, d + 1); });
  setDepth(roots, 0);
  sortTree(roots);
  return roots;
};

const FolderIcon = ({ open }: { open?: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
    {open
      ? <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
      : <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />}
  </svg>
);

export const MoveModal = () => {
  const state = moveModalState.value;
  const [mainCats, setMainCats] = useState<MainFolder[]>([]);
  const [vaultFolders, setVaultFolders] = useState<VaultFolder[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null); // '' = root, null = nothing selected
  const [error, setError] = useState('');
  const [newCat, setNewCat] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState('');

  // Only a single video has a meaningful "current folder"; a multi-selection
  // can span folders, so nothing is greyed out and per-file "already there"
  // results are reported as skips instead.
  const cur = state.vidIds.length === 1 ? (state.currentFolder || '') : null;

  useEffect(() => {
    if (!state.visible) return;
    setError('');
    setNewCat('');
    setFilter('');
    setSelected(null);
    setBusy('');
    if (state.isVault) {
      fetch('/api/vault/files')
        .then(r => r.json())
        .then((items: any[]) => setVaultFolders(
          items.filter(f => f.type === 'folder')
            .map(f => ({ id: f.id, name: f.name, parent: f.parent || null }))
        ))
        .catch(() => setError('Failed to load vault folders'));
      setExpanded(new Set());
    } else {
      fetch('/api/main-folders')
        .then(r => r.json())
        .then((data: MainFolder[]) => {
          setMainCats(data);
          // Pre-expand the ancestors of the current folder so it is visible.
          const exp = new Set<string>();
          if (state.currentFolder) {
            const segs = state.currentFolder.split('/');
            for (let i = 1; i < segs.length; i++) exp.add(segs.slice(0, i).join('/'));
          }
          setExpanded(exp);
        })
        .catch(() => setError('Failed to load folders'));
    }
  }, [state.visible, state.isVault]);

  const tree = useMemo(
    () => state.isVault ? buildVaultTree(vaultFolders) : buildMainTree(mainCats.filter(c => c.path)),
    [state.isVault, mainCats, vaultFolders]
  );

  // Flat search results with full paths (main: server-provided "A / B" names;
  // vault: computed from the parent chain).
  const flatMatches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return null;
    if (state.isVault) {
      const byId = new Map(vaultFolders.map(f => [f.id, f]));
      const fullName = (f: VaultFolder): string => {
        const parts = [f.name];
        let p = f.parent ? byId.get(f.parent) : null;
        while (p) { parts.unshift(p.name); p = p.parent ? byId.get(p.parent) : null; }
        return parts.join(' / ');
      };
      return vaultFolders
        .map(f => ({ key: f.id, label: fullName(f), target: f.id }))
        .filter(f => f.label.toLowerCase().includes(q))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    return mainCats
      .filter(c => c.path && (c.name.toLowerCase().includes(q) || c.path.toLowerCase().includes(q)))
      .map(c => ({ key: c.path, label: c.name, target: c.path, isExternal: !!c.isExternal }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [filter, state.isVault, mainCats, vaultFolders]);

  if (!state.visible) return null;

  const handleClose = () => {
    moveModalState.value = { ...state, visible: false };
  };

  const doMove = async (targetCat: string) => {
    const w = window as any;
    const ids = state.vidIds;
    if (!ids.length) { handleClose(); return; }
    setError('');
    const moved: string[] = [];
    const skipped: string[] = [];
    const failed: string[] = [];

    // Move one file at a time but never abort the batch on a single failure —
    // "already in this folder" / name clashes are skips, everything else is
    // reported at the end. Previously the first error killed the whole run.
    for (let i = 0; i < ids.length; i++) {
      setBusy(`Moving ${i + 1}/${ids.length}…`);
      try {
        if (state.isVault) {
          const r = await fetch(`/api/vault/files/${ids[i]}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder: targetCat || null })
          });
          if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            throw new Error(d.error || 'Failed to move');
          }
        } else {
          await moveVideo(ids[i], targetCat);
        }
        moved.push(ids[i]);
      } catch (e: any) {
        const msg = e.message || 'Failed to move';
        if (/already/i.test(msg)) skipped.push(ids[i]);
        else failed.push(msg);
      }
    }
    setBusy('');

    if (moved.length && !state.isVault) {
      // Optimistically reflect the new folder so the grid and sidebar counts
      // react immediately; loadVideos() then reconciles the authoritative IDs.
      const movedIds = new Set(moved);
      const leaf = targetCat ? (targetCat.split('/').pop() || '') : '';
      const recat = (arr: Video[]) => arr.map(v =>
        movedIds.has(v.id) ? { ...v, catPath: targetCat, category: leaf } : v);
      allVideos.value = recat(allVideos.value);
      videos.value = recat(videos.value);
      selectedVideoIds.value = new Set([...selectedVideoIds.value].filter(id => !movedIds.has(id)));
      videoSelMode.value = selectedVideoIds.value.size > 0;
    }
    if (moved.length) {
      if (state.isVault && w.loadVaultFiles) w.loadVaultFiles();
      await loadVideos();
    }

    if (!moved.length && !skipped.length) {
      setError(failed[0] || 'Failed to move');
      return;
    }
    if (w.toast) {
      const parts = [`Moved ${moved.length}`];
      if (skipped.length) parts.push(`${skipped.length} already there`);
      if (failed.length) parts.push(`${failed.length} failed`);
      w.toast(parts.join(' · '));
    }
    handleClose();
  };

  const handleMoveNew = () => {
    const trimmed = newCat.trim();
    if (!trimmed) return;
    const safe = trimmed.split('/').map(s => s.trim().replace(/[<>:"|?*]/g, '_')).filter(Boolean).join('/');
    if (safe) doMove(safe);
  };

  const toggleExpand = (key: string) => {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpanded(next);
  };

  const collectKeys = (nodes: TreeNode[], acc: string[] = []): string[] => {
    for (const n of nodes) { if (n.children.length) { acc.push(n.key); collectKeys(n.children, acc); } }
    return acc;
  };
  const allBranchKeys = collectKeys(tree);
  const allExpanded = allBranchKeys.length > 0 && allBranchKeys.every(k => expanded.has(k));

  const rowStyle = (isSel: boolean, disabled: boolean, depth: number) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '7px 8px',
    paddingLeft: `${8 + depth * 18}px`,
    borderRadius: '4px',
    cursor: disabled ? 'default' : 'pointer',
    background: isSel ? 'var(--ac)' : 'transparent',
    color: disabled ? 'var(--tx3)' : isSel ? '#fff' : 'var(--tx)',
    userSelect: 'none' as const,
  });

  const Badge = ({ text }: { text: string }) => (
    <span style={{ marginLeft: 'auto', fontSize: '0.65rem', padding: '1px 6px', borderRadius: '8px', border: '1px solid var(--brd)', color: 'inherit', opacity: 0.75, flexShrink: 0 }}>{text}</span>
  );

  const renderRow = (opts: { key: string; label: string; target: string; depth: number; hasChildren?: boolean; isOpen?: boolean; isExternal?: boolean }) => {
    const isCurRow = cur !== null && opts.target === cur;
    const disabled = isCurRow;
    const isSel = selected === opts.target && !disabled;
    return (
      <div
        key={opts.key}
        className="move-item"
        style={rowStyle(isSel, disabled, opts.depth)}
        onClick={() => !disabled && setSelected(opts.target)}
        onDblClick={() => !disabled && !busy && doMove(opts.target)}
      >
        {opts.hasChildren ? (
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            style={{ flexShrink: 0, cursor: 'pointer', transform: opts.isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s' }}
            onClick={(e: any) => { e.stopPropagation(); toggleExpand(opts.key); }}
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        ) : (
          <span style={{ width: '14px', flexShrink: 0 }} />
        )}
        <FolderIcon open={opts.isOpen} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opts.label}</span>
        {opts.isExternal ? <Badge text="media" /> : null}
        {isCurRow && <Badge text="current" />}
      </div>
    );
  };

  const renderTree = (nodes: TreeNode[]): any[] => nodes.flatMap(n => {
    const isOpen = expanded.has(n.key);
    const row = renderRow({ key: n.key, label: n.label, target: n.target, depth: n.depth, hasChildren: n.children.length > 0, isOpen, isExternal: n.isExternal });
    return isOpen ? [row, ...renderTree(n.children)] : [row];
  });

  const count = state.vidIds.length;
  const noun = state.isVault ? (count > 1 ? 'files' : 'file') : (count > 1 ? 'videos' : 'video');

  return (
    <div className="modal-overlay on" onClick={(e: any) => e.target === e.currentTarget && !busy && handleClose()} style={{ zIndex: 20000 }}>
      <div className="modal-content" style={{ background: 'var(--bg2)', padding: '20px', borderRadius: '8px', width: '440px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ marginTop: 0, marginBottom: '4px' }}>Move {count} {noun} to…{state.isVault ? ' (Vault)' : ''}</h3>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px' }}>
          <input
            type="text"
            value={filter}
            onInput={(e: any) => setFilter(e.target.value)}
            placeholder="Filter folders..."
            autoFocus
            style={{ flex: 1, boxSizing: 'border-box', padding: '8px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '4px' }}
          />
          {allBranchKeys.length > 0 && !filter.trim() && (
            <button
              type="button"
              onClick={() => setExpanded(allExpanded ? new Set() : new Set(allBranchKeys))}
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx2)', padding: '7px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
            >
              {allExpanded ? 'Collapse all' : 'Expand all'}
            </button>
          )}
        </div>

        <div className="move-list" style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflowY: 'auto', flex: 1, minHeight: '120px', border: '1px solid var(--brd)', borderRadius: '6px', padding: '6px', marginBottom: '12px' }}>
          {flatMatches ? (
            <>
              {flatMatches.map((m: any) => renderRow({ key: m.key, label: m.label, target: m.target, depth: 0, isExternal: m.isExternal }))}
              {flatMatches.length === 0 && (
                <div style={{ color: 'var(--tx2)', padding: '8px', fontSize: '0.85rem' }}>No folders match "{filter}"</div>
              )}
            </>
          ) : (
            <>
              {renderRow({ key: '__root__', label: state.isVault ? 'Root' : 'Uncategorized (library root)', target: '', depth: 0 })}
              {renderTree(tree)}
            </>
          )}
        </div>

        {!state.isVault && (
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <input
              type="text"
              value={newCat}
              onInput={(e: any) => setNewCat(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && handleMoveNew()}
              placeholder="New folder… (use / to nest)"
              style={{ flex: 1, padding: '8px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '4px' }}
            />
            <button
              type="button"
              onClick={handleMoveNew}
              disabled={!newCat.trim() || !!busy}
              style={{ background: 'var(--ac)', border: 'none', color: '#fff', padding: '8px 12px', borderRadius: '4px', cursor: newCat.trim() && !busy ? 'pointer' : 'default', opacity: newCat.trim() && !busy ? 1 : 0.5 }}
            >
              Create & Move
            </button>
          </div>
        )}

        {error && <div style={{ color: '#e84040', fontSize: '0.8rem', marginBottom: '8px' }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px' }}>
          {busy && <span style={{ marginRight: 'auto', color: 'var(--tx2)', fontSize: '0.85rem' }}>{busy}</span>}
          <button type="button" onClick={handleClose} disabled={!!busy} style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px 14px', borderRadius: '4px', cursor: busy ? 'default' : 'pointer' }}>Cancel</button>
          <button
            type="button"
            onClick={() => selected !== null && doMove(selected)}
            disabled={selected === null || !!busy}
            style={{ background: 'var(--ac)', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: '4px', cursor: selected !== null && !busy ? 'pointer' : 'default', opacity: selected !== null && !busy ? 1 : 0.5, fontWeight: 600 }}
          >
            Move here
          </button>
        </div>
      </div>
    </div>
  );
};
