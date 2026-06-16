// ─── Shared building blocks for home-dashboard widgets ───────────────
// Widget plugins (plugins/<id>/widget.tsx) import their presentation
// helpers from here so each widget stays a thin, focused module.

import { ComponentChildren } from 'preact';
import { Video } from '../types';
import { currentView, currentFolder, allVideos } from '../store';
import { getThumbPref } from '../thumbPref';
import { VideoCard } from '../components/UI/VideoGrid';

export type { WidgetInstance } from './dashboardStore';

export const openVid = (id: string) => (window as any).openVid?.(id);

export const nav = (view: string, path?: string) => {
  currentView.value = view;
  if (path) history.pushState(null, '', path);
};

// Use the same per-video preferred thumbnail the gallery shows, so widget
// cards and the main grid stay visually consistent.
export const thumbFor = (v: Video) => v.isLink ? (v.img || '') : `/api/thumbs/${v.id}/${getThumbPref(v.id)}`;

export const localVideos = () => allVideos.value.filter(v => !v.isLink);

export function fmtTime(s: number) {
  if (!isFinite(s) || s <= 0) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(sec).padStart(2, '0');
}

export { currentFolder };

export const WidgetShell = ({ title, action, children }: {
  title: string;
  action?: { label: string; onClick: () => void };
  children: ComponentChildren;
}) => (
  <div className="dw-shell">
    <div className="dw-head">
      <h3 className="dw-title">{title}</h3>
      {action && <button className="dw-action" onClick={action.onClick}>{action.label}</button>}
    </div>
    <div className="dw-body">{children}</div>
  </div>
);

// Widget rows render the exact same card as the browse grid (hover-to-play,
// fav star, duration, preferred-thumb, watch-progress bar) so the home view
// stays visually consistent with the library. `progress` is accepted for
// backwards compatibility but ignored — VideoCard derives it from saved
// playback progress itself.
export const MiniCard = ({ video, onRemove }: {
  video: Video; progress?: number; onRemove?: () => void;
}) => (
  <div className="dw-card-wrap">
    <VideoCard video={video} isSelected={false} />
    {onRemove &&
      <button type="button" className="dw-card-x" title="Remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}>×</button>}
  </div>
);

export const Row = ({ items, empty }: { items: Video[]; empty: string }) => {
  if (!items.length) return <div className="dw-empty">{empty}</div>;
  return <div className="dw-row">{items.map(v => <MiniCard key={v.id} video={v} />)}</div>;
};
