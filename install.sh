#!/usr/bin/env bash
set -e
echo "==================================="
echo " AphroArchive Dependency Installer"
echo "==================================="
echo

ERRORS=0

# ─── Node.js ─────────────────────────────────────────────────────────
if command -v node &>/dev/null; then
    echo "[OK] node.js found: $(node --version)"
else
    echo "[WARN] node.js not found. Install from https://nodejs.org"
    ERRORS=1
fi

# ─── npm install ─────────────────────────────────────────────────────
echo "[INFO] Running npm install..."
npm install --silent && echo "[OK] npm dependencies installed" || { echo "[WARN] npm install failed"; ERRORS=1; }

# ─── FFmpeg / FFprobe ────────────────────────────────────────────────
if command -v ffmpeg &>/dev/null; then
    echo "[OK] ffmpeg found in PATH"
else
    if [ -f "./ffmpeg" ]; then
        echo "[OK] ffmpeg found in project root"
    else
        echo "[INFO] ffmpeg not found in PATH."
        if command -v apt-get &>/dev/null; then
            echo "[INFO] Installing via apt..."
            sudo apt-get install -y ffmpeg && echo "[OK] ffmpeg installed" || { echo "[WARN] apt install failed"; ERRORS=1; }
        elif command -v brew &>/dev/null; then
            echo "[INFO] Installing via brew..."
            brew install ffmpeg && echo "[OK] ffmpeg installed" || { echo "[WARN] brew install failed"; ERRORS=1; }
        else
            echo "[WARN] Cannot auto-install ffmpeg. Install it manually or place ffmpeg/ffprobe in the project root."
            ERRORS=1
        fi
    fi
fi

# ─── yt-dlp ──────────────────────────────────────────────────────────
if command -v yt-dlp &>/dev/null; then
    echo "[OK] yt-dlp found in PATH"
else
    mkdir -p cache
    if [ -f "cache/yt-dlp" ]; then
        echo "[OK] yt-dlp found in cache/"
    else
        echo "[INFO] Downloading yt-dlp..."
        curl -L -o cache/yt-dlp "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" 2>/dev/null \
            && chmod +x cache/yt-dlp \
            && echo "[OK] yt-dlp downloaded to cache/" \
            || { echo "[WARN] yt-dlp download failed. Download from https://github.com/yt-dlp/yt-dlp/releases"; ERRORS=1; }
    fi
fi

# ─── Whisper ─────────────────────────────────────────────────────────
PYTHON_CMD=""
if command -v python3 &>/dev/null; then
    PYTHON_CMD="python3"
elif command -v python &>/dev/null; then
    PYTHON_CMD="python"
fi

if command -v whisper &>/dev/null; then
    echo "[OK] whisper found in PATH"
else
    if [ -z "$PYTHON_CMD" ]; then
        echo "[WARN] Python not found. Cannot install Whisper automatically."
        echo "       Install Python 3.8+ then run: pip install openai-whisper"
        ERRORS=1
    else
        echo "[INFO] Installing openai-whisper via pip (this may take a while)..."
        echo "       Models (~150 MB - 3 GB) will be downloaded on first use."
        $PYTHON_CMD -m pip install openai-whisper --quiet \
            && echo "[OK] openai-whisper installed" \
            || { echo "[WARN] whisper installation failed. Try: pip install openai-whisper"; ERRORS=1; }
    fi
fi

echo
if [ "$ERRORS" -eq 0 ]; then
    echo "All dependencies installed successfully."
else
    echo "Some dependencies could not be installed automatically. See warnings above."
fi
echo
echo "Start the server with: node server.js"
echo
