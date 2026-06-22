@echo off
cd /d "%~dp0"

REM Make sure dependencies are installed - run install.bat first if yt-dlp is missing.
python -c "import yt_dlp" 2>nul
if errorlevel 1 (
    echo yt-dlp is not installed.
    echo Please run install.bat first to set up dependencies.
    echo.
    pause
    exit /b 1
)

echo ==================================
echo BulkDownloader Launcher
echo ==================================
echo  1. GUI version
echo  2. Console version
echo.
set /p choice="Choose (1 or 2): "

if "%choice%"=="1" (
    python bulkdownloader_gui.py
) else if "%choice%"=="2" (
    python bulkdownloader.py
) else (
    echo Invalid choice.
    pause
)
