import { useEffect } from 'preact/hooks';
import {
  stopMosaic, buildMosaicTiles, scheduleMosaic, scheduleMosaicLayout,
  setMosaicIv, setMosaicCount, setMosaicQuery,
  setMosLayoutIv, setMosRandomizeLayout, setMosPlayAllAudio,
  mosTileCount, mosaicIv, mosaicQuery, mosLayoutIv, mosRandomizeLayout, mosPlayAllAudio,
} from '../../public/src/mosaic';

export const MosaicView = () => {
  useEffect(() => {
    buildMosaicTiles();
    scheduleMosaic();
    scheduleMosaicLayout();
    return () => stopMosaic();
  }, []);

  return (
    <div id="mosaic-view" className="mosaic-view on">
      <div className="section-header">
        <h2 id="mosaic-category-label">Mosaic</h2>
        <div className="mos-controls">
          <input
            id="mosaic-search"
            className="mos-search-in"
            type="text"
            placeholder="Search to filter random videos…"
            value={mosaicQuery.value}
            onInput={(e: any) => setMosaicQuery(e.target.value)}
          />
          <label className="mos-ctrl-grp">
            <span id="mosaic-count-label">Players</span>
            <input
              id="mosaic-count"
              className="mos-num-in"
              type="number"
              min={1}
              max={16}
              value={mosTileCount.value}
              onInput={(e: any) => setMosaicCount(e.target.value)}
            />
          </label>
          <div className="mos-ctrl-grp">
            <span>Interval</span>
            <span id="mosaic-interval">{mosaicIv.value}s</span>
            <button type="button" className="btn-primary mos-step" onClick={() => setMosaicIv(-1)}>−</button>
            <button type="button" className="btn-primary mos-step" onClick={() => setMosaicIv(1)}>+</button>
          </div>
          <label className="mos-ctrl-grp mos-toggle">
            <input
              type="checkbox"
              checked={mosRandomizeLayout.value}
              onChange={(e: any) => setMosRandomizeLayout(e.target.checked)}
            />
            <span>Shuffle layout</span>
            <input
              className="mos-num-in"
              type="number"
              min={2}
              max={120}
              disabled={!mosRandomizeLayout.value}
              value={mosLayoutIv.value}
              onInput={(e: any) => setMosLayoutIv(e.target.value)}
              title="Layout shuffle interval (seconds)"
            />
            <span className="mos-unit">s</span>
          </label>
          <label className="mos-ctrl-grp mos-toggle">
            <input
              type="checkbox"
              checked={mosPlayAllAudio.value}
              onChange={(e: any) => setMosPlayAllAudio(e.target.checked)}
            />
            <span>Play all audio</span>
          </label>
          <button type="button" className="btn-primary" onClick={() => stopMosaic()}>Close</button>
        </div>
      </div>
      <div id="mosaic-grid" style={{ display: 'grid', gap: '10px', height: 'calc(100vh - 120px)', marginTop: '10px' }}>
        {/* Tiles will be inserted here by mosaic.ts */}
      </div>
    </div>
  );
};
