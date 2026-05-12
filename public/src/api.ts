import { Video, Category } from './types';

export async function fetchVideos(params?: URLSearchParams): Promise<Video[]> {
  const url = params ? `/api/videos?${params.toString()}` : '/api/videos';
  const res = await fetch(url);
  return res.json();
}

export async function fetchCategories(): Promise<Category[]> {
  const res = await fetch('/api/categories');
  return res.json();
}

export async function createCategory(name: string): Promise<{ name: string }> {
  const res = await fetch('/api/main-categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to create category');
  return data;
}
