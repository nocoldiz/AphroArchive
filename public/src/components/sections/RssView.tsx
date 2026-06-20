import { useState, useEffect } from 'preact/hooks';
import { appPrefs, updatePrefs, activeProfile, isVaultUnlocked, currentView } from '../../store';

interface RssFeed { url: string; name?: string; category?: string; }

const browseNative = async (): Promise<string | null> => {
  try {
    const r = await fetch('/api/browse-folders-native');
    const d = await r.json();
    if (d.error) { alert(d.error); return null; }
    return d.path || null;
  } catch { return null; }
};

export const RssView = () => {
  const prefs = appPrefs.value;
  const feeds: RssFeed[] = prefs.rssFeeds || [];
  const isVault = activeProfile.value === 'Vault' || isVaultUnlocked.value;

  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [feedFolder, setFeedFolder] = useState('');

  // Scrape all RSS feeds when the section is opened.
  const refresh = async () => {
    setRefreshing(true);
    setStatus('Fetching feeds…');
    try {
      const r = await fetch('/api/rss/refresh', { method: 'POST' });
      const d = await r.json();
      setStatus(d.imported ? `Imported ${d.imported} new item(s) from ${d.feeds} feed(s).` : `Up to date (${d.feeds} feed(s)).`);
    } catch {
      setStatus('Failed to refresh feeds.');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (currentView.value === 'rss' && feeds.length) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // updatePrefs persists rssFeeds (allowlisted in settings-server) and updates
  // the local signal; the server reads the same prefs.rssFeeds when refreshing.
  const saveFeeds = async (next: RssFeed[]) => {
    await updatePrefs({ rssFeeds: next });
  };

  const addFeed = async () => {
    const u = url.trim();
    if (!u) return;
    if (feeds.some(f => f.url === u)) { setStatus('Feed already added.'); return; }
    const next = [...feeds, { url: u, name: name.trim(), category: category.trim() }];
    await saveFeeds(next);
    setUrl(''); setName(''); setCategory('');
    setStatus('Feed added. Refreshing…');
    refresh();
  };

  const removeFeed = async (i: number) => {
    await saveFeeds(feeds.filter((_, idx) => idx !== i));
  };

  // ── Feed folders (auto-import drop folders) ──────────────────────────
  const feedFolders: string[] = prefs.feedFolders || [];
  const addFeedFolder = async (val: string) => {
    const v = val.trim();
    if (!v || feedFolders.includes(v)) return;
    await updatePrefs({ feedFolders: [...feedFolders, v] });
  };
  const removeFeedFolder = async (i: number) => {
    await updatePrefs({ feedFolders: feedFolders.filter((_, idx) => idx !== i) });
  };

  const setVaultFeedFolder = async (val: string) => {
    await updatePrefs({ vaultFeedFolder: val.trim() });
  };

  return (
    <div style={{ padding: '20px', maxWidth: '820px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
        <h2 style={{ margin: 0 }}>RSS Feeds</h2>
        <button className="modal-btn modal-btn--secondary" disabled={refreshing} onClick={refresh}>
          {refreshing ? 'Refreshing…' : 'Refresh now'}
        </button>
      </div>
      <p style={{ fontSize: '13px', color: 'var(--tx3)', marginTop: '4px' }}>
        Remote RSS / Atom feeds are scraped into your bookmark links automatically — when this section opens and as the first step of the background worker.
      </p>
      {status && <div style={{ fontSize: '13px', color: 'var(--ac)', margin: '4px 0 12px' }}>{status}</div>}

      {/* Add feed */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <input type="text" value={url} placeholder="https://example.com/feed.xml"
          onInput={(e: any) => setUrl(e.target.value)}
          style={{ flex: '2 1 240px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '6px', padding: '8px 10px' }} />
        <input type="text" value={name} placeholder="Name (optional)"
          onInput={(e: any) => setName(e.target.value)}
          style={{ flex: '1 1 120px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '6px', padding: '8px 10px' }} />
        <input type="text" value={category} placeholder="Category (optional)"
          onInput={(e: any) => setCategory(e.target.value)}
          style={{ flex: '1 1 120px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '6px', padding: '8px 10px' }} />
        <button className="modal-btn modal-btn--primary" onClick={addFeed}>Add feed</button>
      </div>

      {/* Feed list */}
      <div style={{ marginBottom: '28px' }}>
        {feeds.length === 0 && <div style={{ fontSize: '13px', color: 'var(--tx3)' }}>No feeds yet. Add an RSS/Atom URL above.</div>}
        {feeds.map((f, i) => (
          <div key={f.url} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', background: 'var(--bg3)', padding: '10px', borderRadius: '6px', marginBottom: '6px' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '14px', color: 'var(--tx)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name || f.url}</div>
              <div style={{ fontSize: '12px', color: 'var(--tx3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {f.url}{f.category ? ` · ${f.category}` : ''}
              </div>
            </div>
            <button className="modal-btn modal-btn--danger" style={{ padding: '4px 8px', fontSize: '12px', flexShrink: 0 }} onClick={() => removeFeed(i)}>Remove</button>
          </div>
        ))}
      </div>

      {/* Feed folders */}
      <h3 style={{ marginBottom: '4px' }}>Feed Folders</h3>
      <p style={{ fontSize: '13px', color: 'var(--tx3)', marginTop: '4px' }}>
        Files dropped into these folders are auto-imported into your library.
      </p>
      <div style={{ marginBottom: '10px' }}>
        {feedFolders.map((folder, idx) => (
          <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg3)', padding: '10px', borderRadius: '6px', marginBottom: '6px' }}>
            <span style={{ fontSize: '14px', color: 'var(--tx)', wordBreak: 'break-all' }}>{folder}</span>
            <button className="modal-btn modal-btn--danger" style={{ padding: '4px 8px', fontSize: '12px', flexShrink: 0, marginLeft: '8px' }} onClick={() => removeFeedFolder(idx)}>Remove</button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '28px' }}>
        <input type="text" value={feedFolder} placeholder="C:\Users\…\Downloads"
          onInput={(e: any) => setFeedFolder(e.target.value)}
          style={{ flex: 1, background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '6px', padding: '8px 10px' }} />
        <button className="modal-btn modal-btn--secondary" onClick={async () => { const p = await browseNative(); if (p) setFeedFolder(p); }}>Browse…</button>
        <button className="modal-btn modal-btn--primary" onClick={async () => { await addFeedFolder(feedFolder); setFeedFolder(''); }}>Add</button>
      </div>

      {/* Vault feed folder — only in vault mode */}
      {isVault && (
        <div>
          <h3 style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <i className="icon-lock" style={{ fontSize: '13px' }} /> Vault Feed Folder
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--tx3)', marginTop: '4px' }}>
            Files dropped here are encrypted into your vault and the source securely shredded.
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input type="text" value={prefs.vaultFeedFolder || ''} placeholder="Vault drop folder"
              onInput={(e: any) => setVaultFeedFolder(e.target.value)}
              style={{ flex: 1, background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', borderRadius: '6px', padding: '8px 10px' }} />
            <button className="modal-btn modal-btn--secondary" onClick={async () => { const p = await browseNative(); if (p) await setVaultFeedFolder(p); }}>Browse…</button>
          </div>
        </div>
      )}
    </div>
  );
};
