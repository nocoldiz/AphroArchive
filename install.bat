@echo off
setlocal EnableDelayedExpansion

echo.
echo  ==========================================
echo   AphroArchive Installer
echo  ==========================================
echo.
echo   1  Minimal  ^|  Node + ffmpeg + yt-dlp
echo              ^|  Everything needed to run the server
echo.
echo   2  Full     ^|  Minimal + Python + Whisper + base model
echo              ^|  AI subtitles, dev server, standalone build
echo.

REM ─── Accept mode from command-line arg ──────────────────────────────
set INSTALL_MODE=
set ARG=%~1
if /i "!ARG!"=="minimal" ( set INSTALL_MODE=1 & goto :start )
if /i "!ARG!"=="full"    ( set INSTALL_MODE=2 & goto :start )
if "!ARG!"=="1"          ( set INSTALL_MODE=1 & goto :start )
if "!ARG!"=="2"          ( set INSTALL_MODE=2 & goto :start )

:ask
set /p INSTALL_MODE=  Choose [1/2]:
if "!INSTALL_MODE!"=="1" goto :start
if "!INSTALL_MODE!"=="2" goto :start
echo   Please enter 1 or 2.
goto :ask

:start
echo.
if "!INSTALL_MODE!"=="1" (
    echo  [MODE] Minimal — run only
) else (
    echo  [MODE] Full — AI subtitles + dev build
)
echo  ------------------------------------------

set ERRORS=0
set PYTHON_CMD=

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

REM ─── Minimal done — skip Whisper ─────────────────────────────────────
if "!INSTALL_MODE!"=="1" goto :done

REM ════════════════════════════════════════════════════════════════════
REM  Full mode — Python + Whisper + base model
REM ════════════════════════════════════════════════════════════════════

REM ─── Python ──────────────────────────────────────────────────────────
where python >nul 2>&1
if not errorlevel 1 (
    set PYTHON_CMD=python
    for /f "tokens=*" %%v in ('python --version 2^>^&1') do echo  [OK]   %%v
) else (
    where python3 >nul 2>&1
    if not errorlevel 1 (
        set PYTHON_CMD=python3
        for /f "tokens=*" %%v in ('python3 --version 2^>^&1') do echo  [OK]   %%v
    ) else (
        echo  [WARN] Python not found. Install Python 3.8+ from https://www.python.org
        echo         Whisper requires Python — skipping Whisper setup.
        set ERRORS=1
        goto :done
    )
)

REM ─── Whisper ─────────────────────────────────────────────────────────
where whisper >nul 2>&1
if not errorlevel 1 (
    echo  [OK]   whisper found in PATH
) else (
    echo  [INFO] Installing openai-whisper via pip ^(this may take a while^)...
    !PYTHON_CMD! -m pip install openai-whisper --quiet
    if not errorlevel 1 (
        echo  [OK]   openai-whisper installed
        where whisper >nul 2>&1
        if errorlevel 1 (
            echo  [NOTE] Add Python Scripts to PATH if the whisper command is not found later.
            echo         Typical location: %APPDATA%\Python\PythonXX\Scripts
        )
    ) else (
        echo  [WARN] Whisper install failed. Try manually: pip install openai-whisper
        set ERRORS=1
        goto :done
    )
)

REM ─── Pre-download Whisper base model (~139 MB) ────────────────────────
echo  [INFO] Pre-downloading Whisper base model ^(~139 MB^)...
!PYTHON_CMD! -c "import whisper; whisper.load_model('base')"
if not errorlevel 1 (
    echo  [OK]   Whisper base model ready
) else (
    echo  [WARN] Base model pre-download failed — it will download on first subtitle generation.
)

:done
echo  ------------------------------------------
echo.
if !ERRORS! == 0 (
    echo  All dependencies installed successfully.
) else (
    echo  Some steps had warnings — see above.
)
echo.
echo   Start:  node server.js
if "!INSTALL_MODE!"=="2" (
    echo   Dev:    npm run dev          ^(Vite frontend hot-reload^)
    echo   Build:  npm run build:win    ^(standalone AphroArchive.exe^)
    echo.
    echo   Whisper models beyond "base" can be downloaded from
    echo   Settings ^> AI ^> Whisper Subtitles.
)
echo.
if "!INSTALL_MODE!"=="1" (
    echo   Optional: run "install.bat full" to also set up Whisper AI subtitles.
    echo.
)
pause
