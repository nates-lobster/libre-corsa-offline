@echo off
setlocal
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo [LibreCorsa Offline] Node.js 20+ is required.
  echo Install Node.js LTS from https://nodejs.org/ or run: winget install OpenJS.NodeJS.LTS
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [LibreCorsa Offline] Installing dependencies...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

if not exist "out\index.html" (
  echo [LibreCorsa Offline] Building offline simulator bundle...
  call npm run build
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

echo [LibreCorsa Offline] Starting local air-gapped server on http://127.0.0.1:18420/play ...
node scripts/serve-offline.mjs --open %*
if errorlevel 1 pause
