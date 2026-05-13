import { currentView, currentVideo } from '../../store';
import { VideoGrid } from './VideoGrid';
import { SettingsView } from '../sections/SettingsView';
import { ThumbnailsView } from '../sections/ThumbnailsView';
import { InstagramView } from '../sections/InstagramView';
import { CategoriesView } from '../sections/CategoriesView';
import { ActorsView } from '../sections/ActorsView';
import { StudiosView } from '../sections/StudiosView';
import { PhotosView } from '../sections/PhotosView';
import { BookmarksView } from '../sections/BookmarksView';
import { VisionModal } from '../modals/VisionModal';
import { PagesView } from '../sections/PagesView';
import { SearchSitesView } from '../sections/SearchSitesView';
import { AudioView } from '../sections/AudioView';
import { BooksView } from '../sections/BooksView';
import { CollectionsView } from '../sections/CollectionsView';
import { DatabaseView } from '../sections/DatabaseView';
import { TagDetailView } from '../sections/TagDetailView';
import { TagModal } from '../modals/TagModal';
import { ContextMenu } from './ContextMenu';
import { RenameModal } from '../modals/RenameModal';
import { MoveModal } from '../modals/MoveModal';
import { VaultPhotoLightbox } from '../modals/VaultPhotoLightbox';
import { VaultView } from '../sections/VaultView';
import { BrowseView } from '../sections/BrowseView';
import { PromptsView } from '../sections/PromptsView';
import { HomeView } from '../sections/HomeView';
import { ChaptersView } from '../sections/ChaptersView';
import { ActorScraperView } from '../sections/ActorScraperView';
import { ConnectModal } from '../modals/ConnectModal';
import { useEffect } from 'preact/hooks';

export const MainContent = () => {
  const view = currentView.value;

  useEffect(() => {
    let ev: EventSource | null = null;

    const setupRemote = () => {
      const isRemote = localStorage.getItem('remoteMode') === 'true';
      if (isRemote && !ev) {
        ev = new EventSource('/api/remote/events');
        ev.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.action === 'play' && data.id) {
              currentVideo.value = {
                id: data.id,
                name: data.name || 'Remote Video',
                category: data.category || 'Remote',
                fav: !!data.fav,
                isVault: !!data.isVault,
                size: data.size || 0,
                duration: data.duration || 0,
                path: data.path || '',
                relPath: data.relPath || '',
                mtime: data.mtime || Date.now(),
                starred: !!data.starred
              };
            }
          } catch (err) {
            console.error('Failed to parse remote command', err);
          }
        };
        console.log('Remote Mode: Listening for events');
      } else if (!isRemote && ev) {
        ev.close();
        ev = null;
        console.log('Remote Mode: Stopped listening');
      }
    };

    setupRemote();
    window.addEventListener('storage', setupRemote);

    return () => {
      if (ev) ev.close();
      window.removeEventListener('storage', setupRemote);
    };
  }, []);

  const renderView = () => {
    if (view === 'home') return <HomeView />;
    if (view === 'chapters') return <ChaptersView />;
    if (view === 'scraper') return <ActorScraperView />;
    if (view === 'settings') return <SettingsView />;
    if (view === 'categories') return <CategoriesView />;
    if (view === 'actors') return <ActorsView />;
    if (view === 'studios') return <StudiosView />;
    if (view === 'photos') return <PhotosView />;
    if (view === 'bookmarks') return <BookmarksView />;
    if (view === 'tag') return <TagDetailView />;
    if (view === 'collections') return <CollectionsView />;
    if (view === 'database') return <DatabaseView />;
    if (view === 'thumbnails') return <ThumbnailsView />;
    if (view === 'instagram') return <InstagramView />;
    if (view === 'pages') return <PagesView />;
    if (view === 'search') return <SearchSitesView />;
    if (view === 'audio') return <AudioView />;
    if (view === 'books') return <BooksView />;
    if (view === 'vault') return <VaultView />;
    if (view === 'prompts') return <PromptsView />;
    if (view === 'connect') {
      return (
        <>
          <BrowseView />
          <ConnectModal onClose={() => { currentView.value = 'home'; }} />
        </>
      );
    }
    return <BrowseView />;
  };

  return (
    <>
      {renderView()}
      <ContextMenu />
      <TagModal />
      <RenameModal />
      <MoveModal />
      <VaultPhotoLightbox />
      <VisionModal />
    </>
  );
};
