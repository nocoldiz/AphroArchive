// Continue Watching widget — resumes videos with saved playback progress.
import { useState, useMemo } from 'preact/hooks';
import { allVideos, appPrefs } from '../../public/src/store';
import { WidgetShell, MiniCard, notInHiddenFolder } from '../../public/src/home/shared';
import { getAllProgress, clearProgress } from '../../public/src/home/progress';

export default function ContinueWatchingWidget() {
  const [, force] = useState(0);
  const prog = getAllProgress();
  const hiddenFolders = appPrefs.value.hiddenFolders;
  const items = useMemo(() => {
    const byId = new Map(allVideos.value.map(v => [v.id, v]));
    return Object.entries(prog)
      .filter(([id]) => byId.has(id) && notInHiddenFolder(byId.get(id)!))
      .sort((a, b) => b[1].ts - a[1].ts)
      .map(([id, p]) => ({ v: byId.get(id)!, pct: (p.t / p.d) * 100 }));
  }, [allVideos.value, JSON.stringify(prog), hiddenFolders]);

  return (
    <WidgetShell title="Continue Watching">
      {items.length === 0
        ? <div className="dw-empty">Nothing in progress — start a video and it'll show up here.</div>
        : <div className="dw-row">
            {items.map(({ v, pct }) =>
              <MiniCard key={v.id} video={v} progress={pct}
                onRemove={() => { clearProgress(v.id); force(x => x + 1); }} />
            )}
          </div>}
    </WidgetShell>
  );
}
