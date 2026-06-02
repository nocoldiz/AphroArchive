import { useState, useMemo } from 'preact/hooks';

export interface PlanItem {
  type: 'video' | 'link';
  id: string;
  name: string;
  url?: string;
  currentFolder: string;
  suggestedCategory?: string;
  matchedCategory?: string;
  score: number;
  srcPath?: string;
  root?: string;
}

export interface Move {
  type: 'video' | 'link';
  srcPath?: string;
  destFolder?: string;
  root?: string;
  url?: string;
  newCategory?: string;
}

interface Props {
  mode: 'uncategorized' | 'all';
  uncategorized: PlanItem[];
  categorized: PlanItem[];
  categories: string[];
  onConfirm: (moves: Move[]) => void;
  onCancel: () => void;
  confirming?: boolean;
}

const SKIP = '__skip__';

function ScorePill({ score }: { score: number }) {
  const bg = score >= 80 ? '#1a7a3a' : score >= 40 ? '#7a5e00' : '#7a1a1a';
  const color = '#fff';
  return (
    <span style={{
      display: 'inline-block', padding: '1px 5px',
      background: bg, color, borderRadius: '3px',
      fontSize: '0.68rem', fontWeight: 600, flexShrink: 0,
    }}>
      {score}%
    </span>
  );
}

function TypeIcon({ type }: { type: 'video' | 'link' }) {
  if (type === 'link') return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, color: 'var(--tx3)' }}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>
  );
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, color: 'var(--tx3)' }}>
      <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
    </svg>
  );
}

const thStyle: preact.JSX.CSSProperties = {
  padding: '6px 8px', textAlign: 'left', fontWeight: 600,
  fontSize: '0.72rem', color: 'var(--tx2)',
  borderBottom: '1px solid var(--brd)',
  background: 'var(--bg3)', position: 'sticky', top: 0, whiteSpace: 'nowrap',
};

export function CategorizeModal({ mode, uncategorized, categorized, categories, onConfirm, onCancel, confirming }: Props) {
  const [edits, setEdits] = useState<Record<string, string>>(
    () => Object.fromEntries(uncategorized.map(i => [i.id, i.suggestedCategory || SKIP]))
  );
  const [search, setSearch] = useState('');

  const q = search.trim().toLowerCase();

  const filteredUncat = useMemo(() =>
    q ? uncategorized.filter(i => i.name.toLowerCase().includes(q) || (i.url || '').toLowerCase().includes(q))
      : uncategorized,
    [uncategorized, q]
  );

  const filteredCat = useMemo(() =>
    q ? categorized.filter(i => i.name.toLowerCase().includes(q) || (i.url || '').toLowerCase().includes(q))
      : categorized,
    [categorized, q]
  );

  const toMove = uncategorized.filter(i => edits[i.id] && edits[i.id] !== SKIP);

  const handleConfirm = () => {
    const moves: Move[] = toMove.map(i => {
      if (i.type === 'video') return { type: 'video', srcPath: i.srcPath, destFolder: edits[i.id], root: i.root };
      return { type: 'link', url: i.url, newCategory: edits[i.id] };
    });
    onConfirm(moves);
  };

  const title = mode === 'all' ? 'Recategorize All' : 'Auto Categorize';

  const panelHeaderStyle: preact.JSX.CSSProperties = {
    padding: '8px 10px', background: 'var(--bg3)',
    borderBottom: '1px solid var(--brd)',
    fontSize: '0.78rem', fontWeight: 700, flexShrink: 0,
    display: 'flex', alignItems: 'center', gap: '6px',
  };

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.65)',
        zIndex: 10000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--brd)',
        borderRadius: '12px',
        width: '100%', maxWidth: '1100px',
        height: 'calc(100vh - 32px)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
      }}>

        {/* Header */}
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid var(--brd)',
          display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0,
        }}>
          <span style={{ fontWeight: 700, fontSize: '0.9rem', flexShrink: 0 }}>{title}</span>
          <input
            type="text"
            placeholder="Search videos and links…"
            value={search}
            onInput={(e: any) => setSearch(e.target.value)}
            style={{
              flex: 1, background: 'var(--bg3)', border: '1px solid var(--brd)',
              borderRadius: '6px', color: 'var(--tx1)', padding: '4px 10px',
              fontSize: '0.8rem', outline: 'none',
            }}
          />
          <button
            onClick={onCancel}
            style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '6px', padding: '4px 12px', fontSize: '0.8rem', cursor: 'pointer', flexShrink: 0 }}
          >
            Cancel
          </button>
        </div>

        {/* Two panels */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', gap: '1px', background: 'var(--brd)' }}>

          {/* Left — Uncategorized */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg2)', overflow: 'hidden' }}>
            <div style={panelHeaderStyle}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Uncategorized
              <span style={{ fontWeight: 400, color: 'var(--tx3)', marginLeft: 'auto', fontSize: '0.72rem' }}>{filteredUncat.length}</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredUncat.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--tx3)', fontSize: '0.8rem' }}>
                  {q ? 'No matches' : 'Nothing to categorize'}
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                  <thead>
                    <tr>
                      <th style={{ ...thStyle, width: '16px' }}></th>
                      <th style={thStyle}>Name</th>
                      <th style={{ ...thStyle, whiteSpace: 'nowrap' }}>From</th>
                      <th style={{ ...thStyle, width: '40px' }}>Score</th>
                      <th style={thStyle}>Move to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUncat.map((item, i) => {
                      const skip = edits[item.id] === SKIP;
                      return (
                        <tr key={item.id} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--bg3)', opacity: skip ? 0.4 : 1 }}>
                          <td style={{ padding: '5px 6px 5px 8px' }}><TypeIcon type={item.type} /></td>
                          <td style={{ padding: '5px 8px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.url || item.name}>
                            {item.name}
                          </td>
                          <td style={{ padding: '5px 8px', color: 'var(--tx3)', whiteSpace: 'nowrap', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {item.currentFolder || <em>root</em>}
                          </td>
                          <td style={{ padding: '5px 4px' }}>
                            {item.score > 0 ? <ScorePill score={item.score} /> : <span style={{ color: 'var(--tx3)', fontSize: '0.68rem' }}>—</span>}
                          </td>
                          <td style={{ padding: '5px 8px 5px 4px' }}>
                            <select
                              value={edits[item.id] || SKIP}
                              onChange={(e: any) => setEdits(prev => ({ ...prev, [item.id]: e.target.value }))}
                              style={{
                                background: 'var(--bg3)', border: '1px solid var(--brd)',
                                borderRadius: '4px', color: skip ? 'var(--tx3)' : 'var(--tx1)',
                                padding: '2px 4px', fontSize: '0.73rem', cursor: 'pointer', maxWidth: '150px',
                              }}
                            >
                              {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                              <option value={SKIP}>— keep —</option>
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Right — Categorized */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg2)', overflow: 'hidden' }}>
            <div style={panelHeaderStyle}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4caf50" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
              Categorized
              <span style={{ fontWeight: 400, color: 'var(--tx3)', marginLeft: 'auto', fontSize: '0.72rem' }}>{filteredCat.length}</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredCat.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--tx3)', fontSize: '0.8rem' }}>
                  {q ? 'No matches' : 'No categorized items'}
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                  <thead>
                    <tr>
                      <th style={{ ...thStyle, width: '16px' }}></th>
                      <th style={thStyle}>Name</th>
                      <th style={thStyle}>Category</th>
                      <th style={{ ...thStyle, width: '40px' }}>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCat.map((item, i) => (
                      <tr key={item.id} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--bg3)' }}>
                        <td style={{ padding: '5px 6px 5px 8px' }}><TypeIcon type={item.type} /></td>
                        <td style={{ padding: '5px 8px', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.url || item.name}>
                          {item.name}
                        </td>
                        <td style={{ padding: '5px 8px', color: 'var(--tx2)', whiteSpace: 'nowrap' }}>
                          {item.matchedCategory || item.currentFolder}
                        </td>
                        <td style={{ padding: '5px 8px' }}>
                          <ScorePill score={item.score} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 16px', borderTop: '1px solid var(--brd)',
          display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0,
        }}>
          {toMove.length < uncategorized.length && (
            <span style={{ flex: 1, fontSize: '0.73rem', color: 'var(--tx3)' }}>
              {uncategorized.length - toMove.length} kept in place
            </span>
          )}
          {toMove.length > 0 && (
            <span style={{ flex: 1, fontSize: '0.73rem', color: 'var(--tx3)' }}>
              {toMove.filter(i => i.type === 'video').length} videos · {toMove.filter(i => i.type === 'link').length} links
            </span>
          )}
          <button
            disabled={toMove.length === 0 || confirming}
            onClick={handleConfirm}
            style={{
              background: toMove.length === 0 || confirming ? 'var(--bg3)' : 'var(--ac)',
              color: toMove.length === 0 || confirming ? 'var(--tx3)' : '#fff',
              border: 'none', borderRadius: '6px',
              padding: '6px 18px', fontSize: '0.8rem',
              cursor: toMove.length === 0 || confirming ? 'default' : 'pointer',
              fontWeight: 600,
            }}
          >
            {confirming ? 'Moving…' : `Move ${toMove.length} item${toMove.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
