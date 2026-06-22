// Pure, DOM-free helpers for the video player.
//
// Kept free of Preact / browser imports so the same logic that drives
// AdvancedPlayer can be unit-tested in a plain Node environment
// (see tests/player-logic.test.ts).

export interface Chapter {
  id: string;
  title: string;
  time: number;
}

// HH:MM:SS, dropping a leading "00:" hour group. Negatives / NaN clamp to 0.
export const formatTimecode = (secs: number): string => {
  if (!Number.isFinite(secs) || secs < 0) secs = 0;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':').replace(/^00:/, '');
};

// Merge user + auto chapters into one timeline, sorted by time.
export const mergeChapters = (chapters: Chapter[], autoChapters: Chapter[] = []): Chapter[] =>
  [...chapters, ...autoChapters].sort((a, b) => a.time - b.time);

// Next chapter strictly ahead of `current` (with a small dead-zone so the very
// chapter you just landed on isn't re-selected).
export const findNextChapter = (chapters: Chapter[], current: number): Chapter | null => {
  const sorted = [...chapters].sort((a, b) => a.time - b.time);
  return sorted.find(c => c.time > current + 0.5) ?? null;
};

// Previous chapter behind `current`; the 1s dead-zone means a quick double-tap
// jumps to the prior chapter rather than restarting the current one.
export const findPrevChapter = (chapters: Chapter[], current: number): Chapter | null => {
  const sorted = [...chapters].sort((a, b) => a.time - b.time);
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].time < current - 1) return sorted[i];
  }
  return null;
};

// Given an A/B loop and the current position, return the time to seek back to
// (loop point A) when the playhead reaches or passes B, else null (no wrap).
export const loopWrapTarget = (
  current: number,
  a: number | null,
  b: number | null
): number | null => (a !== null && b !== null && current >= b ? a : null);

// Coarse thumbnails are captured at these fractions of the duration (see genThumbs).
export const COARSE_FRACTIONS = [0.1, 0.25, 0.5, 0.75, 0.9];

// Pick the preview-frame URL closest to `time`. Chapter thumbnails are captured
// at their exact timecode, so when one is nearer than any coarse thumbnail it
// gives a far more accurate scrub preview.
export const pickPreviewThumb = (
  videoId: string,
  time: number,
  duration: number,
  chapters: Chapter[]
): string => {
  let bestSrc = `/api/thumbs/${videoId}/0`;
  let bestDist = Infinity;
  if (duration > 0) {
    const idx = Math.max(0, Math.min(4, Math.floor((time / duration) * 5)));
    bestSrc = `/api/thumbs/${videoId}/${idx}`;
    for (let i = 0; i < COARSE_FRACTIONS.length; i++) {
      const d = Math.abs(COARSE_FRACTIONS[i] * duration - time);
      if (d < bestDist) { bestDist = d; bestSrc = `/api/thumbs/${videoId}/${i}`; }
    }
  }
  for (const c of chapters) {
    const d = Math.abs(c.time - time);
    if (d < bestDist) { bestDist = d; bestSrc = `/api/thumbs/${videoId}/chapter/${c.id}`; }
  }
  return bestSrc;
};

// The chapter whose span contains `time` (the latest chapter at/below it).
// Used to label the scrub preview with the chapter you're hovering over.
export const chapterAt = (chapters: Chapter[], time: number): Chapter | null => {
  const sorted = [...chapters].sort((a, b) => a.time - b.time);
  let found: Chapter | null = null;
  for (const c of sorted) {
    if (c.time <= time + 0.001) found = c; else break;
  }
  return found;
};

// Clamp a tooltip's horizontal centre so a box of `boxWidth` stays within
// [0, trackWidth]. Returns the clamped centre X (in px from the track's left).
export const clampPreviewX = (x: number, boxWidth: number, trackWidth: number): number => {
  const half = boxWidth / 2;
  if (trackWidth <= boxWidth) return trackWidth / 2;
  return Math.max(half, Math.min(trackWidth - half, x));
};
