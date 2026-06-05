@echo off
start "" http://localhost:3000
for /f "tokens=1 delims=." %%v in ('node -e "process.stdout.write(process.versions.node)"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 22 (
    echo [ERROR] Node.js 22.5 or newer is required.
    echo Please update from https://nodejs.org
    pause
    exit /b 1
)
if %NODE_MAJOR% LSS 23 (
    node --experimental-sqlite server.js
) else (
    node server.js
)
