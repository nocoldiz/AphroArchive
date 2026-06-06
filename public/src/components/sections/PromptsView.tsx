import { useState, useEffect, useRef } from 'preact/hooks';

const PROMPT_SITES = [
  // ── General chat ──
  { id: 'chatgpt',    name: 'ChatGPT',      url: 'https://chatgpt.com/' },
  { id: 'claude',     name: 'Claude',       url: 'https://claude.ai/new' },
  { id: 'gemini',     name: 'Gemini',       url: 'https://gemini.google.com/app' },
  { id: 'grok',       name: 'Grok',         url: 'https://grok.com/' },
  { id: 'perplexity', name: 'Perplexity',   url: 'https://perplexity.ai/' },
  { id: 'mistral',    name: 'Le Chat',      url: 'https://chat.mistral.ai/chat' },
  { id: 'copilot',    name: 'Copilot',      url: 'https://copilot.microsoft.com/' },
  { id: 'deepseek',   name: 'DeepSeek',     url: 'https://chat.deepseek.com/' },
  { id: 'meta',       name: 'Meta AI',      url: 'https://www.meta.ai/' },
  { id: 'groq',       name: 'Groq',         url: 'https://chat.groq.com/' },
  { id: 'huggingchat',name: 'HuggingChat',  url: 'https://huggingface.co/chat/' },
  { id: 'poe',        name: 'Poe',          url: 'https://poe.com/' },
  { id: 'you',        name: 'You.com',      url: 'https://you.com/' },
  { id: 'phind',      name: 'Phind',        url: 'https://www.phind.com/' },
  { id: 'cohere',     name: 'Cohere',       url: 'https://coral.cohere.com/' },
  { id: 'qwen',       name: 'Qwen',         url: 'https://chat.qwenlm.ai/' },
  { id: 'kimi',       name: 'Kimi',         url: 'https://kimi.moonshot.cn/' },
  { id: 'venice',     name: 'Venice AI',    url: 'https://venice.ai/' },
  { id: 'pi',         name: 'Pi AI',        url: 'https://pi.ai/talk' },
  // ── Image generation ──
  { id: 'midjourney', name: 'Midjourney',   url: 'https://www.midjourney.com/imagine' },
  { id: 'ideogram',   name: 'Ideogram',     url: 'https://ideogram.ai/' },
  { id: 'leonardo',   name: 'Leonardo AI',  url: 'https://app.leonardo.ai/' },
  { id: 'playground', name: 'Playground',   url: 'https://playground.com/' },
  { id: 'fal',        name: 'fal.ai',       url: 'https://fal.ai/models' },
  // ── Local ──
  { id: 'comfyui',    name: 'ComfyUI',      url: 'http://127.0.0.1:8188', local: true },
  { id: 'a1111',      name: 'A1111',        url: 'http://127.0.0.1:7860', local: true },
  { id: 'lmstudio',   name: 'LM Studio',    url: 'http://localhost:1234',  local: true },
];

interface Prompt {
  id: string;
  title: string;
  text: string;
  tags?: string[];
  sites?: string[];
}

const AdvancedPromptEditor = ({ initial, onSave, onClose }: { initial: Prompt | null; onSave: (p: Partial<Prompt>) => void; onClose: () => void }) => {
  const [title, setTitle] = useState(initial?.title || '');
  const [tags, setTags] = useState((initial?.tags || []).join(', '));
  const [text, setText] = useState(initial?.text || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { textareaRef.current?.focus(); }, []);

  const handleSave = () => {
    const trimTitle = title.trim();
    const trimText = text.trim();
    if (!trimTitle || !trimText) { alert('Title and text are required'); return; }
    onSave({
      id: initial?.id,
      title: trimTitle,
      tags: tags.split(',').map(s => s.trim()).filter(Boolean),
      text: trimText,
    });
  };

  const insertAtCursor = (snippet: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = text.slice(0, start) + snippet + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + snippet.length;
      ta.focus();
    });
  };

  const templateVars = [...new Set(text.match(/\$[A-Z][A-Z0-9_]*/g) || [])];
  const charCount = text.length;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 10000, display: 'flex', flexDirection: 'column' }}>
      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 20px', background: 'var(--bg2)', borderBottom: '1px solid var(--brd)', flexShrink: 0 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--tx)' }}>{initial ? 'Edit Prompt' : 'New Prompt'}</h3>
          <input
            type="text"
            placeholder="Title"
            value={title}
            onInput={(e: any) => setTitle(e.target.value)}
            style={{ flex: 1, maxWidth: '320px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '6px 10px', borderRadius: '6px', fontSize: '0.9rem' }}
          />
          <input
            type="text"
            placeholder="Tags (comma separated)"
            value={tags}
            onInput={(e: any) => setTags(e.target.value)}
            style={{ flex: 1, maxWidth: '280px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '6px 10px', borderRadius: '6px', fontSize: '0.85rem' }}
          />
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="modal-btn" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 20px', background: 'var(--bg2)', borderBottom: '1px solid var(--brd)', flexShrink: 0, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--tx3)', marginRight: '4px' }}>Insert:</span>
        {['$SUBJECT', '$STYLE', '$MOOD', '$SETTING', '$PERSONA'].map(v => (
          <button key={v} onClick={() => insertAtCursor(v)} style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--ac)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer' }}>{v}</button>
        ))}
        <div style={{ flex: 1 }} />
        {templateVars.length > 0 && (
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--tx3)' }}>Templates:</span>
            {templateVars.map(v => <span key={v} style={{ background: 'var(--bg3)', color: 'var(--ac)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem' }}>{v}</span>)}
          </div>
        )}
        <span style={{ fontSize: '0.72rem', color: 'var(--tx3)', marginLeft: '12px' }}>{wordCount}w · {charCount}c</span>
      </div>

      {/* Editor body */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px 20px', gap: '12px', overflow: 'hidden' }}>
        <textarea
          ref={textareaRef}
          value={text}
          onInput={(e: any) => setText(e.target.value)}
          placeholder="Write your prompt here…  Use $UPPERCASE for template variables."
          style={{ flex: 1, width: '100%', resize: 'none', background: 'var(--bg2)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '14px', borderRadius: '8px', fontSize: '0.95rem', lineHeight: '1.65', fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' }}
          onKeyDown={(e: any) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleSave(); } }}
        />
        <div style={{ fontSize: '0.72rem', color: 'var(--tx3)', textAlign: 'right' }}>Ctrl+Enter to save</div>
      </div>
    </div>
  );
};

export const PromptsView = () => {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [query, setQuery] = useState('');
  const [editPrompt, setEditPrompt] = useState<Prompt | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [sendPrompt, setSendPrompt] = useState<Prompt | null>(null);
  const [sendService, setSendService] = useState('__llama__');
  const [sendModel, setSendModel] = useState('llama3');
  const [sendResponse, setSendResponse] = useState('');
  const [isMassImportOpen, setIsMassImportOpen] = useState(false);
  const [massImportText, setMassImportText] = useState('');
  const [massImportSites, setMassImportSites] = useState<string[]>(PROMPT_SITES.map(s => s.id));
  const [isValorizeOpen, setIsValorizeOpen] = useState(false);
  const [templateValues, setTemplateValues] = useState<Record<string, string[]>>({});
  const [valorizedTexts, setValorizedTexts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const txtInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  const w = window as any;

  useEffect(() => {
    loadPrompts();
  }, []);

  const loadPrompts = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/prompts');
      const data = await res.json();
      setPrompts(data);
    } catch (e) {
      console.error(e);
      setPrompts([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (val: string) => {
    setQuery(val);
  };

  const getFilteredPrompts = () => {
    if (!query) return prompts;
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const include = tokens.filter(t => !t.startsWith('-'));
    const exclude = tokens.filter(t => t.startsWith('-')).map(t => t.slice(1)).filter(Boolean);
    
    return prompts.filter(p => {
      const hay = [p.title || '', p.text || '', ...(p.tags || [])].join(' ').toLowerCase();
      if (exclude.some(w => hay.includes(w))) return false;
      if (include.length && !include.some(w => hay.includes(w))) return false;
      return true;
    });
  };

  const savePrompt = async (p: Partial<Prompt>) => {
    try {
      const isEdit = !!p.id;
      const res = await fetch(isEdit ? `/api/prompts/${p.id}` : '/api/prompts', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p)
      });
      if (res.ok) {
        setIsAddModalOpen(false);
        setEditPrompt(null);
        loadPrompts();
        if (w.toast) w.toast(isEdit ? 'Saved' : 'Added');
      } else {
        if (w.toast) w.toast('Save failed');
      }
    } catch (e) {
      if (w.toast) w.toast('Save failed');
    }
  };

  const deletePrompt = async (id: string) => {
    if (!confirm('Delete this prompt?')) return;
    try {
      const res = await fetch(`/api/prompts/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setPrompts(prompts.filter(p => p.id !== id));
        if (w.toast) w.toast('Deleted');
      } else {
        if (w.toast) w.toast('Delete failed');
      }
    } catch (e) {
      if (w.toast) w.toast('Delete failed');
    }
  };

  const deleteAllPrompts = async () => {
    if (!confirm('Are you sure you want to delete ALL prompts? This action cannot be undone.')) return;
    try {
      const response = await fetch('/api/prompts/all', { method: 'DELETE' });
      if (response.ok) {
        setPrompts([]);
        if (w.toast) w.toast('All prompts deleted');
      } else {
        const err = await response.json();
        if (w.toast) w.toast('Error: ' + (err.error || 'Failed to delete'));
      }
    } catch (e) {
      if (w.toast) w.toast('Network error');
    }
  };

  const execSendPromptTo = async (serviceId: string) => {
    if (!sendPrompt) return;
    const text = valorizedTexts[sendPrompt.id] || sendPrompt.text;

    if (serviceId === '__llama__') {
      setSendResponse('Running…');
      try {
        const r = await fetch('/api/prompts/run-local', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, model: sendModel })
        });
        const d = await r.json();
        if (!r.ok) {
          setSendResponse('Error: ' + (d.error || r.status));
          return;
        }
        setSendResponse(d.response || '(no response)');
      } catch (e: any) {
        setSendResponse('Error: ' + e.message);
      }
      return;
    }

    const site = PROMPT_SITES.find(s => s.id === serviceId);
    if (!site) return;
    await navigator.clipboard.writeText(text).catch(() => {});
    window.open(site.url, '_blank');
    if (w.toast) w.toast('Prompt copied — paste in ' + site.name, 2500);
    setSendPrompt(null);
  };

  const saveMassImport = async () => {
    const lines = massImportText.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) {
      if (w.toast) w.toast('Paste at least one prompt');
      return;
    }

    let added = 0;
    for (const text of lines) {
      try {
        const r = await fetch('/api/prompts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, sites: massImportSites }),
        });
        if (r.ok) added++;
      } catch {
        // Skip error for individual items
      }
    }

    setIsMassImportOpen(false);
    loadPrompts();
    if (w.toast) w.toast('Imported ' + added + ' prompt' + (added > 1 ? 's' : ''));
  };

  const scanTemplates = () => {
    const found = new Set<string>();
    prompts.forEach(p => {
      const matches = p.text.match(/\$[A-Z][A-Z0-9_]*/g) || [];
      matches.forEach(m => found.add(m));
    });
    return [...found].sort();
  };

  const applyValorize = () => {
    const newValorizedTexts: Record<string, string> = {};
    prompts.forEach(p => {
      const tpls = [...new Set(p.text.match(/\$[A-Z][A-Z0-9_]*/g) || [])];
      if (!tpls.length) return;
      let text = p.text;
      tpls.forEach(t => {
        const name = t.slice(1);
        const vals = templateValues[name];
        if (vals && vals.length) {
          const val = vals[Math.floor(Math.random() * vals.length)];
          text = text.split(t).join(val);
        }
      });
      if (text !== p.text) newValorizedTexts[p.id] = text;
    });

    setValorizedTexts(newValorizedTexts);
    setIsValorizeOpen(false);
    const count = Object.keys(newValorizedTexts).length;
    if (w.toast) w.toast(count ? 'Templates valorized in ' + count + ' prompt' + (count > 1 ? 's' : '') : 'No templates matched');
  };

  const clearValorize = () => {
    setTemplateValues({});
    setValorizedTexts({});
    setIsValorizeOpen(false);
    if (w.toast) w.toast('Valorization cleared');
  };

  const handleTxtImport = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    input.value = '';
    if (!lines.length) { if (w.toast) w.toast('No prompts found in file'); return; }
    let added = 0;
    for (const line of lines) {
      try {
        const r = await fetch('/api/prompts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: line }),
        });
        if (r.ok) added++;
      } catch {}
    }
    loadPrompts();
    if (w.toast) w.toast('Imported ' + added + ' prompt' + (added !== 1 ? 's' : ''));
  };

  const exportJson = () => {
    const data = JSON.stringify(prompts, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'prompts.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleJsonImport = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    let data: any[];
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed)) throw new Error();
      data = parsed;
    } catch {
      if (w.toast) w.toast('Invalid JSON file');
      input.value = '';
      return;
    }
    input.value = '';
    let added = 0;
    for (const p of data) {
      if (!p.text) continue;
      try {
        const r = await fetch('/api/prompts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: p.text, sites: p.sites }),
        });
        if (r.ok) added++;
      } catch {}
    }
    loadPrompts();
    if (w.toast) w.toast('Imported ' + added + ' prompt' + (added !== 1 ? 's' : ''));
  };

  const filteredPrompts = getFilteredPrompts();
  const templates = scanTemplates();

  return (
    <div className="prompts-view on">
      <input ref={txtInputRef} type="file" accept=".txt" aria-label="Import prompts from TXT file" style={{ display: 'none' }} onChange={handleTxtImport as any} />
      <input ref={jsonInputRef} type="file" accept=".json" aria-label="Import prompts from JSON file" style={{ display: 'none' }} onChange={handleJsonImport as any} />
      <div className="section-header">
        <h2>AI Prompts</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="sort-btn" onClick={() => setIsAddModalOpen(true)}>New Prompt</button>
          <button className="sort-btn" onClick={() => setIsMassImportOpen(true)}>Mass Import</button>
          <button className="sort-btn" onClick={() => txtInputRef.current?.click()} title="Import a .txt file — each line becomes a prompt">Import TXT</button>
          <button className="sort-btn" onClick={exportJson} title="Export all prompts as JSON">Export JSON</button>
          <button className="sort-btn" onClick={() => jsonInputRef.current?.click()} title="Import prompts from a JSON file">Import JSON</button>
          <button className={`sort-btn ${Object.keys(valorizedTexts).length > 0 ? 'sort-btn--valorize-active' : ''}`} onClick={() => setIsValorizeOpen(true)}>Valorize Template</button>
          <button className="sort-btn" onClick={() => {
            const text = filteredPrompts.map(p => valorizedTexts[p.id] || p.text).join('\n\n');
            navigator.clipboard.writeText(text).then(() => {
              if (w.toast) w.toast('Copied ' + filteredPrompts.length + ' prompts');
            });
          }}>Copy All</button>
          <button className="sort-btn" onClick={deleteAllPrompts} style={{ color: 'var(--accent)' }}>Delete All</button>
          
          <div className="gallery-filter-wrap" style={{ display: 'flex', alignItems: 'center' }}>
            <input 
              type="text" 
              placeholder="Filter prompts…" 
              value={query}
              onInput={(e: any) => handleSearch(e.target.value)}
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '4px 10px', borderRadius: '999px', fontSize: '0.75rem', width: '150px' }}
            />
            {query && <span style={{ fontSize: '0.75rem', color: 'var(--tx3)', marginLeft: '8px' }}>{filteredPrompts.length} / {prompts.length}</span>}
          </div>
        </div>
      </div>

      <div style={{ padding: '16px 0' }}>
        {loading && <div style={{ color: 'var(--tx2)', fontSize: '0.85rem' }}>Loading…</div>}
        {!loading && filteredPrompts.length === 0 && (
          <div style={{ color: 'var(--tx2)', fontSize: '0.85rem' }}>No prompts found.</div>
        )}
        {!loading && filteredPrompts.length > 0 && (
          <table className="pt-table" id="prompts-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--brd)' }}>
                <th style={{ padding: '8px' }}>Title</th>
                <th style={{ padding: '8px' }}>Prompt</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPrompts.map(p => {
                const displayText = valorizedTexts[p.id] || p.text;
                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--brd)' }}>
                    <td className="pt-col-title" style={{ padding: '8px', maxWidth: '200px' }}>
                      <div className="pt-title" style={{ fontWeight: '500', color: 'var(--tx)' }}>{p.title}</div>
                      <div className="pt-tags" style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                        {(p.tags || []).map(t => <span key={t} style={{ background: 'var(--bg3)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.65rem', color: 'var(--tx2)' }}>{t}</span>)}
                      </div>
                    </td>
                    <td className="pt-col-text" style={{ padding: '8px' }}>
                      <div className="pt-text-preview" title={displayText} style={{ fontSize: '0.85rem', color: 'var(--tx2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '500px' }}>{displayText}</div>
                    </td>
                    <td className="pt-col-actions" style={{ padding: '8px', textAlign: 'right' }}>
                      <button className="pt-btn" onClick={() => setSendPrompt(p)} title="Send prompt" style={{ background: 'none', border: 'none', color: 'var(--tx2)', cursor: 'pointer', padding: '4px' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                      </button>
                      <button className="pt-btn" onClick={() => { setEditPrompt(p); setIsAddModalOpen(true); }} title="Edit" style={{ background: 'none', border: 'none', color: 'var(--tx2)', cursor: 'pointer', padding: '4px' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      <button className="pt-btn" onClick={() => deletePrompt(p.id)} title="Delete" style={{ background: 'none', border: 'none', color: 'var(--tx2)', cursor: 'pointer', padding: '4px' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Advanced Prompt Editor */}
      {isAddModalOpen && (
        <AdvancedPromptEditor
          initial={editPrompt}
          onSave={(data) => savePrompt(data)}
          onClose={() => { setIsAddModalOpen(false); setEditPrompt(null); }}
        />
      )}

      {/* Send Modal */}
      {sendPrompt && (
        <div className="modal on" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10000 }}>
          <div className="modal-dialog" style={{ background: 'var(--bg2)', borderRadius: '12px', padding: '24px', width: '540px', maxWidth: '90%' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0 }}>Send Prompt</h3>
              <button className="modal-close" onClick={() => { setSendPrompt(null); setSendResponse(''); }} style={{ background: 'none', border: 'none', color: 'var(--tx2)', cursor: 'pointer' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <textarea 
                className="modal-input" 
                style={{ height: '120px', resize: 'vertical', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px', borderRadius: '4px' }} 
                readOnly 
                value={valorizedTexts[sendPrompt.id] || sendPrompt.text}
              />
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--tx2)', marginTop: '5px' }}>Web Services (Copies prompt & opens site)</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '8px' }}>
                {PROMPT_SITES.filter(s => !s.local).map(s => (
                  <button 
                    key={s.id} 
                    className="modal-btn" 
                    style={{ padding: '6px 10px', fontSize: '0.8rem', background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '6px', cursor: 'pointer', color: 'var(--tx)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                    onClick={() => execSendPromptTo(s.id)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
              
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--tx2)', marginTop: '5px' }}>Local Execution</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input 
                  className="stg-ta" 
                  style={{ flex: 1, padding: '8px', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px' }} 
                  placeholder="Model (e.g. llama3)" 
                  value={sendModel}
                  onInput={(e: any) => setSendModel(e.target.value)}
                />
                <button className="pt-btn" style={{ padding: '8px 16px', fontSize: '0.85rem', whiteSpace: 'nowrap', background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }} onClick={() => execSendPromptTo('__llama__')}>
                  Run with Ollama
                </button>
              </div>
              {sendResponse && (
                <div style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '8px', padding: '12px', fontSize: '0.82rem', lineHeight: '1.6', whiteSpace: 'pre-wrap', maxHeight: '260px', overflowY: 'auto', color: 'var(--tx)' }}>
                  {sendResponse}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mass Import Modal */}
      {isMassImportOpen && (
        <div className="modal on" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10000 }}>
          <div className="modal-dialog" style={{ background: 'var(--bg2)', borderRadius: '12px', padding: '24px', width: '600px', maxWidth: '90%' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0 }}>Mass Import Prompts</h3>
              <button className="modal-close" onClick={() => setIsMassImportOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--tx2)', cursor: 'pointer' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--tx2)' }}>Paste prompts, one per line.</p>
              <textarea 
                className="modal-input" 
                style={{ height: '200px', resize: 'vertical', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px', borderRadius: '4px' }} 
                value={massImportText}
                onInput={(e: any) => setMassImportText(e.target.value)}
                placeholder="Paste here…"
              />
              <div style={{ fontSize: '0.75rem', color: 'var(--tx3)' }}>
                {massImportText.split('\n').map(l => l.trim()).filter(Boolean).length} prompts detected
              </div>
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button className="modal-btn" onClick={() => setIsMassImportOpen(false)}>Cancel</button>
              <button className="btn-primary" onClick={saveMassImport}>Import</button>
            </div>
          </div>
        </div>
      )}

      {/* Valorize Modal */}
      {isValorizeOpen && (
        <div className="modal on" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10000 }}>
          <div className="modal-dialog" style={{ background: 'var(--bg2)', borderRadius: '12px', padding: '24px', width: '600px', maxWidth: '90%' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0 }}>Valorize Templates</h3>
              <button className="modal-close" onClick={() => setIsValorizeOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--tx2)', cursor: 'pointer' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {templates.length === 0 ? (
                <div style={{ color: 'var(--tx2)', fontSize: '0.85rem' }}>No template strings ($UPPERCASE) found in your prompts.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {templates.map(t => {
                    const name = t.slice(1);
                    return (
                      <div key={t} style={{ display: 'flex', gap: '12px' }}>
                        <div style={{ width: '100px', fontWeight: '500', color: 'var(--tx)' }}>{t}</div>
                        <textarea 
                          style={{ flex: 1, height: '60px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '8px', borderRadius: '4px', resize: 'vertical' }}
                          placeholder="One value per line"
                          value={(templateValues[name] || []).join('\n')}
                          onInput={(e: any) => {
                            const lines = e.target.value.split('\n').map((l: string) => l.trim()).filter(Boolean);
                            setTemplateValues({ ...templateValues, [name]: lines });
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button className="modal-btn" onClick={clearValorize} style={{ display: Object.keys(valorizedTexts).length > 0 ? '' : 'none' }}>Clear</button>
              <button className="modal-btn" onClick={() => setIsValorizeOpen(false)}>Cancel</button>
              {templates.length > 0 && <button className="btn-primary" onClick={applyValorize}>Apply</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
