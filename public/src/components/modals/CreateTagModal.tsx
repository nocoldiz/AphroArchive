import { useState, useEffect, useRef } from 'preact/hooks';
import { createTagModalState } from '../../store';
import { saveTagToDb, splitKeywords } from '../../tags';

const inputStyle = { width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px' };

export const CreateTagModal = () => {
  const state = createTagModalState.value;
  const [name, setName] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [kwInput, setKwInput] = useState('');
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const kwRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.visible) {
      setName(state.name || '');
      setKeywords(state.keywords || []);
      setKwInput('');
      setSaving(false);
      setTimeout(() => (state.name ? kwRef.current : nameRef.current)?.focus(), 0);
    }
  }, [state.visible]);

  const handleClose = () => {
    createTagModalState.value = { visible: false, name: '', keywords: [] };
  };

  const addKeywords = (raw: string) => {
    const parts = splitKeywords(raw);
    if (!parts.length) return;
    setKeywords(prev => {
      const seen = new Set(prev.map(k => k.toLowerCase()));
      const next = [...prev];
      for (const p of parts) {
        if (!seen.has(p.toLowerCase())) { seen.add(p.toLowerCase()); next.push(p); }
      }
      return next;
    });
    setKwInput('');
  };

  const handleSave = async () => {
    const tagName = name.trim();
    if (!tagName) { nameRef.current?.focus(); return; }
    if (saving) return;
    setSaving(true);
    const ok = await saveTagToDb(tagName, [...keywords, ...splitKeywords(kwInput)]);
    setSaving(false);
    const w = window as any;
    if (ok) {
      if (w.toast) w.toast(`Tag "${tagName}" saved`);
      handleClose();
    } else if (w.toast) {
      w.toast('Save failed');
    }
  };

  if (!state.visible) return null;

  return (
    <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }} onKeyDown={(e) => { if (e.key === 'Escape') handleClose(); }}>
      <div className="modal-content" style={{ background: 'var(--bg2)', padding: '24px', borderRadius: '12px', border: '1px solid var(--brd)', width: '400px', maxWidth: '90%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ margin: 0 }}>Create Tag</h3>
          <button onClick={handleClose} style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--tx3)', marginBottom: '4px' }}>Tag name</label>
          <input
            ref={nameRef}
            type="text"
            value={name}
            onInput={(e: any) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') kwRef.current?.focus(); }}
            placeholder="e.g. Documentary"
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--tx3)', marginBottom: '4px' }}>Related keywords</label>
          {keywords.length > 0 && (
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '8px' }}>
              {keywords.map(k => (
                <span key={k} className="p-tag" style={{ background: 'var(--bg3)', padding: '4px 8px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  {k}
                  <button onClick={() => setKeywords(keywords.filter(x => x !== k))} style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
                  </button>
                </span>
              ))}
            </div>
          )}
          <input
            ref={kwRef}
            type="text"
            value={kwInput}
            onInput={(e: any) => setKwInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (kwInput.trim()) addKeywords(kwInput);
                else handleSave();
              }
            }}
            placeholder="Add keyword, press Enter (comma-separated ok)"
            style={inputStyle}
          />
          <div style={{ fontSize: '0.72rem', color: 'var(--tx3)', marginTop: '4px' }}>
            Videos whose tags or filename match the tag name or a keyword are grouped under this tag.
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button className="modal-btn" onClick={handleClose}>Cancel</button>
          <button className="modal-btn modal-btn--primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
};

if (typeof window !== 'undefined') {
  (window as any).openCreateTagModal = (name = '', keywords: string[] = []) => {
    createTagModalState.value = { visible: true, name, keywords };
  };
}
