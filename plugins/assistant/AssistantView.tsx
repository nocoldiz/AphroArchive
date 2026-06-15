import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { currentView, allVideos, categories } from '../../public/src/store';
import { PromptsView } from '../prompts/PromptsView';
import {
  SYSTEM_PROMPTS,
  JAILBREAK_METHODS,
  STORY_GENRES,
  MODELS,
  DEFAULT_SYSTEM,
  COMFY_DEFAULT_URL,
  type SystemPromptKey,
} from '../../public/src/assistantPrompts';
import { quickRandomCharacterPrompt } from '../prompts/characterPrompts';

// ── Types ─────────────────────────────────────────────────────────────

type Role = 'user' | 'assistant' | 'system';
interface Message { role: Role; content: string; }

// ── Simple markdown renderer for assistant messages ───────────────────

function renderText(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\n)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} style={{ background: 'var(--bg3)', padding: '1px 4px', borderRadius: '3px', fontSize: '12px', fontFamily: 'monospace' }}>{part.slice(1, -1)}</code>;
    }
    if (part === '\n') return <br key={i} />;
    return part;
  });
}

// ── Message bubble ────────────────────────────────────────────────────

function Bubble({ msg, onUseAsPrompt }: { msg: Message; onUseAsPrompt: (text: string) => void }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: isUser ? 'flex-end' : 'flex-start',
      marginBottom: '12px',
    }}>
      <div style={{
        maxWidth: '85%',
        padding: '9px 13px',
        borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
        background: isUser ? 'var(--ac)' : 'var(--bg2)',
        color: isUser ? '#fff' : 'var(--tx)',
        border: isUser ? 'none' : '1px solid var(--brd)',
        fontSize: '13px',
        lineHeight: '1.55',
        wordBreak: 'break-word',
        whiteSpace: 'pre-wrap',
      }}>
        {renderText(msg.content)}
      </div>
      {!isUser && msg.content && (
        <div style={{ display: 'flex', gap: '5px', marginTop: '4px', paddingLeft: '2px' }}>
          <button
            onClick={() => navigator.clipboard?.writeText(msg.content)}
            title="Copy to clipboard"
            style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', fontSize: '11px', padding: '1px 5px' }}
          >Copy</button>
          <button
            onClick={() => onUseAsPrompt(msg.content)}
            title="Send to Image Gen as prompt"
            style={{ background: 'none', border: 'none', color: 'var(--ac)', cursor: 'pointer', fontSize: '11px', padding: '1px 5px' }}
          >Use as image prompt</button>
        </div>
      )}
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────

export const AssistantView = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [openrouterModel, setOpenrouterModel] = useState(MODELS[0].id);
  const [streaming, setStreaming] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [includeLibCtx, setIncludeLibCtx] = useState(false);
  const [libSummary, setLibSummary] = useState('');
  const [nsfwEnabled, setNsfwEnabled] = useState(true);
  const [systemMode, setSystemMode] = useState<string>(DEFAULT_SYSTEM);
  const [storyGenre, setStoryGenre] = useState<string>('Any');
  const [workflows, setWorkflows] = useState<string[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>('default');
  const [lastImagePrompt, setLastImagePrompt] = useState('');
  const [comfyTesting, setComfyTesting] = useState(false);
  const [comfyStatusMsg, setComfyStatusMsg] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [tab, setTab] = useState<'chat' | 'prompts'>('chat');
  const [savedPrompts, setSavedPrompts] = useState<any[]>([]);
  const [promptPickerOpen, setPromptPickerOpen] = useState(false);
  const [promptPickerQuery, setPromptPickerQuery] = useState('');

  useEffect(() => {
    fetch('/api/settings/prefs').then(r => r.json()).then(p => {
      if (p.openrouterApiKey) {
        setApiKey(p.openrouterApiKey);
        setApiKeySaved(true);
      } else {
        setShowSettings(true);
      }
      if (p.openrouterModel) setOpenrouterModel(p.openrouterModel);
      if (typeof p.assistantNsfw === 'boolean') setNsfwEnabled(p.assistantNsfw);
      if (p.assistantSystemMode) setSystemMode(p.assistantSystemMode);
      if (p.assistantStoryGenre) setStoryGenre(p.assistantStoryGenre);
    }).catch(() => {});

    fetch('/api/comfyui/workflows').then(r => r.json()).then((d: any) => {
      const raw = Array.isArray(d) ? d : (d.workflows || []);
      const list = raw.map((x: any) => (typeof x === 'string' ? x : (x.name || x.file || ''))).filter(Boolean);
      setWorkflows(list);
      if (list.length && !list.includes(selectedWorkflow)) setSelectedWorkflow(list[0]);
    }).catch(() => {});
    fetch('/api/prompts').then(r => r.json()).then(data => setSavedPrompts(data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const saveKey = async () => {
    await fetch('/api/settings/prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ openrouterApiKey: apiKey.trim(), openrouterModel }),
    });
    setApiKeySaved(true);
    setShowSettings(false);
    if ((window as any).toast) (window as any).toast('API key saved');
  };

  const resolvedModel = openrouterModel;

  const buildLibContext = useCallback(async () => {
    try {
      const vids = allVideos.value;
      const cats = categories.value;
      const tagCounts: Record<string, number> = {};
      for (const v of vids) {
        for (const t of ((v as any).tags || []) as string[]) {
          tagCounts[t] = (tagCounts[t] || 0) + 1;
        }
      }
      const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([t]) => t).join(', ');
      const catNames = cats.slice(0, 30).map((c: any) => c.name).join(', ');
      const summary = `Total videos: ${vids.length}. Categories: ${catNames}. Top tags: ${topTags}.`;
      setLibSummary(summary);
      return summary;
    } catch { return ''; }
  }, []);

  const getActiveSystemPrompt = useCallback((withLib = false) => {
    let baseKey = systemMode;
    if (nsfwEnabled && (systemMode === 'default' || systemMode === 'library_only')) {
      baseKey = 'nsfw_porn';
    }
    const base = SYSTEM_PROMPTS[baseKey] || SYSTEM_PROMPTS.default;

    if (withLib && libSummary) {
      if (baseKey.includes('nsfw') || baseKey.includes('story')) {
        return base + `\n\n(You may also reference the user's AphroArchive library if relevant: ${libSummary})`;
      }
      return base + `\n\nUser's library context: ${libSummary}`;
    }
    return base;
  }, [systemMode, nsfwEnabled, libSummary]);

  const send = useCallback(async (overrideInput?: string, overrideSystemPrompt?: string) => {
    const text = (overrideInput ?? input).trim();
    if (!text || streaming) return;

    const userMsg: Message = { role: 'user', content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');
    setStreaming(true);

    let ctx = libSummary;
    if (includeLibCtx && !ctx) ctx = await buildLibContext();

    const sysContent = overrideSystemPrompt || getActiveSystemPrompt(!!ctx || includeLibCtx);
    const apiMessages: Message[] = [{ role: 'system', content: sysContent }, ...history];

    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      const resp = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, model: resolvedModel }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: `Error: ${err.error}` };
          return updated;
        });
        return;
      }

      const reader = resp.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              setMessages(prev => {
                const u = [...prev];
                u[u.length - 1] = { role: 'assistant', content: `Error: ${parsed.error}` };
                return u;
              });
            } else if (parsed.delta) {
              setMessages(prev => {
                const u = [...prev];
                u[u.length - 1] = { ...u[u.length - 1], content: u[u.length - 1].content + parsed.delta };
                return u;
              });
            }
          } catch {}
        }
      }
    } catch (e: any) {
      setMessages(prev => {
        const u = [...prev];
        u[u.length - 1] = { role: 'assistant', content: `Connection error: ${e.message}` };
        return u;
      });
    } finally {
      setStreaming(false);
    }
  }, [input, messages, resolvedModel, streaming, includeLibCtx, libSummary, buildLibContext, getActiveSystemPrompt]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const genImagePrompt = () => {
    const userText = input.trim() || 'a beautiful naked woman, detailed pussy, realistic, high quality';
    const full = `Generate a highly detailed, explicit, uncensored image prompt for ComfyUI/Stable Diffusion: ${userText}`;
    setLastImagePrompt(userText);
    send(full);
  };

  const searchLibrary = () => {
    const userText = input.trim();
    if (!userText) return;
    send(`Search my video library and list videos matching: "${userText}". Library: ${libSummary || 'loading...'}`);
  };

  const findPorn = () => {
    const userText = input.trim() || 'hot scenes';
    send(`${userText} - Recommend best high quality porn sites, videos, and explicit scenes. Be direct with links/descriptions if possible.`);
  };

  const generateStory = (isPorn: boolean, genre?: string) => {
    const effectiveGenre = genre || storyGenre || 'Any';
    const genreClause = (effectiveGenre && effectiveGenre.toLowerCase() !== 'any')
      ? ` in the ${effectiveGenre} genre`
      : '';

    const defaultTheme = isPorn
      ? 'a hot encounter between two people in a video store after hours'
      : 'a young archivist who discovers a hidden room full of mysterious old films in an abandoned theater';

    const theme = input.trim() || defaultTheme;
    setLastImagePrompt('');

    const systemPrompt = isPorn
      ? SYSTEM_PROMPTS.story_writer
      : SYSTEM_PROMPTS.story_normal;

    const userInstruction = isPorn
      ? `Write a long, extremely explicit, vulgar porn story (800+ words)${genreClause} based on this premise: ${theme}. Focus on graphic sex acts, dirty talk, multiple rounds, bodily fluids, sensations, positions, and intense descriptions. Use the filthiest language possible.`
      : `Write an engaging, well-crafted story (700-1500 words)${genreClause} based on this premise: ${theme}. Develop interesting characters, build atmosphere and tension, include meaningful dialogue, and deliver a satisfying narrative arc. Use vivid but tasteful prose. Match the conventions and tone of the chosen genre.`;

    send(userInstruction, systemPrompt);
  };

  const normalStoryGenerator = () => generateStory(false);
  const pornStoryGenerator = () => generateStory(true);

  const generateImage = async () => {
    let prompt = lastImagePrompt || input.trim();
    if (!prompt && messages.length) {
      const lastAss = [...messages].reverse().find(m => m.role === 'assistant');
      if (lastAss) prompt = lastAss.content.split('\n\n')[0].replace(/\*\*/g, '').trim();
    }
    if (!prompt) {
      if ((window as any).toast) (window as any).toast('Type a prompt, generate one first, or have the AI reply with a prompt.');
      return;
    }

    setLastImagePrompt(prompt);

    const wf = selectedWorkflow || (workflows[0] || 'default');
    try {
      const r = await fetch('/api/comfyui/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: prompt, workflow: wf }),
      });
      const d = await r.json();
      if (!r.ok || d.error) {
        const msg = d.error || `HTTP ${r.status}`;
        if ((window as any).toast) (window as any).toast('ComfyUI error: ' + msg);
        setComfyStatusMsg('Failed — ensure ComfyUI running + workflow exists in cache/comfyui-workflows/' + wf + '.json');
      } else {
        if ((window as any).toast) (window as any).toast('✅ Sent to ComfyUI (workflow: ' + wf + ')');
        setComfyStatusMsg('Image queued in ComfyUI!');
        setTimeout(() => setComfyStatusMsg(''), 4000);
      }
    } catch (e: any) {
      if ((window as any).toast) (window as any).toast('ComfyUI unreachable: ' + e.message);
      setComfyStatusMsg('ComfyUI not reachable at 127.0.0.1:8188');
    }
  };

  const testComfyUI = async () => {
    setComfyTesting(true);
    setComfyStatusMsg('');
    try {
      const r = await fetch(COMFY_DEFAULT_URL + '/history', { method: 'GET' });
      if (r.ok) {
        setComfyStatusMsg('✅ ComfyUI reachable!');
        if ((window as any).toast) (window as any).toast('ComfyUI connected');
        const wfR = await fetch('/api/comfyui/workflows').catch(() => null);
        if (wfR && wfR.ok) {
          const d = await wfR.json();
          const raw = Array.isArray(d) ? d : (d.workflows || []);
          const list = raw.map((x: any) => (typeof x === 'string' ? x : (x.name || x.file || ''))).filter(Boolean);
          setWorkflows(list);
          if (list[0]) setSelectedWorkflow(list[0]);
        }
      } else {
        setComfyStatusMsg(`ComfyUI responded ${r.status}`);
      }
    } catch (e: any) {
      setComfyStatusMsg('Cannot reach ComfyUI: ' + e.message + ' — start it!');
    } finally {
      setComfyTesting(false);
      setTimeout(() => setComfyStatusMsg(''), 6000);
    }
  };

  const useAsImagePrompt = (text: string) => {
    const prompt = text.split('\n\n')[0].replace(/\*\*/g, '').trim();
    setLastImagePrompt(prompt);
    navigator.clipboard?.writeText(prompt).catch(() => {});
    currentView.value = 'imagegen';
    if ((window as any).toast) (window as any).toast('Navigated to Image Gen — paste prompt there');
  };

  const clearChat = () => setMessages([]);

  useEffect(() => {
    if (includeLibCtx) buildLibContext();
  }, [includeLibCtx]);

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: 'var(--bg)', flexDirection: 'column' }}>

      {/* ── Tab bar ────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--brd)', background: 'var(--bg2)', flexShrink: 0 }}>
        <button type="button" onClick={() => setTab('chat')} style={{ padding: '8px 16px', background: 'none', border: 'none', borderBottom: tab === 'chat' ? '2px solid var(--ac)' : '2px solid transparent', color: tab === 'chat' ? 'var(--ac)' : 'var(--tx2)', cursor: 'pointer', fontSize: '12px', fontWeight: tab === 'chat' ? 600 : 400 }}>💬 Chat</button>
        <button type="button" onClick={() => setTab('prompts')} style={{ padding: '8px 16px', background: 'none', border: 'none', borderBottom: tab === 'prompts' ? '2px solid var(--ac)' : '2px solid transparent', color: tab === 'prompts' ? 'var(--ac)' : 'var(--tx2)', cursor: 'pointer', fontSize: '12px', fontWeight: tab === 'prompts' ? 600 : 400 }}>📚 Prompts</button>
      </div>

      {tab === 'chat' && <>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--brd)', background: 'var(--bg2)', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ac)" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span style={{ fontWeight: 700, fontSize: '14px', flex: 1 }}>Assistant 🔥</span>

        <select
          value={systemMode}
          onChange={(e: any) => {
            const val = e.target.value;
            setSystemMode(val);
            fetch('/api/settings/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assistantSystemMode: val }) }).catch(() => {});
          }}
          title="System prompt / Jailbreak method"
          style={{ background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '5px', padding: '3px 7px', fontSize: '11px', maxWidth: '170px' }}
        >
          {JAILBREAK_METHODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>

        <select
          value={storyGenre}
          onChange={(e: any) => {
            const val = e.target.value;
            setStoryGenre(val);
            fetch('/api/settings/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assistantStoryGenre: val }) }).catch(() => {});
          }}
          title="Genre for Story / Porn Story generator"
          style={{ background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '5px', padding: '3px 7px', fontSize: '11px', maxWidth: '130px' }}
        >
          {STORY_GENRES.map(g => <option key={g} value={g}>{g}</option>)}
        </select>

        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: nsfwEnabled ? '#ff69b4' : 'var(--tx2)', cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: nsfwEnabled ? 600 : 400 }}>
          <input
            type="checkbox"
            checked={nsfwEnabled}
            onChange={(e: any) => {
              const v = e.target.checked;
              setNsfwEnabled(v);
              fetch('/api/settings/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assistantNsfw: v }) }).catch(() => {});
            }}
          />
          NSFW / Porn
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--tx2)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input
            type="checkbox"
            checked={includeLibCtx}
            onChange={(e: any) => setIncludeLibCtx(e.target.checked)}
          />
          Lib ctx
        </label>

        {workflows.length > 0 && (
          <select
            value={selectedWorkflow}
            onChange={(e: any) => setSelectedWorkflow(e.target.value)}
            title="ComfyUI workflow for Generate Image"
            style={{ background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '5px', padding: '2px 5px', fontSize: '10px', maxWidth: '110px' }}
          >
            {workflows.map(w => <option key={w} value={w}>{w}</option>)}
            {!workflows.includes('default') && <option value="default">default</option>}
          </select>
        )}
        <button
          onClick={testComfyUI}
          disabled={comfyTesting}
          title="Test ComfyUI connection"
          style={{ background: 'none', border: '1px solid var(--brd)', color: 'var(--tx3)', cursor: 'pointer', fontSize: '10px', padding: '2px 6px', borderRadius: '4px' }}
        >{comfyTesting ? '...' : 'Test Comfy'}</button>

        <button
          onClick={clearChat}
          title="Clear chat"
          style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', fontSize: '12px', padding: '3px 6px' }}
        >Clear</button>

        <button
          onClick={() => setShowSettings(v => !v)}
          title="API Key settings"
          style={{ background: 'none', border: 'none', color: showSettings ? 'var(--ac)' : 'var(--tx3)', cursor: 'pointer', padding: '3px', fontSize: '14px' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      {showSettings && (
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--brd)', background: 'var(--bg3)', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <span style={{ fontSize: '12px', color: 'var(--tx2)', whiteSpace: 'nowrap' }}>OpenRouter API Key:</span>
          <input
            type="password"
            value={apiKey}
            onInput={(e: any) => { setApiKey(e.target.value); setApiKeySaved(false); }}
            placeholder="sk-or-..."
            style={{ flex: 1, background: 'var(--bg2)', color: 'var(--tx)', border: `1px solid ${apiKeySaved ? '#4caf50' : 'var(--brd)'}`, borderRadius: '5px', padding: '4px 8px', fontSize: '12px' }}
          />
          <button
            onClick={saveKey}
            style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '5px', padding: '4px 12px', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap' }}
          >{apiKeySaved ? 'Saved' : 'Save'}</button>
          <a
            href="https://openrouter.ai/keys"
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '11px', color: 'var(--ac)', whiteSpace: 'nowrap' }}
          >Get key</a>
        </div>
      )}

      {(nsfwEnabled || comfyStatusMsg || systemMode !== 'default') && (
        <div style={{ padding: '4px 14px', background: 'var(--bg3)', fontSize: '11px', color: nsfwEnabled ? '#ff8ac4' : 'var(--tx3)', display: 'flex', gap: '12px', flexShrink: 0 }}>
          {nsfwEnabled && <span>🔞 NSFW/Porn mode active — using explicit uncensored system prompt</span>}
          {systemMode !== 'default' && !nsfwEnabled && <span>System: {JAILBREAK_METHODS.find(m => m.id === systemMode)?.label}</span>}
          {comfyStatusMsg && <span style={{ color: '#4caf50' }}>{comfyStatusMsg}</span>}
          {lastImagePrompt && <span style={{ color: 'var(--ac)' }}>Last prompt ready for image gen</span>}
        </div>
      )}

      {/* ── Messages ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px' }}>
        {messages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px', color: 'var(--tx3)' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.3">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <p style={{ margin: 0, fontSize: '13px' }}>Ask anything about your library, generate image prompts, or just chat.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center', maxWidth: '480px' }}>
              {(nsfwEnabled ? [
                'Write a porn story about a librarian and a customer',
                'Generate an ultra explicit pussy closeup prompt',
                'Find me the hottest gangbang scenes',
                'Describe a detailed creampie scene',
              ] : [
                'Write a short mystery story about a lost film',
                'What categories do I have?',
                'Generate an image prompt for a fantasy scene',
                'Suggest tags for a video about cooking',
              ]).map(s => (
                <button
                  key={s}
                  onClick={() => { setInput(s); inputRef.current?.focus(); }}
                  style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '16px', padding: '5px 11px', cursor: 'pointer', fontSize: '12px' }}
                >{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <Bubble key={i} msg={msg} onUseAsPrompt={useAsImagePrompt} />
        ))}
        {streaming && messages[messages.length - 1]?.content === '' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--tx3)', fontSize: '12px', marginBottom: '12px', paddingLeft: '4px' }}>
            <span style={{ display: 'inline-block', animation: 'assThink 1s ease-in-out infinite' }}>●</span>
            <span style={{ display: 'inline-block', animation: 'assThink 1s ease-in-out infinite', animationDelay: '0.2s' }}>●</span>
            <span style={{ display: 'inline-block', animation: 'assThink 1s ease-in-out infinite', animationDelay: '0.4s' }}>●</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Input area ───────────────────────────────────────────── */}
      <div style={{ padding: '10px 14px 14px', borderTop: '1px solid var(--brd)', background: 'var(--bg2)', flexShrink: 0 }}>
        {promptPickerOpen && (
          <div style={{ marginBottom: '8px', border: '1px solid var(--brd)', borderRadius: '6px', background: 'var(--bg3)', overflow: 'hidden' }}>
            <input
              value={promptPickerQuery}
              onInput={(e: any) => setPromptPickerQuery(e.target.value)}
              placeholder="Filter saved prompts…"
              autoFocus
              style={{ width: '100%', boxSizing: 'border-box', padding: '6px 10px', background: 'var(--bg2)', border: 'none', borderBottom: '1px solid var(--brd)', color: 'var(--tx)', fontSize: '12px', outline: 'none' }}
            />
            <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
              {savedPrompts
                .filter(p => !promptPickerQuery || [p.title || '', p.text || ''].join(' ').toLowerCase().includes(promptPickerQuery.toLowerCase()))
                .map((p: any) => (
                  <div
                    key={p.id}
                    onClick={() => { setInput(p.text); setPromptPickerOpen(false); setPromptPickerQuery(''); }}
                    style={{ padding: '6px 10px', cursor: 'pointer', borderBottom: '1px solid var(--brd)', fontSize: '12px' }}
                    onMouseEnter={(e: any) => e.currentTarget.style.background = 'var(--bg)'}
                    onMouseLeave={(e: any) => e.currentTarget.style.background = ''}
                  >
                    <span style={{ fontWeight: 600, color: 'var(--tx)' }}>{p.title}</span>
                    <span style={{ color: 'var(--tx3)', marginLeft: '6px' }}>{(p.text || '').slice(0, 80)}{(p.text || '').length > 80 ? '…' : ''}</span>
                  </div>
                ))}
              {savedPrompts.filter(p => !promptPickerQuery || [p.title || '', p.text || ''].join(' ').toLowerCase().includes(promptPickerQuery.toLowerCase())).length === 0 && (
                <div style={{ padding: '10px', color: 'var(--tx3)', fontSize: '12px', textAlign: 'center' }}>No saved prompts</div>
              )}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
          <textarea
            ref={inputRef as any}
            value={input}
            onInput={(e: any) => setInput(e.target.value)}
            onKeyDown={handleKeyDown as any}
            placeholder="Ask something… (Enter to send, Shift+Enter for newline)"
            rows={3}
            disabled={streaming}
            style={{
              flex: 1,
              background: 'var(--bg3)',
              color: 'var(--tx)',
              border: '1px solid var(--brd)',
              borderRadius: '8px',
              padding: '8px 10px',
              fontSize: '13px',
              fontFamily: 'inherit',
              resize: 'none',
              lineHeight: '1.5',
              opacity: streaming ? 0.6 : 1,
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <button
              onClick={() => send()}
              disabled={streaming || !input.trim()}
              style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '7px', padding: '7px 16px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, opacity: (streaming || !input.trim()) ? 0.5 : 1, whiteSpace: 'nowrap' }}
            >{streaming ? '…' : 'Send'}</button>
            <button
              onClick={genImagePrompt}
              disabled={streaming}
              title="Generate an explicit image prompt"
              style={{ background: 'var(--bg3)', color: 'var(--tx2)', border: '1px solid var(--brd)', borderRadius: '7px', padding: '4px 8px', cursor: 'pointer', fontSize: '10px', opacity: streaming ? 0.5 : 1, whiteSpace: 'nowrap' }}
            >Gen Prompt</button>
            <button
              onClick={() => { currentView.value = 'imagegen'; if ((window as any).toast) (window as any).toast('Opened Image Gen — use the Prompt Generator panel (Static wildcards or AI)'); }}
              disabled={streaming}
              title="Open Prompt Generator"
              style={{ background: 'var(--bg3)', color: 'var(--tx2)', border: '1px solid var(--brd)', borderRadius: '7px', padding: '4px 8px', cursor: 'pointer', fontSize: '10px', opacity: streaming ? 0.5 : 1, whiteSpace: 'nowrap' }}
            >Prompt Gen</button>
            <button
              onClick={findPorn}
              disabled={streaming || !input.trim()}
              title="Find Porn"
              style={{ background: '#3a2a3a', color: '#ff8ac4', border: '1px solid #ff69b4', borderRadius: '7px', padding: '4px 8px', cursor: 'pointer', fontSize: '10px', opacity: (streaming || !input.trim()) ? 0.5 : 1, whiteSpace: 'nowrap' }}
            >Find Porn</button>
            <button
              onClick={normalStoryGenerator}
              disabled={streaming}
              title={`Generate a ${storyGenre !== 'Any' ? storyGenre + ' ' : ''}creative fiction story (non-explicit)`}
              style={{ background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '7px', padding: '4px 8px', cursor: 'pointer', fontSize: '10px', opacity: streaming ? 0.5 : 1, whiteSpace: 'nowrap' }}
            >Story</button>
            <button
              onClick={pornStoryGenerator}
              disabled={streaming}
              title={`Write a long explicit ${storyGenre !== 'Any' ? storyGenre + ' ' : ''}porn story`}
              style={{ background: '#2a1f2a', color: '#ff69b4', border: '1px solid #ff69b4', borderRadius: '7px', padding: '4px 8px', cursor: 'pointer', fontSize: '10px', opacity: streaming ? 0.5 : 1, whiteSpace: 'nowrap' }}
            >Porn Story</button>
            <button
              onClick={generateImage}
              disabled={streaming}
              title="Send prompt to ComfyUI"
              style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '7px', padding: '4px 8px', cursor: 'pointer', fontSize: '10px', opacity: streaming ? 0.5 : 1, whiteSpace: 'nowrap' }}
            >🖼️ Gen Image</button>
            <button
              onClick={searchLibrary}
              disabled={streaming || !input.trim()}
              title="Search library for matching videos"
              style={{ background: 'var(--bg3)', color: 'var(--tx2)', border: '1px solid var(--brd)', borderRadius: '7px', padding: '4px 8px', cursor: 'pointer', fontSize: '10px', opacity: (streaming || !input.trim()) ? 0.5 : 1, whiteSpace: 'nowrap' }}
            >Find Videos</button>
            <button
              type="button"
              onClick={() => setPromptPickerOpen(v => !v)}
              title="Use a saved prompt"
              style={{ background: promptPickerOpen ? 'var(--ac)' : 'var(--bg3)', color: promptPickerOpen ? '#fff' : 'var(--tx2)', border: `1px solid ${promptPickerOpen ? 'var(--ac)' : 'var(--brd)'}`, borderRadius: '7px', padding: '4px 8px', cursor: 'pointer', fontSize: '10px', whiteSpace: 'nowrap' }}
            >📚</button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes assThink {
          0%, 100% { opacity: 0.2; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.3); }
        }
      `}</style>
      </>}
      {tab === 'prompts' && (
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <PromptsView />
        </div>
      )}
    </div>
  );
};
