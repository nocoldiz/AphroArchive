import { Video, Folder } from './types';

export async function fetchVideos(params?: URLSearchParams): Promise<Video[]> {
  const url = params ? `/api/videos?${params.toString()}` : '/api/videos';
  const res = await fetch(url);
  return res.json();
}

export async function fetchFolders(): Promise<Folder[]> {
  const res = await fetch('/api/folders');
  return res.json();
}

export async function createFolder(name: string): Promise<{ name: string }> {
  const res = await fetch('/api/main-folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to create folder');
  return data;
}

export async function renameVideo(id: string, newName: string): Promise<{ newId: string }> {
  const res = await fetch(`/api/videos/${id}/rename`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newName })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to rename');
  return data;
}

export async function moveVideo(id: string, folder: string): Promise<any> {
  const res = await fetch(`/api/videos/${id}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: folder })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to move');
  return data;
}

export async function deleteVideo(id: string): Promise<any> {
  const res = await fetch(`/api/videos/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to delete');
  return data;
}
