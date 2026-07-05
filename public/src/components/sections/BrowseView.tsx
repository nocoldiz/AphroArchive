import { VideoGrid } from '../UI/VideoGrid';
import { recentVideos, currentView, currentFolder, currentTag, currentTagTerms } from '../../store';
import { SearchExtras } from '../UI/SearchExtras';
import { SectionControls } from '../UI/SectionControls';

const Breadcrumb = () => {
  const goAll = () => {
    currentFolder.value = '';
    currentTag.value = null;
    currentTagTerms.value = [];
  };

  // Tag view: a tag isn't a path, so it's a single (non-clickable) crumb.
  if (currentTag.value) {
    return (
      <h2 id="section-title">
        <span className="crumb crumb--link" onClick={goAll}>All Videos</span>
        <span className="crumb-sep"> / </span>
        <span className="crumb">{currentTag.value}</span>
      </h2>
    );
  }

  const cat = currentFolder.value;
  if (!cat) return <h2 id="section-title">All Videos</h2>;
  if (cat === 'uncategorized') {
    return (
      <h2 id="section-title">
        <span className="crumb crumb--link" onClick={goAll}>All Videos</span>
        <span className="crumb-sep"> / </span>
        <span className="crumb">Uncategorized</span>
      </h2>
    );
  }

  const parts = cat.split('/');
  return (
    <h2 id="section-title">
      <span className="crumb crumb--link" onClick={goAll}>All Videos</span>
      {parts.map((seg, i) => {
        const path = parts.slice(0, i + 1).join('/');
        const isLast = i === parts.length - 1;
        return (
          <span key={path}>
            <span className="crumb-sep"> / </span>
            {isLast
              ? <span className="crumb">{seg}</span>
              : <span className="crumb crumb--link" onClick={() => { currentFolder.value = path; currentTag.value = null; currentTagTerms.value = []; }}>{seg}</span>}
          </span>
        );
      })}
    </h2>
  );
};

export const BrowseView = () => {
  return (
    <div className="browse-view on" id="browse-view">
      <div className="section-header">
        <Breadcrumb /><span id="result-count"></span>
        <SectionControls
          showFilters
          showSelect
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
