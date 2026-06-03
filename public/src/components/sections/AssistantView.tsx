import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { currentView, allVideos, categories } from '../../store';

// ── Types ─────────────────────────────────────────────────────────────

type Role = 'user' | 'assistant' | 'system';
interface Message { role: Role; content: string; }

// ── Constants ─────────────────────────────────────────────────────────

const MODELS = [
  { id: 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free', name: 'Venice Dolphin 24B (Free)' },
  { id: 'meta-llama/llama-4-maverick:free', name: 'Llama 4 Maverick (Free)' },
  { id: 'qwen/qwen3-235b-a22b:free', name: 'Qwen3 235B (Free)' },
  { id: 'cognitivecomputations/dolphin-llama3-70b', name: 'Dolphin Llama3 70B' },
  { id: 'sao10k/l3.1-euryale-70b', name: 'Euryale 70B' },
  { id: 'sao10k/l3-lunaris-8b', name: 'Lunaris 8B' },
  { id: 'mistralai/mistral-large', name: 'Mistral Large' },
  { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
  { id: 'anthropic/claude-opus-4', name: 'Claude Opus 4' },
];

const SYSTEM_PROMPT = `You are AphroArchive Assistant — an AI built into a personal local video library manager called AphroArchive. You help the user search and understand their library, suggest tags or metadata, write image prompts for the built-in image generator, and answer questions. Be direct and helpful. When asked to generate an image prompt, produce a detailed, vivid prompt suitable for Stable Diffusion.`;

// ── Simple markdown renderer for assistant messages ───────────────────

function renderText(text: string) {
  // Bold **text**
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
  const [model, setModel] = useState(MODELS[0].id);
  const [streaming, setStreaming] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [includeLibCtx, setIncludeLibCtx] = useState(false);
  const [libSummary, setLibSummary] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch('/api/settings/prefs').then(r => r.json()).then(p => {
      if (p.openrouterApiKey) {
        setApiKey(p.openrouterApiKey);
        setApiKeySaved(true);
      } else {
        setShowSettings(true);
      }
      if (p.openrouterModel) setModel(p.openrouterModel);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const saveKey = async () => {
    await fetch('/api/settings/prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ openrouterApiKey: apiKey.trim(), openrouterModel: model }),
    });
    setApiKeySaved(true);
    setShowSettings(false);
    if ((window as any).toast) (window as any).toast('API key saved');
  };

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

  const send = useCallback(async (overrideInput?: string) => {
    const text = (overrideInput ?? input).trim();
    if (!text || streaming) return;

    const userMsg: Message = { role: 'user', content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');
    setStreaming(true);

    let ctx = libSummary;
    if (includeLibCtx && !ctx) ctx = await buildLibContext();

    const sysContent = SYSTEM_PROMPT + (ctx ? `\n\nUser's library: ${ctx}` : '');
    const apiMessages: Message[] = [{ role: 'system', content: sysContent }, ...history];

    // Add empty assistant bubble for streaming
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      const resp = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, model }),
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
  }, [input, messages, model, streaming, includeLibCtx, libSummary, buildLibContext]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const genImagePrompt = () => {
    const userText = input.trim() || 'a beautiful scene';
    send(`Generate a detailed, explicit Stable Diffusion image prompt for: ${userText}`);
  };

  const searchLibrary = () => {
    const userText = input.trim();
    if (!userText) return;
    send(`Search my video library and list videos matching: "${userText}". Library: ${libSummary || 'loading...'}`);
  };

  const useAsImagePrompt = (text: string) => {
    // Strip to first paragraph for use as prompt
    const prompt = text.split('\n\n')[0].replace(/\*\*/g, '').trim();
    navigator.clipboard?.writeText(prompt).catch(() => {});
    currentView.value = 'imagegen';
    if ((window as any).toast) (window as any).toast('Navigated to Image Gen — paste prompt there');
  };

  const clearChat = () => setMessages([]);

  // Refresh lib context when entering view
  useEffect(() => {
    if (includeLibCtx) buildLibContext();
  }, [includeLibCtx]);

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: 'var(--bg)', flexDirection: 'column' }}>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--brd)', background: 'var(--bg2)', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ac)" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span style={{ fontWeight: 700, fontSize: '14px', flex: 1 }}>Assistant</span>

        <select
          value={model}
          onChange={(e: any) => {
            setModel(e.target.value);
            fetch('/api/settings/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openrouterModel: e.target.value }) }).catch(() => {});
          }}
          style={{ background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '5px', padding: '3px 7px', fontSize: '12px', maxWidth: '200px' }}
        >
          {MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>

        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--tx2)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input
            type="checkbox"
            checked={includeLibCtx}
            onChange={(e: any) => setIncludeLibCtx(e.target.checked)}
          />
          Library context
        </label>

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

      {/* ── API Key Settings panel ────────────────────────────────── */}
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

      {/* ── Messages ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px' }}>
        {messages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px', color: 'var(--tx3)' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.3">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <p style={{ margin: 0, fontSize: '13px' }}>Ask anything about your library, generate image prompts, or just chat.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center', maxWidth: '480px' }}>
              {[
                'What categories do I have?',
                'Generate an image prompt for a fantasy scene',
                'Suggest tags for a video about cooking',
                'Search for action videos',
              ].map(s => (
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
              title="Generate an image prompt from your input"
              style={{ background: 'var(--bg3)', color: 'var(--tx2)', border: '1px solid var(--brd)', borderRadius: '7px', padding: '5px 10px', cursor: 'pointer', fontSize: '11px', opacity: streaming ? 0.5 : 1, whiteSpace: 'nowrap' }}
            >Gen Prompt</button>
            <button
              onClick={searchLibrary}
              disabled={streaming || !input.trim()}
              title="Search library for matching videos"
              style={{ background: 'var(--bg3)', color: 'var(--tx2)', border: '1px solid var(--brd)', borderRadius: '7px', padding: '5px 10px', cursor: 'pointer', fontSize: '11px', opacity: (streaming || !input.trim()) ? 0.5 : 1, whiteSpace: 'nowrap' }}
            >Find Videos</button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes assThink {
          0%, 100% { opacity: 0.2; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.3); }
        }
      `}</style>
    </div>
  );
};
