import { useState, useEffect } from 'preact/hooks';
import { currentTag } from '../../store';
import { VideoCard } from '../UI/VideoGrid';

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
    <div className="tag-detail-view on" style={{ padding: '20px' }}>
      <div className="view-header" style={{ display: 'flex', alignItems: 'center', marginBottom: '20px' }}>
        <button className="btn" onClick={() => currentTag.value = null} style={{ marginRight: '15px' }}>
          ← Back
        </button>
        <h1 style={{ margin: 0 }}>Tag: {tag}</h1>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--tx3)' }}>Loading…</div>
      ) : videos.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--tx3)' }}>No videos found for this tag.</div>
      ) : (
        <div className="video-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px' }}>
          {videos.map(v => (
            <VideoCard key={v.id} video={v} isSelected={false} />
          ))}
        </div>
      )}
    </div>
  );
};
