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
echo    [1] Minimal install (default)
echo         Installs only runtime dependencies required to run the
echo         server (Preact, better-sqlite3, etc.). Skips optional LLM
echo         module and dev/build tools. Faster and uses less disk space.
echo.
echo    [2] Full install
echo         Installs ALL dependencies including dev/build tools (vite,
echo         TypeScript, pkg, etc.) — needed for development and building
echo         executable packages.
echo.
set /p INSTALL_MODE="Enter choice (1 or 2): "
if not defined INSTALL_MODE set INSTALL_MODE=1
echo.
if "%INSTALL_MODE%"=="1" (
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
npm cache clean --force
echo  npm cache cleaned  OK
echo.

 :: ── 4. npm install ──────────────────────────────────────────────────────────
if "%INSTALL_MODE%"=="1" (
    echo [4/7] Running npm install (minimal — runtime deps only)...
    echo  Installing preact, @preact/signals, better-sqlite3...
    echo  (better-sqlite3 is a native module — first install may take a minute)
    echo  --------------------------------------------
    npm install preact @preact/signals better-sqlite3 --omit=optional --loglevel verbose
    if errorlevel 1 (
        echo.
        echo  [ERROR] Failed to install core dependencies.
        pause
        exit /b 1
    )
) else (
    echo [4/7] Running npm install (full — all dependencies)...
    echo  Starting npm install — this may take a while...
    echo  --------------------------------------------
    npm install --loglevel verbose
)
echo  --------------------------------------------
echo  npm install  OK
echo.



:: ── 5. Image generation Python deps (full install only) ──────────────────────
if "%INSTALL_MODE%"=="2" (
    echo.
    echo [5/7] Image generation ^(Python / diffusers^)...
    python --version >nul 2>&1
    if errorlevel 1 (
        echo  [SKIP] Python not found — skipping image generation setup.
        echo         Install Python 3.10+ and re-run this step manually:
        echo           pip install -r imagegen\requirements.txt
        goto :skip_imagegen
    )

    echo.
    echo  Choose PyTorch variant for image generation:
    echo.
    echo    [1] NVIDIA GPU  ^(CUDA 12.1 — recommended if you have an NVIDIA card^)
    echo    [2] CPU only    ^(slower, no GPU required^)
    echo    [3] Skip        ^(install later manually^)
    echo.
    set /p TORCH_MODE="Enter choice (1, 2 or 3): "
    if not defined TORCH_MODE set TORCH_MODE=3
    echo.

    if "!TORCH_MODE!"=="1" (
        echo  Installing PyTorch with CUDA 12.1...
        pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
        if errorlevel 1 (
            echo  [WARN] PyTorch CUDA install failed. Try CPU variant or install manually.
            goto :skip_imagegen
        )
        echo  PyTorch ^(CUDA^)  OK
    ) else if "!TORCH_MODE!"=="2" (
        echo  Installing PyTorch CPU-only...
        pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
        if errorlevel 1 (
            echo  [WARN] PyTorch CPU install failed.
            goto :skip_imagegen
        )
        echo  PyTorch ^(CPU^)  OK
    ) else (
        echo  Skipping PyTorch — run manually later.
        goto :skip_imagegen
    )

    echo  Installing diffusers and image gen dependencies...
    pip install -r imagegen\requirements.txt
    if errorlevel 1 (
        echo  [WARN] Some image gen packages failed to install.
    ) else (
        echo  Image gen deps  OK
    )
)
:skip_imagegen
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
