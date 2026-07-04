#!/usr/bin/env bash
cd "$(dirname "$0")"

FORCE_INSTALL=0
if [[ "$1" == "--install" ]]; then FORCE_INSTALL=1; fi

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✔${NC}  $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC}  $*"; }
err()  { echo -e "  ${RED}✖${NC}  $*"; }
sep()  { echo -e "\n${BOLD}[$1] $2${NC}"; }

OS="$(uname -s)"
ARCH="$(uname -m)"

# ── First-run install ─────────────────────────────────────────────────────────
if [ ! -d "node_modules" ] || [ "$FORCE_INSTALL" = "1" ]; then
    echo ""
    echo -e "${BOLD} AphroArchive — First Run Setup${NC}"
    echo " =============================="
    echo ""

    echo "  Choose install mode:"
    echo ""
    echo "    [1] Minimal install (default)"
    echo "         Installs only runtime dependencies (preact, signals)."
    echo "         Skips all dev/build tools."
    echo "         Fastest option — no native compilation required."
    echo ""
    echo "    [2] Full install"
    echo "         Installs ALL dependencies including dev/build tools"
    echo "         (vite, TypeScript, pkg, etc.)."
    echo "         Needed for development and building executable packages."
    echo ""
    read -r -p "  Enter choice (1 or 2) [1]: " INSTALL_MODE
    INSTALL_MODE="${INSTALL_MODE:-1}"
    echo ""
    if [[ "$INSTALL_MODE" == "2" ]]; then
        echo "  Full mode selected — installing all dependencies."
    else
        INSTALL_MODE="1"
        echo "  Minimal mode selected — skipping optional and dev dependencies."
    fi
    echo ""

    # ── 1. Node.js ────────────────────────────────────────────────────────────
    sep 1 "Checking Node.js"
    if ! command -v node &>/dev/null; then
        warn "Node.js not found. Attempting install..."
        if [[ "$OS" == "Darwin" ]]; then
            if command -v brew &>/dev/null; then
                brew install node
            else
                err "Homebrew not found. Install Node.js 22+ from https://nodejs.org or install Homebrew first."
                exit 1
            fi
        elif [[ "$OS" == "Linux" ]]; then
            if command -v apt-get &>/dev/null; then
                curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
                sudo apt-get install -y nodejs
            elif command -v dnf &>/dev/null; then
                sudo dnf install -y nodejs
            elif command -v pacman &>/dev/null; then
                sudo pacman -S --noconfirm nodejs npm
            else
                err "Could not detect package manager. Install Node.js 22+ manually: https://nodejs.org"
                exit 1
            fi
        fi
    fi

    NODE_MAJOR=$(node -e "process.stdout.write(String(parseInt(process.versions.node)))")
    if [[ "$NODE_MAJOR" -lt 22 ]]; then
        err "Node.js 22 or newer is required (found $(node --version))."
        err "node:sqlite is a built-in module available from Node 22.5+."
        err "Please update from: https://nodejs.org"
        exit 1
    fi
    ok "Node.js $(node --version)"

    # ── 2. npm install ────────────────────────────────────────────────────────
    sep 2 "Running npm install"
    if [[ "$INSTALL_MODE" == "1" ]]; then
        echo "  Skips: Vite, TypeScript, pkg"
        npm install --omit=dev
    else
        npm install
    fi
    ok "npm install done"

    # ── 3. Python 3 (full install only) ──────────────────────────────────────
    sep 3 "Python 3"
    PYTHON=""
    if [[ "$INSTALL_MODE" != "2" ]]; then
        ok "Skipped (minimal mode)"
    else
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
                    warn "Could not detect package manager. Install Python 3 manually: https://python.org"
                    PYTHON=""
                fi
                [[ -z "$PYTHON" ]] || PYTHON="python3"
            fi
            [[ -z "$PYTHON" ]] || ok "$($PYTHON --version)"
        fi
    fi

    # ── 4. yt-dlp ─────────────────────────────────────────────────────────────
    sep 4 "Downloading yt-dlp"
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

    # ── 5. ffmpeg + ffprobe ───────────────────────────────────────────────────
    sep 5 "Checking ffmpeg"
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
                warn "Package manager not detected. Downloading static ffmpeg build..."
                if [[ "$ARCH" == "x86_64" ]]; then
                    FFMPEG_STATIC_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
                    curl -fsSL "$FFMPEG_STATIC_URL" -o ffmpeg_static.tar.xz
                    tar xf ffmpeg_static.tar.xz --strip-components=1 --wildcards '*/ffmpeg' '*/ffprobe' 2>/dev/null || \
                        tar xf ffmpeg_static.tar.xz
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

    echo ""
    echo -e "${BOLD} ──────────────────────────────────────────────────────${NC}"
    echo -e "${GREEN}${BOLD}  Setup complete!  Starting AphroArchive...${NC}"
    echo -e "${BOLD} ──────────────────────────────────────────────────────${NC}"
    echo ""
fi

# ── Version check ─────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
    echo -e "  ${RED}✖${NC}  Node.js not found. Please install Node.js 22+ from https://nodejs.org"
    exit 1
fi
NODE_MAJOR=$(node -e "process.stdout.write(String(parseInt(process.versions.node)))")
if [[ "$NODE_MAJOR" -lt 22 ]]; then
    echo -e "  ${RED}✖${NC}  Node.js 22.5 or newer is required (found $(node --version))."
    echo "     Please update from: https://nodejs.org"
    exit 1
fi

# ── Open browser ──────────────────────────────────────────────────────────────
case "$OS" in
  Darwin) open "http://localhost:3000" ;;
  Linux)  xdg-open "http://localhost:3000" 2>/dev/null || sensible-browser "http://localhost:3000" 2>/dev/null & ;;
esac

# ── Launch server ─────────────────────────────────────────────────────────────
if [[ "$NODE_MAJOR" -lt 23 ]]; then
    exec node --experimental-sqlite server.js
else
    exec node server.js
fi
