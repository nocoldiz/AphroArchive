// ─── Home dashboard ──────────────────────────────────────────────────
// Renders the widget layout on a responsive CSS grid. In edit mode each
// widget gains a drag handle (reorder), a remove button and a bottom-right
// resize grip that snaps the widget's column/row span to the grid. The
// "Add widget" picker lists every built-in and plugin-provided widget.

import { useEffect, useRef, useState } from 'preact/hooks';
import {
  dashboardLayout, dashEditMode, DASH_ROW_H, loadDashboard,
  removeInstance, updateInstance, moveInstance, addInstance, resetDashboard,
  dashCardSize, setCardSize, DASH_CARD_MIN, DASH_CARD_MAX,
} from './dashboardStore';
import { allWidgetDefs, getWidgetDef, WidgetDef } from './widgets';
import { appPrefs } from '../store';
import { pluginsList } from '../plugins';
import { confirmDialog } from '../dialog';

const GAP = 14;

function useCols(ref: { current: HTMLDivElement | null }) {
  const [cols, setCols] = useState(4);
  useEffect(() => {
    const calc = () => {
      const w = ref.current?.clientWidth || window.innerWidth;
      setCols(w >= 1100 ? 4 : w >= 720 ? 2 : 1);
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);
  return cols;
}

export const Dashboard = () => {
  const gridRef = useRef<HTMLDivElement>(null);
  const cols = useCols(gridRef);
  const [pickerOpen, setPickerOpen] = useState(false);
  const dragFrom = useRef<number | null>(null);
  const edit = dashEditMode.value;

  // Load once appPrefs is available (so the server-saved layout wins).
  useEffect(() => { loadDashboard(); }, [appPrefs.value]);

  const startResize = (e: PointerEvent, iid: string) => {
    e.preventDefault();
    e.stopPropagation();
    const wrap = (e.currentTarget as HTMLElement).closest('.dw-wrap') as HTMLElement;
    const grid = gridRef.current;
    if (!wrap || !grid) return;
    const gridW = grid.clientWidth;
    const cellW = (gridW - GAP * (cols - 1)) / cols;
    const unitW = cellW + GAP;
    const unitH = DASH_ROW_H + GAP;
    const rect = wrap.getBoundingClientRect();

    const onMove = (ev: PointerEvent) => {
      const inst = dashboardLayout.value.find(w => w.iid === iid);
      const def = inst && getWidgetDef(inst.type);
      if (!inst || !def) return;
      let nw = Math.round((ev.clientX - rect.left + GAP) / unitW);
      let nh = Math.round((ev.clientY - rect.top + GAP) / unitH);
      nw = Math.max(def.minW, Math.min(cols, nw));
      nh = Math.max(def.minH, Math.min(def.maxH || 6, nh));
      if (nw !== inst.w || nh !== inst.h) updateInstance(iid, { w: nw, h: nh });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onDrop = (toIdx: number) => {
    if (dragFrom.current !== null && dragFrom.current !== toIdx) {
      moveInstance(dragFrom.current, toIdx);
    }
    dragFrom.current = null;
  };

  return (
    <div className="dash">
      <div className="dash-bar">
        <h2 className="dash-welcome">Welcome to AphroArchive</h2>
        <div className="dash-bar-actions">
          {edit && (
            <label className="dash-size" title="Video size">
              <span className="dash-size-ico">▦</span>
              <input
                type="range"
                min={DASH_CARD_MIN}
                max={DASH_CARD_MAX}
                step={10}
                value={dashCardSize.value}
                onInput={(e) => setCardSize(Number((e.target as HTMLInputElement).value))}
              />
            </label>
          )}
          {edit && <button className="dash-btn" onClick={() => setPickerOpen(true)}>+ Add widget</button>}
          {edit && <button className="dash-btn" onClick={async () => { if (await confirmDialog('Reset the home layout to defaults?')) resetDashboard(); }}>Reset</button>}
          <button className={'dash-btn' + (edit ? ' on' : '')} onClick={() => { dashEditMode.value = !edit; setPickerOpen(false); }}>
            {edit ? 'Done' : 'Edit home'}
          </button>
        </div>
      </div>

      <div
        ref={gridRef}
        className={'dash-grid' + (edit ? ' editing' : '')}
        style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridAutoRows: DASH_ROW_H + 'px', gap: GAP + 'px', ['--dw-card-min' as any]: dashCardSize.value + 'px' }}
      >
        {dashboardLayout.value.map((inst, idx) => {
          const def = getWidgetDef(inst.type);
          if (!def) return null;
          const span = Math.min(inst.w, cols);
          return (
            <div
              key={inst.iid}
              className="dw-wrap"
              style={{ gridColumn: `span ${span}`, gridRow: `span ${inst.h}` }}
              draggable={edit}
              onDragStart={() => { dragFrom.current = idx; }}
              onDragOver={(e) => { if (edit) e.preventDefault(); }}
              onDrop={() => onDrop(idx)}
            >
              {edit && (
                <div className="dw-edit-bar">
                  <span className="dw-grip" title="Drag to reorder">⠿ {def.name}</span>
                  <button className="dw-del" title="Remove" onClick={() => removeInstance(inst.iid)}>×</button>
                </div>
              )}
              <div className="dw-content">{def.render(inst)}</div>
              {edit && (
                <div className="dw-resize" title="Drag to resize" onPointerDown={(e) => startResize(e as any, inst.iid)} />
              )}
            </div>
          );
        })}
      </div>

      {dashboardLayout.value.length === 0 && (
        <div className="dash-blank">
          <p>Your home is empty.</p>
          <button className="dash-btn on" onClick={() => { dashEditMode.value = true; setPickerOpen(true); }}>Add a widget</button>
        </div>
      )}

      {pickerOpen && <WidgetPicker onClose={() => setPickerOpen(false)} />}
    </div>
  );
};

// ── Widget picker ────────────────────────────────────────────────────
const WidgetPicker = ({ onClose }: { onClose: () => void }) => {
  // Re-read on plugin list changes so plugin widgets appear.
  void pluginsList.value;
  const defs = allWidgetDefs();
  const present = new Set(dashboardLayout.value.map(w => w.type));

  const add = (def: WidgetDef) => {
    addInstance(def.type, def.defaultW, def.defaultH);
    if (def.singleton) onClose();
  };

  return (
    <div className="dw-picker-overlay" onClick={onClose}>
      <div className="dw-picker" onClick={(e) => e.stopPropagation()}>
        <div className="dw-picker-head">
          <h3>Add a widget</h3>
          <button className="dw-del" onClick={onClose}>×</button>
        </div>
        <div className="dw-picker-list">
          {defs.map(def => {
            const used = def.singleton && present.has(def.type);
            return (
              <button key={def.type} className={'dw-picker-item' + (used ? ' used' : '')} disabled={!!used} onClick={() => add(def)}>
                <div className="dw-picker-name">{def.name}{used ? ' · added' : ''}</div>
                <div className="dw-picker-desc">{def.description}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
