#!/usr/bin/env bash
set -e
cd "$(dirname "$0")" || exit 1

echo
echo "============================================================"
echo " Building AphroArchive Desktop (standalone Electron GUI)"
echo " Runs in its own window -- no browser needed."
echo "============================================================"
echo

# ============================================================
# Optional flags: --win --linux --mac
# No flags = build for this host's platform.
# ============================================================
EB_TARGETS=""
for arg in "$@"; do
  case "$arg" in
    --win)   EB_TARGETS="$EB_TARGETS --win" ;;
    --linux) EB_TARGETS="$EB_TARGETS --linux" ;;
    --mac)   EB_TARGETS="$EB_TARGETS --mac" ;;
    *) echo "Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

if [ -z "$EB_TARGETS" ]; then
  case "$(uname -s)" in
    Darwin)          EB_TARGETS="--mac" ;;
    MINGW*|MSYS*|CYGWIN*) EB_TARGETS="--win" ;;
    *)               EB_TARGETS="--linux" ;;
  esac
fi

mkdir -p dist

echo "[build] Building frontend..."
npx vite build
echo " done."
echo

echo "[desktop] Packaging Electron app ($EB_TARGETS )..."
npx electron-builder $EB_TARGETS -c.artifactName='AphroArchive-gui.${ext}'
echo

echo "============================================================"
echo " Build complete. Standalone GUI app in dist/electron/"
echo "============================================================"
echo
