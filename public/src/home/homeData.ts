// Shared, cached home-page data so multiple widgets don't each refetch.
import { signal } from '@preact/signals';
import { Video } from '../types';

export const homeHistory = signal<Video[]>([]);
let _loaded = false;

export async function loadHomeHistory(force = false) {
  if (_loaded && !force) return;
  _loaded = true;
  try {
    const r = await fetch('/api/history');
    const data = await r.json();
    homeHistory.value = Array.isArray(data) ? data : [];
  } catch {
    homeHistory.value = [];
  }
}
