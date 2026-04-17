#!/usr/bin/env bash
# AphroArchive installer — macOS & Linux
set -euo pipefail
cd "$(dirname "$0")"

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✔${NC}  $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC}  $*"; }
err()  { echo -e "  ${RED}✖${NC}  $*"; }
sep()  { echo -e "\n${BOLD}[$1/7] $2${NC}"; }

OS="$(uname -s)"
ARCH="$(uname -m)"

echo ""
echo -e "${BOLD} AphroArchive installer${NC}"
echo " ====================="
echo ""

# ── 1. Node.js ────────────────────────────────────────────────────────────────
sep 1 "Checking Node.js"
if command -v node &>/dev/null; then
    ok "Node.js $(node --version)"
else
    warn "Node.js not found. Attempting install..."
    if [[ "$OS" == "Darwin" ]]; then
        if command -v brew &>/dev/null; then
            brew install node
        else
            err "Homebrew not found. Install Node.js from https://nodejs.org or install Homebrew first."
            exit 1
        fi
    elif [[ "$OS" == "Linux" ]]; then
        if command -v apt-get &>/dev/null; then
            curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
            sudo apt-get install -y nodejs
        elif command -v dnf &>/dev/null; then
            sudo dnf install -y nodejs
        elif command -v pacman &>/dev/null; then
            sudo pacman -S --noconfirm nodejs npm
        else
            err "Could not detect package manager. Install Node.js manually: https://nodejs.org"
            exit 1
        fi
    fi
    ok "Node.js $(node --version)"
fi


# ── 2. Python 3 ───────────────────────────────────────────────────────────────
sep 2 "Checking Python 3"
PYTHON=""
if command -v python3 &>/dev/null; then
    PYTHON="python3"
elif command -v python &>/dev/null && python --version 2>&1 | grep -q "Python 3"; then
    PYTHON="python"
fi

if [[ -n "$PYTHON" ]]; then
    ok "$($PYTHON --version)"
else
    warn "Python 3 not found. Attempting install..."
    if [[ "$OS" == "Darwin" ]]; then
        brew install python3
        PYTHON="python3"
    elif [[ "$OS" == "Linux" ]]; then
        if command -v apt-get &>/dev/null; then
            sudo apt-get install -y python3 python3-pip
        elif command -v dnf &>/dev/null; then
            sudo dnf install -y python3 python3-pip
        elif command -v pacman &>/dev/null; then
            sudo pacman -S --noconfirm python python-pip
        else
            err "Could not detect package manager. Install Python 3 manually: https://python.org"
            exit 1
        fi
        PYTHON="python3"
    fi
    ok "$($PYTHON --version)"
fi


# ── 3. npm install (dev deps for building) ────────────────────────────────────
sep 3 "Running npm install"
npm install
ok "npm install done"


# ── 4. Python dependencies ────────────────────────────────────────────────────
sep 4 "Installing Python dependencies"
$PYTHON -m pip install --upgrade pip --quiet
$PYTHON -m pip install -r requirements.txt
ok "Python deps installed (selenium)"


# ── 5. yt-dlp ─────────────────────────────────────────────────────────────────
sep 5 "Downloading yt-dlp"
YT_DLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
if command -v yt-dlp &>/dev/null; then
    ok "yt-dlp already on PATH: $(yt-dlp --version 2>/dev/null || echo 'unknown version')"
elif [[ -f "./yt-dlp" ]]; then
    ok "yt-dlp already present in project dir"
else
    if command -v curl &>/dev/null; then
        curl -fsSL "$YT_DLP_URL" -o yt-dlp && chmod +x yt-dlp
        ok "yt-dlp downloaded"
    elif command -v wget &>/dev/null; then
        wget -q "$YT_DLP_URL" -O yt-dlp && chmod +x yt-dlp
        ok "yt-dlp downloaded"
    else
        warn "curl/wget not found — could not download yt-dlp. Download queue will not work."
        warn "Manual download: https://github.com/yt-dlp/yt-dlp/releases/latest"
    fi
fi


# ── 6. ffmpeg + ffprobe ───────────────────────────────────────────────────────
sep 6 "Checking ffmpeg"
if command -v ffmpeg &>/dev/null; then
    ok "ffmpeg already on PATH"
elif [[ -f "./ffmpeg" ]]; then
    ok "ffmpeg already present in project dir"
else
    warn "ffmpeg not found. Attempting install..."
    if [[ "$OS" == "Darwin" ]]; then
        brew install ffmpeg
        ok "ffmpeg installed via Homebrew"
    elif [[ "$OS" == "Linux" ]]; then
        if command -v apt-get &>/dev/null; then
            sudo apt-get install -y ffmpeg
        elif command -v dnf &>/dev/null; then
            sudo dnf install -y ffmpeg
        elif command -v pacman &>/dev/null; then
            sudo pacman -S --noconfirm ffmpeg
        else
            # Download a static build for Linux
            warn "Package manager not detected. Downloading static ffmpeg build..."
            if [[ "$ARCH" == "x86_64" ]]; then
                FFMPEG_STATIC_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
                curl -fsSL "$FFMPEG_STATIC_URL" -o ffmpeg_static.tar.xz
                tar xf ffmpeg_static.tar.xz --strip-components=1 --wildcards '*/ffmpeg' '*/ffprobe' 2>/dev/null || \
                    tar xf ffmpeg_static.tar.xz
                # Find extracted binaries
                find . -maxdepth 2 -name 'ffmpeg' -not -path './node_modules/*' -exec cp {} . \; 2>/dev/null || true
                find . -maxdepth 2 -name 'ffprobe' -not -path './node_modules/*' -exec cp {} . \; 2>/dev/null || true
                rm -f ffmpeg_static.tar.xz
                chmod +x ffmpeg ffprobe 2>/dev/null || true
                ok "ffmpeg static build downloaded"
            else
                warn "Unsupported arch ($ARCH) for static download. Install ffmpeg manually."
            fi
        fi
    fi
fi


# ── 7. geckodriver (optional — only for Firefox downloader) ───────────────────
sep 7 "Checking geckodriver (optional)"
if command -v geckodriver &>/dev/null; then
    ok "geckodriver already on PATH"
elif [[ -f "./geckodriver" ]]; then
    ok "geckodriver already present in project dir"
else
    warn "geckodriver not found — only needed for Firefox-based downloading."
    if [[ "$OS" == "Darwin" ]]; then
        if command -v brew &>/dev/null; then
            brew install geckodriver && ok "geckodriver installed via Homebrew"
        else
            warn "Install manually: brew install geckodriver"
        fi
    elif [[ "$OS" == "Linux" ]]; then
        # Download from GitHub releases
        GD_API="https://api.github.com/repos/mozilla/geckodriver/releases/latest"
        if command -v curl &>/dev/null; then
            if [[ "$ARCH" == "x86_64" ]]; then
                GD_ASSET="linux64.tar.gz"
            elif [[ "$ARCH" == arm* ]] || [[ "$ARCH" == aarch64 ]]; then
                GD_ASSET="linux-aarch64.tar.gz"
            else
                GD_ASSET="linux64.tar.gz"
            fi
            GD_URL=$(curl -fsSL "$GD_API" | grep "browser_download_url" | grep "$GD_ASSET" | head -1 | cut -d'"' -f4)
            if [[ -n "$GD_URL" ]]; then
                curl -fsSL "$GD_URL" | tar xz -C .
                chmod +x geckodriver
                ok "geckodriver downloaded"
            else
                warn "Could not resolve geckodriver download URL."
            fi
        fi
    fi
fi



echo ""
echo -e "${BOLD} ──────────────────────────────────────────────────────${NC}"
echo -e "${GREEN}${BOLD}  All done!  Run ./start.sh to launch AphroArchive.${NC}"
echo -e "${BOLD} ──────────────────────────────────────────────────────${NC}"
echo ""
