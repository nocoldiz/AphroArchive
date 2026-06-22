#!/usr/bin/env bash
cd "$(dirname "$0")"

# Resolve a Python 3 interpreter (python3 preferred, fall back to python).
if command -v python3 >/dev/null 2>&1; then
    PYTHON="python3"
elif command -v python >/dev/null 2>&1 && python --version 2>&1 | grep -q "Python 3"; then
    PYTHON="python"
else
    echo "  ERROR: Python 3 not found. Install it from https://python.org"
    exit 1
fi

# Make sure dependencies are installed — run ./install.sh first if yt-dlp is missing.
if ! "$PYTHON" -c "import yt_dlp" >/dev/null 2>&1; then
    echo "yt-dlp is not installed."
    echo "Please run ./install.sh first to set up dependencies."
    exit 1
fi

echo "=================================="
echo "BulkDownloader Launcher"
echo "=================================="
echo "  1. GUI version"
echo "  2. Console version"
echo ""
read -r -p "Choose (1 or 2): " choice

case "$choice" in
    1) exec "$PYTHON" bulkdownloader_gui.py ;;
    2) exec "$PYTHON" bulkdownloader.py ;;
    *) echo "Invalid choice." ; exit 1 ;;
esac
