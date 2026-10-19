import { useState, useEffect } from 'preact/hooks';
import { useEscape } from './useEscape';

interface LinkItem {
  url: string;
  title: string;
  category?: string;
  hasVideo?: boolean;
  scrapedVideoUrl?: string;
  hasEmbed?: boolean;
  embedUrl?: string;
  downloaded?: boolean;
}

interface Props {
  onImport: (items: { url: string; category: string }[]) => void;
  onClose: () => void;
}

const domainOf = (url: string) => { try { return new URL(url).hostname; } catch { return url; } };

export const ImportLinksToQueueModal = ({ onImport, onClose }: Props) => {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<LinkItem[]>([]);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEscape(true, onClose);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/links/cache?limit=0');
        const d = await r.json();
        const undownloaded: LinkItem[] = (d.items || []).filter((it: LinkItem) => it.url && !it.downloaded);
        setItems(undownloaded);
      } catch {}
      setLoading(false);
    })();
  }, []);

  const term = filter.trim().toLowerCase();
  const filtered = term
    ? items.filter(it =>
        (it.title || '').toLowerCase().includes(term) ||
        it.url.toLowerCase().includes(term) ||
        domainOf(it.url).toLowerCase().includes(term))
    : items;

  const isSupported = (it: LinkItem) => !!(it.hasVideo || it.scrapedVideoUrl);
  const supported = filtered.filter(isSupported);
  const unsupported = filtered.filter(it => !isSupported(it));

  const toggle = (url: string) =>
    setSelected(prev => { const n = new Set(prev); n.has(url) ? n.delete(url) : n.add(url); return n; });

  const setMany = (urls: string[], on: boolean) =>
    setSelected(prev => { const n = new Set(prev); urls.forEach(u => on ? n.add(u) : n.delete(u)); return n; });

  // Plain render function, not a nested component: a component defined inside
  // the parent is a new type every render, so every keystroke remounted the list.
  const renderSection = (title: string, list: LinkItem[], hint: string) => {
    const urls = list.map(it => it.url);
    const allSelected = urls.length > 0 && urls.every(u => selected.has(u));
    const someSelected = urls.some(u => selected.has(u));

    return (
      <div key={title} style={{ marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: 'var(--bg3)', borderBottom: '1px solid var(--brd)', position: 'sticky', top: 0, zIndex: 1 }}>
          <input
            type="checkbox"
            aria-label={`Select all ${title}`}
            checked={allSelected}
            disabled={urls.length === 0}
            style={{ width: 'auto' }}
            ref={(el: HTMLInputElement | null) => { if (el) el.indeterminate = someSelected && !allSelected; }}
            onChange={() => setMany(urls, !allSelected)}
          />
          <span style={{ fontWeight: 600, fontSize: '13px' }}>{title}</span>
          <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>{list.length}</span>
          <span style={{ fontSize: '11px', color: 'var(--tx3)', marginLeft: 'auto' }}>{hint}</span>
        </div>
        {list.length === 0 ? (
          <div style={{ padding: '14px 16px', fontSize: '12px', color: 'var(--tx3)' }}>None</div>
        ) : (
          list.map(it => {
            const sel = selected.has(it.url);
            return (
              <div
                key={it.url}
                onClick={() => toggle(it.url)}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 16px', cursor: 'pointer', background: sel ? 'var(--acg)' : 'transparent', borderBottom: '1px solid var(--brd)' }}
              >
                <input type="checkbox" aria-label={`Select ${it.title || it.url}`} checked={sel} onChange={() => toggle(it.url)} onClick={(e: any) => e.stopPropagation()} style={{ width: 'auto' }} />
                <img src={`https://www.google.com/s2/favicons?sz=14&domain_url=${encodeURIComponent(it.url)}`} width="14" height="14" alt="" style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.url}>
                  {it.title || it.url}
                </span>
                {it.category && (
                  <span style={{ fontSize: '11px', color: 'var(--tx3)', whiteSpace: 'nowrap' }}>{it.category}</span>
                )}
                <span style={{ fontSize: '11px', color: 'var(--tx3)', whiteSpace: 'nowrap' }}>{domainOf(it.url)}</span>
              </div>
            );
          })
        )}
      </div>
    );
  };

  return (
    <div className="modal-overlay on" style={{ zIndex: 10000, padding: '20px' }}
      onClick={(e: any) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-dialog" style={{ padding: 0, width: '100%', maxWidth: '700px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--brd)', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <span style={{ fontWeight: 700, fontSize: '15px', flex: 1 }}>Import Links to Download Queue</span>
          {!loading && (
            <span style={{ fontSize: '12px', color: 'var(--tx3)' }}>
              {items.length} link{items.length !== 1 ? 's' : ''} · {selected.size} selected
            </span>
          )}
          <button className="ui-btn ui-btn--ghost ui-btn--icon" onClick={onClose} aria-label="Close" title="Close">✕</button>
        </div>

        {/* Filter */}
        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--brd)', flexShrink: 0 }}>
          <input
            type="text"
            placeholder="Filter by title, URL or website…"
            aria-label="Filter links"
            value={filter}
            onInput={(e: any) => setFilter(e.target.value)}
            autoFocus
          />
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--tx3)' }}>Loading links…</div>
          ) : items.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--tx3)', fontSize: '13px' }}>
              No undownloaded links found
            </div>
          ) : (
            <>
              {renderSection('Supported', supported, 'Direct video found — ready to download')}
              {renderSection('Unsupported', unsupported, 'No video detected — yt-dlp will attempt anyway')}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--brd)', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, background: 'var(--bg3)' }}>
          <span style={{ fontSize: '13px', color: 'var(--tx2)', flex: 1 }}>
            {selected.size > 0 ? `${selected.size} link${selected.size !== 1 ? 's' : ''} selected` : 'No links selected'}
          </span>
          <button className="ui-btn" onClick={onClose}>Cancel</button>
          {/* Import every selected link, not only those matching the current filter —
              the button label counts all of them. */}
          <button
            className="ui-btn ui-btn--primary"
            onClick={() => onImport(items.filter(it => selected.has(it.url)).map(it => ({ url: it.url, category: it.category || '' })))}
            disabled={selected.size === 0}
          >
            Add {selected.size > 0 ? `${selected.size} ` : ''}to Queue
          </button>
        </div>
      </div>
    </div>
  );
};
