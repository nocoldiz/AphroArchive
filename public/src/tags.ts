// Tag DB helpers — tag groups live in the categories/category_tags tables
// and feed /api/db-tags (sidebar + dropdown) and /api/tag-suggestions.

export const splitKeywords = (raw: string): string[] =>
  raw.split(',').map(s => s.trim()).filter(Boolean);

// Upsert a tag group into the DB, merging keywords with any existing entry
// (case-insensitive) so a re-save never drops previously configured keywords.
export const saveTagToDb = async (name: string, keywords: string[] = []): Promise<boolean> => {
  const tagName = name.trim();
  if (!tagName) return false;

  let key = tagName;
  let displayName = tagName;
  let existing: string[] = [];
  try {
    const all = await (await fetch('/api/db/categories')).json();
    const found = Object.keys(all).find(k => k.toLowerCase() === tagName.toLowerCase());
    if (found) {
      key = found;
      displayName = all[found]?.displayName || found;
      existing = Array.isArray(all[found]?.tags) ? all[found].tags : [];
    }
  } catch {}

  const seen = new Set(existing.map(k => k.toLowerCase()));
  seen.add(key.toLowerCase());
  const merged = [...existing];
  for (const k of keywords) {
    const t = k.trim();
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      merged.push(t);
    }
  }

  const r = await fetch('/api/db/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: key, data: { displayName, tags: merged } }),
  });
  if (r.ok) (window as any)._sidebarReloadTags?.();
  return r.ok;
};
