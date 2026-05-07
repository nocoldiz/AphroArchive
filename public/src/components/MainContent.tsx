import { currentView } from '../store';
import { VideoGrid } from './VideoGrid';
import { SettingsView } from './SettingsView';

export const MainContent = () => {
  const view = currentView.value;

  if (view === 'settings') {
    return <SettingsView />;
  }

  // Default to Video Grid for home, browse, categories, etc.
  return <VideoGrid />;
};
