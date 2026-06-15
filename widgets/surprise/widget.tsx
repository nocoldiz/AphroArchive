// Surprise Me widget — opens a random video immediately.
import { useEffect } from 'preact/hooks';
import { localVideos, openVid, WidgetInstance } from '../../public/src/home/shared';
import { homeHistory, loadHomeHistory } from '../../public/src/home/homeData';

export default function SurpriseWidget(instance: WidgetInstance) {
  useEffect(() => { loadHomeHistory(); }, []);
  const pick = () => {
    let pool = localVideos();
    if (instance.config?.unwatchedOnly !== false) {
      const watched = new Set(homeHistory.value.map(v => v.id));
      const unwatched = pool.filter(v => !watched.has(v.id));
      if (unwatched.length) pool = unwatched;
    }
    if (!pool.length) { (window as any).toast?.('No videos to pick from'); return; }
    openVid(pool[Math.floor(Math.random() * pool.length)].id);
  };
  return (
    <div className="dw-shell dw-center">
      <button className="dw-big-btn" onClick={pick}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="16" cy="16" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="16" cy="8" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="8" cy="16" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
        </svg>
        <span>Surprise Me</span>
        <small>Open a random pick</small>
      </button>
    </div>
  );
}
