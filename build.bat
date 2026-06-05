@echo off
setlocal EnableDelayedExpansion
echo.
echo  Building AphroArchive for all platforms...
echo.

if not exist dist mkdir dist

:: ============================================================
:: 1. Frontend build (desktop — bundled into pkg executables)
:: ============================================================
echo [1/5] Building frontend (desktop)...
call npx vite build
if %ERRORLEVEL% NEQ 0 ( echo  FAILED: frontend build & exit /b 1 )
echo  done.
echo.

:: ============================================================
:: 2. Windows
:: ============================================================
echo [2/5] Packaging Windows (x64)...
call npx pkg . --targets node24-win-x64 --output dist\AphroArchive.exe --compress GZip
if %ERRORLEVEL% NEQ 0 ( echo  FAILED: Windows build & exit /b 1 )
echo  done: dist\AphroArchive.exe
echo.

:: ============================================================
:: 3. Linux
:: ============================================================
echo [3/5] Packaging Linux (x64)...
call npx pkg . --targets node24-linux-x64 --output dist\AphroArchive-linux --compress GZip
if %ERRORLEVEL% NEQ 0 ( echo  FAILED: Linux build & exit /b 1 )
echo  done: dist\AphroArchive-linux
echo.

:: ============================================================
:: 4. macOS (arm64 + x64 universal zip)
:: ============================================================
echo [4/5] Packaging macOS...

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

:: Create macOS package with .app launcher
set STAGE=dist\mac-stage
if exist "%STAGE%" rmdir /s /q "%STAGE%"
mkdir "%STAGE%"
mkdir "%STAGE%\AphroArchive.app\Contents\MacOS"
mkdir "%STAGE%\AphroArchive.app\Contents\Resources"

copy dist\AphroArchive-macos-arm64 "%STAGE%\AphroArchive-macos-arm64" >nul
copy dist\AphroArchive-macos-x64   "%STAGE%\AphroArchive-macos-x64"   >nul
del dist\AphroArchive-macos-arm64
del dist\AphroArchive-macos-x64

:: Info.plist
powershell -NoProfile -Command "$p = '<?xml version=""1.0"" encoding=""UTF-8""?><!DOCTYPE plist PUBLIC ""-//Apple//DTD PLIST 1.0//EN"" ""http://www.apple.com/DTDs/PropertyList-1.0.dtd""><plist version=""1.0""><dict><key>CFBundleExecutable</key><string>launcher</string><key>CFBundleIdentifier</key><string>com.aphroarchive.app</string><key>CFBundleName</key><string>AphroArchive</string><key>CFBundleDisplayName</key><string>AphroArchive</string><key>CFBundleVersion</key><string>1.0.0</string><key>CFBundleShortVersionString</key><string>1.0</string><key>CFBundlePackageType</key><string>APPL</string><key>LSMinimumSystemVersion</key><string>11.0</string><key>NSHighResolutionCapable</key><true/></dict></plist>'; $p | Set-Content -Encoding UTF8 '%STAGE%\AphroArchive.app\Contents\Info.plist'"

:: Launcher script
powershell -NoProfile -Command "$s = '#!/bin/bash`nset -e`nAPP_DIR=""$(cd ""$(dirname ""$0"")/../../.."" && pwd)""'`n$s += '`nARCH=$(uname -m)`nif [ ""$ARCH"" = ""arm64"" ]; then BIN=""$APP_DIR/AphroArchive-macos-arm64""'`n$s += '`nelse BIN=""$APP_DIR/AphroArchive-macos-x64""; fi`nchmod +x ""$BIN"" 2>/dev/null || true`nexec ""$BIN"" ""$@""'; $s | Set-Content -Encoding UTF8 '%STAGE%\AphroArchive.app\Contents\MacOS\launcher'"

:: setup.sh
powershell -NoProfile -Command "$s = '#!/bin/bash`ncd ""$(dirname ""$0"")""'`n$s += '`necho Setting permissions...`nchmod +x AphroArchive-macos-arm64 AphroArchive-macos-x64 AphroArchive.app/Contents/MacOS/launcher`necho Done! Double-click AphroArchive.app to launch.`necho If macOS blocks it: System Settings > Privacy & Security > Allow'; $s | Set-Content -Encoding UTF8 '%STAGE%\setup.sh'"

:: Zip
if exist dist\AphroArchive-mac.zip del dist\AphroArchive-mac.zip
powershell -NoProfile -Command "Compress-Archive -Path '%STAGE%\*' -DestinationPath 'dist\AphroArchive-mac.zip' -Force"
rmdir /s /q "%STAGE%"

echo  done: dist\AphroArchive-mac.zip
echo.

:after_mac
:: ============================================================
:: 5. Android APK
:: ============================================================
echo [5/5] Building Android APK...

echo   [5a] Building Android web assets...
call npm run build:android-web
if %ERRORLEVEL% NEQ 0 ( echo  FAILED: Android web build & exit /b 1 )

echo   [5b] Syncing to Android project...
cd android-app
call npx cap sync android 2>&1
if %ERRORLEVEL% NEQ 0 ( echo  FAILED: cap sync & cd .. & exit /b 1 )

echo   [5c] Running Gradle (assembleRelease)...
cd android
call gradlew.bat assembleRelease 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo  Release build failed, trying assembleDebug...
  call gradlew.bat assembleDebug 2>&1
  if %ERRORLEVEL% NEQ 0 ( echo  FAILED: Gradle build & cd ..\.. & exit /b 1 )
  set APK_SRC=app\build\outputs\apk\debug\app-debug.apk
  set APK_LABEL=debug
) else (
  set APK_SRC=app\build\outputs\apk\release\app-release-unsigned.apk
  if not exist "app\build\outputs\apk\release\app-release-unsigned.apk" set APK_SRC=app\build\outputs\apk\release\app-release.apk
  set APK_LABEL=release
)

cd ..\..

copy "android-app\android\!APK_SRC!" dist\AphroArchive.apk >nul
if %ERRORLEVEL% NEQ 0 ( echo  FAILED: Could not copy APK to dist\ & exit /b 1 )

echo  done: dist\AphroArchive.apk  ^(!APK_LABEL!^)
echo.

:: ============================================================
:: Summary
:: ============================================================
echo ============================================================
echo  Build complete. Outputs in dist\:
echo.
if exist dist\AphroArchive.exe          echo    AphroArchive.exe            Windows x64
if exist dist\AphroArchive-linux        echo    AphroArchive-linux          Linux x64
if exist dist\AphroArchive-mac.zip      echo    AphroArchive-mac.zip        macOS (arm64 + x64)
if exist dist\AphroArchive.apk          echo    AphroArchive.apk            Android
echo ============================================================
echo.
