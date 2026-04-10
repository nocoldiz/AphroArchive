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


:: ── 2. Python ────────────────────────────────────────────────────────────────
echo.
echo [2/6] Checking Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo  Python not found. Attempting install via winget...
    winget install Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        echo.
        echo  [ERROR] Could not install Python automatically.
        echo  Please install it manually from: https://www.python.org/downloads
        echo  Make sure to check "Add Python to PATH" during setup.
        pause
        exit /b 1
    )
    echo  Python installed. Please RESTART this installer so the PATH is refreshed.
    pause
    exit /b 0
)
for /f "tokens=*" %%v in ('python --version 2^>nul') do echo  %%v  OK


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


:: ── 4. Python dependencies ───────────────────────────────────────────────────
echo.
echo [4/6] Installing Python dependencies...
python -m pip install --upgrade pip --quiet
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo  [ERROR] pip install failed. Make sure Python is on PATH and pip is available.
    pause
    exit /b 1
)
echo  Python deps  OK


:: ── 5. yt-dlp ────────────────────────────────────────────────────────────────
echo.
echo [5/6] Downloading yt-dlp...
if exist "yt-dlp.exe" (
    echo  yt-dlp.exe already present — checking for update...
    powershell -NoProfile -Command ^
        "try { Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile 'yt-dlp.exe' -UseBasicParsing; Write-Host '  yt-dlp updated  OK' } catch { Write-Host '  Could not update yt-dlp (offline?)  skipping' }"
) else (
    powershell -NoProfile -Command ^
        "try { Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile 'yt-dlp.exe' -UseBasicParsing; Write-Host '  yt-dlp downloaded  OK' } catch { Write-Host '[ERROR] Failed to download yt-dlp. Check internet connection.'; exit 1 }"
    if errorlevel 1 (
        echo  [WARN] yt-dlp download failed. Download queue will not work.
        echo  Manual download: https://github.com/yt-dlp/yt-dlp/releases/latest
    )
)


:: ── 6. ffmpeg + ffprobe ──────────────────────────────────────────────────────
echo.
echo [6/6] Checking ffmpeg...
if exist "ffmpeg.exe" if exist "ffprobe.exe" (
    echo  ffmpeg.exe + ffprobe.exe already present  OK
    goto :geckodriver
)

:: Try winget first (adds to system PATH, server falls back to PATH)
where ffmpeg >nul 2>&1
if not errorlevel 1 (
    echo  ffmpeg already on PATH  OK
    goto :geckodriver
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

:geckodriver
:: ── Optional: geckodriver (only needed for firefox_downloader.py) ────────────
echo.
echo [Optional] geckodriver for Firefox downloader...
if exist "geckodriver.exe" (
    echo  geckodriver.exe already present  OK
    goto :done
)
echo  Downloading geckodriver (needed only for Firefox-based downloading)...
powershell -NoProfile -Command ^
    "$api = Invoke-RestMethod 'https://api.github.com/repos/mozilla/geckodriver/releases/latest' -UseBasicParsing;" ^
    "$asset = $api.assets | Where-Object { $_.name -match 'win64.zip$' } | Select-Object -First 1;" ^
    "if ($asset) {" ^
    "    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile 'geckodriver_tmp.zip' -UseBasicParsing;" ^
    "    Expand-Archive 'geckodriver_tmp.zip' -DestinationPath '.' -Force;" ^
    "    Remove-Item 'geckodriver_tmp.zip' -Force;" ^
    "    Write-Host '  geckodriver downloaded  OK'" ^
    "} else { Write-Host '  [WARN] Could not find geckodriver asset — skip' }"

:done
echo.
echo  ─────────────────────────────────────────────────────────────
echo   All done!  Run start.bat to launch AphroArchive.
echo  ─────────────────────────────────────────────────────────────
echo.
pause
