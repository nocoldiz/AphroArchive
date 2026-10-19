import { currentView, currentActor, currentChannel, currentFolder, currentTag, currentTagTerms, currentVideo, allVideos, enableUrlSync, setRouteResolving } from './store';

// Clearing the tag must also clear its match terms, or they leak into the next tag.
const clearTag = () => { currentTag.value = null; currentTagTerms.value = []; };

export async function routeToPath(path: string) {
  let m: RegExpMatchArray | null;
  const w = window as any;

  // Parameterised routes — handle BEFORE resetting transient state
  // so /video/:id can restore correctly without a null flash
  if ((m = path.match(/^\/video\/([^/]+)$/))) {
    const videoId = decodeURIComponent(m[1]);
    const tryOpen = () => {
      const vid = allVideos.value.find((v: any) => v.id === videoId);
      if (vid) {
        currentView.value = 'player';
        currentVideo.value = vid;
        return true;
      }
      return false;
    };
    if (!tryOpen()) {
      // Videos not loaded yet — retry once they arrive. Unsubscribe on the
      // first non-empty list either way so the subscription can't leak.
      setRouteResolving(true);
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        setRouteResolving(false);
      };
      const unsub = allVideos.subscribe(vids => {
        if (done || vids.length === 0) return;
        finish();
        if (!tryOpen()) currentView.value = 'hub';
        Promise.resolve().then(() => unsub());
      });
      // Safety net: if videos never load (empty library, fetch failure),
      // don't leave URL sync disabled forever.
      setTimeout(() => {
        if (done) return;
        finish();
        if (!tryOpen()) currentView.value = 'hub';
        unsub();
      }, 8000);
    }
    return;
  }

  // Reset transient state on every other navigation
  currentVideo.value = null;

  if (path === '/' || path === '' || path === '/home' || path === '/hub') {
    currentView.value = 'hub';
    currentFolder.value = '';
    clearTag();
    currentActor.value = null;
    currentChannel.value = null;
    return;
  }

  // Simple signal-based views
  const directViews: Record<string, string> = {
    '/vault':          'vault',
    '/collections':    'collections',
    '/scraper':        'scraper',
    '/books':          'books',
    '/audio':          'audio',
    '/files':          'files',
    '/thumbnails':     'thumbnails',
    '/settings':       'settings',
    '/photos':         'photos',
    '/links':          'links',
    '/rss':            'rss',
    '/pages':          'pages',
    '/search':         'search',
    '/database':       'database',
    '/folders':        'folders',
    '/chapters':       'chapters',
    '/series':         'series',
    '/actors':         'actors',
    '/channels':        'channels',
    '/download-queue': 'download-queue',
    '/prompts':        'prompts',
    '/assistant':      'assistant',
    '/categorizer':    'categorizer',
    '/duplicates':     'duplicates',
    '/corrupted':      'corrupted',
    '/library-health': 'library-health',
    '/subtitles':      'subtitles',
    '/guide':          'guide',
    '/browse':         'browse',
    '/instagram':      'instagram',
    '/reddit':         'reddit',
    '/mosaic':         'mosaic',
    '/favourites':     'favourites',
    '/recent':         'recent',
    // URL sync pushes /<view> for these too; without entries, reload/back sent you home.
    '/radio':          'radio',
    '/screenshots':    'screenshots',
  };

  if (directViews[path]) {
    currentView.value = directViews[path];
    currentFolder.value = '';
    clearTag();
    currentActor.value = null;
    currentChannel.value = null;
    return;
  }

  // Legacy-only views (no Preact component yet)
  if (path === '/vault/prompts') { if (w.showVaultPrompts) w.showVaultPrompts(); return; }

  // Parameterised routes (non-video)
  if ((m = path.match(/^\/tag\/(.+)$/))) {
    const tag = decodeURIComponent(m[1]);
    // Keep the terms only when returning to the same tag (e.g. back from the player).
    if (currentTag.value !== tag) currentTagTerms.value = [];
    currentTag.value = tag;
    currentFolder.value = '';
    currentView.value = 'browse';
    return;
  }

  if ((m = path.match(/^\/folder\/(.+)$/))) {
    currentFolder.value = decodeURIComponent(m[1]);
    clearTag();
    currentView.value = 'browse';
    return;
  }

  // Legacy /cat/ URLs — redirect to /folder/
  if ((m = path.match(/^\/cat\/(.+)$/))) {
    currentFolder.value = decodeURIComponent(m[1]);
    clearTag();
    currentView.value = 'browse';
    return;
  }

  if ((m = path.match(/^\/actor\/(.+)$/))) {
    currentActor.value = decodeURIComponent(m[1]);
    currentView.value = 'actors';
    return;
  }

  if ((m = path.match(/^\/channel\/(.+)$/))) {
    currentChannel.value = decodeURIComponent(m[1]);
    currentView.value = 'channels';
    return;
  }

  if ((m = path.match(/^\/collection\/(.+)$/))) {
    currentView.value = 'collections';
    if (w.openCollectionDetail) setTimeout(() => w.openCollectionDetail(decodeURIComponent(m![1])), 50);
    return;
  }

  // Unknown path — go home
  if (w.goHome) w.goHome();
}

export function setupRouter() {
  window.addEventListener('popstate', () => routeToPath(location.pathname));

  // Route to the initial URL before enabling URL sync, so signal subscriptions
  // don't overwrite the pasted URL with '/' during first render.
  routeToPath(location.pathname);
  enableUrlSync();
}
