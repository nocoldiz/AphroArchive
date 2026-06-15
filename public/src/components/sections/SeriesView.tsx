import { useState, useMemo, useEffect, useRef } from 'preact/hooks';
import { currentVideo, currentView, skipNextUpUpdate } from '../../store';
import { mergedSeriesList, playerSeries, playerSeason, SeriesEntry, Episode, DbEpisode, loadDbSeries } from '../../series';
import { FolderTree, FolderEntry } from '../UI/FolderTree';

export const SeriesView = () => {
  const list = mergedSeriesList.value;
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState('');
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadDbSeries(); }, []);

  const { folders, folderMap } = useMemo(() => {
    const folders: FolderEntry[] = [];
    const folderMap = new Map<string, { series: SeriesEntry & { dbEpisodes?: DbEpisode[] }; season: number | null }>();
    list.forEach((s, i) => {
      const sid = 'sr' + i;
      const epCount = s.episodes.length || s.dbEpisodes?.length || 0;
      const label = s.dbEpisodes && s.episodes.length === 0 ? `${s.name} (${epCount}) [db]` : `${s.name} (${epCount})`;
      folders.push({ id: sid, name: label, parent: null });
      folderMap.set(sid, { series: s, season: null });
      if (s.seasons.length > 1) {
        for (const n of s.seasons) {
          const cnt = s.episodes.length > 0
            ? s.episodes.filter(e => e.season === n).length
            : (s.dbEpisodes?.filter(e => e.season === n).length ?? 0);
          const id = `${sid}_${n}`;
          folders.push({ id, name: `Season ${n} (${cnt})`, parent: sid });
          folderMap.set(id, { series: s, season: n });
        }
      }
    });
    return { folders, folderMap };
  }, [list]);

  const cur = currentFolderId ? folderMap.get(currentFolderId) : null;

  const episodes: Episode[] = cur && cur.series.episodes.length > 0
    ? (cur.season != null ? cur.series.episodes.filter(e => e.season === cur.season) : cur.series.episodes)
    : [];

  const dbEpisodes: DbEpisode[] = cur && cur.series.dbEpisodes
    ? (cur.season != null ? cur.series.dbEpisodes.filter(e => e.season === cur.season) : cur.series.dbEpisodes)
    : [];

  const isDbOnly = cur ? (cur.series.dbEpisodes && cur.series.episodes.length === 0) : false;

  const playEpisode = (series: SeriesEntry, ep: Episode) => {
    playerSeries.value = series;
    playerSeason.value = ep.season;
    skipNextUpUpdate.value = false;
    currentVideo.value = ep.video;
    currentView.value = 'player';
    history.pushState(null, '', `/video/${ep.video.id}`);
  };

  const handleExport = () => {
    const a = document.createElement('a');
    a.href = '/api/db/series/export';
    a.download = 'series.json';
    a.click();
  };

  const handleImport = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    let data: any;
    try { data = JSON.parse(await file.text()); } catch { setImportStatus('Invalid JSON'); return; }
    if (!Array.isArray(data)) { setImportStatus('Expected array'); return; }
    setImportStatus('Importing…');
    try {
      const r = await fetch('/api/db/series/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const d = await r.json();
      setImportStatus(`Imported ${d.count} series`);
      await loadDbSeries();
      setTimeout(() => setImportStatus(''), 3000);
    } catch { setImportStatus('Import failed'); }
  };

  const formatDur = (s: number | null) => {
    if (!s) return '';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Series</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
          {importStatus && <span style={{ fontSize: '0.8rem', color: 'var(--tx3)' }}>{importStatus}</span>}
          <input ref={importRef} type="file" accept=".json" title="Import series JSON" style={{ display: 'none' }} onChange={handleImport} />
          <button
            type="button"
            onClick={() => importRef.current?.click()}
            style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.82rem' }}
          >
            Import JSON
          </button>
          <button
            type="button"
            onClick={handleExport}
            style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.82rem' }}
          >
            Export JSON
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        <div style={{ color: 'var(--tx3)', fontSize: '0.95rem' }}>
          No series detected. Files named like <code>Show Name S01E02</code> or <code>Show Name - 1x02</code> are auto-grouped here.
          You can also import a <code>series.json</code> to define series without local files.
        </div>
      ) : (
        <>
          <FolderTree
            folders={folders}
            currentFolderId={currentFolderId}
            onNavigate={setCurrentFolderId}
            readOnly
          />

          {cur && (
            <div style={{ marginTop: 4 }}>
              <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>
                {cur.series.name}{cur.season != null ? ` — Season ${cur.season}` : ''}
                {isDbOnly && <span style={{ marginLeft: 8, fontSize: '0.75rem', color: 'var(--tx3)', fontWeight: 400 }}>database only — no local files</span>}
              </h2>

              {/* Auto-detected episodes with actual video files */}
              {episodes.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
                  {episodes.map(ep => (
                    <div
                      key={ep.video.id}
                      onClick={() => playEpisode(cur.series, ep)}
                      style={{ cursor: 'pointer', background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: 8, overflow: 'hidden' }}
                    >
                      <div style={{ aspectRatio: '16/9', background: '#000' }}>
                        <img
                          src={`/api/thumbs/${ep.video.id}/0`}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={(e: any) => { e.target.style.visibility = 'hidden'; }}
                        />
                      </div>
                      <div style={{ padding: '8px 10px' }}>
                        <div style={{ fontSize: '0.78rem', color: 'var(--ac)', marginBottom: 2 }}>
                          S{ep.season}E{String(ep.episode).padStart(2, '0')}
                        </div>
                        <div style={{ fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ep.video.name}>
                          {ep.video.name}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* DB-only episodes (no local files) */}
              {isDbOnly && dbEpisodes.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {dbEpisodes.map(ep => (
                    <div
                      key={`${ep.season}-${ep.episode}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: 6, opacity: 0.75 }}
                    >
                      <span style={{ fontSize: '0.78rem', color: 'var(--ac)', minWidth: 52, flexShrink: 0 }}>
                        S{ep.season}E{String(ep.episode).padStart(2, '0')}
                      </span>
                      <span style={{ flex: 1, fontSize: '0.88rem', color: 'var(--tx)' }}>{ep.name || `Episode ${ep.episode}`}</span>
                      {ep.duration ? <span style={{ fontSize: '0.75rem', color: 'var(--tx3)', flexShrink: 0 }}>{formatDur(ep.duration)}</span> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
