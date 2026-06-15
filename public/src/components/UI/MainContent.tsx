import { currentView, currentVideo } from '../../store';
import { VideoGrid } from './VideoGrid';
import { SettingsView } from '../sections/SettingsView';
import { ThumbnailsView } from '../sections/ThumbnailsView';
import { CategoriesView } from '../sections/CategoriesView';
import { ActorsView } from '../sections/ActorsView';
import { ChannelsView } from '../sections/ChannelsView';
import { PhotosView } from '../sections/PhotosView';
import { ScreenshotsView } from '../sections/ScreenshotsView';
import { LinksView } from '../sections/LinksView';
import { VisionModal } from '../modals/VisionModal';
import { PagesView } from '../sections/PagesView';
import { SearchSitesView } from '../sections/SearchSitesView';
import { AudioView } from '../sections/AudioView';
import { BooksView } from '../sections/BooksView';
import { FilesView } from '../sections/FilesView';
import { CollectionsView } from '../sections/CollectionsView';
import { TagModal } from '../modals/TagModal';
import { ActorModal } from '../modals/ActorModal';
import { ChannelModal } from '../modals/ChannelModal';
import { VaultZipModal } from '../modals/VaultZipModal';
import { LinkIframeModal } from '../modals/LinkIframeModal';
import { ContextMenu } from './ContextMenu';
import { RenameModal } from '../modals/RenameModal';
import { MoveModal } from '../modals/MoveModal';
import { VaultView } from '../sections/VaultView';
import { BrowseView } from '../sections/BrowseView';
import { PlayerView } from '../sections/PlayerView';
import { HomeView } from '../sections/HomeView';
import { ChaptersView } from '../sections/ChaptersView';
import { SeriesView } from '../sections/SeriesView';
import { DownloadQueueView } from '../sections/DownloadQueueView';
import { VaultUnlockModal } from '../modals/VaultUnlockModal';
import { ImportModal } from '../modals/ImportModal';
import { SubtitlesView } from '../sections/SubtitlesView';
import { SubtitleEditorModal } from '../modals/SubtitleEditorModal';
import { useEffect, Suspense, lazy } from 'preact/compat';

// Heavy/rare views — code-split so the initial bundle stays small
const RedditView = lazy(() => import('../../../../plugins/reddit/RedditView').then(m => ({ default: m.RedditView })));
const InstagramView = lazy(() => import('../../../../plugins/instagram/InstagramView').then(m => ({ default: m.InstagramView })));
const MosaicView = lazy(() => import('../../../../plugins/mosaic/MosaicView').then(m => ({ default: m.MosaicView })));
const DatabaseView = lazy(() => import('../sections/DatabaseView').then(m => ({ default: m.DatabaseView })));
const ActorScraperView = lazy(() => import('../sections/ActorScraperView').then(m => ({ default: m.ActorScraperView })));
const AssistantView = lazy(() => import('../../../../plugins/assistant/AssistantView').then(m => ({ default: m.AssistantView })));
const CategorizerView = lazy(() => import('../sections/CategorizerView').then(m => ({ default: m.CategorizerView })));
const PromptsView = lazy(() => import('../../../../plugins/prompts/PromptsView').then(m => ({ default: m.PromptsView })));
const DuplicatesView = lazy(() => import('../sections/DuplicatesView').then(m => ({ default: m.DuplicatesView })));
const CorruptedView = lazy(() => import('../sections/CorruptedView').then(m => ({ default: m.CorruptedView })));
const LibraryHealthView = lazy(() => import('../sections/LibraryHealthView').then(m => ({ default: m.LibraryHealthView })));

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
    if (view === 'series') return <SeriesView />;
    if (view === 'scraper') return <ActorScraperView />;
    if (view === 'settings') return <SettingsView />;
    if (view === 'folders') return <CategoriesView />;
    if (view === 'actors') return <ActorsView />;
    if (view === 'channels') return <ChannelsView />;
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
    if (view === 'files') return <FilesView />;
    if (view === 'vault') return <VaultView />;
    if (view === 'prompts') return <PromptsView />;
    if (view === 'player') return <PlayerView />;
    if (view === 'mosaic')   return <MosaicView />;
    if (view === 'assistant') return <AssistantView />;
    if (view === 'categorizer') return <CategorizerView />;
    if (view === 'duplicates') return <DuplicatesView />;
    if (view === 'corrupted') return <CorruptedView />;
    if (view === 'library-health') return <LibraryHealthView />;
    if (view === 'subtitles') return <SubtitlesView />;
    return <BrowseView />;
  };

  return (
    <>
      <Suspense fallback={<ViewLoading />}>
        <div key={view} className="view-fade">
          {renderView()}
        </div>
      </Suspense>
      <ContextMenu />
      <TagModal />
      <ActorModal />
      <ChannelModal />
      <VaultZipModal />
      <LinkIframeModal />
      <RenameModal />
      <MoveModal />
      <VisionModal />
      <VaultUnlockModal />
      <ImportModal />
      <SubtitleEditorModal />
    </>
  );
};
