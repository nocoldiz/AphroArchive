// ─── Shared building blocks for home-dashboard widgets ───────────────
// Widget plugins (plugins/<id>/widget.tsx) import their presentation
// helpers from here so each widget stays a thin, focused module.

import { ComponentChildren } from 'preact';
import { Video } from '../types';
import { currentView, currentFolder, allVideos } from '../store';

export type { WidgetInstance } from './dashboardStore';

export const openVid = (id: string) => (window as any).openVid?.(id);

export const nav = (view: string, path?: string) => {
  currentView.value = view;
  if (path) history.pushState(null, '', path);
};

export const thumbFor = (v: Video) => v.isLink ? (v.img || '') : `/api/thumbs/${v.id}/0`;

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

export const MiniCard = ({ video, progress, onRemove }: {
  video: Video; progress?: number; onRemove?: () => void;
}) => (
  <div className="dw-card" onClick={() => video.isLink ? (video.linkUrl && window.open(video.linkUrl, '_blank')) : openVid(video.id)}>
    <div className="dw-thumb">
      {thumbFor(video)
        ? <img loading="lazy" src={thumbFor(video)} alt="" onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
        : <div className="dw-thumb-empty" />}
      {video.duration ? <span className="dw-dur">{fmtTime(video.duration)}</span> : null}
      {progress !== undefined && progress > 0 &&
        <div className="dw-prog"><div className="dw-prog-fill" style={{ width: Math.min(100, progress) + '%' }} /></div>}
      {onRemove &&
        <button className="dw-card-x" title="Remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}>×</button>}
    </div>
    <div className="dw-card-name">{video.name}</div>
  </div>
);

export const Row = ({ items, empty }: { items: Video[]; empty: string }) => {
  if (!items.length) return <div className="dw-empty">{empty}</div>;
  return <div className="dw-row">{items.map(v => <MiniCard key={v.id} video={v} />)}</div>;
};
