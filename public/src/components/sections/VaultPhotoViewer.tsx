import { useState, useEffect } from 'preact/hooks';

interface VaultFile {
  id: string;
  ext: string;
  name?: string;
  originalName: string;
}

interface Props {
  files: VaultFile[];
  initialFileId: string;
  onClose: () => void;
  onDelete: (id: string) => void;
}

export const VaultPhotoViewer = ({ files, initialFileId, onClose, onDelete }: Props) => {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [blobUrl, setBlobUrl] = useState('');

  useEffect(() => {
    const idx = files.findIndex(f => f.id === initialFileId);
    setCurrentIdx(idx >= 0 ? idx : 0);
  }, [files, initialFileId]);

  useEffect(() => {
    const f = files[currentIdx];
    if (!f) return;

    setBlobUrl('');
    fetch(`/api/vault/stream/${f.id}`)
      .then(r => r.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
      })
      .catch(() => {
        setBlobUrl(`/api/vault/stream/${f.id}`); // Fallback
      });

    return () => {
      if (blobUrl && blobUrl.startsWith('blob:')) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [currentIdx, files]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') handlePrev();
      else if (e.key === 'ArrowRight') handleNext();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [currentIdx]);

  const handlePrev = () => {
    setCurrentIdx(prev => (prev > 0 ? prev - 1 : files.length - 1));
  };

  const handleNext = () => {
    setCurrentIdx(prev => (prev < files.length - 1 ? prev + 1 : 0));
  };

  const handleDelete = async () => {
    const f = files[currentIdx];
    if (!f) return;
    if (!confirm(`Are you sure you want to delete ${f.name || f.originalName}?`)) return;

    try {
      const r = await fetch(`/api/vault/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [f.id] })
      });
      if (r.ok) {
        onDelete(f.id);
        if (files.length === 1) {
          onClose();
        } else {
          handleNext();
        }
      }
    } catch (e) {
      console.error('Failed to delete file', e);
    }
  };

  const currentFile = files[currentIdx];
  if (!currentFile) return null;

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.9)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
      {/* Header */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', padding: '16px', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 10001 }}>
        <div style={{ color: '#fff', fontSize: '1rem', fontWeight: 'bold' }}>
          {currentFile.name || currentFile.originalName} ({currentIdx + 1} / {files.length})
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={handleDelete}
            style={{ background: 'transparent', border: 'none', color: '#e84040', cursor: 'pointer', fontSize: '1.2rem' }}
            title="Delete"
          >
            🗑️
          </button>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '1.5rem' }}
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Image */}
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {blobUrl ? (
          <img
            src={blobUrl}
            alt=""
            style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }}
          />
        ) : (
          <div style={{ color: '#fff' }}>Loading image...</div>
        )}
      </div>

      {/* Navigation */}
      {files.length > 1 && (
        <>
          <div
            onClick={handlePrev}
            style={{ position: 'absolute', left: '20px', top: '50%', transform: 'translateY(-50%)', color: '#fff', fontSize: '3rem', cursor: 'pointer', background: 'rgba(0,0,0,0.3)', borderRadius: '50%', width: '60px', height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none' }}
          >
            ‹
          </div>
          <div
            onClick={handleNext}
            style={{ position: 'absolute', right: '20px', top: '50%', transform: 'translateY(-50%)', color: '#fff', fontSize: '3rem', cursor: 'pointer', background: 'rgba(0,0,0,0.3)', borderRadius: '50%', width: '60px', height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none' }}
          >
            ›
          </div>
        </>
      )}
    </div>
  );
};
