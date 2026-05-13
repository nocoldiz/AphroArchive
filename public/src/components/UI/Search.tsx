import { searchQuery } from '../../store';
import { useState, useEffect } from 'preact/hooks';

export const Search = () => {
  const [acTerms, setAcTerms] = useState<string[]>([]);
  const [hint, setHint] = useState('');

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

  const onInput = (e: any) => {
    const val = e.target.value;
    searchQuery.value = val;
    (window as any).q = val;

    const h = getSuggest(val);
    setHint(h);

    if ((window as any).onSearchInput) {
      (window as any).onSearchInput(val);
    }
  };

  const onKeyDown = (e: any) => {
    if (e.key === 'Tab') {
      if (hint) {
        e.preventDefault();
        searchQuery.value += hint;
        setHint('');
      }
    } else if (e.key === 'Escape') {
      setHint('');
    }
  };

  useEffect(() => {
    const ghost = document.getElementById('search-ghost');
    if (!ghost) return;
    if (!hint || !searchQuery.value) {
      ghost.innerHTML = '';
      return;
    }
    ghost.innerHTML = `<span class="ghost-typed">${searchQuery.value}</span><span class="ghost-hint">${hint}</span>`;
  }, [hint, searchQuery.value]);

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
        value={searchQuery.value}
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
