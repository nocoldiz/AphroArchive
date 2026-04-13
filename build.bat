@echo off
setlocal EnableDelayedExpansion

:menu
cls
echo ==========================================
echo       AphroArchive Build Menu
echo ==========================================
echo.
echo Please select a target platform:
echo   1. Windows (x64 exe)
echo   2. macOS   (arm64 ^& x64 .app bundle)
echo   3. Linux   (x64 binary)
echo   4. All Platforms
echo   5. Exit
echo.
set /p choice="Enter your choice (1-5): "

if "%choice%"=="1" ( call :do_win & pause & goto menu )
if "%choice%"=="2" ( call :do_mac & pause & goto menu )
if "%choice%"=="3" ( call :do_linux & pause & goto menu )
if "%choice%"=="4" ( call :do_win & call :do_mac & call :do_linux & pause & goto menu )
if "%choice%"=="5" exit /b 0
goto menu

:: ────────────────────────────────────────────────────────────────────────────
:: Prerequisite Check
:: ────────────────────────────────────────────────────────────────────────────
:check_pkg
where pkg >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo Installing @yao-pkg/pkg...
  call npm install
  set PKG=npx pkg
) else (
  set PKG=npx pkg
)

if not exist dist mkdir dist
exit /b 0

:: ────────────────────────────────────────────────────────────────────────────
:: WINDOWS BUILD
:: ────────────────────────────────────────────────────────────────────────────
:do_win
echo.
echo ==========================================
echo Building AphroArchive for Windows...
echo ==========================================
call :check_pkg

%PKG% . --targets node20-win-x64 --output dist\AphroArchive.exe --compress GZip

if %ERRORLEVEL% EQU 0 (
  echo.
  echo  ✓ Build successful: dist\AphroArchive.exe
  echo.
  echo  To use thumbnails, place ffmpeg.exe and ffprobe.exe next to the exe.
  echo  Download from: https://www.gyan.dev/ffmpeg/builds/
) else (
  echo  Build failed for Windows.
)
exit /b 0

:: ────────────────────────────────────────────────────────────────────────────
:: LINUX BUILD
:: ────────────────────────────────────────────────────────────────────────────
:do_linux
echo.
echo ==========================================
echo Building AphroArchive for Linux (x64)...
echo ==========================================
call :check_pkg

%PKG% . --targets node20-linux-x64 --output dist\AphroArchive-linux --compress GZip

if %ERRORLEVEL% EQU 0 (
  echo.
  echo  ✓ Build successful: dist\AphroArchive-linux
  echo.
  echo  To use thumbnails, place ffmpeg and ffprobe next to the binary.
  echo  Note: Run 'chmod +x AphroArchive-linux' before executing on Linux.
) else (
  echo  Build failed for Linux.
)
exit /b 0

:: ────────────────────────────────────────────────────────────────────────────
:: MACOS BUILD
:: ────────────────────────────────────────────────────────────────────────────
:do_mac
echo.
echo ==========================================
echo Building AphroArchive for macOS...
echo ==========================================
call :check_pkg

echo [1/4] Building Apple Silicon (arm64)...
%PKG% . --targets node20-macos-arm64 --output dist\AphroArchive-arm64 --compress GZip
if %ERRORLEVEL% NEQ 0 ( echo Build failed ^(arm64^). & exit /b 1 )

echo [2/4] Building Intel (x64)...
%PKG% . --targets node20-macos-x64 --output dist\AphroArchive-x64 --compress GZip
if %ERRORLEVEL% NEQ 0 ( echo Build failed ^(x64^). & exit /b 1 )

echo [3/4] Creating package structure...
set STAGE=dist\mac-stage
if exist "%STAGE%" rmdir /s /q "%STAGE%"
mkdir "%STAGE%"
mkdir "%STAGE%\AphroArchive.app\Contents\MacOS"
mkdir "%STAGE%\AphroArchive.app\Contents\Resources"

:: Copy binaries into staging root
copy dist\AphroArchive-arm64 "%STAGE%\AphroArchive-arm64" >nul
copy dist\AphroArchive-x64   "%STAGE%\AphroArchive-x64"   >nul

:: -- Info.plist
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

:: -- Launcher shell script
powershell -NoProfile -Command ^
  "$s = @'" ^& ^
  "#!/bin/bash" ^& ^
  "set -e" ^& ^
  "# Resolve the folder that contains both this .app and the binaries" ^& ^
  "APP_DIR=""$(cd ""$(dirname ""$0"")/../../.."" ^&^& pwd)""" ^& ^
  "ARCH=$(uname -m)" ^& ^
  "if [ ""$ARCH"" = ""arm64"" ]; then BIN=""$APP_DIR/AphroArchive-arm64""; else BIN=""$APP_DIR/AphroArchive-x64""; fi" ^& ^
  "chmod +x ""$BIN"" 2>/dev/null || true" ^& ^
  "exec ""$BIN"" ""$@""" ^& ^
  "'@; $s | Set-Content -Encoding UTF8 '%STAGE%\AphroArchive.app\Contents\MacOS\launcher'"

:: -- setup.sh
powershell -NoProfile -Command ^
  "$s = @'" ^& ^
  "#!/bin/bash" ^& ^
  "cd ""$(dirname ""$0"")""" ^& ^
  "echo Setting execute permissions..." ^& ^
  "chmod +x AphroArchive-arm64 AphroArchive-x64 AphroArchive.app/Contents/MacOS/launcher" ^& ^
  "echo Done! You can now double-click AphroArchive.app" ^& ^
  "echo (macOS may ask you to allow it in System Settings > Privacy ^& Security)" ^& ^
  "'@; $s | Set-Content -Encoding UTF8 '%STAGE%\setup.sh'"

:: -- README.txt
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

echo [4/4] Creating AphroArchive-mac.zip...
if exist dist\AphroArchive-mac.zip del dist\AphroArchive-mac.zip
powershell -NoProfile -Command "Compress-Archive -Path '%STAGE%\*' -DestinationPath 'dist\AphroArchive-mac.zip' -Force"

:: Cleanup staging
rmdir /s /q "%STAGE%"

echo.
echo  ✓ Build successful: dist\AphroArchive-mac.zip
echo.
echo  On the Mac, after unzipping:
echo    1. Open Terminal ^& run:  bash setup.sh
echo    2. Double-click AphroArchive.app
echo.
echo  If macOS blocks it: System Settings ^> Privacy ^& Security ^> Allow
echo  Or run: xattr -cr AphroArchive.app
echo.
exit /b 0