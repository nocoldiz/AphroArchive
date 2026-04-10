@echo off
setlocal EnableDelayedExpansion
echo Building AphroArchive for macOS...
echo.

if not exist dist mkdir dist

:: ── Build both architectures ────────────────────────────────────────────────
echo [1/4] Building Apple Silicon (arm64)...
npx pkg . --targets node20-macos-arm64 --output dist\AphroArchive-arm64 --compress GZip
if %ERRORLEVEL% NEQ 0 ( echo Build failed ^(arm64^). & exit /b 1 )

echo [2/4] Building Intel (x64)...
npx pkg . --targets node20-macos-x64 --output dist\AphroArchive-x64 --compress GZip
if %ERRORLEVEL% NEQ 0 ( echo Build failed ^(x64^). & exit /b 1 )

:: ── Create staging folder ───────────────────────────────────────────────────
echo [3/4] Creating package structure...
set STAGE=dist\mac-stage
if exist "%STAGE%" rmdir /s /q "%STAGE%"
mkdir "%STAGE%"
mkdir "%STAGE%\AphroArchive.app\Contents\MacOS"
mkdir "%STAGE%\AphroArchive.app\Contents\Resources"

:: Copy binaries into staging root (they live next to the .app so data dirs are shared)
copy dist\AphroArchive-arm64 "%STAGE%\AphroArchive-arm64" >nul
copy dist\AphroArchive-x64   "%STAGE%\AphroArchive-x64"   >nul

:: ── Info.plist ──────────────────────────────────────────────────────────────
powershell -NoProfile -Command ^
  "$p = @'" ^& ^
  "<?xml version=""1.0"" encoding=""UTF-8""?>" ^& ^
  "<!DOCTYPE plist PUBLIC ""-//Apple//DTD PLIST 1.0//EN"" ""http://www.apple.com/DTDs/PropertyList-1.0.dtd"">" ^& ^
  "<plist version=""1.0""><dict>" ^& ^
  "<key>CFBundleExecutable</key><string>launcher</string>" ^& ^
  "<key>CFBundleIdentifier</key><string>com.AphroArchive.app</string>" ^& ^
  "<key>CFBundleName</key><string>AphroArchive</string>" ^& ^
  "<key>CFBundleDisplayName</key><string>AphroArchive</string>" ^& ^
  "<key>CFBundleVersion</key><string>1.0.0</string>" ^& ^
  "<key>CFBundleShortVersionString</key><string>1.0</string>" ^& ^
  "<key>CFBundlePackageType</key><string>APPL</string>" ^& ^
  "<key>LSMinimumSystemVersion</key><string>11.0</string>" ^& ^
  "<key>NSHighResolutionCapable</key><true/>" ^& ^
  "</dict></plist>" ^& ^
  "'@; $p | Set-Content -Encoding UTF8 '%STAGE%\AphroArchive.app\Contents\Info.plist'"

:: ── Launcher shell script (goes inside .app/Contents/MacOS/) ────────────────
:: This script detects the arch, resolves the binary next to the .app, and runs it.
powershell -NoProfile -Command ^
  "$s = @'" ^& ^
  "#!/bin/bash" ^& ^
  "set -e" ^& ^
  "# Resolve the folder that contains both this .app and the binaries" ^& ^
  "APP_DIR=""$(cd ""$(dirname ""$0"")/../../.."" ^&^& pwd)""" ^& ^
  "ARCH=$(uname -m)" ^& ^
  "if [ ""$ARCH"" = ""arm64"" ]; then BIN=""$APP_DIR/AphroArchive-arm64""" ^& ^
  "else BIN=""$APP_DIR/AphroArchive-x64""; fi" ^& ^
  "chmod +x ""$BIN"" 2>/dev/null || true" ^& ^
  "exec ""$BIN"" ""$@""" ^& ^
  "'@; $s | Set-Content -Encoding UTF8 '%STAGE%\AphroArchive.app\Contents\MacOS\launcher'"

:: ── setup.sh — one-time chmod, run once after unzip ─────────────────────────
powershell -NoProfile -Command ^
  "$s = @'" ^& ^
  "#!/bin/bash" ^& ^
  "cd ""$(dirname ""$0"")""" ^& ^
  "echo Setting execute permissions..." ^& ^
  "chmod +x AphroArchive-arm64 AphroArchive-x64 AphroArchive.app/Contents/MacOS/launcher" ^& ^
  "echo Done! You can now double-click AphroArchive.app" ^& ^
  "echo (macOS may ask you to allow it in System Settings > Privacy ^& Security)" ^& ^
  "'@; $s | Set-Content -Encoding UTF8 '%STAGE%\setup.sh'"

:: ── README.txt ───────────────────────────────────────────────────────────────
powershell -NoProfile -Command ^
  "$r = @'" ^& ^
  "AphroArchive — macOS" ^& ^
  "===================" ^& ^
  "" ^& ^
  "QUICK START" ^& ^
  "-----------" ^& ^
  "1. Open Terminal and run:  bash setup.sh" ^& ^
  "   (only needed once after unzipping)" ^& ^
  "" ^& ^
  "2. Double-click AphroArchive.app" ^& ^
  "   Your browser will open automatically at http://localhost:3000" ^& ^
  "" ^& ^
  "3. Put your videos in the 'videos' folder next to AphroArchive.app" ^& ^
  "" ^& ^
  "THUMBNAILS (optional)" ^& ^
  "---------------------" ^& ^
  "Place ffmpeg and ffprobe next to AphroArchive.app." ^& ^
  "Download: https://evermeet.cx/ffmpeg/" ^& ^
  "After downloading, run:  chmod +x ffmpeg ffprobe" ^& ^
  "" ^& ^
  "COMMAND LINE" ^& ^
  "------------" ^& ^
  "  ./AphroArchive-arm64 [videos_folder] [port]   (Apple Silicon)" ^& ^
  "  ./AphroArchive-x64   [videos_folder] [port]   (Intel Mac)" ^& ^
  "" ^& ^
  "SECURITY NOTE" ^& ^
  "-------------" ^& ^
  "macOS may block the app on first launch. If so:" ^& ^
  "  System Settings > Privacy ^& Security > scroll down > click Allow" ^& ^
  "Or run:  xattr -cr AphroArchive.app" ^& ^
  "'@; $r | Set-Content -Encoding UTF8 '%STAGE%\README.txt'"

:: ── Zip the staging folder ───────────────────────────────────────────────────
echo [4/4] Creating AphroArchive-mac.zip...
if exist dist\AphroArchive-mac.zip del dist\AphroArchive-mac.zip
powershell -NoProfile -Command "Compress-Archive -Path '%STAGE%\*' -DestinationPath 'dist\AphroArchive-mac.zip' -Force"

:: Cleanup staging
rmdir /s /q "%STAGE%"

echo.
echo  ✓  dist\AphroArchive-mac.zip
echo.
echo  On the Mac, after unzipping:
echo    1. Open Terminal ^& run:  bash setup.sh
echo    2. Double-click AphroArchive.app
echo.
echo  If macOS blocks it: System Settings ^> Privacy ^& Security ^> Allow
echo  Or run: xattr -cr AphroArchive.app
echo.
