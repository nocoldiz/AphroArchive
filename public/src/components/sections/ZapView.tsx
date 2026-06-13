import { isMuted } from '../../store';
import {
  zapLock, zapMinIv, zapMaxIv, zapRemaining, zapTotalIv, zapQueue, zapHistory,
  zapStartTime, setZapMinIv, setZapMaxIv, toggleZapLock, stopZapping, doZapSwitch,
  jumpToZapVideo, jumpToPrevZap, ZapQueueItem
} from '../../zap';
import { AdvancedPlayer } from '../UI/AdvancedPlayer';

interface ZapViewProps {
  video: any;
  videoRef: any;
  subtitles: any[];
  chapters: any[];
  language: string;
}

const formatSecs = (s: number) => {
  const r = Math.max(0, Math.ceil(s));
  return `${r}s`;
};

export const ZapView = ({ video, videoRef, subtitles, chapters, language }: ZapViewProps) => {
  const remaining = zapRemaining.value;
  const total = zapTotalIv.value;
  const pct = total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0;
  const src = video.isVault ? `/api/vault/stream/${video.id}` : `/api/stream/${video.id}`;

  return (
    <div className="zap-immersive">
      <div className="zap-stage">
        <div className="zap-player-wrap" key={video.id}>
          <AdvancedPlayer
            key={video.id}
            src={src}
            videoId={video.id}
            subtitles={subtitles}
            chapters={chapters}
            language={language}
            videoRef={videoRef}
            isMuted={isMuted.value}
            startTime={zapStartTime.value}
            onNext={doZapSwitch}
            onPrev={jumpToPrevZap}
          />
        </div>
        <video id="zap-preload" style={{ display: 'none' }} />

        <div className="zap-title-overlay">{video.name}</div>

        <div className="zap-hud">
          <div className="zap-timer" title={zapLock.value ? 'Locked — auto-zap paused' : 'Time until next video'}>
            <div className="zap-timer-bar">
              <div className="zap-timer-fill" style={{ width: `${zapLock.value ? 0 : pct}%` }} />
            </div>
            <span className="zap-timer-label">
              {zapLock.value ? 'Locked' : `Next in ${formatSecs(remaining)}`}
            </span>
          </div>

          <div className="zap-controls">
            <button onClick={jumpToPrevZap} disabled={!zapHistory.value.length} title="Previous video">
              ⏮ Prev
            </button>
            <button onClick={() => doZapSwitch()} title="Skip to next video now">
              ⚡ Skip
            </button>
            <button onClick={toggleZapLock} className={zapLock.value ? 'on' : ''} title={zapLock.value ? 'Resume zapping' : 'Lock current video'}>
              {zapLock.value ? '🔒 Locked' : '🔓 Lock'}
            </button>
            <button onClick={stopZapping} className="exit" title="Exit zapping mode">
              ✕ Exit
            </button>
          </div>

          <div className="zap-range">
            <label>
              <span>Min {zapMinIv.value}s</span>
              <input
                type="range"
                min="1"
                max="120"
                value={zapMinIv.value}
                onInput={(e: any) => setZapMinIv(parseInt(e.target.value, 10))}
              />
            </label>
            <label>
              <span>Max {zapMaxIv.value}s</span>
              <input
                type="range"
                min="1"
                max="180"
                value={zapMaxIv.value}
                onInput={(e: any) => setZapMaxIv(parseInt(e.target.value, 10))}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="zap-queue">
        <div className="zap-queue-header">Up Next</div>
        <div className="zap-queue-list">
          {zapQueue.value.map((item: ZapQueueItem) => (
            <div key={item.video.id} className="zap-queue-item" onClick={() => jumpToZapVideo(item)}>
              <img
                src={item.video.isVault ? '' : `/api/thumbs/${item.video.id}/0`}
                alt=""
                onError={(e: any) => e.target.style.visibility = 'hidden'}
              />
              <div className="zap-queue-info">
                <div className="zap-queue-name">{item.video.name}</div>
                <div className="zap-queue-cat">{item.video.category}</div>
              </div>
            </div>
          ))}
          {!zapQueue.value.length && (
            <div className="zap-queue-empty">Building queue…</div>
          )}
        </div>
      </div>
    </div>
  );
};
