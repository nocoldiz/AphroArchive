@echo off
setlocal enabledelayedexpansion
title AphroArchive — installer
cd /d "%~dp0"

echo.
echo  AphroArchive installer
echo  =====================
echo.

:: ── Install mode menu ─────────────────────────────────────────────────
echo  Choose install mode:
echo.
echo    [1] Full install (recommended)
echo         Installs ALL dependencies including dev/build tools (vite,
echo         TypeScript, pkg, etc.) — needed for development and building
echo         executable packages.
echo.
echo    [2] Minimal install
echo         Installs only runtime dependencies required to run the
echo         server (Preact, better-sqlite3, etc.). Skips optional LLM
echo         module and dev/build tools. Faster and uses less disk space.
echo.
set /p INSTALL_MODE="Enter choice (1 or 2): "
if not defined INSTALL_MODE set INSTALL_MODE=1
echo.
if "%INSTALL_MODE%"=="2" (
    echo  Minimal mode selected — will skip optional and dev dependencies.
) else (
    echo  Full mode selected — installing all dependencies.
)
echo.

:: ── 1. Git pull ──────────────────────────────────────────────────────────────
echo [1/7] Fetching latest code from GitHub...
git pull
if errorlevel 1 (
    echo  [WARN] Git pull failed, continuing anyway...
) else (
    echo  Git pull  OK
)
echo.

:: ── 2. Node.js ───────────────────────────────────────────────────────────────
echo [2/7] Checking Node.js...
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





:: ── 3. Clean cache and node_modules ──────────────────────────────────────────
echo.
echo [3/7] Cleaning npm cache and node_modules...
if exist "node_modules" (
    echo  Removing node_modules...
    rmdir /s /q node_modules
    echo  node_modules removed
)
echo  Cleaning npm cache...
call npm cache clean --force 2>&1
echo  npm cache cleaned  OK
echo.

:: ── 4. npm install ──────────────────────────────────────────────────────────
if "%INSTALL_MODE%"=="2" (
    echo [4/7] Running npm install (minimal — runtime deps only)...
    echo  Installing: better-sqlite3 preact @preact/signals
    echo  --------------------------------------------
    call npm install better-sqlite3 preact @preact/signals --loglevel verbose 2>&1
) else (
    echo [4/7] Running npm install (full — all dependencies)...
    echo  Starting npm install — this may take a while...
    echo  --------------------------------------------
    call npm install --loglevel verbose 2>&1
)
if errorlevel 1 (
    echo.
    echo  [ERROR] npm install failed.
    echo  Check the log above for details about what went wrong.
    pause
    exit /b 1
)
echo  --------------------------------------------
echo  npm install  OK
echo.



:: ── 7. ffmpeg + ffprobe ──────────────────────────────────────────────────────
echo.
echo [7/7] Checking ffmpeg...
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
