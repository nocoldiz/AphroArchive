import { contextMenuState, appPrefs, updatePrefs, videos, allVideos, folders, currentVideo, showAddToCollectionModal, tagModalState, actorModalState, loadVideos, ensureVaultUnlocked, filteredVideos, selectedVideoIds, videoSelMode, encryptingVideoIds } from '../../store';
import { useState, useEffect, useRef } from 'preact/hooks';
import { FolderTree, type FolderEntry } from './FolderTree';
import { setItemPlacement, setSectionPlacement, PLUGINS_GROUP_ID } from './navItems';
import { confirmDialog, promptDialog } from '../../dialog';
import { moveVideo } from '../../api';

export const ContextMenu = () => {
  const state = contextMenuState.value;
  const { visible, x, y, type, data } = state;

  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [showEncryptConfirm, setShowEncryptConfirm] = useState(false);
  const [showEncryptVideoConfirm, setShowEncryptVideoConfirm] = useState(false);
  const [showVaultUnlockModal, setShowVaultUnlockModal] = useState(false);
  const [showSubfoldersModal, setShowSubfoldersModal] = useState(false);
  const [physicalFolders, setPhysicalFolders] = useState<FolderEntry[]>([]);
  const [physicalFolderRoot, setPhysicalFolderRoot] = useState('');
  const [physicalCurFolder, setPhysicalCurFolder] = useState<string | null>(null);
  const encryptPollRef = useRef<any>(null);

  const closeMenu = () => {
    contextMenuState.value = { ...contextMenuState.value, visible: false };
  };

  useEffect(() => () => {
    if (encryptPollRef.current) clearInterval(encryptPollRef.current);
  }, []);

  useEffect(() => {
    const handleClick = () => closeMenu();
    if (visible) {
      window.addEventListener('click', handleClick);
      window.addEventListener('contextmenu', handleClick);
    }
    return () => {
      window.removeEventListener('click', handleClick);
      window.removeEventListener('contextmenu', handleClick);
    };
  }, [visible]);

  if (!visible && !showEncryptConfirm && !showEncryptVideoConfirm && !showUnlockModal && !showSubfoldersModal) return null;

  const refresh = () => {
    const w = window as any;
    if (w.refresh) w.refresh(true);
  };

  const toast = (msg: string) => {
    const w = window as any;
    if (w.toast) w.toast(msg);
  };

  const handleRename = async () => {
    const newName = await promptDialog('Rename folder to:', data.name);
    if (!newName || newName === data.name) return;

    const r = await fetch('/api/folders/relabel', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath: data.path, newName })
    });

    if (r.ok) {
      toast('Folder renamed');
      refresh();
    } else {
      const err = await r.json();
      toast('Rename failed: ' + (err.error || 'Unknown error'));
    }
  };

  const handleDelete = async () => {
    if (!await confirmDialog(`Delete folder "${data.name}"?\nAll videos inside will be moved to the main videos folder.`)) return;

    const r = await fetch('/api/folders/purge', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: data.path })
    });

    if (r.ok) {
      toast('Folder deleted, videos moved to main folder');
      refresh();
    } else {
      toast('Delete failed');
    }
  };

  // Hiding a folder is a client-side, per-profile preference: it drops out of the
  // sidebar and out of aggregate video lists (All Videos / search / tags)
  // instantly, with no server round-trip or library reload.
  const handleHide = async () => {
    const path = data.path;
    const hidden = appPrefs.value.hiddenFolders || [];
    if (!hidden.includes(path)) await updatePrefs({ hiddenFolders: [...hidden, path] });
    toast(`Folder "${data.name}" hidden`);
    closeMenu();
  };

  const handleUnhideAllFolders = async () => {
    await updatePrefs({ hiddenFolders: [] });
    toast('All folders unhidden');
    closeMenu();
  };

  const handleShowOnlyPinnedFolders = async () => {
    const pinned = new Set(appPrefs.value.pinnedFolders || []);
    const toHide = folders.value
      .map((c: any) => c.path)
      .filter((p: string) => p && p !== 'uncategorized' && !pinned.has(p));
    // Mutually exclusive with "show only pinned tags" — clear that mode first.
    await updatePrefs({ hiddenFolders: toHide, pinnedTagsOnly: false });
    toast('Showing only pinned folders');
    closeMenu();
  };

  const handleOpenFolder = async () => {
    const r = await fetch('/api/open-folder-in-explorer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: data.path })
    });
    if (!r.ok) toast('Failed to open folder');
  };

  const handleCompress = async () => {
    if (!await confirmDialog(`Start high-compression for all videos in "${data.name}"?\nThis runs in the background and may take a while.`)) return;

    const r = await fetch('/api/folders/compress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: data.path })
    });

    if (r.ok) {
      toast('Compression started in background');
    } else {
      toast('Failed to start compression');
    }
  };

  const handleDownloadZip = async () => {
    const password = await promptDialog('Enter password for ZIP (leave blank for no encryption):');
    if (password === null) return;

    toast('Generating ZIP...');
    try {
      const res = await fetch('/api/folder/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: data.path, password }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast('Download failed: ' + (err.error || 'Unknown error'));
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `category-${data.name.replace(/[^a-zA-Z0-9_-]/g, '_')}-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast('Download complete');
    } catch (e: any) {
      toast('Download failed: ' + e.message);
    }
  };

  const handleTogglePin = async () => {
    const path = data.path;
    const pinned = appPrefs.value.pinnedFolders || [];
    const isPinned = pinned.includes(path);
    const next = isPinned ? pinned.filter(p => p !== path) : [...pinned, path];
    await updatePrefs({ pinnedFolders: next });
    toast(isPinned ? `Unpinned "${data.name}"` : `Pinned "${data.name}" to top`);
    closeMenu();
  };

  const handleTogglePinTag = async () => {
    const name = data.name;
    const pinned = appPrefs.value.pinnedTags || [];
    const isPinned = pinned.includes(name);
    const next = isPinned ? pinned.filter(t => t !== name) : [...pinned, name];
    await updatePrefs({ pinnedTags: next });
    toast(isPinned ? `Unpinned "${name}"` : `Pinned "${name}" to top`);
    closeMenu();
  };

  const handleHideTag = async () => {
    const tagName = data.name;

    const currentHidden = appPrefs.value.hiddenTags || [];
    const updates = { hiddenTags: [...currentHidden, tagName] };

    await updatePrefs(updates);
    toast(`Tag "${tagName}" hidden`);
    contextMenuState.value = { ...contextMenuState.value, visible: false };
  };

  const handleUnhideAllTags = async () => {
    await updatePrefs({ hiddenTags: [], pinnedTagsOnly: false });
    data.onRefresh?.();
    toast('All tags unhidden');
    closeMenu();
  };

  const handleShowOnlyPinnedTags = async () => {
    const pinned = new Set(appPrefs.value.pinnedTags || []);
    try {
      const r = await fetch('/api/db-tags');
      const groups = await r.json();
      const toHide = (Array.isArray(groups) ? groups : [])
        .map((g: any) => g.displayName)
        .filter((n: string) => n && !pinned.has(n));
      // Mutually exclusive with "show only pinned folders" — clear that mode, activate this one.
      await updatePrefs({ hiddenTags: toHide, hiddenFolders: [], pinnedTagsOnly: true });
      data.onRefresh?.();
      toast('Showing only pinned tags');
    } catch {
      toast('Failed to update tags');
    }
    closeMenu();
  };

  const handleRenameTag = async () => {
    const tagName = data.name;
    const newName = await promptDialog('Rename tag to:', tagName);
    if (!newName || newName === tagName) return;
    closeMenu();
    const r = await fetch(`/api/tags/${encodeURIComponent(tagName)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newName })
    });
    if (r.ok) {
      toast(`Tag renamed to "${newName}"`);
      data.onRefresh?.();
      refresh();
    } else {
      toast('Rename failed');
    }
  };

  const handleDeleteTag = async () => {
    const tagName = data.name;
    if (!await confirmDialog(`Remove tag "${tagName}" from all videos?`)) return;
    closeMenu();
    const r = await fetch(`/api/tags/${encodeURIComponent(tagName)}`, { method: 'DELETE' });
    if (r.ok) {
      toast(`Tag "${tagName}" removed from all videos`);
      data.onRefresh?.();
      refresh();
    } else {
      toast('Delete failed');
    }
  };

  const handleTagToFolder = async () => {
    const tagName = data.name as string;
    // Folder name must mirror the server's filename sanitisation so create + move agree.
    const folderName = tagName.trim().replace(/[<>:"|?*/\\]/g, '_');
    if (!folderName) { toast('Invalid tag name'); return; }
    if (!await confirmDialog(`Create folder "${folderName}" and move all videos tagged "${tagName}" into it?`)) return;
    closeMenu();

    // Fetch the authoritative set of videos matching this tag.
    const vr = await fetch(`/api/db-tags/${encodeURIComponent(tagName)}`);
    const vd = await vr.json().catch(() => ({}));
    const vids: any[] = vr.ok ? (vd.videos || []) : [];
    if (!vids.length) { toast('No videos match this tag'); return; }

    // Create the folder (409 = already exists is fine — we still move into it).
    const cr = await fetch('/api/folders/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: folderName })
    });
    if (!cr.ok && cr.status !== 409) {
      const cd = await cr.json().catch(() => ({}));
      toast(cd.error || 'Failed to create folder');
      return;
    }

    toast(`Moving ${vids.length} video${vids.length === 1 ? '' : 's'} to "${folderName}"…`);
    let moved = 0;
    for (const v of vids) {
      try { await moveVideo(v.id, folderName); moved++; }
      catch { /* keep going; some files may be locked or already there */ }
    }
    toast(`Moved ${moved} of ${vids.length} video${vids.length === 1 ? '' : 's'} to "${folderName}"`);
    data.onRefresh?.();
    refresh();
  };

  const toFolderEntries = (cats: any[], rootPath: string): FolderEntry[] =>
    cats
      .filter((c: any) => c.path && c.path !== rootPath && c.path.startsWith(rootPath + '/'))
      .map((c: any) => {
        const rel = c.path.slice(rootPath.length + 1);
        const parts = rel.split('/');
        const parentRel = parts.slice(0, -1).join('/');
        const parentPath = parentRel ? rootPath + '/' + parentRel : null;
        return { id: c.path, name: parts[parts.length - 1], parent: parentPath, mtime: 0 };
      });

  const refreshPhysicalFolders = async (root: string) => {
    const res = await fetch('/api/folders');
    if (res.ok) setPhysicalFolders(toFolderEntries(await res.json(), root));
  };

  const handleManageSubfolders = async () => {
    closeMenu();
    const root = data.path;
    const res = await fetch('/api/folders');
    const cats = res.ok ? await res.json() : [];
    setPhysicalFolders(toFolderEntries(cats, root));
    setPhysicalFolderRoot(root);
    setPhysicalCurFolder(null);
    setShowSubfoldersModal(true);
  };

  const physicalCreateFolder = async (name: string, parentId: string | null) => {
    const r = await fetch('/api/folders/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parentPath: parentId || physicalFolderRoot, name }) });
    if (!r.ok) { const d = await r.json().catch(() => ({})); toast(d.error || 'Failed to create folder'); return; }
    await refreshPhysicalFolders(physicalFolderRoot);
  };

  const physicalRenameFolder = async (id: string, newName: string) => {
    const res = await fetch('/api/folders/rename', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: id, newName }) });
    if (!res.ok) { toast('Rename failed'); return; }
    await refreshPhysicalFolders(physicalFolderRoot);
  };

  const physicalDeleteFolder = async (id: string, name: string) => {
    if (!await confirmDialog(`Delete subfolder "${name}"? Contents will move to parent.`)) return;
    const parent = physicalFolders.find(f => f.id === id)?.parent || null;
    await fetch('/api/folders/delete', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: id }) });
    if (physicalCurFolder === id) setPhysicalCurFolder(parent);
    await refreshPhysicalFolders(physicalFolderRoot);
  };

  const physicalMoveFolder = async (id: string, newParentId: string | null) => {
    const res = await fetch('/api/folders/move', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fromPath: id, toParentPath: newParentId || physicalFolderRoot }) });
    if (!res.ok) { toast('Move failed'); return; }
    await refreshPhysicalFolders(physicalFolderRoot);
  };

  const handleEncrypt = async () => {
    ensureVaultUnlocked(() => {
      closeMenu();
      setShowEncryptConfirm(true);
    });
  };

  const handleUnlock = async () => {
    ensureVaultUnlocked(() => {
      setShowUnlockModal(true);
    });
  };

  // Flag a set of ids as encrypting → their cards render semi-transparent.
  const markEncrypting = (ids: string[]) => {
    const s = new Set(encryptingVideoIds.value);
    ids.forEach(id => s.add(id));
    encryptingVideoIds.value = s;
  };
  const unmarkEncrypting = (ids: string[]) => {
    const s = new Set(encryptingVideoIds.value);
    ids.forEach(id => s.delete(id));
    encryptingVideoIds.value = s;
  };
  // Drop ids from the grid in one pass — no full gallery reload. Folder counts
  // are decremented by how many of the hidden videos lived in each category.
  const hideVideos = (ids: Set<string>) => {
    const byCat = new Map<string, number>();
    for (const v of allVideos.value as any[]) {
      if (ids.has(v.id)) { const c = v.catPath || ''; byCat.set(c, (byCat.get(c) || 0) + 1); }
    }
    allVideos.value = allVideos.value.filter((v: any) => !ids.has(v.id));
    videos.value = videos.value.filter((v: any) => !ids.has(v.id));
    folders.value = folders.value.map((c: any) =>
      byCat.has(c.path) ? { ...c, count: Math.max(0, (c.count || 0) - (byCat.get(c.path) || 0)) } : c
    );
  };

  // Poll only to detect completion — the cards are already faded out, so there's
  // no per-tick list churn (the old "constant reload"). Hide them all at the end.
  const startEncryptPoller = (affected: Set<string>) => {
    encryptPollRef.current = setInterval(async () => {
      try {
        const r = await fetch('/api/encryption/status');
        if (!r.ok) return;
        const p = await r.json();
        if (!p.running) {
          clearInterval(encryptPollRef.current);
          encryptPollRef.current = null;
          if (p.ok) hideVideos(affected);
          unmarkEncrypting([...affected]);
        }
      } catch {}
    }, 800);
  };

  const execEncrypt = async () => {
    const catPath = data.path;
    // Every video under this folder (incl. subfolders) gets encrypted server-side.
    const affected = new Set<string>(
      allVideos.value
        .filter((v: any) => (v.catPath || '') === catPath || (v.catPath || '').startsWith(catPath + '/'))
        .map((v: any) => v.id)
    );
    const r = await fetch('/api/folders/encrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: catPath })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      toast('Encryption failed: ' + (err.error || 'Unknown error'));
    } else {
      toast('Encrypting…');
      markEncrypting([...affected]);        // fade the cards immediately
      startEncryptPoller(affected);
    }
  };

  const execEncryptVideo = async () => {
    const id = data.id;
    markEncrypting([id]);                    // fade the card while it encrypts
    try {
      const r = await fetch(`/api/videos/${id}/encrypt`, { method: 'POST' });
      if (r.ok) {
        toast('Video encrypted and moved to Vault');
        hideVideos(new Set([id]));           // hide just this card when done
      } else {
        const err = await r.json().catch(() => ({}));
        toast('Encryption failed: ' + (err.error || 'Unknown error'));
      }
    } finally {
      unmarkEncrypting([id]);
    }
  };

  const execUnlock = async () => {
    setShowUnlockModal(false);
    const r = await fetch('/api/folders/decrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: data.path })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      toast('Decrypt failed: ' + (err.error || 'Unknown error'));
    } else {
      toast('Decrypting — track progress in the sync drawer');
    }
  };

  const menuWidth = 180;
  const menuHeight = 160; // Estimate
  let posX = x;
  let posY = y;

  if (posX + menuWidth > window.innerWidth) posX -= menuWidth;
  if (posY + menuHeight > window.innerHeight) posY -= menuHeight;
  if (posX < 0) posX = 10;
  if (posY < 0) posY = 10;

  return (
    <>
      {visible && (
        <div id="context-menu" style={{
          display: 'block',
          left: `${posX}px`,
          top: `${posY}px`,
        position: 'absolute',
        background: 'var(--bg2)',
        border: '1px solid var(--brd)',
        borderRadius: '4px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        zIndex: 1000,
        padding: '5px 0',
        minWidth: `${menuWidth}px`
      }}>
        {type === 'folder' && (
          <>
            <ContextItem
              label={(appPrefs.value.pinnedFolders || []).includes(data.path) ? 'Unpin folder' : 'Pin folder to top'}
              icon="star"
              onClick={handleTogglePin}
            />
            <ContextItem label="Hide" icon="eye-off" onClick={handleHide} />
            <ContextItem label="Show only pinned folders" icon="star" onClick={handleShowOnlyPinnedFolders} />
            {(appPrefs.value.hiddenFolders || []).length > 0 && (
              <ContextItem label="Unhide all folders" icon="eye" onClick={handleUnhideAllFolders} />
            )}
            <ContextItem
              label={appPrefs.value.hideEmptyFolders ? 'Show empty folders' : 'Hide empty folders'}
              icon="eye-off"
              onClick={() => { updatePrefs({ hideEmptyFolders: !appPrefs.value.hideEmptyFolders }); closeMenu(); }}
            />
            <div className="ctx-sep" style={{ height: '1px', background: 'var(--brd)', margin: '5px 0' }} />
            <ContextItem label="Rename" icon="edit" onClick={handleRename} />
            <ContextItem label="Delete" icon="trash" onClick={handleDelete} />
            <ContextItem label="Open folder" icon="folder" onClick={handleOpenFolder} />
            <ContextItem label="Re-encode to H.265" icon="zap" onClick={async () => {
              closeMenu();
              if (!await confirmDialog(`Re-encode all videos in "${data.name}" to H.265?\nThis runs in the background and may take a while.`)) return;
              const r = await fetch('/api/reencode/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folder: data.path }),
              });
              const d = await r.json().catch(() => ({}));
              if (d.ok) toast('Re-encoding started — check Sync & Tasks for progress');
              else toast(d.error || 'Failed to start re-encode');
            }} />
            <ContextItem label="Compress Videos" icon="download" onClick={handleCompress} />
            <ContextItem label="Download ZIP" icon="download" onClick={handleDownloadZip} />
            <ContextItem label="Manage Subfolders" icon="folder" onClick={handleManageSubfolders} />
            <div className="ctx-sep" style={{ height: '1px', background: 'var(--brd)', margin: '5px 0' }} />
            {data.encrypted ? (
              <ContextItem label="Restore to Profile" icon="lock" onClick={handleUnlock} />
            ) : data.partial ? (
              <ContextItem label="Finish Encryption" icon="lock" onClick={handleEncrypt} color="#e84040" />
            ) : (
              <ContextItem label="Encrypt" icon="lock" onClick={handleEncrypt} />
            )}
          </>
        )}
        {type === 'video' && (
          <>
            {data.isLink && data.linkUrl && (
              <ContextItem label="Open Link" icon="link" onClick={() => {
                window.open(data.linkUrl, '_blank');
                contextMenuState.value = { ...contextMenuState.value, visible: false };
              }} />
            )}
            <ContextItem label={data.fav ? "Unfavourite" : "Favourite"} icon="star" onClick={async () => {
              const r = await fetch(`/api/favourites/${data.id}`, { method: 'POST' });
              const d = await r.json();

              const currentVideos = [...videos.value];
              const idx = currentVideos.findIndex(v => v.id === data.id);
              if (idx !== -1) {
                currentVideos[idx] = { ...currentVideos[idx], fav: d.fav };
                videos.value = currentVideos;
              }

              const w = window as any;
              if (w.toast) w.toast(d.fav ? '★ Added to favourites' : 'Removed from favourites');
            }} />
            <ContextItem label="Rename" icon="edit" onClick={() => (window as any).openRen && (window as any).openRen(data.id, data.name)} />
            <ContextItem label="Move to Folder" icon="folder" onClick={() => (window as any).openMov && (window as any).openMov(data.id, data.name, data.catPath || '', !!(data as any).isVault)} />
            <ContextItem label="Add to Playlist" icon="list" onClick={() => {
              currentVideo.value = data;
              showAddToCollectionModal.value = true;
            }} />
            <ContextItem label="Tags" icon="tag" onClick={() => {
              tagModalState.value = { visible: true, vidId: data.id, linkUrl: null };
            }} />
            <ContextItem label="Actors" icon="user" onClick={() => {
              actorModalState.value = { visible: true, vidId: data.id };
            }} />
            {!data.reencoded && !data.isLink && !data.isVault && (
              <ContextItem label="Re-encode to H.265" icon="zap" onClick={async () => {
                closeMenu();
                const r = await fetch('/api/reencode/start', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ ids: [data.id] }),
                });
                const d = await r.json().catch(() => ({}));
                if (d.ok) {
                  if ((window as any).toast) (window as any).toast('Re-encoding started — check Sync & Tasks for progress');
                } else {
                  if ((window as any).toast) (window as any).toast(d.error || 'Failed to start re-encode');
                }
              }} />
            )}
            <ContextItem label="Encrypt" icon="lock" onClick={() => {
              closeMenu();
              ensureVaultUnlocked(() => {
                setShowEncryptVideoConfirm(true);
              });
            }} />
            <ContextItem label="Delete" icon="trash" color="#ff4a4a" onClick={async () => {
              if (!await confirmDialog(`Delete video "${data.name}" from disk?\nThis action cannot be undone.`)) return;
              const r = await fetch(`/api/videos/${data.id}`, { method: 'DELETE' });
              if (r.ok) {
                if ((window as any).toast) (window as any).toast('Video deleted');
                videos.value = videos.value.filter(v => v.id !== data.id);
                allVideos.value = allVideos.value.filter(v => v.id !== data.id);
                contextMenuState.value = { ...contextMenuState.value, visible: false };
              } else {
                const err = await r.json();
                if ((window as any).toast) (window as any).toast('Delete failed: ' + (err.error || 'Unknown error'));
              }
            }} />
          </>
        )}
        {type === 'all_videos' && (
          <>
            <ContextItem label="Lock all unencrypted" icon="lock" onClick={() => toast('Not implemented in TSX yet')} />
            <ContextItem label="Unlock all encrypted" icon="lock" onClick={() => toast('Not implemented in TSX yet')} />
          </>
        )}
        {type === 'grid' && (
          <>
            <ContextItem label="Refresh library" icon="folder" onClick={() => {
              closeMenu();
              loadVideos();
              toast('Refreshing library…');
            }} />
            <ContextItem label="Select all" icon="list" onClick={() => {
              closeMenu();
              selectedVideoIds.value = new Set(filteredVideos.value.map(v => v.id));
              videoSelMode.value = filteredVideos.value.length > 0;
            }} />
            <ContextItem label="Create folder here" icon="folder" onClick={() => {
              closeMenu();
              (window as any).createFolder?.();
            }} />
          </>
        )}
        {type === 'navitem' && (() => {
          const { id, location } = data;
          // Block-level moves (whole dropdown/filter): simple toggle between topbar and sidebar
          if (location === 'topbar' || location === 'sidebar') {
            const toSidebar = location === 'topbar';
            // The Plugins group block: label differs
            const isPluginsGroup = id === PLUGINS_GROUP_ID;
            return (
              <ContextItem
                label={toSidebar
                  ? (isPluginsGroup ? 'Move Plugins to Sidebar' : 'Move to Sidebar')
                  : (isPluginsGroup ? 'Move Plugins to Topbar' : 'Move to Topbar')}
                icon="list"
                onClick={() => { setItemPlacement(id, toSidebar ? 'sidebar' : 'topbar'); closeMenu(); }}
              />
            );
          }
          // Item-level moves: topbar-icon, topbar-dropdown (in section/plugins dropdown), or sidebar
          const resetPlacement = async () => {
            const next = { ...(appPrefs.value.itemPlacements || {}) };
            delete next[id];
            await updatePrefs({ itemPlacements: next });
            closeMenu();
          };
          return (
            <>
              {location !== 'topbar-icon' && (
                <ContextItem
                  label="Move to Topbar (icon)"
                  icon="list"
                  onClick={() => { setItemPlacement(id, 'topbar'); closeMenu(); }}
                />
              )}
              {location !== 'sidebar' && (
                <ContextItem
                  label="Move to Sidebar"
                  icon="list"
                  onClick={() => { setItemPlacement(id, 'sidebar'); closeMenu(); }}
                />
              )}
              {(location === 'topbar-icon' || location === 'sidebar') && (
                <ContextItem
                  label="Reset to Default"
                  icon="list"
                  onClick={resetPlacement}
                />
              )}
            </>
          );
        })()}
        {type === 'navsection' && (
          <ContextItem
            label={data.location === 'sidebar' ? 'Pin to Topbar' : 'Move to Sidebar'}
            icon="list"
            onClick={() => {
              setSectionPlacement(data.section, data.location === 'sidebar' ? 'topbar' : 'sidebar');
              closeMenu();
            }}
          />
        )}
        {type === 'tag' && (
          <>
            <ContextItem
              label={(appPrefs.value.pinnedTags || []).includes(data.name) ? 'Unpin tag' : 'Pin tag to top'}
              icon="star"
              onClick={handleTogglePinTag}
            />
            <ContextItem label="Hide Tag" icon="eye-off" onClick={handleHideTag} />
            <ContextItem label="Show only pinned tags" icon="star" onClick={handleShowOnlyPinnedTags} />
            {(appPrefs.value.hiddenTags || []).length > 0 && (
              <ContextItem label="Unhide all tags" icon="eye" onClick={handleUnhideAllTags} />
            )}
            <div className="ctx-sep" style={{ height: '1px', background: 'var(--brd)', margin: '5px 0' }} />
            <ContextItem label="Turn tag into a folder" icon="folder" onClick={handleTagToFolder} />
            <ContextItem label="Rename Tag" icon="edit" onClick={handleRenameTag} />
            <ContextItem label="Remove from all videos" icon="trash" color="#ff4a4a" onClick={handleDeleteTag} />
          </>
        )}
        {type === 'text-selection' && (() => {
          const text = String(data?.text || '').trim();
          const short = text.length > 30 ? text.slice(0, 30) + '…' : text;
          const addEntry = async (dbType: 'actors' | 'channels', label: string) => {
            closeMenu();
            const r = await fetch(`/api/db/${dbType}/upsert`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: text, data: {} }),
            });
            toast(r.ok ? `Added ${label} "${short}"` : `Failed to add ${label}`);
          };
          // Tag the current video with the selected text (needs a video id in data).
          const addTag = async () => {
            closeMenu();
            const vid = data?.videoId;
            if (!vid) return;
            const cur = await fetch(`/api/videos/${vid}`).then(r => r.json()).catch(() => null);
            const existing = (cur?.tags || []) as string[];
            if (existing.some(t => t.toLowerCase() === text.toLowerCase())) {
              toast(`Already tagged "${short}"`);
              return;
            }
            const r = await fetch(`/api/videos/${vid}/meta`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tags: [...existing, text] }),
            });
            if (r.ok) {
              data?.onAddTag?.(text);
              toast(`Added tag "${short}"`);
            } else {
              toast('Failed to add tag');
            }
          };
          return (
            <>
              <ContextItem label={`Add "${short}" as Actor`} icon="user" onClick={() => addEntry('actors', 'actor')} />
              <ContextItem label={`Add "${short}" as Channel`} icon="link" onClick={() => addEntry('channels', 'channel')} />
              {data?.videoId && <ContextItem label={`Add "${short}" as Tag`} icon="tag" onClick={addTag} />}
            </>
          );
        })()}
        {(type === 'file' || type === 'book' || type === 'audio' || type === 'photo' || type === 'page') && (
          <>
            {data.onOpen && <ContextItem label="Open" icon="folder" onClick={() => {
              data.onOpen();
              contextMenuState.value = { ...contextMenuState.value, visible: false };
            }} />}
            {data.onEncrypt && (
              <ContextItem label="Encrypt" icon="lock" onClick={() => {
                contextMenuState.value = { ...contextMenuState.value, visible: false };
                ensureVaultUnlocked(() => data.onEncrypt());
              }} />
            )}
            {data.onDelete && (
              <ContextItem label="Delete" icon="trash" color="#ff4a4a" onClick={async () => {
                await data.onDelete();
                contextMenuState.value = { ...contextMenuState.value, visible: false };
              }} />
            )}
          </>
        )}
      </div>
      )}

      {showUnlockModal && (
        <div className="modal on" style={{ display: 'flex' }}>
          <div className="modal-content">
            <div className="modal-header">
              <h2>Restore Folder</h2>
            </div>
            <div className="modal-body">
              <p>Restore this folder from the vault to your library?</p>
            </div>
            <div className="modal-footer">
              <button class="modal-btn modal-btn--primary" onClick={execUnlock}>Restore</button>
              <button class="modal-btn" onClick={() => setShowUnlockModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showEncryptConfirm && (
        <div className="modal on" style={{ display: 'flex' }}>
          <div className="modal-content">
            <div className="modal-header">
              <h2>Encrypt Folder</h2>
            </div>
            <div className="modal-body">
              <p>Encrypt folder "{data.name}" and move it to Vault?</p>
              <p>This will encrypt all files inside and move them into the vault.</p>
            </div>
            <div className="modal-footer">
              <button class="modal-btn modal-btn--primary" onClick={() => {
                setShowEncryptConfirm(false);
                execEncrypt();
              }}>Encrypt</button>
              <button class="modal-btn" onClick={() => setShowEncryptConfirm(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showEncryptVideoConfirm && (
        <div className="modal on" style={{ display: 'flex' }}>
          <div className="modal-content">
            <div className="modal-header">
              <h2>Encrypt Video</h2>
            </div>
            <div className="modal-body">
              <p>Encrypt "{data.name}" and move it to Vault?</p>
              <p>The video will be placed in a vault folder matching its current folder.</p>
            </div>
            <div className="modal-footer">
              <button class="modal-btn modal-btn--primary" onClick={() => {
                setShowEncryptVideoConfirm(false);
                execEncryptVideo();
              }}>Encrypt</button>
              <button class="modal-btn" onClick={() => setShowEncryptVideoConfirm(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showSubfoldersModal && (
        <div className="modal on" style={{ display: 'flex' }}>
          <div className="modal-content" style={{ maxWidth: 560, width: '90vw' }}>
            <div className="modal-header">
              <h2>Subfolders — {data?.name}</h2>
            </div>
            <div className="modal-body">
              <FolderTree
                folders={physicalFolders}
                currentFolderId={physicalCurFolder}
                onNavigate={setPhysicalCurFolder}
                onCreateFolder={physicalCreateFolder}
                onRenameFolder={physicalRenameFolder}
                onDeleteFolder={physicalDeleteFolder}
                onMoveFolder={physicalMoveFolder}
              />
            </div>
            <div className="modal-footer">
              <button class="modal-btn" onClick={() => { setShowSubfoldersModal(false); refresh(); }}>Done</button>
            </div>
          </div>
        </div>
      )}

    </>
  );
};

const ContextItem = ({ label, icon, onClick, color }: { label: string, icon: string, onClick: () => void, color?: string }) => (
  <div className="ctx-item" onClick={onClick} style={{
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 15px',
    cursor: 'pointer',
    fontSize: '0.9rem',
    color: color || 'var(--text)'
  }}>
    <i className={`icon-${icon}`} style={{ width: '14px' }} />
    <span>{label}</span>
  </div>
);
