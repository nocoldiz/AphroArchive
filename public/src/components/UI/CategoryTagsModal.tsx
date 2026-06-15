import { useState, useEffect } from 'preact/hooks';

interface Props {
  folderPath: string;
  onClose: () => void;
}

export function CategoryTagsModal({ folderPath, onClose }: Props) {
  const [tagsText, setTagsText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [catName, setCatName] = useState(folderPath);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/db/folder-tags?path=${encodeURIComponent(folderPath)}`)
      .then(r => r.json())
      .then(d => {
        setCatName(d.displayName || folderPath);
        setTagsText((d.tags || []).join(', '));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [folderPath]);

  const handleSave = async () => {
    setSaving(true);
    const tags = tagsText.split(',').map(t => t.trim()).filter(Boolean);
    try {
      await fetch('/api/db/folder-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath, tags }),
      });
      onClose();
    } catch {
      setSaving(false);
    }
  };

  const folderIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: '-2px', marginRight: '6px' }}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  );

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
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
        width: '100%', maxWidth: '480px',
        boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column',
      }}>

        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--brd)' }}>
          <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>
            {folderIcon}{catName}
          </span>
          <div style={{ fontSize: '0.75rem', color: 'var(--tx3)', marginTop: '3px' }}>
            Tags for auto-categorization
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 18px' }}>
          {loading ? (
            <div style={{ color: 'var(--tx3)', fontSize: '0.82rem', textAlign: 'center', padding: '16px 0' }}>Loading…</div>
          ) : (
            <>
              <textarea
                value={tagsText}
                onInput={(e: any) => setTagsText(e.target.value)}
                placeholder="tag1, tag2, tag3…"
                rows={4}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'var(--bg3)',
                  border: '1px solid var(--brd)',
                  borderRadius: '6px',
                  color: 'var(--tx1)',
                  padding: '8px 10px',
                  fontSize: '0.82rem',
                  resize: 'vertical',
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
                onFocus={(e: any) => { e.target.style.borderColor = 'var(--ac)'; }}
                onBlur={(e: any) => { e.target.style.borderColor = 'var(--brd)'; }}
              />
              <div style={{ fontSize: '0.72rem', color: 'var(--tx3)', marginTop: '6px' }}>
                Separate tags with commas. Videos whose filenames contain any tag will be moved here during auto-categorization.
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 18px',
          borderTop: '1px solid var(--brd)',
          display: 'flex', justifyContent: 'flex-end', gap: '8px',
        }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              background: 'none', border: '1px solid var(--brd)',
              color: 'var(--tx2)', borderRadius: '6px',
              padding: '5px 14px', fontSize: '0.8rem', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading || saving}
            style={{
              background: loading || saving ? 'var(--bg3)' : 'var(--ac)',
              color: loading || saving ? 'var(--tx3)' : '#fff',
              border: 'none', borderRadius: '6px',
              padding: '5px 14px', fontSize: '0.8rem',
              cursor: loading || saving ? 'default' : 'pointer',
              fontWeight: 600,
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
