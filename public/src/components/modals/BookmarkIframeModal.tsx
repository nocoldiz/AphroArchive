import { useEffect } from 'preact/hooks';
import { bookmarkIframeModalState } from '../../store';

export const BookmarkIframeModal = () => {
  const state = bookmarkIframeModalState.value;

  const handleClose = (e?: any) => {
    if (e && e.target !== e.currentTarget) return;
    bookmarkIframeModalState.value = { visible: false, url: '', title: '' };
  };

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && state.visible) {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [state.visible]);

  if (!state.visible) return null;

  return (
    <div className={`bfiframe-mo ${state.visible ? 'on' : ''}`} onClick={handleClose}>
      <div className="bfiframe-box">
        <div className="bfiframe-hd">
          <span className="bfiframe-title">{state.title || 'Viewing Bookmark'}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <a
              href={state.url}
              target="_blank"
              rel="noopener noreferrer"
              className="bfiframe-open-btn"
              title="Open in new tab"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: '-2px', marginRight: '4px' }}>
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              New tab
            </a>
            <button onClick={() => handleClose()} className="bfiframe-close" title="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="bfiframe-body">
          <iframe src={state.url} allowFullScreen style={{ width: '100%', height: '100%', border: 'none' }}></iframe>
          {/* Fallback for blocked embedding can be added here if needed */}
        </div>
      </div>
    </div>
  );
};

if (typeof window !== 'undefined') {
  (window as any).openBfIframe = (url: string, title: string) => {
    bookmarkIframeModalState.value = { visible: true, url, title };
  };
  (window as any).closeBfIframe = () => {
    bookmarkIframeModalState.value = { visible: false, url: '', title: '' };
  };
}
