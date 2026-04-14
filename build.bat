@echo off
echo Building AphroArchive.exe...

where pkg >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo Installing @yao-pkg/pkg...
  npm install
  set PKG=npx pkg
) else (
  set PKG=pkg
)

if not exist dist mkdir dist

npx pkg . --targets node20-win-x64 --output dist\AphroArchive.exe --compress GZip

if %ERRORLEVEL% EQU 0 (
  echo.
  echo  Build successful: dist\AphroArchive.exe
  echo.
  echo  To use thumbnails, place ffmpeg.exe and ffprobe.exe next to the exe.
  echo  Download from: https://www.gyan.dev/ffmpeg/builds/
) else (
  echo  Build failed.
)
