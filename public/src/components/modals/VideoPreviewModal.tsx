import { videoPreviewModalState } from '../../store';

export const VideoPreviewModal = () => {
  const state = videoPreviewModalState.value;
  if (!state.visible || !state.vidId) return null;

  const handleClose = () => {
    videoPreviewModalState.value = { visible: false, vidId: null, title: '' };
  };

  return (
    <div className="modal-overlay on" onClick={(e: any) => e.target === e.currentTarget && handleClose()} style={{ zIndex: 20000 }}>
      <div className="modal-content" style={{ background: 'var(--bg2)', padding: '14px', borderRadius: '8px', width: 'min(900px, 92vw)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
          <h3 style={{ margin: 0, flex: 1, fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={state.title}>
            {state.title || 'Preview'}
          </h3>
          <button type="button" onClick={handleClose} aria-label="Close preview"
            style={{ background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}>
            ✕
          </button>
        </div>
        <video
          src={`/api/stream/${state.vidId}`}
          controls
          autoPlay
          playsInline
          style={{ width: '100%', maxHeight: '70vh', borderRadius: '6px', background: '#000', display: 'block' }}
        />
      </div>
    </div>
  );
};
