/** @jsxImportSource preact */
import { useMemo } from 'preact/hooks';

const LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];

/** First-letter bucket for a name: A–Z, or '#' for anything else (digits, symbols, empty). */
export const azKey = (name: string): string => {
  const c = (name || '').trim().charAt(0).toUpperCase();
  return c >= 'A' && c <= 'Z' ? c : '#';
};

interface AzRailProps {
  /** Names in display order — used to decide which letters are reachable. */
  names: string[];
  /** CSS selector of the scroll container holding cards tagged with `data-az`. */
  containerSelector: string;
}

/** Sticky A–Z rail that scrolls the list to the first entry of a letter. */
export const AzRail = ({ names, containerSelector }: AzRailProps) => {
  const present = useMemo(() => {
    const s = new Set<string>();
    for (const n of names) s.add(azKey(n));
    return s;
  }, [names]);

  const jump = (letter: string) => {
    const el = document.querySelector(`${containerSelector} [data-az="${letter}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div class="az-rail" aria-label="Jump to letter">
      {LETTERS.map(l => (
        <button
          key={l}
          class="az-rail-btn"
          disabled={!present.has(l)}
          onClick={() => jump(l)}
          title={present.has(l) ? `Jump to ${l}` : undefined}
        >
          {l}
        </button>
      ))}
    </div>
  );
};
