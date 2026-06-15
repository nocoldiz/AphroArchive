import { searchQuery, currentView, currentCategory, currentTag, currentTagTerms } from '../../store';
import { useState, useEffect, useRef } from 'preact/hooks';

const SEARCH_DEBOUNCE_MS = 200;

export const Search = () => {
  const [acTerms, setAcTerms] = useState<string[]>([]);
  const [hint, setHint] = useState('');
  const [localQuery, setLocalQuery] = useState(searchQuery.value);
  const debounceRef = useRef<any>(null);
  // Snapshot of where the user was before they started searching, so clearing
  // the box returns them to that view/category/tag instead of stranding them
  // on a bare "All Videos" list.
  const preSearchRef = useRef<{ view: string; cat: string; tag: string | null; terms: string[] } | null>(null);

  // Keep local input in sync when searchQuery changes externally (e.g. clear/reset)
  useEffect(() => {
    setLocalQuery(searchQuery.value);
  }, [searchQuery.value]);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  useEffect(() => {
    fetch('/api/settings/lists')
      .then(r => r.json())
      .then(d => {
        const parse = (s: string) => (s || '').split('\n').map(l => l.trim()).filter(Boolean);
        const hiddenTerms = parse(d.hidden);
        const isHiddenTerm = (name: string) => hiddenTerms.some(t => new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(name));
        const terms = [...parse(d.actors), ...parse(d.studios), ...parse(d.categories)].filter(t => !isHiddenTerm(t));
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
          cat: currentCategory.value,
          tag: currentTag.value,
          terms: currentTagTerms.value,
        };
      }
      if (currentView.value !== 'browse') currentView.value = 'browse';
      currentCategory.value = '';
      currentTag.value = null;
      currentTagTerms.value = [];
    } else {
      // Box cleared — restore whatever the user was looking at before.
      const prev = preSearchRef.current;
      preSearchRef.current = null;
      if (prev) {
        currentCategory.value = prev.cat;
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

  return (
    <>
      <svg className="si" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
      <input
        type="text"
        id="search-input"
        placeholder="Search videos..."
        value={localQuery}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onBlur={() => setHint('')}
        autoComplete="off"
        spellcheck={false}
      />
      <div className="search-ghost" id="search-ghost"></div>
    </>
  );
};
