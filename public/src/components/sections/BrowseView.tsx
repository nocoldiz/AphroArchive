import { useState, useEffect, useRef } from 'preact/hooks';
import { VideoGrid } from '../UI/VideoGrid';
import { galleryFilter, sortMode, isShuffle, favFilter, recentVideos, currentView, cardSize, currentFolder, currentTag, currentTagTerms, folders } from '../../store';
import { SearchExtras } from '../UI/SearchExtras';
import { SectionControls } from '../UI/SectionControls';

const goFolder = (path: string) => {
  currentFolder.value = path;
  currentTag.value = null;
  currentTagTerms.value = [];
};

// A breadcrumb segment that also exposes a dropdown of sibling folders at the
// same level, so the user can hop between adjacent folders without going up.
const CrumbDropdown = ({ path, label, isLast }: { path: string; label: string; isLast: boolean }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Siblings share the same parent prefix and depth as this segment.
  const depth = path.split('/').length;
  const prefix = depth > 1 ? path.slice(0, path.lastIndexOf('/')) : '';
  const siblings = folders.value
    .filter(f => {
      if (f.path === 'uncategorized') return false;
      const parts = f.path.split('/');
      if (parts.length !== depth) return false;
      return (depth > 1 ? parts.slice(0, -1).join('/') : '') === prefix;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <span className="crumb-dd" ref={ref}>
      <span
        className={isLast ? 'crumb' : 'crumb crumb--link'}
        onClick={isLast ? undefined : () => goFolder(path)}
      >{label}</span>
      {siblings.length > 1 && (
        <button
          type="button"
          className={`crumb-dd-btn${open ? ' on' : ''}`}
          onClick={() => setOpen(o => !o)}
          title="Sibling folders"
        >▾</button>
      )}
      {open && (
        <div className="crumb-dd-menu">
          {siblings.map(f => (
            <div
              key={f.path}
              className={`crumb-dd-item${f.path === path ? ' on' : ''}`}
              onClick={() => { goFolder(f.path); setOpen(false); }}
            >
              <span className="crumb-dd-name">{f.name}</span>
              <span className="crumb-dd-count">{f.count}</span>
            </div>
          ))}
        </div>
      )}
    </span>
  );
};

const Breadcrumb = () => {
  // Tag view: a tag isn't a path, so it's a single (non-clickable) crumb.
  if (currentTag.value) {
    return (
      <h2 id="section-title">
        <span className="crumb crumb--link" onClick={() => goFolder('')}>All Videos</span>
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
        <span className="crumb crumb--link" onClick={() => goFolder('')}>All Videos</span>
        <span className="crumb-sep"> / </span>
        <span className="crumb">Uncategorized</span>
      </h2>
    );
  }

  const parts = cat.split('/');
  return (
    <h2 id="section-title">
      <span className="crumb crumb--link" onClick={() => goFolder('')}>All Videos</span>
      {parts.map((seg, i) => {
        const path = parts.slice(0, i + 1).join('/');
        const isLast = i === parts.length - 1;
        return (
          <span key={path}>
            <span className="crumb-sep"> / </span>
            <CrumbDropdown path={path} label={seg} isLast={isLast} />
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
