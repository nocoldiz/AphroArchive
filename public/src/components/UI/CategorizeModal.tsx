import { useState } from 'preact/hooks';

export interface ChangeItem {
  srcPath: string;
  name: string;
  currentFolder: string;
  destFolder: string;
  root: string;
}

interface Props {
  mode: 'uncategorized' | 'all';
  changes: ChangeItem[];
  categories: string[];
  onConfirm: (moves: { srcPath: string; destFolder: string; root: string }[]) => void;
  onCancel: () => void;
  confirming?: boolean;
}

const SKIP = '__skip__';

export function CategorizeModal({ mode, changes, categories, onConfirm, onCancel, confirming }: Props) {
  const [edits, setEdits] = useState<Record<string, string>>(
    () => Object.fromEntries(changes.map(c => [c.srcPath, c.destFolder]))
  );

  const toMove = changes.filter(c => edits[c.srcPath] !== SKIP);

  const setEdit = (srcPath: string, val: string) =>
    setEdits(prev => ({ ...prev, [srcPath]: val }));

  const title = mode === 'all' ? 'Recategorize All' : 'Auto Categorize';

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
        background: 'var(--bg2)',
        border: '1px solid var(--brd)',
        borderRadius: '12px',
        width: '100%', maxWidth: '720px',
        maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
      }}>

        {/* Header */}
        <div style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--brd)',
          display: 'flex', alignItems: 'baseline', gap: '10px',
        }}>
          <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{title}</span>
          {changes.length > 0 && (
            <span style={{ fontSize: '0.78rem', color: 'var(--tx3)' }}>
              {changes.length} video{changes.length !== 1 ? 's' : ''} matched
            </span>
          )}
        </div>

        {/* Body */}
        {changes.length === 0 ? (
          <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--tx3)', fontSize: '0.85rem' }}>
            Nothing to categorize — no unmatched videos found.
          </div>
        ) : (
          <div style={{ overflowY: 'auto', flex: 1 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg3)', position: 'sticky', top: 0 }}>
                  <th style={{ padding: '7px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--tx2)', borderBottom: '1px solid var(--brd)' }}>File</th>
                  <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--tx2)', borderBottom: '1px solid var(--brd)', whiteSpace: 'nowrap' }}>From</th>
                  <th style={{ padding: '7px 6px', textAlign: 'center', color: 'var(--tx3)', borderBottom: '1px solid var(--brd)' }}>→</th>
                  <th style={{ padding: '7px 12px 7px 4px', textAlign: 'left', fontWeight: 600, color: 'var(--tx2)', borderBottom: '1px solid var(--brd)' }}>To</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c, i) => {
                  const skip = edits[c.srcPath] === SKIP;
                  return (
                    <tr
                      key={c.srcPath}
                      style={{
                        background: i % 2 === 0 ? 'transparent' : 'var(--bg3)',
                        opacity: skip ? 0.45 : 1,
                      }}
                    >
                      <td style={{ padding: '6px 12px', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.srcPath}>
                        {c.name}
                      </td>
                      <td style={{ padding: '6px 10px', color: 'var(--tx3)', whiteSpace: 'nowrap' }}>
                        {c.currentFolder || <em style={{ color: 'var(--tx3)' }}>root</em>}
                      </td>
                      <td style={{ padding: '6px', textAlign: 'center', color: 'var(--tx3)' }}>→</td>
                      <td style={{ padding: '6px 12px 6px 4px' }}>
                        <select
                          value={edits[c.srcPath]}
                          onChange={e => setEdit(c.srcPath, (e.target as HTMLSelectElement).value)}
                          style={{
                            background: 'var(--bg3)',
                            border: '1px solid var(--brd)',
                            borderRadius: '4px',
                            color: skip ? 'var(--tx3)' : 'var(--tx1)',
                            padding: '2px 4px',
                            fontSize: '0.76rem',
                            cursor: 'pointer',
                            maxWidth: '180px',
                          }}
                        >
                          {categories.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))}
                          <option value={SKIP}>— keep in place —</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div style={{
          padding: '12px 18px',
          borderTop: '1px solid var(--brd)',
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px',
        }}>
          {changes.length > 0 && toMove.length < changes.length && (
            <span style={{ flex: 1, fontSize: '0.73rem', color: 'var(--tx3)' }}>
              {changes.length - toMove.length} kept in place
            </span>
          )}
          <button
            onClick={onCancel}
            disabled={confirming}
            style={{
              background: 'none', border: '1px solid var(--brd)',
              color: 'var(--tx2)', borderRadius: '6px',
              padding: '5px 14px', fontSize: '0.8rem', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          {changes.length > 0 && (
            <button
              disabled={toMove.length === 0 || confirming}
              onClick={() => onConfirm(toMove.map(c => ({ srcPath: c.srcPath, destFolder: edits[c.srcPath], root: c.root })))}
              style={{
                background: toMove.length === 0 || confirming ? 'var(--bg3)' : 'var(--ac)',
                color: toMove.length === 0 || confirming ? 'var(--tx3)' : '#fff',
                border: 'none', borderRadius: '6px',
                padding: '5px 14px', fontSize: '0.8rem',
                cursor: toMove.length === 0 || confirming ? 'default' : 'pointer',
                fontWeight: 600,
              }}
            >
              {confirming ? 'Moving…' : `Move ${toMove.length} video${toMove.length !== 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
