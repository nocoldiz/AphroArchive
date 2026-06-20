#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [[ "$OSTYPE" == "darwin"* ]]; then
    PLATFORM="macOS"
    OUT="dist/BulkDownloaderGUI.app"
else
    PLATFORM="Linux"
    OUT="dist/BulkDownloaderGUI"
fi

echo "Building BulkDownloaderGUI for $PLATFORM..."
pyinstaller --clean --noconfirm \
    --distpath ../dist \
    --workpath ../build/bulkdownloader \
    BulkDownloaderGUI.spec

echo ""
echo "Done: $OUT"
