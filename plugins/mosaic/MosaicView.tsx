import { useEffect } from 'preact/hooks';
import { mosaicOn, stopMosaic, buildMosaicTiles, scheduleMosaic, setMosaicIv, setMosaicCount, setMosaicQuery, mosTileCount, mosaicIv, mosaicQuery } from '../../public/src/mosaic';

export const MosaicView = () => {
  useEffect(() => {
    buildMosaicTiles();
    scheduleMosaic();
    return () => stopMosaic();
  }, []);

  return (
    <div id="mosaic-view" className="mosaic-view on">
      <div className="section-header">
        <h2 id="mosaic-category-label">Mosaic</h2>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <input
            id="mosaic-search"
            className="mos-search-in"
            type="text"
            placeholder="Search to filter random videos…"
            value={mosaicQuery.value}
            onInput={(e: any) => setMosaicQuery(e.target.value)}
          />
          <div>
            <span id="mosaic-count-label">Players</span>: 
            <input 
              id="mosaic-count" 
              type="number" 
              value={mosTileCount.value} 
              onInput={(e: any) => setMosaicCount(e.target.value)} 
              style={{ width: '50px', background: 'var(--bg3)', border: '1px solid var(--brd)', color: 'var(--tx)', padding: '2px 5px', borderRadius: '4px', marginLeft: '5px' }}
            />
          </div>
          <div>
            Interval: 
            <span id="mosaic-interval" style={{ marginLeft: '5px' }}>{mosaicIv.value}s</span>
            <button className="btn-primary" onClick={() => setMosaicIv(-1)} style={{ marginLeft: '5px', padding: '2px 6px' }}>-</button>
            <button className="btn-primary" onClick={() => setMosaicIv(1)} style={{ marginLeft: '5px', padding: '2px 6px' }}>+</button>
          </div>
          <button className="btn-primary" onClick={() => stopMosaic()}>Close</button>
        </div>
      </div>
      <div id="mosaic-grid" style={{ display: 'grid', gap: '10px', height: 'calc(100vh - 120px)', marginTop: '10px' }}>
        {/* Tiles will be inserted here by mosaic.ts */}
      </div>
    </div>
  );
};
