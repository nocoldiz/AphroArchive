/* global describe, it, expect */

// Unit tests for the pure player logic that drives AdvancedPlayer
// (chapter navigation, A/B loop, scrub-preview thumbnail selection, timecode
// formatting). These run in plain Node — no DOM required.

import {
  formatTimecode,
  mergeChapters,
  findNextChapter,
  findPrevChapter,
  loopWrapTarget,
  pickPreviewThumb,
  chapterAt,
  clampPreviewX,
  COARSE_FRACTIONS,
  type Chapter,
} from '../public/src/player/playerLogic';

const chap = (id: string, time: number, title = id): Chapter => ({ id, time, title });

describe('formatTimecode', () => {
  it('drops the leading hour group under an hour', () => {
    expect(formatTimecode(0)).toBe('00:00');
    expect(formatTimecode(5)).toBe('00:05');
    expect(formatTimecode(65)).toBe('01:05');
    expect(formatTimecode(599)).toBe('09:59');
  });

  it('keeps the hour group at/over an hour', () => {
    expect(formatTimecode(3600)).toBe('01:00:00');
    expect(formatTimecode(3661)).toBe('01:01:01');
  });

  it('floors fractional seconds', () => {
    expect(formatTimecode(9.9)).toBe('00:09');
  });

  it('clamps NaN / negatives to zero', () => {
    expect(formatTimecode(NaN)).toBe('00:00');
    expect(formatTimecode(-10)).toBe('00:00');
    expect(formatTimecode(Infinity)).toBe('00:00');
  });
});

describe('mergeChapters', () => {
  it('merges user + auto chapters into one timeline sorted by time', () => {
    const user = [chap('u2', 30), chap('u1', 10)];
    const auto = [chap('a1', 20), chap('a2', 5)];
    const merged = mergeChapters(user, auto);
    expect(merged.map(c => c.id)).toEqual(['a2', 'u1', 'a1', 'u2']);
  });

  it('treats auto chapters as optional', () => {
    expect(mergeChapters([chap('u1', 10)]).map(c => c.id)).toEqual(['u1']);
  });

  it('does not mutate its inputs', () => {
    const user = [chap('u2', 30), chap('u1', 10)];
    mergeChapters(user);
    expect(user.map(c => c.id)).toEqual(['u2', 'u1']);
  });
});

describe('findNextChapter', () => {
  const list = [chap('c1', 10), chap('c2', 20), chap('c3', 30)];

  it('returns the first chapter strictly ahead of the playhead', () => {
    expect(findNextChapter(list, 0)?.id).toBe('c1');
    expect(findNextChapter(list, 12)?.id).toBe('c2');
  });

  it('ignores the chapter you just landed on (0.5s dead-zone)', () => {
    expect(findNextChapter(list, 10)?.id).toBe('c2');
    expect(findNextChapter(list, 10.4)?.id).toBe('c2');
  });

  it('returns null past the last chapter', () => {
    expect(findNextChapter(list, 30)).toBeNull();
    expect(findNextChapter(list, 99)).toBeNull();
  });

  it('handles unsorted input', () => {
    const unsorted = [chap('c3', 30), chap('c1', 10), chap('c2', 20)];
    expect(findNextChapter(unsorted, 0)?.id).toBe('c1');
  });
});

describe('findPrevChapter', () => {
  const list = [chap('c1', 10), chap('c2', 20), chap('c3', 30)];

  it('returns the chapter before the playhead with a 1s dead-zone', () => {
    expect(findPrevChapter(list, 25)?.id).toBe('c2');
    expect(findPrevChapter(list, 21)?.id).toBe('c1'); // 21 - 1 = 20, not < 20
    expect(findPrevChapter(list, 21.5)?.id).toBe('c2');
  });

  it('returns null before the first chapter (caller restarts at 0)', () => {
    expect(findPrevChapter(list, 10)).toBeNull();
    expect(findPrevChapter(list, 5)).toBeNull();
  });
});

describe('loopWrapTarget', () => {
  it('returns A only when both bounds set and playhead reaches B', () => {
    expect(loopWrapTarget(19, 5, 20)).toBeNull();
    expect(loopWrapTarget(20, 5, 20)).toBe(5);
    expect(loopWrapTarget(25, 5, 20)).toBe(5);
  });

  it('does nothing when either bound is missing', () => {
    expect(loopWrapTarget(100, 5, null)).toBeNull();
    expect(loopWrapTarget(100, null, 20)).toBeNull();
    expect(loopWrapTarget(100, null, null)).toBeNull();
  });

  it('supports a zero A loop point', () => {
    expect(loopWrapTarget(10, 0, 10)).toBe(0);
  });
});

describe('pickPreviewThumb', () => {
  const id = 'vid1';
  const duration = 100;

  it('picks the nearest coarse fraction thumbnail', () => {
    // fractions [0.1,0.25,0.5,0.75,0.9] * 100 = [10,25,50,75,90]
    expect(pickPreviewThumb(id, 11, duration, [])).toBe(`/api/thumbs/${id}/0`);
    expect(pickPreviewThumb(id, 52, duration, [])).toBe(`/api/thumbs/${id}/2`);
    expect(pickPreviewThumb(id, 88, duration, [])).toBe(`/api/thumbs/${id}/4`);
  });

  it('prefers a chapter thumbnail when one is closer', () => {
    const chapters = [chap('ch7', 53)];
    expect(pickPreviewThumb(id, 52, duration, chapters)).toBe(`/api/thumbs/${id}/chapter/ch7`);
  });

  it('falls back to the first thumbnail with no duration', () => {
    expect(pickPreviewThumb(id, 30, 0, [])).toBe(`/api/thumbs/${id}/0`);
  });

  it('exposes the coarse fractions used by the server', () => {
    expect(COARSE_FRACTIONS).toEqual([0.1, 0.25, 0.5, 0.75, 0.9]);
  });
});

describe('chapterAt', () => {
  const list = [chap('c1', 10), chap('c2', 20), chap('c3', 30)];

  it('returns the latest chapter at or below the time', () => {
    expect(chapterAt(list, 25)?.id).toBe('c2');
    expect(chapterAt(list, 30)?.id).toBe('c3');
    expect(chapterAt(list, 10)?.id).toBe('c1');
  });

  it('returns null before the first chapter', () => {
    expect(chapterAt(list, 5)).toBeNull();
  });
});

describe('clampPreviewX', () => {
  it('keeps the box centre within the track', () => {
    // box width 140 → half 70, track 1000
    expect(clampPreviewX(0, 140, 1000)).toBe(70);
    expect(clampPreviewX(1000, 140, 1000)).toBe(930);
    expect(clampPreviewX(500, 140, 1000)).toBe(500);
  });

  it('centres when the track is narrower than the box', () => {
    expect(clampPreviewX(10, 140, 100)).toBe(50);
  });
});
