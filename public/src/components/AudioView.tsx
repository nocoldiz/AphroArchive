import { useState, useEffect } from 'preact/hooks';

interface AudioFile {
  id: string;
  title: string;
  ext: string;
  size: number;
  sizeF: string;
  date: number;
}

export const AudioView = () => {
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
  const [sort, setSort] = useState<'date' | 'name' | 'size'>('date');
  const [view, setView] = useState<'card' | 'list'>((localStorage.getItem('audioView') as any) || 'card');
  const [query, setQuery] = useState('');
  const [curAudio, setCurAudio] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const w = window as any;

  useEffect(() => {
    loadAudio();
  }, []);

  const loadAudio = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/audio');
      const data = await res.json();
      setAudioFiles(data);
    } catch (e) {
      console.error(e);
      setAudioFiles([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSetView = (v: 'card' | 'list') => {
    setView(v);
    localStorage.setItem('audioView', v);
  };

  const playAudio = (id: string) => {
    setCurAudio(id);
    const f = audioFiles.find(x => x.id === id);
    const audioEl = document.getElementById('audioEl') as HTMLAudioElement;
    const playerTitle = document.getElementById('audioPlayerTitle');
    const player = document.getElementById('audioPlayer');

    if (playerTitle) playerTitle.innerText = f ? f.title : '';
    if (audioEl) {
      audioEl.src = `/api/audio/${id}/stream`;
      if (player) player.style.display = '';
      audioEl.play().catch(() => {});
    }
  };

  const deleteAudio = async (id: string) => {
    if (!confirm('Delete this audio file?')) return;
    try {
      const r = await fetch(`/api/audio/${id}`, { method: 'DELETE' });
      if (r.ok) {
        if (curAudio === id) {
          const audioEl = document.getElementById('audioEl') as HTMLAudioElement;
          if (audioEl) {
            audioEl.pause();
            audioEl.src = '';
          }
          setCurAudio(null);
          const player = document.getElementById('audioPlayer');
          if (player) player.style.display = 'none';
        }
        if (w.toast) w.toast('Deleted');
        loadAudio();
      } else {
        if (w.toast) w.toast('Delete failed');
      }
    } catch (e) {
      if (w.toast) w.toast('Delete failed');
    }
  };

  const handleUpload = async (e: any) => {
    const fileInput = e.target;
    const files = fileInput.files;
    if (!files.length) return;
    let done = 0;
    for (const file of files) {
      try {
        const r = await fetch('/api/audio/upload', {
          method: 'POST',
          headers: { 'x-filename': encodeURIComponent(file.name) },
          body: file
        });
        const d = await r.json();
        if (r.ok) done++;
        else if (w.toast) w.toast(`Failed: ${d.error || file.name}`);
      } catch {
        if (w.toast) w.toast(`Upload error: ${file.name}`);
      }
    }
    fileInput.value = '';
    if (done) {
      if (w.toast) w.toast(`${done} file${done !== 1 ? 's' : ''} added`);
      loadAudio();
    }
  };

  const sortedFiles = [...audioFiles];
  if (sort === 'name') sortedFiles.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === 'size') sortedFiles.sort((a, b) => b.size - a.size);
  else sortedFiles.sort((a, b) => b.date - a.date);

  const filteredFiles = query
    ? sortedFiles.filter(f => f.title.toLowerCase().includes(query.toLowerCase()))
    : sortedFiles;

  const auIcon = (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
    </svg>
  );

  return (
    <div className="audio-view on">
      <div className="section-header">
        <h2>Audio Files</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div className="ss-tabs" style={{ display: 'flex', gap: '4px', background: 'var(--bg3)', padding: '2px', borderRadius: '8px' }}>
            <button className={`ss-tab ${sort === 'date' ? 'on' : ''}`} onClick={() => setSort('date')} style={{ padding: '4px 8px', borderRadius: '4px', border: 'none', background: sort === 'date' ? 'var(--ac)' : 'transparent', color: sort === 'date' ? '#fff' : 'var(--tx2)', cursor: 'pointer', fontSize: '0.75rem' }}>Date</button>
            <button className={`ss-tab ${sort === 'name' ? 'on' : ''}`} onClick={() => setSort('name')} style={{ padding: '4px 8px', borderRadius: '4px', border: 'none', background: sort === 'name' ? 'var(--ac)' : 'transparent', color: sort === 'name' ? '#fff' : 'var(--tx2)', cursor: 'pointer', fontSize: '0.75rem' }}>Name</button>
            <button className={`ss-tab ${sort === 'size' ? 'on' : ''}`} onClick={() => setSort('size')} style={{ padding: '4px 8px', borderRadius: '4px', border: 'none', background: sort === 'size' ? 'var(--ac)' : 'transparent', color: sort === 'size' ? '#fff' : 'var(--tx2)', cursor: 'pointer', fontSize: '0.75rem' }}>Size</button>
          </div>

          <div className="ss-tabs" style={{ display: 'flex', gap: '4px', background: 'var(--bg3)', padding: '2px', borderRadius: '8px' }}>
            <button className={`ss-tab ${view === 'card' ? 'on' : ''}`} onClick={() => handleSetView('card')} style={{ padding: '4px 8px', borderRadius: '4px', border: 'none', background: view === 'card' ? 'var(--ac)' : 'transparent', color: view === 'card' ? '#fff' : 'var(--tx2)', cursor: 'pointer', fontSize: '0.75rem' }}>Grid</button>
            <button className={`ss-tab ${view === 'list' ? 'on' : ''}`} onClick={() => handleSetView('list')} style={{ padding: '4px 8px', borderRadius: '4px', border: 'none', background: view === 'list' ? 'var(--ac)' : 'transparent', color: view === 'list' ? '#fff' : 'var(--tx2)', cursor: 'pointer', fontSize: '0.75rem' }}>List</button>
          </div>
          
          <label className="vault-add-label" style={{ cursor: 'pointer' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg> Add
            <input type="file" multiple style={{ display: 'none' }} onChange={handleUpload} />
          </label>

          <div className="gallery-filter-wrap" style={{ display: 'flex', alignItems: 'center' }}>
            <input 
              type="text" 
              placeholder="Filter…" 
              value={query}
              onInput={(e: any) => setQuery(e.target.value)}
              style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '4px 10px', borderRadius: '999px', fontSize: '0.75rem', width: '120px' }}
            />
          </div>
        </div>
      </div>

      <div id="audioGrid" className={view === 'list' ? 'au-list' : 'au-grid'} style={{ display: view === 'list' ? 'flex' : 'grid', flexDirection: 'column', gridTemplateColumns: view === 'card' ? 'repeat(auto-fill, minmax(200px, 1fr))' : 'none', gap: '12px', padding: '16px 0' }}>
        {loading && <div style={{ color: 'var(--tx2)', fontSize: '0.85rem' }}>Loading…</div>}
        {!loading && filteredFiles.length === 0 && (
          <div id="audioEmpty" style={{ color: 'var(--tx2)', fontSize: '0.85rem' }}>No audio files found.</div>
        )}
        {!loading && filteredFiles.map(f => (
          <div 
            key={f.id} 
            className={`${view === 'card' ? 'au-card' : 'au-row'} ${curAudio === f.id ? 'playing' : ''}`} 
            onClick={() => playAudio(f.id)}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '12px', 
              padding: '12px', 
              background: curAudio === f.id ? 'var(--bg3)' : 'var(--bg2)', 
              borderRadius: '8px', 
              cursor: 'pointer', 
              position: 'relative',
              border: curAudio === f.id ? '1px solid var(--ac)' : '1px solid transparent'
            }}
          >
            <div className="au-icon" style={{ color: curAudio === f.id ? 'var(--ac)' : 'var(--tx2)' }}>{auIcon}</div>
            <div className="au-info" style={{ flex: 1, minWidth: 0 }}>
              <div className="au-title" style={{ fontWeight: '500', color: 'var(--tx)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.title}</div>
              <div className="au-meta" style={{ fontSize: '0.75rem', color: 'var(--tx3)', display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span className="au-badge" style={{ background: 'var(--bg3)', padding: '2px 4px', borderRadius: '4px', fontSize: '0.65rem', textTransform: 'uppercase' }}>{f.ext.replace('.','')}</span>
                <span>{f.sizeF}</span>
              </div>
            </div>
            <button 
              className="au-del" 
              onClick={(e) => { e.stopPropagation(); deleteAudio(f.id); }} 
              title="Delete"
              style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: '4px' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
