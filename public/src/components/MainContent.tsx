import { currentView } from '../store';
import { VideoGrid } from './VideoGrid';
import { SettingsView } from './SettingsView';
import { ThumbnailsView } from './ThumbnailsView';

export const MainContent = () => {
  const view = currentView.value;

  if (view === 'settings') {
    return <SettingsView />;
  }

  if (view === 'thumbnails') {
    return <ThumbnailsView />;
  }

  // Default to Video Grid for home, browse, categories, etc.
  return <VideoGrid />;
};
