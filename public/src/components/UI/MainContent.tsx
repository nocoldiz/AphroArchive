import { currentView } from '../../store';
import { VideoGrid } from './VideoGrid';
import { SettingsView } from '../sections/SettingsView';
import { ThumbnailsView } from '../sections/ThumbnailsView';
import { InstagramView } from '../sections/InstagramView';
import { CategoriesView } from '../sections/CategoriesView';
import { ActorsView } from '../sections/ActorsView';
import { StudiosView } from '../sections/StudiosView';
import { PhotosView } from '../sections/PhotosView';
import { BookmarksView } from '../sections/BookmarksView';
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
import { VaultView } from '../sections/VaultView';
import { BrowseView } from '../sections/BrowseView';
import { PromptsView } from '../sections/PromptsView';
import { HomeView } from '../sections/HomeView';

export const MainContent = () => {
  const view = currentView.value;

  const renderView = () => {
    if (view === 'home') return <HomeView />;
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
    return <BrowseView />;
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
