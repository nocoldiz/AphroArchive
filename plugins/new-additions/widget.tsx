// New Additions widget — most recently added videos.
import { useMemo } from 'preact/hooks';
import { allVideos } from '../../public/src/store';
import { WidgetShell, Row, localVideos, nav, currentCategory } from '../../public/src/home/shared';

export default function NewAdditionsWidget() {
  const items = useMemo(() => [...localVideos()].sort((a, b) => b.mtime - a.mtime).slice(0, 20), [allVideos.value]);
  return (
    <WidgetShell title="New Additions" action={{ label: 'Browse all', onClick: () => { currentCategory.value = ''; nav('browse'); } }}>
      <Row items={items} empty="No videos yet." />
    </WidgetShell>
  );
}
