@echo off
echo ============================================
echo   Brady News Project - Installation
echo ============================================
echo.

:: Check for Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js is not installed.
    echo Please install Node.js from https://nodejs.org/ (LTS version recommended)
    echo After installing, restart this script.
    pause
    exit /b 1
)

echo [1/4] Node.js found:
node --version
echo.

:: Install dependencies
echo [2/4] Installing dependencies...
call npm install --ignore-scripts
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
)
echo.

:: Download Electron binary
echo [3/4] Setting up Electron...
node node_modules\electron\install.js
echo.

:: Rebuild native modules for Electron
echo [4/4] Rebuilding native modules for Electron...
call npx @electron/rebuild --force
if %ERRORLEVEL% neq 0 (
    echo WARNING: Native module rebuild had issues. The app may still work.
)
echo.

:: Check for .env
if not exist .env (
    echo ============================================
    echo   IMPORTANT: Create your .env file
    echo ============================================
    echo.
    echo Copy .env.example to .env and fill in your Discord bot token:
    echo   copy .env.example .env
    echo   notepad .env
    echo.
)

echo ============================================
echo   Installation complete!
echo   Run 'run.bat' to start the application.
echo ============================================
pause
