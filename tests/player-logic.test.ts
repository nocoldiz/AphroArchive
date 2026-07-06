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
  deriveSkipMarkers,
  activeSkip,
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

describe('deriveSkipMarkers', () => {
  it('picks the first early boundary as intro-end and the last late one as credits-start', () => {
    const auto = [chap('a1', 12), chap('a2', 300), chap('a3', 600), chap('a4', 1150)];
    const m = deriveSkipMarkers(auto, 1200);
    expect(m.introEnd).toBe(12);      // first boundary inside the 0–25% window
    expect(m.creditsStart).toBe(1150); // last boundary inside the final 25%
  });

  it('returns null intro when the first boundary is too early or too late', () => {
    expect(deriveSkipMarkers([chap('a', 3)], 1200).introEnd).toBeNull();   // < 5s
    expect(deriveSkipMarkers([chap('a', 400)], 1200).introEnd).toBeNull(); // past 25% (300s)
  });

  it('caps the intro window at 240s even for long videos', () => {
    // 25% of 4000s = 1000s, but the absolute cap is 240s.
    expect(deriveSkipMarkers([chap('a', 300)], 4000).introEnd).toBeNull();
    expect(deriveSkipMarkers([chap('a', 200)], 4000).introEnd).toBe(200);
  });

  it('returns null credits when no boundary is in the final stretch or too close to the end', () => {
    expect(deriveSkipMarkers([chap('a', 500)], 1200).creditsStart).toBeNull();  // before 75%
    expect(deriveSkipMarkers([chap('a', 1198)], 1200).creditsStart).toBeNull(); // < 5s tail
  });

  it('is empty for no chapters or a zero / non-finite duration', () => {
    expect(deriveSkipMarkers([], 1200)).toEqual({ introEnd: null, creditsStart: null });
    expect(deriveSkipMarkers([chap('a', 12)], 0)).toEqual({ introEnd: null, creditsStart: null });
    expect(deriveSkipMarkers([chap('a', 12)], NaN)).toEqual({ introEnd: null, creditsStart: null });
  });

  it('ignores boundaries at or beyond the duration', () => {
    expect(deriveSkipMarkers([chap('a', 1200), chap('b', 1300)], 1200).creditsStart).toBeNull();
  });
});

describe('activeSkip', () => {
  const markers = { introEnd: 30, creditsStart: 1150 };

  it('shows the intro skip before the intro-end marker', () => {
    expect(activeSkip(markers, 0, 1200)).toEqual({ kind: 'intro', seekTo: 30 });
    expect(activeSkip(markers, 29, 1200)).toEqual({ kind: 'intro', seekTo: 30 });
  });

  it('hides the intro skip once at/past the marker (with a small dead-zone)', () => {
    expect(activeSkip(markers, 29.8, 1200)).toBeNull();
    expect(activeSkip(markers, 30, 1200)).toBeNull();
  });

  it('shows the credits skip from the credits-start marker to the end', () => {
    expect(activeSkip(markers, 1150, 1200)).toEqual({ kind: 'credits', seekTo: 1200 });
    expect(activeSkip(markers, 1180, 1200)).toEqual({ kind: 'credits', seekTo: 1200 });
  });

  it('shows nothing in the middle of the video', () => {
    expect(activeSkip(markers, 600, 1200)).toBeNull();
  });

  it('handles a missing intro or credits marker', () => {
    expect(activeSkip({ introEnd: null, creditsStart: 1150 }, 5, 1200)).toBeNull();
    expect(activeSkip({ introEnd: 30, creditsStart: null }, 1180, 1200)).toBeNull();
  });
});
