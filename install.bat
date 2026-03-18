@echo off
echo ============================================
echo   Brady News Project - Installation
echo ============================================
echo.

:: Check for Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js is not installed.
    echo Please install Node.js LTS from https://nodejs.org/
    echo IMPORTANT: During install, check the box for "Automatically install
    echo the necessary tools" when prompted. This installs Python and C++
    echo build tools needed for native modules.
    echo.
    echo After installing, close this window and run install.bat again.
    pause
    exit /b 1
)

echo [1/5] Node.js found:
node --version
echo.

:: Check for Python (needed by node-gyp for native module rebuild)
where python >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo WARNING: Python not found. If the native module rebuild fails,
    echo install Python 3 from https://www.python.org/downloads/
    echo or re-run the Node.js installer and check the box for
    echo "Automatically install the necessary tools."
    echo.
)

:: Install dependencies
echo [2/5] Installing dependencies...
call npm install --ignore-scripts
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
)
echo.

:: Download Electron binary
echo [3/5] Setting up Electron...
node node_modules\electron\install.js
echo.

:: Rebuild native modules for Electron
echo [4/5] Rebuilding native modules for Electron...
call npx @electron/rebuild --force
if %ERRORLEVEL% neq 0 (
    echo.
    echo ============================================
    echo   Native module rebuild failed.
    echo ============================================
    echo   This usually means C++ build tools are missing.
    echo.
    echo   Fix: Install Visual Studio Build Tools:
    echo   1. Go to https://visualstudio.microsoft.com/visual-cpp-build-tools/
    echo   2. Download and run the installer
    echo   3. Select "Desktop development with C++"
    echo   4. Make sure a "Windows SDK" is checked
    echo   5. Click Install
    echo   6. After install, re-run this install.bat
    echo.
    echo   OR: Re-run the Node.js installer and check the box
    echo   "Automatically install the necessary tools" when prompted.
    echo ============================================
    pause
    exit /b 1
)
echo.

:: Check for config
echo [5/5] Checking configuration...
if not exist config.json (
    if exist config.example.json (
        echo Creating config.json from template...
        copy config.example.json config.json >nul
        echo.
        echo ============================================
        echo   IMPORTANT: Add your Discord bot token
        echo ============================================
        echo   Edit config.json and replace YOUR_DISCORD_BOT_TOKEN_HERE
        echo   with your actual Discord bot token.
        echo.
        echo   Opening config.json in Notepad...
        notepad config.json
    )
)
echo.

echo ============================================
echo   Installation complete!
echo   Run 'run.bat' to start the application.
echo ============================================
pause
