import { useState, useMemo } from 'preact/hooks';
import { currentVideo, currentView, skipNextUpUpdate } from '../../store';
import { seriesList, playerSeries, playerSeason, SeriesEntry, Episode } from '../../series';
import { FolderTree, FolderEntry } from '../UI/FolderTree';

export const SeriesView = () => {
  const list = seriesList.value;
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);

  // Build a folder tree: each series is a root folder; series with more than one
  // season expand into per-season subfolders.
  const { folders, folderMap } = useMemo(() => {
    const folders: FolderEntry[] = [];
    const folderMap = new Map<string, { series: SeriesEntry; season: number | null }>();
    list.forEach((s, i) => {
      const sid = 'sr' + i;
      folders.push({ id: sid, name: `${s.name} (${s.episodes.length})`, parent: null });
      folderMap.set(sid, { series: s, season: null });
      if (s.seasons.length > 1) {
        for (const n of s.seasons) {
          const cnt = s.episodes.filter(e => e.season === n).length;
          const id = `${sid}_${n}`;
          folders.push({ id, name: `Season ${n} (${cnt})`, parent: sid });
          folderMap.set(id, { series: s, season: n });
        }
      }
    });
    return { folders, folderMap };
  }, [list]);

  const cur = currentFolderId ? folderMap.get(currentFolderId) : null;
  const episodes: Episode[] = cur
    ? (cur.season != null ? cur.series.episodes.filter(e => e.season === cur.season) : cur.series.episodes)
    : [];

  const playEpisode = (series: SeriesEntry, ep: Episode) => {
    playerSeries.value = series;
    playerSeason.value = ep.season;
    skipNextUpUpdate.value = false;
    currentVideo.value = ep.video;
    currentView.value = 'player';
    history.pushState(null, '', `/video/${ep.video.id}`);
  };

  return (
    <div style={{ padding: '20px' }}>
      <h1 style={{ marginTop: 0, marginBottom: 16 }}>Series</h1>

      {list.length === 0 ? (
        <div style={{ color: 'var(--tx3)', fontSize: '0.95rem' }}>
          No series detected. Files named like <code>Show Name S01E02</code> or <code>Show Name - 1x02</code> are auto-grouped here.
        </div>
      ) : (
        <>
          <FolderTree
            folders={folders}
            currentFolderId={currentFolderId}
            onNavigate={setCurrentFolderId}
            readOnly
          />

          {cur && episodes.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>
                {cur.series.name}{cur.season != null ? ` — Season ${cur.season}` : ''}
              </h2>
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
            </div>
          )}
        </>
      )}
    </div>
  );
};
