import { useState, useEffect } from 'preact/hooks';

interface VaultFile {
  id: string;
  ext: string;
  name?: string;
  originalName: string;
}

interface Props {
  pool: VaultFile[];
  onClose: () => void;
}

export const VaultMosaic = ({ pool, onClose }: Props) => {
  const [numTiles, setNumTiles] = useState(0);
  const [tiles, setTiles] = useState<VaultFile[]>([]);

  useEffect(() => {
    const cols = Math.max(1, Math.floor(window.innerWidth / 300));
    const rows = Math.max(1, Math.floor(window.innerHeight / 300));
    const count = cols * rows;
    setNumTiles(count);

    // Initial fill
    const initialTiles: VaultFile[] = [];
    for (let i = 0; i < count; i++) {
      initialTiles.push(pool[Math.floor(Math.random() * pool.length)]);
    }
    setTiles(initialTiles);
  }, [pool]);

  useEffect(() => {
    if (tiles.length === 0) return;

    const interval = setInterval(() => {
      setTiles(prev => {
        const next = [...prev];
        const randomIdx = Math.floor(Math.random() * next.length);
        next[randomIdx] = pool[Math.floor(Math.random() * pool.length)];
        return next;
      });
    }, 1500);

    return () => clearInterval(interval);
  }, [pool, tiles.length]);

  const cols = Math.max(1, Math.floor(window.innerWidth / 300));

  return (
    <div
      style={{
        position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
        backgroundColor: '#000', zIndex: '9999', display: 'grid', gap: '4px',
        overflow: 'hidden',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${Math.ceil(numTiles / cols)}, 1fr)`
      }}
    >
      <div
        onClick={onClose}
        style={{
          position: 'absolute', top: '20px', right: '20px', color: '#fff', 
          fontSize: '28px', cursor: 'pointer', zIndex: '10000', 
          background: 'rgba(0,0,0,0.6)', borderRadius: '50%', 
          width: '40px', height: '40px', display: 'flex', 
          alignItems: 'center', justifyContent: 'center'
        }}
      >
        ✕
      </div>

      {tiles.map((f, i) => {
        if (!f) return null;
        const ext = (f.ext || '').toLowerCase().replace('.', '');
        const isVideo = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v', 'mpg', 'mpeg', 'wmv', 'ts'].includes(ext);
        const url = `/api/vault/stream/${f.id}`;

        return (
          <div key={i} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', backgroundColor: '#111' }}>
            {isVideo ? (
              <video
                src={url}
                autoPlay
                muted
                loop
                playsInline
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <img
                src={url}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                loading="lazy"
              />
            )}
          </div>
        );
      })}
    </div>
  );
};
