@echo off
setlocal enabledelayedexpansion
title AphroArchive
cd /d "%~dp0"

set FORCE_INSTALL=0
if "%~1"=="--install" set FORCE_INSTALL=1

if exist "node_modules" if not "!FORCE_INSTALL!"=="1" goto :launch

:: ════════════════════════════════════════════════════════════
::  First Run Setup
:: ════════════════════════════════════════════════════════════
echo.
echo  AphroArchive — First Run Setup
echo  ==============================
echo.

echo  Choose install mode:
echo.
echo    [1] Minimal install (default)
echo         Installs only runtime dependencies (preact, signals).
echo         Skips LLM, image-gen, and all dev/build tools.
echo         Fastest option — no native compilation required.
echo.
echo    [2] Full install
echo         Installs ALL dependencies including dev/build tools (vite,
echo         TypeScript, pkg, etc.) and image-gen Python deps.
echo         Needed for development and building executable packages.
echo.

choice /c 12 /n /m "Enter choice (1 or 2) [Default 1]: " /t 10 /d 1
if errorlevel 2 (
    set INSTALL_MODE=2
    echo  Full mode selected — installing all dependencies.
) else (
    set INSTALL_MODE=1
    echo  Minimal mode selected — skipping optional and dev dependencies.
)
echo.

:: ── 1. Git pull ──────────────────────────────────────────────────────────────
echo [1/5] Fetching latest code from GitHub...
git pull && echo   OK || echo  [WARN] Git pull failed, continuing anyway...
echo.

:: ── 2. Node.js ───────────────────────────────────────────────────────────────
echo [2/5] Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo  Node.js not found. Attempting install via winget...
    winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        echo.
        echo  [ERROR] Could not install Node.js automatically.
        echo  Please install Node.js 22 or newer from: https://nodejs.org
        pause
        exit /b 1
    )
    echo  Refreshing environment variables...
    for /f "tokens=2*" %%A in ('reg query "HKLM\System\CurrentControlSet\Control\Session Manager\Environment" /v Path') do set "syspath=%%B"
    for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "userpath=%%B"
    set "PATH=!syspath!;!userpath!"
)

node --version >nul 2>&1 || (
    echo  [ERROR] Node.js still not available. Please restart.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -e "process.stdout.write(process.versions.node)"') do set NODE_VER=%%v
for /f "tokens=1 delims=." %%m in ("!NODE_VER!") do set NODE_MAJOR_SETUP=%%m
if !NODE_MAJOR_SETUP! LSS 22 (
    echo.
    echo  [ERROR] Node.js 22 or newer is required ^(found v!NODE_VER!^).
    echo  node:sqlite is a built-in module available from Node 22.5+.
    echo  Please update from: https://nodejs.org
    pause
    exit /b 1
)
echo  Node.js v!NODE_VER!  OK
echo.

:: ── 3. npm install ───────────────────────────────────────────────────────────
if "!INSTALL_MODE!"=="1" (
    echo [3/5] Running npm install ^(minimal — runtime deps only^)...
    echo  Skips: node-llama-cpp, Capacitor, Vite, TypeScript, pkg
    echo  --------------------------------------------
    call npm install --omit=optional --omit=dev --loglevel verbose && echo  npm install  OK || (
        echo.
        echo  [ERROR] npm install failed.
        pause
        exit /b 1
    )
) else (
    echo [3/5] Running npm install ^(full — all dependencies^)...
    echo  Note: node-llama-cpp ^(LLM^) will be skipped — install separately if needed.
    echo  --------------------------------------------
    call npm install --omit=optional --loglevel verbose && echo  npm install  OK || (
        echo.
        echo  [ERROR] npm install failed.
        pause
        exit /b 1
    )
)
echo  --------------------------------------------
echo.

:: ── 4. Image generation (full only) ──────────────────────────────────────────
if not "!INSTALL_MODE!"=="2" (
    echo [4/5] Image generation — skipped ^(minimal mode^).
    goto :skip_imagegen
)

echo [4/5] Image generation ^(Python / diffusers^)...
python --version >nul 2>&1
if errorlevel 1 (
    echo  [SKIP] Python not found — skipping image generation setup.
    echo         Install Python 3.10+ and re-run:  pip install -r imagegen\requirements.txt
    goto :skip_imagegen
)

echo.
echo  Choose PyTorch variant for image generation:
echo.
echo    [1] NVIDIA GPU  ^(CUDA 12.1 — recommended if you have an NVIDIA card^)
echo    [2] CPU only    ^(slower, no GPU required^)
echo    [3] Skip        ^(install later manually^)
echo.

choice /c 123 /n /m "Enter choice (1, 2, or 3) [Default 3]: " /t 10 /d 3
if errorlevel 3 ( set TORCH_MODE=3 ) else if errorlevel 2 ( set TORCH_MODE=2 ) else ( set TORCH_MODE=1 )
echo.

if "!TORCH_MODE!"=="1" (
    pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121 && echo  PyTorch ^(CUDA^)  OK || goto :skip_imagegen
) else if "!TORCH_MODE!"=="2" (
    pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu && echo  PyTorch ^(CPU^)  OK || goto :skip_imagegen
) else (
    echo  Skipping PyTorch — run manually later.
    goto :skip_imagegen
)
pip install -r imagegen\requirements.txt && echo  Image gen deps  OK || echo  [WARN] Some image gen packages failed to install.

:skip_imagegen
echo.

:: ── 5. ffmpeg + ffprobe ──────────────────────────────────────────────────────
echo [5/5] Checking ffmpeg...
if exist "ffmpeg.exe" if exist "ffprobe.exe" (
    echo  ffmpeg.exe + ffprobe.exe already present  OK
    goto :setup_done
)
where ffmpeg >nul 2>&1
if not errorlevel 1 (
    echo  ffmpeg already on PATH  OK
    goto :setup_done
)

echo  Downloading ffmpeg from BtbN builds (this may take a minute)...
echo $url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip' > dl_ffmpeg.ps1
echo $zip = 'ffmpeg_tmp.zip' >> dl_ffmpeg.ps1
echo try { >> dl_ffmpeg.ps1
echo     Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing >> dl_ffmpeg.ps1
echo     Expand-Archive $zip -DestinationPath 'ffmpeg_tmp' -Force >> dl_ffmpeg.ps1
echo     Get-ChildItem 'ffmpeg_tmp' -Recurse -Filter 'ffmpeg.exe' ^| Select-Object -First 1 ^| Copy-Item -Destination '.' >> dl_ffmpeg.ps1
echo     Get-ChildItem 'ffmpeg_tmp' -Recurse -Filter 'ffprobe.exe' ^| Select-Object -First 1 ^| Copy-Item -Destination '.' >> dl_ffmpeg.ps1
echo     Remove-Item $zip, 'ffmpeg_tmp' -Recurse -Force >> dl_ffmpeg.ps1
echo     Write-Host '  ffmpeg + ffprobe downloaded  OK' >> dl_ffmpeg.ps1
echo } catch { >> dl_ffmpeg.ps1
echo     Write-Host '[WARN] ffmpeg download failed — thumbnails and duration detection will not work.' >> dl_ffmpeg.ps1
echo     Remove-Item $zip,'ffmpeg_tmp' -Recurse -Force -ErrorAction SilentlyContinue >> dl_ffmpeg.ps1
echo } >> dl_ffmpeg.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File dl_ffmpeg.ps1
del dl_ffmpeg.ps1

:setup_done
echo.
echo  ─────────────────────────────────────────────────────────────
echo   Setup complete!  Starting AphroArchive...
echo  ─────────────────────────────────────────────────────────────
echo.

:: ════════════════════════════════════════════════════════════
::  Launch
:: ════════════════════════════════════════════════════════════
:launch
start "" http://localhost:3000
for /f "tokens=1 delims=." %%v in ('node -e "process.stdout.write(process.versions.node)"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 22 (
    echo [ERROR] Node.js 22.5 or newer is required.
    echo Please update from https://nodejs.org
    pause
    exit /b 1
)
if %NODE_MAJOR% LSS 23 (
    node --experimental-sqlite server.js
) else (
    node server.js
)
