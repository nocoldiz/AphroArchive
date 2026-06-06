import { currentView, currentActor, currentStudio, currentCategory, currentTag, currentVideo, allVideos } from './store';

export async function routeToPath(path: string) {
  let m: RegExpMatchArray | null;
  const w = window as any;

  // Reset transient state on every navigation
  currentVideo.value = null;

  if (path === '/' || path === '' || path === '/home' || path === '/hub') {
    currentView.value = 'hub';
    currentCategory.value = '';
    currentTag.value = null;
    currentActor.value = null;
    currentStudio.value = null;
    return;
  }

  // Simple signal-based views
  const directViews: Record<string, string> = {
    '/vault':          'vault',
    '/collections':    'collections',
    '/scraper':        'scraper',
    '/books':          'books',
    '/audio':          'audio',
    '/thumbnails':     'thumbnails',
    '/settings':       'settings',
    '/photos':         'photos',
    '/links':          'links',
    '/pages':          'pages',
    '/search':         'search',
    '/database':       'database',
    '/categories':     'categories',
    '/chapters':       'chapters',
    '/actors':         'actors',
    '/studios':        'studios',
    '/download-queue': 'download-queue',
    '/prompts':        'prompts',
    '/imagegen':       'imagegen',
    '/assistant':      'assistant',
    '/categorizer':    'categorizer',
    '/duplicates':     'duplicates',
    '/browse':         'browse',
    '/instagram':      'instagram',
    '/reddit':         'reddit',
  };

  if (directViews[path]) {
    currentView.value = directViews[path];
    currentCategory.value = '';
    currentTag.value = null;
    currentActor.value = null;
    currentStudio.value = null;
    return;
  }

  // Legacy-only views (no Preact component yet)
  if (path === '/favourites') {
    if (w.favM !== undefined) { w.favM = true; document.getElementById('fBtn')?.classList.add('on'); }
    if (w.refresh) w.refresh();
    return;
  }
if (path === '/recent')     { if (w.showRecent) w.showRecent(); return; }
  if (path === '/vault/prompts') { if (w.showVaultPrompts) w.showVaultPrompts(); return; }

  // Parameterised routes
  if ((m = path.match(/^\/video\/([^/]+)$/))) {
    const videoId = decodeURIComponent(m[1]);
    const tryOpen = () => {
      const vid = allVideos.value.find((v: any) => v.id === videoId);
      if (vid) {
        currentVideo.value = vid;
        currentView.value = 'player';
        return true;
      }
      return false;
    };
    if (!tryOpen()) {
      // Videos not loaded yet — retry once they arrive
      const unsub = allVideos.subscribe(vids => {
        if (vids.length > 0 && tryOpen()) unsub();
      });
    }
    return;
  }

  if ((m = path.match(/^\/tag\/(.+)$/))) {
    currentTag.value = decodeURIComponent(m[1]);
    currentCategory.value = '';
    currentView.value = 'browse';
    return;
  }

  if ((m = path.match(/^\/cat\/(.+)$/))) {
    currentCategory.value = decodeURIComponent(m[1]);
    currentTag.value = null;
    currentView.value = 'browse';
    return;
  }

  if ((m = path.match(/^\/actor\/(.+)$/))) {
    currentActor.value = decodeURIComponent(m[1]);
    currentView.value = 'actors';
    return;
  }

  if ((m = path.match(/^\/studio\/(.+)$/))) {
    currentStudio.value = decodeURIComponent(m[1]);
    currentView.value = 'studios';
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

  window.addEventListener('scroll', () => {
    const w = window as any;
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const scrolled = window.scrollY;
    if (scrollable - scrolled < 800) {
      const total = (w.V ? w.V.length : 0) + (typeof w.getLinkList === 'function' ? w.getLinkList().length : 0);
      if (w._renderLimit < total) {
        w._renderLimit += 60;
        if (w.curTag) w.openTag(w.curTag);
        else if (w.studioMode && w.curStudio) w.openStudio(w.curStudio);
        else if (w.actorMode && w.curActor) w.openActor(w.curActor);
        else if (w.render) w.render();
      }
    }
  });

  // Initial routing — runs synchronously so the very first render shows the right view
  routeToPath(location.pathname);
}
