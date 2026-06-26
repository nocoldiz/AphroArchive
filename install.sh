#!/usr/bin/env bash
# AphroArchive installer — do NOT use set -e; optional steps must be allowed to fail.

echo
echo " =========================================="
echo "  AphroArchive Installer"
echo " =========================================="
echo
echo "  Node + ffmpeg + yt-dlp — everything needed to run the server"
echo

ERRORS=0

echo " ------------------------------------------"

# ─── Node.js ─────────────────────────────────────────────────────────
if command -v node &>/dev/null; then
    echo " [OK]   node.js $(node --version)"
else
    echo " [WARN] node.js not found. Install from https://nodejs.org"
    ERRORS=1
fi

# ─── npm install ─────────────────────────────────────────────────────
echo " [INFO] Running npm install..."
npm install --silent \
    && echo " [OK]   npm dependencies installed" \
    || { echo " [WARN] npm install failed"; ERRORS=1; }

# ─── FFmpeg / FFprobe ────────────────────────────────────────────────
if command -v ffmpeg &>/dev/null; then
    echo " [OK]   ffmpeg found in PATH"
elif [ -f "./ffmpeg" ]; then
    echo " [OK]   ffmpeg found in project root"
else
    echo " [INFO] ffmpeg not found — attempting to install..."
    if command -v apt-get &>/dev/null; then
        sudo apt-get install -y ffmpeg \
            && echo " [OK]   ffmpeg installed via apt" \
            || { echo " [WARN] apt install failed"; ERRORS=1; }
    elif command -v brew &>/dev/null; then
        brew install ffmpeg \
            && echo " [OK]   ffmpeg installed via brew" \
            || { echo " [WARN] brew install failed"; ERRORS=1; }
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y ffmpeg \
            && echo " [OK]   ffmpeg installed via dnf" \
            || { echo " [WARN] dnf install failed"; ERRORS=1; }
    elif command -v pacman &>/dev/null; then
        sudo pacman -S --noconfirm ffmpeg \
            && echo " [OK]   ffmpeg installed via pacman" \
            || { echo " [WARN] pacman install failed"; ERRORS=1; }
    else
        echo " [WARN] Cannot auto-install ffmpeg. Place ffmpeg/ffprobe in the project root or install via your package manager."
        ERRORS=1
    fi
fi

# ─── yt-dlp ──────────────────────────────────────────────────────────
if command -v yt-dlp &>/dev/null; then
    echo " [OK]   yt-dlp found in PATH"
elif [ -f "cache/yt-dlp" ]; then
    echo " [OK]   yt-dlp found in cache/"
else
    mkdir -p cache
    echo " [INFO] Downloading yt-dlp..."
    curl -fsSL -o cache/yt-dlp "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" \
        && chmod +x cache/yt-dlp \
        && echo " [OK]   yt-dlp downloaded to cache/" \
        || { echo " [WARN] yt-dlp download failed. Get it from https://github.com/yt-dlp/yt-dlp/releases"; ERRORS=1; }
fi

# ─── Done ─────────────────────────────────────────────────────────────
echo " ------------------------------------------"
echo
[ "$ERRORS" -eq 0 ] \
    && echo " All dependencies installed successfully." \
    || echo " Some steps had warnings — see above."
echo
echo "  Start:  node server.js"
echo "  Dev:    npm run dev          (Vite frontend hot-reload)"
echo "  Build:  npm run build:win    (standalone .exe, Windows only)"
echo
