/** @jsxImportSource preact */
import { useState, useEffect, useRef } from 'preact/hooks';

// URL patterns that identify a media stream
const AUDIO_EXTS = new Set(['.mp3', '.aac', '.ogg', '.opus', '.flac', '.wav', '.m4a', '.wma']);
const VIDEO_EXTS = new Set(['.m3u8', '.mpd', '.ts', '.flv']);
const STREAM_RE = /\/(stream|live|radio|listen|cast|audio|icecast|shoutcast)(\/|$|\?)/i;

function detectStreamType(url: string): 'audio' | 'video' | null {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    const ext = path.match(/\.[a-z0-9]+$/)?.[0] ?? '';
    if (VIDEO_EXTS.has(ext)) return 'video';
    if (AUDIO_EXTS.has(ext)) return 'audio';
    if (ext === '.m3u' || ext === '.pls') return 'audio';
    if (STREAM_RE.test(url)) return 'audio';
    return null;
  } catch {
    return null;
  }
}

interface RadioChannel {
  url: string;
  title: string;
  type: 'audio' | 'video';
  img?: string;
  tags?: string[];
}

const COLORS = ['#e84040', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];
function colorFor(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return COLORS[Math.abs(h) % COLORS.length];
}

function formatTitle(url: string, title?: string): string {
  if (title && title !== url) return title;
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch { return url; }
}

export const RadioModeView = () => {
  const [channels, setChannels] = useState<RadioChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<RadioChannel | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState<{ added: number; skipped: number } | null>(null);
  const [filter, setFilter] = useState<'all' | 'audio' | 'video'>('all');
  const [search, setSearch] = useState('');
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    loadStreams();
    // On unmount, abort any in-flight media connections so the sockets are
    // returned to the browser's per-origin pool (see VideoGrid preview notes).
    return () => {
      for (const el of [audioRef.current, videoRef.current]) {
        if (!el) continue;
        try { el.pause(); } catch {}
        try { el.removeAttribute('src'); } catch {}
        try { el.load(); } catch {}
      }
    };
  }, []);

  async function loadStreams() {
    setLoading(true);
    try {
      const r = await fetch('/api/links/cache?limit=0');
      const data = await r.json();
      const items: any[] = data.items || [];
      const streams: RadioChannel[] = items
        .filter(it => it.url && detectStreamType(it.url) !== null)
        .map(it => ({
          url: it.scrapedVideoUrl || it.url,
          title: formatTitle(it.url, it.title),
          type: detectStreamType(it.scrapedVideoUrl || it.url) ?? detectStreamType(it.url) ?? 'audio',
          img: it.img || undefined,
          tags: it.tags || [],
        }));
      setChannels(streams);
    } catch { setChannels([]); }
    setLoading(false);
  }

  function playChannel(ch: RadioChannel) {
    setCurrent(ch);
    setPlaying(false);
    // Small delay so the element re-mounts with the new src
    setTimeout(() => setPlaying(true), 50);
  }

  const handleMediaPlay = () => setPlaying(true);
  const handleMediaPause = () => setPlaying(false);

  async function addStreams() {
    const urls = pasteText
      .split(/[\n,]+/)
      .map(u => u.trim())
      .filter(u => {
        try { new URL(u); return true; } catch { return false; }
      });

    const streamUrls = urls.filter(u => detectStreamType(u) !== null);
    if (streamUrls.length === 0) {
      (window as any).toast?.('No recognizable stream URLs found');
      return;
    }

    setAdding(true);
    try {
      const r = await fetch('/api/links/import-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: streamUrls }),
      });
      const d = await r.json();
      setAddResult({ added: d.added || 0, skipped: d.skipped || 0 });
      setPasteText('');
      await loadStreams();
    } catch {
      (window as any).toastError?.('Failed to add streams');
    }
    setAdding(false);
  }

  const filtered = channels.filter(ch => {
    if (filter !== 'all' && ch.type !== filter) return false;
    if (search && !ch.title.toLowerCase().includes(search.toLowerCase()) && !ch.url.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const audioChannels = channels.filter(c => c.type === 'audio');
  const videoChannels = channels.filter(c => c.type === 'video');

  return (
    <div style={{ display: 'flex', height: '100vh', flexDirection: 'column', background: 'var(--bg)', color: 'var(--tx)' }}>
      {/* Header */}
      <div style={{ padding: '20px 24px 12px', borderBottom: '1px solid var(--brd)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--ac, #ff4a4a)" strokeWidth="2">
              <circle cx="12" cy="12" r="2"/>
              <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/>
            </svg>
            <h1 style={{ margin: 0, fontSize: '1.3rem' }}>Radio &amp; Live Streams</h1>
            <span style={{ fontSize: '0.8rem', color: 'var(--tx3)', background: 'var(--bg3)', borderRadius: '10px', padding: '2px 8px' }}>
              {audioChannels.length} radio · {videoChannels.length} video
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Search streams…"
              value={search}
              onInput={(e: any) => setSearch(e.target.value)}
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', borderRadius: '6px', color: 'var(--tx)', padding: '6px 10px', fontSize: '0.85rem', width: '180px' }}
            />
            <div style={{ display: 'flex', border: '1px solid var(--brd)', borderRadius: '6px', overflow: 'hidden' }}>
              {(['all', 'audio', 'video'] as const).map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  style={{ background: filter === f ? 'var(--ac, #ff4a4a)' : 'var(--bg2)', color: filter === f ? '#fff' : 'var(--tx3)', border: 'none', padding: '5px 12px', cursor: 'pointer', fontSize: '0.8rem', textTransform: 'capitalize' }}
                >
                  {f}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => { setPasteOpen(v => !v); setAddResult(null); }}
              style={{ background: pasteOpen ? 'var(--ac, #ff4a4a)' : 'var(--bg3)', color: pasteOpen ? '#fff' : 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '5px' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
              Add Streams
            </button>
          </div>
        </div>

        {/* Paste panel */}
        {pasteOpen && (
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '8px', padding: '14px', marginTop: '8px' }}>
            <p style={{ margin: '0 0 8px', fontSize: '0.85rem', color: 'var(--tx3)' }}>
              Paste stream URLs (one per line) — audio and video streams are auto-detected and saved to your Links.
            </p>
            <textarea
              value={pasteText}
              onInput={(e: any) => setPasteText(e.target.value)}
              placeholder={'https://stream.example.com/radio.mp3\nhttps://live.example.com/stream.m3u8\n…'}
              rows={5}
              style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '8px', fontSize: '0.82rem', fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px' }}>
              <button
                type="button"
                onClick={addStreams}
                disabled={adding || !pasteText.trim()}
                style={{ background: 'var(--ac, #ff4a4a)', color: '#fff', border: 'none', borderRadius: '6px', padding: '7px 16px', cursor: adding ? 'default' : 'pointer', opacity: adding || !pasteText.trim() ? 0.5 : 1, fontSize: '0.85rem' }}
              >
                {adding ? 'Adding…' : 'Add to Library'}
              </button>
              {addResult && (
                <span style={{ fontSize: '0.82rem', color: 'var(--tx3)' }}>
                  ✓ Added {addResult.added}, skipped {addResult.skipped}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Channel list */}
        <div style={{ width: '320px', flexShrink: 0, overflowY: 'auto', borderRight: '1px solid var(--brd)' }}>
          {loading ? (
            <div style={{ padding: '30px', color: 'var(--tx3)', textAlign: 'center', fontSize: '0.9rem' }}>Loading streams…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '30px', color: 'var(--tx3)', textAlign: 'center' }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3, marginBottom: '10px', display: 'block', margin: '0 auto 10px' }}>
                <circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/>
              </svg>
              <p style={{ margin: 0, fontSize: '0.85rem' }}>No streams found.<br />Add stream URLs using the button above.</p>
            </div>
          ) : (
            filtered.map(ch => {
              const isCurrent = current?.url === ch.url;
              const c = colorFor(ch.url);
              return (
                <div
                  key={ch.url}
                  onClick={() => playChannel(ch)}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', cursor: 'pointer', background: isCurrent ? 'rgba(var(--ac-rgb,255,74,74),0.1)' : 'transparent', borderLeft: isCurrent ? '3px solid var(--ac, #ff4a4a)' : '3px solid transparent', transition: 'background 0.15s' }}
                >
                  {/* Thumb / icon */}
                  <div style={{ width: '40px', height: '40px', borderRadius: '8px', flexShrink: 0, overflow: 'hidden', background: `${c}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                    {ch.img ? (
                      <img src={ch.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e: any) => { e.target.style.display = 'none'; }} />
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2">
                        {ch.type === 'video'
                          ? <><rect x="2" y="7" width="20" height="15" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></>
                          : <><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49"/></>}
                      </svg>
                    )}
                    {isCurrent && playing && (
                      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontSize: '0.6rem', color: '#fff', letterSpacing: '1px', fontWeight: 700 }}>LIVE</span>
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.88rem', fontWeight: isCurrent ? 600 : 400, color: isCurrent ? 'var(--ac, #ff4a4a)' : 'var(--tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ch.title}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--tx3)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span style={{ background: ch.type === 'video' ? 'rgba(59,130,246,0.15)' : 'rgba(16,185,129,0.15)', color: ch.type === 'video' ? '#60a5fa' : '#34d399', borderRadius: '3px', padding: '1px 5px', fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase' }}>
                        {ch.type}
                      </span>
                      {ch.tags && ch.tags.length > 0 && (
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.tags.slice(0, 2).join(', ')}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Player area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
          {current ? (
            <>
              {/* Now playing header */}
              <div style={{ marginBottom: '24px', textAlign: 'center' }}>
                <div style={{ width: '80px', height: '80px', borderRadius: '16px', background: `${colorFor(current.url)}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                  {current.img ? (
                    <img src={current.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '16px' }} onError={(e: any) => e.target.style.display = 'none'} />
                  ) : (
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={colorFor(current.url)} strokeWidth="1.5">
                      {current.type === 'video'
                        ? <><rect x="2" y="7" width="20" height="15" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></>
                        : <><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/></>}
                    </svg>
                  )}
                </div>
                <h2 style={{ margin: '0 0 4px', fontSize: '1.3rem' }}>{current.title}</h2>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: playing ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.07)', color: playing ? '#34d399' : 'var(--tx3)', borderRadius: '10px', padding: '3px 10px', fontSize: '0.78rem', fontWeight: 600 }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: playing ? '#34d399' : 'var(--tx3)', display: 'inline-block', animation: playing ? 'pulse 1.2s ease-in-out infinite' : 'none' }} />
                    {playing ? 'LIVE' : 'PAUSED'}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--tx3)', background: 'var(--bg3)', borderRadius: '8px', padding: '2px 8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{current.type}</span>
                </div>
              </div>

              {/* Player element */}
              {current.type === 'audio' ? (
                <audio
                  key={current.url}
                  ref={audioRef}
                  src={current.url}
                  controls
                  autoPlay
                  style={{ width: '100%', maxWidth: '480px', borderRadius: '8px' }}
                  onPlay={handleMediaPlay}
                  onPause={handleMediaPause}
                  onError={() => (window as any).toastError?.(`Could not play stream: ${current.url}`)}
                />
              ) : (
                <video
                  key={current.url}
                  ref={videoRef}
                  src={current.url}
                  controls
                  autoPlay
                  style={{ width: '100%', maxWidth: '720px', maxHeight: '420px', borderRadius: '8px', background: '#000' }}
                  onPlay={handleMediaPlay}
                  onPause={handleMediaPause}
                  onError={() => (window as any).toastError?.(`Could not play stream: ${current.url}`)}
                />
              )}

              <div style={{ marginTop: '16px', fontSize: '0.75rem', color: 'var(--tx3)', wordBreak: 'break-all', maxWidth: '560px', textAlign: 'center', opacity: 0.7 }}>
                {current.url}
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--tx3)' }}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ opacity: 0.2, marginBottom: '16px' }}>
                <circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/>
              </svg>
              <p style={{ margin: 0, fontSize: '0.95rem' }}>
                {channels.length > 0 ? 'Select a channel to start streaming' : 'Add stream URLs to get started'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
