import { signal, computed } from '@preact/signals';
import { Video, Category, Actor, Studio } from './types';

// ─── Core State ──────────────────────────────────────────────────────
export const videos = signal<Video[]>([]);
export const allVideos = signal<Video[]>([]); // Full unfiltered list
export const categories = signal<Category[]>([]);
export const actors = signal<Actor[]>([]);
export const studios = signal<Studio[]>([]);

// ─── Navigation & View State ──────────────────────────────────────────
export const currentView = signal<string>('home');
export const currentCategory = signal<string>('');
export const currentTag = signal<string | null>(null);
export const searchQuery = signal<string>('');
export const sortMode = signal<string>('date');
export const isShuffle = signal<boolean>(false);

// ─── Feature Modes ────────────────────────────────────────────────────
export const vaultMode = signal<boolean>(false);
export const isVaultUnlocked = signal<boolean>(false);
export const videoSelMode = signal<boolean>(false);
export const selectedVideoIds = signal<Set<string>>(new Set());

// ─── Computed State ──────────────────────────────────────────────────
// Example: Automatically filter videos based on search and category
export const filteredVideos = computed(() => {
  let list = videos.value;
  
  if (currentCategory.value) {
    list = list.filter(v => v.category === currentCategory.value);
  }
  
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    list = list.filter(v => v.name.toLowerCase().includes(q));
  }
  
  return list;
});

// ─── Actions (Data Fetching) ──────────────────────────────────────────
export async function loadVideos() {
  const res = await fetch('/api/videos');
  const data = await res.json();
  allVideos.value = data;
  videos.value = data;
}

export async function loadCategories() {
  const res = await fetch('/api/categories');
  const data = await res.json();
  categories.value = data;
}
