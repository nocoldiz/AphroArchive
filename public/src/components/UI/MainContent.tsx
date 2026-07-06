import { currentView, currentVideo } from '../../store';
import { VisionModal } from '../modals/VisionModal';
import { TagModal } from '../modals/TagModal';
import { CreateTagModal } from '../modals/CreateTagModal';
import { ActorModal } from '../modals/ActorModal';
import { ChannelModal } from '../modals/ChannelModal';
import { VaultZipModal } from '../modals/VaultZipModal';
import { LinkIframeModal } from '../modals/LinkIframeModal';
import { ContextMenu } from './ContextMenu';
import { RenameModal } from '../modals/RenameModal';
import { VideoPreviewModal } from '../modals/VideoPreviewModal';
import { MoveModal } from '../modals/MoveModal';
import { BrowseView } from '../sections/BrowseView';
import { SearchResultsView } from '../sections/SearchResultsView';
import { HomeView } from '../sections/HomeView';
import { VaultUnlockModal } from '../modals/VaultUnlockModal';
import { ImportModal } from '../modals/ImportModal';
import { DialogModal } from '../modals/DialogModal';
import { useEffect, Suspense, lazy } from 'preact/compat';

// Heavy/rare views — code-split so the initial bundle stays small.
// Only the startup-critical views (Home, Browse, Player, SearchResults) are
// eager; everything else loads on first navigation and is warmed by the
// idle prefetch in App.tsx.
const SettingsView = lazy(() => import('../sections/SettingsView').then(m => ({ default: m.SettingsView })));
const ThumbnailsView = lazy(() => import('../sections/ThumbnailsView').then(m => ({ default: m.ThumbnailsView })));
const CategoriesView = lazy(() => import('../sections/CategoriesView').then(m => ({ default: m.CategoriesView })));
const ActorsView = lazy(() => import('../sections/ActorsView').then(m => ({ default: m.ActorsView })));
const ChannelsView = lazy(() => import('../sections/ChannelsView').then(m => ({ default: m.ChannelsView })));
const PhotosView = lazy(() => import('../sections/PhotosView').then(m => ({ default: m.PhotosView })));
const ScreenshotsView = lazy(() => import('../sections/ScreenshotsView').then(m => ({ default: m.ScreenshotsView })));
const LinksView = lazy(() => import('../sections/LinksView').then(m => ({ default: m.LinksView })));
const RssView = lazy(() => import('../sections/RssView').then(m => ({ default: m.RssView })));
const PagesView = lazy(() => import('../sections/PagesView').then(m => ({ default: m.PagesView })));
const SearchSitesView = lazy(() => import('../sections/SearchSitesView').then(m => ({ default: m.SearchSitesView })));
const AudioView = lazy(() => import('../sections/AudioView').then(m => ({ default: m.AudioView })));
const BooksView = lazy(() => import('../sections/BooksView').then(m => ({ default: m.BooksView })));
const FilesView = lazy(() => import('../sections/FilesView').then(m => ({ default: m.FilesView })));
const CollectionsView = lazy(() => import('../sections/CollectionsView').then(m => ({ default: m.CollectionsView })));
const VaultView = lazy(() => import('../sections/VaultView').then(m => ({ default: m.VaultView })));
// The player (incl. AdvancedPlayer + ZapView) is the single largest view; it's
// split out and warmed by the idle prefetch so click-to-play stays instant.
const PlayerView = lazy(() => import('../sections/PlayerView').then(m => ({ default: m.PlayerView })));
const RedditView = lazy(() => import('../../../../plugins/reddit/RedditView').then(m => ({ default: m.RedditView })));
const InstagramView = lazy(() => import('../../../../plugins/instagram/InstagramView').then(m => ({ default: m.InstagramView })));
const MosaicView = lazy(() => import('../../../../plugins/mosaic/MosaicView').then(m => ({ default: m.MosaicView })));
const DatabaseView = lazy(() => import('../sections/DatabaseView').then(m => ({ default: m.DatabaseView })));
const ActorScraperView = lazy(() => import('../sections/ActorScraperView').then(m => ({ default: m.ActorScraperView })));
const AssistantView = lazy(() => import('../../../../plugins/assistant/AssistantView').then(m => ({ default: m.AssistantView })));
const CategorizerView = lazy(() => import('../sections/CategorizerView').then(m => ({ default: m.CategorizerView })));
const RenamerView = lazy(() => import('../sections/RenamerView').then(m => ({ default: m.RenamerView })));
const PromptsView = lazy(() => import('../../../../plugins/prompts/PromptsView').then(m => ({ default: m.PromptsView })));
const DuplicatesView = lazy(() => import('../sections/DuplicatesView').then(m => ({ default: m.DuplicatesView })));
const CorruptedView = lazy(() => import('../sections/CorruptedView').then(m => ({ default: m.CorruptedView })));
const LibraryHealthView = lazy(() => import('../sections/LibraryHealthView').then(m => ({ default: m.LibraryHealthView })));
const ChaptersView = lazy(() => import('../sections/ChaptersView').then(m => ({ default: m.ChaptersView })));
const SeriesView = lazy(() => import('../sections/SeriesView').then(m => ({ default: m.SeriesView })));
const DownloadQueueView = lazy(() => import('../sections/DownloadQueueView').then(m => ({ default: m.DownloadQueueView })));
const SubtitlesView = lazy(() => import('../sections/SubtitlesView').then(m => ({ default: m.SubtitlesView })));
const SubtitleEditorModal = lazy(() => import('../modals/SubtitleEditorModal').then(m => ({ default: m.SubtitleEditorModal })));
const GuideView = lazy(() => import('../sections/GuideView').then(m => ({ default: m.GuideView })));
const RadioModeView = lazy(() => import('../sections/RadioModeView').then(m => ({ default: m.RadioModeView })));

const ViewLoading = () => <div className="skeleton" style={{ margin: '40px auto', width: '120px', height: '24px' }} />;

// Warm the code-split view chunks after first paint (called from App.tsx on
// idle) so navigating to any view never waits on a chunk download. Sequential
// on purpose: one connection at a time, so it never competes with the video
// pagination stream or thumbnails for the browser's per-origin socket pool.
export async function prefetchLazyViews() {
  const loaders: Array<() => Promise<unknown>> = [
    // Most likely first interaction: opening a video.
    () => import('../sections/PlayerView'),
    () => import('../sections/VaultView'),
    () => import('../sections/LinksView'),
    () => import('../sections/SettingsView'),
    () => import('../sections/ActorsView'),
    () => import('../sections/CollectionsView'),
    () => import('../sections/CategoriesView'),
    () => import('../sections/ChannelsView'),
    () => import('../sections/PhotosView'),
    () => import('../sections/ScreenshotsView'),
    () => import('../sections/RssView'),
    () => import('../sections/PagesView'),
    () => import('../sections/SearchSitesView'),
    () => import('../sections/AudioView'),
    () => import('../sections/BooksView'),
    () => import('../sections/FilesView'),
    () => import('../sections/ThumbnailsView'),
  ];
  for (const load of loaders) {
    try { await load(); } catch { /* offline/dev — chunk loads on demand instead */ }
  }
}

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
    if (view === 'rss') return <RssView />;
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
    if (view === 'renamer') return <RenamerView />;
    if (view === 'duplicates') return <DuplicatesView />;
    if (view === 'corrupted') return <CorruptedView />;
    if (view === 'library-health') return <LibraryHealthView />;
    if (view === 'subtitles') return <SubtitlesView />;
    if (view === 'guide') return <GuideView />;
    if (view === 'radio') return <RadioModeView />;
    if (view === 'search-results') return <SearchResultsView />;
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
      <CreateTagModal />
      <ActorModal />
      <ChannelModal />
      <VaultZipModal />
      <LinkIframeModal />
      <RenameModal />
      <VideoPreviewModal />
      <MoveModal />
      <VisionModal />
      <VaultUnlockModal />
      <ImportModal />
      <DialogModal />
      <Suspense fallback={null}>
        <SubtitleEditorModal />
      </Suspense>
    </>
  );
};
