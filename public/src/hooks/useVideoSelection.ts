import { useEffect, useState } from 'preact/hooks';
import { selectedVideoIds, videoSelMode } from '../store';

export function useVideoSelection(gridRef: { current: HTMLDivElement | null }) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') (window as any).shiftKeyPressed = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') (window as any).shiftKeyPressed = false;
    };

    const handleMouseOver = (e: MouseEvent) => {
      if (!(window as any).shiftKeyPressed) return;
      const card = (e.target as HTMLElement).closest('.video-card');
      if (!card) return;
      const id = (card as HTMLElement).dataset.id;
      if (!id || selectedVideoIds.value.has(id)) return;
      
      const newSelection = new Set(selectedVideoIds.value);
      newSelection.add(id);
      selectedVideoIds.value = newSelection;
      videoSelMode.value = true;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    document.addEventListener('mouseover', handleMouseOver);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('mouseover', handleMouseOver);
    };
  }, []);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (!e.shiftKey && !videoSelMode.value) return;
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('.card-actions')) return;

      e.preventDefault();
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });

      const box = document.getElementById('videoDragBox');
      if (box) {
        box.style.display = 'block';
        box.style.width = '0px';
        box.style.height = '0px';
        box.style.left = e.clientX + 'px';
        box.style.top = e.clientY + 'px';
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      const x = Math.min(e.clientX, dragStart.x);
      const y = Math.min(e.clientY, dragStart.y);
      const w = Math.abs(e.clientX - dragStart.x);
      const h = Math.abs(e.clientY - dragStart.y);

      const box = document.getElementById('videoDragBox');
      if (box) {
        box.style.left = x + 'px';
        box.style.top = y + 'px';
        box.style.width = w + 'px';
        box.style.height = h + 'px';
      }

      const boxRect = box ? box.getBoundingClientRect() : { left: 0, right: 0, top: 0, bottom: 0 };
      const newSelection = new Set(selectedVideoIds.value);

      document.querySelectorAll('.video-card').forEach(card => {
        const cardRect = card.getBoundingClientRect();
        const match = !(boxRect.right < cardRect.left || boxRect.left > cardRect.right || 
                       boxRect.bottom < cardRect.top || boxRect.top > cardRect.bottom);
        
        const id = (card as HTMLElement).dataset.id;
        if (id && match) {
          newSelection.add(id);
        }
      });

      if (newSelection.size !== selectedVideoIds.value.size) {
        selectedVideoIds.value = newSelection;
        videoSelMode.value = newSelection.size > 0;
      }
    };

    const handleMouseUp = () => {
      if (!isDragging) return;
      setIsDragging(false);
      const box = document.getElementById('videoDragBox');
      if (box) box.style.display = 'none';
    };

    grid.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      grid.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragStart, gridRef]);
}
