import { isLoadingVideos, loadProgress } from '../../store';

// A small circular progress ring shown while the video library is streaming in.
// The arc + percentage reflect how many videos have loaded relative to the
// server's reported total (loadProgress). While the total is still unknown
// (loadProgress === -1) it spins as an indeterminate loader instead.
export const LoadProgress = ({ size = 22 }: { size?: number }) => {
  if (!isLoadingVideos.value) return null;

  const pct = loadProgress.value;
  const indeterminate = pct < 0;
  const clamped = indeterminate ? 25 : Math.max(0, Math.min(100, pct));

  const stroke = 2.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - clamped / 100);

  return (
    <div
      className={`load-progress${indeterminate ? ' load-progress-spin' : ''}`}
      title={indeterminate ? 'Loading videos…' : `Loading videos… ${clamped}%`}
      aria-label={indeterminate ? 'Loading videos' : `Loading videos ${clamped}%`}
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : clamped}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--brd)"
          strokeWidth={stroke}
        />
        <circle
          className="load-progress-arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--ac)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {!indeterminate && <span className="load-progress-pct">{clamped}</span>}
    </div>
  );
};
