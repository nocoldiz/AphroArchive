# AphroArchive

A zero-dependency local video organizer with a web UI. Browse, search, tag, and play your video collection from any browser on your local network.

---

## Features

- **Browse & search** — full-text search, sort by date/name/size/length, shuffle
- **Categories & tags** — auto-detected from folder structure and a JSON database; sidebar shows counts
- **Bookmark integration** — import browser bookmarks; they appear as cards alongside local videos, sorted into matching categories/tags automatically; thumbnail fetched from Open Graph metadata
- **Source filter** — toggle between All / Local / Remote (bookmarks only) on any page
- **Actors / Studios** — browse your collection by actor or studio (matched by filename)
- **Vault** — hidden password-protected folder for private videos
- **Favourites** — star videos and filter to your favourites list
- **Watch history** — recently watched videos tracked automatically
- **Zapping mode** — random video auto-advance (bookmark videos excluded)
- **Mosaic mode** — multi-tile random video wall
- **Duplicate detection** — finds files with identical sizes
- **Collections** — group videos into named playlists
- **Remote access** — QR code to open the app from your phone on the same Wi-Fi
- **Themes** — 20+ built-in themes (Dark, Light, AMOLED, Cyberpunk, Neon, ASCII, Halloween, Christmas, and more)
- **Database editor** — edit actors, categories, and studios via card-based UI in the browser
- **Video import** — import videos by file path directly into your collection

---

## Requirements

- [Node.js](https://nodejs.org/) 18+ (or use the pre-built `.exe` for Windows)

---

## Getting Started

### Option A — Node.js

```bash
# Clone or download the repo
git clone https://github.com/nocoldiz/AphroArchive
cd AphroArchive

# Start the server
node server.js
```

Then open `http://localhost:3000` in your browser.

### Option B — Windows executable

Download `AphroArchive.exe` from [Releases](../../releases) and run it. No installation needed.

### Option C — Install script

```bash
# Linux/macOS
bash install.sh

# Windows
install.bat
```

---

## Folder structure

```
AphroArchive/
├── videos/          # Drop your video files here
│   └── CategoryName/  # Subfolders become categories
├── db/
│   ├── actors.json      # Actor database
│   ├── categories.json  # Category/tag database
│   └── studios.json     # Studio database
├── settings/        # App settings (auto-generated)
├── public/          # Web UI (HTML/CSS/JS)
└── server.js        # Server entry point
```

Videos placed directly in `videos/` are auto-sorted into matching category subfolders on startup. Videos in subfolders are detected as categories.

---

## Database files

### `db/actors.json`
```json
{
  "Actor Name": {
    "imdb_page": "https://...",
    "date_of_birth": "1990-01-01",
    "nationality": "US",
    "movies": ["film1", "film2"]
  }
}
```

### `db/categories.json`
```json
{
  "Category Name": {
    "displayName": "Category Name",
    "tags": ["alias1", "alias2"]
  }
}
```

### `db/studios.json`
```json
{
  "Studio Name": {
    "website": "https://...",
    "short_description": "Description"
  }
}
```

All three files are editable from the **Database** section in the sidebar.

---

## Bookmark import

1. Export bookmarks from your browser as an HTML file
2. Open the **Bookmarks** section in the sidebar
3. Import the `.html` file — bookmarks are matched to categories by title and shown as cards in the grid

---

## Building the Windows executable

```bash
npm install
npm run build:win
# Output: dist/AphroArchive.exe
```

---

## Support

If you find this useful, consider donating:

☕ **[Buy me a coffee](https://buymeacoffee.com/nocoldiz)**

---

## License

MIT
