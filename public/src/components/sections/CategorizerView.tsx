import { useState, useRef, useEffect } from 'preact/hooks';
import { allVideos, folders, loadFolders, loadVideos } from '../../store';
import { Video } from '../../types';

type Side = 'left' | 'right';

// ── helpers ──────────────────────────────────────────────────────────────

function thumbSrc(v: Video): string {
  return `/api/thumbs/${v.id}/0`;
}

// ── Relevance scoring: rank candidates by how well they match a query ──
// Returns 0 when there's no match. All query tokens must be found; exact
// word / prefix / start-of-name matches score higher than loose substrings.
function matchScore(target: string, query: string): number {
  const t = target.toLowerCase();
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  let score = 0;
  for (const tok of tokens) {
    const idx = t.indexOf(tok);
    if (idx === -1) return 0;            // every token must appear
    score += 10;
    if (idx === 0) score += 8;           // matches at the very start
    // word-boundary match (preceded by a non-alphanumeric char)
    else if (!/[a-z0-9]/.test(t[idx - 1])) score += 4;
    if (t.length - tok.length < 3) score += 6; // near-exact length
  }
  return score;
}

// ── Fuzzy folder matching ─────────────────────────────────────────────────
// Levenshtein edit distance (single-row) — powers fuzzy term matching so a
// folder named "Comedy" still catches "comdey" / "comedi" in a filename.
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const row = new Array(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let diag = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diag + cost);
      diag = tmp;
    }
  }
  return row[n];
}

// Lowercase, drop separators/punctuation, collapse whitespace into words.
function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[._\-/\\]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Score a single folder term against a filename's words. 0 = no match.
// Exact word > substring > fuzzy. Multi-word terms match as a phrase.
function termMatchScore(words: string[], joined: string, term: string): number {
  if (!term) return 0;
  if (term.includes(' ')) return joined.includes(term) ? 100 : 0;
  let best = 0;
  for (const w of words) {
    if (w === term) return 100;
    if (term.length >= 3 && w.includes(term)) best = Math.max(best, 78);
    else if (w.length >= 4 && term.includes(w)) best = Math.max(best, 58);
    else if (term.length >= 4 && w.length >= 4) {
      const ratio = 1 - levenshtein(w, term) / Math.max(w.length, term.length);
      if (ratio >= 0.8) best = Math.max(best, Math.round(ratio * 68)); // fuzzy
    }
  }
  return best;
}

type Move = { id: string; name: string; fromPath: string; toPath: string; toName: string; matched: string };

// ── component ─────────────────────────────────────────────────────────────

export const CategorizerView = () => {
  // Signal reads in the component body keep Preact reactive
  const allVids = allVideos.value;
  const cats    = folders.value.filter(c => c.path !== 'uncategorized');

  const [catL, setCatL] = useState('');
  const [catR, setCatR] = useState('');
  const [selL, setSelL] = useState<Set<string>>(new Set());
  const [selR, setSelR] = useState<Set<string>>(new Set());
  const [searchL, setSearchL] = useState('');
  const [searchR, setSearchR] = useState('');
  // Global filter — narrows the videos eligible for categorizing across both
  // panels. Only videos passing it are shown, so only they can be moved.
  const [globalFilter, setGlobalFilter] = useState('');
  const [dropOver, setDropOver] = useState<Side | null>(null);
  const [moving, setMoving] = useState(false);
  const [newFolderSide, setNewFolderSide] = useState<Side | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [renameSide, setRenameSide] = useState<Side | null>(null);
  const [renameName, setRenameName] = useState('');
  const [extraCats, setExtraCats] = useState<{ name: string; path: string; count?: number }[]>([]);
  // Folder → registered tags map (from /api/db/categories), used so a video
  // whose name contains a folder's tag still lands in that folder.
  const [catTags, setCatTags] = useState<Map<string, string[]>>(new Map());
  // Auto-categorize / Recategorize preview + apply state.
  const [plan, setPlan] = useState<null | { mode: 'auto' | 'recat'; moves: Move[] }>(null);
  const [planSel, setPlanSel] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState<null | { done: number; total: number }>(null);

  const dragRef      = useRef<{ ids: string[]; from: Side }>({ ids: [], from: 'left' });
  const dragCtrL     = useRef(0);
  const dragCtrR     = useRef(0);
  const lastClickL   = useRef(-1);
  const lastClickR   = useRef(-1);

  useEffect(() => {
    if (folders.value.length === 0) loadFolders();
    if (allVideos.value.length === 0) loadVideos();
    fetch('/api/db/categories')
      .then(r => r.json())
      .then((d: any) => {
        const m = new Map<string, string[]>();
        for (const [name, info] of Object.entries<any>(d || {})) {
          m.set(name.toLowerCase(), Array.isArray(info?.tags) ? info.tags : []);
        }
        setCatTags(m);
      })
      .catch(() => {});
  }, []);

  const allCats = [...cats, ...extraCats.filter(ec => !cats.some(c => c.path === ec.path))];

  const getCat    = (s: Side) => s === 'left' ? catL : catR;
  const getSel    = (s: Side) => s === 'left' ? selL : selR;
  const setSel    = (s: Side, v: Set<string>) => s === 'left' ? setSelL(v) : setSelR(v);
  const getSearch = (s: Side) => s === 'left' ? searchL : searchR;
  const setSearch = (s: Side, v: string) => s === 'left' ? setSearchL(v) : setSearchR(v);
  const inSearch  = (s: Side) => getSearch(s).trim() !== '';
  const lastClick = (s: Side) => s === 'left' ? lastClickL : lastClickR;

  // The categorizer files videos into folders; links are tag-sorted, not
  // foldered, so they never appear here.
  const localVids = allVids.filter(v => !v.isLink);

  // Apply the global filter (improved relevance match) and drop non-matches.
  const applyGlobal = (vids: Video[]): Video[] => {
    const q = globalFilter.trim();
    if (!q) return vids;
    return vids
      .map(v => ({ v, s: Math.max(matchScore(v.name, q), matchScore(v.category || '', q)) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map(x => x.v);
  };

  // Return the set of video ids currently visible in the opposite panel
  const otherPanelIds = (s: Side): Set<string> => {
    const other: Side = s === 'left' ? 'right' : 'left';
    const otherVids = panelVideosRaw(other);
    return new Set(otherVids.map(v => v.id));
  };

  const panelVideosRaw = (s: Side): Video[] => {
    const q = getSearch(s).trim();
    if (q) {
      // Per-panel search: rank by relevance against name / folder.
      return localVids
        .map(v => ({ v, s: Math.max(matchScore(v.name, q), matchScore(v.catPath || '', q), matchScore(v.category || '', q)) }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .map(x => x.v);
    }
    const cat = getCat(s);
    if (!cat) return [];
    return localVids.filter(v => (v.catPath || '') === cat);
  };

  const panelVideos = (s: Side): Video[] => {
    const filtered = applyGlobal(panelVideosRaw(s));
    // Exclude videos already visible in the other panel so a move never targets
    // a video's current folder.
    if (inSearch(s) || getCat(s)) {
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

    const idSet = new Set(ids);
    const movingVids = localVids.filter(v => idSet.has(v.id));

    const vidResults = await Promise.all(
      movingVids.map(v =>
        fetch(`/api/videos/${encodeURIComponent(v.id)}/move`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: targetCat }),
        }).then(r => r.json()).then(d => ({ id: v.id, ...d })).catch(() => ({ id: v.id, error: 'network' }))
      )
    );

    const movedVidIds = new Map<string, string>(
      vidResults.filter(r => r.ok).map(r => [r.id, r.newId])
    );
    const targetCatName = allCats.find(c => c.path === targetCat)?.name || targetCat || 'Uncategorized';
    const failCount = vidResults.filter(r => !r.ok).length;

    if (failCount) alert(`${failCount} move${failCount > 1 ? 's' : ''} failed`);

    if (movedVidIds.size) {
      allVideos.value = allVids.map(v => {
        const newId = movedVidIds.get(v.id);
        if (newId) return { ...v, id: newId, catPath: targetCat, category: targetCatName };
        return v;
      });
      setSel(from, new Set([...getSel(from)].filter(id => !movedVidIds.has(id))));
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
      const r = await fetch('/api/folders/rename', {
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
      const r = await fetch('/api/folders/delete', {
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

  // ── Auto-categorize ───────────────────────────────────────────────────

  // Precompute the matching terms (folder leaf name + registered tags) for
  // every known folder.
  const folderTerms = (): { path: string; depth: number; terms: string[] }[] =>
    cats.map(c => {
      const leaf  = c.path.split('/').pop() || c.path;
      const tags  = catTags.get(leaf.toLowerCase()) || catTags.get(c.path.toLowerCase()) || [];
      const terms = [normalizeText(leaf), ...tags.map(normalizeText)].filter(Boolean);
      return { path: c.path, depth: c.path.split('/').length, terms };
    });

  // Find the best-fitting folder for a filename. Deeper (more specific)
  // subfolders win on near-ties; only when no subfolder matches does a
  // shallower parent folder get picked.
  const bestFolder = (fts: ReturnType<typeof folderTerms>, name: string): { path: string; matched: string } | null => {
    const joined = normalizeText(name.replace(/\.[^.]+$/, ''));
    const words  = joined.split(' ').filter(Boolean);
    if (!words.length) return null;
    let bestPath = '', bestTotal = 0, bestTerm = '';
    for (const f of fts) {
      let fScore = 0, fTerm = '';
      for (const term of f.terms) {
        const s = termMatchScore(words, joined, term);
        if (s > fScore) { fScore = s; fTerm = term; }
      }
      if (!fScore) continue;
      const total = fScore + f.depth * 4; // depth bias → prefer subfolders
      if (total > bestTotal) { bestTotal = total; bestPath = f.path; bestTerm = fTerm; }
    }
    return bestPath ? { path: bestPath, matched: bestTerm } : null;
  };

  // mode 'auto' → only uncategorized videos; 'recat' → re-sort everything.
  const openPlan = (mode: 'auto' | 'recat') => {
    const fts        = folderTerms();
    const candidates = localVids.filter(v => mode === 'auto' ? !(v.catPath || '') : true);
    const moves: Move[] = [];
    for (const v of candidates) {
      const hit = bestFolder(fts, v.name);
      if (hit && hit.path !== (v.catPath || '')) {
        moves.push({
          id: v.id, name: v.name,
          fromPath: v.catPath || '',
          toPath: hit.path,
          toName: cats.find(c => c.path === hit.path)?.name || hit.path,
          matched: hit.matched,
        });
      }
    }
    setPlan({ mode, moves });
    setPlanSel(new Set(moves.map(m => m.id)));
  };

  const applyPlan = async () => {
    if (!plan) return;
    const moves = plan.moves.filter(m => planSel.has(m.id));
    if (!moves.length) { setPlan(null); return; }
    setApplying({ done: 0, total: moves.length });
    const updates = new Map<string, { newId: string; toPath: string; toName: string }>();
    const queue = [...moves];
    let done = 0;
    const worker = async () => {
      while (queue.length) {
        const m = queue.shift()!;
        try {
          const r = await fetch(`/api/videos/${encodeURIComponent(m.id)}/move`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category: m.toPath }),
          });
          const d = await r.json();
          if (r.ok && d.ok) updates.set(m.id, { newId: d.newId, toPath: m.toPath, toName: m.toName });
        } catch { /* counted as failure below */ }
        done++; setApplying({ done, total: moves.length });
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    if (updates.size) {
      allVideos.value = allVideos.value.map(v => {
        const u = updates.get(v.id);
        return u ? { ...v, id: u.newId, catPath: u.toPath, category: u.toName } : v;
      });
      if ((window as any).loadVideos) (window as any).loadVideos();
    }
    const failed = moves.length - updates.size;
    setApplying(null);
    setPlan(null);
    if (failed) alert(`${failed} move${failed > 1 ? 's' : ''} failed`);
  };

  const toggleMove = (id: string) =>
    setPlanSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ── Folder dropdown options (hierarchical, optionally non-empty only) ──
  const folderOptions = (side: Side) => {
    const onlyNonEmpty = side === 'left'; // source panel hides empty folders
    const selected = getCat(side);
    return allCats
      .filter(c => !onlyNonEmpty || (c.count || 0) > 0 || c.path === selected)
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path))
      .map(c => {
        const depth  = c.path.split('/').length - 1;
        const leaf   = c.path.split('/').pop() || c.path;
        const indent = '   '.repeat(depth);
        const cnt    = c.count ? ` (${c.count})` : '';
        return <option key={c.path} value={c.path}>{indent}{depth ? '└ ' : ''}{leaf}{cnt}</option>;
      });
  };

  // Immediate subfolders of a path — powers the target panel's file-system
  // navigation. Each child reports its own count and whether it nests further.
  const childFolders = (parentPath: string) => {
    const prefix = parentPath ? parentPath + '/' : '';
    const seen = new Set<string>();
    const out: { name: string; path: string; count: number; hasChildren: boolean }[] = [];
    for (const c of allCats) {
      if (parentPath && !c.path.startsWith(prefix)) continue;
      const rest = parentPath ? c.path.slice(prefix.length) : c.path;
      if (!rest) continue;
      const seg = rest.split('/')[0];
      const childPath = prefix + seg;
      if (seen.has(childPath)) continue;
      seen.add(childPath);
      out.push({
        name: seg,
        path: childPath,
        count: (allCats.find(o => o.path === childPath) as any)?.count || 0,
        hasChildren: allCats.some(o => o.path.startsWith(childPath + '/')),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  };

  // ── Panel renderer ────────────────────────────────────────────────────

  const renderPanel = (side: Side) => {
    const cat       = getCat(side);
    const sel       = getSel(side);
    const search    = getSearch(side);
    const searching = inSearch(side);
    const vids      = panelVideos(side);
    const isOver    = dropOver === side;
    const ctr       = side === 'left' ? dragCtrL : dragCtrR;

    return (
      <div
        style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', borderLeft: side === 'right' ? '1px solid var(--brd)' : 'none', position: 'relative' }}
        onDragEnter={(e: any) => { e.preventDefault(); if (!canDrop(side)) return; ctr.current++; setDropOver(side); }}
        onDragOver={(e: any) => { e.preventDefault(); e.dataTransfer.dropEffect = canDrop(side) ? 'move' : 'none'; }}
        onDragLeave={() => { ctr.current--; if (ctr.current <= 0) { ctr.current = 0; setDropOver(null); } }}
        onDrop={(e: any) => { e.preventDefault(); onDrop(side); }}
      >

        {/* ── Panel label ── */}
        <div style={{ padding: '4px 12px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: side === 'left' ? 'var(--tx2)' : 'var(--ac)', background: 'var(--bg)', borderBottom: '1px solid var(--brd)', flexShrink: 0 }}>
          {side === 'left' ? 'Source folder' : 'Target folder'}
        </div>

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
              {side === 'right' ? (
                /* Target panel: file-system breadcrumb navigation */
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '2px', flexWrap: 'wrap', minWidth: 0, fontSize: '12px' }}>
                  <button type="button" onClick={() => pickCat('right', '')} title="Library root"
                    style={{ background: cat ? 'none' : 'var(--bg3)', border: 'none', color: cat ? 'var(--ac)' : 'var(--tx)', cursor: 'pointer', padding: '2px 5px', borderRadius: '4px', fontSize: '12px', fontWeight: cat ? 400 : 600 }}>
                    🏠 Root
                  </button>
                  {cat && cat.split('/').map((seg, i, arr) => {
                    const p = arr.slice(0, i + 1).join('/');
                    const last = i === arr.length - 1;
                    return (
                      <span key={p} style={{ display: 'inline-flex', alignItems: 'center', minWidth: 0 }}>
                        <span style={{ color: 'var(--tx3)', flexShrink: 0 }}>/</span>
                        <button type="button" onClick={() => pickCat('right', p)} title={p}
                          style={{ background: last ? 'var(--bg3)' : 'none', border: 'none', color: last ? 'var(--tx)' : 'var(--ac)', cursor: 'pointer', padding: '2px 5px', borderRadius: '4px', fontSize: '12px', fontWeight: last ? 600 : 400, maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {seg}
                        </button>
                      </span>
                    );
                  })}
                </div>
              ) : (
                <select
                  value={cat}
                  title="Select folder"
                  onChange={(e: any) => pickCat(side, e.target.value)}
                  style={{ flex: 1, background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '4px 7px', fontSize: '13px' }}
                >
                  <option value="">— Uncategorized —</option>
                  {folderOptions(side)}
                </select>
              )}
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

        {/* ── Subfolder navigation (target panel only) ── */}
        {side === 'right' && !searching && renameSide !== side && (() => {
          const kids = childFolders(cat);
          if (kids.length === 0) return null;
          return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '7px 12px', borderBottom: '1px solid var(--brd)', background: 'var(--bg3)', flexShrink: 0, maxHeight: '92px', overflowY: 'auto' }}>
              {cat && (
                <button type="button" onClick={() => pickCat('right', cat.split('/').slice(0, -1).join('/'))} title="Up one level"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'var(--bg2)', border: '1px solid var(--brd)', color: 'var(--tx3)', cursor: 'pointer', padding: '3px 8px', borderRadius: '5px', fontSize: '11px', flexShrink: 0 }}>
                  ↑ ..
                </button>
              )}
              {kids.map(k => (
                <button key={k.path} type="button" onClick={() => pickCat('right', k.path)} title={k.path}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: 'var(--bg2)', border: '1px solid var(--brd)', color: 'var(--tx)', cursor: 'pointer', padding: '3px 8px', borderRadius: '5px', fontSize: '11px', maxWidth: '100%' }}>
                  <span style={{ flexShrink: 0 }}>📁</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.name}</span>
                  {k.count > 0 && <span style={{ color: 'var(--tx3)', flexShrink: 0 }}>{k.count}</span>}
                  {k.hasChildren && <span style={{ color: 'var(--tx3)', flexShrink: 0 }}>›</span>}
                </button>
              ))}
            </div>
          );
        })()}

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

        {/* ── Toolbar: per-panel search ── */}
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
                      {(searching || !!globalFilter.trim()) && (
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg)' }}>
      {/* ── Global filter bar: narrows the videos eligible across both panels ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderBottom: '1px solid var(--brd)', background: 'var(--bg2)', flexShrink: 0 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--tx3)', flexShrink: 0 }}>
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
        <input
          type="text" value={globalFilter} placeholder="Filter videos to categorize…" aria-label="Filter videos"
          onInput={(e: any) => { setGlobalFilter(e.target.value); setSelL(new Set()); setSelR(new Set()); }}
          style={{ flex: 1, background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '5px 10px', fontSize: '13px', outline: 'none', minWidth: 0 }}
        />
        {globalFilter.trim() && (
          <button type="button" onClick={() => setGlobalFilter('')}
            style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx3)', cursor: 'pointer', fontSize: '12px', borderRadius: '4px', padding: '3px 8px', flexShrink: 0 }}>Clear</button>
        )}
        {globalFilter.trim() && (
          <span style={{ fontSize: '11px', color: 'var(--tx3)', flexShrink: 0 }}>Only matching videos are categorized</span>
        )}
        <button type="button" onClick={() => openPlan('auto')} title="Move uncategorized videos into matching folders automatically"
          style={{ background: 'var(--ac)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: 600, borderRadius: '5px', padding: '5px 11px', flexShrink: 0, whiteSpace: 'nowrap' }}>
          ✨ Auto-categorize
        </button>
        <button type="button" onClick={() => openPlan('recat')} title="Re-sort every video into the best-matching folder"
          style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx2)', cursor: 'pointer', fontSize: '12px', fontWeight: 600, borderRadius: '5px', padding: '5px 11px', flexShrink: 0, whiteSpace: 'nowrap' }}>
          ⟳ Recategorize all
        </button>
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {renderPanel('left')}
        {renderPanel('right')}
      </div>

      {/* ── Auto-categorize preview modal ── */}
      {plan && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => !applying && setPlan(null)}>
          <div onClick={(e: any) => e.stopPropagation()}
            style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '10px', width: 'min(680px, 92vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}>
            {/* header */}
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--brd)', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--tx)' }}>
                {plan.mode === 'auto' ? 'Auto-categorize uncategorized videos' : 'Recategorize all videos'}
              </span>
              <span style={{ fontSize: '12px', color: 'var(--tx3)', marginLeft: 'auto' }}>
                {planSel.size} of {plan.moves.length} selected
              </span>
            </div>

            {/* body */}
            <div style={{ flex: 1, overflow: 'auto', padding: plan.moves.length ? '8px 0' : '40px 18px' }}>
              {plan.moves.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--tx3)', fontSize: '13px' }}>
                  No videos matched a folder name or tag.
                </div>
              ) : (
                Object.entries(plan.moves.reduce((acc, m) => {
                  (acc[m.toPath] ||= []).push(m); return acc;
                }, {} as Record<string, Move[]>)).map(([toPath, ms]) => (
                  <div key={toPath} style={{ marginBottom: '6px' }}>
                    <div style={{ padding: '6px 18px', fontSize: '11px', fontWeight: 700, color: 'var(--ac)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span>→ {cats.find(c => c.path === toPath)?.name || toPath}</span>
                      <span style={{ color: 'var(--tx3)', fontWeight: 400 }}>{ms.length}</span>
                    </div>
                    {ms.map(m => {
                      const sel = planSel.has(m.id);
                      return (
                        <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 18px', cursor: 'pointer', opacity: sel ? 1 : 0.45 }}>
                          <input type="checkbox" checked={sel} onChange={() => toggleMove(m.id)} disabled={!!applying} />
                          <span style={{ flex: 1, fontSize: '12px', color: 'var(--tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: '80px' }} title={m.name}>
                            {m.name.replace(/\.[^.]+$/, '')}
                          </span>
                          <span style={{ fontSize: '10px', color: 'var(--tx3)', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: '5px' }} title={`matched “${m.matched}”`}>
                            <span style={{ padding: '1px 5px', background: 'var(--bg3)', borderRadius: '3px' }}>
                              {m.fromPath ? (cats.find(c => c.path === m.fromPath)?.name || m.fromPath) : 'Uncategorized'}
                            </span>
                            <span style={{ color: 'var(--ac)', fontWeight: 700 }}>→</span>
                            <span style={{ padding: '1px 5px', background: 'var(--bg3)', borderRadius: '3px', color: 'var(--tx2)' }}>
                              {m.toName}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            {/* footer */}
            <div style={{ padding: '12px 18px', borderTop: '1px solid var(--brd)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              {applying ? (
                <span style={{ fontSize: '12px', color: 'var(--tx2)' }}>Moving… {applying.done} / {applying.total}</span>
              ) : (
                <>
                  <button type="button" onClick={() => setPlanSel(new Set(plan.moves.map(m => m.id)))}
                    style={{ fontSize: '11px', padding: '4px 9px', background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '4px', cursor: 'pointer', color: 'var(--tx2)' }}>All</button>
                  <button type="button" onClick={() => setPlanSel(new Set())}
                    style={{ fontSize: '11px', padding: '4px 9px', background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '4px', cursor: 'pointer', color: 'var(--tx2)' }}>None</button>
                </>
              )}
              <div style={{ flex: 1 }} />
              <button type="button" disabled={!!applying} onClick={() => setPlan(null)}
                style={{ fontSize: '12px', padding: '6px 14px', background: 'none', border: '1px solid var(--brd)', borderRadius: '5px', cursor: applying ? 'default' : 'pointer', color: 'var(--tx2)' }}>Cancel</button>
              <button type="button" disabled={!!applying || planSel.size === 0} onClick={applyPlan}
                style={{ fontSize: '12px', fontWeight: 600, padding: '6px 16px', background: planSel.size && !applying ? 'var(--ac)' : 'var(--bg3)', border: 'none', borderRadius: '5px', cursor: planSel.size && !applying ? 'pointer' : 'default', color: planSel.size && !applying ? '#fff' : 'var(--tx3)' }}>
                Move {planSel.size || ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
