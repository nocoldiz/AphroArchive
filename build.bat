@echo off
setlocal EnableDelayedExpansion
echo.

:: ============================================================
:: Parse flags: --windows --linux --electron --desktop
:: --desktop  ALSO build the standalone "AphroArchive Desktop" app
::            (Electron, runs in its own window — NOT the browser)
::            for the selected platforms, in addition to the pkg server.
:: --electron builds only the Windows Electron installer (legacy).
:: --publish  publishes the built artifacts to a GitHub release
:: No flags = build BOTH the pkg server AND the desktop app for
::            Windows + Linux. macOS is Mac-only, so it is not built here.
:: ============================================================
set DO_WINDOWS=0
set DO_LINUX=0
set DO_ELECTRON=0
set DO_DESKTOP=0
set DO_PUBLISH=0
set ANY_FLAG=0

:parse_args
if "%~1"=="" goto :done_args
if /i "%~1"=="--windows"  ( set DO_WINDOWS=1  & set ANY_FLAG=1 )
if /i "%~1"=="--linux"    ( set DO_LINUX=1    & set ANY_FLAG=1 )
if /i "%~1"=="--electron" ( set DO_ELECTRON=1 & set ANY_FLAG=1 )
if /i "%~1"=="--desktop"  ( set DO_DESKTOP=1 )
if /i "%~1"=="--publish"  ( set DO_PUBLISH=1 )
shift
goto :parse_args
:done_args

:: No flags = build everything this host can produce (Windows + Linux),
:: both the pkg server and the standalone desktop app.
if !ANY_FLAG!==0 (
  set DO_WINDOWS=1
  set DO_LINUX=1
  set DO_DESKTOP=1
)

if !DO_DESKTOP!==1  echo  Build:  AphroArchive Desktop ^(standalone Electron app^)
if !DO_WINDOWS!==1  echo  Target: Windows
if !DO_ELECTRON!==1 echo  Target: Windows ^(Electron installer^)
if !DO_LINUX!==1    echo  Target: Linux
if !DO_PUBLISH!==1  echo  Publish: GitHub Releases
echo.

if not exist dist mkdir dist

:: ============================================================
:: Frontend build — desktop (needed for Windows / Linux)
:: ============================================================
set NEED_DESKTOP=0
if !DO_WINDOWS!==1  set NEED_DESKTOP=1
if !DO_LINUX!==1    set NEED_DESKTOP=1
if !DO_ELECTRON!==1 set NEED_DESKTOP=1
if !DO_DESKTOP!==1  set NEED_DESKTOP=1

if !NEED_DESKTOP!==1 (
  echo [build] Building frontend ^(desktop^)...
  call npx vite build
  if %ERRORLEVEL% NEQ 0 ( echo  FAILED: frontend build & exit /b 1 )
  echo  done.
  echo.
)

:: ============================================================
:: Windows
:: ============================================================
if !DO_WINDOWS!==1 (
  echo [windows] Packaging Windows ^(x64^)...
  call npx pkg . --targets node24-win-x64 --output dist\AphroArchive.exe --compress GZip
  if %ERRORLEVEL% NEQ 0 ( echo  FAILED: Windows build & exit /b 1 )
  echo  done: dist\AphroArchive.exe
  echo.
)

:: ============================================================
:: Electron (Windows installer)
:: ============================================================
if !DO_ELECTRON!==1 (
  echo [electron] Building Electron installer ^(Windows^)...
  call npx electron-builder --win
  if %ERRORLEVEL% NEQ 0 ( echo  FAILED: Electron build & exit /b 1 )
  echo  done: dist\electron\
  echo.
)

:: ============================================================
:: Linux
:: ============================================================
if !DO_LINUX!==1 (
  echo [linux] Packaging Linux ^(x64^)...
  call npx pkg . --targets node24-linux-x64 --output dist\AphroArchive-linux --compress GZip
  if %ERRORLEVEL% NEQ 0 ( echo  FAILED: Linux build & exit /b 1 )
  echo  done: dist\AphroArchive-linux
  echo.
)

:: ============================================================
:: AphroArchive Desktop  (standalone Electron app — own window)
:: macOS is not built here — a .dmg can only be produced on a Mac.
:: ============================================================
if !DO_DESKTOP!==1 (
  echo [desktop] Building AphroArchive Desktop ^(Electron standalone app^)...
  set EB_TARGETS=
  if !DO_WINDOWS!==1  set EB_TARGETS=!EB_TARGETS! --win
  if !DO_LINUX!==1    set EB_TARGETS=!EB_TARGETS! --linux
  call npx electron-builder !EB_TARGETS!
  if !ERRORLEVEL! NEQ 0 (
    echo  WARNING: Electron build failed ^(linux AppImage from Windows may need extra tooling^)
  ) else (
    echo  done: dist\electron\
  )
  echo.
)

:: ============================================================
:: Firefox Extension
:: ============================================================
echo [firefox] Packaging Firefox extension...
if exist dist\AphroArchive-firefox.xpi del dist\AphroArchive-firefox.xpi
powershell -NoProfile -Command "Compress-Archive -Path 'browser-extension\*' -DestinationPath 'dist\AphroArchive-firefox.zip' -Force; Move-Item dist\AphroArchive-firefox.zip dist\AphroArchive-firefox.xpi -Force"
if errorlevel 1 ( echo  WARN: Firefox extension packaging failed ) else ( echo  done: dist\AphroArchive-firefox.xpi )
echo.

:: ============================================================
:: Summary
:: ============================================================
echo ============================================================
echo  Build complete. Outputs in dist\:
echo.
if exist dist\AphroArchive.exe              echo    AphroArchive.exe                  Windows x64 ^(pkg, browser/server^)
if exist dist\AphroArchive-linux            echo    AphroArchive-linux                Linux x64 ^(pkg, browser/server^)
if exist dist\electron\                     echo    electron\AphroArchive-Desktop-*   AphroArchive Desktop ^(standalone app^)
if exist dist\AphroArchive-firefox.xpi      echo    AphroArchive-firefox.xpi          Firefox extension
echo ============================================================
echo.

:: ============================================================
:: Publish to GitHub Releases
:: ============================================================
if !DO_PUBLISH!==1 (
  echo [publish] Publishing to GitHub Releases...

  where gh >nul 2>&1
  if errorlevel 1 (
    echo  FAILED: GitHub CLI ^(gh^) not found. Install from https://cli.github.com/ and run 'gh auth login'.
    exit /b 1
  )

  set APP_VERSION=
  for /f "usebackq delims=" %%v in (`node -p "require('./package.json').version"`) do set APP_VERSION=%%v
  if "!APP_VERSION!"=="" ( echo  FAILED: could not read version from package.json & exit /b 1 )
  set TAG=v!APP_VERSION!
  echo   Release tag: !TAG!

  set ASSETS=
  if exist dist\AphroArchive.exe          set ASSETS=!ASSETS! "dist\AphroArchive.exe"
  if exist dist\AphroArchive-linux        set ASSETS=!ASSETS! "dist\AphroArchive-linux"
  if exist dist\AphroArchive-firefox.xpi  set ASSETS=!ASSETS! "dist\AphroArchive-firefox.xpi"
  if exist dist\electron for %%f in (dist\electron\*.exe dist\electron\*.AppImage dist\electron\*.dmg) do set ASSETS=!ASSETS! "%%f"

  if "!ASSETS!"=="" ( echo  FAILED: no build artifacts found in dist\ & exit /b 1 )

  gh release view !TAG! >nul 2>&1
  if errorlevel 1 (
    echo   Creating release !TAG!...
    call gh release create !TAG! --title "AphroArchive !TAG!" --notes "Automated build of AphroArchive !TAG!"
    if !ERRORLEVEL! NEQ 0 ( echo  FAILED: could not create release & exit /b 1 )
  ) else (
    echo   Release !TAG! already exists; updating assets...
  )

  echo   Uploading assets...
  call gh release upload !TAG! !ASSETS! --clobber
  if !ERRORLEVEL! NEQ 0 ( echo  FAILED: asset upload & exit /b 1 )

  echo  done: published !TAG! to GitHub Releases
  echo.
)
