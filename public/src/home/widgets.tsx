// ─── Home dashboard widget registry ──────────────────────────────────
// Widgets are plugins. Each lives in plugins/<id>/ with a meta.json that
// declares a `homeWidget` block, and (optionally) a widget.tsx that
// default-exports its render function. This module bundles every
// widget.tsx via import.meta.glob and merges it with the plugin metadata
// served from /api/plugins, so dropping a new plugin folder is all it
// takes to add a widget. View/toggle plugins that declare a homeWidget
// but ship no widget.tsx render as a shortcut button.

import { ComponentChildren } from 'preact';
import { currentView } from '../store';
import { pluginsList, isPluginEnabled, runPluginAction, PluginMeta } from '../plugins';
import { WidgetInstance } from './dashboardStore';

// Eagerly bundle every plugin widget module (built at compile time).
const widgetModules = import.meta.glob('../../../plugins/*/widget.tsx', { eager: true });
const RENDERERS: Record<string, (i: WidgetInstance) => ComponentChildren> = {};
for (const path in widgetModules) {
  const m = path.match(/plugins[\\/]([^\\/]+)[\\/]widget\.tsx$/);
  const mod = widgetModules[path] as { default?: (i: WidgetInstance) => ComponentChildren };
  if (m && mod?.default) RENDERERS[m[1]] = mod.default;
}

export interface WidgetDef {
  type: string;        // plugin id
  name: string;
  description: string;
  defaultW: number;
  defaultH: number;
  minW: number;
  minH: number;
  maxH: number;
  singleton: boolean;
  render: (instance: WidgetInstance) => ComponentChildren;
}

// Shortcut renderer for view/toggle plugins without a widget.tsx.
function genericRenderer(plugin: PluginMeta): (i: WidgetInstance) => ComponentChildren {
  const hw = plugin.homeWidget || {};
  return () => (
    <div className="dw-shell dw-center">
      <button className="dw-big-btn" onClick={() => runPluginAction(plugin, currentView)}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
        </svg>
        <span>{hw.name || plugin.name}</span>
        {plugin.description && <small>{plugin.description}</small>}
      </button>
    </div>
  );
}

function defFor(plugin: PluginMeta): WidgetDef | null {
  const hw = plugin.homeWidget;
  if (!hw) return null;
  return {
    type: plugin.id,
    name: hw.name || plugin.name,
    description: plugin.description || '',
    defaultW: hw.w || 2,
    defaultH: hw.h || 1,
    minW: hw.minW || 1,
    minH: hw.minH || 1,
    maxH: hw.maxH || 4,
    singleton: hw.singleton !== false,
    render: RENDERERS[plugin.id] || genericRenderer(plugin),
  };
}

export function allWidgetDefs(): WidgetDef[] {
  return pluginsList.value
    .filter(p => p.homeWidget && isPluginEnabled(p.id))
    .map(defFor)
    .filter((d): d is WidgetDef => !!d);
}

export function getWidgetDef(type: string): WidgetDef | undefined {
  const plugin = pluginsList.value.find(p => p.id === type);
  return plugin ? (defFor(plugin) || undefined) : undefined;
}
