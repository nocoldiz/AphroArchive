import { signal } from '@preact/signals';
import { appPrefs, updatePrefs } from './store';

export interface PluginMeta {
  id: string;
  name: string;
  description?: string;
  location: 'topbar' | 'sidebar';
  type: 'view' | 'toggle';
  view?: string;
  toggleAction?: string;
  enabledByDefault?: boolean;
  contexts?: string[];
  // When present, the plugin is also offered as a home-dashboard widget.
  // `w`/`h` are the default column/row span on the home grid.
  homeWidget?: { name?: string; w?: number; h?: number };
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
