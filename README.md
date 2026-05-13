# AphroArchive

AphroArchive is a local video organizer and streaming server built with Node.js and Preact. It helps you organize your local media collection with features like category derivation, actor tagging, and a beautiful web interface.

## Features

- **Local Video Organization**: Automatically derives categories from folder structure.
- **Profile System**: Support for multiple isolated profiles with their own databases.
- **Web Interface**: Modern, responsive interface built with Preact and TSX.
- **Video Streaming**: Stream local videos directly in your browser.
- **Metadata Management**: Tag actors, studios, and websites.

## Installation

### Prerequisites

- Node.js (v16 or higher)
- ffmpeg / ffprobe (for thumbnail generation)
- yt-dlp (optional, for downloads)

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/nocoliz/AphroArchive.git
   cd AphroArchive
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the application:
   ```bash
   npm run dev
   ```

## Usage

Access the application at `http://localhost:3000` (or the configured port).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
