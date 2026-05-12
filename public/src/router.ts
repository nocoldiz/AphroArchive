import { currentView } from './store';

export async function routeToPath(path: string) {
  let m: RegExpMatchArray | null;
  const w = window as any;
  
  if (path === '/' || path === '') { if (w.showHome) w.showHome(); return; }
  if (path === '/favourites') { if (!w.favM) { w.favM = true; const fBtn = document.getElementById('fBtn'); if (fBtn) fBtn.classList.add('on'); } if (w.refresh) w.refresh(); return; }
  if (path === '/bookmarks') { if (w.showImportFavs) w.showImportFavs(); return; }
  if (path === '/duplicates') { if (w.showDups) w.showDups(); return; }
  if (path === '/vault') { if (w.showVault) w.showVault(); return; }
  if (path === '/vault/prompts') { if (w.showVaultPrompts) w.showVaultPrompts(); return; }
  if (path === '/recent') { if (w.showRecent) w.showRecent(); return; }
  if (path === '/collections') { if (w.showCollections) w.showCollections(); return; }
  if (path === '/scraper') { if (w.showScraper) w.showScraper(); return; }
  if (path === '/books') { if (w.showBooks) w.showBooks(); return; }
  if (path === '/audio') { if (w.showAudio) w.showAudio(); return; }
  if (path === '/photos') { if (w.showPhotos) w.showPhotos(); return; }
  
  // Migrated views
  if (path === '/thumbnails') { currentView.value = 'thumbnails'; return; }
  if (path === '/settings') { currentView.value = 'settings'; return; }
  
  if (path === '/pages')  { if (w.showPages) w.showPages(); return; }
  if (path === '/search') { if (w.showSearchSites) w.showSearchSites(); return; }
  if (path === '/prompts') { if (w.showPrompts) w.showPrompts(); return; }
  if (path === '/database') { if (w.showDatabase) w.showDatabase(); return; }
  if (path === '/categories') { if (w.showCategoriesView) w.showCategoriesView(); return; }
  if (path === '/actors') { if (w.showActors) w.showActors(); return; }
  if (path === '/studios') { if (w.showStudios) w.showStudios(); return; }
  
  if ((m = path.match(/^\/video\/([^/]+)$/))) { if (w.openVid) w.openVid(decodeURIComponent(m[1])); return; }
  if ((m = path.match(/^\/tag\/(.+)$/))) { if (w.openTag) w.openTag(decodeURIComponent(m[1])); return; }
  if ((m = path.match(/^\/cat\/(.+)$/))) { if (w.selCat) w.selCat(decodeURIComponent(m[1])); return; }
  if ((m = path.match(/^\/actor\/(.+)$/))) { if (w.showActors) await w.showActors(); if (w.openActor) w.openActor(decodeURIComponent(m[1])); return; }
  if ((m = path.match(/^\/studio\/(.+)$/))) { if (w.showStudios) await w.showStudios(); if (w.openStudio) w.openStudio(decodeURIComponent(m[1])); return; }
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
