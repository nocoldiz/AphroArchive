@echo off
setlocal EnableDelayedExpansion
echo.
echo ============================================================
echo  Building AphroArchive Desktop (standalone Electron GUI)
echo  Runs in its own window -- no browser needed.
echo ============================================================
echo.

:: ============================================================
:: Optional flags: --win --linux --mac
:: No flags = build for Windows (this host).
:: ============================================================
set EB_TARGETS=
:parse_args
if "%~1"=="" goto :done_args
if /i "%~1"=="--win"   set EB_TARGETS=!EB_TARGETS! --win
if /i "%~1"=="--linux" set EB_TARGETS=!EB_TARGETS! --linux
if /i "%~1"=="--mac"   set EB_TARGETS=!EB_TARGETS! --mac
shift
goto :parse_args
:done_args

if "!EB_TARGETS!"=="" set EB_TARGETS= --win

if not exist dist mkdir dist

echo [build] Building frontend...
call npx vite build
if %ERRORLEVEL% NEQ 0 ( echo  FAILED: frontend build & exit /b 1 )
echo  done.
echo.

echo [desktop] Packaging Electron app (!EB_TARGETS! )...
call npx electron-builder !EB_TARGETS! -c.artifactName=AphroArchive-gui.${ext}
if !ERRORLEVEL! NEQ 0 ( echo  FAILED: Electron build & exit /b 1 )
echo.

echo ============================================================
echo  Build complete. Standalone GUI app in dist\electron\
echo ============================================================
echo.
