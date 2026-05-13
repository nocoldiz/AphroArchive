import { visionModalText } from '../../store';

export const VisionModal = () => {
  const text = visionModalText.value;

  if (!text) return null;

  return (
    <div className="modal on" id="visionModal" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="modal-content" style={{ maxWidth: '500px', width: '90%' }}>
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h3 style={{ margin: 0 }}>AI Description</h3>
          <button className="close-btn" onClick={() => visionModalText.value = null} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--tx3)' }}>×</button>
        </div>
        <div className="modal-body" id="visionModalBody" style={{ whiteSpace: 'pre-wrap', marginBottom: '20px', color: 'var(--tx2)' }}>
          {text}
        </div>
        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => visionModalText.value = null}>Close</button>
        </div>
      </div>
    </div>
  );
};
