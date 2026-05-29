# Plan: Custom Advanced Video Player

## Objective
Create a custom, feature-rich video player component to replace the default HTML5 video controls in `PlayerView.tsx`. This will provide a more premium and functional experience, including chapters on the timeline and hover previews.

## Proposed Features

### 1. Custom Control Bar
- Custom Play/Pause button.
- Volume control slider with mute toggle.
- Playback speed selector (0.5x, 1x, 1.25x, 1.5x, 2x).
- Fullscreen toggle.
- Next and Previous buttons (integrated with "Next Up" queue).

### 2. Advanced Timebar (Progress Bar)
- **Chapter Highlights**: Visual markers on the timebar indicating the start of chapters. Tooltips with chapter titles on hover.
- **Timebar Preview**: A floating thumbnail preview that appears when hovering over the timebar, showing the frame corresponding to that time.
- **Buffer Display**: Show buffered video range.

### 3. Navigation
- Seamless integration with `playerNextUp` store.
- Auto-play next video on end (configurable).

### 4. Keyboard Shortcuts
- Space: Play/Pause.
- Arrow Left/Right: Seek 10s.
- Arrow Up/Down: Volume.
- M: Mute.
- F: Fullscreen.
- N: Next video.
- P: Previous video.

## Implementation Strategy

### Phase 1: Component Structure
- Create `AdvancedPlayer.tsx` in `public/src/components/UI/`.
- It will accept `videoUrl`, `subtitles`, `chapters`, and callbacks for `onNext`/`onPrev`.
- Use a wrapper `div` to contain the video element and the custom controls overlay.

### Phase 2: Custom Controls Logic
- Use `useEffect` and event listeners on the video element to update React state for `currentTime`, `duration`, `playing`, `volume`, etc.
- Disable default `controls` attribute on the `<video>` element.

### Phase 3: Timebar and Preview
- Calculate percentage for click/hover based on mouse position relative to timebar width.
- For preview images, map the hover percentage to the available thumbnails fetched from `/api/thumbs/${videoId}/${index}`. (e.g., if there are 10 thumbnails, hover at 30% shows index 3).
- Render small vertical lines or dots on the timebar for chapter locations.

### Phase 4: Integration
- Replace the `<video>` tag in `PlayerView.tsx` with `<AdvancedPlayer>`.
- Pass necessary props and state.

## Open Questions / Considerations
- **Thumbnail Density**: If a video has very few thumbnails, the preview won't be very accurate. We might want to add an option to generate more thumbnails per video in the future.
- **CSS Styling**: We need to ensure the controls overlay hides after a few seconds of inactivity and reappears on mouse move.
