import { useState, useRef, useEffect, useMemo } from 'preact/hooks';
import {
  durationFilter, dateFromFilter, dateToFilter, ratingFilter, resolutionFilter,
  notWatchedFilter, filterActors, filterChannels, filterTags,
  hasActiveFilters, clearAllFilters, actors, channels, allVideos,
} from '../../store';

const DURATIONS = [
  { value: '', label: 'Any' },
  { value: 'short', label: '< 5 min' },
  { value: 'medium', label: '5–30 min' },
  { value: 'long', label: '> 30 min' },
];

const RESOLUTIONS = [
  { value: '', label: 'Any' },
  { value: '4k', label: '4K' },
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
  { value: 'sd', label: 'SD' },
];

// A single faceted multi-select: free-text entry backed by a <datalist> of the
// available options, with selected values shown as removable chips.
const Facet = ({ label, listId, options, sig }: {
  label: string; listId: string; options: string[];
  sig: typeof filterActors;
}) => {
  const [val, setVal] = useState('');
  const selected = sig.value;
  const add = (raw: string) => {
    const v = raw.trim();
    if (!v) return;
    if (!selected.some(s => s.toLowerCase() === v.toLowerCase())) sig.value = [...selected, v];
    setVal('');
  };
  const remove = (v: string) => { sig.value = selected.filter(s => s !== v); };

  return (
    <div className="filter-facet">
      <div className="filter-row-label">{label}</div>
      {selected.length > 0 && (
        <div className="filter-chips">
          {selected.map(s => (
            <span key={s} className="filter-chip">
              {s}
              <button type="button" onClick={() => remove(s)} aria-label={`Remove ${s}`}>×</button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        list={listId}
        value={val}
        placeholder={`Add ${label.toLowerCase()}…`}
        onInput={(e: any) => setVal(e.target.value)}
        onChange={(e: any) => { if (options.includes(e.target.value)) add(e.target.value); }}
        onKeyDown={(e: any) => { if (e.key === 'Enter') { e.preventDefault(); add(val); } }}
      />
      <datalist id={listId}>
        {options.slice(0, 500).map(o => <option key={o} value={o} />)}
      </datalist>
    </div>
  );
};

export const FilterPanel = () => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const actorOpts = useMemo(() => actors.value.map(a => a.name).sort((a, b) => a.localeCompare(b)), [actors.value]);
  const channelOpts = useMemo(() => channels.value.map(c => c.name).sort((a, b) => a.localeCompare(b)), [channels.value]);
  const tagOpts = useMemo(() => {
    const set = new Set<string>();
    for (const v of allVideos.value) for (const t of (v.tags || [])) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allVideos.value]);

  const active = hasActiveFilters.value;
  const count =
    (durationFilter.value ? 1 : 0) + ((dateFromFilter.value || dateToFilter.value) ? 1 : 0) +
    (ratingFilter.value > 0 ? 1 : 0) + (resolutionFilter.value ? 1 : 0) + (notWatchedFilter.value ? 1 : 0) +
    filterActors.value.length + filterChannels.value.length + filterTags.value.length;

  return (
    <div className="filter-panel-wrap" ref={ref}>
      <button className={`sort-btn${active ? ' on' : ''}`} onClick={() => setOpen(o => !o)} title="Filters">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ marginRight: '4px', verticalAlign: '-1px' }}>
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
        Filters{count > 0 ? ` (${count})` : ''}
      </button>

      {open && (
        <div className="filter-panel">
          <div className="filter-panel-head">
            <span>Filters</span>
            {active && <button type="button" className="filter-clear" onClick={clearAllFilters}>Clear all</button>}
          </div>

          <div className="filter-row-label">Duration</div>
          <div className="filter-btn-row">
            {DURATIONS.map(d => (
              <button key={d.value} type="button"
                className={`filter-pill${durationFilter.value === d.value ? ' on' : ''}`}
                onClick={() => durationFilter.value = d.value}>{d.label}</button>
            ))}
          </div>

          <div className="filter-row-label">Resolution</div>
          <div className="filter-btn-row">
            {RESOLUTIONS.map(r => (
              <button key={r.value} type="button"
                className={`filter-pill${resolutionFilter.value === r.value ? ' on' : ''}`}
                onClick={() => resolutionFilter.value = r.value}>{r.label}</button>
            ))}
          </div>

          <div className="filter-row-label">Minimum rating</div>
          <div className="filter-btn-row">
            {[0, 1, 2, 3, 4, 5].map(n => (
              <button key={n} type="button"
                className={`filter-pill${ratingFilter.value === n ? ' on' : ''}`}
                onClick={() => ratingFilter.value = n}>{n === 0 ? 'Any' : `${n}★`}</button>
            ))}
          </div>

          <div className="filter-row-label">Date added</div>
          <div className="filter-date-row">
            <input type="date" value={dateFromFilter.value} onInput={(e: any) => dateFromFilter.value = e.target.value} />
            <span>to</span>
            <input type="date" value={dateToFilter.value} onInput={(e: any) => dateToFilter.value = e.target.value} />
          </div>

          <label className="filter-toggle">
            <input type="checkbox" checked={notWatchedFilter.value} onChange={(e: any) => notWatchedFilter.value = e.target.checked} />
            <span>Unwatched only</span>
          </label>

          <Facet label="Actor" listId="filter-actors-list" options={actorOpts} sig={filterActors} />
          <Facet label="Channel" listId="filter-channels-list" options={channelOpts} sig={filterChannels} />
          <Facet label="Tag" listId="filter-tags-list" options={tagOpts} sig={filterTags} />
        </div>
      )}
    </div>
  );
};
