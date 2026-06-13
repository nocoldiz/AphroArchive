import { useState, useEffect } from 'preact/hooks';

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
        it.title.toLowerCase().includes(term) ||
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

  const Section = ({ title, list, hint }: { title: string; list: LinkItem[]; hint: string }) => {
    const urls = list.map(it => it.url);
    const allSelected = urls.length > 0 && urls.every(u => selected.has(u));
    const someSelected = urls.some(u => selected.has(u));

    return (
      <div style={{ marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: 'var(--bg3)', borderBottom: '1px solid var(--brd)', position: 'sticky', top: 0, zIndex: 1 }}>
          <input
            type="checkbox"
            aria-label={`Select all ${title}`}
            checked={allSelected}
            disabled={urls.length === 0}
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
                <input type="checkbox" aria-label={`Select ${it.title || it.url}`} checked={sel} onChange={() => toggle(it.url)} onClick={(e: any) => e.stopPropagation()} />
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
      onClick={(e: any) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '12px', width: 'min(700px,100%)', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>

        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--brd)', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <span style={{ fontWeight: 700, fontSize: '15px', flex: 1 }}>Import Links to Download Queue</span>
          {!loading && (
            <span style={{ fontSize: '12px', color: 'var(--tx3)' }}>
              {items.length} link{items.length !== 1 ? 's' : ''} · {selected.size} selected
            </span>
          )}
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '2px 6px' }}>✕</button>
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
            style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '6px', padding: '6px 10px', fontSize: '13px' }}
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
              <Section title="Supported" list={supported} hint="Direct video found — ready to download" />
              <Section title="Unsupported" list={unsupported} hint="No video detected — yt-dlp will attempt anyway" />
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--brd)', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, background: 'var(--bg3)' }}>
          <span style={{ fontSize: '13px', color: 'var(--tx2)', flex: 1 }}>
            {selected.size > 0 ? `${selected.size} link${selected.size !== 1 ? 's' : ''} selected` : 'No links selected'}
          </span>
          <button onClick={onClose} style={{ padding: '7px 16px', background: 'var(--bg2)', border: '1px solid var(--brd)', color: 'var(--tx2)', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Cancel</button>
          <button
            onClick={() => onImport(filtered.filter(it => selected.has(it.url)).map(it => ({ url: it.url, category: it.category || '' })))}
            disabled={selected.size === 0}
            style={{ padding: '7px 16px', background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: selected.size > 0 ? 'pointer' : 'not-allowed', opacity: selected.size > 0 ? 1 : 0.45 }}
          >
            Add {selected.size > 0 ? `${selected.size} ` : ''}to Queue
          </button>
        </div>
      </div>
    </div>
  );
};
