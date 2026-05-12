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
import { CollectionsView } from './CollectionsView';
import { DatabaseView } from './DatabaseView';
import { ContextMenu } from './ContextMenu';

export const MainContent = () => {
  const view = currentView.value;

  const renderView = () => {
    if (view === 'settings') return <SettingsView />;
    if (view === 'categories') return <CategoriesView />;
    if (view === 'actors') return <ActorsView />;
    if (view === 'studios') return <StudiosView />;
    if (view === 'photos') return <PhotosView />;
    if (view === 'bookmarks') return <BookmarksView />;
    if (view === 'collections') return <CollectionsView />;
    if (view === 'database') return <DatabaseView />;
    if (view === 'thumbnails') return <ThumbnailsView />;
    if (view === 'instagram') return <InstagramView />;
    return <VideoGrid />;
  };

  return (
    <>
      {renderView()}
      <ContextMenu />
    </>
  );
};
