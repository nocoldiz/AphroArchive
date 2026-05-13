import { VideoGrid } from '../UI/VideoGrid';
import { galleryFilter, sortMode, isShuffle, favFilter, recentVideos, currentView, cardSize } from '../../store';
import { SearchExtras } from '../UI/SearchExtras';
import { SectionControls } from '../UI/SectionControls';

export const BrowseView = () => {
  return (
    <div className="browse-view on" id="browse-view">
      <div className="section-header">
        <h2 id="section-title">All Videos</h2><span id="result-count"></span>
        <SectionControls 
          showClearHistory={currentView.value === 'recent'}
          onClearHistory={async () => {
            if (confirm('Clear watch history?')) {
              await fetch('/api/history', { method: 'DELETE' });
              recentVideos.value = [];
              if ((window as any).toast) (window as any).toast('History cleared');
            }
          }}
        />
      </div>

      <VideoGrid />
      <SearchExtras />
    </div>
  );
};
