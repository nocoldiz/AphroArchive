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
      const r = await fetch('/api/db/folder-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath, tags }),
      });
      // Keep the modal (and the user's edits) open when the server rejects the save.
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        (window as any).toast?.('Save failed: ' + (d.error || `HTTP ${r.status}`));
        setSaving(false);
        return;
      }
      onClose();
    } catch {
      (window as any).toast?.('Save failed');
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
      className="modal-overlay on"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ zIndex: 10000, padding: '16px' }}
    >
      <div className="modal-dialog" style={{ maxWidth: '480px' }}>
        <div className="modal-header">
          <h2>{folderIcon}{catName}</h2>
          <div className="ui-label" style={{ marginTop: '3px', marginBottom: 0 }}>
            Tags for auto-categorization
          </div>
        </div>

        <div className="modal-body">
          {loading ? (
            <div className="empty-state empty-state--sm" style={{ padding: '16px 0', fontSize: '0.82rem' }}>Loading…</div>
          ) : (
            <>
              <textarea
                className="ui-input"
                value={tagsText}
                onInput={(e: any) => setTagsText(e.target.value)}
                placeholder="tag1, tag2, tag3…"
                rows={4}
              />
              <div style={{ fontSize: '0.72rem', color: 'var(--tx3)', marginTop: '6px' }}>
                Separate tags with commas. Videos whose filenames contain any tag will be moved here during auto-categorization.
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="modal-btn modal-btn--primary" onClick={handleSave} disabled={loading || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
