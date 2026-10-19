import { visionModalText } from '../../store';
import { useEscape } from './useEscape';

const close = () => { visionModalText.value = null; };

export const VisionModal = () => {
  const text = visionModalText.value;
  useEscape(!!text, close);

  if (!text) return null;

  return (
    <div className="modal-overlay on" id="visionModal" style={{ zIndex: 10000 }} onClick={(e: any) => e.target === e.currentTarget && close()}>
      <div className="modal-dialog" style={{ maxWidth: '500px' }}>
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>AI Description</h2>
          <button className="ui-btn ui-btn--ghost ui-btn--icon" onClick={close} aria-label="Close" title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="modal-body" id="visionModalBody" style={{ whiteSpace: 'pre-wrap', color: 'var(--tx2)' }}>
          {text}
        </div>
        <div className="modal-footer">
          <button className="modal-btn" onClick={close}>Close</button>
        </div>
      </div>
    </div>
  );
};
