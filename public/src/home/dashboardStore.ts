// ─── Home dashboard layout state ─────────────────────────────────────
// The home page is a resizable grid of widgets. Layout is an ordered list
// of widget instances; each carries its own column/row span and optional
// per-instance config (e.g. which category a Pinned Shelf points at).
//
// Persistence is dual: localStorage for instant load, and appPrefs
// (server settings) so the layout follows the profile across devices.

import { signal } from '@preact/signals';
import { appPrefs, updatePrefs } from '../store';

export const DASH_COLS = 4;       // logical columns on a wide screen
export const DASH_ROW_H = 130;    // px height of one row unit

export interface WidgetInstance {
  iid: string;                    // unique instance id
  type: string;                   // widget type key (see widgets.tsx)
  w: number;                      // column span (1..DASH_COLS)
  h: number;                      // row span (>= 1)
  config?: Record<string, any>;   // per-instance settings
}

export const dashboardLayout = signal<WidgetInstance[]>([]);
export const dashEditMode = signal<boolean>(false);

// Min width (px) of a video card inside widgets. Larger → fewer, bigger videos
// per row. Persisted alongside the layout (localStorage + server prefs).
export const DASH_CARD_MIN = 120;
export const DASH_CARD_MAX = 360;
export const DASH_CARD_DEFAULT = 190;
export const dashCardSize = signal<number>(DASH_CARD_DEFAULT);
let _appliedCardSize = false;

let _appliedAny = false;     // have we put *any* layout on screen yet?
let _appliedServer = false;  // have we applied the server-saved layout yet?
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
let _cardSaveTimer: ReturnType<typeof setTimeout> | null = null;

export function makeIid(): string {
  return 'w_' + Math.random().toString(36).slice(2, 9);
}

export function defaultLayout(): WidgetInstance[] {
  return [
    { iid: makeIid(), type: 'new-additions',     w: 4, h: 2 },
    { iid: makeIid(), type: 'continue-watching', w: 4, h: 2 },
  ];
}

// Safe to call repeatedly (e.g. from an effect watching appPrefs). The
// server-saved layout wins and is applied once it arrives; until then we
// show the localStorage / default layout. Never clobbers in-progress edits.
export function loadDashboard() {
  // Card size: server pref wins once it arrives; fall back to localStorage.
  if (!_appliedCardSize) {
    const srv = Number((appPrefs.value as any).homeCardSize);
    if (Number.isFinite(srv) && srv > 0) {
      dashCardSize.value = clampCardSize(srv);
      _appliedCardSize = true;
    } else {
      const ls = Number(localStorage.getItem('homeCardSize'));
      if (Number.isFinite(ls) && ls > 0) dashCardSize.value = clampCardSize(ls);
    }
  }
  const saved = (appPrefs.value as any).homeDashboard;
  if (Array.isArray(saved) && saved.length) {
    if (_appliedServer) return;
    _appliedServer = true;
    _appliedAny = true;
    dashboardLayout.value = saved;
    return;
  }
  if (_appliedAny) return;
  _appliedAny = true;
  let parsed: WidgetInstance[] | null = null;
  try {
    const ls = localStorage.getItem('homeDashboard');
    if (ls) parsed = JSON.parse(ls);
  } catch {}
  dashboardLayout.value = parsed && parsed.length ? parsed : defaultLayout();
}

export function saveDashboard() {
  if (!_appliedAny) return;
  const layout = dashboardLayout.value;
  try {
    localStorage.setItem('homeDashboard', JSON.stringify(layout));
  } catch {}
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    updatePrefs({ homeDashboard: layout } as any).catch(() => {});
  }, 600);
}

export function clampCardSize(n: number): number {
  return Math.max(DASH_CARD_MIN, Math.min(DASH_CARD_MAX, Math.round(n)));
}

export function setCardSize(n: number) {
  const v = clampCardSize(n);
  dashCardSize.value = v;
  _appliedCardSize = true;
  try { localStorage.setItem('homeCardSize', String(v)); } catch {}
  if (_cardSaveTimer) clearTimeout(_cardSaveTimer);
  _cardSaveTimer = setTimeout(() => {
    updatePrefs({ homeCardSize: v } as any).catch(() => {});
  }, 600);
}

export function updateInstance(iid: string, patch: Partial<WidgetInstance>) {
  dashboardLayout.value = dashboardLayout.value.map(w =>
    w.iid === iid ? { ...w, ...patch } : w
  );
  saveDashboard();
}

export function removeInstance(iid: string) {
  dashboardLayout.value = dashboardLayout.value.filter(w => w.iid !== iid);
  saveDashboard();
}

export function addInstance(type: string, w: number, h: number, config?: Record<string, any>) {
  dashboardLayout.value = [
    ...dashboardLayout.value,
    { iid: makeIid(), type, w, h, config },
  ];
  saveDashboard();
}

export function moveInstance(fromIdx: number, toIdx: number) {
  const list = [...dashboardLayout.value];
  if (fromIdx < 0 || fromIdx >= list.length || toIdx < 0 || toIdx >= list.length) return;
  const [moved] = list.splice(fromIdx, 1);
  list.splice(toIdx, 0, moved);
  dashboardLayout.value = list;
  saveDashboard();
}

export function resetDashboard() {
  dashboardLayout.value = defaultLayout();
  saveDashboard();
}
