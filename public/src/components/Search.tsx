import { searchQuery } from '../store';

export const Search = () => {
  const onInput = (e: any) => {
    searchQuery.value = e.target.value;
    // Compatibility: Also update the old global 'q' variable
    (window as any).q = e.target.value;
    if ((window as any).onSearchInput) {
      (window as any).onSearchInput(e.target.value);
    }
  };

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
        autoComplete="off" 
        spellcheck={false} 
      />
      <div className="search-ghost" id="search-ghost"></div>
    </>
  );
};
