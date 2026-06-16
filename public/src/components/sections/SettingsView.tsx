import { appPrefs, updatePrefs, loadVideos, sidebarSide, sidebarReveal } from '../../store';
import { useState, useEffect, useRef } from 'preact/hooks';
import { PERSONALITIES, Personality } from '../../personalities';
import { JSX } from 'preact';
import { ensureQRCode } from '../../utils';
import { CategorizeModal, PlanItem, Move } from '../UI/CategorizeModal';
import { pluginsList, isPluginEnabled, loadPlugins, togglePlugin } from '../../plugins';

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
  { id: 'plugins',    label: 'Plugins' },
];

export const SettingsView = () => {
  const prefs = appPrefs.value;

  const [activeTab, setActiveTab] = useState('folders');

  const [commentPrompt, setCommentPrompt] = useState(prefs.aiCommentMasterPrompt || '');
  const [replyPrompt, setReplyPrompt] = useState(prefs.aiReplyMasterPrompt || '');
  const [anthropicKey, setAnthropicKey] = useState(prefs.anthropicApiKey || '');
  const [whisperEnabled, setWhisperEnabled] = useState(prefs.whisperEnabled ?? true);
  const [whisperModel, setWhisperModel] = useState(prefs.whisperModel || 'base');
  const [whisperLanguage, setWhisperLanguage] = useState(prefs.whisperLanguage || 'auto');
  const [downloadingModels, setDownloadingModels] = useState<Set<string>>(new Set());
  const [hiddenCats, setHiddenCats] = useState<string[]>([]);

  const [connectUrls, setConnectUrls] = useState<ConnectUrl[]>([]);
  const [connectIdx, setConnectIdx] = useState(0);
  const [netEnabled, setNetEnabled] = useState(!!prefs.networkEnabled);

  const [verifyStatus, setVerifyStatus] = useState<Record<number, { ok?: boolean; error?: string; checking?: boolean }>>({});

  const [storagePaths, setStoragePaths] = useState<{
    cacheDir: string; dbDir: string; vaultDir: string;
    defaults: { cacheDir: string; dbDir: string; vaultDir: string };
    custom: { cacheDir: string; dbDir: string; vaultDir: string };
    exists: { cacheDir: boolean; dbDir: boolean; vaultDir: boolean };
  } | null>(null);
  const [pathInputs, setPathInputs] = useState({ cacheDir: '', dbDir: '', vaultDir: '' });
  const [pathSaved, setPathSaved] = useState(false);

  const [comfyuiUrl, setComfyuiUrl] = useState(prefs.comfyuiUrl || 'http://127.0.0.1:8188');
  const [comfyuiWorkflowJson, setComfyuiWorkflowJson] = useState(prefs.comfyuiWorkflowJson || '');
  const [comfyuiPositiveNodeId, setComfyuiPositiveNodeId] = useState(prefs.comfyuiPositiveNodeId || '');

  const [genRunning, setGenRunning] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [genStatus, setGenStatus] = useState('');
  const [reencRunning, setReencRunning] = useState(false);
  const [reencStatus, setReencStatus] = useState('');

  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [selfDestructPw, setSelfDestructPw] = useState('');
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

  useEffect(() => {
    loadPlugins();
  }, []);

  const [openrouterKey, setOpenrouterKey] = useState(prefs.openrouterApiKey || '');
  const [openrouterKeySaved, setOpenrouterKeySaved] = useState(false);

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
    fetch('/api/settings/paths').then(r => r.json()).then(data => {
      setStoragePaths(data);
      setPathInputs({ cacheDir: data.custom.cacheDir, dbDir: data.custom.dbDir, vaultDir: data.custom.vaultDir });
    }).catch(() => {});
  }, []);

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
    setAnthropicKey(prefs.anthropicApiKey || '');
    setNetEnabled(!!prefs.networkEnabled);
    setOpenrouterKey(prefs.openrouterApiKey || '');
    setWhisperEnabled(prefs.whisperEnabled ?? true);
    setWhisperModel(prefs.whisperModel || 'base');
    setWhisperLanguage(prefs.whisperLanguage || 'auto');
  }, [prefs]);

  useEffect(() => {
    const poll = async () => {
      try {
        const [bmMetaRes, bmThRes, reencRes] = await Promise.all([
          fetch('/api/links/scrape-status'),
          fetch('/api/links/thumb-status'),
          fetch('/api/reencode/poll'),
        ]);
        const bm   = bmMetaRes.ok ? await bmMetaRes.json() : { running: false };
        const bt   = bmThRes.ok   ? await bmThRes.json()   : { running: false };
        const reenc = reencRes.ok ? await reencRes.json()  : { running: false };
        setScrapers({ bmMeta: bm, bmThumbs: bt });
        setReencRunning(!!reenc.running);
        if (reenc.running) {
          const pct = reenc.total > 0 ? Math.round(reenc.done / reenc.total * 100) : 0;
          setReencStatus(`${reenc.done}/${reenc.total} (${pct}%)${reenc.current ? ' — ' + reenc.current : ''}`);
        }
      } catch {}
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, []);

  const scraperAction = (url: string, method = 'POST') => fetch(url, { method }).catch(() => {});

  const openCategorizeModal = async (mode: 'uncategorized' | 'all') => {
    const setL = mode === 'all' ? setRecatAllLoading : setAutoCatLoading;
    setL(true);
    try {
      const r = await fetch('/api/videos/categorize-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
      const { uncategorized, categorized, categories } = await r.json();
      setCatModal({ mode, uncategorized: uncategorized || [], categorized: categorized || [], categories, confirming: false });
    } catch {
      if (mode === 'all') setRecatAllResult('error'); else setAutoCatResult('error');
    } finally { setL(false); }
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
  const handleSaveAnthropic = () => { updatePrefs({ anthropicApiKey: anthropicKey }); alert('Anthropic API key saved!'); };

  const handleSaveHidden = async () => {
    const r = await fetch('/api/settings/hidden', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: hiddenCats.join('\n') }) });
    if (r.ok) alert('Hidden folders saved!'); else alert('Save failed');
  };

  const toggleNetwork = async () => { const newVal = !netEnabled; setNetEnabled(newVal); updatePrefs({ networkEnabled: newVal }); };

  const isMainDevice = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  const handleChangePw = async () => {
    setError('');
    if (!oldPw || !newPw || !newPw2) { setError('All fields required'); return; }
    if (newPw !== newPw2) { setError('New passwords do not match'); return; }
    if (newPw.length < 6) { setError('New password must be at least 6 chars'); return; }
    if (selfDestructPw && (selfDestructPw.length < 6 || selfDestructPw === newPw)) { setError('Self-destruct password must be 6+ chars and differ from the real one'); return; }
    setLoading(true);
    try {
      const body: Record<string, string> = { oldPw, newPw };
      if (selfDestructPw) body.selfDestructPassword = selfDestructPw;
      const r = await fetch('/api/vault/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Failed to change password'); }
      else { if (window.toast) window.toast('Password changed successfully!'); setOldPw(''); setNewPw(''); setNewPw2(''); setSelfDestructPw(''); }
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
  const wrap: JSX.CSSProperties = { background: 'var(--bg2)', borderRadius: '12px', border: '1px solid var(--brd)', overflow: 'hidden' };
  const sec: JSX.CSSProperties = { padding: '20px 24px', borderBottom: '1px solid var(--brd)' };
  const secLast: JSX.CSSProperties = { padding: '20px 24px' };
  const fieldRow: JSX.CSSProperties = { marginBottom: '16px' };
  const label: JSX.CSSProperties = { display: 'block', marginBottom: '8px', fontWeight: 'bold' };
  const inp: JSX.CSSProperties = { width: '100%', boxSizing: 'border-box', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '10px' };
  const secH: JSX.CSSProperties = { margin: '0 0 16px', color: 'var(--ac)' };

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
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px' }}>

        {/* ══ Appearance ══════════════════════════════════════════════ */}
        {activeTab === 'appearance' && (
          <div style={wrap}>
            <div style={sec}>
              <h3 style={{ ...secH, marginBottom: '6px' }}>Theme</h3>
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
            <div style={sec}>
              <h3 style={{ ...secH, marginBottom: '6px' }}>Sidebar</h3>
              <p style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '14px' }}>Choose which side the sidebar docks to and whether it stays visible or only slides out when you hover its edge.</p>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ ...label, marginBottom: '6px' }}>Position</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {([
                    { id: 'left' as const, name: 'Left' },
                    { id: 'right' as const, name: 'Right' },
                  ]).map(o => {
                    const on = (prefs.sidebarSide || 'left') === o.id;
                    return (
                      <button key={o.id} type="button" onClick={() => { sidebarSide.value = o.id; updatePrefs({ sidebarSide: o.id }); }}
                        style={{ flex: 1, padding: '10px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600,
                          background: on ? 'var(--ac)' : 'var(--bg3)', color: on ? '#fff' : 'var(--tx)',
                          border: on ? '1px solid var(--ac)' : '1px solid var(--brd)' }}>{o.name}</button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label style={{ ...label, marginBottom: '6px' }}>Visibility</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {([
                    { id: 'fixed' as const, name: 'Always visible', hint: 'Pinned beside the content' },
                    { id: 'hover' as const, name: 'Reveal on hover', hint: 'Slides out from the edge' },
                  ]).map(o => {
                    const on = (prefs.sidebarReveal || 'fixed') === o.id;
                    return (
                      <button key={o.id} type="button" onClick={() => { sidebarReveal.value = o.id; updatePrefs({ sidebarReveal: o.id }); }}
                        style={{ flex: 1, padding: '10px', borderRadius: '6px', cursor: 'pointer', textAlign: 'left',
                          background: on ? 'var(--ac)' : 'var(--bg3)', color: on ? '#fff' : 'var(--tx)',
                          border: on ? '1px solid var(--ac)' : '1px solid var(--brd)' }}>
                        <div style={{ fontWeight: 600 }}>{o.name}</div>
                        <div style={{ fontSize: '11px', opacity: 0.8 }}>{o.hint}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div style={secLast}>
              <h3 style={{ ...secH, marginBottom: '6px' }}>Bar Layout</h3>
              <p style={{ fontSize: '12px', color: 'var(--tx3)' }}>Right-click any sidebar entry, topbar button, plugin, or the Folders / Tags lists to move it between the sidebar and the topbar. Moved items appear as icons after the search bar.</p>
            </div>
          </div>
        )}

        {/* ══ AI ══════════════════════════════════════════════════════ */}
        {activeTab === 'ai' && (
          <div style={wrap}>

            {/* OpenRouter API Key */}
            <div style={sec}>
              <h3 style={secH}>OpenRouter API Key</h3>
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

            {/* AI Comments */}
            <div style={sec}>
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
            </div>

            {/* Vision Provider */}
            <div style={sec}>
              <h3 style={secH}>Vision Provider</h3>
              <p style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '14px' }}>Image descriptions are generated via Claude (Anthropic). Vision requires a <strong>multimodal</strong> model.</p>
              <div style={fieldRow}>
                <label style={label}>Anthropic API Key</label>
                <input type="password" value={anthropicKey} onInput={(e) => setAnthropicKey((e.target as HTMLInputElement).value)} style={{ ...inp }} />
              </div>
              <button class="modal-btn modal-btn--primary" onClick={handleSaveAnthropic} style={{ width: '100%' }}>Save API Key</button>
            </div>

            {/* ComfyUI */}
            <div style={sec}>
              <h3 style={{ ...secH, marginBottom: '8px' }}>ComfyUI — Send Prompt</h3>
              <p style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '16px' }}>
                Lets "Send Prompt" in AI Prompts queue a generation on your running ComfyUI instance. In ComfyUI,
                open your image workflow and use <strong>Workflow → Export (API)</strong> to save it, then paste
                the JSON below. The prompt text replaces the <code>text</code> input of your positive
                <code>CLIPTextEncode</code> node (auto-detected, or set its node ID explicitly).
              </p>
              <div style={{ marginBottom: '10px' }}>
                <label style={{ fontSize: '12px', color: 'var(--tx2)', display: 'block', marginBottom: '4px' }}>ComfyUI URL</label>
                <input value={comfyuiUrl} onInput={(e: any) => setComfyuiUrl(e.target.value)} placeholder="http://127.0.0.1:8188" style={inp} />
              </div>
              <div style={{ marginBottom: '10px' }}>
                <label style={{ fontSize: '12px', color: 'var(--tx2)', display: 'block', marginBottom: '4px' }}>Workflow (API format JSON)</label>
                <textarea value={comfyuiWorkflowJson} onInput={(e: any) => setComfyuiWorkflowJson(e.target.value)} rows={8} spellcheck={false}
                  placeholder='{"3": {"class_type": "CLIPTextEncode", "inputs": {"text": "...", ...}, "_meta": {"title": "Positive"}}, ...}'
                  style={{ ...inp, fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }} />
              </div>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '12px', color: 'var(--tx2)', display: 'block', marginBottom: '4px' }}>Positive prompt node ID (optional)</label>
                <input value={comfyuiPositiveNodeId} onInput={(e: any) => setComfyuiPositiveNodeId(e.target.value)} placeholder="auto-detect" style={inp} />
              </div>
              <button type="button" onClick={() => updatePrefs({ comfyuiUrl, comfyuiWorkflowJson, comfyuiPositiveNodeId })}
                style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '6px', padding: '10px 18px', cursor: 'pointer', fontWeight: 600 }}>Save</button>
            </div>

            {/* Whisper Subtitles */}
            <div style={secLast}>
              <h3 style={secH}>Whisper Subtitles</h3>
              <p style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '14px' }}>
                Automatically generates subtitles using OpenAI Whisper (<code>pip install openai-whisper</code>).
                When enabled, subtitles are enqueued on video page open and can be batch-generated from Sync.
              </p>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                  <input
                    type="checkbox"
                    checked={whisperEnabled}
                    onChange={(e: any) => {
                      const v = e.target.checked;
                      setWhisperEnabled(v);
                      updatePrefs({ whisperEnabled: v });
                    }}
                  />
                  Enable Whisper subtitle generation
                </label>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '12px', color: 'var(--tx2)', display: 'block', marginBottom: '8px' }}>Model</label>
                {([
                  { id: 'tiny',   size: '~72 MB',   desc: 'fastest, lowest accuracy' },
                  { id: 'base',   size: '~139 MB',  desc: 'good balance (default)' },
                  { id: 'small',  size: '~461 MB',  desc: 'better accuracy' },
                  { id: 'medium', size: '~1.4 GB',  desc: 'high accuracy' },
                  { id: 'large',  size: '~2.9 GB',  desc: 'best accuracy, slowest' },
                  { id: 'turbo',  size: '~809 MB',  desc: 'fast + accurate (recommended)' },
                ] as { id: string; size: string; desc: string }[]).map(m => (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 0', borderBottom: '1px solid var(--brd)', opacity: whisperEnabled ? 1 : 0.5 }}>
                    <input
                      type="radio"
                      name="whisperModel"
                      value={m.id}
                      title={`Use ${m.id} model`}
                      checked={whisperModel === m.id}
                      disabled={!whisperEnabled}
                      onChange={() => setWhisperModel(m.id as typeof whisperModel)}
                    />
                    <span style={{ fontSize: '13px', fontWeight: 600, minWidth: '56px' }}>{m.id}</span>
                    <span style={{ fontSize: '12px', color: 'var(--tx3)', minWidth: '72px' }}>{m.size}</span>
                    <span style={{ fontSize: '12px', color: 'var(--tx2)', flex: 1 }}>{m.desc}</span>
                    <button
                      type="button"
                      disabled={!whisperEnabled || downloadingModels.has(m.id)}
                      onClick={() => {
                        setDownloadingModels(prev => new Set([...prev, m.id]));
                        fetch('/api/whisper/download-model', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: m.id }) })
                          .then(() => setDownloadingModels(prev => { const s = new Set(prev); s.delete(m.id); return s; }))
                          .catch(() => setDownloadingModels(prev => { const s = new Set(prev); s.delete(m.id); return s; }));
                      }}
                      style={{ fontSize: '11px', padding: '3px 10px', background: downloadingModels.has(m.id) ? 'var(--bg3)' : 'var(--bg2)', color: downloadingModels.has(m.id) ? 'var(--tx3)' : 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px', cursor: whisperEnabled && !downloadingModels.has(m.id) ? 'pointer' : 'default', whiteSpace: 'nowrap' }}
                    >
                      {downloadingModels.has(m.id) ? 'Downloading…' : 'Download'}
                    </button>
                  </div>
                ))}
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ fontSize: '12px', color: 'var(--tx2)', display: 'block', marginBottom: '4px' }}>
                  Language <span style={{ color: 'var(--tx3)' }}>(leave "auto" to detect automatically)</span>
                </label>
                <input
                  type="text"
                  value={whisperLanguage}
                  disabled={!whisperEnabled}
                  placeholder="auto"
                  onInput={(e: any) => setWhisperLanguage(e.target.value)}
                  style={{ ...inp, width: '140px', opacity: whisperEnabled ? 1 : 0.5 }}
                />
                <span style={{ fontSize: '11px', color: 'var(--tx3)', marginLeft: '8px' }}>
                  ISO 639-1 code: en, it, fr, de, ja, zh, es, …
                </span>
              </div>

              <button
                type="button"
                disabled={!whisperEnabled}
                onClick={() => {
                  updatePrefs({ whisperEnabled, whisperModel: whisperModel as any, whisperLanguage });
                  if (window.toast) window.toast('Whisper settings saved');
                }}
                style={{ background: whisperEnabled ? 'var(--ac)' : 'var(--bg3)', color: whisperEnabled ? '#fff' : 'var(--tx3)', border: 'none', borderRadius: '6px', padding: '10px 18px', cursor: whisperEnabled ? 'pointer' : 'default', fontWeight: 600 }}
              >Save</button>
            </div>

          </div>
        )}

        {/* ══ Folders ═════════════════════════════════════════════════ */}
        {activeTab === 'folders' && (
          <div style={wrap}>

            {/* Folder Display */}
            <div style={sec}>
              <h3 style={{ ...secH, marginBottom: '8px' }}>Folder Display</h3>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '14px' }}>
                <input type="checkbox" checked={!!prefs.hideEmptyFolders} onChange={(e) => updatePrefs({ hideEmptyFolders: (e.currentTarget as HTMLInputElement).checked })} style={{ width: '16px', height: '16px' }} />
                Hide folders and subfolders with 0 videos
              </label>
            </div>

            {/* Source Folders */}
            <div style={sec}>
              <h3 style={{ ...secH, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
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
            <div style={sec}>
              <h3 style={{ ...secH, display: 'flex', alignItems: 'center', gap: '8px' }}>
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

            {/* Storage Paths */}
            <div style={secLast}>
              <h3 style={{ ...secH, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <i className="icon-database" /> Storage Paths
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--tx3)', marginBottom: '16px' }}>
                Override where cache, database, and vault files are stored. Applied to all profiles. Requires a server restart to take effect. If the configured folder is deleted, the default path is used.
              </p>
              {storagePaths && (() => {
                const browse = async (key: 'cacheDir' | 'dbDir' | 'vaultDir') => {
                  try {
                    const r = await fetch('/api/browse-folders-native');
                    const d = await r.json();
                    if (d.path) setPathInputs(prev => ({ ...prev, [key]: d.path }));
                    else if (d.error) alert(d.error);
                  } catch {}
                };
                const savePath = async (key: 'cacheDir' | 'dbDir' | 'vaultDir') => {
                  const val = pathInputs[key].trim();
                  try {
                    const r = await fetch('/api/settings/paths', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [key]: val }) });
                    const d = await r.json();
                    if (d.ok) {
                      setPathSaved(true);
                      if (window.toast) window.toast('Saved — restart server to apply');
                      setTimeout(() => setPathSaved(false), 3000);
                      const r2 = await fetch('/api/settings/paths');
                      const d2 = await r2.json();
                      setStoragePaths(d2);
                      setPathInputs({ cacheDir: d2.custom.cacheDir, dbDir: d2.custom.dbDir, vaultDir: d2.custom.vaultDir });
                    } else if (d.error) { if (window.toast) window.toast(d.error); }
                  } catch {}
                };
                const rows: { key: 'cacheDir' | 'dbDir' | 'vaultDir'; label: string; hint: string }[] = [
                  { key: 'cacheDir', label: 'Cache Folder', hint: 'Thumbnails, favourites, ratings, history and other cached data.' },
                  { key: 'dbDir',    label: 'Database Folder', hint: 'SQLite database files for all profiles.' },
                  { key: 'vaultDir', label: 'Vault / Hidden Folder', hint: 'Encrypted vault storage (videos/hidden by default).' },
                ];
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {rows.map(({ key, label, hint }) => {
                      const isDefault = !storagePaths.custom[key];
                      const active = storagePaths[key];
                      return (
                        <div key={key}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--tx)' }}>{label}</span>
                            {isDefault
                              ? <span style={{ fontSize: '11px', color: 'var(--tx3)', background: 'var(--bg3)', padding: '1px 6px', borderRadius: '4px' }}>default</span>
                              : <span style={{ fontSize: '11px', color: 'var(--ac)', background: 'var(--bg3)', padding: '1px 6px', borderRadius: '4px' }}>custom</span>
                            }
                            {!storagePaths.exists[key] && (
                              <span style={{ fontSize: '11px', color: '#e05', background: 'rgba(220,0,50,0.1)', padding: '1px 6px', borderRadius: '4px' }}>not found</span>
                            )}
                          </div>
                          <p style={{ fontSize: '12px', color: 'var(--tx3)', margin: '0 0 6px' }}>{hint}</p>
                          <div style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '6px', wordBreak: 'break-all' }}>
                            Active: <code style={{ color: 'var(--tx2)' }}>{active}</code>
                          </div>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <input
                              value={pathInputs[key]}
                              onInput={(e: any) => setPathInputs(prev => ({ ...prev, [key]: e.target.value }))}
                              placeholder={storagePaths.defaults[key]}
                              style={{ ...inp, flex: 1, width: 'auto', fontSize: '13px' }}
                            />
                            <button className="modal-btn modal-btn--secondary" onClick={() => browse(key)}>Browse…</button>
                            {!isDefault && (
                              <button className="modal-btn modal-btn--danger" style={{ padding: '6px 10px', fontSize: '12px' }}
                                onClick={() => setPathInputs(prev => ({ ...prev, [key]: '' }))}>Reset</button>
                            )}
                            <button className="modal-btn modal-btn--primary" onClick={() => savePath(key)}>Save</button>
                          </div>
                        </div>
                      );
                    })}
                    {pathSaved && (
                      <p style={{ fontSize: '13px', color: 'var(--ac)', margin: '0' }}>Saved — restart the server to apply changes.</p>
                    )}
                  </div>
                );
              })()}
            </div>

          </div>
        )}

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

          return (
            <div style={wrap}>
              {/* Sync & Background Tasks */}
              <div style={sec}>
                <h3 style={{ ...secH, marginBottom: '16px' }}>Sync &amp; Background Tasks</h3>

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

                <div style={rowStyle}>
                  <span style={lbl}>Re-encode to H.265</span>
                  {reencRunning ? (
                    <>
                      <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>{reencStatus || 'running…'}</span>
                      <button style={btnSm('var(--bg3)')} onClick={() => scraperAction('/api/reencode/stop')}>Stop</button>
                    </>
                  ) : (
                    <button style={btnSm()} onClick={() => scraperAction('/api/reencode/start')}>Re-encode all</button>
                  )}
                </div>

                <div style={rowStyle}>
                  <span style={lbl}>Auto Categorize</span>
                  {autoCatResult && <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>{autoCatResult}</span>}
                  <button style={btnSm(autoCatLoading ? 'var(--bg3)' : undefined)} disabled={autoCatLoading}
                    onClick={() => openCategorizeModal('uncategorized')}>
                    {autoCatLoading ? 'Loading…' : 'Run'}
                  </button>
                </div>

                <div style={rowStyle}>
                  <span style={lbl}>Recategorize All</span>
                  {recatAllResult && <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>{recatAllResult}</span>}
                  <button style={btnSm(recatAllLoading ? 'var(--bg3)' : '#c07800')} disabled={recatAllLoading}
                    onClick={() => openCategorizeModal('all')}>
                    {recatAllLoading ? 'Loading…' : 'Run'}
                  </button>
                </div>

                <div style={rowStyle}>
                  <span style={lbl}>Actor Data</span>
                  <button style={btnSm()} onClick={() => scraperAction('/api/actors/scrape-missing')}>Scrape missing</button>
                </div>

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
              <div style={secLast}>
                <h3 style={{ ...secH, marginBottom: '6px' }}>Clear Data</h3>
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
            </div>
          );
        })()}

        {/* ══ Security ════════════════════════════════════════════════ */}
        {activeTab === 'security' && (
          <div style={wrap}>

            {/* Vault */}
            <div style={sec}>
              <h3 style={secH}>Vault Settings</h3>
              <div style={fieldRow}>
                <label style={label}>Change Password</label>
                <input type="password" placeholder="Old Password" value={oldPw} onInput={(e) => setOldPw((e.target as HTMLInputElement).value)} style={{ ...inp, marginBottom: '8px' }} />
                <input type="password" placeholder="New Password" value={newPw} onInput={(e) => setNewPw((e.target as HTMLInputElement).value)} style={{ ...inp, marginBottom: '8px' }} />
                <input type="password" placeholder="Confirm New Password" value={newPw2} onInput={(e) => setNewPw2((e.target as HTMLInputElement).value)} style={{ ...inp, marginBottom: '8px' }} />
                <input type="password" placeholder="Self-destruct password (optional)" value={selfDestructPw} onInput={(e) => setSelfDestructPw((e.target as HTMLInputElement).value)} style={{ ...inp, marginBottom: '6px' }} />
                <p style={{ fontSize: '11px', color: 'var(--tx3)', margin: '0 0 12px' }}>If set, entering this password at the unlock screen silently wipes the entire vault while showing a normal "wrong password" message.</p>
                {error && <div style={{ color: '#e84040', fontSize: '0.85rem', marginBottom: '8px' }}>{error}</div>}
                <button class="modal-btn modal-btn--primary" onClick={handleChangePw} style={{ width: '100%' }} disabled={loading}>{loading ? 'Processing…' : 'Change Password'}</button>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--brd)', margin: '16px 0' }} />

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
            <div style={isMainDevice ? sec : secLast}>
              <h3 style={{ ...secH, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
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
              <div style={secLast}>
                <h3 style={secH}>Network Access</h3>
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

          </div>
        )}

        {/* ══ Plugins ═════════════════════════════════════════════════ */}
        {activeTab === 'plugins' && (() => {
          const isWidget = (p: typeof pluginsList.value[number]) => p.type === 'widget' || p.location === 'home' || !!p.homeWidget;
          const plugins = pluginsList.value.filter(p => !isWidget(p));
          const widgets = pluginsList.value.filter(isWidget);

          const renderItem = (p: typeof pluginsList.value[number]) => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '8px' }}>
              <div>
                <div style={{ fontSize: '14px', color: 'var(--tx)', fontWeight: 600 }}>{p.name}</div>
                {p.description && <div style={{ fontSize: '12px', color: 'var(--tx3)' }}>{p.description}</div>}
                <div style={{ fontSize: '11px', color: 'var(--tx3)', marginTop: '2px' }}>{p.location === 'sidebar' ? 'Sidebar' : p.location === 'home' || p.type === 'widget' ? 'Home widget' : 'Topbar'}</div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                <input type="checkbox" checked={isPluginEnabled(p.id)} onChange={() => togglePlugin(p.id)} style={{ width: '16px', height: '16px' }} />
                Enabled
              </label>
            </div>
          );

          return (
            <div style={wrap}>
              <div style={secLast}>
                <h3 style={secH}>Plugin Manager</h3>
                <p style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '16px' }}>Enable or disable optional plugins and home-dashboard widgets. Disabled items are hidden from the topbar, sidebar and home dashboard.</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '24px' }}>
                  <div>
                    <h4 style={{ fontSize: '13px', color: 'var(--tx2)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>Plugins</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {plugins.map(renderItem)}
                      {plugins.length === 0 && (
                        <p style={{ fontSize: '12px', color: 'var(--tx3)' }}>No plugins found.</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <h4 style={{ fontSize: '13px', color: 'var(--tx2)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>Widgets</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {widgets.map(renderItem)}
                      {widgets.length === 0 && (
                        <p style={{ fontSize: '12px', color: 'var(--tx3)' }}>No widgets found.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

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
