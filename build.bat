@echo off
setlocal EnableDelayedExpansion
echo.

:: ============================================================
:: Parse flags: --windows --linux --mac --electron
:: --publish  publishes the built artifacts to a GitHub release
:: No platform flags = build all platforms
:: ============================================================
set DO_WINDOWS=0
set DO_LINUX=0
set DO_MAC=0
set DO_ELECTRON=0
set DO_PUBLISH=0
set ANY_FLAG=0

:parse_args
if "%~1"=="" goto :done_args
if /i "%~1"=="--windows"  ( set DO_WINDOWS=1  & set ANY_FLAG=1 )
if /i "%~1"=="--linux"    ( set DO_LINUX=1    & set ANY_FLAG=1 )
if /i "%~1"=="--mac"      ( set DO_MAC=1      & set ANY_FLAG=1 )
if /i "%~1"=="--electron" ( set DO_ELECTRON=1 & set ANY_FLAG=1 )
if /i "%~1"=="--publish"  ( set DO_PUBLISH=1 )
shift
goto :parse_args
:done_args

if !ANY_FLAG!==0 (
  set DO_WINDOWS=1
  set DO_LINUX=1
  set DO_MAC=1
)

if !DO_WINDOWS!==1  echo  Target: Windows ^(pkg exe^)
if !DO_ELECTRON!==1 echo  Target: Windows ^(Electron installer^)
if !DO_LINUX!==1    echo  Target: Linux
if !DO_MAC!==1      echo  Target: macOS
if !DO_PUBLISH!==1  echo  Publish: GitHub Releases
echo.

if not exist dist mkdir dist

:: ============================================================
:: Frontend build — desktop (needed for Windows / Linux / Mac)
:: ============================================================
set NEED_DESKTOP=0
if !DO_WINDOWS!==1  set NEED_DESKTOP=1
if !DO_LINUX!==1    set NEED_DESKTOP=1
if !DO_MAC!==1      set NEED_DESKTOP=1
if !DO_ELECTRON!==1 set NEED_DESKTOP=1

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
:: macOS (arm64 + x64 universal zip)
:: ============================================================
if !DO_MAC!==1 (
  echo [mac] Packaging macOS...

  call npx pkg . --targets node24-macos-arm64 --output dist\AphroArchive-macos-arm64 --compress GZip
  if %ERRORLEVEL% NEQ 0 (
    echo  WARNING: macOS arm64 build failed ^(cross-compilation from Windows is unsupported^)
    echo  Skipping macOS package. Build on macOS or use CI to produce mac binaries.
    goto :after_mac
  )

  call npx pkg . --targets node24-macos-x64 --output dist\AphroArchive-macos-x64 --compress GZip
  if %ERRORLEVEL% NEQ 0 (
    echo  WARNING: macOS x64 build failed
    goto :after_mac
  )

  set STAGE=dist\mac-stage
  if exist "!STAGE!" rmdir /s /q "!STAGE!"
  mkdir "!STAGE!"
  mkdir "!STAGE!\AphroArchive.app\Contents\MacOS"
  mkdir "!STAGE!\AphroArchive.app\Contents\Resources"

  copy dist\AphroArchive-macos-arm64 "!STAGE!\AphroArchive-macos-arm64" >nul
  copy dist\AphroArchive-macos-x64   "!STAGE!\AphroArchive-macos-x64"   >nul
  del dist\AphroArchive-macos-arm64
  del dist\AphroArchive-macos-x64

  powershell -NoProfile -Command "$p = '<?xml version=""1.0"" encoding=""UTF-8""?><!DOCTYPE plist PUBLIC ""-//Apple//DTD PLIST 1.0//EN"" ""http://www.apple.com/DTDs/PropertyList-1.0.dtd""><plist version=""1.0""><dict><key>CFBundleExecutable</key><string>launcher</string><key>CFBundleIdentifier</key><string>com.aphroarchive.app</string><key>CFBundleName</key><string>AphroArchive</string><key>CFBundleDisplayName</key><string>AphroArchive</string><key>CFBundleVersion</key><string>1.0.0</string><key>CFBundleShortVersionString</key><string>1.0</string><key>CFBundlePackageType</key><string>APPL</string><key>LSMinimumSystemVersion</key><string>11.0</string><key>NSHighResolutionCapable</key><true/></dict></plist>'; $p | Set-Content -Encoding UTF8 'dist\mac-stage\AphroArchive.app\Contents\Info.plist'"

  powershell -NoProfile -Command "$s = '#!/bin/bash`nset -e`nAPP_DIR=""$(cd ""$(dirname ""$0"")/../../.."" && pwd)""'`n$s += '`nARCH=$(uname -m)`nif [ ""$ARCH"" = ""arm64"" ]; then BIN=""$APP_DIR/AphroArchive-macos-arm64""'`n$s += '`nelse BIN=""$APP_DIR/AphroArchive-macos-x64""; fi`nchmod +x ""$BIN"" 2>/dev/null || true`nexec ""$BIN"" ""$@""'; $s | Set-Content -Encoding UTF8 'dist\mac-stage\AphroArchive.app\Contents\MacOS\launcher'"

  powershell -NoProfile -Command "$s = '#!/bin/bash`ncd ""$(dirname ""$0"")""'`n$s += '`necho Setting permissions...`nchmod +x AphroArchive-macos-arm64 AphroArchive-macos-x64 AphroArchive.app/Contents/MacOS/launcher`necho Done! Double-click AphroArchive.app to launch.`necho If macOS blocks it: System Settings > Privacy & Security > Allow'; $s | Set-Content -Encoding UTF8 'dist\mac-stage\setup.sh'"

  echo   [mac] Creating .dmg ^(UDF image^)...
  call powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0make-dmg.ps1" -SourceDir "!STAGE!" -VolumeName AphroArchive -Output "dist\AphroArchive-mac.dmg"
  if !ERRORLEVEL! NEQ 0 (
    if exist dist\AphroArchive-mac.dmg del dist\AphroArchive-mac.dmg
    echo  WARNING: .dmg creation failed; the .zip below is the usable artifact
  )

  if exist dist\AphroArchive-mac.zip del dist\AphroArchive-mac.zip
  powershell -NoProfile -Command "Compress-Archive -Path 'dist\mac-stage\*' -DestinationPath 'dist\AphroArchive-mac.zip' -Force"
  rmdir /s /q "!STAGE!"

  if exist dist\AphroArchive-mac.dmg echo  done: dist\AphroArchive-mac.dmg
  echo  done: dist\AphroArchive-mac.zip
  echo.
)
:after_mac

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
if exist dist\AphroArchive.exe              echo    AphroArchive.exe            Windows x64 ^(pkg^)
if exist dist\electron\                     echo    electron\                   Windows Electron installer
if exist dist\AphroArchive-linux            echo    AphroArchive-linux          Linux x64
if exist dist\AphroArchive-mac.dmg          echo    AphroArchive-mac.dmg        macOS ^(arm64 + x64, UDF .dmg^)
if exist dist\AphroArchive-mac.zip          echo    AphroArchive-mac.zip        macOS ^(arm64 + x64, zip fallback^)
if exist dist\AphroArchive-firefox.xpi      echo    AphroArchive-firefox.xpi    Firefox extension
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
  if exist dist\AphroArchive-mac.dmg      set ASSETS=!ASSETS! "dist\AphroArchive-mac.dmg"
  if exist dist\AphroArchive-mac.zip      set ASSETS=!ASSETS! "dist\AphroArchive-mac.zip"
  if exist dist\AphroArchive-firefox.xpi  set ASSETS=!ASSETS! "dist\AphroArchive-firefox.xpi"
  if exist dist\electron for %%f in (dist\electron\*.exe) do set ASSETS=!ASSETS! "%%f"

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
