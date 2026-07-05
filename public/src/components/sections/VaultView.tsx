import { useState, useEffect, useMemo, useRef } from 'preact/hooks';
import { vaultMode, isVaultUnlocked, currentVideo, currentView, contextMenuState, vaultGlobalView } from '../../store';
import { PhotoLightbox } from '../modals/PhotoLightbox';
import { FolderTree, type FolderEntry } from '../UI/FolderTree';
import { confirmDialog, promptDialog, alertDialog } from '../../dialog';

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
  isVault?: boolean; // false = unencrypted public file shown in Global view
  kind?: 'video' | 'photo' | 'book'; // media kind for unencrypted public files
  raw?: any;         // original /api/videos|photos|books entry for public files
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
  const [saltMode, setSaltMode] = useState<'static' | 'random'>('static');
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
  const [showSettings, setShowSettings] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [blobUrl, setBlobUrl] = useState('');

  // Vault links
  const [vaultLinks, setVaultLinks] = useState<any[]>([]);

  // Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Global view (topbar toggle): also show unencrypted files from all profiles
  const isGlobal = vaultGlobalView.value;
  const [publicFiles, setPublicFiles] = useState<VaultFile[]>([]);
  const [encrypting, setEncrypting] = useState(false);
  // Ids currently being encrypted — rendered at half opacity until they vanish.
  const [encryptingIds, setEncryptingIds] = useState<Set<string>>(new Set());
  const encPollRef = useRef<any>(null);

  // Link import modal
  const [showLinkImport, setShowLinkImport] = useState(false);
  const [linkImportText, setLinkImportText] = useState('');

  // Infinite Scroll State
  const [renderLimit, setRenderLimit] = useState(100);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Vault thumbnail batch generation
  const [thumbGen, setThumbGen] = useState<{ running: boolean; done: number; total: number }>({ running: false, done: 0, total: 0 });
  const [thumbBust, setThumbBust] = useState(0); // cache-buster to refresh posters after a run
  const thumbPollRef = useRef<any>(null);

  const startThumbGen = async () => {
    try { await fetch('/api/vault/gen-thumbs', { method: 'POST' }); } catch { return; }
    if (thumbPollRef.current) clearInterval(thumbPollRef.current);
    thumbPollRef.current = setInterval(async () => {
      try {
        const s = await fetch('/api/vault/gen-thumbs/status').then(r => r.json());
        setThumbGen(s);
        if (!s.running) {
          clearInterval(thumbPollRef.current); thumbPollRef.current = null;
          setThumbBust(Date.now());
          const w = window as any; if (w.toast) w.toast(`Generated ${s.done} thumbnail(s)`);
        }
      } catch { clearInterval(thumbPollRef.current); thumbPollRef.current = null; }
    }, 1500);
  };

  useEffect(() => () => { if (thumbPollRef.current) clearInterval(thumbPollRef.current); }, []);

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    if (status.unlocked) {
      loadVaultFiles();
    }
  }, [status.unlocked]);

  // The vault can be (re)unlocked elsewhere — the global VaultUnlockModal after
  // an auto-lock, or a profile switch — which only flips the isVaultUnlocked
  // signal. Re-sync local status and reload so freshly mounted zip folders show
  // without the open view going stale.
  useEffect(() => {
    if (isVaultUnlocked.value) {
      fetchStatus();
      loadVaultFiles();
    }
  }, [isVaultUnlocked.value]);

  // Seamless Global ⇄ Vault-Only switching — no page reload, just a data refresh
  useEffect(() => {
    if (status.unlocked && isGlobal) loadPublicFiles();
    else setPublicFiles([]);
    setRenderLimit(100);
  }, [status.unlocked, isGlobal]);

  // Expose the active vault folder + refresh fn so the Import modal / drop
  // overlay can target the open folder and refresh the grid after uploads.
  useEffect(() => {
    (window as any).vaultCurFolder = curFolder;
    (window as any).vaultFolders = folders;
    (window as any).loadVaultFiles = loadVaultFiles;
  });

  const photoFiles = useMemo(() => files.filter(f => VAULT_PHOTO_EXTS.has((f.ext || '').toLowerCase())), [files]);

  useEffect(() => {
    if (lightboxIdx === null || !photoFiles[lightboxIdx]) {
      setBlobUrl('');
      return;
    }
    const f = photoFiles[lightboxIdx];
    setBlobUrl('');
    let url = '';
    let stale = false;
    fetch(`/api/vault/stream/${f.id}`)
      .then(r => r.blob())
      .then(blob => {
        url = URL.createObjectURL(blob);
        if (stale) { URL.revokeObjectURL(url); return; }
        setBlobUrl(url);
      })
      .catch(() => { if (!stale) setBlobUrl(`/api/vault/stream/${f.id}`); });

    return () => {
      stale = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [lightboxIdx, photoFiles]);

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
      const [items, favs, cats, vLinks] = await Promise.all([
        fetch('/api/vault/files').then(r => r.json()),
        fetch('/api/vault/favs').then(r => r.json()).catch(() => []),
        fetch('/api/db/categories').then(r => r.json()).catch(() => ({})),
        fetch('/api/vault/links').then(r => r.json()).catch(() => []),
      ]);
      if (Array.isArray(vLinks)) setVaultLinks(vLinks);

      if (items.error) return;

      const fols = items.filter((f: any) => f.type === 'folder');
      const fils = items.filter((f: any) => f.type !== 'folder');

      setFolders(fols);
      setFiles(fils.map((f: any) => ({ ...f, isVault: true })));
      setFavIds(new Set(Array.isArray(favs) ? favs : []));
      setCategories(cats);

      const ai = new Set<string>();
      items.filter((f: any) => f.aiTagged).forEach((f: any) => ai.add(f.id));
      setAiIds(ai);
    } catch (e) {
      console.error('Failed to load vault files', e);
    }
  };

  // Global view: unencrypted files from every profile. all=1 bypasses the
  // current profile's enabled-categories filter (server allows it only while
  // the vault is unlocked) so files from any profile can be imported here.
  const loadPublicFiles = async () => {
    try {
      const [vids, pics, bks] = await Promise.all([
        fetch('/api/videos?all=1').then(r => r.json()).catch(() => []),
        fetch('/api/photos').then(r => r.json()).catch(() => []),
        fetch('/api/books').then(r => r.json()).catch(() => []),
      ]);
      const out: VaultFile[] = [];
      // Videos (skip links — they're URLs, not files, and import via the Links panel)
      if (Array.isArray(vids)) {
        for (const v of vids) {
          if (v.isLink) continue;
          out.push({
            id: v.id, name: (v.name || '').replace(/\.[^.]+$/, ''), originalName: v.name || '',
            ext: ((v.name || '').match(/\.[^.]+$/)?.[0] || '').toLowerCase(),
            type: 'public', kind: 'video', size: v.size, mtime: v.mtime, folder: null, isVault: false, raw: v,
          });
        }
      }
      // Photos
      if (Array.isArray(pics)) {
        for (const p of pics) {
          out.push({
            id: p.id, name: (p.filename || '').replace(/\.[^.]+$/, ''), originalName: p.filename || '',
            ext: (p.ext || ((p.filename || '').match(/\.[^.]+$/)?.[0] || '')).toLowerCase(),
            type: 'public', kind: 'photo', size: p.size, mtime: p.date, folder: null, isVault: false, raw: p,
          });
        }
      }
      // Books
      if (Array.isArray(bks)) {
        for (const b of bks) {
          out.push({
            id: b.id, name: (b.title || b.filename || '').replace(/\.[^.]+$/, ''), originalName: b.filename || b.title || '',
            ext: ((b.filename || '').match(/\.[^.]+$/)?.[0] || '').toLowerCase(),
            type: 'public', kind: 'book', size: b.size, mtime: b.mtime || b.date, folder: null, isVault: false, raw: b,
          });
        }
      }
      setPublicFiles(out);
    } catch (e) {
      console.error('Failed to load public files', e);
    }
  };

  const kindOf = (f: VaultFile): 'video' | 'photo' | 'book' => {
    if (f.kind) return f.kind;
    const ext = (f.ext || '').toLowerCase();
    if (VAULT_PHOTO_EXTS.has(ext)) return 'photo';
    if (VAULT_BOOK_EXTS.has(ext)) return 'book';
    return 'video';
  };

  // Encrypt one or more unencrypted public files into the Vault. The server
  // shreds each original, encrypts it (along with its thumbnail) and drops its
  // public DB entry. Each thumbnail fades to half opacity while it encrypts and
  // disappears once done; progress is mirrored in Sync & Background Tasks.
  const encryptItems = async (targets: VaultFile[]) => {
    const w = window as any;
    if (!targets.length || encrypting) return;
    const items = targets.map(t => ({ id: t.id, kind: kindOf(t), name: t.name || t.originalName }));

    setEncrypting(true);
    setEncryptingIds(new Set(items.map(i => i.id)));

    const r = await fetch('/api/vault/encrypt-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      if (w.toast) w.toast('Encryption failed: ' + (err.error || 'Unknown error'));
      setEncrypting(false);
      setEncryptingIds(new Set());
      return;
    }

    // Poll progress. The server processes items in the order we sent them, so
    // we can hide each thumbnail as its index is reached.
    const orderedIds = items.map(i => i.id);
    const removeFinished = (ids: Set<string>) => {
      if (!ids.size) return;
      setPublicFiles(prev => prev.filter(f => !ids.has(f.id)));
      setSelectedIds(prev => { const n = new Set(prev); for (const id of ids) n.delete(id); return n; });
    };

    const poll = async () => {
      try {
        const s = await fetch('/api/encryption/status').then(res => res.json());
        const done = s.done || 0;
        if (done > 0) removeFinished(new Set(orderedIds.slice(0, done)));
        if (!s.running) {
          if (encPollRef.current) { clearInterval(encPollRef.current); encPollRef.current = null; }
          removeFinished(new Set(orderedIds));
          setEncryptingIds(new Set());
          setEncrypting(false);
          loadVaultFiles();
          if (w.toast) w.toast(s.error ? ('Encryption error: ' + s.error) : `Encrypted ${orderedIds.length} item${orderedIds.length !== 1 ? 's' : ''} into the Vault`);
        }
      } catch { }
    };
    if (encPollRef.current) clearInterval(encPollRef.current);
    encPollRef.current = setInterval(poll, 700);
    poll();
  };

  const encryptSelectedPublic = () => {
    const targets = publicFiles.filter(f => selectedIds.has(f.id));
    if (!targets.length || encrypting) return;
    encryptItems(targets);
  };

  // Stop the progress poll if the view unmounts mid-encryption.
  useEffect(() => () => { if (encPollRef.current) clearInterval(encPollRef.current); }, []);

  // ── Link import (paste JSON / browser bookmarks / plain URLs) ──────────
  const extractUrls = (text: string): string[] => {
    const urls = new Set<string>();
    const add = (u: any) => { if (typeof u === 'string' && /^https?:\/\//i.test(u.trim())) urls.add(u.trim()); };
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const walk = (node: any) => {
          if (!node) return;
          if (typeof node === 'string') { add(node); return; }
          if (Array.isArray(node)) { node.forEach(walk); return; }
          if (typeof node === 'object') { add(node.url); add(node.href); Object.values(node).forEach(walk); }
        };
        walk(JSON.parse(trimmed));
        if (urls.size) return [...urls];
      } catch { }
    }
    // Browser bookmark HTML exports: pull every href="…"
    const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
    let mm: RegExpExecArray | null;
    while ((mm = hrefRe.exec(text))) add(mm[1]);
    if (urls.size) return [...urls];
    // Fallback: any bare http(s) URL in the text
    const urlRe = /https?:\/\/[^\s"'<>]+/gi;
    let m2: RegExpExecArray | null;
    while ((m2 = urlRe.exec(text))) add(m2[0]);
    return [...urls];
  };

  const submitLinkImport = async () => {
    const w = window as any;
    const urls = extractUrls(linkImportText);
    if (!urls.length) { if (w.toast) w.toast('No URLs found in the input'); return; }
    const r = await fetch('/api/vault/import-links', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { if (w.toast) w.toast(d.error || 'Import failed'); return; }
    if (w.toast) w.toast(`Imported ${d.added} link${d.added !== 1 ? 's' : ''} into the Vault` + (d.skipped ? `, ${d.skipped} duplicate(s) skipped` : ''));
    setShowLinkImport(false);
    setLinkImportText('');
    // Update the list optimistically so it reflects the import even if a
    // follow-up fetch fails (e.g. the vault auto-locks between requests).
    setVaultLinks(prev => {
      const seen = new Set(prev.map(l => l.url));
      const added = urls.filter(u => !seen.has(u)).map(u => ({ url: u, title: u, addedAt: Date.now() }));
      return added.length ? [...prev, ...added] : prev;
    });
    fetch('/api/vault/links').then(res => res.json()).then(v => { if (Array.isArray(v)) setVaultLinks(v); }).catch(() => { });
  };

  const handleLinkImportFile = async (file: File) => {
    if (!file) return;
    try {
      const text = await file.text();
      setLinkImportText(prev => (prev ? prev + '\n' : '') + text);
    } catch { }
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
        isVaultUnlocked.value = true;
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
        body: JSON.stringify({ password, useRandomSalt: saltMode === 'random' })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to setup');
      } else {
        setPassword('');
        setConfirmPassword('');
        setSaltMode('static');
        isVaultUnlocked.value = true;
        fetchStatus();
      }
    } catch (e: any) {
      setError(e.message || 'Failed to setup');
    } finally {
      setLoading(false);
    }
  };

  const handleDecryptFile = async (id: string) => {
    const res = await fetch(`/api/vault/files/${id}/restore-to-origin`, { method: 'POST' });
    const w = window as any;
    if (res.ok) {
      setFiles(prev => prev.filter(f => f.id !== id));
      if (w.toast) w.toast('File restored to original folder');
      // SSE scan_changed fires when the file lands in VIDEOS_DIR — no manual reload needed
    } else {
      const err = await res.json().catch(() => ({}));
      if (w.toast) w.toast('Restore failed: ' + (err.error || 'Unknown error'));
    }
  };

  const handleDeleteFile = async (id: string) => {
    if (!await confirmDialog('Permanently delete this encrypted file?')) return;
    const res = await fetch('/api/vault/files/' + id, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      await alertDialog(err.error || 'Delete failed');
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
      await alertDialog('Move failed');
      return;
    }
    setFiles(files.map(f => f.id === fileId ? { ...f, folder: folderId } : f));
    const w = window as any;
    if (w.toast) w.toast('Moved');
  };

  const handleCreateFolder = async (name: string, parentId: string | null) => {
    const res = await fetch('/api/vault/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parent: parentId })
    });
    const d = await res.json();
    if (!res.ok) { (window as any).toast?.(d.error || 'Failed to create folder'); return; }
    setFolders(prev => [...prev, { id: d.id, name: d.name, parent: parentId, type: 'folder', mtime: Date.now() }]);
    (window as any).toast?.('Folder created');
  };

  const handleRenameFolder = async (id: string, newName: string) => {
    const res = await fetch(`/api/vault/folders/${id}/rename`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    });
    if (!res.ok) { const d = await res.json(); (window as any).toast?.(d.error || 'Rename failed'); return; }
    setFolders(prev => prev.map(f => f.id === id ? { ...f, name: newName } : f));
    (window as any).toast?.('Folder renamed');
  };

  const handleDeleteFolder = async (id: string, name: string) => {
    const parentId = folders.find(f => f.id === id)?.parent || null;
    if (!await confirmDialog(`Delete folder "${name}"? Contents will move to parent folder.`)) return;
    const res = await fetch('/api/vault/folders/' + id, { method: 'DELETE' });
    if (!res.ok) { const d = await res.json().catch(() => ({})); (window as any).toast?.(d.error || 'Failed to delete folder'); return; }
    setFolders(prev => prev.filter(f => f.id !== id).map(f => f.parent === id ? { ...f, parent: parentId } : f));
    setFiles(prev => prev.map(f => f.folder === id ? { ...f, folder: parentId } : f));
    if (curFolder === id) setCurFolder(parentId);
    (window as any).toast?.('Folder deleted');
  };

  const handleMoveFolder = async (id: string, newParentId: string | null) => {
    const res = await fetch(`/api/vault/folders/${id}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: newParentId })
    });
    if (!res.ok) { const d = await res.json(); (window as any).toast?.(d.error || 'Move failed'); return; }
    setFolders(prev => prev.map(f => f.id === id ? { ...f, parent: newParentId } : f));
    (window as any).toast?.('Folder moved');
  };

  const handleFileClick = (f: VaultFile) => {
    if (f.isVault === false && f.raw) {
      // Public file in Global view — play through the normal player
      currentVideo.value = f.raw;
      currentView.value = 'player';
      return;
    }
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
        starred: false,
      };
      currentView.value = 'player';
    } else if (VAULT_PHOTO_EXTS.has(extLower)) {
      const idx = photoFiles.findIndex(file => file.id === f.id);
      setLightboxIdx(idx >= 0 ? idx : 0);
    } else if (VAULT_BOOK_EXTS.has(extLower)) {
      const w = window as any;
      if (w.openBook) {
        w.openBook(f.id, true);
      } else {
        alertDialog('Book reader not available');
      }
    }
  };

  const openCtx = (e: any, file: VaultFile) => {
    e.preventDefault();
    e.stopPropagation();
    contextMenuState.value = {
      visible: true,
      x: e.pageX,
      y: e.pageY,
      type: 'file',
      data: {
        id: file.id,
        name: file.name || file.originalName,
        onDelete: file.isVault === false ? undefined : () => handleDeleteFile(file.id),
        onOpen: () => handleFileClick(file),
        onEncrypt: file.isVault === false ? () => encryptItems([file]) : undefined
      }
    };
  };

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleDeleteSelected = async () => {
    // Only vault files can be deleted here — public files in Global view are skipped
    const ids = Array.from(selectedIds).filter(id => files.some(f => f.id === id));
    if (!ids.length) return;
    if (!await confirmDialog(`Delete ${ids.length} selected items?`)) return;

    for (const id of ids) {
      await fetch(`/api/vault/files/${id}`, { method: 'DELETE' });
    }

    setFiles(files.filter(f => !selectedIds.has(f.id)));
    setSelectedIds(new Set());
    const w = window as any;
    if (w.toast) w.toast(`Deleted ${ids.length} items`);
  };

  // Bulk-decrypt the selected vault files back to their original folders.
  // Only vault (encrypted) files are eligible — public files are skipped.
  const handleDecryptSelected = async () => {
    const ids = Array.from(selectedIds).filter(id => files.some(f => f.id === id));
    if (!ids.length) return;
    if (!await confirmDialog(`Decrypt & restore ${ids.length} selected file${ids.length !== 1 ? 's' : ''}?`)) return;

    let ok = 0;
    for (const id of ids) {
      const res = await fetch(`/api/vault/files/${id}/restore-to-origin`, { method: 'POST' });
      if (res.ok) ok++;
    }

    setFiles(prev => prev.filter(f => !selectedIds.has(f.id)));
    setSelectedIds(new Set());
    const w = window as any;
    // SSE scan_changed fires when files land in VIDEOS_DIR — no manual reload needed
    if (w.toast) w.toast(`Decrypted ${ok} file${ok !== 1 ? 's' : ''}`);
  };

  const createNewVaultTextFile = async () => {
    let name = await promptDialog('Enter text file name:', 'notes.txt');
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

  // Import a ZIP (optionally password-protected): upload it into the vault,
  // then extract its entries either into the vault or to a folder on disk.
  const handleImportZip = async (file: File) => {
    const w = window as any;
    if (!file) return;
    try {
      // 1. Stream the archive into the vault to get an id to read from.
      const up = await fetch('/api/vault/add', {
        method: 'POST',
        headers: { 'x-filename': encodeURIComponent(file.name), ...(curFolder ? { 'x-folder': curFolder } : {}) },
        body: file,
      });
      const upData = await up.json();
      if (!up.ok || !upData.id) { if (w.toast) w.toast('Upload failed'); return; }

      // 2. Probe entries; ask for a password if the archive is encrypted.
      let password = '';
      const probe = await fetch('/api/vault/zip-entries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: upData.id }),
      });
      const probeData = await probe.json();
      if (probeData.encrypted) {
        password = await promptDialog('This archive is password-protected. Enter its password:') || '';
        if (!password) { if (w.toast) w.toast('Password required'); return; }
      }

      // 3. Choose destination. OK = encrypt into vault, Cancel = extract to a folder.
      const toVault = await confirmDialog('Import extracted files into the vault?', { confirmLabel: 'Encrypt into vault', cancelLabel: 'Extract to folder' });
      const mode = toVault ? 'vault' : 'extract';
      const body: any = { id: upData.id, password, mode };
      if (mode === 'extract') {
        const folder = await promptDialog('Folder name to extract into (under your media directory):', file.name.replace(/\.zip$/i, ''));
        if (folder === null) return;
        body.destFolder = folder;
      } else {
        body.folder = curFolder || null;
      }

      const imp = await fetch('/api/vault/import-zip', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const impData = await imp.json();
      if (!imp.ok) { if (w.toast) w.toast(impData.error || 'Import failed'); return; }

      // 4. The uploaded .zip itself is redundant once extracted — remove it.
      try { await fetch('/api/vault/files/' + upData.id, { method: 'DELETE' }); } catch {}

      if (w.toast) w.toast(`Imported ${impData.count} file(s)` + (mode === 'extract' ? ` → ${impData.folder}` : ' into vault'));
      loadVaultFiles();
    } catch (e: any) {
      if (w.toast) w.toast('ZIP import error: ' + (e?.message || e));
    }
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
    if (!await confirmDialog(`Delete ${dupes.length} duplicate file${dupes.length > 1 ? 's' : ''}? (Keeps newest copy of each)`)) return;
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
    a.href = `/api/vault/download/${id}`;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const filteredFiles = useMemo(() => {
    let result = isGlobal ? [...files, ...publicFiles] : [...files];
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
  }, [files, publicFiles, isGlobal, curFolder, typeFilter, searchQuery, sortField, sortDir, favIds, aiIds, catFilter, categories]);

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

            <label
              htmlFor="vaultZipIn"
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              title="Import a .zip (supports password-protected archives)"
            >
              Import ZIP
            </label>
            <input
              type="file"
              id="vaultZipIn"
              accept=".zip,application/zip"
              style={{ display: 'none' }}
              onChange={(e: any) => { const f = e.target.files && e.target.files[0]; if (f) handleImportZip(f); e.target.value = ''; }}
            />

            <button
              onClick={() => setShowLinkImport(true)}
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}
              title="Import links from browser bookmarks or JSON — saved encrypted in the Vault"
            >
              Import Links
            </button>

            <button
              onClick={createNewVaultTextFile}
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}
              title="New Text File"
            >
              New File
            </button>

            <button
              onClick={() => {
                const w = window as any;
                if (w.startMosaicWithPhotos) {
                  w.startMosaicWithPhotos(files.filter(f => VAULT_PHOTO_EXTS.has((f.ext || '').toLowerCase())));
                }
              }}
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

            {isGlobal && publicFiles.some(f => selectedIds.has(f.id)) && (
              <button
                onClick={encryptSelectedPublic}
                disabled={encrypting}
                style={{ background: 'var(--ac)', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: '4px', cursor: encrypting ? 'wait' : 'pointer', fontWeight: 600 }}
                title="Encrypt all selected unencrypted files into the Vault"
              >
                {encrypting ? 'Encrypting…' : `🔒 Encrypt Selected (${publicFiles.filter(f => selectedIds.has(f.id)).length})`}
              </button>
            )}
            {/* Decrypt: never offered while browsing all public videos (Global
                view); always available in the vault-only view when vault files
                are selected. */}
            {!isGlobal && files.some(f => selectedIds.has(f.id)) && (
              <button
                onClick={handleDecryptSelected}
                style={{ background: 'var(--ac)', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
                title="Decrypt the selected files back to their original folders"
              >
                🔓 Decrypt Selected ({files.filter(f => selectedIds.has(f.id)).length})
              </button>
            )}
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
              onClick={startThumbGen}
              disabled={thumbGen.running}
              title="Generate encrypted poster thumbnails for vault videos"
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px 16px', borderRadius: '4px', cursor: thumbGen.running ? 'default' : 'pointer', opacity: thumbGen.running ? 0.6 : 1 }}
            >
              {thumbGen.running ? `Thumbnails… ${thumbGen.done}/${thumbGen.total}` : 'Generate Thumbnails'}
            </button>

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

        {/* Nested Folder Tree */}
        {!searchQuery && !typeFilter && (
          <div style={{ marginBottom: '16px' }}>
            <FolderTree
              folders={folders as FolderEntry[]}
              currentFolderId={curFolder}
              onNavigate={(id) => { setCurFolder(id); setRenderLimit(100); }}
              onCreateFolder={handleCreateFolder}
              onRenameFolder={handleRenameFolder}
              onDeleteFolder={handleDeleteFolder}
              onMoveFolder={handleMoveFolder}
            />
          </div>
        )}

        {/* Files Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px' }}>
          {visibleFiles.map(f => {
            const isPublic = f.isVault === false;
            const isImg = VAULT_PHOTO_EXTS.has(f.ext.toLowerCase());
            const isVid = VAULT_VIDEO_EXTS.has(f.ext.toLowerCase());
            const isFav = favIds.has(f.id);
            const isSelected = selectedIds.has(f.id);
            const isEncrypting = encryptingIds.has(f.id);
            // Public photos serve their image directly; videos use the thumb endpoint; books have no preview.
            // Vault photos stream the (small) image; vault videos use the encrypted poster.
            const hasThumb = isPublic ? f.kind !== 'book' : (isImg || isVid);
            const thumbSrc = isPublic
              ? (f.kind === 'photo' ? `/api/photos/${f.id}/img` : f.raw?.isLink ? (f.raw.img || '') : `/api/thumbs/${f.id}/0`)
              : (isImg ? `/api/vault/stream/${f.id}` : `/api/vault/thumb/${f.id}${thumbBust ? `?_=${thumbBust}` : ''}`);
            // While encrypting: fade the thumbnail to half opacity, then it vanishes on completion.
            const cardOpacity = isEncrypting ? 0.45 : (isPublic ? 0.92 : undefined);
            return (
              <div key={f.id} className={`video-card ${isSelected ? 'selected' : ''}`} onContextMenu={(e) => openCtx(e, f)} style={{ border: isSelected ? '2.5px solid #ff7300' : '1px solid var(--brd)', backgroundColor: isSelected ? 'rgba(255, 115, 0, 0.12)' : undefined, boxShadow: isSelected ? '0 0 15px rgba(255, 115, 0, 0.45)' : undefined, opacity: cardOpacity, transition: 'opacity 0.35s ease', pointerEvents: isEncrypting ? 'none' : undefined }}>
                <div className="card-thumb" style={{ cursor: 'pointer' }} onClick={() => handleFileClick(f)}>
                  {hasThumb ? (
                    <>
                      <img
                        src={thumbSrc}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        loading="lazy"
                        onError={(e: any) => { e.currentTarget.style.display = 'none'; const ph = e.currentTarget.nextElementSibling; if (ph) ph.style.display = 'flex'; }}
                      />
                      {/* Shown only if the poster fails to load (e.g. not generated yet) */}
                      <span style={{ display: 'none', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', color: 'var(--tx2)' }}>
                        {f.ext.replace('.', '').toUpperCase()}
                      </span>
                    </>
                  ) : (
                    <span style={{ fontSize: '1.2rem', color: 'var(--tx2)' }}>{f.ext.replace('.', '').toUpperCase()}</span>
                  )}
                  {isEncrypting && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', color: '#fff', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.5px' }}>
                      🔒 Encrypting…
                    </div>
                  )}

                  {/* Selection Checkbox */}
                  <div
                    style={{ position: 'absolute', top: '4px', left: '4px', cursor: 'pointer', background: 'rgba(0,0,0,0.5)', borderRadius: '4px', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onClick={(e) => { e.stopPropagation(); handleToggleSelect(f.id); }}
                  >
                    <input type="checkbox" checked={isSelected} onChange={() => { }} style={{ cursor: 'pointer' }} />
                  </div>

                  {!isPublic && (
                    <div
                      style={{ position: 'absolute', top: '4px', right: '4px', cursor: 'pointer' }}
                      onClick={(e) => { e.stopPropagation(); handleToggleFav(f.id); }}
                    >
                      {isFav ? '❤️' : '🤍'}
                    </div>
                  )}
                  {isPublic && (
                    <span style={{ position: 'absolute', bottom: '4px', left: '4px', background: 'rgba(232,64,64,0.85)', color: '#fff', fontSize: '0.6rem', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', letterSpacing: '0.5px' }}>
                      UNENCRYPTED
                    </span>
                  )}
                  {f.sizeF && <span className="size-badge">{f.sizeF}</span>}
                </div>
                <div className="card-body">
                  <div className="card-title" title={f.originalName || f.name}>
                    {f.name || f.originalName}
                  </div>
                  <div className="card-meta">
                    <span className="card-category">{isPublic ? (f.raw?.category || (f.kind === 'photo' ? 'Photo' : f.kind === 'book' ? 'Book' : 'Public')) : 'Vault'}</span>
                    {isPublic ? (
                      <div className="card-actions">
                        <button
                          onClick={(e) => { e.stopPropagation(); encryptItems([f]); }}
                          disabled={encryptingIds.has(f.id)}
                          style={{ background: 'transparent', border: 'none', color: 'var(--ac)', cursor: encryptingIds.has(f.id) ? 'wait' : 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
                          title="Encrypt into Vault"
                        >
                          {encryptingIds.has(f.id) ? '🔒 Encrypting…' : '🔒 Encrypt'}
                        </button>
                      </div>
                    ) : (
                    <div className="card-actions">
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
                        onClick={(e) => { e.stopPropagation(); handleDecryptFile(f.id); }}
                        style={{ background: 'transparent', border: 'none', color: 'var(--tx2)', cursor: 'pointer', fontSize: '0.75rem' }}
                        title="Decrypt & restore"
                      >
                        🔓
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteFile(f.id); }}
                        style={{ background: 'transparent', border: 'none', color: 'var(--tx2)', cursor: 'pointer', fontSize: '0.75rem' }}
                        title="Delete"
                      >
                        🗑️
                      </button>
                    </div>
                    )}
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

        {/* Vault Links */}
        {vaultLinks.length > 0 && (
          <div style={{ marginTop: '32px' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '1rem', color: 'var(--tx2)' }}>Links ({vaultLinks.length})</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[...vaultLinks].sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0)).map((lnk: any) => (
                <div key={lnk.url} style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--bg3)', borderRadius: '8px', padding: '10px 12px', border: '1px solid var(--brd)' }}>
                  {lnk.img && <img src={lnk.img} alt="" style={{ width: '48px', height: '36px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lnk.title || lnk.url}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--tx3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lnk.url}</div>
                  </div>
                  <button
                    onClick={async () => {
                      const r = await fetch('/api/vault/link-fav', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: lnk.url }) });
                      if (r.ok) {
                        const d = await r.json();
                        setVaultLinks(prev => prev.map(l => l.url === lnk.url ? { ...l, fav: d.fav } : l));
                      }
                    }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.95rem', flexShrink: 0 }}
                    title={lnk.fav ? 'Remove private favourite' : 'Private favourite'}
                    type="button"
                  >{lnk.fav ? '❤️' : '🤍'}</button>
                  <button
                    onClick={async () => {
                      const r = await fetch('/api/vault/restore-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: lnk.url }) });
                      if (r.ok) setVaultLinks(prev => prev.filter(l => l.url !== lnk.url));
                    }}
                    style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '4px', padding: '4px 8px', fontSize: '0.72rem', cursor: 'pointer', flexShrink: 0 }}
                    title="Restore to Links"
                    type="button"
                  >🔓 Restore</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {showLinkImport && (
          <div
            onClick={() => setShowLinkImport(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '12px', width: '460px', maxWidth: '92vw', padding: '24px' }}
            >
              <h3 style={{ marginTop: 0 }}>Import Links into the Vault</h3>
              <p style={{ color: 'var(--tx2)', fontSize: '0.85rem', marginTop: 0 }}>
                Paste URLs (one per line), a JSON array/export, or browser bookmarks HTML. Imported links are stored encrypted at rest.
              </p>
              <textarea
                value={linkImportText}
                onInput={(e: any) => setLinkImportText(e.target.value)}
                placeholder={'https://example.com/page\nhttps://...'}
                style={{ width: '100%', minHeight: '160px', resize: 'vertical', padding: '10px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '6px', fontFamily: 'monospace', fontSize: '0.8rem', boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
                <label
                  htmlFor="vaultLinkImportFile"
                  style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}
                  title="Load a bookmarks .html / .json / .txt file"
                >
                  Load file…
                </label>
                <input
                  type="file"
                  id="vaultLinkImportFile"
                  accept=".json,.html,.htm,.txt,text/html,application/json,text/plain"
                  style={{ display: 'none' }}
                  onChange={(e: any) => { const f = e.target.files && e.target.files[0]; if (f) handleLinkImportFile(f); e.target.value = ''; }}
                />
                <div style={{ flex: 1 }} />
                <button
                  onClick={() => { setShowLinkImport(false); setLinkImportText(''); }}
                  style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={submitLinkImport}
                  disabled={!linkImportText.trim()}
                  style={{ background: 'var(--ac)', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: '6px', cursor: linkImportText.trim() ? 'pointer' : 'default', fontWeight: 600, opacity: linkImportText.trim() ? 1 : 0.5 }}
                >
                  Import & Encrypt
                </button>
              </div>
            </div>
          </div>
        )}

        {lightboxIdx !== null && photoFiles[lightboxIdx] && (
          <PhotoLightbox
            isOpen={true}
            onClose={() => setLightboxIdx(null)}
            imgUrl={blobUrl}
            title={photoFiles[lightboxIdx].name || photoFiles[lightboxIdx].originalName}
            sizeF={photoFiles[lightboxIdx].sizeF}
            onPrev={() => setLightboxIdx(prev => (prev !== null && prev > 0 ? prev - 1 : photoFiles.length - 1))}
            onNext={() => setLightboxIdx(prev => (prev !== null && prev < photoFiles.length - 1 ? prev + 1 : 0))}
            onDelete={() => handleDeleteFile(photoFiles[lightboxIdx].id)}
            onFav={() => handleToggleFav(photoFiles[lightboxIdx].id)}
            isFav={favIds.has(photoFiles[lightboxIdx].id)}
            onDownload={() => downloadFile(photoFiles[lightboxIdx].id, photoFiles[lightboxIdx].name || photoFiles[lightboxIdx].originalName)}
            onDescribe={() => describeFile(photoFiles[lightboxIdx].id, 'photo')}
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
            <>
              <input
                type="password"
                value={confirmPassword}
                onInput={(e: any) => setConfirmPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSetup()}
                placeholder="Confirm Password"
                style={{ padding: '10px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '6px' }}
              />

              {/* Salt mode selection */}
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--brd)', borderRadius: '8px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--tx2)' }}>Encryption Salt</div>

                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                  <input type="radio" name="saltMode" checked={saltMode === 'static'} onChange={() => setSaltMode('static')}
                    style={{ marginTop: '2px', accentColor: 'var(--ac)', cursor: 'pointer' }} />
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--tx)' }}>
                      Static salt <span style={{ fontWeight: 'normal', color: 'var(--ac)', fontSize: '0.75rem' }}>— Recommended</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--tx3)', marginTop: '2px' }}>
                      Uses a fixed salt ("AphroArchive"). Any installation with the same password can open this vault — great for backups and moving between machines.
                    </div>
                  </div>
                </label>

                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                  <input type="radio" name="saltMode" checked={saltMode === 'random'} onChange={() => setSaltMode('random')}
                    style={{ marginTop: '2px', accentColor: 'var(--ac)', cursor: 'pointer' }} />
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--tx)' }}>
                      Random salt <span style={{ fontWeight: 'normal', color: '#f59e0b', fontSize: '0.75rem' }}>⚠ Portability limited</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--tx3)', marginTop: '2px' }}>
                      Generates a unique random salt per installation — slightly stronger against dictionary attacks.{' '}
                      <strong style={{ color: '#f59e0b' }}>Cannot be opened on another machine</strong> without copying <code>cache/vault.json</code>.
                    </div>
                  </div>
                </label>
              </div>
            </>
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
