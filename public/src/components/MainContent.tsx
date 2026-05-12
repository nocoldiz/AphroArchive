import { currentView } from '../store';
import { VideoGrid } from './VideoGrid';
import { SettingsView } from './SettingsView';
import { ThumbnailsView } from './ThumbnailsView';
import { InstagramView } from './InstagramView';
import { CategoriesView } from './CategoriesView';
import { ActorsView } from './ActorsView';
import { StudiosView } from './StudiosView';

export const MainContent = () => {
  const view = currentView.value;

  if (view === 'settings') {
    return <SettingsView />;
  }

  if (view === 'categories') {
    return <CategoriesView />;
  }

  if (view === 'actors') {
    return <ActorsView />;
  }

  if (view === 'studios') {
    return <StudiosView />;
  }

  if (view === 'thumbnails') {
    return <ThumbnailsView />;
  }

  if (view === 'instagram') {
    return <InstagramView />;
  }

  // Default to Video Grid for home, browse, categories, etc.
  return <VideoGrid />;
};
