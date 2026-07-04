@echo off
setlocal

where python >nul 2>&1
if errorlevel 1 (
    where python3 >nul 2>&1
    if errorlevel 1 (
        echo Python is not installed or not in PATH.
        echo Install Python from https://www.python.org/downloads/
        pause
        exit /b 1
    )
    set PYTHON=python3
) else (
    set PYTHON=python
)

%PYTHON% "%~dp0categorizer.py" %*
if errorlevel 1 pause
