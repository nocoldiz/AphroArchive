// ─── Home dashboard widget registry ──────────────────────────────────
// Each widget is self-contained: it renders its own titled content and
// pulls from the shared store signals. The Dashboard adds the resize /
// remove / drag chrome in edit mode — widgets don't worry about that.
//
// Plugins can contribute widgets by declaring `homeWidget` in their
// meta.json; those are surfaced as `plugin:<id>` types (see allWidgetDefs).

import { useState, useEffect, useMemo } from 'preact/hooks';
import { ComponentChildren } from 'preact';
import { Video } from '../types';
import {
  currentView, currentCategory, currentTag, currentTagTerms, currentActor,
  allVideos, categories, favFilter, showConnectModal,
} from '../store';
import { pluginsList, runPluginAction } from '../plugins';
import { getAllProgress, clearProgress } from './progress';
import { homeHistory, loadHomeHistory } from './homeData';
import { recommend } from './recommend';
import { WidgetInstance, updateInstance } from './dashboardStore';

// ── helpers ──────────────────────────────────────────────────────────
const openVid = (id: string) => (window as any).openVid?.(id);

const nav = (view: string, path?: string) => {
  currentView.value = view;
  if (path) history.pushState(null, '', path);
};

const thumbFor = (v: Video) => v.isLink ? (v.img || '') : `/api/thumbs/${v.id}/0`;

const localVideos = () => allVideos.value.filter(v => !v.isLink);

function fmtTime(s: number) {
  if (!isFinite(s) || s <= 0) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(sec).padStart(2, '0');
}

// ── shared presentational pieces ─────────────────────────────────────
const WidgetShell = ({ title, action, children }: {
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

const MiniCard = ({ video, progress, onRemove }: {
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

const Row = ({ items, render, empty }: {
  items: Video[];
  render?: (v: Video) => ComponentChildren;
  empty: string;
}) => {
  if (!items.length) return <div className="dw-empty">{empty}</div>;
  return (
    <div className="dw-row">
      {items.map(v => render ? render(v) : <MiniCard key={v.id} video={v} />)}
    </div>
  );
};

// ── widget components ────────────────────────────────────────────────

const HeroWidget = () => {
  const pool = useMemo(() => {
    const favs = localVideos().filter(v => v.starred || v.fav);
    const recent = [...localVideos()].sort((a, b) => b.mtime - a.mtime).slice(0, 12);
    const base = (favs.length ? favs : recent).filter(v => thumbFor(v));
    return base.slice(0, 5);
  }, [allVideos.value]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (pool.length < 2) return;
    const t = setInterval(() => setIdx(i => (i + 1) % pool.length), 6000);
    return () => clearInterval(t);
  }, [pool.length]);

  if (!pool.length) return <div className="dw-shell"><div className="dw-empty">Add videos to feature them here.</div></div>;
  const v = pool[Math.min(idx, pool.length - 1)];
  return (
    <div className="dw-hero" style={{ backgroundImage: `url(${thumbFor(v)})` }}>
      <div className="dw-hero-grad" />
      <div className="dw-hero-info">
        <div className="dw-hero-tag">Featured</div>
        <h2 className="dw-hero-title">{v.name}</h2>
        <button className="dw-hero-play" onClick={() => openVid(v.id)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          Play
        </button>
      </div>
      {pool.length > 1 &&
        <div className="dw-hero-dots">
          {pool.map((_, i) => <span key={i} className={'dw-dot' + (i === idx ? ' on' : '')} onClick={() => setIdx(i)} />)}
        </div>}
    </div>
  );
};

const ContinueWatchingWidget = () => {
  const prog = getAllProgress();
  const [, force] = useState(0);
  const items = useMemo(() => {
    const byId = new Map(allVideos.value.map(v => [v.id, v]));
    return Object.entries(prog)
      .filter(([id]) => byId.has(id))
      .sort((a, b) => b[1].ts - a[1].ts)
      .map(([id, p]) => ({ v: byId.get(id)!, pct: (p.t / p.d) * 100 }));
  }, [allVideos.value, JSON.stringify(prog)]);

  return (
    <WidgetShell title="Continue Watching">
      {items.length === 0
        ? <div className="dw-empty">Nothing in progress — start a video and it'll show up here.</div>
        : <div className="dw-row">
            {items.map(({ v, pct }) =>
              <MiniCard key={v.id} video={v} progress={pct}
                onRemove={() => { clearProgress(v.id); force(x => x + 1); }} />
            )}
          </div>}
    </WidgetShell>
  );
};

const NewAdditionsWidget = () => {
  const items = useMemo(() => [...localVideos()].sort((a, b) => b.mtime - a.mtime).slice(0, 20), [allVideos.value]);
  return (
    <WidgetShell title="New Additions" action={{ label: 'Browse all', onClick: () => { currentCategory.value = ''; nav('browse'); } }}>
      <Row items={items} empty="No videos yet." />
    </WidgetShell>
  );
};

const RecommendedWidget = () => {
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
};

const RecentlyWatchedWidget = () => {
  useEffect(() => { loadHomeHistory(); }, []);
  const items = homeHistory.value.slice(0, 20);
  return (
    <WidgetShell title="Recently Watched" action={{ label: 'See all', onClick: () => nav('recent', '/recent') }}>
      <Row items={items} empty="Your watch history is empty." />
    </WidgetShell>
  );
};

const SurpriseWidget = ({ instance }: { instance: WidgetInstance }) => {
  const pick = () => {
    let pool = localVideos();
    if (instance.config?.unwatchedOnly !== false) {
      const watched = new Set(homeHistory.value.map(v => v.id));
      const unwatched = pool.filter(v => !watched.has(v.id));
      if (unwatched.length) pool = unwatched;
    }
    if (!pool.length) { (window as any).toast?.('No videos to pick from'); return; }
    const v = pool[Math.floor(Math.random() * pool.length)];
    openVid(v.id);
  };
  useEffect(() => { loadHomeHistory(); }, []);
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
};

const TonightWidget = () => {
  useEffect(() => { loadHomeHistory(); }, []);
  const pick = useMemo(() => {
    const recs = recommend(allVideos.value, homeHistory.value, 30);
    if (!recs.length) return null;
    // Deterministic per-day rotation, nudged by time of day.
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
};

const MoodWidget = () => {
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of allVideos.value) {
      for (const t of (v.tags || [])) {
        const k = t.trim();
        if (k) counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
    let top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(e => e[0]);
    if (top.length < 6) {
      // Fall back to categories when there aren't enough tags.
      const cats = categories.value.filter(c => c.path && c.path !== 'Links').slice(0, 12).map(c => c.name);
      top = [...new Set([...top, ...cats])].slice(0, 18);
    }
    return top;
  }, [allVideos.value, categories.value]);

  const openTag = (t: string) => {
    currentTag.value = t;
    currentTagTerms.value = [];
    currentCategory.value = '';
    nav('browse', `/tag/${encodeURIComponent(t)}`);
  };

  return (
    <WidgetShell title="Browse by Mood">
      {tags.length
        ? <div className="dw-tiles">{tags.map(t => <button key={t} className="dw-tile" onClick={() => openTag(t)}>{t}</button>)}</div>
        : <div className="dw-empty">Tag your videos to unlock mood browsing.</div>}
    </WidgetShell>
  );
};

const PinnedShelfWidget = ({ instance }: { instance: WidgetInstance }) => {
  const cfg = instance.config || {};
  const [editing, setEditing] = useState(!cfg.value);
  const [collItems, setCollItems] = useState<Video[] | null>(null);

  useEffect(() => {
    if (cfg.kind === 'collection' && cfg.value) {
      fetch(`/api/collections/${encodeURIComponent(cfg.value)}/videos`)
        .then(r => r.json()).then(d => setCollItems(Array.isArray(d) ? d : [])).catch(() => setCollItems([]));
    }
  }, [cfg.kind, cfg.value]);

  const items = useMemo(() => {
    if (!cfg.value) return [];
    if (cfg.kind === 'collection') return collItems || [];
    const lo = String(cfg.value).toLowerCase();
    return allVideos.value.filter(v => {
      if (cfg.kind === 'category') {
        const vp = (v.catPath || '').toLowerCase();
        return vp === lo || vp.startsWith(lo + '/') || (v.category || '').toLowerCase() === lo;
      }
      if (cfg.kind === 'tag') return (v.tags || []).some(t => t.toLowerCase() === lo);
      if (cfg.kind === 'actor') return (v.actors || []).some(a => a.toLowerCase() === lo);
      return false;
    }).slice(0, 30);
  }, [cfg.kind, cfg.value, allVideos.value, collItems]);

  const title = cfg.title || (cfg.value ? `${cfg.value}` : 'Pinned Shelf');

  if (editing) {
    return (
      <div className="dw-shell">
        <div className="dw-head"><h3 className="dw-title">Pinned Shelf</h3></div>
        <PinnedShelfConfig instance={instance} onDone={() => setEditing(false)} />
      </div>
    );
  }

  return (
    <WidgetShell title={title} action={{ label: 'Edit', onClick: () => setEditing(true) }}>
      <Row items={items} empty="Nothing matches this shelf yet." />
    </WidgetShell>
  );
};

export const PinnedShelfConfig = ({ instance, onDone }: { instance: WidgetInstance; onDone: () => void }) => {
  const cfg = instance.config || {};
  const [kind, setKind] = useState(cfg.kind || 'category');
  const [value, setValue] = useState(cfg.value || '');
  const [title, setTitle] = useState(cfg.title || '');

  const options = useMemo(() => {
    if (kind === 'category') return categories.value.filter(c => c.path && c.path !== 'Links').map(c => c.path);
    if (kind === 'tag') {
      const s = new Set<string>();
      allVideos.value.forEach(v => (v.tags || []).forEach(t => s.add(t)));
      return [...s].sort();
    }
    if (kind === 'actor') {
      const s = new Set<string>();
      allVideos.value.forEach(v => (v.actors || []).forEach(a => s.add(a)));
      return [...s].sort();
    }
    return [];
  }, [kind, categories.value, allVideos.value]);

  const save = () => {
    if (!value) { (window as any).toast?.('Pick a source first'); return; }
    updateInstance(instance.iid, { config: { kind, value, title: title.trim() || undefined } });
    onDone();
  };

  return (
    <div className="dw-cfg">
      <label>Source
        <select value={kind} onChange={(e: any) => { setKind(e.target.value); setValue(''); }}>
          <option value="category">Folder</option>
          <option value="tag">Tag</option>
          <option value="actor">Actor</option>
          <option value="collection">Playlist</option>
        </select>
      </label>
      <label>{kind === 'collection' ? 'Playlist name' : 'Value'}
        {kind === 'collection'
          ? <input value={value} onInput={(e: any) => setValue(e.target.value)} placeholder="Playlist name" />
          : <select value={value} onChange={(e: any) => setValue(e.target.value)}>
              <option value="">— choose —</option>
              {options.map(o => <option key={o} value={o}>{o}</option>)}
            </select>}
      </label>
      <label>Title (optional)
        <input value={title} onInput={(e: any) => setTitle(e.target.value)} placeholder="Custom row title" />
      </label>
      <button className="dw-cfg-save" onClick={save}>Save shelf</button>
    </div>
  );
};

// Library shortcut cards (ports the original home cards so navigation
// stays one click away inside the new dashboard).
const QuickLinksWidget = () => {
  const Card = ({ label, desc, onClick }: { label: string; desc: string; onClick: () => void }) => (
    <button className="dw-ql-card" onClick={onClick}>
      <div className="dw-ql-name">{label}</div>
      <div className="dw-ql-desc">{desc}</div>
    </button>
  );
  return (
    <WidgetShell title="Quick Links">
      <div className="dw-ql-grid">
        <Card label="Favourites" desc="Your starred videos" onClick={() => { favFilter.value = true; nav('browse'); }} />
        <Card label="Playlists" desc="Saved video groups" onClick={() => nav('collections', '/collections')} />
        <Card label="Vault" desc="Encrypted storage" onClick={() => nav('vault', '/vault')} />
        <Card label="Folders" desc="Browse by folder" onClick={() => nav('categories', '/categories')} />
        <Card label="Actors" desc="Actor database" onClick={() => nav('actors', '/actors')} />
        <Card label="Studios" desc="Studio database" onClick={() => nav('studios', '/studios')} />
        <Card label="Photos" desc="Photo gallery" onClick={() => nav('photos', '/photos')} />
        <Card label="Audio" desc="Music player" onClick={() => nav('audio', '/audio')} />
        <Card label="Books" desc="E-book reader" onClick={() => nav('books', '/books')} />
        <Card label="Links" desc="Imported bookmarks" onClick={() => nav('links', '/links')} />
        <Card label="Database" desc="Edit metadata" onClick={() => nav('database', '/database')} />
        <Card label="Connect" desc="Remote via QR" onClick={() => { showConnectModal.value = true; }} />
        <Card label="Settings" desc="Preferences" onClick={() => nav('settings', '/settings')} />
      </div>
    </WidgetShell>
  );
};

const PluginWidget = ({ pluginId }: { pluginId: string }) => {
  const plugin = pluginsList.value.find(p => p.id === pluginId);
  if (!plugin) return <div className="dw-shell"><div className="dw-empty">Plugin unavailable.</div></div>;
  const hw = (plugin as any).homeWidget || {};
  return (
    <div className="dw-shell dw-center">
      <button className="dw-big-btn" onClick={() => runPluginAction(plugin, currentView)}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
        </svg>
        <span>{hw.name || plugin.name}</span>
        {plugin.description && <small>{plugin.description}</small>}
      </button>
    </div>
  );
};

// ── registry ─────────────────────────────────────────────────────────
export interface WidgetDef {
  type: string;
  name: string;
  description: string;
  defaultW: number;
  defaultH: number;
  minW: number;
  minH: number;
  maxH?: number;
  singleton?: boolean;
  render: (instance: WidgetInstance) => ComponentChildren;
}

export const BUILTIN_WIDGETS: WidgetDef[] = [
  { type: 'hero', name: 'Hero Banner', description: 'Cycling featured-video spotlight', defaultW: 4, defaultH: 2, minW: 2, minH: 2, maxH: 3, singleton: true, render: () => <HeroWidget /> },
  { type: 'continue-watching', name: 'Continue Watching', description: 'Resume in-progress videos', defaultW: 4, defaultH: 2, minW: 2, minH: 2, maxH: 3, singleton: true, render: () => <ContinueWatchingWidget /> },
  { type: 'new-additions', name: 'New Additions', description: 'Your 20 most recent videos', defaultW: 2, defaultH: 2, minW: 2, minH: 2, maxH: 3, singleton: true, render: () => <NewAdditionsWidget /> },
  { type: 'recommended', name: 'Recommended For You', description: 'On-device picks from your history', defaultW: 2, defaultH: 2, minW: 2, minH: 2, maxH: 3, singleton: true, render: () => <RecommendedWidget /> },
  { type: 'recently-watched', name: 'Recently Watched', description: 'Up to 20 recent history entries', defaultW: 2, defaultH: 2, minW: 2, minH: 2, maxH: 3, singleton: true, render: () => <RecentlyWatchedWidget /> },
  { type: 'tonight', name: 'What to Watch Tonight', description: 'A daily rule-based pick', defaultW: 2, defaultH: 1, minW: 2, minH: 1, maxH: 2, singleton: true, render: () => <TonightWidget /> },
  { type: 'surprise', name: 'Surprise Me', description: 'Open a random video instantly', defaultW: 1, defaultH: 1, minW: 1, minH: 1, maxH: 2, singleton: true, render: (i) => <SurpriseWidget instance={i} /> },
  { type: 'mood', name: 'Mood / Genre Browser', description: 'Jump into a tag or genre', defaultW: 4, defaultH: 1, minW: 2, minH: 1, maxH: 2, singleton: true, render: () => <MoodWidget /> },
  { type: 'pinned-shelf', name: 'Pinned Shelf', description: 'A folder, tag, actor or playlist as a row', defaultW: 4, defaultH: 2, minW: 2, minH: 2, maxH: 3, render: (i) => <PinnedShelfWidget instance={i} /> },
  { type: 'quick-links', name: 'Quick Links', description: 'Shortcut cards to every section', defaultW: 4, defaultH: 3, minW: 2, minH: 2, maxH: 4, singleton: true, render: () => <QuickLinksWidget /> },
];

export function pluginWidgetDefs(): WidgetDef[] {
  return pluginsList.value
    .filter(p => (p as any).homeWidget)
    .map(p => {
      const hw = (p as any).homeWidget || {};
      return {
        type: 'plugin:' + p.id,
        name: hw.name || p.name,
        description: p.description || 'Plugin widget',
        defaultW: hw.w || 1,
        defaultH: hw.h || 1,
        minW: 1, minH: 1, maxH: 3,
        singleton: true,
        render: () => <PluginWidget pluginId={p.id} />,
      } as WidgetDef;
    });
}

export function allWidgetDefs(): WidgetDef[] {
  return [...BUILTIN_WIDGETS, ...pluginWidgetDefs()];
}

export function getWidgetDef(type: string): WidgetDef | undefined {
  return allWidgetDefs().find(w => w.type === type);
}
