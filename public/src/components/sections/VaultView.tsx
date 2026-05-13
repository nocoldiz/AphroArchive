import { useState, useEffect, useMemo, useRef } from 'preact/hooks';
import { vaultMode, isVaultUnlocked, currentVideo } from '../../store';
import { VaultMosaic } from './VaultMosaic';
import { VaultSettingsModal } from './VaultSettingsModal';
import { VaultScrapeModal } from './VaultScrapeModal';
import { VaultPhotoViewer } from './VaultPhotoViewer';

interface VaultFile {
  id: string;
  name?: string;
  originalName: string;
  ext: string;
  type: string;
  size?: number;
  sizeF?: string;
  mtime?: number;
  folder?: string | null;
  aiTagged?: boolean;
}

const VAULT_VIDEO_EXTS = new Set(['.mp4', '.webm', '.mkv', '.mov', '.avi', '.m4v', '.mpg', '.mpeg', '.wmv', '.ts']);
const VAULT_PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.heic', '.heif']);
const VAULT_AUDIO_EXTS = new Set(['.mp3', '.flac', '.wav', '.ogg', '.aac', '.m4a', '.opus', '.wma']);
const VAULT_BOOK_EXTS = new Set(['.pdf', '.epub', '.txt', '.md', '.mobi', '.azw', '.azw3', '.cbz', '.cbr']);
const VAULT_PAGE_EXTS = new Set(['.html', '.htm']);

const FILTER_TILES = [
  { key: 'fav', label: 'Favourites', icon: '❤️' },
  { key: 'video', label: 'Videos', icon: '🎥' },
  { key: 'photo', label: 'Photos', icon: '🖼️' },
  { key: 'ai', label: 'AI Images', icon: '🤖' },
  { key: 'audio', label: 'Audio', icon: '🎵' },
  { key: 'book', label: 'Books', icon: '📚' },
  { key: 'page', label: 'Pages', icon: '📄' },
];

export const VaultView = () => {
  const [status, setStatus] = useState<any>({});
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Grid State
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [folders, setFolders] = useState<any[]>([]);
  const [categories, setCategories] = useState<any>({});
  const [curFolder, setCurFolder] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('mtime');
  const [sortDir, setSortDir] = useState('desc');
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
  const [aiIds, setAiIds] = useState<Set<string>>(new Set());
  const [showMosaic, setShowMosaic] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showScrape, setShowScrape] = useState(false);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);

  // Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Infinite Scroll State
  const [renderLimit, setRenderLimit] = useState(100);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    if (status.unlocked) {
      loadVaultFiles();
    }
  }, [status.unlocked]);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setRenderLimit(prev => prev + 100);
      }
    }, { rootMargin: '200px' });

    if (sentinelRef.current) {
      observer.observe(sentinelRef.current);
    }

    return () => observer.disconnect();
  }, [sentinelRef.current, renderLimit]);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/vault/status');
      const data = await res.json();
      setStatus(data);
      isVaultUnlocked.value = data.unlocked;
    } catch (e) {
      console.error('Failed to fetch vault status', e);
    }
  };

  const loadVaultFiles = async () => {
    try {
      const [items, favs, cats] = await Promise.all([
        fetch('/api/vault/files').then(r => r.json()),
        fetch('/api/vault/favs').then(r => r.json()).catch(() => []),
        fetch('/api/db/categories').then(r => r.json()).catch(() => ({})),
      ]);

      if (items.error) return;

      const fols = items.filter((f: any) => f.type === 'folder');
      const fils = items.filter((f: any) => f.type !== 'folder');

      setFolders(fols);
      setFiles(fils);
      setFavIds(new Set(Array.isArray(favs) ? favs : []));
      setCategories(cats);

      const ai = new Set<string>();
      items.filter((f: any) => f.aiTagged).forEach((f: any) => ai.add(f.id));
      setAiIds(ai);
    } catch (e) {
      console.error('Failed to load vault files', e);
    }
  };

  const handleUnlock = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/vault/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Wrong password');
      } else {
        setPassword('');
        fetchStatus();
      }
    } catch (e: any) {
      setError(e.message || 'Failed to unlock');
    } finally {
      setLoading(false);
    }
  };

  const handleSetup = async () => {
    setError('');
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/vault/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to setup');
      } else {
        setPassword('');
        setConfirmPassword('');
        fetchStatus();
      }
    } catch (e: any) {
      setError(e.message || 'Failed to setup');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteFile = async (id: string) => {
    if (!confirm('Permanently delete this encrypted file?')) return;
    const res = await fetch('/api/vault/files/' + id, { method: 'DELETE' });
    if (!res.ok) {
      alert('Delete failed');
      return;
    }
    setFiles(files.filter(f => f.id !== id));
    const w = window as any;
    if (w.toast) w.toast('Deleted');
  };

  const handleMoveFile = async (fileId: string, folderId: string | null) => {
    const res = await fetch('/api/vault/files/' + fileId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: folderId })
    });
    if (!res.ok) {
      alert('Move failed');
      return;
    }
    setFiles(files.map(f => f.id === fileId ? { ...f, folder: folderId } : f));
    const w = window as any;
    if (w.toast) w.toast('Moved');
  };

  const handleNewFolder = async () => {
    const name = prompt('Folder name:');
    if (!name || !name.trim()) return;
    const res = await fetch('/api/vault/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() })
    });
    const d = await res.json();
    if (!res.ok) {
      alert(d.error || 'Failed to create folder');
      return;
    }
    setFolders([...folders, { id: d.id, name: d.name, type: 'folder', mtime: Date.now() }]);
    const w = window as any;
    if (w.toast) w.toast('Folder created');
  };

  const handleDeleteFolder = async (id: string, name: string) => {
    if (!confirm(`Delete folder "${name}"? Files inside will be moved to root.`)) return;
    const res = await fetch('/api/vault/folders/' + id, { method: 'DELETE' });
    if (!res.ok) {
      alert('Failed to delete folder');
      return;
    }
    setFolders(folders.filter(f => f.id !== id));
    setFiles(files.map(f => f.folder === id ? { ...f, folder: null } : f));
    if (curFolder === id) setCurFolder(null);
    const w = window as any;
    if (w.toast) w.toast('Folder deleted');
  };

  const handleFileClick = (f: VaultFile) => {
    const extLower = (f.ext || '').toLowerCase();
    if (VAULT_VIDEO_EXTS.has(extLower)) {
      currentVideo.value = {
        id: f.id,
        name: f.name || f.originalName,
        category: 'Vault',
        fav: favIds.has(f.id),
        isVault: true,
        size: f.size || 0,
        duration: 0,
        path: '',
        relPath: '',
        mtime: f.mtime || Date.now(),
        starred: false
      };
      // Toggle DOM classes to show player
      document.getElementById('vault-view')?.classList.remove('on');
      document.getElementById('player-view')?.classList.add('on');
    } else if (VAULT_PHOTO_EXTS.has(extLower)) {
      setActivePhotoId(f.id);
    } else if (VAULT_BOOK_EXTS.has(extLower)) {
      const w = window as any;
      if (w.openBook) {
        w.openBook(f.id, true);
      } else {
        alert('Book reader not available');
      }
    }
  };

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleDeleteSelected = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} selected items?`)) return;

    for (const id of ids) {
      await fetch(`/api/vault/files/${id}`, { method: 'DELETE' });
    }

    setFiles(files.filter(f => !selectedIds.has(f.id)));
    setSelectedIds(new Set());
    const w = window as any;
    if (w.toast) w.toast(`Deleted ${ids.length} items`);
  };

  const createNewVaultTextFile = async () => {
    let name = prompt('Enter text file name:', 'notes.txt');
    if (!name) return;
    
    const r = await fetch('/api/vault/create-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        name: name, 
        folder: curFolder, 
        content: '' 
      })
    });
    
    const w = window as any;
    if (!r.ok) {
      if (w.toast) w.toast('Failed to create text file');
      return;
    }
    
    loadVaultFiles();
    if (w.toast) w.toast('Empty text file created securely');
  };

  const importFromVaultDropDir = async () => {
    const r = await fetch('/api/vault/import-drop', { method: 'POST' });
    const w = window as any;
    if (!r.ok) {
      if (w.toast) w.toast('Import failed');
      return;
    }
    if (w.toast) w.toast('Importing files from process folder…');
    setTimeout(loadVaultFiles, 2000);
  };

  const deleteVaultDuplicates = async () => {
    const byName: { [key: string]: VaultFile[] } = {};
    for (const f of files) {
      const key = (f.originalName || '').toLowerCase();
      if (!byName[key]) byName[key] = [];
      byName[key].push(f);
    }
    const dupes: VaultFile[] = [];
    for (const group of Object.values(byName)) {
      if (group.length < 2) continue;
      group.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
      dupes.push(...group.slice(1)); // keep newest, delete rest
    }
    const w = window as any;
    if (!dupes.length) {
      if (w.toast) w.toast('No duplicates found');
      return;
    }
    if (!confirm(`Delete ${dupes.length} duplicate file${dupes.length > 1 ? 's' : ''}? (Keeps newest copy of each)`)) return;
    for (const f of dupes) {
      await fetch('/api/vault/files/' + f.id, { method: 'DELETE' });
    }
    const dupeIds = new Set(dupes.map(f => f.id));
    setFiles(prev => prev.filter(f => !dupeIds.has(f.id)));
    if (w.toast) w.toast(`Deleted ${dupes.length} duplicate${dupes.length > 1 ? 's' : ''}`);
  };

  const shuffleVault = () => {
    setFiles(prev => {
      const next = [...prev];
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
      }
      return next;
    });
    setSortField('shuffle');
  };

  const describeFile = async (id: string, type: string) => {
    const source = type === 'video' ? 'vault-video' : 'vault';
    const w = window as any;
    if (w.showVisionModal) {
      w.showVisionModal(source === 'vault-video' ? 'Extracting frame…' : 'Analyzing image…');
    }
    const r = await fetch('/api/vision/describe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, id })
    }).then(r => r.json()).catch(() => null);
    
    if (w.showVisionModal) {
      w.showVisionModal(r ? (r.description || r.error || 'No description returned') : 'Request failed');
    }
  };

  const downloadFile = (id: string, name: string) => {
    const a = document.createElement('a');
    a.href = `/api/vault/stream/${id}`;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const filteredFiles = useMemo(() => {
    let result = [...files];
    const q = searchQuery.toLowerCase();

    if (typeFilter) {
      if (typeFilter === 'fav') {
        result = result.filter(f => favIds.has(f.id));
      } else if (typeFilter === 'ai') {
        result = result.filter(f => aiIds.has(f.id));
      } else {
        const extSet = typeFilter === 'video' ? VAULT_VIDEO_EXTS
          : typeFilter === 'photo' ? VAULT_PHOTO_EXTS
            : typeFilter === 'audio' ? VAULT_AUDIO_EXTS
              : typeFilter === 'page' ? VAULT_PAGE_EXTS
                : VAULT_BOOK_EXTS;
        result = result.filter(f => {
          const inExt = extSet.has((f.ext || '').toLowerCase());
          if (typeFilter === 'photo') return inExt && !aiIds.has(f.id);
          return inExt;
        });
      }
      if (q) result = result.filter(f => (f.name || f.originalName).toLowerCase().includes(q));
    } else {
      result = q
        ? result.filter(f => (f.name || f.originalName).toLowerCase().includes(q))
        : result.filter(f => (f.folder || null) === curFolder);
    }

    if (catFilter && categories[catFilter]) {
      const cat = categories[catFilter];
      const terms = [cat.displayName, ...(cat.tags || [])].filter(Boolean).map(t => t.toLowerCase());
      result = result.filter(f => {
        const name = (f.name || f.originalName || '').toLowerCase();
        return terms.some(t => name.includes(t));
      });
    }

    // Sort
    if (sortField !== 'shuffle') {
      result.sort((a, b) => {
        if (sortField === 'name') {
          const va = (a.originalName || a.name || '').toLowerCase();
          const vb = (b.originalName || b.name || '').toLowerCase();
          return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        }
        const va = sortField === 'size' ? (a.size || 0) : (a.mtime || 0);
        const vb = sortField === 'size' ? (b.size || 0) : (b.mtime || 0);
        return sortDir === 'asc' ? va - vb : vb - va;
      });
    }

    return result;
  }, [files, curFolder, typeFilter, searchQuery, sortField, sortDir, favIds, aiIds, catFilter, categories]);

  const categoryMap = useMemo(() => {
    if (!categories || Object.keys(categories).length === 0) return {};
    const map: { [key: string]: { displayName: string, count: number } } = {};
    for (const f of files) {
      const name = (f.name || f.originalName || '').toLowerCase();
      if (!name) continue;
      for (const [key, cat] of Object.entries(categories) as [string, any][]) {
        const terms = [cat.displayName, ...(cat.tags || [])]
          .filter(Boolean)
          .map(t => t.toLowerCase());
        if (terms.some(t => name.includes(t))) {
          if (!map[key]) map[key] = { displayName: cat.displayName, count: 0 };
          map[key].count++;
        }
      }
    }
    return map;
  }, [files, categories]);

  const handleToggleFav = async (id: string) => {
    const res = await fetch('/api/vault/favs/' + id, { method: 'POST' }).then(r => r.json()).catch(() => null);
    if (!res) return;
    const next = new Set(favIds);
    if (res.fav) next.add(id);
    else next.delete(id);
    setFavIds(next);
  };

  const currentFolderName = useMemo(() => {
    if (!curFolder) return 'Vault';
    const f = folders.find(f => f.id === curFolder);
    return f ? f.name : 'Folder';
  }, [curFolder, folders]);

  const visibleFiles = useMemo(() => {
    return filteredFiles.slice(0, renderLimit);
  }, [filteredFiles, renderLimit]);

  if (status.unlocked) {
    return (
      <div id="vault-view" className="vault-view on" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {curFolder && (
              <button onClick={() => { setCurFolder(null); setRenderLimit(100); }} style={{ background: 'transparent', border: 'none', color: 'var(--tx)', cursor: 'pointer' }}>
                ⬅️ Back
              </button>
            )}
            <h2 style={{ margin: 0 }}>{currentFolderName}</h2>
            {selectedIds.size > 0 && (
              <span style={{ color: 'var(--tx2)', fontSize: '0.9rem' }}>({selectedIds.size} selected)</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={searchQuery}
              onInput={(e: any) => { setSearchQuery(e.target.value); setRenderLimit(100); }}
              placeholder="Search vault..."
              style={{ padding: '8px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '4px' }}
            />
            
            <label
              htmlFor="vaultFileIn"
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            >
              + Add Files
            </label>
            <input
              type="file"
              id="vaultFileIn"
              multiple
              style={{ display: 'none' }}
              onChange={(e: any) => (window as any).handleGlobalFiles && (window as any).handleGlobalFiles(e.target.files)}
            />

            <button
              onClick={createNewVaultTextFile}
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}
              title="New Text File"
            >
              New File
            </button>

            <button
              onClick={handleNewFolder}
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}
            >
              + New Folder
            </button>

            <button
              onClick={() => setShowMosaic(true)}
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}
              title="Dynamic Mosaic"
            >
              Mosaic
            </button>

            <button
              onClick={shuffleVault}
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}
              title="Shuffle Vault"
            >
              Shuffle
            </button>

            <button
              onClick={deleteVaultDuplicates}
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}
              title="Remove duplicate files"
            >
              Dedup
            </button>

            <button
              onClick={() => setShowScrape(true)}
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}
              title="Auto-scrape each file online"
            >
              Scrape
            </button>

            <button
              onClick={importFromVaultDropDir}
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}
              title="Import files from the process folder"
            >
              Import
            </button>

            <button
              onClick={() => setShowSettings(true)}
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}
              title="Vault Settings"
            >
              Settings
            </button>

            {selectedIds.size > 0 && (
              <button
                onClick={() => (window as any).openVaultZipModal(Array.from(selectedIds))}
                style={{ background: 'var(--ac)', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}
              >
                Download ZIP
              </button>
            )}
            {selectedIds.size > 0 && (
              <button
                onClick={handleDeleteSelected}
                style={{ background: '#e84040', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}
              >
                Delete Selected
              </button>
            )}

            <button
              onClick={async () => { await fetch('/api/vault/lock', { method: 'POST' }); fetchStatus(); }}
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}
            >
              Lock Vault
            </button>
          </div>
        </div>

        {/* Filter Tiles */}
        {!curFolder && !searchQuery && (
          <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', overflowX: 'auto', paddingBottom: '8px' }}>
            {FILTER_TILES.map(t => (
              <div
                key={t.key}
                onClick={() => { setTypeFilter(typeFilter === t.key ? null : t.key); setCatFilter(null); setRenderLimit(100); }}
                style={{
                  padding: '16px',
                  background: typeFilter === t.key ? 'var(--ac)' : 'var(--bg2)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  minWidth: '100px',
                  textAlign: 'center',
                  border: '1px solid var(--brd)'
                }}
              >
                <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>{t.icon}</div>
                <div style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>{t.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Category Filter Tiles */}
        {!curFolder && !searchQuery && !typeFilter && (
          <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', overflowX: 'auto', paddingBottom: '8px' }}>
            {Object.entries(categoryMap).filter(([, v]) => v.count > 0).sort((a, b) => b[1].count - a[1].count).map(([key, v]) => (
              <div
                key={key}
                onClick={() => { setCatFilter(catFilter === key ? null : key); setRenderLimit(100); }}
                style={{
                  padding: '12px 16px',
                  background: catFilter === key ? 'var(--ac)' : 'var(--bg2)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  minWidth: '100px',
                  textAlign: 'center',
                  border: '1px solid var(--brd)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <span style={{ fontSize: '1.2rem' }}>🏷️</span>
                <div style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>{v.displayName} <span style={{ opacity: 0.5 }}>({v.count})</span></div>
              </div>
            ))}
          </div>
        )}

        {/* Folders Row */}
        {!curFolder && !searchQuery && !typeFilter && (
          <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
            {folders.map(f => (
              <div
                key={f.id}
                style={{
                  padding: '12px 16px',
                  background: 'var(--bg2)',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  border: '1px solid var(--brd)'
                }}
              >
                <span onClick={() => { setCurFolder(f.id); setRenderLimit(100); }} style={{ cursor: 'pointer' }}>📁</span>
                <span onClick={() => { setCurFolder(f.id); setRenderLimit(100); }} style={{ fontWeight: '500', cursor: 'pointer' }}>{f.name}</span>
                <button
                  onClick={() => handleDeleteFolder(f.id, f.name)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--tx2)', cursor: 'pointer', fontSize: '0.8rem', marginLeft: 'auto' }}
                  title="Delete Folder"
                >
                  ❌
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Files Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px' }}>
          {visibleFiles.map(f => {
            const isImg = VAULT_PHOTO_EXTS.has(f.ext.toLowerCase());
            const isFav = favIds.has(f.id);
            const isSelected = selectedIds.has(f.id);
            return (
              <div key={f.id} className="video-card" style={{ background: 'var(--bg2)', borderRadius: '8px', overflow: 'hidden', border: isSelected ? '1px solid var(--ac)' : '1px solid var(--brd)', position: 'relative' }}>
                <div
                  style={{ height: '120px', background: 'var(--bg3)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                  onClick={() => handleFileClick(f)}
                >
                  {isImg ? (
                    <img src={`/api/vault/stream/${f.id}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                  ) : (
                    <span style={{ fontSize: '1.2rem', color: 'var(--tx2)' }}>{f.ext.replace('.', '').toUpperCase()}</span>
                  )}

                  {/* Selection Checkbox */}
                  <div
                    style={{ position: 'absolute', top: '4px', left: '4px', cursor: 'pointer', background: 'rgba(0,0,0,0.5)', borderRadius: '4px', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onClick={(e) => { e.stopPropagation(); handleToggleSelect(f.id); }}
                  >
                    <input type="checkbox" checked={isSelected} onChange={() => { }} style={{ cursor: 'pointer' }} />
                  </div>

                  <div
                    style={{ position: 'absolute', top: '4px', right: '4px', cursor: 'pointer' }}
                    onClick={(e) => { e.stopPropagation(); handleToggleFav(f.id); }}
                  >
                    {isFav ? '❤️' : '🤍'}
                  </div>
                  {f.sizeF && <span style={{ position: 'absolute', bottom: '4px', right: '4px', fontSize: '0.7rem', background: 'rgba(0,0,0,0.6)', padding: '2px 4px', borderRadius: '2px' }}>{f.sizeF}</span>}
                </div>
                <div style={{ padding: '8px' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.originalName || f.name}>
                    {f.name || f.originalName}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--tx3)' }}>Vault</div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <select
                        onChange={(e: any) => handleMoveFile(f.id, e.target.value || null)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--tx2)', fontSize: '0.75rem', cursor: 'pointer' }}
                        value={f.folder || ''}
                      >
                        <option value="">Move to...</option>
                        <option value="">Root</option>
                        {folders.map(fol => (
                          <option key={fol.id} value={fol.id}>{fol.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={(e) => { e.stopPropagation(); downloadFile(f.id, f.name || f.originalName); }}
                        style={{ background: 'transparent', border: 'none', color: 'var(--tx2)', cursor: 'pointer', fontSize: '0.75rem' }}
                        title="Download"
                      >
                        📥
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); describeFile(f.id, VAULT_VIDEO_EXTS.has(f.ext.toLowerCase()) ? 'video' : 'photo'); }}
                        style={{ background: 'transparent', border: 'none', color: 'var(--tx2)', cursor: 'pointer', fontSize: '0.75rem' }}
                        title="Describe with AI"
                      >
                        👁️
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteFile(f.id); }}
                        style={{ background: 'transparent', border: 'none', color: 'var(--tx2)', cursor: 'pointer', fontSize: '0.75rem' }}
                        title="Delete"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Infinite Scroll Sentinel */}
          {filteredFiles.length > renderLimit && (
            <div ref={sentinelRef} style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '20px', color: 'var(--tx2)' }}>
              Loading more...
            </div>
          )}
        </div>

        {filteredFiles.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--tx2)' }}>
            No files found.
          </div>
        )}

        {showMosaic && <VaultMosaic pool={files} onClose={() => setShowMosaic(false)} />}
        {showSettings && <VaultSettingsModal files={files} onClose={() => setShowSettings(false)} />}
        {showScrape && <VaultScrapeModal files={files} onClose={() => setShowScrape(false)} />}
        {activePhotoId && (
          <VaultPhotoViewer
            files={files.filter(f => VAULT_PHOTO_EXTS.has((f.ext || '').toLowerCase()))}
            initialFileId={activePhotoId}
            onClose={() => setActivePhotoId(null)}
            onDelete={(id) => setFiles(prev => prev.filter(f => f.id !== id))}
          />
        )}
      </div>
    );
  }

  return (
    <div id="vault-view" className="vault-view on" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80vh' }}>
      <div style={{ background: 'var(--bg2)', padding: '32px', borderRadius: '12px', width: '400px', border: '1px solid var(--brd)' }}>
        <h2 style={{ marginTop: 0 }}>{status.configured ? 'Vault Locked' : 'Create Vault'}</h2>
        <p style={{ color: 'var(--tx2)', fontSize: '0.9rem', marginBottom: '24px' }}>
          {status.configured
            ? 'Enter your password to access encrypted files.'
            : 'Set a master password. It cannot be changed or recovered.'}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <input
            type="password"
            value={password}
            onInput={(e: any) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (status.configured ? handleUnlock() : handleSetup())}
            placeholder="Password"
            style={{ padding: '10px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '6px' }}
          />

          {!status.configured && (
            <input
              type="password"
              value={confirmPassword}
              onInput={(e: any) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSetup()}
              placeholder="Confirm Password"
              style={{ padding: '10px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '6px' }}
            />
          )}

          {error && <div style={{ color: '#e84040', fontSize: '0.8rem' }}>{error}</div>}

          <button
            onClick={status.configured ? handleUnlock : handleSetup}
            disabled={loading}
            style={{ background: 'var(--ac)', border: 'none', color: '#fff', padding: '12px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', marginTop: '12px' }}
          >
            {loading ? 'Processing...' : (status.configured ? 'Unlock' : 'Create Vault')}
          </button>
        </div>
      </div>
    </div>
  );
};
