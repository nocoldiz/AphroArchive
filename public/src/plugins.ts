import { signal } from '@preact/signals';
import { appPrefs, updatePrefs } from './store';

export interface PluginMeta {
  id: string;
  name: string;
  description?: string;
  location: 'topbar' | 'sidebar' | 'home';
  type: 'view' | 'toggle' | 'widget';
  view?: string;
  toggleAction?: string;
  enabledByDefault?: boolean;
  contexts?: string[];
  /** Which existing sidebar section this plugin's button belongs to. Plugins without this go into the generic "Plugins" section. */
  sidebarSection?: 'library' | 'browse' | 'media' | 'tools';
  /** SVG innerHTML for the button icon in the sidebar or topbar. */
  icon?: string;
  // When present, the plugin is offered as a home-dashboard widget. The
  // render code (if any) lives in plugins/<id>/widget.tsx; view/toggle
  // plugins without one render as a shortcut button. `w`/`h` are the
  // default column/row span; min/max constrain resizing.
  homeWidget?: {
    name?: string;
    w?: number; h?: number;
    minW?: number; minH?: number; maxH?: number;
    singleton?: boolean;
  };
}

export const pluginsList = signal<PluginMeta[]>([]);

export async function loadPlugins() {
  try {
    const res = await fetch('/api/plugins');
    const data = await res.json();
    pluginsList.value = data.plugins || [];
  } catch (e) {
    console.error('Failed to load plugins', e);
  }
}

export function isPluginEnabled(id: string): boolean {
  const disabled = appPrefs.value.disabledPlugins || [];
  if (disabled.includes(id)) return false;
  const plugin = pluginsList.value.find(p => p.id === id);
  return plugin ? plugin.enabledByDefault !== false : true;
}

export async function togglePlugin(id: string) {
  const disabled = new Set(appPrefs.value.disabledPlugins || []);
  if (disabled.has(id)) disabled.delete(id);
  else disabled.add(id);
  await updatePrefs({ disabledPlugins: Array.from(disabled) });
}

export function runPluginAction(plugin: PluginMeta, currentView: { value: string }) {
  if (plugin.type === 'view' && plugin.view) {
    currentView.value = plugin.view;
  } else if (plugin.type === 'toggle' && plugin.toggleAction) {
    const fn = (window as any)[plugin.toggleAction];
    if (typeof fn === 'function') fn();
  }
}
