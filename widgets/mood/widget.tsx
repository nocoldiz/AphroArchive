// Mood / Genre Browser widget — tag tiles that filter the grid.
import { useMemo } from 'preact/hooks';
import { allVideos, categories, currentTag, currentTagTerms } from '../../public/src/store';
import { WidgetShell, nav, currentCategory } from '../../public/src/home/shared';

export default function MoodWidget() {
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of allVideos.value) {
      for (const t of (v.tags || [])) {
        const k = t.trim();
        if (k) counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
    let top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(e => e[0]);
    if (top.length < 6) {
      const cats = categories.value.filter(c => c.path && c.path !== 'Links').slice(0, 12).map(c => c.name);
      top = [...new Set([...top, ...cats])].slice(0, 18);
    }
    return top;
  }, [allVideos.value, categories.value]);

  const openTag = (t: string) => {
    currentTag.value = t;
    currentTagTerms.value = [];
    currentCategory.value = '';
    nav('browse', `/tag/${encodeURIComponent(t)}`);
  };

  return (
    <WidgetShell title="Browse by Mood">
      {tags.length
        ? <div className="dw-tiles">{tags.map(t => <button key={t} className="dw-tile" onClick={() => openTag(t)}>{t}</button>)}</div>
        : <div className="dw-empty">Tag your videos to unlock mood browsing.</div>}
    </WidgetShell>
  );
}
