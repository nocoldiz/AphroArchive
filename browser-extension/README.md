# AphroArchive Downloader (Firefox Extension)

Detect and download **videos** and **photos** from any page — and optionally hand
them to a running **AphroArchive** app for queued, yt-dlp-powered downloads,
category sorting, and your photo gallery.

## Install (temporary, for development)

1. Open Firefox and go to `about:debugging`.
2. Click "This Firefox" → "Load Temporary Add-on".
3. Select `manifest.json` in this folder.

A packaged build (`dist/AphroArchive-firefox.xpi`) is produced by the repo's
`build.bat` / `build.sh`, or directly with `npm run build:extension`.

## What it does

The popup has several sections. A status dot at the top shows whether your
AphroArchive server is reachable; **server-only features stay hidden until it is**.

### This page — *server only*
Context actions for the current tab (visible only when AphroArchive is running):
- **Add site to DB** — registers the current site in your websites database.
- **Save page (offline)** — stores the rendered HTML in the Pages section for
  offline viewing.
- **Save text to Books** — shown when the tab is a plain-text/markdown file.
- **Send video / photo to library** — shown when the tab is a single direct video
  or image; sends it to your Videos / Photos.

### Videos on this page — *always available*
- Detects `<video>`/`<source>`/`<audio>`, `og:video` / `twitter:player` meta and
  media-file links, **plus any response served as `video/*` or `audio/*` sniffed
  from network traffic** (the `net` tag) — even from extension-less URLs. This is
  what makes sites like **X.com / Twitter** work: their progressive MP4s are
  caught and download directly, with **no server required**. The toolbar badge
  shows the count.
- **Server running:** Download / "Send all to AphroArchive" queue the videos on
  the server, which runs yt-dlp via `bulkdownloader.py` (handles HLS, scraping,
  best-quality merges, dedup). Downloads are left **uncategorized** and saved to
  `videos/downloads`.
- **Server off:** progressive files (`.mp4`, `.webm`, …) download straight through
  the browser. HLS/DASH rows are disabled — a playlist can't be saved as a file
  without yt-dlp.

### Photos on this page — *always available*
- Collects real content images (`<img>` incl. `srcset`/lazy attrs, CSS
  backgrounds, image links) and **ignores icons, sprites, logos, avatars, SVGs and
  anything below the minimum size** (configurable in Options). X.com/Twitter media
  is upgraded to full `name=orig` resolution automatically.
- **Download** selected, **Download ZIP** (bundled in-browser), or **Send to
  gallery** (server running) — uploads each image to your AphroArchive photos.

### Scraped links — *always available*
- The original link scraper: Manual / Auto mode, regex filter, **Copy List**,
  **Export .txt**, **Clear**. With the server running, **Send to AphroArchive**
  saves the current links as bookmarks for your active profile.

### Download queue — *server only*
- Live view of the AphroArchive download queue (status, progress, speed).

## Options

- **AphroArchive server URL** — default `http://localhost:3000`.
- **Minimum photo size (px)** — images smaller than this are treated as
  decorations and hidden (unknown-size lazy/background images are always kept).
- **Treat subdomains as internal** / **Default link filter regex** — for the link
  scraper.

## Can yt-dlp be bundled into the extension?

No. Firefox MV3 extensions run sandboxed and cannot execute a bundled binary. That
is exactly why downloads that need yt-dlp (HLS/DASH, site scraping, best-quality
merges) are routed to the **AphroArchive server**, which already ships yt-dlp in
its `cache/` folder. Start AphroArchive (`node server.js`) and the extension lights
up its server features automatically. Direct, progressive downloads and all
scraping still work with no server at all.
