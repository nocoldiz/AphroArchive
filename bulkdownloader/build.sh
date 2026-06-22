#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# ── Resolve a Python 3 interpreter ──────────────────────────────────────
if command -v python3 >/dev/null 2>&1; then
    PY=python3
elif command -v python >/dev/null 2>&1 && python --version 2>&1 | grep -q "Python 3"; then
    PY=python
else
    echo "ERROR: Python 3 not found. Install it first (see launch.sh)." >&2
    echo "       macOS:  brew install python3" >&2
    echo "       Linux:  sudo apt-get install python3 python3-pip  (or dnf/pacman)" >&2
    exit 1
fi

# ── Ensure PyInstaller is available ─────────────────────────────────────
if ! "$PY" -c "import PyInstaller" >/dev/null 2>&1; then
    echo "Installing PyInstaller..."
    "$PY" -m pip install -U pyinstaller
fi

if [[ "$OSTYPE" == "darwin"* ]]; then
    PLATFORM="macOS"
else
    PLATFORM="Linux"
fi

echo "Building BulkDownloaderGUI for $PLATFORM..."
"$PY" -m PyInstaller --clean --noconfirm \
    --distpath ../dist \
    --workpath ../build/bulkdownloader \
    BulkDownloaderGUI.spec

echo ""
if [[ "$PLATFORM" == "macOS" ]] && [ -d ../dist/BulkDownloaderGUI.app ]; then
    # Zip the .app bundle into a distributable release archive.
    ( cd ../dist && rm -f BulkDownloaderGUI-mac.zip \
        && zip -qr BulkDownloaderGUI-mac.zip BulkDownloaderGUI.app )
    echo "Done: dist/BulkDownloaderGUI.app  (release: dist/BulkDownloaderGUI-mac.zip)"
else
    chmod +x ../dist/BulkDownloaderGUI 2>/dev/null || true
    echo "Done: dist/BulkDownloaderGUI"
fi
