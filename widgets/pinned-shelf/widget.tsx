// Pinned Shelf widget — a configurable row sourced from a folder, tag,
// actor or playlist. Multiple instances allowed; each is configured inline.
import { useState, useEffect, useMemo } from 'preact/hooks';
import { Video } from '../../public/src/types';
import { allVideos, folders } from '../../public/src/store';
import { WidgetShell, Row, WidgetInstance } from '../../public/src/home/shared';
import { updateInstance } from '../../public/src/home/dashboardStore';

function PinnedShelfConfig({ instance, onDone }: { instance: WidgetInstance; onDone: () => void }) {
  const cfg = instance.config || {};
  const [kind, setKind] = useState(cfg.kind || 'category');
  const [value, setValue] = useState(cfg.value || '');
  const [title, setTitle] = useState(cfg.title || '');

  const options = useMemo(() => {
    if (kind === 'category') return folders.value.filter(c => c.path && c.path !== 'Links').map(c => c.path);
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
  }, [kind, folders.value, allVideos.value]);

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
          <option value="playlist">Playlist</option>
        </select>
      </label>
      <label>{kind === 'playlist' ? 'Playlist name' : 'Value'}
        {kind === 'playlist'
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
}

export default function PinnedShelfWidget(instance: WidgetInstance) {
  const cfg = instance.config || {};
  const [editing, setEditing] = useState(!cfg.value);
  const [collItems, setCollItems] = useState<Video[] | null>(null);

  useEffect(() => {
    // Accept the legacy 'collection' kind from shelves saved before the rename.
    if ((cfg.kind === 'playlist' || cfg.kind === 'collection') && cfg.value) {
      fetch(`/api/playlists/${encodeURIComponent(cfg.value)}/videos`)
        .then(r => r.json()).then(d => setCollItems(Array.isArray(d) ? d : [])).catch(() => setCollItems([]));
    }
  }, [cfg.kind, cfg.value]);

  const items = useMemo(() => {
    if (!cfg.value) return [];
    if (cfg.kind === 'playlist' || cfg.kind === 'collection') return collItems || [];
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

  if (editing) {
    return (
      <div className="dw-shell">
        <div className="dw-head"><h3 className="dw-title">Pinned Shelf</h3></div>
        <PinnedShelfConfig instance={instance} onDone={() => setEditing(false)} />
      </div>
    );
  }

  return (
    <WidgetShell title={cfg.title || String(cfg.value)} action={{ label: 'Edit', onClick: () => setEditing(true) }}>
      <Row items={items} empty="Nothing matches this shelf yet." />
    </WidgetShell>
  );
}
