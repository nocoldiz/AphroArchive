// Recommended For You widget — taste-scored picks from history.
import { useEffect, useMemo } from 'preact/hooks';
import { allVideos } from '../../public/src/store';
import { WidgetShell, Row } from '../../public/src/home/shared';
import { homeHistory, loadHomeHistory } from '../../public/src/home/homeData';
import { recommend } from '../../public/src/home/recommend';

export default function RecommendedWidget() {
  useEffect(() => { loadHomeHistory(); }, []);
  const items = useMemo(
    () => recommend(allVideos.value, homeHistory.value, 20),
    [allVideos.value, homeHistory.value]
  );
  return (
    <WidgetShell title="Recommended For You">
      <Row items={items} empty="Watch a few videos and recommendations will appear." />
    </WidgetShell>
  );
}
