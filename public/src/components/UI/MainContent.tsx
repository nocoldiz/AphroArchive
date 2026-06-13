import { currentView, currentVideo } from '../../store';
import { VideoGrid } from './VideoGrid';
import { SettingsView } from '../sections/SettingsView';
import { ThumbnailsView } from '../sections/ThumbnailsView';
import { CategoriesView } from '../sections/CategoriesView';
import { ActorsView } from '../sections/ActorsView';
import { StudiosView } from '../sections/StudiosView';
import { PhotosView } from '../sections/PhotosView';
import { ScreenshotsView } from '../sections/ScreenshotsView';
import { LinksView } from '../sections/LinksView';
import { VisionModal } from '../modals/VisionModal';
import { PagesView } from '../sections/PagesView';
import { SearchSitesView } from '../sections/SearchSitesView';
import { AudioView } from '../sections/AudioView';
import { BooksView } from '../sections/BooksView';
import { CollectionsView } from '../sections/CollectionsView';
import { TagModal } from '../modals/TagModal';
import { ActorModal } from '../modals/ActorModal';
import { StudioModal } from '../modals/StudioModal';
import { VaultZipModal } from '../modals/VaultZipModal';
import { LinkIframeModal } from '../modals/LinkIframeModal';
import { ContextMenu } from './ContextMenu';
import { RenameModal } from '../modals/RenameModal';
import { MoveModal } from '../modals/MoveModal';
import { VaultView } from '../sections/VaultView';
import { BrowseView } from '../sections/BrowseView';
import { PlayerView } from '../sections/PlayerView';
import { MosaicView } from '../sections/MosaicView';
import { HomeView } from '../sections/HomeView';
import { ChaptersView } from '../sections/ChaptersView';
import { DownloadQueueView } from '../sections/DownloadQueueView';
import { VaultUnlockModal } from '../modals/VaultUnlockModal';
import { ImportModal } from '../modals/ImportModal';
import { useEffect, Suspense, lazy } from 'preact/compat';

// Heavy/rare views — code-split so the initial bundle stays small
const RedditView = lazy(() => import('../sections/RedditView').then(m => ({ default: m.RedditView })));
const InstagramView = lazy(() => import('../sections/InstagramView').then(m => ({ default: m.InstagramView })));
const DatabaseView = lazy(() => import('../sections/DatabaseView').then(m => ({ default: m.DatabaseView })));
const ActorScraperView = lazy(() => import('../sections/ActorScraperView').then(m => ({ default: m.ActorScraperView })));
const AssistantView = lazy(() => import('../sections/AssistantView').then(m => ({ default: m.AssistantView })));
const CategorizerView = lazy(() => import('../sections/CategorizerView').then(m => ({ default: m.CategorizerView })));
const PromptsView = lazy(() => import('../sections/PromptsView').then(m => ({ default: m.PromptsView })));
const DuplicatesView = lazy(() => import('../sections/DuplicatesView').then(m => ({ default: m.DuplicatesView })));

const ViewLoading = () => <div className="skeleton" style={{ margin: '40px auto', width: '120px', height: '24px' }} />;

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
    if (view === 'hub') return <HomeView />;
    if (view === 'chapters') return <ChaptersView />;
    if (view === 'scraper') return <ActorScraperView />;
    if (view === 'settings') return <SettingsView />;
    if (view === 'categories') return <CategoriesView />;
    if (view === 'actors') return <ActorsView />;
    if (view === 'studios') return <StudiosView />;
    if (view === 'photos') return <PhotosView />;
    if (view === 'screenshots') return <ScreenshotsView />;
    if (view === 'links') return <LinksView />;
    if (view === 'download-queue') return <DownloadQueueView />;
    if (view === 'collections') return <CollectionsView />;
    if (view === 'database') return <DatabaseView />;
    if (view === 'thumbnails') return <ThumbnailsView />;
    if (view === 'instagram') return <InstagramView />;
    if (view === 'reddit') return <RedditView />;
    if (view === 'pages') return <PagesView />;
    if (view === 'search') return <SearchSitesView />;
    if (view === 'audio') return <AudioView />;
    if (view === 'books') return <BooksView />;
    if (view === 'vault') return <VaultView />;
    if (view === 'prompts') return <PromptsView />;
    if (view === 'player') return <PlayerView />;
    if (view === 'mosaic')   return <MosaicView />;
    if (view === 'assistant') return <AssistantView />;
    if (view === 'categorizer') return <CategorizerView />;
    if (view === 'duplicates') return <DuplicatesView />;
    return <BrowseView />;
  };

  return (
    <>
      <Suspense fallback={<ViewLoading />}>
        {renderView()}
      </Suspense>
      <ContextMenu />
      <TagModal />
      <ActorModal />
      <StudioModal />
      <VaultZipModal />
      <LinkIframeModal />
      <RenameModal />
      <MoveModal />
      <VisionModal />
      <VaultUnlockModal />
      <ImportModal />
    </>
  );
};
