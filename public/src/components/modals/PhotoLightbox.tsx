/** @jsxImportSource preact */
import { useState, useEffect } from 'preact/hooks';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  imgUrl: string;
  title: string;
  sizeF?: string;
  onPrev?: () => void;
  onNext?: () => void;
  onDelete?: () => void;
  onDownload?: () => void;
  onDescribe?: () => void;
  onFav?: () => void;
  isFav?: boolean;
  onMeta?: () => void;
  slideshowOn?: boolean;
  onToggleSlideshow?: () => void;
  slideSecs?: number;
  onSlideSecsChange?: (secs: number) => void;
  description?: string | null;
  isAi?: boolean;
  aiPrompt?: string;
}

export const PhotoLightbox = ({
  isOpen,
  onClose,
  imgUrl,
  title,
  sizeF,
  onPrev,
  onNext,
  onDelete,
  onDownload,
  onDescribe,
  onFav,
  isFav = false,
  onMeta,
  slideshowOn = false,
  onToggleSlideshow,
  slideSecs = 4,
  onSlideSecsChange,
  description,
  isAi,
  aiPrompt
}: Props) => {
  if (!isOpen) return null;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && onPrev) onPrev();
      if (e.key === 'ArrowRight' && onNext) onNext();
      if (e.key === ' ' && onToggleSlideshow) {
        e.preventDefault();
        onToggleSlideshow();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, onPrev, onNext, onToggleSlideshow]);

  return (
    <div id="photosLightbox" className="ph-lightbox on" onClick={(e: any) => { if (e.target.id === 'photosLightbox') onClose(); }} style={{ zIndex: 10000 }}>
      <button className="ph-lb-close" onClick={onClose}>×</button>
      
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '75%', position: 'relative' }}>
        {onPrev && <button className="ph-lb-nav ph-lb-prev" onClick={(e) => { e.stopPropagation(); onPrev(); }}>‹</button>}
        <img id="photosLbImg" src={imgUrl} alt={title} onClick={(e) => e.stopPropagation()} style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }} />
        {onNext && <button className="ph-lb-nav ph-lb-next" onClick={(e) => { e.stopPropagation(); onNext(); }}>›</button>}
      </div>

      <div className="ph-lb-caption" style={{ color: 'white', marginTop: '20px', textAlign: 'center', width: '80%', display: 'flex', flexDirection: 'column', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
        <div id="photosLbCaption" style={{ fontSize: '1rem', marginBottom: '10px' }}>
          {title} {sizeF ? ` · ${sizeF}` : ''}
        </div>
        
        <div className="ph-lb-actions" style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginBottom: '15px', flexWrap: 'wrap' }}>
          {onToggleSlideshow && (
            <button className="ph-lb-action-btn" onClick={onToggleSlideshow}>
              {slideshowOn ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              )}
              <span>{slideshowOn ? 'Pause' : 'Play'}</span>
            </button>
          )}
          
          {onSlideSecsChange && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(255,255,255,0.1)', padding: '0 8px', borderRadius: '4px' }}>
              <input 
                type="number" 
                min="1" 
                max="60" 
                value={slideSecs} 
                onChange={(e: any) => onSlideSecsChange(parseInt(e.target.value, 10))}
                style={{ width: '40px', background: 'transparent', border: 'none', color: '#fff', textAlign: 'center', fontSize: '13px' }}
              />
              <span style={{ fontSize: '12px', color: '#aaa' }}>s</span>
            </div>
          )}

          {onFav && (
            <button className={`ph-lb-action-btn ${isFav ? 'fav-active' : ''}`} onClick={onFav} title="Toggle Favourite">
              <svg width="14" height="14" viewBox="0 0 24 24" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </button>
          )}

          {onDownload && (
            <button className="ph-lb-action-btn" onClick={onDownload} title="Download">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Download</span>
            </button>
          )}
          
          {onDescribe && (
            <button className="ph-lb-action-btn" onClick={onDescribe} title="Describe with AI">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span>Describe</span>
            </button>
          )}

          {onMeta && (
            <button className="ph-lb-action-btn" onClick={onMeta} title="View Metadata">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>Meta</span>
            </button>
          )}

          {onDelete && (
            <button className="ph-lb-action-btn" onClick={onDelete} style={{ color: '#ff4d4d' }} title="Delete">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
              <span>Delete</span>
            </button>
          )}
        </div>

        {description && (
          <div id="photosLbDesc" style={{ background: 'rgba(255,255,255,0.1)', padding: '10px', borderRadius: '5px', fontSize: '0.9rem', marginBottom: '10px', width: '100%' }}>
            {description}
          </div>
        )}

        {isAi && aiPrompt && (
          <div style={{ background: 'rgba(255,255,255,0.1)', padding: '10px', borderRadius: '5px', fontSize: '0.85rem', marginTop: '10px', textAlign: 'left', maxHeight: '150px', overflowY: 'auto', width: '100%' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '5px', color: 'var(--ac)' }}>AI Parameters:</div>
            <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'monospace', color: 'var(--tx2)' }}>{aiPrompt}</pre>
          </div>
        )}
      </div>
    </div>
  );
};
