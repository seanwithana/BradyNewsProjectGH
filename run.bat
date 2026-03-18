@echo off
cd /d "%~dp0"

:: Check if node_modules exists
if not exist node_modules (
    echo Dependencies not installed. Running install first...
    call install.bat
)

:: Check for .env
if not exist .env (
    echo ERROR: .env file not found.
    echo Copy .env.example to .env and add your Discord bot token.
    echo   copy .env.example .env
    echo   notepad .env
    pause
    exit /b 1
)

:: Launch the app
start "" npx electron .
