# Plan: Link Video Scraper and Integration

## Objective
Enhance the links feature by automatically scraping direct video links from linked pages. This will allow linked videos to be played directly within the app's player, appear in the "Next Up" queue, and be suggested alongside local videos.

## Proposed Features

### 1. Background Scraper Worker
- When a link is saved (or triggered manually for all), launch a background task.
- Use `yt-dlp --get-url <url>` or `yt-dlp -g <url>` to extract the direct video stream URL.
- This is highly effective for sites like YouTube, Twitter, Reddit, and many others.
- If `yt-dlp` fails, fall back to a simple fetch of the HTML to look for static `<video>` sources, or use the headless Edge instance to inspect the DOM after JS execution.

### 2. Database Updates
- Store the scraped video URL in the links database (`links_cache.json`).
- Added fields for a link item:
  - `scrapedVideoUrl`: The direct link to the video file or stream.
  - `hasVideo`: Boolean flag indicating a video was found.
  - `lastScrapeTime`: Timestamp of the last check.

### 3. Frontend Behavior and Navigation
- **Click Action**: In the Links view, if a link has `hasVideo: true`, clicking it will NOT open a new browser tab. Instead, it will open the app's video player view.
- **Player Integration**: The player will load the `scrapedVideoUrl` as the source.
- **Unified List**: Links with scraped videos will be mapped to a structure similar to local videos (with `id` derived from URL, `name` from title, etc.) so they can be processed by existing components.

### 4. Ecosystem Integration (Next Up & Suggested)
- **Next Up**: Links with videos will be eligible to appear in the "Next Up" list for autoplay.
- **Suggested Videos**: They will also appear in the "Related Videos" section under the player if they share tags or categories with the current video.
- **Filtering**: Links *without* a fetched video link will continue to behave as they do now (opening in a new tab and not appearing in video queues).

## Implementation Strategy

### Phase 1: Backend Worker (`links-server.js`)
- Implement a function `scrapeVideoLink(url)` that uses `YT_DLP_BIN` to get the URL.
- Update `apiSaveLinksCache` or add a new endpoint `/api/links/scrape` to trigger this process.
- Ensure it runs asynchronously and doesn't block the main server.

### Phase 2: Database and API
- Update the links JSON structure.
- Ensure `/api/links` returns the new fields.

### Phase 3: Frontend Modifications
- Update `LinksView.tsx` to check for `scrapedVideoUrl` on click.
- Update `PlayerView.tsx` to handle external URLs (detect if src starts with `http` instead of `/api/stream`).
- Update `store.ts` or the specific hooks that calculate `playerNextUp` and `suggestedVideos` to fetch or mix in links with videos.

## Open Questions / Considerations
- **CORS and Referrer Headers**: Some direct video links (e.g., from Twitter or Instagram) require specific headers or session cookies to play. We might need to implement a simple pass-through proxy in the server (e.g., `/api/stream-remote?url=...`) that adds the necessary headers.
- **Stream Expiration**: Links returned by `yt-dlp` often expire after a few hours. We may need to re-scrape the link just before playing if it fails.
