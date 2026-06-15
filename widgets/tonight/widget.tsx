// What to Watch Tonight widget — deterministic daily pick.
import { useEffect, useMemo } from 'preact/hooks';
import { allVideos } from '../../public/src/store';
import { thumbFor, openVid } from '../../public/src/home/shared';
import { homeHistory, loadHomeHistory } from '../../public/src/home/homeData';
import { recommend } from '../../public/src/home/recommend';

export default function TonightWidget() {
  useEffect(() => { loadHomeHistory(); }, []);
  const pick = useMemo(() => {
    const recs = recommend(allVideos.value, homeHistory.value, 30);
    if (!recs.length) return null;
    const now = new Date();
    const daySeed = Number(now.getFullYear() + '' + (now.getMonth() + 1) + '' + now.getDate());
    const late = now.getHours() >= 22 || now.getHours() < 5;
    // Late at night, prefer shorter picks from the top of the list.
    const span = late ? Math.min(8, recs.length) : recs.length;
    return recs[daySeed % span];
  }, [allVideos.value, homeHistory.value]);

  if (!pick) return <div className="dw-shell"><div className="dw-empty">No pick available yet.</div></div>;
  const hour = new Date().getHours();
  const reason = hour >= 22 || hour < 5 ? 'A short one for tonight' : hour < 12 ? 'To kick off your day' : 'Picked for right now';
  return (
    <div className="dw-shell dw-tonight" onClick={() => openVid(pick.id)}>
      <div className="dw-tonight-thumb">
        {thumbFor(pick) ? <img src={thumbFor(pick)} alt="" /> : <div className="dw-thumb-empty" />}
      </div>
      <div className="dw-tonight-info">
        <div className="dw-tonight-label">What to Watch Tonight</div>
        <div className="dw-tonight-name">{pick.name}</div>
        <div className="dw-tonight-reason">{reason}</div>
      </div>
    </div>
  );
}
