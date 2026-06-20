#!/usr/bin/env bash
# AphroArchive installer — do NOT use set -e; optional steps must be allowed to fail.

echo
echo " =========================================="
echo "  AphroArchive Installer"
echo " =========================================="
echo
echo "  1  Minimal  |  Node + ffmpeg + yt-dlp"
echo "              |  Everything needed to run the server"
echo
echo "  2  Full     |  Minimal + Python + Whisper + base model"
echo "              |  AI subtitles, dev server, standalone build"
echo

INSTALL_MODE=""
ERRORS=0
PYTHON_CMD=""

# Accept mode from first argument
ARG=$(echo "${1}" | tr '[:upper:]' '[:lower:]')
case "$ARG" in
    minimal|1) INSTALL_MODE=1 ;;
    full|2)    INSTALL_MODE=2 ;;
esac

# Interactive prompt if no valid argument given
if [ -z "$INSTALL_MODE" ]; then
    while true; do
        printf "  Choose [1/2]: "
        read -r INSTALL_MODE
        case "$INSTALL_MODE" in
            1|2) break ;;
            *) echo "  Please enter 1 or 2." ;;
        esac
    done
fi

echo
if [ "$INSTALL_MODE" = "1" ]; then
    echo " [MODE] Minimal — run only"
else
    echo " [MODE] Full — AI subtitles + dev build"
fi
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

# ─── Minimal done — skip Whisper ─────────────────────────────────────
if [ "$INSTALL_MODE" = "1" ]; then
    echo " ------------------------------------------"
    echo
    [ "$ERRORS" -eq 0 ] \
        && echo " All dependencies installed successfully." \
        || echo " Some steps had warnings — see above."
    echo
    echo "  Start:   node server.js"
    echo
    echo "  Optional: run './install.sh full' to also set up Whisper AI subtitles."
    echo
    exit 0
fi

# ════════════════════════════════════════════════════════════════════
#  Full mode — Python + Whisper + base model
# ════════════════════════════════════════════════════════════════════

# ─── Python ──────────────────────────────────────────────────────────
if command -v python3 &>/dev/null; then
    PYTHON_CMD="python3"
    echo " [OK]   $(python3 --version)"
elif command -v python &>/dev/null; then
    PYTHON_CMD="python"
    echo " [OK]   $(python --version)"
else
    echo " [WARN] Python not found. Install Python 3.8+ from https://www.python.org"
    echo "        Whisper requires Python — skipping Whisper setup."
    ERRORS=1
fi

# ─── Whisper ─────────────────────────────────────────────────────────
if [ -n "$PYTHON_CMD" ]; then
    if command -v whisper &>/dev/null || command -v whisper-ctranslate2 &>/dev/null; then
        echo " [OK]   whisper found in PATH"
    else
        echo " [INFO] Installing openai-whisper via pip (this may take a while)..."
        $PYTHON_CMD -m pip install openai-whisper --quiet \
            && echo " [OK]   openai-whisper installed" \
            || { echo " [WARN] Whisper install failed. Try: pip install openai-whisper"; ERRORS=1; }
    fi

    # ─── Pre-download base model (~139 MB) into models/ ──────────────
    if $PYTHON_CMD -c "import whisper" 2>/dev/null; then
        mkdir -p models
        echo " [INFO] Pre-downloading Whisper base model (~139 MB) into models/ ..."
        $PYTHON_CMD -c "import os, whisper; whisper.load_model('base', download_root=os.path.join(os.getcwd(), 'models'))" \
            && echo " [OK]   Whisper base model ready in models/" \
            || echo " [WARN] Base model pre-download failed — it will download on first subtitle generation."
    fi
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
echo "  Whisper models beyond 'base' can be downloaded from"
echo "  Settings > AI > Whisper Subtitles."
echo
