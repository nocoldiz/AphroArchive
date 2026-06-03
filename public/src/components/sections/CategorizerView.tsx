import { useState, useRef } from 'preact/hooks';
import { allVideos, categories } from '../../store';
import { Video } from '../../types';

type Side = 'left' | 'right';

function panelVideos(catPath: string): Video[] {
  return allVideos.value.filter(v => !v.isLink && (v.catPath || '') === catPath);
}

export const CategorizerView = () => {
  const cats = categories.value.filter(c => c.path !== 'uncategorized');

  const [catL, setCatL] = useState('');
  const [catR, setCatR] = useState('');
  const [selL, setSelL] = useState<Set<string>>(new Set());
  const [selR, setSelR] = useState<Set<string>>(new Set());
  const [dropOver, setDropOver] = useState<Side | null>(null);
  const [moving, setMoving] = useState(false);
  const [newFolderSide, setNewFolderSide] = useState<Side | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [extraCats, setExtraCats] = useState<{ name: string; path: string }[]>([]);
  const dragRef = useRef<{ ids: string[]; from: Side }>({ ids: [], from: 'left' });
  const dragCounterL = useRef(0);
  const dragCounterR = useRef(0);

  const allCats = [...cats, ...extraCats.filter(ec => !cats.some(c => c.path === ec.path))];

  const getCat = (s: Side) => s === 'left' ? catL : catR;
  const getSel = (s: Side) => s === 'left' ? selL : selR;
  const setSel = (s: Side, v: Set<string>) => s === 'left' ? setSelL(v) : setSelR(v);

  const pickCat = (s: Side, path: string) => {
    if (s === 'left') { setCatL(path); setSelL(new Set()); }
    else { setCatR(path); setSelR(new Set()); }
  };

  const toggleSel = (s: Side, id: string) => {
    const next = new Set(getSel(s));
    next.has(id) ? next.delete(id) : next.add(id);
    setSel(s, next);
  };

  const onDragStart = (e: DragEvent, side: Side, id: string) => {
    const sel = getSel(side);
    const ids = sel.has(id) && sel.size > 1 ? [...sel] : [id];
    dragRef.current = { ids, from: side };
    e.dataTransfer!.setData('text/plain', 'categorizer');
    e.dataTransfer!.effectAllowed = 'move';

    if (ids.length > 1) {
      const ghost = document.createElement('div');
      ghost.textContent = `${ids.length} videos`;
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

  const onDrop = async (targetSide: Side) => {
    dragCounterL.current = 0;
    dragCounterR.current = 0;
    setDropOver(null);
    const { ids, from } = dragRef.current;
    if (!ids.length || from === targetSide) return;

    const targetCat = getCat(targetSide);
    setMoving(true);

    const results = await Promise.all(
      ids.map(id =>
        fetch(`/api/videos/${encodeURIComponent(id)}/move`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: targetCat }),
        })
          .then(r => r.json())
          .then(d => ({ id, ...d }))
          .catch(() => ({ id, error: 'network error' }))
      )
    );

    const moved = new Map<string, string>(
      results.filter(r => r.ok).map(r => [r.id, r.newId])
    );
    const failed = results.filter(r => !r.ok);

    if (failed.length) {
      const msg = failed.map(r => r.error || 'Failed').slice(0, 3).join(', ');
      alert(`${failed.length} move${failed.length > 1 ? 's' : ''} failed: ${msg}`);
    }

    if (moved.size) {
      const targetCatName = allCats.find(c => c.path === targetCat)?.name || targetCat || 'Uncategorized';
      allVideos.value = allVideos.value.map(v => {
        const newId = moved.get(v.id);
        if (!newId) return v;
        return { ...v, id: newId, catPath: targetCat, category: targetCatName };
      });
      setSel(from, new Set([...getSel(from)].filter(id => !moved.has(id))));
      if ((window as any).loadVideos) (window as any).loadVideos();
    }

    setMoving(false);
  };

  const createFolder = () => {
    const name = newFolderName.trim().replace(/^\/+|\/+$/g, '');
    if (!name || !newFolderSide) return;
    setExtraCats(prev => [...prev.filter(c => c.path !== name), { name, path: name }]);
    pickCat(newFolderSide, name);
    setNewFolderSide(null);
    setNewFolderName('');
  };

  const renderPanel = (side: Side) => {
    const cat = getCat(side);
    const sel = getSel(side);
    const vids = panelVideos(cat);
    const isOver = dropOver === side;
    const counterRef = side === 'left' ? dragCounterL : dragCounterR;

    return (
      <div
        style={{
          flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
          borderLeft: side === 'right' ? '1px solid var(--brd)' : 'none',
          position: 'relative',
        }}
        onDragEnter={(e: any) => { e.preventDefault(); counterRef.current++; setDropOver(side); }}
        onDragOver={(e: any) => { e.preventDefault(); }}
        onDragLeave={() => { counterRef.current--; if (counterRef.current <= 0) { counterRef.current = 0; setDropOver(null); } }}
        onDrop={(e: any) => { e.preventDefault(); onDrop(side); }}
      >
        {/* Header */}
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--brd)', background: 'var(--bg2)', flexShrink: 0, display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select
            value={cat}
            onChange={(e: any) => pickCat(side, e.target.value)}
            style={{ flex: 1, background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '5px 8px', fontSize: '13px', maxWidth: '100%' }}
          >
            <option value="">— Uncategorized —</option>
            {allCats.map(c => (
              <option key={c.path} value={c.path}>{c.name}</option>
            ))}
          </select>
          <span style={{ fontSize: '11px', color: 'var(--tx3)', flexShrink: 0 }}>{vids.length}</span>
          <button
            type="button"
            onClick={() => { setNewFolderSide(side); setNewFolderName(''); }}
            style={{ fontSize: '12px', padding: '4px 10px', background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '5px', cursor: 'pointer', color: 'var(--tx2)', whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            + Folder
          </button>
        </div>

        {/* New folder input */}
        {newFolderSide === side && (
          <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--brd)', display: 'flex', gap: '6px', background: 'var(--bg3)', flexShrink: 0 }}>
            <input
              autoFocus
              type="text"
              value={newFolderName}
              placeholder="Folder name…"
              aria-label="New folder name"
              onInput={(e: any) => setNewFolderName(e.target.value)}
              onKeyDown={(e: any) => { if (e.key === 'Enter') createFolder(); if (e.key === 'Escape') setNewFolderSide(null); }}
              style={{ flex: 1, background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '5px', padding: '5px 8px', fontSize: '13px' }}
            />
            <button type="button" onClick={createFolder} style={{ padding: '4px 12px', background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>Create</button>
            <button type="button" onClick={() => setNewFolderSide(null)} style={{ padding: '4px 8px', background: 'none', border: '1px solid var(--brd)', color: 'var(--tx3)', borderRadius: '5px', cursor: 'pointer', fontSize: '13px' }}>✕</button>
          </div>
        )}

        {/* Selection bar */}
        <div style={{ padding: '5px 14px', borderBottom: '1px solid var(--brd)', display: 'flex', gap: '6px', alignItems: 'center', background: 'var(--bg3)', flexShrink: 0, minHeight: '32px' }}>
          <button
            type="button"
            onClick={() => setSel(side, new Set(vids.map(v => v.id)))}
            style={{ fontSize: '11px', padding: '2px 8px', background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '4px', cursor: 'pointer', color: 'var(--tx2)' }}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setSel(side, new Set())}
            style={{ fontSize: '11px', padding: '2px 8px', background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '4px', cursor: 'pointer', color: 'var(--tx2)' }}
          >
            None
          </button>
          {sel.size > 0 && (
            <span style={{ fontSize: '11px', color: 'var(--ac)', fontWeight: 600, marginLeft: '2px' }}>
              {sel.size} selected — drag →
            </span>
          )}
        </div>

        {/* Grid */}
        <div style={{
          flex: 1, overflow: 'auto', padding: '10px',
          background: isOver ? 'rgba(232,64,64,0.07)' : undefined,
          outline: isOver ? '3px dashed var(--ac)' : '3px solid transparent',
          outlineOffset: '-3px',
          transition: 'background 0.1s, outline 0.1s',
        }}>
          {vids.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '120px', color: 'var(--tx3)', fontSize: '13px', flexDirection: 'column', gap: '8px', opacity: 0.55 }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.5 }}>
                {isOver
                  ? <path d="M12 3v13m-5-5 5 5 5-5M5 21h14" />
                  : <><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></>
                }
              </svg>
              <span>{isOver ? 'Drop videos here' : (cat ? 'No videos in this folder' : 'Select a folder above')}</span>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px' }}>
              {vids.map(v => {
                const isSelected = sel.has(v.id);
                return (
                  <div
                    key={v.id}
                    draggable
                    onDragStart={(e: any) => onDragStart(e, side, v.id)}
                    onClick={() => toggleSel(side, v.id)}
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
                    <div style={{ aspectRatio: '16/9', background: 'var(--bg4)', overflow: 'hidden' }}>
                      <img
                        src={`/api/thumbs/${v.id}/0`}
                        alt=""
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }}
                        onError={(e: any) => { e.target.style.visibility = 'hidden'; }}
                      />
                    </div>
                    <div style={{ padding: '4px 6px 5px', fontSize: '11px', color: isSelected ? 'var(--tx)' : 'var(--tx2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }} title={v.name}>
                      {v.name.replace(/\.[^.]+$/, '')}
                    </div>
                    {isSelected && (
                      <div style={{ position: 'absolute', top: '4px', right: '4px', width: '16px', height: '16px', background: 'var(--ac)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }}>
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

        {/* Moving overlay per panel */}
        {moving && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 5, borderRadius: 'inherit' }}>
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', padding: '10px 22px', borderRadius: '8px', fontSize: '13px', color: 'var(--tx)', fontWeight: 600 }}>Moving…</div>
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
