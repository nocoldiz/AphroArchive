# AphroArchive Link Scraper (Firefox Extension)

Scrapes all internal links from the current page — useful for building URL
lists from video streaming sites to feed into `Bulkdownloader/links_to_download.txt`.

## Install (temporary, for development)

1. Open Firefox and go to `about:debugging`.
2. Click "This Firefox" → "Load Temporary Add-on".
3. Select `manifest.json` in this folder.

## Usage

- **Manual mode** (default): click the toolbar icon, then "Scrape Current Page"
  to register every internal link found on the page you're viewing.
- **Auto mode**: switch the toggle to "Auto" — every page you navigate to in
  any tab is automatically scraped as soon as it finishes loading.
- Use the **filter** box (regex, e.g. `watch|episode|\.mp4`) to narrow the
  list down to video-like links before copying or exporting.
- **Copy List** copies the (filtered) URLs as a newline-separated list to the
  clipboard — paste directly into `links_to_download.txt`.
- **Export .txt** saves the same list to a file via the browser's download dialog.
- **Clear** wipes all collected links.

## Options

- "Treat subdomains as internal" — when enabled, links to `cdn.example.com`
  count as internal when browsing `www.example.com` (useful for sites that
  serve videos from a separate subdomain).
- "Default filter regex" — pre-fills the popup filter box.

## Notes

- "Internal" means same-origin (or same registrable domain, with the
  subdomain option enabled).
- Links are deduplicated and persisted in extension storage until cleared.
- The extension cannot inject into privileged pages (`about:`, the add-ons
  store, etc.) — these are silently skipped in auto mode.
