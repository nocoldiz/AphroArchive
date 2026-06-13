import { appPrefs, updatePrefs, loadVideos } from '../../store';
import { useState, useEffect, useRef } from 'preact/hooks';
import { PERSONALITIES, Personality } from '../../personalities';
import { JSX } from 'preact';
import { ensureQRCode } from '../../utils';
import { CategorizeModal, PlanItem, Move } from '../UI/CategorizeModal';

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

interface ScraperStatus {
  running: boolean;
  done?: number;
  total?: number;
  current?: string;
}

interface CatModalState {
  mode: 'uncategorized' | 'all';
  uncategorized: PlanItem[];
  categorized: PlanItem[];
  categories: string[];
  confirming: boolean;
}

const THEMES = [
  { id: 'default', name: 'Default', bg: '#1b1b1b', ac: '#ffa31a' },
  { id: 'orange', name: 'Orange', bg: '#1b1b1b', ac: '#ffa31a' },
  { id: 'blue', name: 'Blue', bg: '#1e1e22', ac: '#00aff0' },
  { id: 'deepblue', name: 'Deep Blue', bg: '#000000', ac: '#0099ff' },
  { id: 'light', name: 'Light', bg: '#f0f0f2', ac: '#e2454a' },
  { id: 'xp', name: 'Windows XP', bg: '#d4d0c8', ac: '#2462c8' },
  { id: 'artdeco', name: 'Art Deco', bg: '#0d0c0a', ac: '#c9a84c' },
  { id: 'ascii', name: 'ASCII', bg: '#000000', ac: '#00ff41' },
  { id: 'rainbow', name: 'Rainbow', bg: '#111113', ac: 'linear-gradient(90deg, #ff0000, #ff7700, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)' },
  { id: 'bi', name: 'Bisexual', bg: '#0e0b14', ac: '#d60270' },
  { id: 'trans', name: 'Trans', bg: '#0d1a2e', ac: '#55cdfc' },
  { id: 'oldpaper', name: 'Old Paper RPG', bg: '#2b1e0e', ac: '#7c3a0a' },
  { id: 'cyberpunk', name: 'Cyberpunk', bg: '#020209', ac: '#ffe600' },
  { id: 'vn', name: 'Visual Novel Pink', bg: '#fff0f5', ac: '#e0257a' },
  { id: 'neon', name: 'Neon', bg: '#000000', ac: '#00ffff' },
  { id: 'youtube', name: 'YouTube', bg: '#f9f9f9', ac: '#ff0000' },
  { id: 'galaxy', name: 'Space Galaxy', bg: '#03000d', ac: '#9d5cff' },
  { id: 'valentine', name: 'Valentine', bg: '#1a000a', ac: '#ff3388' },
  { id: 'christmas', name: 'Christmas', bg: '#001200', ac: '#cc1122' },
  { id: 'halloween', name: 'Halloween', bg: '#0a0006', ac: '#ff6600' },
  { id: 'chan', name: '4chan', bg: '#eef2ff', ac: '#800000' },
];

const TABS = [
  { id: 'folders',    label: 'Folders' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'ai',         label: 'AI' },
  { id: 'cache',      label: 'Cache' },
  { id: 'security',   label: 'Security' },
];

export const SettingsView = () => {
  const prefs = appPrefs.value;

  const [activeTab, setActiveTab] = useState('folders');

  const [commentPrompt, setCommentPrompt] = useState(prefs.aiCommentMasterPrompt || '');
  const [replyPrompt, setReplyPrompt] = useState(prefs.aiReplyMasterPrompt || '');
  const [ollamaUrl, setOllamaUrl] = useState(prefs.ollamaUrl || '');
  const [ollamaModel, setOllamaModel] = useState(prefs.ollamaVisionModel || '');
  const [anthropicKey, setAnthropicKey] = useState(prefs.anthropicApiKey || '');
  const [hiddenCats, setHiddenCats] = useState<string[]>([]);

  const [connectUrls, setConnectUrls] = useState<ConnectUrl[]>([]);
  const [connectIdx, setConnectIdx] = useState(0);
  const [netEnabled, setNetEnabled] = useState(!!prefs.networkEnabled);

  const [verifyStatus, setVerifyStatus] = useState<Record<number, { ok?: boolean; error?: string; checking?: boolean }>>({});

  const [comfyuiPath, setComfyuiPath] = useState(prefs.comfyuiPath || '');

  const [genRunning, setGenRunning] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [genStatus, setGenStatus] = useState('');

  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [duressPw, setDuressPw] = useState('');
  const [vaultTimeout, setVaultTimeout] = useState(
    prefs.vaultTimeoutMinutes === undefined ? 5 : prefs.vaultTimeoutMinutes,
  );
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiProgress, setAiProgress] = useState('');
  const [abortAi, setAbortAi] = useState(false);
  const abortAiRef = useRef(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [currentTheme, setCurrentTheme] = useState(prefs.theme || localStorage.getItem('theme') || 'default');

  useEffect(() => {
    if (prefs.theme) setCurrentTheme(prefs.theme);
  }, [prefs.theme]);

  const [modelStatus, setModelStatus] = useState<{ ready: boolean; fileExists: boolean; modelName: string; downloading: boolean; dlPct: number; dlDone: number; dlTotal: number; dlError: string | null } | null>(null);
  const [llamaModelUri, setLlamaModelUri] = useState(prefs.llamaModelUri || '');
  const modelPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [openrouterKey, setOpenrouterKey] = useState(prefs.openrouterApiKey || '');
  const [openrouterKeySaved, setOpenrouterKeySaved] = useState(false);

  interface ScannedModel { name: string; path: string; size: number; }
  interface ScannedModels {
    llm: ScannedModel[];
    comfyui: { checkpoints: ScannedModel[]; loras: ScannedModel[]; vaes: ScannedModel[]; embeddings: ScannedModel[]; unet: ScannedModel[]; gguf: ScannedModel[] };
  }
  const [scannedModels, setScannedModels] = useState<ScannedModels | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);

  const [scrapers, setScrapers] = useState<{ bmMeta: ScraperStatus; bmThumbs: ScraperStatus }>({
    bmMeta: { running: false }, bmThumbs: { running: false },
  });
  const [rescanning, setRescanning] = useState(false);
  const [autoCatLoading, setAutoCatLoading] = useState(false);
  const [recatAllLoading, setRecatAllLoading] = useState(false);
  const [autoCatResult, setAutoCatResult] = useState<string | undefined>();
  const [recatAllResult, setRecatAllResult] = useState<string | undefined>();
  const [catModal, setCatModal] = useState<CatModalState | null>(null);

  const sseRef = useRef<EventSource | null>(null);
  const qrRef = useRef<HTMLCanvasElement>(null);

  const verifyUrl = async (idx: number, url: string) => {
    setVerifyStatus(prev => ({ ...prev, [idx]: { checking: true } }));
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(url + '/api/ping', { signal: controller.signal });
      clearTimeout(tid);
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data && data.ok) { setVerifyStatus(prev => ({ ...prev, [idx]: { ok: true } })); return; }
      }
      if (res.status === 403) {
        const txt = await res.text().catch(() => '');
        const msg = txt.includes('Network access is disabled') ? 'Network access disabled' : 'Forbidden';
        setVerifyStatus(prev => ({ ...prev, [idx]: { ok: false, error: msg } })); return;
      }
      setVerifyStatus(prev => ({ ...prev, [idx]: { ok: false, error: 'HTTP ' + res.status } }));
    } catch (e: any) {
      const msg = e?.name === 'AbortError' ? 'Timeout' : 'Unreachable';
      setVerifyStatus(prev => ({ ...prev, [idx]: { ok: false, error: msg } }));
    }
  };

  useEffect(() => {
    subscribeGenThumbs();
    return () => { if (sseRef.current) sseRef.current.close(); };
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
          setGenStatus(msg.total > 0 ? `${msg.done} / ${msg.total} (${pct}%)${msg.current ? ' — ' + msg.current : ''}` : 'Scanning…');
        } else if (msg.type === 'done') {
          setGenRunning(false); setGenProgress(100);
          const label = msg.failed ? `Done — ${msg.done - msg.failed} generated, ${msg.failed} failed` : `Done — ${msg.done} generated, ${msg.skipped || 0} already existed`;
          setGenStatus(label);
          if (window.toast) window.toast(label);
          setTimeout(() => { setGenStatus(''); setGenProgress(0); }, 5000);
        } else if (msg.type === 'idle') {
          setGenRunning(false); setGenProgress(0); setGenStatus('');
        }
      } catch (err) { console.error('Failed to parse SSE data', err); }
    };
    sse.onerror = () => { sse.close(); sseRef.current = null; setGenRunning(false); };
  };

  const toggleGenThumbs = async () => {
    if (genRunning) {
      fetch('/api/gen-thumbs/stop', { method: 'POST' }).catch(() => {});
      setGenRunning(false);
    } else {
      try {
        const r = await fetch('/api/gen-thumbs/start', { method: 'POST' });
        const d = await r.json();
        if (!d.ok) { if (window.toast) window.toast(d.error || 'Already running'); return; }
        setGenRunning(true); setGenStatus('Starting…');
      } catch { if (window.toast) window.toast('Failed to start'); }
    }
  };

  useEffect(() => {
    setCommentPrompt(prefs.aiCommentMasterPrompt || '');
    setReplyPrompt(prefs.aiReplyMasterPrompt || '');
    setOllamaUrl(prefs.ollamaUrl || '');
    setOllamaModel(prefs.ollamaVisionModel || '');
    setAnthropicKey(prefs.anthropicApiKey || '');
    setNetEnabled(!!prefs.networkEnabled);
    setLlamaModelUri(prefs.llamaModelUri || '');
    setOpenrouterKey(prefs.openrouterApiKey || '');
  }, [prefs]);

  useEffect(() => {
    const poll = async () => {
      try {
        const [bmMetaRes, bmThRes] = await Promise.all([
          fetch('/api/links/scrape-status'),
          fetch('/api/links/thumb-status'),
        ]);
        const bm = bmMetaRes.ok ? await bmMetaRes.json() : { running: false };
        const bt = bmThRes.ok ? await bmThRes.json() : { running: false };
        setScrapers({ bmMeta: bm, bmThumbs: bt });
      } catch {}
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, []);

  const scraperAction = (url: string, method = 'POST') => fetch(url, { method }).catch(() => {});

  const openCategorizeModal = async (mode: 'uncategorized' | 'all') => {
    const setLoading = mode === 'all' ? setRecatAllLoading : setAutoCatLoading;
    setLoading(true);
    try {
      const r = await fetch('/api/videos/categorize-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
      const { uncategorized, categorized, categories } = await r.json();
      setCatModal({ mode, uncategorized: uncategorized || [], categorized: categorized || [], categories, confirming: false });
    } catch {
      if (mode === 'all') setRecatAllResult('error'); else setAutoCatResult('error');
    } finally { setLoading(false); }
  };

  const handleCatConfirm = async (moves: Move[]) => {
    if (!catModal) return;
    setCatModal(m => m ? { ...m, confirming: true } : null);
    try {
      const r = await fetch('/api/videos/categorize-execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ moves }) });
      const d = await r.json();
      const result = `${d.movedVideos} videos, ${d.movedLinks} links`;
      if (catModal.mode === 'all') setRecatAllResult(result); else setAutoCatResult(result);
      await loadVideos();
    } catch {
      if (catModal.mode === 'all') setRecatAllResult('error'); else setAutoCatResult('error');
    } finally { setCatModal(null); }
  };

  const saveOpenrouterKey = async () => {
    await updatePrefs({ openrouterApiKey: openrouterKey.trim() });
    setOpenrouterKeySaved(true);
    if (window.toast) window.toast('OpenRouter API key saved');
    setTimeout(() => setOpenrouterKeySaved(false), 3000);
  };

  const scanModels = () => {
    setModelsLoading(true);
    fetch('/api/models/scan').then(r => r.json()).then(d => { setScannedModels(d); setModelsLoading(false); }).catch(() => setModelsLoading(false));
  };

  const fetchModelStatus = () => {
    fetch('/api/comments/model/status').then(r => r.json()).then(d => setModelStatus(d)).catch(() => {});
  };

  useEffect(() => {
    fetchModelStatus();
  }, []);

  useEffect(() => {
    if (!modelStatus?.downloading) {
      if (modelPollRef.current) { clearInterval(modelPollRef.current); modelPollRef.current = null; }
      return;
    }
    if (!modelPollRef.current) {
      modelPollRef.current = setInterval(fetchModelStatus, 800);
    }
    return () => { if (modelPollRef.current) { clearInterval(modelPollRef.current); modelPollRef.current = null; } };
  }, [modelStatus?.downloading]);

  const startModelDownload = async () => {
    await updatePrefs({ llamaModelUri });
    const r = await fetch('/api/comments/model/download', { method: 'POST' });
    const d = await r.json();
    if (d.error) { alert(d.error); return; }
    fetchModelStatus();
    if (modelPollRef.current) clearInterval(modelPollRef.current);
    modelPollRef.current = setInterval(fetchModelStatus, 800);
  };

  const cancelModelDownload = async () => {
    await fetch('/api/comments/model/download', { method: 'DELETE' });
    fetchModelStatus();
  };

  useEffect(() => {
    fetch('/api/settings/lists')
      .then(r => r.json())
      .then(data => setHiddenCats(data.hidden ? data.hidden.split('\n').filter((l: string) => l.trim()) : []))
      .catch(() => {});

    if (prefs.networkEnabled) {
      fetch('/api/local-ip').then(r => r.json()).then(data => {
        if (data.url) {
          const list = data.all && data.all.length ? data.all : [{ url: data.url, name: 'Network', ip: data.ip }];
          setConnectUrls(list); setVerifyStatus({});
          list.forEach((u: ConnectUrl, i: number) => verifyUrl(i, u.url));
        }
      }).catch(() => {});
    } else {
      setConnectUrls([]); setVerifyStatus({});
    }
  }, [prefs.networkEnabled]);

  useEffect(() => {
    (async () => {
      if (!qrRef.current || connectUrls.length === 0) return;
      const url = connectUrls[connectIdx]?.url;
      if (!url) return;
      try {
        await ensureQRCode();
        if (window.QRCode && qrRef.current) {
          window.QRCode.toCanvas(qrRef.current, url, { width: 220, margin: 2, color: { dark: '#000', light: '#fff' } });
        }
      } catch (e) { console.warn('QR code generation failed:', e); }
    })();
  }, [connectUrls, connectIdx]);

  const applyPersonality = (p: Personality) => { setCommentPrompt(p.prompt); setReplyPrompt(p.replyPrompt); };

  const handleSaveAi = () => { updatePrefs({ aiCommentMasterPrompt: commentPrompt, aiReplyMasterPrompt: replyPrompt }); alert('AI Prompts saved!'); };
  const handleSaveOllama = () => { updatePrefs({ ollamaUrl, ollamaVisionModel: ollamaModel }); alert('Ollama settings saved!'); };
  const handleSaveAnthropic = () => { updatePrefs({ anthropicApiKey: anthropicKey }); alert('Anthropic API key saved!'); };

  const handleSaveHidden = async () => {
    const r = await fetch('/api/settings/hidden', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: hiddenCats.join('\n') }) });
    if (r.ok) alert('Hidden folders saved!'); else alert('Save failed');
  };

  const toggleNetwork = async () => { const newVal = !netEnabled; setNetEnabled(newVal); updatePrefs({ networkEnabled: newVal }); };

  const isMainDevice = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  const handleToggleSelfDestruct = async (enabled: boolean) => {
    updatePrefs({ vaultSelfDestruct: enabled });
    if (window.toast) window.toast(enabled ? 'Self-destruct enabled' : 'Self-destruct disabled');
  };

  const startVaultAiTitles = async () => {
    setAiLoading(true); setAbortAi(false); abortAiRef.current = false; setAiProgress('Starting…');
    try {
      const res = await fetch('/api/vault/files');
      if (!res.ok) { if (res.status === 401) throw new Error('Vault is locked. Unlock it first.'); throw new Error('Failed to fetch vault files'); }
      const files = await res.json();
      const VAULT_PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.heic', '.heif']);
      const VAULT_VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.flv', '.wmv']);
      const pool = files.filter((f: { ext?: string, id: string }) => { const ext = (f.ext || '').toLowerCase(); return VAULT_PHOTO_EXTS.has(ext) || VAULT_VIDEO_EXTS.has(ext); });
      if (!pool.length) { setAiProgress('No media files in vault to process'); setAiLoading(false); return; }
      let count = 0;
      for (const f of pool) {
        if (abortAiRef.current) { setAiProgress('Aborted'); break; }
        count++; setAiProgress(`Processing ${count} / ${pool.length}`);
        const source = VAULT_VIDEO_EXTS.has((f.ext || '').toLowerCase()) ? 'vault-video' : 'vault';
        try { await fetch('/api/vision/describe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, id: f.id }) }); } catch (e) { console.error('Failed to describe file', f.id, e); }
      }
      setAiProgress(prev => prev + ' - Finished');
    } catch (e: any) { setAiProgress(`Error: ${e.message}`); } finally { setAiLoading(false); }
  };

  const handleChangePw = async () => {
    setError('');
    if (!oldPw || !newPw || !newPw2) { setError('All fields required'); return; }
    if (newPw !== newPw2) { setError('New passwords do not match'); return; }
    if (newPw.length < 6) { setError('New password must be at least 6 chars'); return; }
    if (duressPw && (duressPw.length < 6 || duressPw === newPw)) { setError('Duress password must be 6+ chars and differ from the real one'); return; }
    setLoading(true);
    try {
      const body: Record<string, string> = { oldPw, newPw };
      if (duressPw) body.duressPassword = duressPw;
      const r = await fetch('/api/vault/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Failed to change password'); }
      else { if (window.toast) window.toast('Password changed successfully!'); setOldPw(''); setNewPw(''); setNewPw2(''); setDuressPw(''); }
    } catch (e: any) { setError(e.message || 'Failed to change password'); } finally { setLoading(false); }
  };

  const handleSaveTimeout = (minutes: number) => {
    const clamped = Math.max(0, Math.min(1440, Math.round(minutes)));
    setVaultTimeout(clamped);
    updatePrefs({ vaultTimeoutMinutes: clamped });
    if (window.toast) window.toast(clamped === 0 ? 'Auto-lock disabled' : `Auto-lock set to ${clamped} min`);
  };

  const doVaultDeleteVault = async () => {
    if (deleteConfirmText !== 'DELETE') return;
    setLoading(true);
    try {
      const r = await fetch('/api/vault/delete-vault', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Failed to delete vault'); }
      else { if (window.toast) window.toast('Vault deleted permanently'); window.location.reload(); }
    } catch (e: any) { setError(e.message || 'Failed to delete vault'); } finally { setLoading(false); }
  };

  // ── Shared styles ──────────────────────────────────────────────────────
  const card: JSX.CSSProperties = { background: 'var(--bg2)', padding: '24px', borderRadius: '12px', border: '1px solid var(--brd)' };
  const fieldRow: JSX.CSSProperties = { marginBottom: '16px' };
  const label: JSX.CSSProperties = { display: 'block', marginBottom: '8px', fontWeight: 'bold' };
  const inp: JSX.CSSProperties = { width: '100%', boxSizing: 'border-box', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px' };
  const cardH: JSX.CSSProperties = { margin: '0 0 20px', color: 'var(--ac)' };

  return (
    <>
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', color: 'var(--tx)' }}>

      {/* ── Tab bar ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '10px', padding: '10px 16px', borderBottom: '1px solid var(--brd)', flexWrap: 'wrap', flexShrink: 0 }}>
        {TABS.map(t => (
          <button key={t.id} className={`db-tab ${activeTab === t.id ? 'on' : ''}`} onClick={() => setActiveTab(t.id)} style={{
            background: activeTab === t.id ? 'var(--ac)' : 'transparent',
            color: activeTab === t.id ? '#fff' : 'var(--tx2)',
            padding: '8px 16px', borderRadius: '4px', border: 'none',
            cursor: 'pointer',
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── Scrollable content ───────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* ══ Appearance ══════════════════════════════════════════════ */}
        {activeTab === 'appearance' && (
          <div style={card}>
            <h3 style={{ ...cardH, marginBottom: '6px' }}>Theme</h3>
            <p style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '16px' }}>Select the application theme.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
              {THEMES.map(theme => {
                const isSelected = currentTheme === theme.id;
                const bgStyle = theme.id === 'rainbow' ? { background: theme.ac } : { background: `linear-gradient(135deg, ${theme.bg}, ${theme.ac})` };
                return (
                  <div key={theme.id} onClick={() => { setCurrentTheme(theme.id); document.documentElement.setAttribute('data-theme', theme.id); localStorage.setItem('theme', theme.id); updatePrefs({ theme: theme.id }); }}
                    style={{ display: 'flex', alignItems: 'center', padding: '12px', background: 'var(--bg3)', border: isSelected ? '2px solid var(--ac)' : '1px solid var(--brd)', borderRadius: '8px', cursor: 'pointer', transition: 'border-color 0.2s' }}>
                    <div style={{ width: '24px', height: '24px', borderRadius: '4px', marginRight: '12px', flexShrink: 0, ...bgStyle }} />
                    <span style={{ flex: 1, fontSize: '14px', color: 'var(--tx)' }}>{theme.name}</span>
                    {isSelected && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ac)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ══ AI ══════════════════════════════════════════════════════ */}
        {activeTab === 'ai' && <>

          {/* OpenRouter API Key */}
          <div style={card}>
            <h3 style={cardH}>OpenRouter API Key</h3>
            <p style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '14px' }}>Used by Chat Assistant and AI Comments when their provider is set to OpenRouter. Get a free key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ac)' }}>openrouter.ai/keys</a>.</p>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="password"
                value={openrouterKey}
                onInput={(e) => { setOpenrouterKey((e.target as HTMLInputElement).value); setOpenrouterKeySaved(false); }}
                placeholder="sk-or-..."
                style={{ ...inp, flex: 1, width: 'auto', border: `1px solid ${openrouterKeySaved ? '#4caf50' : 'var(--brd)'}` }}
              />
              <button type="button" class="modal-btn modal-btn--primary" onClick={saveOpenrouterKey} style={{ whiteSpace: 'nowrap' }}>
                {openrouterKeySaved ? 'Saved ✓' : 'Save Key'}
              </button>
            </div>
          </div>

          {/* AI Provider configuration */}
          <div style={card}>
            <h3 style={cardH}>AI Providers</h3>
            <p style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '16px' }}>Choose which backend each AI feature uses. Local requires a GGUF model in the <code style={{ fontSize: '11px' }}>models/</code> folder; OpenRouter requires an API key above.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div style={fieldRow}>
                <label style={label}>Chat Assistant</label>
                <select title="Chat Assistant AI provider" value={prefs.assistantProvider || 'openrouter'} onChange={(e) => updatePrefs({ assistantProvider: (e.target as HTMLSelectElement).value as any })} style={{ ...inp }}>
                  <option value="openrouter">OpenRouter</option>
                  <option value="local">Local GGUF</option>
                </select>
              </div>
              <div style={fieldRow}>
                <label style={label}>AI Comments</label>
                <select title="AI Comments provider" value={prefs.commentsProvider || 'local'} onChange={(e) => updatePrefs({ commentsProvider: (e.target as HTMLSelectElement).value as any })} style={{ ...inp }}>
                  <option value="local">Local GGUF</option>
                  <option value="openrouter">OpenRouter</option>
                </select>
              </div>
            </div>
          </div>

          {/* AI Comments */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, color: 'var(--ac)' }}>AI Comments</h3>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                <input type="checkbox" checked={!!prefs.aiCommentsEnabled} onChange={(e) => updatePrefs({ aiCommentsEnabled: (e.currentTarget as HTMLInputElement).checked })} style={{ width: '16px', height: '16px' }} />
                Enable
              </label>
            </div>
            <div style={fieldRow}>
              <label style={label}>Preset Personality</label>
              <select onChange={(e) => { const p = PERSONALITIES.find(x => x.id === (e.target as HTMLSelectElement).value); if (p) applyPersonality(p); }}
                style={{ ...inp }}>
                <option value="">— Select a preset personality —</option>
                {PERSONALITIES.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div style={fieldRow}>
              <label style={label}>Comment Master Prompt</label>
              <textarea value={commentPrompt} onInput={(e) => setCommentPrompt((e.target as HTMLTextAreaElement).value)} rows={4} style={{ ...inp, fontFamily: 'monospace', resize: 'vertical' }} />
            </div>
            <div style={fieldRow}>
              <label style={label}>Reply Master Prompt</label>
              <textarea value={replyPrompt} onInput={(e) => setReplyPrompt((e.target as HTMLTextAreaElement).value)} rows={3} style={{ ...inp, fontFamily: 'monospace', resize: 'vertical' }} />
            </div>
            <button class="modal-btn modal-btn--primary" onClick={handleSaveAi} style={{ width: '100%' }}>Save Prompts</button>

            {/* Model status + download */}
            <div style={{ marginTop: '16px', padding: '12px', background: 'var(--bg3)', borderRadius: '6px', border: '1px solid var(--brd)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, background: modelStatus?.ready ? '#4caf50' : modelStatus?.fileExists ? '#ff9800' : '#888', display: 'inline-block' }} />
                <span style={{ fontSize: '13px', fontWeight: 600, flex: 1 }}>Local Model</span>
                <code style={{ fontSize: '11px', color: 'var(--tx3)' }}>{modelStatus?.modelName || 'llama-3.2-1b-instruct.gguf'}</code>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '10px' }}>
                {modelStatus?.ready ? 'Loaded and ready' : modelStatus?.fileExists ? 'File found — not yet loaded' : 'Model not found — download required'}
              </div>
              {!modelStatus?.fileExists && !modelStatus?.downloading && (
                <div style={{ marginBottom: '8px' }}>
                  <label style={{ ...label, display: 'block', marginBottom: '4px' }}>Model URI</label>
                  <input value={llamaModelUri} onInput={(e) => setLlamaModelUri((e.target as HTMLInputElement).value)}
                    placeholder="hf:bartowski/Llama-3.2-1B-Instruct-GGUF:Q4_K_M"
                    style={{ ...inp, marginBottom: '6px' }} />
                </div>
              )}
              {modelStatus?.downloading ? (
                <div>
                  <div style={{ height: '4px', background: 'var(--brd)', borderRadius: '2px', marginBottom: '6px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${modelStatus.dlPct}%`, background: 'var(--ac)', transition: 'width 0.3s' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', color: 'var(--tx2)' }}>{modelStatus.dlPct}% — {(modelStatus.dlDone / 1048576).toFixed(1)} / {(modelStatus.dlTotal / 1048576).toFixed(1)} MB</span>
                    <button type="button" onClick={cancelModelDownload} style={{ fontSize: '11px', padding: '2px 8px', background: 'none', border: '1px solid #c44', color: '#c44', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
                  </div>
                </div>
              ) : !modelStatus?.fileExists ? (
                <button type="button" onClick={startModelDownload} class="modal-btn modal-btn--primary" style={{ width: '100%', fontSize: '13px' }}>Download Model</button>
              ) : null}
              {modelStatus?.dlError && <div style={{ fontSize: '11px', color: '#e53935', marginTop: '6px' }}>{modelStatus.dlError}</div>}
            </div>
          </div>

          {/* Vision Provider */}
          <div style={card}>
            <h3 style={cardH}>Vision Provider</h3>
            <div style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '14px', padding: '8px 10px', background: 'var(--bg3)', borderRadius: '5px', border: '1px solid var(--brd)' }}>
              Vision requires a <strong>multimodal</strong> model (one that can analyze images). Your <code style={{ fontSize: '11px' }}>text_encoders/</code> and <code style={{ fontSize: '11px' }}>clip/</code> models are text-only and cannot be used for vision — they are Flux image-generation helpers. For local vision use Ollama with a model like <code style={{ fontSize: '11px' }}>minicpm-v</code>, <code style={{ fontSize: '11px' }}>llava</code>, or <code style={{ fontSize: '11px' }}>qwen2-vl</code> (note: Qwen2-VL ≠ Qwen3).
            </div>
            <div style={fieldRow}>
              <label style={label}>Provider</label>
              <select value={prefs.visionProvider || 'ollama'} onChange={(e) => updatePrefs({ visionProvider: (e.target as HTMLSelectElement).value })} style={{ ...inp }}>
                <option value="ollama">Ollama (Local)</option>
                <option value="claude">Claude (Anthropic)</option>
              </select>
            </div>
            {(prefs.visionProvider === 'ollama' || !prefs.visionProvider) ? <>
              <div style={fieldRow}>
                <label style={label}>Ollama URL</label>
                <input type="text" value={ollamaUrl} onInput={(e) => setOllamaUrl((e.target as HTMLInputElement).value)} style={{ ...inp }} />
              </div>
              <div style={fieldRow}>
                <label style={label}>Vision Model</label>
                <input type="text" value={ollamaModel} onInput={(e) => setOllamaModel((e.target as HTMLInputElement).value)} style={{ ...inp }} />
              </div>
              <button class="modal-btn modal-btn--primary" onClick={handleSaveOllama} style={{ width: '100%' }}>Save Ollama Settings</button>
            </> : <>
              <div style={fieldRow}>
                <label style={label}>Anthropic API Key</label>
                <input type="password" value={anthropicKey} onInput={(e) => setAnthropicKey((e.target as HTMLInputElement).value)} style={{ ...inp }} />
              </div>
              <button class="modal-btn modal-btn--primary" onClick={handleSaveAnthropic} style={{ width: '100%' }}>Save API Key</button>
            </>}
          </div>

          {/* Models Library */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: 'var(--ac)' }}>Models Library</h3>
              <button type="button" class="modal-btn modal-btn--secondary" onClick={scanModels} disabled={modelsLoading} style={{ fontSize: '12px' }}>
                {modelsLoading ? 'Scanning…' : 'Scan Models'}
              </button>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '16px' }}>
              Lists GGUF models from <code style={{ fontSize: '11px' }}>models/</code> and safetensor/GGUF models from your ComfyUI folder.
            </p>

            {!scannedModels && !modelsLoading && (
              <div style={{ textAlign: 'center', color: 'var(--tx3)', fontSize: '13px', padding: '20px 0' }}>Click "Scan Models" to discover installed models.</div>
            )}

            {scannedModels && (() => {
              const fmtSize = (b: number) => b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : (b / 1048576).toFixed(0) + ' MB';
              const ModelRow = ({ m }: { m: { name: string; path: string; size: number } }) => (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', borderRadius: '4px', background: 'var(--bg)', marginBottom: '4px', fontSize: '12px' }}>
                  <span style={{ color: 'var(--tx)', wordBreak: 'break-all', flex: 1 }}>{m.name}</span>
                  <span style={{ color: 'var(--tx3)', whiteSpace: 'nowrap', marginLeft: '12px' }}>{fmtSize(m.size)}</span>
                </div>
              );
              const Section = ({ title, items, accent }: { title: string; items: typeof scannedModels.llm; accent?: boolean }) => items.length > 0 ? (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: accent ? 'var(--ac)' : 'var(--tx2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{title} <span style={{ fontWeight: 400 }}>({items.length})</span></div>
                  {items.map((m, i) => <ModelRow key={i} m={m} />)}
                </div>
              ) : null;

              return (
                <div>
                  {/* Local LLM */}
                  <Section title="Local GGUF (LLM)" items={scannedModels.llm} accent />
                  {/* ComfyUI */}
                  {Object.values(scannedModels.comfyui).some(a => a.length > 0) && (
                    <div style={{ marginTop: '8px', paddingTop: '12px', borderTop: '1px solid var(--brd)' }}>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--tx2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>ComfyUI</div>
                      <Section title="Checkpoints" items={scannedModels.comfyui.checkpoints} />
                      <Section title="UNet / Transformers" items={scannedModels.comfyui.unet} />
                      <Section title="Text Encoders (T5 / Qwen)" items={(scannedModels.comfyui as any).text_encoders || []} />
                      <Section title="CLIP Encoders" items={(scannedModels.comfyui as any).clip || []} />
                      <Section title="LoRAs" items={scannedModels.comfyui.loras} />
                      <Section title="VAEs" items={scannedModels.comfyui.vaes} />
                      <Section title="Embeddings" items={scannedModels.comfyui.embeddings} />
                      <Section title="GGUF (other)" items={scannedModels.comfyui.gguf} />
                    </div>
                  )}
                  {scannedModels.llm.length === 0 && Object.values(scannedModels.comfyui).every(a => a.length === 0) && (
                    <div style={{ textAlign: 'center', color: 'var(--tx3)', fontSize: '13px', padding: '12px 0' }}>No models found. Place GGUF files in <code style={{ fontSize: '11px' }}>models/</code> or set your ComfyUI path.</div>
                  )}
                </div>
              );
            })()}
          </div>
        </>}

        {/* ══ Folders ═════════════════════════════════════════════════ */}
        {activeTab === 'folders' && <>
          {/* Source Folders */}
          <div style={card}>
            <h3 style={{ ...cardH, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <i className="icon-folder" /> Source Folders
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--tx3)', marginBottom: '16px' }}>
              Add external folders to scan for media (Videos, Photos, Audio). Files will not be moved.
            </p>
            <div style={{ marginBottom: '16px' }}>
              {prefs.videosDir && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg3)', padding: '10px', borderRadius: '6px', marginBottom: '8px', opacity: 0.8 }}>
                  <span style={{ fontSize: '14px', color: 'var(--tx)', wordBreak: 'break-all' }}>{prefs.videosDir}</span>
                  <span style={{ fontSize: '11px', color: 'var(--tx3)', whiteSpace: 'nowrap', marginLeft: '8px' }}>default</span>
                </div>
              )}
              {(prefs.sourceFolders || []).map((folder: string, idx: number) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg3)', padding: '10px', borderRadius: '6px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '14px', color: 'var(--tx)', wordBreak: 'break-all' }}>{folder}</span>
                  <button className="modal-btn modal-btn--danger" style={{ padding: '4px 8px', fontSize: '12px', flexShrink: 0, marginLeft: '8px' }}
                    onClick={async () => { const updated = prefs.sourceFolders!.filter((_: any, i: number) => i !== idx); await updatePrefs({ sourceFolders: updated }); loadVideos(); }}>
                    Remove
                  </button>
                </div>
              ))}
              {!prefs.videosDir && !(prefs.sourceFolders?.length) && <p style={{ fontSize: '13px', color: 'var(--tx3)', textAlign: 'center' }}>No source folders added yet.</p>}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input type="text" id="new-source-folder" placeholder="C:\Users\...\Pictures" style={{ ...inp, flex: 1, width: 'auto' }} />
              <button className="modal-btn modal-btn--secondary" onClick={async () => { try { const r = await fetch('/api/browse-folders-native'); const d = await r.json(); if (d.path) { const i = document.getElementById('new-source-folder') as HTMLInputElement; if (i) i.value = d.path; } else if (d.error) alert(d.error); } catch {} }}>Browse</button>
              <button className="modal-btn modal-btn--primary" onClick={async () => { const input = document.getElementById('new-source-folder') as HTMLInputElement; const val = input.value.trim(); if (val) { const current = prefs.sourceFolders || []; if (!current.includes(val)) { await updatePrefs({ sourceFolders: [...current, val] }); input.value = ''; loadVideos(); } else { if (window.toast) window.toast('Folder already added'); } } }}>Add</button>
            </div>
          </div>

          {/* Feed Folders */}
          <div style={card}>
            <h3 style={{ ...cardH, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <i className="icon-rss" /> Feed Folders
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '24px' }}>
              {/* Regular */}
              <div>
                <h4 style={{ margin: '0 0 6px', color: 'var(--tx)' }}>Regular</h4>
                <p style={{ fontSize: '13px', color: 'var(--tx3)', marginBottom: '12px' }}>Files added here are automatically moved to your videos folder as uncategorized.</p>
                <div style={{ marginBottom: '12px' }}>
                  {(prefs.feedFolders || []).map((folder: string, idx: number) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg3)', padding: '10px', borderRadius: '6px', marginBottom: '6px' }}>
                      <span style={{ fontSize: '14px', color: 'var(--tx)', wordBreak: 'break-all' }}>{folder}</span>
                      <button className="modal-btn modal-btn--danger" style={{ padding: '4px 8px', fontSize: '12px', flexShrink: 0, marginLeft: '8px' }} onClick={async () => { const updated = (prefs.feedFolders || []).filter((_: any, i: number) => i !== idx); await updatePrefs({ feedFolders: updated }); }}>Remove</button>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input type="text" id="new-feed-folder" placeholder="C:\Users\...\Downloads" style={{ ...inp, flex: 1, width: 'auto' }} />
                  <button className="modal-btn modal-btn--secondary" onClick={async () => { try { const r = await fetch('/api/browse-folders-native'); const d = await r.json(); if (d.path) (document.getElementById('new-feed-folder') as HTMLInputElement).value = d.path; else if (d.error) alert(d.error); } catch {} }}>Browse</button>
                  <button className="modal-btn modal-btn--primary" onClick={async () => { const input = document.getElementById('new-feed-folder') as HTMLInputElement; const val = input.value.trim(); if (!val) return; const current = prefs.feedFolders || []; if (current.includes(val)) { if (window.toast) window.toast('Folder already added'); return; } await updatePrefs({ feedFolders: [...current, val] }); input.value = ''; }}>Add</button>
                </div>
              </div>
              {/* Private */}
              <div>
                <h4 style={{ margin: '0 0 6px', color: 'var(--tx)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <i className="icon-lock" style={{ fontSize: '14px' }} /> Private
                </h4>
                <p style={{ fontSize: '13px', color: 'var(--tx3)', marginBottom: '12px' }}>Files added here are encrypted to your vault and source files securely shredded. Enter vault password to authorize.</p>
                <div style={{ marginBottom: '12px' }}>
                  {(prefs.privateFeedFolders || []).map((folder: string, idx: number) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg3)', padding: '10px', borderRadius: '6px', marginBottom: '6px' }}>
                      <span style={{ fontSize: '14px', color: 'var(--tx)', wordBreak: 'break-all', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <i className="icon-lock" style={{ fontSize: '12px', color: 'var(--tx3)', flexShrink: 0 }} />{folder}
                      </span>
                      <button className="modal-btn modal-btn--danger" style={{ padding: '4px 8px', fontSize: '12px', flexShrink: 0, marginLeft: '8px' }} onClick={async () => { const updated = (prefs.privateFeedFolders || []).filter((_: any, i: number) => i !== idx); await updatePrefs({ privateFeedFolders: updated }); }}>Remove</button>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input type="text" id="new-private-feed-folder" placeholder="C:\Users\...\Private" style={{ ...inp, flex: 1, width: 'auto' }} />
                    <button className="modal-btn modal-btn--secondary" onClick={async () => { try { const r = await fetch('/api/browse-folders-native'); const d = await r.json(); if (d.path) (document.getElementById('new-private-feed-folder') as HTMLInputElement).value = d.path; else if (d.error) alert(d.error); } catch {} }}>Browse</button>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input type="password" id="new-private-feed-password" placeholder="Vault password" style={{ ...inp, flex: 1, width: 'auto' }} />
                    <button className="modal-btn modal-btn--primary" onClick={async () => {
                      const folderInput = document.getElementById('new-private-feed-folder') as HTMLInputElement;
                      const pwInput = document.getElementById('new-private-feed-password') as HTMLInputElement;
                      const folderVal = folderInput.value.trim(); const pw = pwInput.value;
                      if (!folderVal || !pw) return;
                      const current = prefs.privateFeedFolders || [];
                      if (current.includes(folderVal)) { if (window.toast) window.toast('Folder already added'); return; }
                      try {
                        const r = await fetch('/api/feed-folders/verify-vault', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
                        const d = await r.json();
                        if (!d.ok) { if (window.toast) window.toast(d.error || 'Incorrect vault password'); else alert(d.error || 'Incorrect vault password'); return; }
                        await updatePrefs({ privateFeedFolders: [...current, folderVal] });
                        folderInput.value = ''; pwInput.value = '';
                      } catch { if (window.toast) window.toast('Error verifying vault password'); }
                    }}>Add</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ComfyUI Path */}
          <div style={card}>
            <h3 style={{ ...cardH, marginBottom: '8px' }}>ComfyUI Folder</h3>
            <p style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '16px' }}>
              Set your local ComfyUI install folder. Models, VAEs, and LoRAs will be auto-discovered from its standard directory layout.
            </p>
            <div style={{ display: 'flex', gap: '8px', marginBottom: comfyuiPath ? '10px' : '0' }}>
              <input value={comfyuiPath} onInput={(e: any) => setComfyuiPath(e.target.value)} placeholder="e.g. C:\ComfyUI" style={{ ...inp, flex: 1, width: 'auto' }} />
              <button type="button" onClick={async () => { try { const r = await fetch('/api/browse-folders-native'); const d = await r.json(); if (d.path) setComfyuiPath(d.path); else if (d.error) alert(d.error); } catch {} }}
                style={{ background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px 14px', cursor: 'pointer', whiteSpace: 'nowrap' }}>Browse…</button>
              <button type="button" onClick={() => updatePrefs({ comfyuiPath })}
                style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '6px', padding: '10px 18px', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>Save</button>
            </div>
            {comfyuiPath && (
              <div style={{ fontSize: '11px', color: 'var(--tx3)', lineHeight: '1.9' }}>
                Models: <code>{comfyuiPath}/models/checkpoints</code><br />
                VAEs: <code>{comfyuiPath}/models/vae</code><br />
                LoRAs: <code>{comfyuiPath}/models/loras</code>
              </div>
            )}
          </div>
        </>}

        {/* ══ Cache ═══════════════════════════════════════════════════ */}
        {activeTab === 'cache' && (() => {
          const rowStyle: JSX.CSSProperties = { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0', borderBottom: '1px solid var(--brd)' };
          const lastRowStyle: JSX.CSSProperties = { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0' };
          const btnSm = (color = 'var(--ac)'): JSX.CSSProperties => ({ background: color, color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 10px', fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap' as const });
          const btnOutline: JSX.CSSProperties = { background: 'none', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap' };
          const lbl: JSX.CSSProperties = { flex: 1, fontSize: '13px', fontWeight: 500 };
          const progBar = (pct: number) => (
            <div style={{ height: '3px', background: 'var(--bg3)', borderRadius: '2px', overflow: 'hidden', marginTop: '3px' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: 'var(--ac)', transition: 'width 0.4s' }} />
            </div>
          );

          return <>
            {/* Sync & Background Tasks */}
            <div style={card}>
              <h3 style={{ ...cardH, marginBottom: '16px' }}>Sync &amp; Background Tasks</h3>

              {/* Video Thumbnails */}
              <div>
                <div style={rowStyle}>
                  <span style={lbl}>Video Thumbnails</span>
                  {genRunning ? (
                    <>
                      <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>{genStatus}</span>
                      <button style={btnSm('var(--bg3)')} onClick={toggleGenThumbs} title="Stop">Stop</button>
                    </>
                  ) : (
                    <button style={btnSm()} onClick={toggleGenThumbs}>Generate All</button>
                  )}
                </div>
                {genRunning && genProgress > 0 && progBar(genProgress)}
              </div>

              {/* Link Metadata */}
              <div style={rowStyle}>
                <span style={lbl}>Link Metadata</span>
                {scrapers.bmMeta.running ? (
                  <>
                    <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>
                      {scrapers.bmMeta.total ? `${scrapers.bmMeta.done}/${scrapers.bmMeta.total}` : 'running…'}
                    </span>
                    <button style={btnSm('var(--bg3)')} onClick={() => scraperAction('/api/links/stop-scraping')}>Stop</button>
                  </>
                ) : (
                  <>
                    <button style={btnOutline} onClick={() => scraperAction('/api/links/rescrape-all')}>Rescrape all</button>
                    <button style={btnSm()} onClick={() => scraperAction('/api/links/start-scraping')}>Start</button>
                  </>
                )}
              </div>

              {/* Link Thumbnails */}
              <div style={rowStyle}>
                <span style={lbl}>Link Thumbnails</span>
                {scrapers.bmThumbs.running ? (
                  <>
                    <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>
                      {scrapers.bmThumbs.total ? `${scrapers.bmThumbs.done}/${scrapers.bmThumbs.total}` : 'running…'}
                    </span>
                    <button style={btnSm('var(--bg3)')} onClick={() => scraperAction('/api/links/stop-generating')}>Stop</button>
                  </>
                ) : (
                  <button style={btnSm()} onClick={() => scraperAction('/api/links/generate-all')}>Start</button>
                )}
              </div>

              {/* Auto Categorize */}
              <div style={rowStyle}>
                <span style={lbl}>Auto Categorize</span>
                {autoCatResult && <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>{autoCatResult}</span>}
                <button style={btnSm(autoCatLoading ? 'var(--bg3)' : undefined)} disabled={autoCatLoading}
                  onClick={() => openCategorizeModal('uncategorized')}>
                  {autoCatLoading ? 'Loading…' : 'Run'}
                </button>
              </div>

              {/* Recategorize All */}
              <div style={rowStyle}>
                <span style={lbl}>Recategorize All</span>
                {recatAllResult && <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>{recatAllResult}</span>}
                <button style={btnSm(recatAllLoading ? 'var(--bg3)' : '#c07800')} disabled={recatAllLoading}
                  onClick={() => openCategorizeModal('all')}>
                  {recatAllLoading ? 'Loading…' : 'Run'}
                </button>
              </div>

              {/* Actor Data */}
              <div style={rowStyle}>
                <span style={lbl}>Actor Data</span>
                <button style={btnSm()} onClick={() => scraperAction('/api/actors/scrape-missing')}>Scrape missing</button>
              </div>

              {/* Local Videos */}
              <div style={lastRowStyle}>
                <span style={lbl}>Local Videos</span>
                <button style={btnSm(rescanning ? 'var(--bg3)' : undefined)} disabled={rescanning}
                  onClick={async () => {
                    setRescanning(true);
                    try { await fetch('/api/videos/rescan', { method: 'POST' }); await loadVideos(); if (window.toast) window.toast('Rescan complete'); } catch {}
                    setRescanning(false);
                  }}>
                  {rescanning ? 'Scanning…' : 'Rescan'}
                </button>
              </div>
            </div>

            {/* Clear Data */}
            <div style={card}>
              <h3 style={{ ...cardH, marginBottom: '6px' }}>Clear Data</h3>
              <p style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '16px' }}>Permanently remove cached or stored data. These actions cannot be undone.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {([
                  { label: 'All Thumbnails', desc: 'Deletes thumbnail images and cache entries', action: async () => { if (!confirm('Delete all thumbnails?')) return; await fetch('/api/thumbs/clear', { method: 'POST' }); if (window.toast) window.toast('Thumbnails cleared'); } },
                  { label: 'All Favourites', desc: 'Removes all videos from your favourites list', action: async () => { if (!confirm('Clear all favourites?')) return; await fetch('/api/favourites', { method: 'DELETE' }); if (window.toast) window.toast('Favourites cleared'); } },
                  { label: 'Recently Watched', desc: 'Clears the watch history', action: async () => { if (!confirm('Clear watch history?')) return; await fetch('/api/history', { method: 'DELETE' }); if (window.toast) window.toast('History cleared'); } },
                ] as { label: string; desc: string; action: () => Promise<void> }[]).map(item => (
                  <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px', background: 'var(--bg3)', borderRadius: '6px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 500 }}>{item.label}</div>
                      <div style={{ fontSize: '11px', color: 'var(--tx3)', marginTop: '2px' }}>{item.desc}</div>
                    </div>
                    <button style={{ ...btnSm('#c0392b'), padding: '5px 12px' }} onClick={item.action}>Clear</button>
                  </div>
                ))}
              </div>
            </div>
          </>;
        })()}

        {/* ══ Security ════════════════════════════════════════════════ */}
        {activeTab === 'security' && <>
          {/* Vault */}
          <div style={card}>
            <h3 style={cardH}>Vault Settings</h3>
            <div style={fieldRow}>
              <label style={label}>Change Password</label>
              <input type="password" placeholder="Old Password" value={oldPw} onInput={(e) => setOldPw((e.target as HTMLInputElement).value)} style={{ ...inp, marginBottom: '8px' }} />
              <input type="password" placeholder="New Password" value={newPw} onInput={(e) => setNewPw((e.target as HTMLInputElement).value)} style={{ ...inp, marginBottom: '8px' }} />
              <input type="password" placeholder="Confirm New Password" value={newPw2} onInput={(e) => setNewPw2((e.target as HTMLInputElement).value)} style={{ ...inp, marginBottom: '8px' }} />
              <input type="password" placeholder="Duress / self-destruct password (optional)" value={duressPw} onInput={(e) => setDuressPw((e.target as HTMLInputElement).value)} style={{ ...inp, marginBottom: '6px' }} />
              <p style={{ fontSize: '11px', color: 'var(--tx3)', margin: '0 0 12px' }}>If set, entering this password at the unlock screen silently wipes the entire vault while showing a normal "wrong password" message.</p>
              {error && <div style={{ color: '#e84040', fontSize: '0.85rem', marginBottom: '8px' }}>{error}</div>}
              <button class="modal-btn modal-btn--primary" onClick={handleChangePw} style={{ width: '100%' }} disabled={loading}>{loading ? 'Processing…' : 'Change Password'}</button>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--brd)', margin: '16px 0' }} />

            {/* Auto-lock timeout */}
            <div style={fieldRow}>
              <label style={label}>Auto-lock timeout</label>
              <p style={{ fontSize: '12px', color: 'var(--tx3)', margin: '0 0 8px' }}>Minutes of inactivity before the vault locks itself. Set to 0 to never auto-lock.</p>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input type="number" min={0} max={1440} value={vaultTimeout} title="Auto-lock timeout in minutes" placeholder="5"
                  onInput={(e) => setVaultTimeout(parseInt((e.target as HTMLInputElement).value, 10) || 0)}
                  style={{ ...inp, maxWidth: '120px' }} />
                <span style={{ color: 'var(--tx3)', fontSize: '13px' }}>min</span>
                <button class="modal-btn" onClick={() => handleSaveTimeout(vaultTimeout)} disabled={loading}>Save</button>
              </div>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--brd)', margin: '16px 0' }} />
            <div>
              <label style={{ ...label, color: '#e84040' }}>Danger Zone</label>
              <p style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '10px' }}>Permanently delete the vault and all its contents. This action cannot be undone.</p>
              {!showDeleteConfirm ? (
                <button className="modal-btn" onClick={() => setShowDeleteConfirm(true)} style={{ width: '100%', borderColor: '#e84040', color: '#e84040' }}>Delete Vault</button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <p style={{ fontSize: '12px', color: '#e84040', margin: 0 }}>Type "DELETE" to confirm:</p>
                  <input type="text" value={deleteConfirmText} onInput={(e) => setDeleteConfirmText((e.target as HTMLInputElement).value)} style={{ ...inp }} />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="modal-btn modal-btn--primary" onClick={doVaultDeleteVault} style={{ flex: 1, background: '#e84040' }} disabled={deleteConfirmText !== 'DELETE' || loading}>Confirm Delete</button>
                    <button className="modal-btn" onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); }} style={{ flex: 1 }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Panic Button */}
          <div style={card}>
            <h3 style={{ ...cardH, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <i className="icon-alert-triangle" /> Panic Button
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--tx3)', marginBottom: '16px' }}>
              Configure keyboard shortcuts or mouse buttons that instantly close the tab and shut down the server. You can set multiple triggers.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={label}>Active Triggers</label>
                <div id="panic-keys-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', minHeight: '40px' }}>
                  {(() => {
                    try {
                      const keys = JSON.parse(localStorage.getItem('panicKeys') || '[]');
                      if (keys.length === 0) return <span style={{ color: 'var(--tx3)', fontStyle: 'italic' }}>No triggers set</span>;
                      return keys.map((key: string, idx: number) => (
                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px 14px', fontFamily: 'monospace', fontSize: '0.9rem', color: 'var(--ac)' }}>
                          <span>{key}</span>
                          <button className="modal-btn modal-btn--danger" style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                            onClick={() => { try { const k = JSON.parse(localStorage.getItem('panicKeys') || '[]'); k.splice(idx, 1); localStorage.setItem('panicKeys', JSON.stringify(k)); const list = document.getElementById('panic-keys-list'); if (list) list.style.opacity = '0.5'; setTimeout(() => window.location.reload(), 100); } catch {} }}>
                            Remove
                          </button>
                        </div>
                      ));
                    } catch { return <span style={{ color: 'var(--tx3)', fontStyle: 'italic' }}>No triggers set</span>; }
                  })()}
                </div>
              </div>
              <div>
                <label style={label}>Add New Trigger (keyboard or mouse)</label>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <input type="text" id="panic-key-capture" placeholder="Click to listen… (press key or mouse button)" readOnly
                    onFocus={(e) => {
                      const input = e.currentTarget;
                      input.value = 'Listening for keyboard/mouse...';
                      input.style.color = 'var(--ac)';
                      let captured = false;
                      const handleKey = (ev: KeyboardEvent) => {
                        if (captured) return; captured = true; ev.preventDefault(); ev.stopPropagation();
                        const parts: string[] = [];
                        if (ev.ctrlKey) parts.push('Ctrl'); if (ev.shiftKey) parts.push('Shift'); if (ev.altKey) parts.push('Alt'); if (ev.metaKey) parts.push('Meta');
                        const key = ev.key; const isModifier = key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta';
                        if (!isModifier) { if (key === ' ') parts.push('Space'); else if (key.length === 1) parts.push(key.toUpperCase()); else parts.push(key); }
                        const combo = parts.join('+');
                        if (combo) savePanicKey(combo);
                        cleanup();
                      };
                      const handleMouse = (ev: MouseEvent) => {
                        if (captured) return; captured = true; ev.preventDefault(); ev.stopPropagation();
                        const parts: string[] = [];
                        if (ev.ctrlKey) parts.push('Ctrl'); if (ev.shiftKey) parts.push('Shift'); if (ev.altKey) parts.push('Alt'); if (ev.metaKey) parts.push('Meta');
                        const buttonNames: { [key: number]: string } = { 0: 'Left', 1: 'Middle', 2: 'Right', 3: 'Mouse4', 4: 'Mouse5' };
                        const btnName = buttonNames[ev.button] || `Mouse${ev.button}`;
                        if (ev.button !== 0) parts.push(btnName);
                        const combo = parts.join('+').replace('+Left', '').trim();
                        if (combo) savePanicKey(combo.startsWith('Mouse') ? combo : '');
                        cleanup();
                      };
                      const savePanicKey = (key: string) => {
                        if (!key) return;
                        try { const keys = JSON.parse(localStorage.getItem('panicKeys') || '[]'); if (!keys.includes(key)) { keys.push(key); localStorage.setItem('panicKeys', JSON.stringify(keys)); } input.value = key; input.blur(); } catch {}
                      };
                      const cleanup = () => { document.removeEventListener('keydown', handleKey); document.removeEventListener('mousedown', handleMouse); };
                      document.addEventListener('keydown', handleKey, { once: false });
                      document.addEventListener('mousedown', handleMouse, { once: false });
                    }}
                    onBlur={(e) => { if (e.currentTarget.value === 'Listening for keyboard/mouse...' || !e.currentTarget.value) e.currentTarget.value = ''; e.currentTarget.style.color = 'var(--tx)'; }}
                    style={{ flex: 1, background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px', fontFamily: 'monospace', cursor: 'pointer', caretColor: 'transparent' }}
                  />
                  <button className="modal-btn modal-btn--danger" style={{ padding: '10px 16px', flexShrink: 0 }}
                    onClick={() => { localStorage.setItem('panicKeys', '[]'); const list = document.getElementById('panic-keys-list'); if (list) list.style.opacity = '0.5'; setTimeout(() => window.location.reload(), 100); }}>
                    Clear All
                  </button>
                </div>
              </div>
              <div>
                <label style={label}>Quick Presets</label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {[{ label: 'Mouse4 (Back)', value: 'Mouse4' }, { label: 'Mouse5 (Forward)', value: 'Mouse5' }, { label: 'Middle Click', value: 'Mouse1' }, { label: 'Ctrl+Shift+Escape', value: 'Ctrl+Shift+Escape' }, { label: 'F12', value: 'F12' }].map(preset => (
                    <button key={preset.value} className="modal-btn" style={{ fontSize: '0.82rem', padding: '6px 12px' }}
                      onClick={() => { try { const keys = JSON.parse(localStorage.getItem('panicKeys') || '[]'); if (!keys.includes(preset.value)) { keys.push(preset.value); localStorage.setItem('panicKeys', JSON.stringify(keys)); } window.location.reload(); } catch {} }}>
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--tx3)', borderTop: '1px solid var(--brd)', paddingTop: '12px' }}>
                <strong>How it works:</strong> When any trigger is activated, the server shuts down immediately and the browser tab closes. Bindings are stored in localStorage only.
              </div>
            </div>
          </div>

          {/* Network Access (main device only) */}
          {isMainDevice && (
            <div style={card}>
              <h3 style={cardH}>Network Access</h3>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                  <div style={{ fontWeight: 'bold' }}>{netEnabled ? 'Enabled' : 'Disabled'}</div>
                  <div style={{ fontSize: '12px', color: 'var(--tx3)' }}>{netEnabled ? 'Other devices on the network can connect' : 'Server only accepts connections from this machine'}</div>
                </div>
                <button class={`modal-btn ${netEnabled ? 'modal-btn--primary' : ''}`} onClick={toggleNetwork}>{netEnabled ? 'Disable' : 'Enable'}</button>
              </div>
              {netEnabled && connectUrls.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    {connectUrls.map((e, i) => (
                      <button key={i} onClick={() => setConnectIdx(i)} style={{ padding: '4px 10px', borderRadius: '999px', fontSize: '0.75rem', border: '1px solid var(--brd)', background: i === connectIdx ? 'var(--ac)' : 'var(--bg3)', color: i === connectIdx ? '#fff' : 'var(--tx2)' }}>{e.name}</button>
                    ))}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--tx2)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {connectUrls[connectIdx]?.url}
                    <button onClick={() => { const u = connectUrls[connectIdx]; if (u) verifyUrl(connectIdx, u.url); }} title="Re-verify reachability" style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx3)', fontSize: '0.7rem', padding: '1px 5px', borderRadius: '4px', cursor: 'pointer' }}>↻</button>
                  </div>
                  {(() => {
                    const st = verifyStatus[connectIdx];
                    if (!st) return null;
                    if (st.checking) return <div style={{ fontSize: '0.7rem', color: 'var(--tx3)' }}>Verifying URL reachability…</div>;
                    if (st.ok) return <div style={{ fontSize: '0.7rem', color: '#4ade80' }}>✓ Verified reachable (remote devices should be able to connect)</div>;
                    if (st.error) return <div style={{ fontSize: '0.7rem', color: '#f87171' }}>✗ {st.error} — the URL may be incorrect for remote devices</div>;
                    return null;
                  })()}
                  <canvas ref={qrRef} style={{ background: '#fff', padding: '10px', borderRadius: '8px', marginTop: '6px' }} />
                </div>
              )}
            </div>
          )}
        </>}

      </div>
    </div>

    {catModal && (
      <CategorizeModal
        mode={catModal.mode}
        uncategorized={catModal.uncategorized}
        categorized={catModal.categorized}
        categories={catModal.categories}
        confirming={catModal.confirming}
        onConfirm={handleCatConfirm}
        onCancel={() => setCatModal(null)}
      />
    )}
    </>
  );
};
