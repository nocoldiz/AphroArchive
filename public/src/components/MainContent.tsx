import { currentView } from '../store';
import { VideoGrid } from './VideoGrid';
import { SettingsView } from './SettingsView';
import { ThumbnailsView } from './ThumbnailsView';
import { InstagramView } from './InstagramView';
import { CategoriesView } from './CategoriesView';
import { ActorsView } from './ActorsView';
import { StudiosView } from './StudiosView';
import { PhotosView } from './PhotosView';
import { BookmarksView } from './BookmarksView';
import { PagesView } from './PagesView';
import { SearchSitesView } from './SearchSitesView';
import { AudioView } from './AudioView';
import { BooksView } from './BooksView';
import { CollectionsView } from './CollectionsView';
import { DatabaseView } from './DatabaseView';
import { TagDetailView } from './TagDetailView';
import { TagModal } from './TagModal';
import { ContextMenu } from './ContextMenu';
import { RenameModal } from './RenameModal';
import { MoveModal } from './MoveModal';
import { VaultView } from './VaultView';
import { PromptsView } from './PromptsView';

export const MainContent = () => {
  const view = currentView.value;

  const renderView = () => {
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
    return <VideoGrid />;
  };

  return (
    <>
      {renderView()}
      <ContextMenu />
      <TagModal />
      <RenameModal />
      <MoveModal />
    </>
  );
};
