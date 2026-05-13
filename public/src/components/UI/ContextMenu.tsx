import { contextMenuState, categoryMasterPassword, profiles, isVaultUnlocked, activeProfile } from '../../store';

export const ContextMenu = () => {
  const state = contextMenuState.value;
  const { visible, x, y, type, data } = state;

  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [showProgressModal, setShowProgressModal] = useState(false);

  const [targetProfile, setTargetProfile] = useState('default');
  const [progressTitle, setProgressTitle] = useState('');
  const [progressDesc, setProgressDesc] = useState('');
  const [progressCur, setProgressCur] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);

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

  if (!visible) return null;

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
    const parts = data.path.split('/');
    const folderName = parts[parts.length - 1];

    if (!confirm(`Hide category "${data.name}"?\nThis will add "${folderName}" to your hidden categories list.`)) return;

    const r = await fetch('/api/categories/hide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: folderName })
    });

    if (r.ok) {
      toast(`Category "${data.name}" hidden`);
      refresh();
    } else {
      toast('Hide failed');
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

  const handleEncrypt = () => {
    if (!isVaultUnlocked.value) {
      toast('Unlock Vault profile first');
      return;
    }
    if (!confirm(`Encrypt category "${data.name}" and move to Vault?`)) return;
    execEncrypt();
  };

  const handleUnlock = () => {
    if (!isVaultUnlocked.value) {
      toast('Unlock Vault profile first');
      return;
    }
    setTargetProfile(activeProfile.value === 'Vault' ? 'default' : activeProfile.value);
    setShowUnlockModal(true);
  };

  const execEncrypt = async () => {
    setProgressTitle('Encrypting Category');
    setProgressDesc(`Moving files in ${data.path} to Vault...`);
    setProgressCur(0);
    setProgressTotal(0);
    setShowProgressModal(true);

    const r = await fetch('/api/categories/encrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: data.path })
    });

    if (r.ok) {
      const reader = r.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop()!;
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.total) {
              setProgressCur(msg.cur);
              setProgressTotal(msg.total);
            }
            if (msg.error) { toast('Error: ' + msg.error); setShowProgressModal(false); return; }
          } catch (e) { }
        }
      }

      setProgressTitle('Complete');
      setProgressDesc('Category encryption finished successfully.');
      refresh();
    } else {
      const err = await r.json();
      toast('Action failed: ' + (err.error || 'Unknown error'));
      setShowProgressModal(false);
    }
  };

  const execUnlock = async () => {
    setShowUnlockModal(false);
    setProgressTitle('Restoring Category');
    setProgressDesc(`Decrypting files to profile "${targetProfile}"...`);
    setProgressCur(0);
    setProgressTotal(0);
    setShowProgressModal(true);

    const r = await fetch('/api/categories/decrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: data.path, targetProfile })
    });

    if (r.ok) {
      const reader = r.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop()!;
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.total) {
              setProgressCur(msg.cur);
              setProgressTotal(msg.total);
            }
            if (msg.error) { toast('Error: ' + msg.error); setShowProgressModal(false); return; }
          } catch (e) { }
        }
      }
      setProgressTitle('Complete');
      setProgressDesc('Category restored successfully.');
      refresh();
    } else {
      const err = await r.json();
      toast('Action failed: ' + (err.error || 'Unknown error'));
      setShowProgressModal(false);
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
        {type === 'all_videos' && (
          <>
            <ContextItem label="Lock all unencrypted" icon="lock" onClick={() => toast('Not implemented in TSX yet')} />
            <ContextItem label="Unlock all encrypted" icon="lock" onClick={() => toast('Not implemented in TSX yet')} />
          </>
        )}
      </div>

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

      {showProgressModal && (
        <div className="modal on" style={{ display: 'flex' }}>
          <div className="modal-content">
            <div className="modal-header">
              <h2>{progressTitle}</h2>
            </div>
            <div className="modal-body">
              <p>{progressDesc}</p>
              <div style={{ background: 'var(--bg3)', height: '10px', borderRadius: '5px', overflow: 'hidden', marginBottom: '10px' }}>
                <div style={{ background: 'var(--accent)', height: '100%', width: `${progressTotal ? (progressCur / progressTotal) * 100 : 0}%` }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                <span>{progressCur} / {progressTotal}</span>
                <span>{progressTotal ? Math.floor((progressCur / progressTotal) * 100) : 0}%</span>
              </div>
            </div>
            <div className="modal-footer">
              {progressTitle === 'Complete' && (
                <button class="modal-btn" onClick={() => setShowProgressModal(false)}>Close</button>
              )}
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
