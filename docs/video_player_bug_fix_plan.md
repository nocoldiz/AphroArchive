# Video Player Bug Fix Plan

## Current Architecture Overview

The video player consists of three main components:

1. **AdvancedPlayer.tsx** — Custom HTML5 video player with auto-hiding controls, timebar with buffer/chapters/preview, volume/speed/fullscreen controls.
2. **PlayerView.tsx** — Page that hosts AdvancedPlayer, manages video metadata, chapters, subtitles, "Next Up" playlist, download flow, and an extra hidden `<video id="video-player-zap">` for zapping mode.
3. **zap.ts** — Zapping mode (auto-switching between random videos) that tries to control two video elements: `video-player` and `video-player-zap`.

---

## Critical Bug: Zapping Mode Completely Broken

**Severity: HIGH**

`zap.ts` uses `document.getElementById('video-player')` to find the main video element. But `AdvancedPlayer.tsx` renders its `<video>` element **without any `id` attribute** — it uses a React ref (`videoRef`) instead. The only element with `id="video-player-zap"` is the hidden fallback element in `PlayerView.tsx` lines 326-331.

This means:
- `document.getElementById('video-player')` returns `null` → zapping silently fails
- The zapping system cannot control the AdvancedPlayer's video
- The `doZapSwitch()` function tries to play/pause elements that don't exist
- Hover preview and chunking logic in zapping is completely disconnected from the actual player

**Fix: Wire zapping into AdvancedPlayer via a controlled interface (e.g., imperative handle or store-based commands), or remove the AdvancedPlayer controls during zapping and use native elements.**

---

## Bug 2: Stale Closure in Keyboard Event Handler

**Severity: MEDIUM**

File: `AdvancedPlayer.tsx`, lines 127-173

```tsx
useEffect(() => {
  // ... uses togglePlay() and toggleFullscreen()
}, [muted, onNext, onPrev]); // Missing togglePlay and toggleFullscreen deps
```

`togglePlay` and `toggleFullscreen` are regular functions defined outside the effect. They capture `videoRef` from the closure. The effect only re-runs when `[muted, onNext, onPrev]` change, but `togglePlay/toggleFullscreen` are recreated every render. If `videoRef.current` changes (e.g., the video element is re-mounted), the keyboard handler still holds the old ref.

**Fix: Either inline the logic inside the effect, or add videoRef.current to dependencies, or use functional updates.**

---

## Bug 3: Missing Video Error Handling

**Severity: MEDIUM**

File: `AdvancedPlayer.tsx`

The `<video>` element has no `onError` handler. If:
- The stream URL returns 404/403
- The video format is unsupported
- Network drops mid-load

...the user gets a blank black box with no feedback.

**Fix: Add an `error` state + event listener, show an error overlay with retry button when the video element emits an `error` event.**

---

## Bug 4: No Loading/Buffering Indicator

**Severity: LOW-MEDIUM**

When the video is loading (especially for large files or slow streams), the player shows a black rectangle. There's no spinner, skeleton, or "buffering..." text.

**Fix: Add a `loading` state based on `waiting` and `canplay` events, display a centered spinner over the video area.**

---

## Bug 5: Hover Preview Tooltip Overflow

**Severity: LOW**

File: `AdvancedPlayer.tsx`, lines 301-327

The hover preview tooltip uses `left: ${hoverX}px` with `transform: translateX(-50%)`. When `hoverX` is near the left or right edge, the tooltip overflows the player bounds and gets clipped.

**Fix: Clamp the tooltip position so it stays within the player's horizontal bounds.**

---

## Bug 6: `getThumbIndex` Hardcodes 5 Thumbnails

**Severity: LOW-MEDIUM**

```tsx
const getThumbIndex = (time: number) => {
  if (!duration) return 0;
  const pct = time / duration;
  return Math.floor(pct * 5); // Hardcoded 5
};
```

If the actual number of thumbnails generated differs (e.g., configurable count via settings), the index can be out of bounds, showing a broken image or wrong frame.

**Fix: Accept a `thumbCount` prop or fetch it from the server, clamp the index to valid range `[0, thumbCount-1]`.**

---

## Bug 7: `formatDuration` Returns Empty on NaN/0/Infinity

**Severity: LOW**

```tsx
const formatDuration = (secs: number) => {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':').replace(/^00:/, '');
};
```

If `secs` is `0`, `NaN`, `Infinity`, or `undefined`, this returns invalid strings like `"NaN:NaN:NaN"` or `"00:00"` for a 0-length video.

**Fix: Guard against non-finite numbers, return `"--:--"` or `"0:00"` for edge cases.**

---

## Bug 8: Controls Auto-Hide Timer Does Not Reset on Click

**Severity: LOW**

File: `AdvancedPlayer.tsx`

The `onMouseMove` on the wrapper div resets the controls timeout. But clicking a button (play/pause, volume, etc.) does not trigger `mousemove` if the mouse stays still. The controls could disappear while the user is interacting (e.g., changing volume via the range input).

**Fix: Also reset the timeout on `click`, `touchstart`, and `input` events on the controls area.**

---

## Bug 9: Related Videos Click Doesn't Reset Subtitles Properly

**Severity: LOW**

File: `PlayerView.tsx`, lines 152-170

When clicking a related video → `currentVideo.value = newVideo` → component re-renders. The `useEffect` for fetching video details and subtitles runs asynchronously. During the fetch, the old subtitles/chapters still show. This causes a brief flash of stale data.

**Fix: Add a cleanup function that resets state to defaults when `video.id` changes.**

---

## Bug 10: Chapter Jump Doesn't Work When AdvancedPlayer Is Not the Active Source

**Severity: LOW**

File: `PlayerView.tsx`, lines 250-255

`jumpToChapter` tries `videoRef.current.currentTime = time`. But for link videos, there's no AdvancedPlayer rendered — just a static fallback. The ref is still created but points to nothing useful.

**Fix: Guard `jumpToChapter` with a check for the video type (non-link, non-vault).**

---

## Bug 11: Fullscreen Targets Wrong Element

**Severity: LOW**

File: `AdvancedPlayer.tsx`, lines 223-231

```tsx
const toggleFullscreen = () => {
  const container = videoRef.current?.parentElement;
  if (!container) return;
  if (!document.fullscreenElement) {
    container.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
};
```

`parentElement` of the `<video>` could be various things depending on how `PlayerView.tsx` nests it. The fullscreen should ideally target the `.advanced-player` wrapper div (which includes controls), not just the video's parent.

**Fix: Use a ref on the `.advanced-player` wrapper div for fullscreen.**

---

## Bug 12: Keyboard Shortcuts Don't Check If Within a Modal/Input

**Severity: LOW-MEDIUM**

File: `AdvancedPlayer.tsx`, lines 128-130 checks `tag === 'input'` etc., but only for the `keydown` event on `window`. If a modal dialog is open (e.g., AddToCollectionModal), pressing Space toggles video playback instead of being caught by the modal.

**Fix: Add a global check if any modal is open, or check `document.activeElement` for modal content.**

---

## Bug 13: Local Zap Mode Interval Persists After Component Unmount

**Severity: MEDIUM**

File: `AdvancedPlayer.tsx`, lines 91-117

The `localZap` effect has `[localZap]` as dependency. When `localZap` becomes `false`, the cleanup runs and clears the interval. But if the component unmounts while `localZap` is `true` (e.g., navigating away), the interval is cleared. This seems correct, but the `setInterval` callback references `vid` which is captured at effect setup time — if the video element changes, the callback has a stale reference.

**Fix: Use a ref for the video element inside the interval or re-read `videoRef.current` on each tick.**

---

## Bug 14: Volume Slider Shows Current Value Incorrectly When Muted

**Severity: LOW**

File: `AdvancedPlayer.tsx`, line 366

```tsx
value={muted ? 0 : volume}
```

The volume slider jumps to 0 when muted, but when user unmutes by moving the slider (`onChange` sets `muted = false`), the previous volume value is restored. This is actually correct behavior, but visually jarring because the slider position jumps from 0 to the previous volume.

**Fix: Keep the slider at the last volume position while muted (don't change `value`), but visual-only. Or add a smoother transition.**

---

## Bug 15: Zapping Hidden Video Element Has `controls` Enabled

**Severity: LOW**

File: `PlayerView.tsx`, line 327

The hidden `#video-player-zap` element has `controls` attribute. While `display: none` hides it, having unnecessary attributes is sloppy and could cause edge cases if display changes unexpectedly.

**Fix: Remove the `controls` attribute from the hidden zap video element.**

---

## Summary of Fix Priority

| Priority | Bug | Component |
|----------|-----|-----------|
| P0 | Zapping completely broken | zap.ts + PlayerView |
| P1 | Stale closure in keyboard handler | AdvancedPlayer |
| P1 | No error handling on video element | AdvancedPlayer |
| P2 | No loading/buffering indicator | AdvancedPlayer |
| P2 | Hover preview tooltip overflow | AdvancedPlayer |
| P2 | `getThumbIndex` hardcoded to 5 | AdvancedPlayer |
| P2 | `formatDuration` on NaN/0/Infinity | AdvancedPlayer |
| P3 | Controls auto-hide timer doesn't reset on click | AdvancedPlayer |
| P3 | Subtitles flash on video switch | PlayerView |
| P3 | Chapter jump for non-video sources | PlayerView |
| P3 | Fullscreen targets wrong parent | AdvancedPlayer |
| P3 | Keyboard shortcuts fire in modals | AdvancedPlayer |
| P3 | Local zap interval stale ref | AdvancedPlayer |
| P4 | Volume slider jumps when unmuting | AdvancedPlayer |
| P4 | Hidden zap video has `controls` attr | PlayerView |