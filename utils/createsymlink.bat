@echo off
setlocal enabledelayedexpansion

:: Prompt the user to paste the target video directory path
set /p "TARGET_PATH=Paste the link/path to the target video directory: "

:: Clean up surrounding quotes if the user pasted them
set "TARGET_PATH=%TARGET_PATH:"=%"

:: Check if the input is empty
if "%TARGET_PATH%"=="" (
    echo Error: No path entered.
    pause
    exit /b
)

:: Validate that the target path actually exists
if not exist "%TARGET_PATH%\" (
    echo Error: The specified target directory does not exist. Please check the path.
    pause
    exit /b
)

:: Extract the folder name from the end of the target path
for %%I in ("%TARGET_PATH%") do set "FOLDER_NAME=%%~nxI"

:: Define the local symlink path based on where the script is currently running
set "LOCAL_PATH=%CD%\%FOLDER_NAME%"

:: Check if a folder or file with that name already exists in the current directory
if exist "%LOCAL_PATH%" (
    echo Warning: A folder or file named '%FOLDER_NAME%' already exists in this location.
    pause
    exit /b
)

:: Attempt to create the symbolic link (Requires Admin rights)
echo.
echo Creating symlink...
mklink /D "%LOCAL_PATH%" "%TARGET_PATH%"

:: Check if the command succeeded
if %errorlevel% neq 0 (
    echo.
    echo [!] Failed to create the symlink.
    echo [!] Note: Creating symbolic links requires Administrator privileges. 
    echo [!] Please right-click this .bat file and select "Run as administrator".
) else (
    echo.
    echo [SUCCESS]
    echo Local Symlink: "%LOCAL_PATH%"
    echo Points To:     "%TARGET_PATH%"
)

echo.
pause