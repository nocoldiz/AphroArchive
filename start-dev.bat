@echo off
cd /d "%~dp0"
echo Fetching latest code from GitHub...
git pull
if %ERRORLEVEL% neq 0 (
    echo Warning: Git pull failed, continuing anyway...
)
echo.
start /b npm run dev
start "" http://localhost:5173
node --watch server.js
