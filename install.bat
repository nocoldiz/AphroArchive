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
echo         server (Preact, better-sqlite3, etc.).
echo         Skips optional LLM module and dev/build tools.
echo         Faster and uses less disk space.
echo.
echo    [2] Full install
echo         Installs ALL dependencies including dev/build tools (vite,
echo         TypeScript, pkg, etc.) — needed for development and building
echo         executable packages.
echo.

choice /c 12 /n /m "Enter choice (1 or 2) [Default 1]: " /t 10 /d 1
if errorlevel 2 (
    set INSTALL_MODE=2
    echo  Full mode selected — installing all dependencies.
) else (
    set INSTALL_MODE=1
    echo  Minimal mode selected — will skip optional and dev dependencies.
)
echo.

:: ── 1. Git pull ──────────────────────────────────────────────────────────────
echo [1/5] Fetching latest code from GitHub...
git pull && echo  Git pull  OK || echo  [WARN] Git pull failed, continuing anyway...
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
        echo  Please install it manually from: https://nodejs.org
        pause
        exit /b 1
    )

    echo  Refreshing environment variables...
    for /f "tokens=2*" %%A in ('reg query "HKLM\System\CurrentControlSet\Control\Session Manager\Environment" /v Path') do set "syspath=%%B"
    for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "userpath=%%B"
    set "PATH=!syspath!;!userpath!"
)

node --version >nul 2>&1 && for /f "tokens=*" %%v in ('node --version 2^>nul') do echo  Node.js %%v  OK || (
    echo  [ERROR] Node.js is still not available on PATH. Please restart the installer.
    pause
    exit /b 1
)
echo.

:: ── 3. npm install ──────────────────────────────────────────────────────────
if "%INSTALL_MODE%"=="1" (
    echo [3/5] Running npm install ^(minimal — runtime deps only^)...
    echo  Installing preact, @preact/signals, better-sqlite3...
    echo  ^(better-sqlite3 is a native module — first install may take a minute^)
    echo  --------------------------------------------
    call npm install preact @preact/signals better-sqlite3 --omit=optional --loglevel verbose && echo  npm install  OK || (
        echo.
        echo  [ERROR] Failed to install core dependencies.
        pause
        exit /b 1
    )
) else (
    echo [3/5] Running npm install ^(full — all dependencies^)...
    echo  Starting npm install — this may take a while...
    echo  Note: optional deps like node-llama-cpp may be skipped if build tools are missing.
    echo  --------------------------------------------
    call npm install --omit=optional --loglevel verbose && echo  npm install  OK || (
        echo.
        echo  [ERROR] Failed to install full dependencies.
        pause
        exit /b 1
    )
)
echo  --------------------------------------------
echo.

:: ── 4. Image generation Python deps (full install only) ──────────────────────
if "%INSTALL_MODE%"=="2" (
    echo [4/5] Image generation ^(Python / diffusers^)...
    python --version >nul 2>&1
    if errorlevel 1 (
        echo  [SKIP] Python not found — skipping image generation setup.
        echo         Install Python 3.10+ and re-run this step manually:
        echo          pip install -r imagegen\requirements.txt
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
    if errorlevel 3 (
        set TORCH_MODE=3
    ) else if errorlevel 2 (
        set TORCH_MODE=2
    ) else (
        set TORCH_MODE=1
    )
    echo.

    if "!TORCH_MODE!"=="1" (
        echo  Installing PyTorch with CUDA 12.1...
        pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121 && echo  PyTorch ^(CUDA^)  OK || (
            echo  [WARN] PyTorch CUDA install failed. Try CPU variant or install manually.
            goto :skip_imagegen
        )
    ) else if "!TORCH_MODE!"=="2" (
        echo  Installing PyTorch CPU-only...
        pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu && echo  PyTorch ^(CPU^)  OK || (
            echo  [WARN] PyTorch CPU install failed.
            goto :skip_imagegen
        )
    ) else (
        echo  Skipping PyTorch — run manually later.
        goto :skip_imagegen
    )

    echo  Installing diffusers and image gen dependencies...
    pip install -r imagegen\requirements.txt && echo  Image gen deps  OK || echo  [WARN] Some image gen packages failed to install.
)
:skip_imagegen
echo.

:: ── 5. ffmpeg + ffprobe ──────────────────────────────────────────────────────
echo [5/5] Checking ffmpeg...
if exist "ffmpeg.exe" if exist "ffprobe.exe" (
    echo  ffmpeg.exe + ffprobe.exe already present  OK
    goto :done
)

:: Try winget first (adds to system PATH, server falls back to PATH)
where ffmpeg >nul 2>&1
if not errorlevel 1 (
    echo  ffmpeg already on PATH  OK
    goto :done
)

echo  Downloading ffmpeg from BtbN builds (this may take a minute)...

:: Write the PowerShell script to a temporary file
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

:: Execute it
powershell -NoProfile -ExecutionPolicy Bypass -File dl_ffmpeg.ps1

:: Clean up
del dl_ffmpeg.ps1

:done
echo.
echo  ─────────────────────────────────────────────────────────────
echo   All done!  Run start.bat to launch AphroArchive.
echo  ─────────────────────────────────────────────────────────────
echo.
pause
