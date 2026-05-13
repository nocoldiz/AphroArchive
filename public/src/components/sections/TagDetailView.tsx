import { useState, useEffect } from 'preact/hooks';
import { currentTag } from '../../store';

export const TagDetailView = () => {
  const tag = currentTag.value;
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (tag) {
      loadTagVideos(tag);
    }
  }, [tag]);

  const loadTagVideos = async (tagName: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/db-tags/${encodeURIComponent(tagName)}`);
      const data = await r.json();
      setVideos(data.videos || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  if (!tag) return null;

  return (
    <div className="tag-detail-view" style={{ padding: '24px' }}>
      <h2 style={{ marginBottom: '24px', color: 'var(--ac)' }}>Tag: {tag}</h2>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--tx3)' }}>Loading…</div>
      ) : videos.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--tx3)' }}>No videos found for this tag.</div>
      ) : (
        <div className="video-grid">
          {videos.map(v => (
            <div key={v.id} className="video-card" onClick={() => {
              const w = window as any;
              if (w.openVid) w.openVid(v.id);
            }}>
              <div className="card-thumb" style={{ background: '#333' }}>
                <img src={`/api/thumbs/${v.id}/0`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              <div className="card-title" style={{ padding: '10px', fontSize: '0.9rem' }}>{v.name}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
