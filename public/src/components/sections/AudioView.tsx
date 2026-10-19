import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import { SectionControls } from '../UI/SectionControls';
import { isMuted, cardSize, contextMenuState } from '../../store';
import { AudioFile, Album } from '../../types';

type MusicTab = 'music' | 'albums' | 'artists';

const COLORS = ['#e84040','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];
const getColor = (name: string) => { let h = 0; for (const c of name) h = c.charCodeAt(0) + ((h << 5) - h); return COLORS[Math.abs(h) % COLORS.length]; };

// ── Music tab ────────────────────────────────────────────────────────

const MusicTab = ({ curAudio, setCurAudio }: { curAudio: string | null; setCurAudio: (id: string | null) => void }) => {
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
  const [sort, setSort] = useState<'date' | 'name' | 'size'>('date');
  const [view, setView] = useState<'card' | 'list'>((localStorage.getItem('audioView') as any) || 'card');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const w = window as any;

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try { const d = await fetch('/api/audio').then(r => r.json()); setAudioFiles(Array.isArray(d) ? d : []); }
    catch { setAudioFiles([]); }
    finally { setLoading(false); }
  };

  const handleSetView = (v: 'card' | 'list') => { setView(v); localStorage.setItem('audioView', v); };

  const deleteAudio = async (id: string) => {
    if (!confirm('Delete this audio file?')) return;
    const r = await fetch(`/api/audio/${id}`, { method: 'DELETE' }).catch(() => null);
    if (r?.ok) { if (curAudio === id) setCurAudio(null); if (w.toast) w.toast('Deleted'); load(); }
    else if (w.toast) w.toast('Delete failed');
  };

  const openCtx = (e: any, file: AudioFile) => {
    e.preventDefault(); e.stopPropagation();
    contextMenuState.value = { visible: true, x: e.pageX, y: e.pageY, type: 'audio', data: { id: file.id, name: file.title, onDelete: () => deleteAudio(file.id), onOpen: () => setCurAudio(file.id) } };
  };

  const handleUpload = async (e: any) => {
    const files = e.target.files;
    if (!files.length) return;
    let done = 0;
    for (const file of files) {
      try {
        const r = await fetch('/api/audio/upload', { method: 'POST', headers: { 'x-filename': encodeURIComponent(file.name) }, body: file });
        const d = await r.json();
        if (r.ok) done++; else if (w.toast) w.toast(`Failed: ${d.error || file.name}`);
      } catch { if (w.toast) w.toast(`Upload error: ${file.name}`); }
    }
    e.target.value = '';
    if (done) { if (w.toast) w.toast(`${done} file${done !== 1 ? 's' : ''} added`); load(); }
  };

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    const list = q ? audioFiles.filter(f => f.title.toLowerCase().includes(q)) : [...audioFiles];
    if (sort === 'name') list.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'size') list.sort((a, b) => b.size - a.size);
    else list.sort((a, b) => b.date - a.date);
    return list;
  }, [audioFiles, sort, query]);

  const auIcon = (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
    </svg>
  );

  return (
    <>
      <div className="section-header">
        <h2 style={{ display: 'none' }}>Audio Files</h2>
        <SectionControls
          showStarred={false} showShuffle={false} showSource={false} showFilter={true}
          currentSort={sort} onSortChange={(val: any) => setSort(val)}
          currentFilter={query} onFilterChange={setQuery}
          sortOptions={[{ value: 'date', label: 'Date' }, { value: 'name', label: 'Name' }, { value: 'size', label: 'Size' }]}
        >
          <span className="sg-sep" />
          <div className="ui-tabs">
            <button type="button" className={`ui-tab${view === 'card' ? ' on' : ''}`} onClick={() => handleSetView('card')}>Grid</button>
            <button type="button" className={`ui-tab${view === 'list' ? ' on' : ''}`} onClick={() => handleSetView('list')}>List</button>
          </div>
          <span className="sg-sep" />
          <label className="vault-add-label" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', borderRadius: '999px', background: 'var(--bg3)', border: '1px solid var(--brd)', fontSize: '0.75rem' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add
            <input type="file" multiple title="Add audio files" style={{ display: 'none' }} onChange={handleUpload} />
          </label>
        </SectionControls>
      </div>

      <div className={view === 'list' ? 'au-list' : 'au-grid'} style={{ display: view === 'list' ? 'flex' : 'grid', flexDirection: 'column', gridTemplateColumns: view === 'card' ? `repeat(auto-fill, minmax(${cardSize.value}px, 1fr))` : 'none', gap: '12px', padding: '16px 0' }}>
        {loading && <div style={{ color: 'var(--tx2)', fontSize: '0.85rem' }}>Loading…</div>}
        {!loading && filtered.length === 0 && <div className="empty-state empty-state--sm" style={{ gridColumn: '1 / -1' }}>No audio files found.</div>}
        {!loading && filtered.map(f => (
          <div key={f.id} className={`${view === 'card' ? 'au-card' : 'au-row'} ${curAudio === f.id ? 'playing' : ''}`}
            onClick={() => setCurAudio(f.id)} onContextMenu={(e) => openCtx(e, f)}
            style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: curAudio === f.id ? 'var(--bg3)' : 'var(--bg2)', borderRadius: '8px', cursor: 'pointer', position: 'relative', border: curAudio === f.id ? '1px solid var(--ac)' : '1px solid transparent' }}
          >
            <div className="au-icon" style={{ color: curAudio === f.id ? 'var(--ac)' : 'var(--tx2)' }}>{auIcon}</div>
            <div className="au-info" style={{ flex: 1, minWidth: 0 }}>
              <div className="au-title" style={{ fontWeight: '500', color: 'var(--tx)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.title}</div>
              <div className="au-meta" style={{ fontSize: '0.75rem', color: 'var(--tx3)', display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span className="au-badge" style={{ background: 'var(--bg3)', padding: '2px 4px', borderRadius: '4px', fontSize: '0.65rem', textTransform: 'uppercase' }}>{f.ext.replace('.', '')}</span>
                <span>{f.sizeF}</span>
              </div>
            </div>
            <button type="button" className="au-del" onClick={(e) => { e.stopPropagation(); deleteAudio(f.id); }} title="Delete" style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: '4px' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        ))}
      </div>
    </>
  );
};

// ── Albums tab ───────────────────────────────────────────────────────

const AlbumsTab = ({ onPlayTrack }: { onPlayTrack?: (title: string) => void }) => {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/db/albums').then(r => r.json()).then(d => setAlbums(d.albums || [])).catch(() => setAlbums([])).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return q ? albums.filter(a => a.name.toLowerCase().includes(q) || (a.artist || '').toLowerCase().includes(q)) : albums;
  }, [albums, query]);

  const fmtDur = (s: number | null) => {
    if (!s) return '';
    const m = Math.floor(s / 60), sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  const totalDur = (a: Album) => {
    const t = a.tracks.reduce((s, tr) => s + (tr.duration || 0), 0);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  if (loading) return <div style={{ padding: '40px', color: 'var(--tx3)' }}>Loading…</div>;

  return (
    <div style={{ padding: '16px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        <input type="text" className="ui-input" value={query} title="Search albums" placeholder="Search albums or artists…" onInput={(e: any) => setQuery(e.target.value)}
          style={{ flex: 1, maxWidth: 320 }} />
        <span style={{ fontSize: '0.8rem', color: 'var(--tx3)' }}>{filtered.length} album{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {filtered.length === 0 ? (
        <div style={{ color: 'var(--tx3)', fontSize: '0.9rem' }}>No albums found. Import an <code>albums.json</code> or use a preset that includes albums.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map(a => {
            const color = getColor(a.artist || a.name);
            const isOpen = expanded === a.id;
            return (
              <div key={a.id} style={{ background: 'var(--bg2)', border: `1px solid ${isOpen ? 'var(--ac)' : 'var(--brd)'}`, borderRadius: '8px', overflow: 'hidden' }}>
                <div onClick={() => setExpanded(isOpen ? null : a.id)} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 16px', cursor: 'pointer' }}>
                  {/* Cover placeholder */}
                  <div style={{ width: 52, height: 52, borderRadius: '6px', flexShrink: 0, background: `${color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
                    </svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--tx2)', marginTop: 2 }}>{a.artist}{a.year ? ` · ${a.year}` : ''}</div>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--tx3)', textAlign: 'right', flexShrink: 0 }}>
                    <div>{a.tracks.length} track{a.tracks.length !== 1 ? 's' : ''}</div>
                    {a.tracks.length > 0 && <div>{totalDur(a)}</div>}
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, color: 'var(--tx3)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </div>
                {isOpen && a.tracks.length > 0 && (
                  <div style={{ borderTop: '1px solid var(--brd)' }}>
                    {a.tracks.map((t, i) => (
                      <div key={t.trackNumber} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 16px', borderBottom: i < a.tracks.length - 1 ? '1px solid var(--brd)' : 'none', fontSize: '0.85rem' }}>
                        <span style={{ width: 24, textAlign: 'right', color: 'var(--tx3)', fontSize: '0.75rem', flexShrink: 0 }}>{t.trackNumber}</span>
                        <span style={{ flex: 1, color: 'var(--tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                        {!!t.duration && <span style={{ color: 'var(--tx3)', fontSize: '0.75rem', flexShrink: 0 }}>{fmtDur(t.duration)}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── Artists tab ──────────────────────────────────────────────────────

interface Artist { name: string; count: number; nationality?: string; imdb_page?: string; }

const ArtistsTab = () => {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/actors').then(r => r.json()).then(d => setArtists(Array.isArray(d) ? d : [])).catch(() => setArtists([])).finally(() => setLoading(false));
  }, []);

  const { filtered, withFiles, withoutFiles } = useMemo(() => {
    const q = query.toLowerCase();
    const filtered = q ? artists.filter(a => a.name.toLowerCase().includes(q)) : artists;
    const sorted = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
    return { filtered, withFiles: sorted.filter(a => a.count > 0), withoutFiles: sorted.filter(a => a.count === 0) };
  }, [artists, query]);

  if (loading) return <div style={{ padding: '40px', color: 'var(--tx3)' }}>Loading…</div>;

  const renderCard = (a: Artist) => {
    const color = getColor(a.name);
    return (
      <div key={a.name} class="cv-card fade-in" style={{ cursor: 'default' }}>
        <div class="cv-thumb" style={{ background: `${color}22`, color, position: 'relative', overflow: 'hidden' }}>
          <img src={`/api/actor-photos/${encodeURIComponent(a.name)}/img`} alt="" loading="lazy" onError={(e: any) => e.target.style.display = 'none'} style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 }} />
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', opacity: 0.3 }}>
            <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
          </svg>
        </div>
        <div class="cv-overlay">
          <span class="cv-type">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          </span>
          <div class="cv-info">
            <span class="cv-name">{a.name}</span>
            {a.nationality && <span class="cv-count" style={{ fontSize: '0.7rem', opacity: 0.75 }}>{a.nationality}</span>}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: '16px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        <input type="text" className="ui-input" value={query} title="Search artists" placeholder="Search artists…" onInput={(e: any) => setQuery(e.target.value)}
          style={{ flex: 1, maxWidth: 320 }} />
        <span style={{ fontSize: '0.8rem', color: 'var(--tx3)' }}>{filtered.length} artist{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {filtered.length === 0 ? (
        <div style={{ color: 'var(--tx3)' }}>No artists found. Add artists in Database → Actors.</div>
      ) : (
        <>
          {withFiles.length > 0 && (
            <div class="cv-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize.value}px, 1fr))`, gap: '20px', marginBottom: withoutFiles.length > 0 ? '32px' : 0 }}>
              {withFiles.map(renderCard)}
            </div>
          )}
          {withoutFiles.length > 0 && (
            <>
              <div style={{ margin: '20px 0 12px', borderBottom: '1px solid var(--brd)', paddingBottom: '5px', fontWeight: 600, color: 'var(--tx3)', fontSize: '0.85rem' }}>Database only</div>
              <div class="cv-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize.value}px, 1fr))`, gap: '20px' }}>
                {withoutFiles.map(renderCard)}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

// ── Main AudioView ───────────────────────────────────────────────────

export const AudioView = () => {
  const [tab, setTab] = useState<MusicTab>((localStorage.getItem('audioMainTab') as MusicTab) || 'music');
  const [curAudio, setCurAudio] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const setTabPersist = (t: MusicTab) => { setTab(t); localStorage.setItem('audioMainTab', t); };

  return (
    <div className="audio-view on">
      {/* Tab bar */}
      <div className="ui-tabs" style={{ alignItems: 'center', gap: '6px', padding: '16px 0 0', marginBottom: '4px' }}>
        <h2 style={{ margin: '0 16px 0 0', fontSize: '1.3rem' }}>Music</h2>
        <button type="button" className={`ui-tab${tab === 'music' ? ' on' : ''}`} onClick={() => setTabPersist('music')}>Files</button>
        <button type="button" className={`ui-tab${tab === 'albums' ? ' on' : ''}`} onClick={() => setTabPersist('albums')}>Albums</button>
        <button type="button" className={`ui-tab${tab === 'artists' ? ' on' : ''}`} onClick={() => setTabPersist('artists')}>Artists</button>
      </div>

      {tab === 'music' && <MusicTab curAudio={curAudio} setCurAudio={setCurAudio} />}
      {tab === 'albums' && <AlbumsTab />}
      {tab === 'artists' && <ArtistsTab />}

      {/* Persistent mini player (only shown when a file is active) */}
      {curAudio && (
        <div className="au-player" style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--bg3)', padding: '12px', borderRadius: '8px', marginTop: '16px', border: '1px solid var(--brd)' }}>
          <div style={{ color: 'var(--ac)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
            </svg>
          </div>
          <audio ref={audioRef} src={`/api/audio/${curAudio}/stream`} controls autoPlay style={{ flex: 1, height: '30px' }} muted={isMuted.value} />
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--icon" onClick={() => setCurAudio(null)} title="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}
    </div>
  );
};
