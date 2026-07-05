import { useState, useEffect, useMemo } from 'preact/hooks';
import { signal } from '@preact/signals';
import { allVideos, loadVideos, applyVideoIdChange } from '../../store';
import { Video } from '../../types';
import { renameVideo } from '../../api';
import { alertDialog } from '../../dialog';

// ── Session state ─────────────────────────────────────────────────────────
// Videos renamed this session live in a module-level signal so they survive the
// view remount (MainContent re-keys on view change) and stay out of the
// "unclear" list even if a new name happens to still look unclear.
interface RenamedItem { id: string; oldName: string; newName: string }
const renamedItems = signal<RenamedItem[]>([]);

// ── Unclear-name detection ────────────────────────────────────────────────
// Generic filler words that carry no meaning on their own — a name built only
// from these (plus numbers) tells you nothing about the video.
const GENERIC = new Set([
  'video', 'vid', 'movie', 'mov', 'mvi', 'clip', 'clips', 'output', 'download',
  'downloaded', 'downloads', 'final', 'new', 'old', 'untitled', 'unnamed',
  'temp', 'tmp', 'copy', 'file', 'files', 'record', 'recording', 'rec',
  'sample', 'test', 'stream', 'capture', 'cam', 'webcam', 'scene', 'part',
  'full', 'hd', 'fhd', 'sd', 'uhd', '4k', 'default', 'media', 'unknown',
  'videoplayback', 'img', 'dsc', 'dscn', 'mp4', 'export', 'render', 'out',
  'watch', 'play', 'source', 'raw', 'edit', 'edited', 'trim', 'trimmed',
]);

const stripExt = (name: string) => name.replace(/\.[^.]+$/, '').trim();

// Returns a short reason string when the name is unclear, or null when it's fine.
function unclearReason(rawName: string, knownWords: Set<string>, knownPhrases: string[]): string | null {
  const base = stripExt(rawName);
  if (!base) return 'empty';

  const compact = base.replace(/[\s_\-.()[\]]+/g, '');
  const letters = base.replace(/[^a-zA-Z]/g, '');

  // No letters at all → pure numbers / symbols / date
  if (letters.length === 0) {
    if (/\d{4}[-_.]?\d{2}[-_.]?\d{2}/.test(base)) return 'date only';
    return 'numbers only';
  }
  // Long hex blob (checksums, hashes)
  if (/^[a-f0-9]{16,}$/i.test(compact)) return 'hash';
  // GUID
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(base)) return 'GUID';
  // Almost no letters (e.g. "a12938471")
  if (letters.length < 3) return 'few letters';

  const words = base.toLowerCase().split(/[\s_\-.()[\]]+/).filter(Boolean);
  // Meaningful words = not generic filler, not pure numbers, not resolution tags
  const meaningful = words.filter(w =>
    !GENERIC.has(w) &&
    !/^\d+$/.test(w) &&
    !/^\d{3,4}p$/.test(w) &&
    !/^[a-f0-9]{8,}$/i.test(w),
  );
  if (meaningful.length === 0) return 'generic';

  // Date-dominant name with a single other token
  if (/^\d{4}[-_.]\d{2}[-_.]\d{2}/.test(base) && meaningful.length <= 1) return 'date';

  // No recognized tag anywhere in the title
  const lower = base.toLowerCase();
  const hasWord = words.some(w => knownWords.has(w));
  const hasPhrase = knownPhrases.some(p => lower.includes(p));
  if (!hasWord && !hasPhrase) return 'no known tag';

  return null;
}

const REASON_COLORS: Record<string, string> = {
  'numbers only': '#e8842a',
  'date only': '#e8842a',
  'date': '#e8842a',
  'hash': '#c44',
  'GUID': '#c44',
  'few letters': '#c44',
  'generic': '#b08a2a',
  'no known tag': '#5a8ac0',
  'empty': '#c44',
};

// ── Thumbnail strip ────────────────────────────────────────────────────────
const ThumbStrip = ({ id }: { id: string }) => (
  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
    {[0, 1, 2, 3, 4].map(idx => (
      <img
        key={idx}
        src={`/api/thumbs/${id}/${idx}`}
        alt=""
        loading="lazy"
        style={{ width: '84px', height: '48px', objectFit: 'cover', borderRadius: '4px', background: 'var(--bg4)', display: 'block' }}
        onError={(e: any) => { e.target.style.display = 'none'; }}
      />
    ))}
  </div>
);

// ── Tag editor (per row) ───────────────────────────────────────────────────
const TagEditor = ({ vidId, suggestions }: { vidId: string; suggestions: string[] }) => {
  const [tags, setTags] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/videos/${vidId}/tags`)
      .then(r => r.json())
      .then(d => { if (alive) { setTags(d.tags || []); setLoaded(true); } })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [vidId]);

  const save = async (next: string[]) => {
    setTags(next);
    try {
      await fetch(`/api/videos/${vidId}/meta`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: next }),
      });
    } catch { /* leave optimistic state */ }
  };

  const add = (tag: string) => {
    tag = tag.trim();
    if (!tag || tags.some(t => t.toLowerCase() === tag.toLowerCase())) { setQuery(''); return; }
    save([...tags, tag]);
    setQuery('');
  };
  const remove = (tag: string) => save(tags.filter(t => t !== tag));

  const filtered = query
    ? suggestions.filter(s =>
        s.toLowerCase().includes(query.toLowerCase()) &&
        !tags.some(t => t.toLowerCase() === s.toLowerCase())).slice(0, 6)
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', minWidth: '160px' }}>
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
        {tags.map(t => (
          <span key={t} style={{ background: 'var(--bg3)', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            {t}
            <button type="button" onClick={() => remove(t)} title="Remove tag"
              style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: '12px' }}>×</button>
          </span>
        ))}
        {loaded && tags.length === 0 && <span style={{ fontSize: '11px', color: 'var(--tx3)', fontStyle: 'italic' }}>no tags</span>}
      </div>
      <div style={{ position: 'relative' }}>
        <input
          type="text" value={query} placeholder="+ tag" aria-label="Add tag"
          onInput={(e: any) => setQuery(e.target.value)}
          onKeyDown={(e: any) => { if (e.key === 'Enter' && query.trim()) add(query.trim()); }}
          style={{ width: '100%', background: 'var(--bg3)', color: 'var(--tx)', border: '1px solid var(--brd)', borderRadius: '4px', padding: '3px 6px', fontSize: '11px' }}
        />
        {filtered.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5, background: 'var(--bg2)', border: '1px solid var(--brd)', borderRadius: '4px', marginTop: '2px', maxHeight: '140px', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
            {filtered.map(s => (
              <div key={s} onClick={() => add(s)}
                style={{ padding: '4px 8px', fontSize: '11px', cursor: 'pointer' }}
                onMouseEnter={(e: any) => e.currentTarget.style.background = 'var(--bg3)'}
                onMouseLeave={(e: any) => e.currentTarget.style.background = 'transparent'}>
                {s}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Rename cell ────────────────────────────────────────────────────────────
const RenameCell = ({ video, onRenamed }: { video: Video; onRenamed: (newId: string, oldName: string, newName: string) => void }) => {
  const [name, setName] = useState(stripExt(video.name));
  const [saving, setSaving] = useState(false);

  const dirty = name.trim() !== stripExt(video.name);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || !dirty || saving) return;
    setSaving(true);
    try {
      const res = await renameVideo(video.id, trimmed);
      applyVideoIdChange(video.id, res.newId, { name: trimmed });
      onRenamed(res.newId, stripExt(video.name), trimmed);
      const w = window as any;
      if (w.toast) w.toast('Renamed');
    } catch (e: any) {
      await alertDialog(e.message || 'Rename failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
      <input
        type="text" value={name} aria-label="New name"
        onInput={(e: any) => setName(e.target.value)}
        onKeyDown={(e: any) => { if (e.key === 'Enter') save(); }}
        style={{ flex: 1, minWidth: '180px', background: 'var(--bg3)', color: 'var(--tx)', border: `1px solid ${dirty ? 'var(--ac)' : 'var(--brd)'}`, borderRadius: '5px', padding: '6px 8px', fontSize: '13px' }}
      />
      <button type="button" onClick={save} disabled={!dirty || saving}
        style={{ padding: '6px 12px', background: dirty ? 'var(--ac)' : 'var(--bg3)', color: dirty ? '#fff' : 'var(--tx3)', border: dirty ? 'none' : '1px solid var(--brd)', borderRadius: '5px', cursor: dirty && !saving ? 'pointer' : 'default', fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap' }}>
        {saving ? '…' : 'Rename'}
      </button>
    </div>
  );
};

// ── Main view ──────────────────────────────────────────────────────────────
const PAGE = 40;

export const RenamerView = () => {
  const vids = allVideos.value;
  const renamed = renamedItems.value;

  const [tab, setTab] = useState<'unclear' | 'renamed'>('unclear');
  const [reasonFilter, setReasonFilter] = useState<string>('all');
  const [limit, setLimit] = useState(PAGE);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    if (allVideos.value.length === 0) loadVideos();
    fetch('/api/tag-suggestions').then(r => r.json()).then(d => setSuggestions(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  // Known-tag lookup: single words for exact word match, multi-word phrases for
  // substring match.
  const { knownWords, knownPhrases } = useMemo(() => {
    const words = new Set<string>();
    const phrases: string[] = [];
    for (const s of suggestions) {
      const lo = s.toLowerCase().trim();
      if (!lo) continue;
      if (lo.includes(' ')) phrases.push(lo);
      else words.add(lo);
    }
    return { knownWords: words, knownPhrases: phrases };
  }, [suggestions]);

  const renamedIds = useMemo(() => new Set(renamed.map(r => r.id)), [renamed]);

  // Compute the unclear list from local videos (links have no files to rename).
  const unclear = useMemo(() => {
    const out: { video: Video; reason: string }[] = [];
    for (const v of vids) {
      if (v.isLink || renamedIds.has(v.id)) continue;
      const reason = unclearReason(v.name, knownWords, knownPhrases);
      if (reason) out.push({ video: v, reason });
    }
    return out;
  }, [vids, knownWords, knownPhrases, renamedIds]);

  const reasonCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of unclear) m.set(u.reason, (m.get(u.reason) || 0) + 1);
    return m;
  }, [unclear]);

  const filtered = reasonFilter === 'all' ? unclear : unclear.filter(u => u.reason === reasonFilter);
  const shown = filtered.slice(0, limit);

  const handleRenamed = (newId: string, oldName: string, newName: string) => {
    // applyVideoIdChange already ran; record under the new id so it stays hidden.
    renamedItems.value = [{ id: newId, oldName, newName }, ...renamedItems.value.filter(r => r.id !== newId)];
  };

  const wrapStyle = { padding: '16px', maxWidth: '1400px', margin: '0 auto' };
  const tabBtn = (active: boolean) => ({
    padding: '8px 18px', background: active ? 'var(--ac)' : 'var(--bg3)', color: active ? '#fff' : 'var(--tx2)',
    border: active ? 'none' : '1px solid var(--brd)', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
  });

  return (
    <div style={wrapStyle}>
      <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
        Renamer
        <span style={{ fontSize: '12px', fontWeight: 400, color: 'var(--tx3)' }}>
          Clean up unclear file names
        </span>
      </h2>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button type="button" style={tabBtn(tab === 'unclear')} onClick={() => setTab('unclear')}>
          Unclear names <span style={{ opacity: 0.8 }}>({unclear.length})</span>
        </button>
        <button type="button" style={tabBtn(tab === 'renamed')} onClick={() => setTab('renamed')}>
          Renamed <span style={{ opacity: 0.8 }}>({renamed.length})</span>
        </button>
      </div>

      {tab === 'unclear' ? (
        <>
          {/* Reason filter chips */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
            <button type="button" onClick={() => { setReasonFilter('all'); setLimit(PAGE); }}
              style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '11px', cursor: 'pointer', border: '1px solid var(--brd)', background: reasonFilter === 'all' ? 'var(--tx)' : 'var(--bg3)', color: reasonFilter === 'all' ? 'var(--bg)' : 'var(--tx2)' }}>
              All ({unclear.length})
            </button>
            {[...reasonCounts.entries()].sort((a, b) => b[1] - a[1]).map(([reason, count]) => (
              <button key={reason} type="button" onClick={() => { setReasonFilter(reason); setLimit(PAGE); }}
                style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '11px', cursor: 'pointer', border: `1px solid ${REASON_COLORS[reason] || 'var(--brd)'}`, background: reasonFilter === reason ? (REASON_COLORS[reason] || 'var(--ac)') : 'var(--bg3)', color: reasonFilter === reason ? '#fff' : 'var(--tx2)' }}>
                {reason} ({count})
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--tx3)' }}>
              {vids.length === 0 ? 'Loading videos…' : '🎉 No unclear names — everything looks good!'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--tx3)' }}>
                    <th style={{ padding: '6px 8px', fontWeight: 600 }}>Thumbnails</th>
                    <th style={{ padding: '6px 8px', fontWeight: 600, minWidth: '260px' }}>Name</th>
                    <th style={{ padding: '6px 8px', fontWeight: 600 }}>Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(({ video, reason }) => (
                    <tr key={video.id} style={{ borderTop: '1px solid var(--brd)', verticalAlign: 'top' }}>
                      <td style={{ padding: '10px 8px' }}>
                        <ThumbStrip id={video.id} />
                      </td>
                      <td style={{ padding: '10px 8px' }}>
                        <div style={{ marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span title={video.name} style={{ fontSize: '11px', color: 'var(--tx3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '320px' }}>
                            {video.name}
                          </span>
                          <span style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#fff', background: REASON_COLORS[reason] || 'var(--tx3)', padding: '1px 6px', borderRadius: '3px', whiteSpace: 'nowrap' }}>
                            {reason}
                          </span>
                          {video.category && <span style={{ fontSize: '10px', color: 'var(--tx3)' }}>📁 {video.category}</span>}
                        </div>
                        <RenameCell
                          video={video}
                          onRenamed={(newId, oldName, newName) => handleRenamed(newId, oldName, newName)}
                        />
                      </td>
                      <td style={{ padding: '10px 8px' }}>
                        <TagEditor vidId={video.id} suggestions={suggestions} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {filtered.length > shown.length && (
                <div style={{ textAlign: 'center', marginTop: '16px' }}>
                  <button type="button" onClick={() => setLimit(l => l + PAGE)}
                    style={{ padding: '8px 20px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                    Show more ({filtered.length - shown.length} remaining)
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        // ── Renamed tab ──
        renamed.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--tx3)' }}>
            Nothing renamed yet. Renamed files move here and drop off the Unclear list.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--tx3)' }}>
                <th style={{ padding: '6px 8px', fontWeight: 600 }}>Thumbnail</th>
                <th style={{ padding: '6px 8px', fontWeight: 600 }}>Old name</th>
                <th style={{ padding: '6px 8px', fontWeight: 600 }}>New name</th>
              </tr>
            </thead>
            <tbody>
              {renamed.map(r => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--brd)' }}>
                  <td style={{ padding: '10px 8px' }}>
                    <img src={`/api/thumbs/${r.id}/0`} alt="" loading="lazy"
                      style={{ width: '84px', height: '48px', objectFit: 'cover', borderRadius: '4px', background: 'var(--bg4)' }}
                      onError={(e: any) => { e.target.style.display = 'none'; }} />
                  </td>
                  <td style={{ padding: '10px 8px', fontSize: '12px', color: 'var(--tx3)', textDecoration: 'line-through' }}>{r.oldName}</td>
                  <td style={{ padding: '10px 8px', fontSize: '13px', color: 'var(--tx)', fontWeight: 500 }}>{r.newName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  );
};
