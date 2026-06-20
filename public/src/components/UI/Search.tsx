import { searchQuery, currentView, currentFolder, currentTag, currentTagTerms, searchScopes, toggleSearchScope, setAllSearchScopes, SEARCH_SCOPE_KEYS } from '../../store';
import { useState, useEffect, useRef } from 'preact/hooks';

const SCOPE_LABELS: Record<string, string> = {
  videos: 'Videos', links: 'Links', actors: 'Actors', channels: 'Channels',
  websites: 'Websites', books: 'Books', audio: 'Audio', photos: 'Photos',
  pages: 'Pages', prompts: 'Prompts', collections: 'Playlists',
};

const SEARCH_DEBOUNCE_MS = 200;
const SUGGEST_DEBOUNCE_MS = 130;

type SuggestKind = 'title' | 'actor' | 'tag' | 'folder';
interface Suggestion { kind: SuggestKind; value: string; }

const KIND_LABEL: Record<SuggestKind, string> = {
  title: 'Titles', actor: 'Actors', tag: 'Tags', folder: 'Folders',
};

const KindIcon = ({ kind }: { kind: SuggestKind }) => {
  const common = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 } as any;
  if (kind === 'actor') return <svg {...common}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>;
  if (kind === 'tag') return <svg {...common}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /></svg>;
  if (kind === 'folder') return <svg {...common}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>;
  return <svg {...common}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>;
};

export const Search = () => {
  const [acTerms, setAcTerms] = useState<string[]>([]);
  const [hint, setHint] = useState('');
  const [localQuery, setLocalQuery] = useState(searchQuery.value);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [acOpen, setAcOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const debounceRef = useRef<any>(null);
  const suggestRef = useRef<any>(null);
  const suggestSeq = useRef(0);
  const scopeWrapRef = useRef<HTMLDivElement>(null);
  // Snapshot of where the user was before they started searching, so clearing
  // the box returns them to that view/category/tag instead of stranding them
  // on a bare "All Videos" list.
  const preSearchRef = useRef<{ view: string; cat: string; tag: string | null; terms: string[] } | null>(null);

  // Keep local input in sync when searchQuery changes externally (e.g. clear/reset)
  useEffect(() => {
    setLocalQuery(searchQuery.value);
  }, [searchQuery.value]);

  useEffect(() => () => { clearTimeout(debounceRef.current); clearTimeout(suggestRef.current); }, []);

  // Close the scope dropdown when clicking outside it.
  useEffect(() => {
    if (!scopeOpen) return;
    const onDown = (e: MouseEvent) => {
      if (scopeWrapRef.current && !scopeWrapRef.current.contains(e.target as Node)) setScopeOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [scopeOpen]);

  useEffect(() => {
    fetch('/api/settings/lists')
      .then(r => r.json())
      .then(d => {
        const parse = (s: string) => (s || '').split('\n').map(l => l.trim()).filter(Boolean);
        const hiddenTerms = parse(d.hidden);
        const isHiddenTerm = (name: string) => hiddenTerms.some(t => new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(name));
        const terms = [...parse(d.actors), ...parse(d.channels), ...parse(d.categories)].filter(t => !isHiddenTerm(t));
        setAcTerms(terms);
      })
      .catch(() => {});
  }, []);

  const getSuggest = (val: string) => {
    if (!val) return '';
    const words = val.split(/\s+/);
    const last = words[words.length - 1];
    if (!last) return '';
    const lo = last.toLowerCase();
    const match = acTerms.find(t => t.toLowerCase().startsWith(lo) && t.toLowerCase() !== lo);
    if (!match) return '';
    return match.slice(last.length);
  };

  // Fetch grouped autocomplete suggestions from the FTS-backed endpoint.
  const fetchSuggestions = (val: string) => {
    const q = val.trim();
    if (q.length < 2) { setSuggestions([]); setAcOpen(false); return; }
    const seq = ++suggestSeq.current;
    fetch(`/api/search/suggest?q=${encodeURIComponent(q)}&limit=6`)
      .then(r => r.json())
      .then((d: { titles?: string[]; actors?: string[]; tags?: string[]; folders?: string[] }) => {
        if (seq !== suggestSeq.current) return; // a newer request superseded this one
        const flat: Suggestion[] = [
          ...(d.actors || []).map(value => ({ kind: 'actor' as const, value })),
          ...(d.tags || []).map(value => ({ kind: 'tag' as const, value })),
          ...(d.folders || []).map(value => ({ kind: 'folder' as const, value })),
          ...(d.titles || []).map(value => ({ kind: 'title' as const, value })),
        ];
        setSuggestions(flat);
        setActiveIdx(-1);
        setAcOpen(flat.length > 0);
      })
      .catch(() => {});
  };

  const commitSearch = (val: string) => {
    searchQuery.value = val;
    (window as any).q = val;
    if ((window as any).onSearchInput) {
      (window as any).onSearchInput(val);
    }
  };

  const enterSearchView = () => {
    if (currentView.value !== 'search-results') currentView.value = 'search-results';
    currentFolder.value = '';
    currentTag.value = null;
    currentTagTerms.value = [];
  };

  const onInput = (e: any) => {
    const val = e.target.value;
    const wasEmpty = !localQuery;
    setLocalQuery(val);

    if (val) {
      // Capture the pre-search context the first time a search begins.
      if (wasEmpty && !preSearchRef.current) {
        preSearchRef.current = {
          view: currentView.value,
          cat: currentFolder.value,
          tag: currentTag.value,
          terms: currentTagTerms.value,
        };
      }
      enterSearchView();
    } else {
      // Box cleared — restore whatever the user was looking at before.
      setSuggestions([]);
      setAcOpen(false);
      const prev = preSearchRef.current;
      preSearchRef.current = null;
      if (prev) {
        currentFolder.value = prev.cat;
        currentTag.value = prev.tag;
        currentTagTerms.value = prev.terms;
        currentView.value = prev.view;
      }
    }

    const h = getSuggest(val);
    setHint(h);

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => commitSearch(val), SEARCH_DEBOUNCE_MS);

    clearTimeout(suggestRef.current);
    suggestRef.current = setTimeout(() => fetchSuggestions(val), SUGGEST_DEBOUNCE_MS);
  };

  // Act on a chosen suggestion: titles refine the query, the rest navigate.
  const applySuggestion = (s: Suggestion) => {
    setAcOpen(false);
    setSuggestions([]);
    const w = window as any;
    if (s.kind === 'title') {
      setLocalQuery(s.value);
      setHint('');
      enterSearchView();
      clearTimeout(debounceRef.current);
      commitSearch(s.value);
      return;
    }
    // Navigating away from the search view — drop the query and restore nothing.
    setLocalQuery('');
    commitSearch('');
    preSearchRef.current = null;
    if (s.kind === 'actor') {
      if (w.openActor) w.openActor(s.value); else currentView.value = 'actors';
    } else if (s.kind === 'folder') {
      currentView.value = 'browse';
      currentTag.value = null;
      currentTagTerms.value = [];
      currentFolder.value = s.value;
      w.cat = s.value;
      if (w.showCategory) w.showCategory(s.value);
    } else if (s.kind === 'tag') {
      currentView.value = 'browse';
      currentFolder.value = '';
      currentTag.value = s.value;
      currentTagTerms.value = [];
    }
  };

  const onKeyDown = (e: any) => {
    if (acOpen && suggestions.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx(i => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx(i => (i <= 0 ? suggestions.length - 1 : i - 1));
        return;
      }
      if (e.key === 'Enter' && activeIdx >= 0) {
        e.preventDefault();
        applySuggestion(suggestions[activeIdx]);
        return;
      }
    }
    if (e.key === 'Tab') {
      if (hint) {
        e.preventDefault();
        const val = localQuery + hint;
        setLocalQuery(val);
        setHint('');
        clearTimeout(debounceRef.current);
        commitSearch(val);
        clearTimeout(suggestRef.current);
        suggestRef.current = setTimeout(() => fetchSuggestions(val), SUGGEST_DEBOUNCE_MS);
      }
    } else if (e.key === 'Escape') {
      setHint('');
      setAcOpen(false);
    }
  };

  useEffect(() => {
    const ghost = document.getElementById('search-ghost');
    if (!ghost) return;
    if (!hint || !localQuery) {
      ghost.innerHTML = '';
      return;
    }
    ghost.innerHTML = `<span class="ghost-typed">${localQuery}</span><span class="ghost-hint">${hint}</span>`;
  }, [hint, localQuery]);

  const scopes = searchScopes.value;
  const scopeOn = (k: string) => scopes.has(k);
  const allOn = SEARCH_SCOPE_KEYS.every(scopeOn);

  // Group flat suggestions back into labelled sections for rendering, keeping a
  // running flat index so keyboard highlight lines up across sections.
  const grouped: { kind: SuggestKind; items: { s: Suggestion; idx: number }[] }[] = [];
  suggestions.forEach((s, idx) => {
    let g = grouped.find(x => x.kind === s.kind);
    if (!g) { g = { kind: s.kind, items: [] }; grouped.push(g); }
    g.items.push({ s, idx });
  });

  return (
    <>
      <svg className="si" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
      <input
        type="text"
        id="search-input"
        placeholder="Search everything..."
        value={localQuery}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onFocus={() => { if (suggestions.length) setAcOpen(true); }}
        onBlur={() => { setHint(''); setTimeout(() => setAcOpen(false), 150); }}
        autoComplete="off"
        spellcheck={false}
      />
      <div className="search-ghost" id="search-ghost"></div>

      {acOpen && grouped.length > 0 && (
        <div className="search-ac-menu" onMouseDown={(e) => e.preventDefault()}>
          {grouped.map(g => (
            <div key={g.kind} className="search-ac-group">
              <div className="search-ac-head">{KIND_LABEL[g.kind]}</div>
              {g.items.map(({ s, idx }) => (
                <button
                  key={`${s.kind}-${s.value}`}
                  type="button"
                  className={`search-ac-item${idx === activeIdx ? ' on' : ''}`}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => applySuggestion(s)}
                >
                  <KindIcon kind={s.kind} />
                  <span className="search-ac-label">{s.value}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="search-scope" ref={scopeWrapRef}>
        <button
          type="button"
          className={`search-scope-btn${allOn ? '' : ' on'}`}
          title="Choose what to search"
          aria-label="Search options"
          aria-expanded={scopeOpen ? 'true' : 'false'}
          onClick={() => setScopeOpen(o => !o)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
            <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
            <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
            <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
          </svg>
        </button>

        {scopeOpen && (
          <div className="search-scope-menu">
            <div className="search-scope-menu-head">
              <span>Search in</span>
              <button type="button" onClick={() => setAllSearchScopes(!allOn)}>
                {allOn ? 'Clear' : 'All'}
              </button>
            </div>
            <div className="search-scope-list">
              {SEARCH_SCOPE_KEYS.map(key => (
                <label key={key} className="search-scope-opt">
                  <span>{SCOPE_LABELS[key]}</span>
                  <input type="checkbox" checked={scopeOn(key)} onChange={() => toggleSearchScope(key)} />
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
};
