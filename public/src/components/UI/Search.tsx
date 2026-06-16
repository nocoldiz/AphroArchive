import { searchQuery, currentView, currentFolder, currentTag, currentTagTerms, searchScopes, toggleSearchScope, setAllSearchScopes, SEARCH_SCOPE_KEYS } from '../../store';
import { useState, useEffect, useRef } from 'preact/hooks';

const SCOPE_LABELS: Record<string, string> = {
  videos: 'Videos', links: 'Links', actors: 'Actors', channels: 'Channels',
  websites: 'Websites', books: 'Books', audio: 'Audio', photos: 'Photos',
  pages: 'Pages', prompts: 'Prompts', collections: 'Playlists',
};

const SEARCH_DEBOUNCE_MS = 200;

export const Search = () => {
  const [acTerms, setAcTerms] = useState<string[]>([]);
  const [hint, setHint] = useState('');
  const [localQuery, setLocalQuery] = useState(searchQuery.value);
  const [scopeOpen, setScopeOpen] = useState(false);
  const debounceRef = useRef<any>(null);
  const scopeWrapRef = useRef<HTMLDivElement>(null);
  // Snapshot of where the user was before they started searching, so clearing
  // the box returns them to that view/category/tag instead of stranding them
  // on a bare "All Videos" list.
  const preSearchRef = useRef<{ view: string; cat: string; tag: string | null; terms: string[] } | null>(null);

  // Keep local input in sync when searchQuery changes externally (e.g. clear/reset)
  useEffect(() => {
    setLocalQuery(searchQuery.value);
  }, [searchQuery.value]);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

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

  const commitSearch = (val: string) => {
    searchQuery.value = val;
    (window as any).q = val;
    if ((window as any).onSearchInput) {
      (window as any).onSearchInput(val);
    }
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
      if (currentView.value !== 'search-results') currentView.value = 'search-results';
      currentFolder.value = '';
      currentTag.value = null;
      currentTagTerms.value = [];
    } else {
      // Box cleared — restore whatever the user was looking at before.
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
  };

  const onKeyDown = (e: any) => {
    if (e.key === 'Tab') {
      if (hint) {
        e.preventDefault();
        const val = localQuery + hint;
        setLocalQuery(val);
        setHint('');
        clearTimeout(debounceRef.current);
        commitSearch(val);
      }
    } else if (e.key === 'Escape') {
      setHint('');
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
        onBlur={() => setHint('')}
        autoComplete="off"
        spellcheck={false}
      />
      <div className="search-ghost" id="search-ghost"></div>

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
