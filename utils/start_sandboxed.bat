@echo off
:: Path to Sandboxie-Plus
set "SB_PATH=C:\Program Files\Sandboxie-Plus\Start.exe"

:: Path to Firefox (Standard location)
:: If this fails, check if yours is in "C:\Program Files (x86)\Mozilla Firefox\firefox.exe"
set "FF_PATH=C:\Program Files\Mozilla Firefox\firefox.exe"

:: 1. Launch Node server inside the sandbox
start "" "%SB_PATH%" /box:DefaultBox node server.js 

:: 2. Wait for server startup
timeout /t 3 /nobreak > nul

:: 3. Launch Firefox using the FULL PATH to avoid Error 2
:: Added --ssb to help with your "pv-main" being cut off (removes top toolbars)
start "" "%SB_PATH%" /box:DefaultBox "%FF_PATH%" --ssb "http://localhost:3000"