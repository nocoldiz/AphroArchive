import { useState, useMemo } from 'preact/hooks';

export interface FolderEntry {
  id: string;
  name: string;
  parent: string | null;
  mtime?: number;
}

interface FolderTreeProps {
  folders: FolderEntry[];
  currentFolderId: string | null;
  onNavigate: (id: string | null) => void;
  onCreateFolder?: (name: string, parentId: string | null) => void;
  onRenameFolder?: (id: string, newName: string) => void;
  onDeleteFolder?: (id: string, name: string) => void;
  onMoveFolder?: (id: string, newParentId: string | null) => void;
  // When true, folders are navigation-only: no create/rename/delete/move
  // affordances are shown (used for auto-generated trees like Series).
  readOnly?: boolean;
}

export const FolderTree = ({
  folders,
  currentFolderId,
  onNavigate,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveFolder,
  readOnly,
}: FolderTreeProps) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState<{ id: string; name: string } | null>(null);
  const [showMoveModal, setShowMoveModal] = useState<{ id: string; name: string } | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ id: string; name: string; x: number; y: number } | null>(null);

  // Build breadcrumb trail from root to currentFolderId
  const breadcrumb = useMemo(() => {
    const trail: FolderEntry[] = [];
    let cur = currentFolderId;
    while (cur) {
      const f = folders.find(f => f.id === cur);
      if (!f) break;
      trail.unshift(f);
      cur = f.parent;
    }
    return trail;
  }, [folders, currentFolderId]);

  // Subfolders at current level
  const visibleFolders = useMemo(
    () => folders.filter(f => (f.parent || null) === currentFolderId),
    [folders, currentFolderId]
  );

  // All folders except the one being moved and its subtree (for move-to select)
  const moveTargetOptions = useMemo(() => {
    if (!showMoveModal) return [];
    const excluded = new Set<string>();
    const collectDesc = (id: string) => {
      excluded.add(id);
      for (const f of folders) if (f.parent === id) collectDesc(f.id);
    };
    collectDesc(showMoveModal.id);
    return folders.filter(f => !excluded.has(f.id));
  }, [folders, showMoveModal]);

  const openCreate = () => { setInputValue(''); setShowCreateModal(true); };

  const confirmCreate = () => {
    const name = inputValue.trim();
    if (name) onCreateFolder?.(name, currentFolderId);
    setShowCreateModal(false);
  };

  const openRename = (f: FolderEntry) => {
    setInputValue(f.name);
    setShowRenameModal({ id: f.id, name: f.name });
    setCtxMenu(null);
  };

  const confirmRename = () => {
    const name = inputValue.trim();
    if (showRenameModal && name && name !== showRenameModal.name) onRenameFolder?.(showRenameModal.id, name);
    setShowRenameModal(null);
  };

  const openMove = (f: FolderEntry) => {
    setMoveTarget(f.parent || null);
    setShowMoveModal({ id: f.id, name: f.name });
    setCtxMenu(null);
  };

  const confirmMove = () => {
    if (showMoveModal && onMoveFolder) onMoveFolder(showMoveModal.id, moveTarget);
    setShowMoveModal(null);
  };

  const handleDelete = (f: FolderEntry) => {
    setCtxMenu(null);
    onDeleteFolder?.(f.id, f.name);
  };

  const showCtx = (e: MouseEvent, f: FolderEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ id: f.id, name: f.name, x: e.clientX, y: e.clientY });
  };

  return (
    <div onClick={() => setCtxMenu(null)}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <span
          style={{ cursor: 'pointer', color: 'var(--accent)', fontSize: '0.9rem' }}
          onClick={() => onNavigate(null)}
        >Root</span>
        {breadcrumb.map(f => (
          <>
            <span style={{ color: 'var(--tx2)', fontSize: '0.85rem' }}>/</span>
            <span
              key={f.id}
              style={{ cursor: 'pointer', color: 'var(--accent)', fontSize: '0.9rem' }}
              onClick={() => onNavigate(f.id)}
            >{f.name}</span>
          </>
        ))}
      </div>

      {/* Folder grid */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        {currentFolderId && (
          <div
            style={tileSty}
            onClick={() => onNavigate(breadcrumb.length > 1 ? breadcrumb[breadcrumb.length - 2].id : null)}
            title="Go up"
          >
            <span style={{ fontSize: '1.4rem' }}>📂</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--tx2)' }}>..</span>
          </div>
        )}
        {visibleFolders.map(f => (
          <div
            key={f.id}
            style={tileSty}
            onClick={() => onNavigate(f.id)}
            onContextMenu={readOnly ? undefined : (e: any) => showCtx(e, f)}
            title={f.name}
          >
            <span style={{ fontSize: '1.4rem' }}>📁</span>
            <span style={{ fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>{f.name}</span>
          </div>
        ))}
        {!readOnly && (
          <div style={{ ...tileSty, borderStyle: 'dashed', color: 'var(--tx2)' }} onClick={openCreate} title="New folder">
            <span style={{ fontSize: '1.4rem' }}>➕</span>
            <span style={{ fontSize: '0.8rem' }}>New folder</span>
          </div>
        )}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div
          style={{
            position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 3000,
            background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)', padding: '5px 0', minWidth: 140,
          }}
          onClick={e => e.stopPropagation()}
        >
          {[
            { label: 'Rename', action: () => openRename(folders.find(f => f.id === ctxMenu.id)!) },
            ...(onMoveFolder ? [{ label: 'Move to…', action: () => openMove(folders.find(f => f.id === ctxMenu.id)!) }] : []),
            { label: 'Delete', action: () => handleDelete(folders.find(f => f.id === ctxMenu.id)!), danger: true },
          ].map(item => (
            <div
              key={item.label}
              style={{ padding: '7px 14px', cursor: 'pointer', fontSize: '0.88rem', color: (item as any).danger ? '#e84040' : 'var(--tx)' }}
              onClick={item.action}
            >{item.label}</div>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreateModal && (
        <Modal title="New Folder" onClose={() => setShowCreateModal(false)} onConfirm={confirmCreate} confirmLabel="Create">
          <input
            class="premium-input"
            style={inputSty}
            value={inputValue}
            onInput={(e: any) => setInputValue(e.target.value)}
            onKeyDown={(e: any) => e.key === 'Enter' && confirmCreate()}
            placeholder="Folder name"
            autoFocus
          />
        </Modal>
      )}

      {/* Rename modal */}
      {showRenameModal && (
        <Modal title="Rename Folder" onClose={() => setShowRenameModal(null)} onConfirm={confirmRename} confirmLabel="Rename">
          <input
            class="premium-input"
            style={inputSty}
            value={inputValue}
            onInput={(e: any) => setInputValue(e.target.value)}
            onKeyDown={(e: any) => e.key === 'Enter' && confirmRename()}
            autoFocus
          />
        </Modal>
      )}

      {/* Move modal */}
      {showMoveModal && onMoveFolder && (
        <Modal title={`Move "${showMoveModal.name}" to…`} onClose={() => setShowMoveModal(null)} onConfirm={confirmMove} confirmLabel="Move">
          <select
            class="premium-input"
            style={{ ...inputSty, padding: '8px' }}
            value={moveTarget ?? ''}
            onChange={(e: any) => setMoveTarget(e.target.value || null)}
          >
            <option value="">Root</option>
            {moveTargetOptions.map(f => (
              <option key={f.id} value={f.id}>{_folderPath(f, folders)}</option>
            ))}
          </select>
        </Modal>
      )}
    </div>
  );
};

// Build a display path like "Movies / Action" for a folder entry
function _folderPath(f: FolderEntry, all: FolderEntry[]): string {
  const parts: string[] = [f.name];
  let cur = f.parent;
  while (cur) {
    const p = all.find(x => x.id === cur);
    if (!p) break;
    parts.unshift(p.name);
    cur = p.parent;
  }
  return parts.join(' / ');
}

const tileSty: any = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  gap: 4, width: 100, height: 80, border: '1px solid var(--brd)', borderRadius: 8,
  cursor: 'pointer', background: 'var(--bg2)', userSelect: 'none',
};

const inputSty: any = { width: '100%', padding: '10px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: 6 };

const Modal = ({ title, children, onClose, onConfirm, confirmLabel }: any) => (
  <div className="modal on" style={{ display: 'flex' }} onClick={onClose}>
    <div className="modal-content" onClick={(e: any) => e.stopPropagation()}>
      <div className="modal-header"><h2>{title}</h2></div>
      <div className="modal-body">{children}</div>
      <div className="modal-footer">
        <button class="modal-btn modal-btn--primary" onClick={onConfirm}>{confirmLabel}</button>
        <button class="modal-btn" onClick={onClose}>Cancel</button>
      </div>
    </div>
  </div>
);
