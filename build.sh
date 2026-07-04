#!/usr/bin/env bash
set -e

# ============================================================
# Parse flags: --windows --linux --mac --android
# --publish  publishes the built artifacts to a GitHub release
# No platform flags = build all platforms
# ============================================================
DO_WINDOWS=0
DO_LINUX=0
DO_MAC=0
DO_ANDROID=0
DO_PUBLISH=0
ANY_FLAG=0

for arg in "$@"; do
  case "$arg" in
    --windows) DO_WINDOWS=1; ANY_FLAG=1 ;;
    --linux)   DO_LINUX=1;   ANY_FLAG=1 ;;
    --mac)     DO_MAC=1;     ANY_FLAG=1 ;;
    --android) DO_ANDROID=1; ANY_FLAG=1 ;;
    --publish) DO_PUBLISH=1 ;;
    *) echo "Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

if [ "$ANY_FLAG" -eq 0 ]; then
  DO_WINDOWS=1; DO_LINUX=1; DO_MAC=1; DO_ANDROID=1
fi

[ "$DO_WINDOWS" -eq 1 ] && echo " Target: Windows"
[ "$DO_LINUX"   -eq 1 ] && echo " Target: Linux"
[ "$DO_MAC"     -eq 1 ] && echo " Target: macOS"
[ "$DO_ANDROID" -eq 1 ] && echo " Target: Android"
[ "$DO_PUBLISH" -eq 1 ] && echo " Publish: GitHub Releases"
echo

mkdir -p dist

# ============================================================
# Frontend build — desktop (needed for Windows / Linux / Mac)
# ============================================================
NEED_DESKTOP=0
[ "$DO_WINDOWS" -eq 1 ] && NEED_DESKTOP=1
[ "$DO_LINUX"   -eq 1 ] && NEED_DESKTOP=1
[ "$DO_MAC"     -eq 1 ] && NEED_DESKTOP=1

if [ "$NEED_DESKTOP" -eq 1 ]; then
  echo "[build] Building frontend (desktop)..."
  npx vite build
  echo " done."
  echo
fi

# ============================================================
# Windows
# ============================================================
if [ "$DO_WINDOWS" -eq 1 ]; then
  echo "[windows] Packaging Windows (x64)..."
  npx pkg . --targets node24-win-x64 --output dist/AphroArchive.exe --compress GZip
  echo " done: dist/AphroArchive.exe"
  echo
fi

# ============================================================
# Linux
# ============================================================
if [ "$DO_LINUX" -eq 1 ]; then
  echo "[linux] Packaging Linux (x64)..."
  npx pkg . --targets node24-linux-x64 --output dist/AphroArchive-linux --compress GZip
  echo " done: dist/AphroArchive-linux"
  echo
fi

# ============================================================
# macOS (arm64 + x64 universal zip)
# ============================================================
if [ "$DO_MAC" -eq 1 ]; then
  echo "[mac] Packaging macOS..."

  if npx pkg . --targets node24-macos-arm64 --output dist/AphroArchive-macos-arm64 --compress GZip && \
     npx pkg . --targets node24-macos-x64   --output dist/AphroArchive-macos-x64   --compress GZip; then

    STAGE=dist/mac-stage
    rm -rf "$STAGE"
    mkdir -p "$STAGE/AphroArchive.app/Contents/MacOS"
    mkdir -p "$STAGE/AphroArchive.app/Contents/Resources"

    mv dist/AphroArchive-macos-arm64 "$STAGE/AphroArchive-macos-arm64"
    mv dist/AphroArchive-macos-x64   "$STAGE/AphroArchive-macos-x64"

    cat > "$STAGE/AphroArchive.app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIdentifier</key><string>com.aphroarchive.app</string>
  <key>CFBundleName</key><string>AphroArchive</string>
  <key>CFBundleDisplayName</key><string>AphroArchive</string>
  <key>CFBundleVersion</key><string>1.0.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST

    cat > "$STAGE/AphroArchive.app/Contents/MacOS/launcher" <<'LAUNCHER'
#!/bin/bash
set -e
APP_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then BIN="$APP_DIR/AphroArchive-macos-arm64"
else BIN="$APP_DIR/AphroArchive-macos-x64"; fi
chmod +x "$BIN" 2>/dev/null || true
exec "$BIN" "$@"
LAUNCHER
    chmod +x "$STAGE/AphroArchive.app/Contents/MacOS/launcher"

    cat > "$STAGE/setup.sh" <<'SETUP'
#!/bin/bash
cd "$(dirname "$0")"
echo "Setting permissions..."
chmod +x AphroArchive-macos-arm64 AphroArchive-macos-x64 AphroArchive.app/Contents/MacOS/launcher
echo "Done! Double-click AphroArchive.app to launch."
echo "If macOS blocks it: System Settings > Privacy & Security > Allow"
SETUP
    chmod +x "$STAGE/setup.sh"

    rm -f dist/AphroArchive-mac.zip
    (cd dist/mac-stage && zip -r ../AphroArchive-mac.zip .)
    rm -rf "$STAGE"

    echo " done: dist/AphroArchive-mac.zip"
  else
    echo " WARNING: macOS build failed (may need to run on macOS for native binaries)"
  fi
  echo
fi

# ============================================================
# Android APK
# ============================================================
if [ "$DO_ANDROID" -eq 1 ]; then
  echo "[android] Building Android APK..."

  echo "  [a] Building Android web assets..."
  npm run build:android-web

  echo "  [b] Syncing to Android project..."
  cd android-app
  npx cap sync android

  echo "  [c] Running Gradle (assembleRelease)..."
  cd android
  APK_LABEL=release
  APK_SRC=""
  if ./gradlew assembleRelease; then
    for candidate in \
      app/build/outputs/apk/release/app-release-unsigned.apk \
      app/build/outputs/apk/release/app-release.apk; do
      [ -f "$candidate" ] && APK_SRC="$candidate" && break
    done
  else
    echo " Release build failed, trying assembleDebug..."
    ./gradlew assembleDebug
    APK_SRC=app/build/outputs/apk/debug/app-debug.apk
    APK_LABEL=debug
  fi

  cd ../..
  cp "android-app/android/$APK_SRC" dist/AphroArchive.apk
  echo " done: dist/AphroArchive.apk  ($APK_LABEL)"
  echo
fi

# ============================================================
# Firefox Extension
# ============================================================
echo "[firefox] Packaging Firefox extension..."
rm -f dist/AphroArchive-firefox.xpi
(cd browser-extension && zip -r ../dist/AphroArchive-firefox.xpi .)
echo " done: dist/AphroArchive-firefox.xpi"
echo

# ============================================================
# Summary
# ============================================================
echo "============================================================"
echo " Build complete. Outputs in dist/:"
echo
[ -f dist/AphroArchive.exe          ] && echo "   AphroArchive.exe            Windows x64"
[ -f dist/AphroArchive-linux        ] && echo "   AphroArchive-linux          Linux x64"
[ -f dist/AphroArchive-mac.zip          ] && echo "   AphroArchive-mac.zip            macOS (arm64 + x64)"
[ -f dist/AphroArchive.apk              ] && echo "   AphroArchive.apk                Android"
[ -f dist/AphroArchive-firefox.xpi      ] && echo "   AphroArchive-firefox.xpi        Firefox extension"
echo "============================================================"
echo

# ============================================================
# Publish to GitHub Releases
# ============================================================
if [ "$DO_PUBLISH" -eq 1 ]; then
  echo "[publish] Publishing to GitHub Releases..."

  if ! command -v gh >/dev/null 2>&1; then
    echo " FAILED: GitHub CLI (gh) not found. Install from https://cli.github.com/ and run 'gh auth login'." >&2
    exit 1
  fi

  APP_VERSION="$(node -p "require('./package.json').version")"
  [ -n "$APP_VERSION" ] || { echo " FAILED: could not read version from package.json" >&2; exit 1; }
  TAG="v$APP_VERSION"
  echo "  Release tag: $TAG"

  ASSETS=()
  for f in \
    dist/AphroArchive.exe \
    dist/AphroArchive-linux \
    dist/AphroArchive-mac.dmg \
    dist/AphroArchive-mac.zip \
    dist/AphroArchive.apk \
    dist/AphroArchive-firefox.xpi; do
    [ -f "$f" ] && ASSETS+=("$f")
  done
  for f in dist/electron/*.exe; do
    [ -f "$f" ] && ASSETS+=("$f")
  done

  if [ "${#ASSETS[@]}" -eq 0 ]; then
    echo " FAILED: no build artifacts found in dist/" >&2
    exit 1
  fi

  if gh release view "$TAG" >/dev/null 2>&1; then
    echo "  Release $TAG already exists; updating assets..."
  else
    echo "  Creating release $TAG..."
    gh release create "$TAG" --title "AphroArchive $TAG" --notes "Automated build of AphroArchive $TAG"
  fi

  echo "  Uploading assets..."
  gh release upload "$TAG" "${ASSETS[@]}" --clobber
  echo " done: published $TAG to GitHub Releases"
  echo
fi
