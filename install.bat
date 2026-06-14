@echo off
setlocal EnableDelayedExpansion
echo ===================================
echo  AphroArchive Dependency Installer
echo ===================================
echo.

set ERRORS=0

REM ─── Node.js ─────────────────────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo [WARN] node.js not found. Install from https://nodejs.org
    set ERRORS=1
) else (
    echo [OK] node.js found
)

REM ─── npm install ─────────────────────────────────────────────────────
echo [INFO] Running npm install...
call npm install --silent
if errorlevel 1 (
    echo [WARN] npm install reported errors
) else (
    echo [OK] npm dependencies installed
)

REM ─── FFmpeg / FFprobe ────────────────────────────────────────────────
where ffmpeg >nul 2>&1
if not errorlevel 1 (
    echo [OK] ffmpeg found in PATH
) else (
    if exist ffmpeg.exe (
        echo [OK] ffmpeg.exe found in project root
    ) else (
        echo [INFO] ffmpeg not found. Downloading static build...
        if not exist cache mkdir cache
        echo        Downloading ffmpeg from https://www.gyan.dev/ffmpeg/builds/ ...
        curl -L -o cache\ffmpeg.zip "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" 2>nul
        if exist cache\ffmpeg.zip (
            echo        Extracting ffmpeg.exe and ffprobe.exe ...
            powershell -NoProfile -Command "Expand-Archive -Path 'cache\ffmpeg.zip' -DestinationPath 'cache\ffmpeg-tmp' -Force; $d = (Get-ChildItem 'cache\ffmpeg-tmp' -Filter '*.exe' -Recurse | Where-Object {$_.Name -in 'ffmpeg.exe','ffprobe.exe'} | Select-Object -First 2); $d | ForEach-Object { Copy-Item $_.FullName '.' -Force }; Remove-Item 'cache\ffmpeg-tmp' -Recurse -Force; Remove-Item 'cache\ffmpeg.zip' -Force"
            if exist ffmpeg.exe (
                echo [OK] ffmpeg.exe extracted to project root
            ) else (
                echo [WARN] ffmpeg extraction failed. Place ffmpeg.exe and ffprobe.exe in the project folder or add to PATH.
                set ERRORS=1
            )
        ) else (
            echo [WARN] Could not download ffmpeg. Place ffmpeg.exe and ffprobe.exe in the project folder or add to PATH.
            set ERRORS=1
        )
    )
)

REM ─── yt-dlp ──────────────────────────────────────────────────────────
where yt-dlp >nul 2>&1
if not errorlevel 1 (
    echo [OK] yt-dlp found in PATH
) else (
    if not exist cache mkdir cache
    if exist cache\yt-dlp.exe (
        echo [OK] yt-dlp.exe found in cache\
    ) else (
        echo [INFO] Downloading yt-dlp...
        curl -L -o cache\yt-dlp.exe "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" 2>nul
        if exist cache\yt-dlp.exe (
            echo [OK] yt-dlp.exe downloaded to cache\
        ) else (
            echo [WARN] yt-dlp download failed. Download from https://github.com/yt-dlp/yt-dlp/releases
            set ERRORS=1
        )
    )
)

REM ─── Python ──────────────────────────────────────────────────────────
where python >nul 2>&1
if errorlevel 1 (
    where python3 >nul 2>&1
    if errorlevel 1 (
        set PYTHON_CMD=
    ) else (
        set PYTHON_CMD=python3
    )
) else (
    set PYTHON_CMD=python
)

REM ─── Whisper ─────────────────────────────────────────────────────────
where whisper >nul 2>&1
if not errorlevel 1 (
    echo [OK] whisper found in PATH
) else (
    if "!PYTHON_CMD!"=="" (
        echo [WARN] Python not found. Cannot install Whisper automatically.
        echo        Install Python 3.8+ from https://www.python.org then run:
        echo            pip install openai-whisper
        set ERRORS=1
    ) else (
        echo [INFO] Installing openai-whisper via pip ^(this may take a while^)...
        echo        This requires ~2 GB for models downloaded on first use.
        !PYTHON_CMD! -m pip install openai-whisper --quiet
        if not errorlevel 1 (
            where whisper >nul 2>&1
            if not errorlevel 1 (
                echo [OK] whisper installed and available in PATH
            ) else (
                echo [OK] openai-whisper installed. You may need to add Python Scripts to PATH.
                echo        Typical location: %APPDATA%\Python\PythonXX\Scripts
            )
        ) else (
            echo [WARN] whisper installation failed. Try manually: pip install openai-whisper
            set ERRORS=1
        )
    )
)

REM ─── Pre-download Whisper base model ────────────────────────────────
if not "!PYTHON_CMD!"=="" (
    where whisper >nul 2>&1
    if not errorlevel 1 (
        echo [INFO] Pre-downloading Whisper base model ~^(~139 MB^)...
        !PYTHON_CMD! -c "import whisper; whisper.load_model('base')"
        if not errorlevel 1 (
            echo [OK] Whisper base model ready
        ) else (
            echo [WARN] Base model pre-download failed. Will download automatically on first use.
        )
    )
)

echo.
if !ERRORS! == 0 (
    echo All dependencies installed successfully.
) else (
    echo Some dependencies could not be installed automatically. See warnings above.
)
echo.
echo Start the server with: node server.js
echo.
pause
