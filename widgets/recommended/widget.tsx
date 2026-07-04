// Recommended For You widget — taste-scored picks from history.
import { useEffect, useMemo } from 'preact/hooks';
import { allVideos, appPrefs } from '../../public/src/store';
import { WidgetShell, Row, notInHiddenFolder } from '../../public/src/home/shared';
import { homeHistory, loadHomeHistory } from '../../public/src/home/homeData';
import { recommend } from '../../public/src/home/recommend';

export default function RecommendedWidget() {
  useEffect(() => { loadHomeHistory(); }, []);
  const hiddenFolders = appPrefs.value.hiddenFolders;
  const items = useMemo(
    () => recommend(allVideos.value.filter(notInHiddenFolder), homeHistory.value, 20),
    [allVideos.value, homeHistory.value, hiddenFolders]
  );
  return (
    <WidgetShell title="Recommended For You">
      <Row items={items} empty="Watch a few videos and recommendations will appear." />
    </WidgetShell>
  );
}
