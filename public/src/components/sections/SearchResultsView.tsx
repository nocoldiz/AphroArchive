import { useEffect, useMemo, useState } from 'preact/hooks';
import { ComponentChildren } from 'preact';
import {
  searchQuery, searchScopes, searchAllVideos, currentView, thumbBlurMode,
} from '../../store';
import { VideoCard } from '../UI/VideoGrid';

// Each macro category the universal search can surface. The async ones are
// fetched once per session (full list) then filtered client-side.
const SCOPE_LABELS: Record<string, string> = {
  videos: 'Videos', links: 'Links', actors: 'Actors', channels: 'Channels',
  websites: 'Websites', books: 'Books', audio: 'Audio', photos: 'Photos',
  pages: 'Pages', prompts: 'Prompts', collections: 'Playlists',
};

const ASYNC_URLS: Record<string, string> = {
  actors: '/api/actors', channels: '/api/channels', websites: '/api/websites',
  books: '/api/books', audio: '/api/audio', photos: '/api/photos',
  pages: '/api/pages', prompts: '/api/prompts', collections: '/api/collections',
};

// Session cache so re-opening / re-typing doesn't re-fetch each list.
const scopeCache: Record<string, any[]> = {};
async function fetchScope(key: string): Promise<any[]> {
  if (scopeCache[key]) return scopeCache[key];
  const url = ASYNC_URLS[key];
  if (!url) return [];
  try {
    const d = await fetch(url).then(r => r.json());
    const arr = Array.isArray(d) ? d : (d.items || []);
    scopeCache[key] = arr;
    return arr;
  } catch {
    return [];
  }
}

const MEDIA_CAP = 60;
const OTHER_CAP = 30;

const matchTokens = (text: string, tokens: string[]) => {
  const lo = (text || '').toLowerCase();
  return tokens.every(t => lo.includes(t));
};

const w = window as any;

// ── Generic result row used by every non-video/link scope ─────────────
const ResultCard = ({ thumb, fallback, title, sub, onClick }: {
  thumb?: string; fallback: ComponentChildren; title: string; sub?: string; onClick: () => void;
}) => (
  <div
    className="usr-card"
    onClick={onClick}
    role="button"
    tabIndex={0}
    onKeyDown={(e: any) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '8px', cursor: 'pointer' }}
  >
    <div style={{ width: 44, height: 44, flexShrink: 0, borderRadius: '6px', overflow: 'hidden', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tx3)' }}>
      {thumb
        ? <img src={thumb} loading="lazy" alt="" onError={(e: any) => { e.target.style.display = 'none'; }} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : fallback}
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontWeight: 500, color: 'var(--tx)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
      {sub && <div style={{ fontSize: '0.75rem', color: 'var(--tx3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
    </div>
  </div>
);

const Section = ({ title, count, children }: { title: string; count: number; children: ComponentChildren }) => (
  <section style={{ marginBottom: '28px' }}>
    <h3 style={{ display: 'flex', alignItems: 'baseline', gap: '8px', margin: '0 0 12px', fontSize: '1.05rem' }}>
      {title}
      <span style={{ fontSize: '0.8rem', fontWeight: 400, color: 'var(--tx3)' }}>{count}</span>
    </h3>
    {children}
  </section>
);

const icon = (path: string) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" dangerouslySetInnerHTML={{ __html: path }} />
);
const ICONS: Record<string, string> = {
  channels: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  websites: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20"/>',
  books: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  pages: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  prompts: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  collections: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  actors: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
};

const cardGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '10px' } as any;

export const SearchResultsView = () => {
  const q = searchQuery.value;
  const scopes = searchScopes.value;
  const tokens = useMemo(() => q.toLowerCase().split(/\s+/).filter(Boolean), [q]);

  const on = (k: string) => scopes.has(k);

  // Media (videos + links) come straight from the in-memory library list.
  const mediaMatches = useMemo(() => (q ? searchAllVideos(q) : []), [q]);
  const videoMatches = useMemo(() => mediaMatches.filter(v => !v.isLink), [mediaMatches]);
  const linkMatches = useMemo(() => mediaMatches.filter(v => v.isLink), [mediaMatches]);

  // Async scopes — fetch full lists (once) for whichever scopes are enabled.
  const [data, setData] = useState<Record<string, any[]>>({});
  const scopeKey = [...scopes].sort().join(',');
  useEffect(() => {
    let cancelled = false;
    const wanted = Object.keys(ASYNC_URLS).filter(on);
    Promise.all(wanted.map(async k => [k, await fetchScope(k)] as const)).then(pairs => {
      if (!cancelled) setData(Object.fromEntries(pairs));
    });
    return () => { cancelled = true; };
  }, [scopeKey]);

  if (!tokens.length) {
    return <div className="empty-state"><h3>Universal search</h3><p>Type to search across your library.</p></div>;
  }

  const filt = (key: string, textOf: (x: any) => string) =>
    (data[key] || []).filter(x => matchTokens(textOf(x), tokens));

  const actors = on('actors') ? filt('actors', a => `${a.name} ${a.nationality || ''}`) : [];
  const channels = on('channels') ? filt('channels', c => c.name) : [];
  const websites = on('websites') ? filt('websites', s => `${s.name || ''} ${s.url || ''} ${s.description || ''} ${(s.tags || []).join(' ')}`) : [];
  const books = on('books') ? filt('books', b => `${b.title || ''} ${b.filename || ''}`) : [];
  const audio = on('audio') ? filt('audio', a => a.title) : [];
  const photos = on('photos') ? filt('photos', p => `${p.filename || ''} ${p.folder || ''} ${p.aiPrompt || ''}`) : [];
  const pages = on('pages') ? filt('pages', p => p.name) : [];
  const prompts = on('prompts') ? filt('prompts', p => p.text || '') : [];
  const collections = on('collections') ? filt('collections', c => c.name) : [];

  const total = videoMatches.length + linkMatches.length + actors.length + channels.length +
    websites.length + books.length + audio.length + photos.length + pages.length + prompts.length + collections.length;

  const goto = (view: string) => () => { currentView.value = view; };

  return (
    <div className="search-results-view" style={{ padding: '16px 0' }}>
      <div style={{ color: 'var(--tx3)', fontSize: '0.85rem', marginBottom: '16px' }}>
        {total} result{total !== 1 ? 's' : ''} for “{q}”
      </div>

      {total === 0 && (
        <div className="empty-state"><h3>No matches</h3><p>Nothing found in the selected categories. Try widening the search scope from the filter next to the search box.</p></div>
      )}

      {on('videos') && videoMatches.length > 0 && (
        <Section title={SCOPE_LABELS.videos} count={videoMatches.length}>
          <div className="video-grid" data-thumb-mode={thumbBlurMode.value}>
            {videoMatches.slice(0, MEDIA_CAP).map((v, i) => (
              <VideoCard key={v.id} video={v} isSelected={false} index={i} />
            ))}
          </div>
        </Section>
      )}

      {on('links') && linkMatches.length > 0 && (
        <Section title={SCOPE_LABELS.links} count={linkMatches.length}>
          <div className="video-grid" data-thumb-mode={thumbBlurMode.value}>
            {linkMatches.slice(0, MEDIA_CAP).map((v, i) => (
              <VideoCard key={v.id} video={v} isSelected={false} index={i} />
            ))}
          </div>
        </Section>
      )}

      {actors.length > 0 && (
        <Section title={SCOPE_LABELS.actors} count={actors.length}>
          <div style={cardGridStyle}>
            {actors.slice(0, OTHER_CAP).map(a => (
              <ResultCard key={a.name} thumb={`/api/actor-photos/${encodeURIComponent(a.name)}/img`} fallback={icon(ICONS.actors)}
                title={a.name} sub={`${a.count || 0} video${a.count === 1 ? '' : 's'}`}
                onClick={() => w.openActor?.(a.name)} />
            ))}
          </div>
        </Section>
      )}

      {channels.length > 0 && (
        <Section title={SCOPE_LABELS.channels} count={channels.length}>
          <div style={cardGridStyle}>
            {channels.slice(0, OTHER_CAP).map(c => (
              <ResultCard key={c.name} fallback={icon(ICONS.channels)}
                title={c.name} sub={`${c.count || 0} video${c.count === 1 ? '' : 's'}`}
                onClick={() => w.openChannel?.(c.name)} />
            ))}
          </div>
        </Section>
      )}

      {websites.length > 0 && (
        <Section title={SCOPE_LABELS.websites} count={websites.length}>
          <div style={cardGridStyle}>
            {websites.slice(0, OTHER_CAP).map((s, i) => {
              const link = s.url || s.searchURL || '';
              return (
                <ResultCard key={s.name || i}
                  thumb={link ? `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(link)}` : undefined}
                  fallback={icon(ICONS.websites)} title={s.name || link} sub={link}
                  onClick={() => { if (link) window.open(link, '_blank'); }} />
              );
            })}
          </div>
        </Section>
      )}

      {books.length > 0 && (
        <Section title={SCOPE_LABELS.books} count={books.length}>
          <div style={cardGridStyle}>
            {books.slice(0, OTHER_CAP).map(b => (
              <ResultCard key={b.id} fallback={icon(ICONS.books)}
                title={b.title || b.filename} sub={(b.ext || '').replace('.', '').toUpperCase()}
                onClick={goto('books')} />
            ))}
          </div>
        </Section>
      )}

      {audio.length > 0 && (
        <Section title={SCOPE_LABELS.audio} count={audio.length}>
          <div style={cardGridStyle}>
            {audio.slice(0, OTHER_CAP).map(a => (
              <ResultCard key={a.id} fallback={icon(ICONS.audio)}
                title={a.title} sub={(a.ext || '').replace('.', '').toUpperCase()}
                onClick={goto('audio')} />
            ))}
          </div>
        </Section>
      )}

      {photos.length > 0 && (
        <Section title={SCOPE_LABELS.photos} count={photos.length}>
          <div style={cardGridStyle}>
            {photos.slice(0, OTHER_CAP).map(p => (
              <ResultCard key={p.id} thumb={`/api/photos/${p.id}/img`} fallback={icon(ICONS.pages)}
                title={p.filename} sub={p.folder || ''} onClick={goto('photos')} />
            ))}
          </div>
        </Section>
      )}

      {pages.length > 0 && (
        <Section title={SCOPE_LABELS.pages} count={pages.length}>
          <div style={cardGridStyle}>
            {pages.slice(0, OTHER_CAP).map(p => (
              <ResultCard key={p.id} fallback={icon(ICONS.pages)} title={p.name} sub={p.sizeF || ''} onClick={goto('pages')} />
            ))}
          </div>
        </Section>
      )}

      {prompts.length > 0 && (
        <Section title={SCOPE_LABELS.prompts} count={prompts.length}>
          <div style={cardGridStyle}>
            {prompts.slice(0, OTHER_CAP).map(p => (
              <ResultCard key={p.id} fallback={icon(ICONS.prompts)}
                title={(p.text || '').slice(0, 80) || 'Prompt'} sub={(p.sites || []).join(', ')}
                onClick={goto('prompts')} />
            ))}
          </div>
        </Section>
      )}

      {collections.length > 0 && (
        <Section title={SCOPE_LABELS.collections} count={collections.length}>
          <div style={cardGridStyle}>
            {collections.slice(0, OTHER_CAP).map(c => (
              <ResultCard key={c.name}
                thumb={c.thumb ? `/api/thumbs/${c.thumb.id}/0` : undefined} fallback={icon(ICONS.collections)}
                title={c.name} sub={`${c.count || 0} item${c.count === 1 ? '' : 's'}`}
                onClick={() => { if (w.openCollectionDetail) w.openCollectionDetail(c.name); else currentView.value = 'collections'; }} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
};
