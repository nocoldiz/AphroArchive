// Recently Watched widget — recent history entries.
import { useEffect } from 'preact/hooks';
import { WidgetShell, Row, nav } from '../../public/src/home/shared';
import { homeHistory, loadHomeHistory } from '../../public/src/home/homeData';

export default function RecentlyWatchedWidget() {
  useEffect(() => { loadHomeHistory(); }, []);
  const items = homeHistory.value.slice(0, 20);
  return (
    <WidgetShell title="Recently Watched" action={{ label: 'See all', onClick: () => nav('recent', '/recent') }}>
      <Row items={items} empty="Your watch history is empty." />
    </WidgetShell>
  );
}
