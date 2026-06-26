@echo off
setlocal EnableDelayedExpansion

echo.
echo  ==========================================
echo   AphroArchive Installer
echo  ==========================================
echo.
echo   Node + ffmpeg + yt-dlp — everything needed to run the server
echo.
echo  ------------------------------------------

set ERRORS=0

REM ─── Node.js ─────────────────────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo  [WARN] node.js not found. Install from https://nodejs.org
    set ERRORS=1
) else (
    for /f "tokens=*" %%v in ('node --version 2^>nul') do echo  [OK]   node.js %%v
)

REM ─── npm install ─────────────────────────────────────────────────────
echo  [INFO] Running npm install...
call npm install --silent
if errorlevel 1 (
    echo  [WARN] npm install reported errors
) else (
    echo  [OK]   npm dependencies installed
)

REM ─── FFmpeg / FFprobe ────────────────────────────────────────────────
where ffmpeg >nul 2>&1
if not errorlevel 1 (
    echo  [OK]   ffmpeg found in PATH
) else if exist ffmpeg.exe (
    echo  [OK]   ffmpeg.exe found in project root
) else (
    echo  [INFO] Downloading ffmpeg static build...
    if not exist cache mkdir cache
    curl -fsSL -o cache\ffmpeg.zip "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" 2>nul
    if exist cache\ffmpeg.zip (
        echo  [INFO] Extracting ffmpeg.exe and ffprobe.exe...
        powershell -NoProfile -Command ^
            "Expand-Archive -Path 'cache\ffmpeg.zip' -DestinationPath 'cache\ffmpeg-tmp' -Force;" ^
            "$bins = Get-ChildItem 'cache\ffmpeg-tmp' -Recurse -Filter '*.exe'" ^
            "| Where-Object { $_.Name -in @('ffmpeg.exe','ffprobe.exe') } | Select-Object -First 2;" ^
            "$bins | ForEach-Object { Copy-Item $_.FullName '.' -Force };" ^
            "Remove-Item 'cache\ffmpeg-tmp' -Recurse -Force;" ^
            "Remove-Item 'cache\ffmpeg.zip' -Force"
        if exist ffmpeg.exe (
            echo  [OK]   ffmpeg.exe extracted to project root
        ) else (
            echo  [WARN] ffmpeg extraction failed. Place ffmpeg.exe + ffprobe.exe in the project folder.
            set ERRORS=1
        )
    ) else (
        echo  [WARN] ffmpeg download failed. Place ffmpeg.exe + ffprobe.exe in the project folder.
        set ERRORS=1
    )
)

REM ─── yt-dlp ──────────────────────────────────────────────────────────
where yt-dlp >nul 2>&1
if not errorlevel 1 (
    echo  [OK]   yt-dlp found in PATH
) else if exist cache\yt-dlp.exe (
    echo  [OK]   yt-dlp.exe found in cache\
) else (
    if not exist cache mkdir cache
    echo  [INFO] Downloading yt-dlp...
    curl -fsSL -o cache\yt-dlp.exe "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" 2>nul
    if exist cache\yt-dlp.exe (
        echo  [OK]   yt-dlp.exe downloaded to cache\
    ) else (
        echo  [WARN] yt-dlp download failed. Get it from https://github.com/yt-dlp/yt-dlp/releases
        set ERRORS=1
    )
)

echo  ------------------------------------------
echo.
if !ERRORS! == 0 (
    echo  All dependencies installed successfully.
) else (
    echo  Some steps had warnings — see above.
)
echo.
echo   Start:  node server.js
echo   Dev:    npm run dev          ^(Vite frontend hot-reload^)
echo   Build:  npm run build:win    ^(standalone AphroArchive.exe^)
echo.
pause
