@echo off
echo Starting AphroArchive Dev...

start "Backend" cmd /k "node --watch server.js"
start "Vite" cmd /k "npm run dev"

echo Waiting for Vite at http://localhost:5173...
:wait
powershell -NoProfile -Command "try { $null = Invoke-WebRequest -Uri 'http://localhost:5173' -UseBasicParsing -TimeoutSec 1; exit 0 } catch { exit 1 }" 2>nul
if errorlevel 1 (
  timeout /t 1 /nobreak >nul
  goto wait
)

echo Ready. Opening browser...
start "" http://localhost:5173
