import { currentView, currentActor, currentStudio, currentCategory, currentTag } from './store';

export async function routeToPath(path: string) {
  let m: RegExpMatchArray | null;
  const w = window as any;
  
  if (path === '/' || path === '') { currentView.value = 'home'; return; }
  if (path === '/favourites') { if (!w.favM) { w.favM = true; const fBtn = document.getElementById('fBtn'); if (fBtn) fBtn.classList.add('on'); } if (w.refresh) w.refresh(); return; }
  if (path === '/duplicates') { if (w.showDups) w.showDups(); return; }
  if (path === '/vault') { currentView.value = 'vault'; return; }
  if (path === '/vault/prompts') { if (w.showVaultPrompts) w.showVaultPrompts(); return; }
  if (path === '/recent') { if (w.showRecent) w.showRecent(); return; }
  if (path === '/collections') { currentView.value = 'collections'; return; }
  if (path === '/scraper') { currentView.value = 'scraper'; return; }
  if (path === '/books') { currentView.value = 'books'; return; }
  if (path === '/audio') { currentView.value = 'audio'; return; }
  
  // Migrated views
  if (path === '/thumbnails') { currentView.value = 'thumbnails'; return; }
  if (path === '/settings') { currentView.value = 'settings'; return; }
  if (path === '/photos') { currentView.value = 'photos'; return; }
  if (path === '/bookmarks') { currentView.value = 'bookmarks'; return; }
  
  if (path === '/pages')  { currentView.value = 'pages'; return; }
  if (path === '/search') { currentView.value = 'search'; return; }
  if (path === '/prompts') { if (w.showPrompts) w.showPrompts(); return; }
  if (path === '/database') { currentView.value = 'database'; return; }
  if (path === '/categories') { currentView.value = 'categories'; return; }
  if (path === '/chapters') { currentView.value = 'chapters'; return; }
  if (path === '/actors') { currentView.value = 'actors'; currentActor.value = null; return; }
  if (path === '/studios') { currentView.value = 'studios'; currentStudio.value = null; return; }
  
  if ((m = path.match(/^\/video\/([^/]+)$/))) { if (w.openVid) w.openVid(decodeURIComponent(m[1])); return; }
  if ((m = path.match(/^\/tag\/(.+)$/))) { currentTag.value = decodeURIComponent(m[1]); currentView.value = 'browse'; return; }
  if ((m = path.match(/^\/cat\/(.+)$/))) { currentCategory.value = decodeURIComponent(m[1]); currentView.value = 'browse'; return; }
  if ((m = path.match(/^\/actor\/(.+)$/))) { currentView.value = 'actors'; currentActor.value = decodeURIComponent(m[1]); return; }
  if ((m = path.match(/^\/studio\/(.+)$/))) { currentView.value = 'studios'; currentStudio.value = decodeURIComponent(m[1]); return; }
  if ((m = path.match(/^\/collection\/(.+)$/))) { if (w.showCollections) w.showCollections(); if (w.openCollectionDetail) w.openCollectionDetail(decodeURIComponent(m[1])); return; }
  
  if (w.goHome) w.goHome();
}

export function setupRouter() {
  window.addEventListener('popstate', () => {
    routeToPath(location.pathname);
  });
  
  window.addEventListener('scroll', () => {
    const w = window as any;
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const scrolled = window.scrollY;
    if (scrollable - scrolled < 800) {
      const total = (w.V ? w.V.length : 0) + (typeof w.getBmList === 'function' ? w.getBmList().length : 0);
      if (w._renderLimit < total) {
        w._renderLimit += 60;
        if (w.curTag) w.openTag(w.curTag);
        else if (w.studioMode && w.curStudio) w.openStudio(w.curStudio);
        else if (w.actorMode && w.curActor) w.openActor(w.curActor);
        else if (w.render) w.render();
      }
    }
  });
  
  // Initial routing
  routeToPath(location.pathname);
}
