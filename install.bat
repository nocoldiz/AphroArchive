@echo off
setlocal enabledelayedexpansion
title AphroArchive — installer
cd /d "%~dp0"

echo.
echo  AphroArchive installer
echo  =====================
echo.

:: ── 1. Node.js ───────────────────────────────────────────────────────────────
echo [1/6] Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo  Node.js not found. Attempting install via winget...
    winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        echo.
        echo  [ERROR] Could not install Node.js automatically.
        echo  Please install it manually from: https://nodejs.org
        pause
        exit /b 1
    )
    :: Refresh PATH so node is available in this session
    for /f "tokens=*" %%i in ('where node 2^>nul') do set "NODE_PATH=%%i"
    if "!NODE_PATH!"=="" (
        echo  Node.js installed. Please RESTART this installer so the PATH is refreshed.
        pause
        exit /b 0
    )
)
for /f "tokens=*" %%v in ('node --version 2^>nul') do echo  Node.js %%v  OK





:: ── 3. npm install (dev deps for building) ───────────────────────────────────
echo.
echo [3/6] Running npm install...
call npm install
if errorlevel 1 (
    echo  [ERROR] npm install failed.
    pause
    exit /b 1
)
echo  npm install  OK



:: ── 6. ffmpeg + ffprobe ──────────────────────────────────────────────────────
echo.
echo [6/6] Checking ffmpeg...
if exist "ffmpeg.exe" if exist "ffprobe.exe" (
    echo  ffmpeg.exe + ffprobe.exe already present  OK
)

:: Try winget first (adds to system PATH, server falls back to PATH)
where ffmpeg >nul 2>&1
if not errorlevel 1 (
    echo  ffmpeg already on PATH  OK
)

echo  Downloading ffmpeg from BtbN builds (this may take a minute)...
powershell -NoProfile -Command ^
    "$url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';" ^
    "$zip = 'ffmpeg_tmp.zip';" ^
    "try {" ^
    "    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing;" ^
    "    Expand-Archive $zip -DestinationPath 'ffmpeg_tmp' -Force;" ^
    "    $bin = Get-ChildItem 'ffmpeg_tmp' -Recurse -Filter 'ffmpeg.exe' | Select-Object -First 1;" ^
    "    Copy-Item $bin.FullName '.';" ^
    "    $bin2 = Get-ChildItem 'ffmpeg_tmp' -Recurse -Filter 'ffprobe.exe' | Select-Object -First 1;" ^
    "    Copy-Item $bin2.FullName '.';" ^
    "    Remove-Item $zip, 'ffmpeg_tmp' -Recurse -Force;" ^
    "    Write-Host '  ffmpeg + ffprobe downloaded  OK'" ^
    "} catch { Write-Host '[WARN] ffmpeg download failed — thumbnails and duration detection will not work.'; Remove-Item $zip,'ffmpeg_tmp' -Recurse -Force -ErrorAction SilentlyContinue }"



:done
echo.
echo  ─────────────────────────────────────────────────────────────
echo   All done!  Run start.bat to launch AphroArchive.
echo  ─────────────────────────────────────────────────────────────
echo.
pause
