@echo off
cd /d "%~dp0"

echo BulkDownloader Launcher
echo =======================
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
