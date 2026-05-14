import { appPrefs, updatePrefs } from '../../store';
import { useState, useEffect, useRef } from 'preact/hooks';
import { PERSONALITIES, Personality } from '../../personalities';
import { JSX } from 'preact';

declare global {
  interface Window {
    toast?: (msg: string) => void;
    QRCode?: {
      toCanvas: (canvas: HTMLCanvasElement | null, text: string, options: any) => void;
    };
  }
}

interface ConnectUrl {
  url: string;
  name: string;
  ip: string;
}

export const SettingsView = () => {
  const prefs = appPrefs.value;

  const [commentPrompt, setCommentPrompt] = useState(prefs.aiCommentMasterPrompt || '');
  const [replyPrompt, setReplyPrompt] = useState(prefs.aiReplyMasterPrompt || '');
  const [ollamaUrl, setOllamaUrl] = useState(prefs.ollamaUrl || '');
  const [ollamaModel, setOllamaModel] = useState(prefs.ollamaVisionModel || '');
  const [anthropicKey, setAnthropicKey] = useState(prefs.anthropicApiKey || '');
  const [hiddenCats, setHiddenCats] = useState<string[]>([]);

  const [connectUrls, setConnectUrls] = useState<ConnectUrl[]>([]);
  const [connectIdx, setConnectIdx] = useState(0);
  const [netEnabled, setNetEnabled] = useState(!!prefs.networkEnabled);

  const [genRunning, setGenRunning] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [genStatus, setGenStatus] = useState('');
  
  // Vault Settings State
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiProgress, setAiProgress] = useState('');
  const [abortAi, setAbortAi] = useState(false);
  const abortAiRef = useRef(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Folder Browser State
  const [showBrowser, setShowBrowser] = useState(false);
  const [currentBrowsePath, setCurrentBrowsePath] = useState('');
  const [browseDirs, setBrowseDirs] = useState<string[]>([]);
  const [browseDrives, setBrowseDrives] = useState<string[]>([]);
  const [browseParent, setBrowseParent] = useState<string | null>(null);

  const fetchFolders = async (path?: string) => {
    try {
      const url = path ? `/api/browse-folders?path=${encodeURIComponent(path)}` : '/api/browse-folders';
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) {
        if (window.toast) window.toast(data.error);
        return;
      }
      setCurrentBrowsePath(data.currentPath);
      setBrowseDirs(data.dirs);
      setBrowseDrives(data.drives);
      setBrowseParent(data.parent);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (showBrowser && !currentBrowsePath) {
      fetchFolders();
    }
  }, [showBrowser]);
  const sseRef = useRef<EventSource | null>(null);

  const qrRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // Subscribe to gen-thumbs status on mount to catch running processes
    subscribeGenThumbs();
    return () => {
      if (sseRef.current) sseRef.current.close();
    };
  }, []);

  const subscribeGenThumbs = () => {
    if (sseRef.current) sseRef.current.close();
    const sse = new EventSource('/api/gen-thumbs/status');
    sseRef.current = sse;

    sse.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
         if (msg.type === 'start' || msg.type === 'progress') {
           setGenRunning(true);
           const pct = msg.total > 0 ? Math.round(msg.done / msg.total * 100) : 0;
           setGenProgress(pct);
           setGenStatus(msg.total > 0
             ? `${msg.done} / ${msg.total} (${pct}%)${msg.current ? ' — ' + msg.current : ''}`
             : 'Scanning…');
         } else if (msg.type === 'done') {
           setGenRunning(false);
           setGenProgress(100);
           const label = msg.failed
             ? `Done — ${msg.done - msg.failed} generated, ${msg.failed} failed`
             : `Done — ${msg.done} generated, ${msg.skipped || 0} already existed`;
           setGenStatus(label);
           if (window.toast) window.toast(label);
           setTimeout(() => {
             setGenStatus('');
             setGenProgress(0);
           }, 5000);
         } else if (msg.type === 'idle') {
           setGenRunning(false);
           setGenProgress(0);
           setGenStatus('');
         }
      } catch (err) {
        console.error('Failed to parse SSE data', err);
      }
    };

    sse.onerror = () => {
      sse.close();
      sseRef.current = null;
      setGenRunning(false);
    };
  };

  const toggleGenThumbs = async () => {
    if (genRunning) {
      fetch('/api/gen-thumbs/stop', { method: 'POST' }).catch(() => { });
      setGenRunning(false);
    } else {
      try {
        const r = await fetch('/api/gen-thumbs/start', { method: 'POST' });
         const d = await r.json();
         if (!d.ok) {
           if (window.toast) window.toast(d.error || 'Already running');
           return;
         }
         setGenRunning(true);
         setGenStatus('Starting…');
       } catch {
         if (window.toast) window.toast('Failed to start');
       }
    }
  };

  useEffect(() => {
    setCommentPrompt(prefs.aiCommentMasterPrompt || '');
    setReplyPrompt(prefs.aiReplyMasterPrompt || '');
    setOllamaUrl(prefs.ollamaUrl || '');
    setOllamaModel(prefs.ollamaVisionModel || '');
    setAnthropicKey(prefs.anthropicApiKey || '');
    setNetEnabled(!!prefs.networkEnabled);
  }, [prefs]);

  useEffect(() => {
    // Load hidden categories
    fetch('/api/settings/lists')
      .then(r => r.json())
      .then(data => setHiddenCats(data.hidden ? data.hidden.split('\n').filter((l: string) => l.trim()) : []))
      .catch(() => { });

    // Load network info if enabled
    if (prefs.networkEnabled) {
      fetch('/api/local-ip')
        .then(r => r.json())
        .then(data => {
          if (data.url) {
            setConnectUrls(data.all && data.all.length ? data.all : [{ url: data.url, name: 'Network', ip: data.ip }]);
          }
        })
        .catch(() => { });
    }
  }, [prefs.networkEnabled]);

  useEffect(() => {
    if (qrRef.current && connectUrls.length > 0) {
       const url = connectUrls[connectIdx]?.url;
       if (url && window.QRCode) {
         window.QRCode.toCanvas(qrRef.current, url, { width: 220, margin: 2, color: { dark: '#000', light: '#fff' } });
       }
    }
  }, [connectUrls, connectIdx]);

  const applyPersonality = (p: Personality) => {
    setCommentPrompt(p.prompt);
    setReplyPrompt(p.replyPrompt);
  };

  const handleSaveAi = () => {
    updatePrefs({
      aiCommentMasterPrompt: commentPrompt,
      aiReplyMasterPrompt: replyPrompt
    });
    alert('AI Prompts saved!');
  };

  const handleSaveOllama = () => {
    updatePrefs({
      ollamaUrl: ollamaUrl,
      ollamaVisionModel: ollamaModel
    });
    alert('Ollama settings saved!');
  };

  const handleSaveAnthropic = () => {
    updatePrefs({
      anthropicApiKey: anthropicKey
    });
    alert('Anthropic API key saved!');
  };

  const handleSaveHidden = async () => {
    const r = await fetch('/api/settings/hidden', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: hiddenCats.join('\n') })
    });
    if (r.ok) alert('Hidden categories saved!');
    else alert('Save failed');
  };

  const toggleNetwork = async () => {
    const newVal = !netEnabled;
    setNetEnabled(newVal);
    updatePrefs({ networkEnabled: newVal });
  };

  const isMainDevice = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  const handleToggleSelfDestruct = async (enabled: boolean) => {
    updatePrefs({ vaultSelfDestruct: enabled });
    if (window.toast) window.toast(enabled ? 'Self-destruct enabled' : 'Self-destruct disabled');
  };

  const startVaultAiTitles = async () => {
    setAiLoading(true);
    setAbortAi(false);
    abortAiRef.current = false;
    setAiProgress(`Starting…`);

    try {
      const res = await fetch('/api/vault/files');
      if (!res.ok) {
        if (res.status === 401) throw new Error('Vault is locked. Unlock it first.');
        throw new Error('Failed to fetch vault files');
      }
      const files = await res.json();
      
      const VAULT_PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.heic', '.heif']);
      const VAULT_VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.flv', '.wmv']);
      
      const pool = files.filter((f: { ext?: string, id: string }) => {
        const ext = (f.ext || '').toLowerCase();
        return VAULT_PHOTO_EXTS.has(ext) || VAULT_VIDEO_EXTS.has(ext);
      });

      if (!pool.length) {
        setAiProgress('No media files in vault to process');
        setAiLoading(false);
        return;
      }

      let count = 0;
      for (const f of pool) {
        if (abortAiRef.current) {
          setAiProgress(`Aborted`);
          break;
        }
        count++;
        setAiProgress(`Processing ${count} / ${pool.length}`);

        const source = VAULT_VIDEO_EXTS.has((f.ext || '').toLowerCase()) ? 'vault-video' : 'vault';
        try {
          await fetch('/api/vision/describe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source, id: f.id })
          });
        } catch (e) {
          console.error('Failed to describe file', f.id, e);
        }
      }
      
      setAiProgress(prev => prev + ' - Finished');
    } catch (e: any) {
      setAiProgress(`Error: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  };

  const handleChangePw = async () => {
    setError('');
    if (!oldPw || !newPw || !newPw2) { setError('All fields required'); return; }
    if (newPw !== newPw2) { setError('New passwords do not match'); return; }
    if (newPw.length < 6) { setError('New password must be at least 6 chars'); return; }

    setLoading(true);
    try {
      const r = await fetch('/api/vault/change-pw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPw, newPw })
      });
       const d = await r.json();
       if (!r.ok) {
         setError(d.error || 'Failed to change password');
       } else {
         if (window.toast) window.toast('Password changed successfully!');
         setOldPw(''); setNewPw(''); setNewPw2('');
       }
     } catch (e: any) {
       setError(e.message || 'Failed to change password');
     } finally {
       setLoading(false);
     }
  };

  const doVaultDeleteVault = async () => {
    if (deleteConfirmText !== 'DELETE') return;
    
    setLoading(true);
    try {
      const r = await fetch('/api/vault/delete-vault', { method: 'POST' });
       const d = await r.json();
       if (!r.ok) {
         setError(d.error || 'Failed to delete vault');
       } else {
         if (window.toast) window.toast('Vault deleted permanently');
         window.location.reload();
       }
     } catch (e: any) {
       setError(e.message || 'Failed to delete vault');
     } finally {
       setLoading(false);
     }
  };

  return (
    <div className="settings-view on" style={{ padding: '24px', maxWidth: '800px', margin: '0 auto', color: 'var(--tx)' }}>
      <h2 style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <i className="icon-settings" style={{ color: 'var(--ac)' }} />
        Settings
      </h2>

      {/* AI Comments Section */}
      <div className="settings-section" style={{ background: 'var(--bg2)', padding: '24px', borderRadius: '12px', border: '1px solid var(--brd)', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ margin: 0, color: 'var(--ac)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <i className="icon-message-square" />
            AI Comments
          </h3>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={!!prefs.aiCommentsEnabled}
              onChange={(e) => updatePrefs({ aiCommentsEnabled: (e.currentTarget as HTMLInputElement).checked })}
              style={{ width: '18px', height: '18px' }}
            />
            Enable AI comments
          </label>
        </div>

        {/* Personality Preset */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Preset Personality</label>
          <select
            onChange={(e) => {
              const p = PERSONALITIES.find(x => x.id === (e.target as HTMLSelectElement).value);
              if (p) applyPersonality(p);
            }}
            style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px' }}
          >
            <option value="">-- Select a preset personality --</option>
            {PERSONALITIES.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Prompts */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Comment Master Prompt</label>
          <textarea
            value={commentPrompt}
            onInput={(e) => setCommentPrompt((e.target as HTMLTextAreaElement).value)}
            rows={4}
            style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px', fontFamily: 'monospace' }}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Reply Master Prompt</label>
          <textarea
            value={replyPrompt}
            onInput={(e) => setReplyPrompt((e.target as HTMLTextAreaElement).value)}
            rows={3}
            style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px', fontFamily: 'monospace' }}
          />
        </div>

        <button class="modal-btn modal-btn--primary" onClick={handleSaveAi} style={{ width: '100%' }}>Save Prompts</button>
      </div>

      {/* Vision Provider Section */}
      <div className="settings-section" style={{ background: 'var(--bg2)', padding: '24px', borderRadius: '12px', border: '1px solid var(--brd)', marginBottom: '24px' }}>
        <h3 style={{ margin: 0, color: 'var(--ac)', marginBottom: '20px' }}>Vision Provider</h3>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Provider</label>
          <select
            value={prefs.visionProvider || 'ollama'}
            onChange={(e) => updatePrefs({ visionProvider: (e.target as HTMLSelectElement).value })}
            style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px' }}
          >
            <option value="ollama">Ollama (Local)</option>
            <option value="claude">Claude (Anthropic)</option>
          </select>
        </div>

        {prefs.visionProvider === 'ollama' || !prefs.visionProvider ? (
          <>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Ollama URL</label>
              <input type="text" value={ollamaUrl} onInput={(e) => setOllamaUrl((e.target as HTMLInputElement).value)} style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px' }} />
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Vision Model</label>
              <input type="text" value={ollamaModel} onInput={(e) => setOllamaModel((e.target as HTMLInputElement).value)} style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px' }} />
            </div>
            <button class="modal-btn modal-btn--primary" onClick={handleSaveOllama} style={{ width: '100%' }}>Save Ollama Settings</button>
          </>
        ) : (
          <>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Anthropic API Key</label>
              <input type="password" value={anthropicKey} onInput={(e) => setAnthropicKey((e.target as HTMLInputElement).value)} style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px' }} />
            </div>
            <button class="modal-btn modal-btn--primary" onClick={handleSaveAnthropic} style={{ width: '100%' }}>Save API Key</button>
          </>
        )}
      </div>

      {/* Source Folders Section */}
      <div className="settings-section" style={{ background: 'var(--bg2)', padding: '24px', borderRadius: '12px', border: '1px solid var(--brd)', marginBottom: '24px' }}>
        <h3 style={{ margin: 0, color: 'var(--ac)', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <i className="icon-folder" />
          Source Folders
        </h3>
        <p style={{ fontSize: '13px', color: 'var(--tx3)', marginBottom: '16px' }}>
          Add external folders to scan for media (Videos, Photos, Audio). Files will not be moved.
        </p>

        {/* List of current folders */}
        <div style={{ marginBottom: '16px' }}>
          {prefs.sourceFolders && prefs.sourceFolders.length > 0 ? (
            prefs.sourceFolders.map((folder: string, idx: number) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg3)', padding: '10px', borderRadius: '6px', marginBottom: '8px' }}>
                <span style={{ fontSize: '14px', color: 'var(--tx)', wordBreak: 'break-all' }}>{folder}</span>
                <button 
                  className="modal-btn modal-btn--danger" 
                  style={{ padding: '4px 8px', fontSize: '12px' }}
                  onClick={() => {
                    const updated = prefs.sourceFolders!.filter((_: any, i: number) => i !== idx);
                    updatePrefs({ sourceFolders: updated });
                  }}
                >
                  Remove
                </button>
              </div>
            ))
          ) : (
            <p style={{ fontSize: '13px', color: 'var(--tx3)', textAlign: 'center' }}>No source folders added yet.</p>
          )}
        </div>

        {/* Add new folder */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <input 
            type="text" 
            id="new-source-folder"
            placeholder="C:\\Users\\...\\Pictures" 
            style={{ flex: 1, background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px' }} 
          />
          <button 
            className="modal-btn modal-btn--secondary"
            onClick={() => {
              setShowBrowser(true);
            }}
          >
            Browse
          </button>
          <button 
            className="modal-btn modal-btn--primary"
            onClick={() => {
              const input = document.getElementById('new-source-folder') as HTMLInputElement;
              const val = input.value.trim();
              if (val) {
                const current = prefs.sourceFolders || [];
                if (!current.includes(val)) {
                  updatePrefs({ sourceFolders: [...current, val] });
                  input.value = '';
                } else {
                  if (window.toast) window.toast('Folder already added');
                }
              }
            }}
          >
            Add
          </button>
        </div>

        {/* Folder Browser Modal */}
        {showBrowser && (
          <div style={{ 
            position: 'fixed', 
            top: 0, left: 0, right: 0, bottom: 0, 
            background: 'rgba(0,0,0,0.7)', 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center', 
            zIndex: 1000 
          }}>
            <div style={{ 
              background: 'var(--bg2)', 
              padding: '24px', 
              borderRadius: '12px', 
              border: '1px solid var(--brd)', 
              width: '80%', 
              maxWidth: '600px',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column'
            }}>
              <h3 style={{ margin: 0, marginBottom: '16px', color: 'var(--ac)' }}>Browse Folders</h3>
              
              {/* Current Path */}
              <div style={{ background: 'var(--bg3)', padding: '10px', borderRadius: '6px', marginBottom: '10px', fontSize: '14px', wordBreak: 'break-all' }}>
                {currentBrowsePath}
              </div>
              
              {/* Drives */}
              {browseDrives.length > 0 && (
                <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
                  {browseDrives.map(drive => (
                    <button 
                      key={drive}
                      className="modal-btn modal-btn--secondary"
                      style={{ padding: '4px 8px', fontSize: '12px' }}
                      onClick={() => fetchFolders(drive)}
                    >
                      {drive}
                    </button>
                  ))}
                </div>
              )}
              
              {/* List of folders */}
              <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg3)', borderRadius: '6px', padding: '10px', marginBottom: '16px' }}>
                {browseParent && (
                  <div 
                    style={{ padding: '8px', cursor: 'pointer', color: 'var(--ac)', display: 'flex', alignItems: 'center', gap: '8px' }}
                    onClick={() => fetchFolders(browseParent)}
                  >
                    <i className="icon-folder" />
                    .. (Go Up)
                  </div>
                )}
                {browseDirs.map(dir => {
                  const sep = currentBrowsePath.includes('\\') ? '\\' : '/';
                  const nextPath = currentBrowsePath + (currentBrowsePath.endsWith('\\') || currentBrowsePath.endsWith('/') ? '' : sep) + dir;
                  return (
                    <div 
                      key={dir}
                      style={{ padding: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--brd)' }}
                      onClick={() => fetchFolders(nextPath)}
                    >
                      <i className="icon-folder" />
                      {dir}
                    </div>
                  );
                })}
              </div>
              
              {/* Actions */}
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <button 
                  className="modal-btn modal-btn--secondary"
                  onClick={() => setShowBrowser(false)}
                >
                  Cancel
                </button>
                <button 
                  className="modal-btn modal-btn--primary"
                  onClick={() => {
                    const input = document.getElementById('new-source-folder') as HTMLInputElement;
                    if (input) input.value = currentBrowsePath;
                    setShowBrowser(false);
                  }}
                >
                  Select Current Folder
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Hidden Categories & Tags Section */}
      <div className="settings-section" style={{ background: 'var(--bg2)', padding: '24px', borderRadius: '12px', border: '1px solid var(--brd)', marginBottom: '24px' }}>
        <h3 style={{ margin: 0, color: 'var(--ac)', marginBottom: '20px' }}>Hidden Categories & Tags</h3>
        
        <h4 style={{ margin: '0 0 8px 0', color: 'var(--tx2)', fontSize: '0.9rem' }}>Hidden Categories</h4>
        <p style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '8px' }}>Type a category and press Enter to hide it.</p>
        
        <div className="tag-input-container" style={{ 
          display: 'flex', 
          flexWrap: 'wrap', 
          gap: '8px', 
          background: 'var(--bg3)', 
          border: '1px solid var(--brd)', 
          borderRadius: '6px', 
          padding: '10px',
          marginBottom: '16px',
          minHeight: '45px',
          alignItems: 'center'
        }}>
          {hiddenCats.map((cat, idx) => (
            <div key={idx} className="chip" style={{ 
              background: 'var(--bg2)', 
              border: '1px solid var(--brd)', 
              borderRadius: '4px', 
              padding: '4px 8px', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '5px',
              fontSize: '0.9rem'
            }}>
              <span>{cat}</span>
              <button 
                onClick={() => setHiddenCats(hiddenCats.filter((_, i) => i !== idx))}
                style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: 0, fontSize: '1rem', lineHeight: 1, display: 'flex', alignItems: 'center' }}
              >×</button>
            </div>
          ))}
          <input
            type="text"
            placeholder="Type and press Enter..."
            style={{ flex: 1, background: 'none', border: 'none', color: 'var(--tx)', outline: 'none', minWidth: '150px', padding: '4px' }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const target = e.target as HTMLInputElement;
                const val = target.value.trim();
                if (val && !hiddenCats.includes(val)) {
                  setHiddenCats([...hiddenCats, val]);
                  target.value = '';
                }
              }
            }}
          />
        </div>
        <button class="modal-btn modal-btn--primary" onClick={handleSaveHidden} style={{ width: '100%', marginBottom: '20px' }}>Save Hidden Categories</button>

        <h4 style={{ margin: '0 0 8px 0', color: 'var(--tx2)', fontSize: '0.9rem' }}>Hidden Tags</h4>
        <p style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '8px' }}>Type a tag and press Enter to hide it.</p>
        
        <div className="tag-input-container" style={{ 
          display: 'flex', 
          flexWrap: 'wrap', 
          gap: '8px', 
          background: 'var(--bg3)', 
          border: '1px solid var(--brd)', 
          borderRadius: '6px', 
          padding: '10px',
          marginBottom: '16px',
          minHeight: '45px',
          alignItems: 'center'
        }}>
          {(prefs.hiddenTags || []).map((tag, idx) => (
            <div key={idx} className="chip" style={{ 
              background: 'var(--bg2)', 
              border: '1px solid var(--brd)', 
              borderRadius: '4px', 
              padding: '4px 8px', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '5px',
              fontSize: '0.9rem'
            }}>
              <span>{tag}</span>
              <button 
                onClick={() => {
                  const current = prefs.hiddenTags || [];
                  updatePrefs({ hiddenTags: current.filter((_, i) => i !== idx) });
                }}
                style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: 0, fontSize: '1rem', lineHeight: 1, display: 'flex', alignItems: 'center' }}
              >×</button>
            </div>
          ))}
          <input
            type="text"
            placeholder="Type and press Enter..."
            style={{ flex: 1, background: 'none', border: 'none', color: 'var(--tx)', outline: 'none', minWidth: '150px', padding: '4px' }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const target = e.target as HTMLInputElement;
                const val = target.value.trim();
                const current = prefs.hiddenTags || [];
                if (val && !current.includes(val)) {
                  updatePrefs({ hiddenTags: [...current, val] });
                  target.value = '';
                }
              }
            }}
          />
        </div>
      </div>

      {/* Thumbnails Section */}
      <div className="settings-section" style={{ background: 'var(--bg2)', padding: '24px', borderRadius: '12px', border: '1px solid var(--brd)', marginBottom: '24px' }}>
        <h3 style={{ margin: 0, color: 'var(--ac)', marginBottom: '20px' }}>Thumbnails</h3>
        <p style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '16px' }}>Pre-generate thumbnails for all videos in batch.</p>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <button
            className={`modal-btn ${genRunning ? '' : 'modal-btn--primary'}`}
            onClick={toggleGenThumbs}
            style={{ minWidth: '120px' }}
          >
            {genRunning ? 'Stop' : 'Generate All'}
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--tx)', marginBottom: '4px' }}>{genStatus}</div>
            {genRunning && (
              <div style={{ width: '100%', height: '4px', background: 'var(--bg3)', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ width: `${genProgress}%`, height: '100%', background: 'var(--ac)', transition: 'width 0.3s' }} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Vault Section */}
      <div className="settings-section" style={{ background: 'var(--bg2)', padding: '24px', borderRadius: '12px', border: '1px solid var(--brd)', marginBottom: '24px' }}>
        <h3 style={{ margin: 0, color: 'var(--ac)', marginBottom: '20px' }}>Vault Settings</h3>

        {/* Self Destruct */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <div style={{ fontWeight: 'bold' }}>Self-Destruct</div>
            <div style={{ fontSize: '12px', color: 'var(--tx3)' }}>
              Automatically delete vault data after too many failed attempts
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={!!prefs.vaultSelfDestruct}
              onChange={(e) => handleToggleSelfDestruct((e.currentTarget as HTMLInputElement).checked)}
              style={{ width: '18px', height: '18px' }}
            />
          </label>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--brd)', margin: '16px 0' }} />

        {/* AI Titles */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>AI Titles</label>
          <p style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '10px' }}>
            Generate short subject titles for all media in the vault.
          </p>
          {aiLoading || aiProgress ? (
            <div style={{ fontSize: '0.85rem', color: 'var(--tx2)', marginBottom: '8px', padding: '6px 10px', background: 'var(--bg3)', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{aiProgress}</span>
              {aiLoading && (
                <button onClick={() => setAbortAi(true)} style={{ background: 'none', border: 'none', color: 'var(--tx2)', cursor: 'pointer', fontSize: '0.8rem' }}>Stop</button>
              )}
            </div>
          ) : null}
          <button
            className="modal-btn"
            onClick={startVaultAiTitles}
            disabled={aiLoading}
            style={{ width: '100%' }}
          >
            {aiLoading ? 'Processing...' : 'Generate AI Titles for All Media'}
          </button>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--brd)', margin: '16px 0' }} />

        {/* Change Password */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Change Password</label>
          <input
            type="password"
            placeholder="Old Password"
            value={oldPw}
            onInput={(e) => setOldPw((e.target as HTMLInputElement).value)}
            style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px', marginBottom: '8px' }}
          />
          <input
            type="password"
            placeholder="New Password"
            value={newPw}
            onInput={(e) => setNewPw((e.target as HTMLInputElement).value)}
            style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px', marginBottom: '8px' }}
          />
          <input
            type="password"
            placeholder="Confirm New Password"
            value={newPw2}
            onInput={(e) => setNewPw2((e.target as HTMLInputElement).value)}
            style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px', marginBottom: '12px' }}
          />
          {error && <div style={{ color: '#e84040', fontSize: '0.85rem', marginBottom: '8px' }}>{error}</div>}
          <button class="modal-btn modal-btn--primary" onClick={handleChangePw} style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Processing...' : 'Change Password'}
          </button>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--brd)', margin: '16px 0' }} />

        {/* Delete Vault */}
        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#e84040' }}>Danger Zone</label>
          <p style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '10px' }}>
            Permanently delete the vault and all its contents. This action cannot be undone.
          </p>
          {!showDeleteConfirm ? (
            <button className="modal-btn" onClick={() => setShowDeleteConfirm(true)} style={{ width: '100%', borderColor: '#e84040', color: '#e84040' }}>
              Delete Vault
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <p style={{ fontSize: '12px', color: '#e84040', margin: 0 }}>Type "DELETE" to confirm:</p>
              <input
                type="text"
                value={deleteConfirmText}
                onInput={(e) => setDeleteConfirmText((e.target as HTMLInputElement).value)}
                style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px' }}
              />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="modal-btn modal-btn--primary" onClick={doVaultDeleteVault} style={{ flex: 1, background: '#e84040' }} disabled={deleteConfirmText !== 'DELETE' || loading}>
                  Confirm Delete
                </button>
                <button className="modal-btn" onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); }} style={{ flex: 1 }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Network & Remote Section */}
      {isMainDevice && (
        <div className="settings-section" style={{ background: 'var(--bg2)', padding: '24px', borderRadius: '12px', border: '1px solid var(--brd)' }}>
          <h3 style={{ margin: 0, color: 'var(--ac)', marginBottom: '20px' }}>Network Access</h3>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div>
              <div style={{ fontWeight: 'bold' }}>{netEnabled ? 'Enabled' : 'Disabled'}</div>
              <div style={{ fontSize: '12px', color: 'var(--tx3)' }}>
                {netEnabled ? 'Other devices on the network can connect' : 'Server only accepts connections from this machine'}
              </div>
            </div>
            <button class={`modal-btn ${netEnabled ? 'modal-btn--primary' : ''}`} onClick={toggleNetwork}>
              {netEnabled ? 'Disable' : 'Enable'}
            </button>
          </div>

          {netEnabled && connectUrls.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
              <div style={{ display: 'flex', gap: '5px' }}>
                {connectUrls.map((e, i) => (
                  <button
                    key={i}
                    onClick={() => setConnectIdx(i)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '999px',
                      fontSize: '0.75rem',
                      border: '1px solid var(--brd)',
                      background: i === connectIdx ? 'var(--ac)' : 'var(--bg3)',
                      color: i === connectIdx ? '#fff' : 'var(--tx2)'
                    }}
                  >
                    {e.name}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--tx2)' }}>{connectUrls[connectIdx]?.url}</div>
              <canvas ref={qrRef} style={{ background: '#fff', padding: '10px', borderRadius: '8px' }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
