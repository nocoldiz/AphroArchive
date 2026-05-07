import { useEffect } from 'preact/hooks';
import { thumbnails, loadThumbnails } from '../store';

export const ThumbnailsView = () => {
  useEffect(() => {
    loadThumbnails();
  }, []);

  const list = thumbnails.value;

  if (list.length === 0) {
    return (
      <div className="empty-state">
        <h3 style={{ color: 'var(--tx2)' }}>No thumbnails found</h3>
        <p style={{ color: 'var(--tx3)' }}>Generate some thumbnails first by browsing your videos.</p>
      </div>
    );
  }

  return (
    <div className="thumbnails-view" style={{ padding: '20px' }}>
      <div className="section-header" style={{ marginBottom: '20px' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>All Generated Thumbnails</h2>
        <span style={{ color: 'var(--tx3)', marginLeft: '10px' }}>{list.length} videos</span>
      </div>
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', 
        gap: '20px' 
      }}>
        {list.map(group => (
          <div key={group.id} className="thumb-group" style={{ 
            background: 'var(--bg2)', 
            borderRadius: '12px', 
            overflow: 'hidden',
            border: '1px solid var(--brd)'
          }}>
            <div style={{ padding: '10px', fontSize: '0.8rem', color: 'var(--tx2)', borderBottom: '1px solid var(--brd)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              ID: {group.id}
            </div>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(5, 1fr)', 
              gap: '2px',
              padding: '2px'
            }}>
              {group.thumbs.map((src, i) => (
                <img 
                  key={i} 
                  src={src} 
                  alt={`Thumb ${i}`} 
                  loading="lazy"
                  style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover' }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
