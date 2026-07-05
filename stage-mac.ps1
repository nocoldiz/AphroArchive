<#
  stage-mac.ps1 — write the macOS .app support files into a staging folder.

  Emits Info.plist, the launcher shim, and setup.sh with LF line endings and
  no UTF-8 BOM (a BOM on the shebang line stops the kernel recognising it).
  Kept out of build.bat because embedding shell scripts full of double quotes
  inside `powershell -Command "..."` gets mangled by cmd/CRT argv quoting.

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File stage-mac.ps1 -StageDir dist\mac-stage
#>
param(
  [Parameter(Mandatory = $true)][string]$StageDir
)

$ErrorActionPreference = 'Stop'
$StageDir = (Resolve-Path -LiteralPath $StageDir).Path
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-LfFile([string]$Path, [string]$Text) {
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  [IO.File]::WriteAllText($Path, ($Text -replace "`r`n", "`n"), $utf8NoBom)
}

$plist = @'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIdentifier</key><string>com.aphroarchive.app</string>
  <key>CFBundleName</key><string>AphroArchive</string>
  <key>CFBundleDisplayName</key><string>AphroArchive</string>
  <key>CFBundleVersion</key><string>1.0.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
'@

$launcher = @'
#!/bin/bash
set -e
APP_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then BIN="$APP_DIR/AphroArchive-macos-arm64"
else BIN="$APP_DIR/AphroArchive-macos-x64"; fi
chmod +x "$BIN" 2>/dev/null || true
exec "$BIN" "$@"
'@

$setup = @'
#!/bin/bash
cd "$(dirname "$0")"
echo Setting permissions...
chmod +x AphroArchive-macos-arm64 AphroArchive-macos-x64 AphroArchive.app/Contents/MacOS/launcher
echo Done! Double-click AphroArchive.app to launch.
echo If macOS blocks it: System Settings / Privacy and Security / Allow
'@

$contents = Join-Path $StageDir 'AphroArchive.app\Contents'
Write-LfFile (Join-Path $contents 'Info.plist')       $plist
Write-LfFile (Join-Path $contents 'MacOS\launcher')   $launcher
Write-LfFile (Join-Path $StageDir 'setup.sh')         $setup

Write-Host "  staged Info.plist, launcher, setup.sh (LF, no BOM)"
