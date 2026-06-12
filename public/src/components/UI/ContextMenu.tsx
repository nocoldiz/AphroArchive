import { contextMenuState, categoryMasterPassword, profiles, isVaultUnlocked, activeProfile, appPrefs, updatePrefs, videos, allVideos, categories, currentVideo, showAddToCollectionModal, tagModalState, actorModalState, loadVideos, ensureVaultUnlocked, imagegenInputState, currentView } from '../../store';
import { useState, useEffect, useRef } from 'preact/hooks';

export const ContextMenu = () => {
  const state = contextMenuState.value;
  const { visible, x, y, type, data } = state;

  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [showEncryptConfirm, setShowEncryptConfirm] = useState(false);
  const [showEncryptVideoConfirm, setShowEncryptVideoConfirm] = useState(false);
  const [showVaultUnlockModal, setShowVaultUnlockModal] = useState(false);
  const encryptPollRef = useRef<any>(null);

  const [targetProfile, setTargetProfile] = useState('default');

  const closeMenu = () => {
    contextMenuState.value = { ...state, visible: false };
  };

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

  if (!visible && !showEncryptConfirm && !showEncryptVideoConfirm && !showUnlockModal) return null;

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const refresh = () => {
    const w = window as any;
    if (w.refresh) w.refresh(true);
  };

  const toast = (msg: string) => {
    const w = window as any;
    if (w.toast) w.toast(msg);
  };

  const handleRename = async () => {
    const newName = prompt('Rename category to:', data.name);
    if (!newName || newName === data.name) return;

    const r = await fetch('/api/categories/rename', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath: data.path, newName })
    });

    if (r.ok) {
      toast('Category renamed');
      refresh();
    } else {
      const err = await r.json();
      toast('Rename failed: ' + (err.error || 'Unknown error'));
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete category "${data.name}"?\nAll videos inside will be moved to the main videos folder.`)) return;

    const r = await fetch('/api/categories/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: data.path })
    });

    if (r.ok) {
      toast('Category deleted, videos moved to main folder');
      refresh();
    } else {
      toast('Delete failed');
    }
  };

  const handleHide = async () => {
    try {
      const r = await fetch('/api/categories/hide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: data.path })
      });

      if (r.ok) {
        toast(`Category "${data.name}" hidden`);
        closeMenu();
        await loadVideos();
        const tagRes = await fetch('/api/tags');
        const tagData = await tagRes.json();
        (window as any)._sidebarSetTags?.(tagData);
      } else {
        toast('Hide failed');
      }
    } catch (e: any) {
      toast('Error hiding category: ' + e.message);
    }
  };

  const handleOpenFolder = async () => {
    const r = await fetch('/api/open-category-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: data.path })
    });
    if (!r.ok) toast('Failed to open folder');
  };

  const handleCompress = async () => {
    if (!confirm(`Start high-compression for all videos in "${data.name}"?\nThis runs in the background and may take a while.`)) return;

    const r = await fetch('/api/categories/compress', {
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
    const password = prompt('Enter password for ZIP (leave blank for no encryption):');
    if (password === null) return;

    toast('Generating ZIP...');
    try {
      const res = await fetch('/api/category/download-zip', {
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

  const handleHideTag = async () => {
    const tagName = data.name;

    const currentHidden = appPrefs.value.hiddenTags || [];
    const updates = { hiddenTags: [...currentHidden, tagName] };

    await updatePrefs(updates);
    toast(`Tag "${tagName}" hidden`);
    contextMenuState.value = { ...contextMenuState.value, visible: false };
  };

  const handleEncrypt = async () => {
    ensureVaultUnlocked(() => {
      setShowEncryptConfirm(true);
      closeMenu();
    });
  };

  const handleUnlock = async () => {
    ensureVaultUnlocked(() => {
      setTargetProfile(activeProfile.value === 'Vault' ? 'default' : activeProfile.value);
      setShowUnlockModal(true);
    });
  };

  const startEncryptPoller = (catPath: string) => {
    const seenNames = new Set<string>();
    encryptPollRef.current = setInterval(async () => {
      try {
        const r = await fetch('/api/encryption/status');
        if (!r.ok) return;
        const p = await r.json();
        if (p.type === 'encrypt' && p.current && !seenNames.has(p.current)) {
          seenNames.add(p.current);
          const nameLo = p.current.toLowerCase();
          const remove = (v: any) =>
            (v.catPath || '') === catPath && (v.name || '').toLowerCase() === nameLo;
          allVideos.value = allVideos.value.filter((v: any) => !remove(v));
          videos.value = videos.value.filter((v: any) => !remove(v));
          categories.value = categories.value.map((c: any) =>
            c.path === catPath ? { ...c, count: Math.max(0, (c.count || 1) - 1) } : c
          );
        }
        if (!p.running) {
          clearInterval(encryptPollRef.current);
          encryptPollRef.current = null;
          if (p.ok) loadVideos();
        }
      } catch {}
    }, 800);
  };

  const execEncrypt = async () => {
    const r = await fetch('/api/categories/encrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: data.path })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      toast('Encryption failed: ' + (err.error || 'Unknown error'));
    } else {
      toast('Encrypting…');
      startEncryptPoller(data.path);
    }
  };

  const execEncryptVideo = async () => {
    const r = await fetch(`/api/videos/${data.id}/encrypt`, { method: 'POST' });
    if (r.ok) {
      toast('Video encrypted and moved to Vault');
      videos.value = videos.value.filter((v: any) => v.id !== data.id);
      allVideos.value = allVideos.value.filter((v: any) => v.id !== data.id);
    } else {
      const err = await r.json().catch(() => ({}));
      toast('Encryption failed: ' + (err.error || 'Unknown error'));
    }
  };

  const execUnlock = async () => {
    setShowUnlockModal(false);
    const r = await fetch('/api/categories/decrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: data.path, targetProfile })
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
        {type === 'category' && (
          <>
            <ContextItem label="Rename" icon="edit" onClick={handleRename} />
            <ContextItem label="Delete" icon="trash" onClick={handleDelete} />
            <ContextItem label="Hide" icon="eye-off" onClick={handleHide} />
            <ContextItem label="Open folder" icon="folder" onClick={handleOpenFolder} />
            <ContextItem label="Compress Videos" icon="download" onClick={handleCompress} />
            <ContextItem label="Download ZIP" icon="download" onClick={handleDownloadZip} />
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
            <ContextItem label="Move to Category" icon="folder" onClick={() => (window as any).openMov && (window as any).openMov(data.id, data.name, data.catPath || '')} />
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
            <ContextItem label="Encrypt" icon="lock" onClick={() => {
              closeMenu();
              // Normal users must unlock the vault (password prompt) before encrypting
              ensureVaultUnlocked(() => setShowEncryptVideoConfirm(true));
            }} />
            <ContextItem label="Delete" icon="trash" color="#ff4a4a" onClick={async () => {
              if (!confirm(`Delete video "${data.name}" from disk?\nThis action cannot be undone.`)) return;
              const r = await fetch(`/api/videos/${data.id}`, { method: 'DELETE' });
              if (r.ok) {
                if ((window as any).toast) (window as any).toast('Video deleted');
                videos.value = videos.value.filter(v => v.id !== data.id);
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
        {type === 'tag' && (
          <ContextItem label="Hide Tag" icon="eye-off" onClick={handleHideTag} />
        )}
        {(type === 'file' || type === 'book' || type === 'audio' || type === 'photo' || type === 'page') && (
          <>
            {data.onOpen && <ContextItem label="Open" icon="folder" onClick={() => {
              data.onOpen();
              contextMenuState.value = { ...contextMenuState.value, visible: false };
            }} />}
            {type === 'photo' && (
              <ContextItem label="Send to Image Gen" icon="image" onClick={() => {
                imagegenInputState.value = { imageUrl: `/api/photos/${data.id}/img`, imagePath: '' };
                currentView.value = 'imagegen';
                contextMenuState.value = { ...contextMenuState.value, visible: false };
              }} />
            )}
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
              <h2>Restore Category</h2>
            </div>
            <div className="modal-body">
              <p>Choose the target profile to restore this category to:</p>
              <select
                value={targetProfile}
                onChange={(e: any) => setTargetProfile(e.target.value)}
                class="premium-input"
                style={{ width: '100%', padding: '10px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '6px' }}
              >
                {profiles.value.filter(p => p !== 'Vault').map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
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
              <h2>Encrypt Category</h2>
            </div>
            <div className="modal-body">
              <p>Encrypt category "{data.name}" and move it to Vault?</p>
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
              <p>The video will be placed in a vault folder matching its current category.</p>
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
