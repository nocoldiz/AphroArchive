import { currentView } from '../../store';

export const HomeView = () => {
  const callLegacy = (fnName: string, ...args: any[]) => {
    if ((window as any)[fnName]) {
      (window as any)[fnName](...args);
    }
  };

  const nav = (view: string, path: string) => {
    currentView.value = view;
    history.pushState(null, '', path);
  };

  return (
    <div className="home-view" id="home-view">
      <div className="home-header">
        <h2>Welcome to AphroArchive</h2>
        <p>Your local media library — pick a section to get started</p>
      </div>
      <div className="home-grid">
        <div className="home-card" onClick={() => callLegacy('selCat', '')}>
          <div className="home-card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="2" y="2" width="9" height="9" rx="2" />
              <rect x="13" y="2" width="9" height="9" rx="2" />
              <rect x="2" y="13" width="9" height="9" rx="2" />
              <rect x="13" y="13" width="9" height="9" rx="2" />
            </svg>
          </div>
          <div className="home-card-body">
            <div className="home-card-name">All Videos</div>
            <div className="home-card-desc">Browse your entire library</div>
          </div>
        </div>

        <div className="home-card" onClick={() => nav('recent', '/recent')}>
          <div className="home-card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div className="home-card-body">
            <div className="home-card-name">Recently Watched</div>
            <div className="home-card-desc">Pick up where you left off</div>
          </div>
        </div>

        <div className="home-card" onClick={() => nav('collections', '/collections')}>
          <div className="home-card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="2" y="7" width="20" height="14" rx="2" />
              <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
            </svg>
          </div>
          <div className="home-card-body">
            <div className="home-card-name">Playlist</div>
            <div className="home-card-desc">Saved video groups</div>
          </div>
        </div>

        <div className="home-card" onClick={() => nav('actors', '/actors')}>
          <div className="home-card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
            </svg>
          </div>
          <div className="home-card-body">
            <div className="home-card-name">All Actors</div>
            <div className="home-card-desc">Browse the actor database</div>
          </div>
        </div>

        <div className="home-card" onClick={() => nav('studios', '/studios')}>
          <div className="home-card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="2" y="7" width="20" height="15" rx="2" />
              <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
              <line x1="12" y1="12" x2="12" y2="16" />
              <line x1="10" y1="14" x2="14" y2="14" />
            </svg>
          </div>
          <div className="home-card-body">
            <div className="home-card-name">All Studios</div>
            <div className="home-card-desc">Browse the studio database</div>
          </div>
        </div>

        <div className="home-card" onClick={() => nav('bookmarks', '/bookmarks')}>
          <div className="home-card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div className="home-card-body">
            <div className="home-card-name">Bookmarks</div>
            <div className="home-card-desc">Imported browser bookmarks</div>
          </div>
        </div>

        <div className="home-card" onClick={() => nav('books', '/books')}>
          <div className="home-card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
          </div>
          <div className="home-card-body">
            <div className="home-card-name">Books</div>
            <div className="home-card-desc">E-book reader</div>
          </div>
        </div>

        <div className="home-card" onClick={() => nav('audio', '/audio')}>
          <div className="home-card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
          <div className="home-card-body">
            <div className="home-card-name">Audio</div>
            <div className="home-card-desc">Music player</div>
          </div>
        </div>

        <div className="home-card" onClick={() => nav('vault', '/vault')}>
          <div className="home-card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <div className="home-card-body">
            <div className="home-card-name">Vault</div>
            <div className="home-card-desc">Encrypted file storage</div>
          </div>
        </div>

        <div className="home-card" onClick={() => callLegacy('showDups')}>
          <div className="home-card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="8" y="8" width="13" height="13" rx="2" />
              <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
            </svg>
          </div>
          <div className="home-card-body">
            <div className="home-card-name">Duplicates</div>
            <div className="home-card-desc">Detect and remove duplicates</div>
          </div>
        </div>

        <div className="home-card" onClick={() => nav('search', '/search')}>
          <div className="home-card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
              <path d="M11 8v6M8 11h6" />
            </svg>
          </div>
          <div className="home-card-body">
            <div className="home-card-name">Search</div>
            <div className="home-card-desc">Search the web for content</div>
          </div>
        </div>

        <div className="home-card" onClick={() => nav('scraper', '/scraper')}>
          <div className="home-card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.35-4.35" />
              <path d="M11 8v6M8 11h6" />
            </svg>
          </div>
          <div className="home-card-body">
            <div className="home-card-name">Actor Scraper</div>
            <div className="home-card-desc">Fetch actor metadata</div>
          </div>
        </div>

        <div className="home-card" onClick={() => nav('database', '/database')}>
          <div className="home-card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
            </svg>
          </div>
          <div className="home-card-body">
            <div className="home-card-name">Database</div>
            <div className="home-card-desc">Edit actors, studios & categories</div>
          </div>
        </div>

        <div className="home-card" onClick={() => callLegacy('showConnect')}>
          <div className="home-card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M5 12.55a11 11 0 0 1 14.08 0" />
              <path d="M1.42 9a16 16 0 0 1 21.16 0" />
              <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
              <circle cx="12" cy="20" r="1" fill="currentColor" />
            </svg>
          </div>
          <div className="home-card-body">
            <div className="home-card-name">Connect</div>
            <div className="home-card-desc">Remote access via QR code</div>
          </div>
        </div>

        <div className="home-card" onClick={() => nav('settings', '/settings')}>
          <div className="home-card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </div>
          <div className="home-card-body">
            <div className="home-card-name">Settings</div>
            <div className="home-card-desc">Preferences &amp; themes</div>
          </div>
        </div>

        <div className="home-card" onClick={() => window.location.href = '/reddit'}>
          <div className="home-card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="4" />
              <path d="M15.5 8.5 Q18 6 20 8" />
              <path d="M4 8 Q6 6 8.5 8.5" />
              <circle cx="9.5" cy="13" r="1" fill="currentColor" stroke="none" />
              <circle cx="14.5" cy="13" r="1" fill="currentColor" stroke="none" />
              <path d="M9.5 16 Q12 17.5 14.5 16" strokeLinecap="round" />
            </svg>
          </div>
          <div className="home-card-body">
            <div className="home-card-name">Reddit Mode</div>
            <div className="home-card-desc">Browse as a Reddit-style feed</div>
          </div>
        </div>

        <div className="home-card" onClick={() => window.location.href = '/instagram'}>
          <div className="home-card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
              <circle cx="12" cy="12" r="4" />
              <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
            </svg>
          </div>
          <div className="home-card-body">
            <div className="home-card-name">Instagram Mode</div>
            <div className="home-card-desc">Scroll a social-style feed</div>
          </div>
        </div>

        <div className="home-card" onClick={() => nav('prompts', '/prompts')}>
          <div className="home-card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              <path d="M8 10h8M8 14h5" />
            </svg>
          </div>
          <div className="home-card-body">
            <div className="home-card-name">Prompts</div>
            <div className="home-card-desc">Browse & generate AI prompts</div>
          </div>
        </div>
      </div>
    </div>
  );
};;
