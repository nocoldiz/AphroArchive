import { useState, useRef, useEffect } from 'preact/hooks';
import { allVideos, categories, loadCategories, loadVideos } from '../../store';
import { Video } from '../../types';

type Side   = 'left' | 'right';
type Source = 'both' | 'local' | 'remote';

// ── helpers ──────────────────────────────────────────────────────────────

function thumbSrc(v: Video): string {
  if (v.isLink) return v.img || '';
  return `/api/thumbs/${v.id}/0`;
}

// Decode the base64url link id back to URL for move operations
function linkUrl(id: string): string {
  try { return atob(id.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '') + '=='.slice((id.length * 6 % 8) ? (id.length * 6 % 8 === 2 ? 2 : 1) : 0)); } catch { return ''; }
}

// ── component ─────────────────────────────────────────────────────────────

export const CategorizerView = () => {
  // Signal reads in the component body keep Preact reactive
  const allVids = allVideos.value;
  const cats    = categories.value.filter(c => c.path !== 'uncategorized');

  const [catL, setCatL] = useState('');
  const [catR, setCatR] = useState('');
  const [selL, setSelL] = useState<Set<string>>(new Set());
  const [selR, setSelR] = useState<Set<string>>(new Set());
  const [searchL, setSearchL] = useState('');
  const [searchR, setSearchR] = useState('');
  const [sourceL, setSourceL] = useState<Source>('both');
  const [sourceR, setSourceR] = useState<Source>('both');
  const [dropOver, setDropOver] = useState<Side | null>(null);
  const [moving, setMoving] = useState(false);
  const [newFolderSide, setNewFolderSide] = useState<Side | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [renameSide, setRenameSide] = useState<Side | null>(null);
  const [renameName, setRenameName] = useState('');
  const [extraCats, setExtraCats] = useState<{ name: string; path: string }[]>([]);

  const dragRef      = useRef<{ ids: string[]; from: Side }>({ ids: [], from: 'left' });
  const dragCtrL     = useRef(0);
  const dragCtrR     = useRef(0);
  const lastClickL   = useRef(-1);
  const lastClickR   = useRef(-1);

  useEffect(() => {
    if (categories.value.length === 0) loadCategories();
    if (allVideos.value.length === 0) loadVideos();
  }, []);

  const allCats = [...cats, ...extraCats.filter(ec => !cats.some(c => c.path === ec.path))];

  const getCat    = (s: Side) => s === 'left' ? catL : catR;
  const getSel    = (s: Side) => s === 'left' ? selL : selR;
  const setSel    = (s: Side, v: Set<string>) => s === 'left' ? setSelL(v) : setSelR(v);
  const getSearch = (s: Side) => s === 'left' ? searchL : searchR;
  const setSearch = (s: Side, v: string) => s === 'left' ? setSearchL(v) : setSearchR(v);
  const getSource = (s: Side) => s === 'left' ? sourceL : sourceR;
  const setSource = (s: Side, v: Source) => s === 'left' ? setSourceL(v) : setSourceR(v);
  const inSearch  = (s: Side) => getSearch(s).trim() !== '';
  const lastClick = (s: Side) => s === 'left' ? lastClickL : lastClickR;

  // ── Fuzzy match: all chars in query appear in order in the target ──
  const fuzzyMatch = (target: string, query: string): boolean => {
    target = target.toLowerCase();
    query = query.toLowerCase();
    let ti = 0;
    for (let qi = 0; qi < query.length; qi++) {
      const ch = query[qi];
      if (ch === ' ') continue; // skip spaces
      ti = target.indexOf(ch, ti);
      if (ti === -1) return false;
      ti++;
    }
    return true;
  };

  // Return the set of video ids currently visible in the opposite panel
  const otherPanelIds = (s: Side): Set<string> => {
    const other: Side = s === 'left' ? 'right' : 'left';
    const otherVids = panelVideosRaw(other);
    return new Set(otherVids.map(v => v.id));
  };

  const applySource = (vids: Video[], src: Source) => {
    if (src === 'local')  return vids.filter(v => !v.isLink);
    if (src === 'remote') return vids.filter(v =>  v.isLink);
    return vids;
  };

  const panelVideosRaw = (s: Side): Video[] => {
    const q = getSearch(s).trim().toLowerCase();
    if (q) {
      return allVids.filter(v =>
        fuzzyMatch(v.name, q) ||
        fuzzyMatch(v.catPath  || '', q) ||
        fuzzyMatch(v.category || '', q)
      );
    }
    const cat = getCat(s);
    if (!cat) return [];
    return allVids.filter(v => (v.catPath || '') === cat);
  };

  const panelVideos = (s: Side): Video[] => {
    const result = panelVideosRaw(s);
    const filtered = applySource(result, getSource(s));
    // When searching, exclude videos already visible in the other panel
    const q = getSearch(s).trim();
    if (q) {
      const otherIds = otherPanelIds(s);
      return filtered.filter(v => !otherIds.has(v.id));
    }
    // When a category is selected, also exclude videos already in the other panel
    // to avoid moving a video into its current folder
    if (getCat(s)) {
      const otherIds = otherPanelIds(s);
      return filtered.filter(v => !otherIds.has(v.id));
    }
    return filtered;
  };

  const pickCat = (s: Side, path: string) => {
    if (s === 'left') { setCatL(path); setSelL(new Set()); setSearchL(''); lastClickL.current = -1; }
    else              { setCatR(path); setSelR(new Set()); setSearchR(''); lastClickR.current = -1; }
  };

  // ── Selection ─────────────────────────────────────────────────────────

  const handleCardClick = (e: MouseEvent, s: Side, idx: number, id: string, vids: Video[]) => {
    const lc = lastClick(s);
    if (e.shiftKey && lc.current >= 0) {
      const lo = Math.min(lc.current, idx);
      const hi = Math.max(lc.current, idx);
      const rangeIds = vids.slice(lo, hi + 1).map(v => v.id);
      setSel(s, new Set([...getSel(s), ...rangeIds]));
    } else {
      const next = new Set(getSel(s));
      next.has(id) ? next.delete(id) : next.add(id);
      setSel(s, next);
      lc.current = idx;
    }
  };

  // ── Drag ──────────────────────────────────────────────────────────────

  const onDragStart = (e: DragEvent, side: Side, id: string) => {
    const sel = getSel(side);
    const ids = sel.has(id) && sel.size > 1 ? [...sel] : [id];
    dragRef.current = { ids, from: side };
    e.dataTransfer!.setData('text/plain', 'categorizer');
    e.dataTransfer!.effectAllowed = 'move';
    if (ids.length > 1) {
      const ghost = document.createElement('div');
      ghost.textContent = `${ids.length} items`;
      Object.assign(ghost.style, {
        position: 'fixed', top: '-200px',
        background: 'var(--ac)', color: '#fff',
        padding: '6px 14px', borderRadius: '8px',
        fontSize: '13px', fontWeight: '700',
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
      });
      document.body.appendChild(ghost);
      e.dataTransfer!.setDragImage(ghost, 30, 20);
      requestAnimationFrame(() => ghost.remove());
    }
  };

  const canDrop = (targetSide: Side) => {
    if (inSearch(targetSide)) return false;
    // Don't allow drop if all dragged items are already in the target folder
    const { ids, from } = dragRef.current;
    if (ids.length && from !== targetSide) {
      const targetCat = getCat(targetSide);
      if (targetCat) {
        const allSame = ids.every(id => {
          const v = allVids.find(v => v.id === id);
          return v && (v.catPath || '') === targetCat;
        });
        if (allSame) return false;
      }
    }
    return true;
  };

  const onDrop = async (targetSide: Side) => {
    dragCtrL.current = 0;
    dragCtrR.current = 0;
    setDropOver(null);
    const { ids, from } = dragRef.current;
    if (!ids.length || from === targetSide || !canDrop(targetSide)) return;

    const targetCat = getCat(targetSide);

    // Guard: skip if all items are already in the target category
    if (targetCat) {
      const allAlreadyThere = ids.every(id => {
        const v = allVids.find(v => v.id === id);
        return v && (v.catPath || '') === targetCat;
      });
      if (allAlreadyThere) {
        setMoving(false);
        return;
      }
    }
    setMoving(true);

    // Split into local videos and links
    const idSet = new Set(ids);
    const movingVids  = allVids.filter(v => !v.isLink && idSet.has(v.id));
    const movingLinks = allVids.filter(v =>  v.isLink && idSet.has(v.id));

    const [vidResults, linkResult] = await Promise.all([
      Promise.all(
        movingVids.map(v =>
          fetch(`/api/videos/${encodeURIComponent(v.id)}/move`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category: targetCat }),
          }).then(r => r.json()).then(d => ({ id: v.id, ...d })).catch(() => ({ id: v.id, error: 'network' }))
        )
      ),
      movingLinks.length
        ? fetch('/api/links/move', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls: movingLinks.map(v => v.linkUrl || v.relPath), category: targetCat }),
          }).then(r => r.json()).catch(() => ({ ok: false }))
        : Promise.resolve({ ok: true }),
    ]);

    const movedVidIds = new Map<string, string>(
      vidResults.filter(r => r.ok).map(r => [r.id, r.newId])
    );
    const targetCatName = allCats.find(c => c.path === targetCat)?.name || targetCat || 'Uncategorized';
    const failCount = vidResults.filter(r => !r.ok).length + (movingLinks.length && !linkResult.ok ? movingLinks.length : 0);

    if (failCount) alert(`${failCount} move${failCount > 1 ? 's' : ''} failed`);

    if (movedVidIds.size || (movingLinks.length && linkResult.ok)) {
      allVideos.value = allVids.map(v => {
        const newId = movedVidIds.get(v.id);
        if (newId) return { ...v, id: newId, catPath: targetCat, category: targetCatName };
        if (v.isLink && movingLinks.some(l => l.id === v.id) && linkResult.ok) {
          return { ...v, catPath: targetCat, category: targetCatName };
        }
        return v;
      });
      setSel(from, new Set([...getSel(from)].filter(id => !movedVidIds.has(id) && !movingLinks.some(l => l.id === id))));
      if ((window as any).loadVideos) (window as any).loadVideos();
    }
    setMoving(false);
  };

  // ── Folder operations ─────────────────────────────────────────────────

  const createFolder = () => {
    const name = newFolderName.trim().replace(/^\/+|\/+$/g, '');
    if (!name || !newFolderSide) return;
    setExtraCats(prev => [...prev.filter(c => c.path !== name), { name, path: name }]);
    pickCat(newFolderSide, name);
    setNewFolderSide(null);
    setNewFolderName('');
  };

  const renameFolder = async (side: Side) => {
    const oldPath = getCat(side);
    const newName = renameName.trim().replace(/[<>:"/\\|?*]/g, '_');
    if (!newName || !oldPath) { setRenameSide(null); return; }
    try {
      const r = await fetch('/api/categories/rename', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath, newName }),
      });
      const d = await r.json();
      if (!r.ok || d.error) { alert(d.error || 'Rename failed'); return; }
      // Optimistically update signal so dropdown updates
      const parentParts = oldPath.split('/');
      parentParts[parentParts.length - 1] = newName;
      const newPath = parentParts.join('/');
      allVideos.value = allVids.map(v => {
        if ((v.catPath || '').startsWith(oldPath)) {
          return { ...v, catPath: v.catPath?.replace(oldPath, newPath), category: v.category?.replace(oldPath.split('/').pop()!, newName) };
        }
        return v;
      });
      pickCat(side, newPath);
      if ((window as any).loadVideos) (window as any).loadVideos();
    } catch (e: any) { alert(e.message); }
    setRenameSide(null);
  };

  const deleteFolder = async (side: Side) => {
    const cat = getCat(side);
    if (!cat) return;
    const catDisplay = allCats.find(c => c.path === cat)?.name || cat;
    if (!confirm(`Delete folder "${catDisplay}"? All its videos will be moved to the default folder.`)) return;
    try {
      const r = await fetch('/api/categories/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: cat }),
      });
      const d = await r.json();
      if (!r.ok || d.error) { alert(d.error || 'Delete failed'); return; }
      pickCat(side, '');
      if ((window as any).loadVideos) (window as any).loadVideos();
    } catch (e: any) { alert(e.message); }
  };

  // ── Panel renderer ────────────────────────────────────────────────────

  const renderPanel = (side: Side) => {
    const cat       = getCat(side);
    const sel       = getSel(side);
    const search    = getSearch(side);
    const source    = getSource(side);
    const searching = inSearch(side);
    const vids      = panelVideos(side);
    const isOver    = dropOver === side;
    const ctr       = side === 'left' ? dragCtrL : dragCtrR;

    const srcBtn = (label: string, val: Source) => (
      <button
        type="button"
        onClick={() => { setSource(side, val); setSel(side, new Set()); }}
        style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '4px', cursor: 'pointer', border: '1px solid var(--brd)', background: source === val ? 'var(--ac)' : 'var(--bg2)', color: source === val ? '#fff' : 'var(--tx3)', fontWeight: source === val ? 700 : 400 }}
      >{label}</button>
    );

    return (
      <div
        style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', borderLeft: side === 'right' ? '1px solid var(--brd)' : 'none', position: 'relative' }}
        onDragEnter={(e: any) => { e.preventDefault(); if (!canDrop(side)) return; ctr.current++; setDropOver(side); }}
        onDragOver={(e: any) => { e.preventDefault(); e.dataTransfer.dropEffect = canDrop(side) ? 'move' : 'none'; }}
        onDragLeave={() => { ctr.current--; if (ctr.current <= 0) { ctr.current = 0; setDropOver(null); } }}
        onDrop={(e: any) => { e.preventDefault(); onDrop(side); }}
      >

        {/* ── Folder header ── */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--brd)', background: 'var(--bg2)', flexShrink: 0, display: 'flex', gap: '6px', alignItems: 'center' }}>
          {searching ? (
            <span style={{ flex: 1, fontSize: '12px', color: 'var(--tx3)', fontStyle: 'italic' }}>Search results</span>
          ) : renameSide === side ? (
            <>
              <input
                autoFocus
                type="text"
                value={renameName}
                aria-label="New folder name"
                onInput={(e: any) => setRenameName(e.target.value)}
                onKeyDown={(e: any) => { if (e.key === 'Enter') renameFolder(side); if (e.key === 'Escape') setRenameSide(null); }}
                style={{ flex: 1, background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--ac)', borderRadius: '5px', padding: '4px 8px', fontSize: '13px' }}
              />
              <button type="button" onClick={() => renameFolder(side)} style={{ padding: '3px 10px', background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>OK</button>
              <button type="button" onClick={() => setRenameSide(null)} style={{ padding: '3px 7px', background: 'none', border: '1px solid var(--brd)', color: 'var(--tx3)', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
            </>
          ) : (
            <>
              <select
                value={cat}
                title="Select folder"
                onChange={(e: any) => pickCat(side, e.target.value)}
                style={{ flex: 1, background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '4px 7px', fontSize: '13px' }}
              >
                <option value="">— Uncategorized —</option>
                {allCats.map(c => <option key={c.path} value={c.path}>{c.name}</option>)}
              </select>
              {cat && (
                <>
                  <button type="button" title="Rename folder" onClick={() => { setRenameSide(side); setRenameName(cat.split('/').pop()!); }}
                    style={{ padding: '3px 6px', background: 'none', border: '1px solid var(--brd)', color: 'var(--tx3)', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', flexShrink: 0 }}>
                    ✎
                  </button>
                  <button type="button" title="Delete folder" onClick={() => deleteFolder(side)}
                    style={{ padding: '3px 6px', background: 'none', border: '1px solid var(--brd)', color: '#c44', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', flexShrink: 0 }}>
                    🗑
                  </button>
                </>
              )}
              <button type="button" onClick={() => { setNewFolderSide(side); setNewFolderName(''); }}
                style={{ fontSize: '11px', padding: '3px 8px', background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '4px', cursor: 'pointer', color: 'var(--tx2)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                + Folder
              </button>
            </>
          )}
          <span style={{ fontSize: '11px', color: 'var(--tx3)', flexShrink: 0 }}>{vids.length}</span>
        </div>

        {/* ── New folder input ── */}
        {newFolderSide === side && (
          <div style={{ padding: '7px 12px', borderBottom: '1px solid var(--brd)', display: 'flex', gap: '6px', background: 'var(--bg3)', flexShrink: 0 }}>
            <input
              autoFocus type="text" value={newFolderName} placeholder="Folder name…" aria-label="New folder name"
              onInput={(e: any) => setNewFolderName(e.target.value)}
              onKeyDown={(e: any) => { if (e.key === 'Enter') createFolder(); if (e.key === 'Escape') setNewFolderSide(null); }}
              style={{ flex: 1, background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '5px', padding: '4px 8px', fontSize: '13px' }}
            />
            <button type="button" onClick={createFolder} style={{ padding: '3px 10px', background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>Create</button>
            <button type="button" onClick={() => setNewFolderSide(null)} style={{ padding: '3px 6px', background: 'none', border: '1px solid var(--brd)', color: 'var(--tx3)', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
          </div>
        )}

        {/* ── Toolbar: search + source filter + selection ── */}
        <div style={{ padding: '5px 12px', borderBottom: '1px solid var(--brd)', background: 'var(--bg3)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--tx3)', flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="text" value={search} placeholder="Search…" aria-label="Search videos"
            onInput={(e: any) => { setSearch(side, e.target.value); setSel(side, new Set()); lastClick(side).current = -1; }}
            style={{ flex: 1, background: 'transparent', color: 'var(--tx)', border: 'none', outline: 'none', fontSize: '12px', minWidth: 0 }}
          />
          {searching && (
            <button type="button" onClick={() => { setSearch(side, ''); setSel(side, new Set()); }}
              style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', fontSize: '12px', lineHeight: 1, flexShrink: 0 }}>✕</button>
          )}
          <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
            {srcBtn('Both', 'both')}
            {srcBtn('Local', 'local')}
            {srcBtn('Links', 'remote')}
          </div>
        </div>

        {/* ── Selection bar ── */}
        <div style={{ padding: '4px 12px', borderBottom: '1px solid var(--brd)', display: 'flex', gap: '5px', alignItems: 'center', background: 'var(--bg3)', flexShrink: 0, minHeight: '28px' }}>
          <button type="button" onClick={() => setSel(side, new Set(vids.map(v => v.id)))}
            style={{ fontSize: '10px', padding: '2px 7px', background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '4px', cursor: 'pointer', color: 'var(--tx2)' }}>All</button>
          <button type="button" onClick={() => setSel(side, new Set())}
            style={{ fontSize: '10px', padding: '2px 7px', background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '4px', cursor: 'pointer', color: 'var(--tx2)' }}>None</button>
          {sel.size > 0 && (
            <span style={{ fontSize: '11px', color: 'var(--ac)', fontWeight: 600, marginLeft: '2px' }}>
              {sel.size} selected{searching ? ' — drag to folder →' : ''} · shift+click to range
            </span>
          )}
        </div>

        {/* ── Grid ── */}
        <div style={{
          flex: 1, overflow: 'auto', padding: '10px',
          background: isOver ? 'rgba(232,64,64,0.07)' : undefined,
          outline: isOver ? '3px dashed var(--ac)' : '3px solid transparent',
          outlineOffset: '-3px', transition: 'background 0.1s, outline 0.1s',
        }}>
          {vids.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '120px', color: 'var(--tx3)', fontSize: '13px', flexDirection: 'column', gap: '8px', opacity: 0.55 }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.5 }}>
                {isOver
                  ? <path d="M12 3v13m-5-5 5 5 5-5M5 21h14" />
                  : <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                }
              </svg>
              <span>
                {isOver ? 'Drop here' : searching ? 'No matches' : cat ? 'Empty folder' : 'Select a folder above'}
              </span>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px' }}>
              {vids.map((v, idx) => {
                const isSelected = sel.has(v.id);
                const thumb = thumbSrc(v);
                return (
                  <div
                    key={v.id}
                    draggable
                    onDragStart={(e: any) => onDragStart(e, side, v.id)}
                    onClick={(e: any) => handleCardClick(e, side, idx, v.id, vids)}
                    title={v.name}
                    style={{
                      position: 'relative', borderRadius: '6px', overflow: 'hidden',
                      cursor: 'grab', userSelect: 'none',
                      border: `2px solid ${isSelected ? 'var(--ac)' : 'var(--brd)'}`,
                      background: 'var(--bg3)',
                      opacity: moving && isSelected ? 0.35 : 1,
                      transition: 'border-color 0.1s, opacity 0.15s',
                      boxShadow: isSelected ? '0 0 0 1px var(--acg)' : 'none',
                    }}
                  >
                    <div style={{ aspectRatio: '16/9', background: 'var(--bg4)', overflow: 'hidden', position: 'relative' }}>
                      {thumb ? (
                        <img
                          src={thumb}
                          alt=""
                          loading="lazy"
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }}
                          onError={(e: any) => { e.target.style.display = 'none'; }}
                        />
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.3 }}>
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <rect x="2" y="3" width="20" height="14" rx="2"/><path d="m10 8 5 3-5 3V8z"/>
                          </svg>
                        </div>
                      )}
                      {v.isLink && (
                        <div style={{ position: 'absolute', top: '3px', left: '3px', background: 'rgba(0,0,0,0.65)', borderRadius: '3px', padding: '1px 4px', fontSize: '9px', color: 'var(--tx3)' }}>
                          link
                        </div>
                      )}
                      {(searching || source === 'both') && (
                        <div style={{ position: 'absolute', bottom: '2px', left: '3px', fontSize: '9px', background: 'rgba(0,0,0,0.65)', color: 'var(--tx3)', borderRadius: '3px', padding: '1px 4px', maxWidth: 'calc(100% - 6px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {v.category || 'Uncategorized'}
                        </div>
                      )}
                    </div>
                    <div style={{ padding: '4px 5px 5px', fontSize: '11px', color: isSelected ? 'var(--tx)' : 'var(--tx2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                      {v.name.replace(/\.[^.]+$/, '')}
                    </div>
                    {isSelected && (
                      <div style={{ position: 'absolute', top: '3px', right: '3px', width: '16px', height: '16px', background: 'var(--ac)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }}>
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {moving && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 5 }}>
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', padding: '10px 22px', borderRadius: '8px', fontSize: '13px', fontWeight: 600 }}>Moving…</div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: 'var(--bg)' }}>
      {renderPanel('left')}
      {renderPanel('right')}
    </div>
  );
};
