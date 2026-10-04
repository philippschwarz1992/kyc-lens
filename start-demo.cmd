@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is missing. Install Node.js 22.12 or later, then run this file again.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo npm is missing. Install Node.js with npm, then run this file again.
  pause
  exit /b 1
)
node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=12)?0:1)"
if errorlevel 1 (
  echo This project needs Node.js 22.12 or later. Please update Node.js.
  pause
  exit /b 1
)

if not exist "node_modules\.bin\vite.cmd" (
  echo Installing the project dependencies...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed. Check the message above and your internet connection.
    pause
    exit /b 1
  )
)

echo Preparing self-hosted face tracking assets...
call npm run setup
if errorlevel 1 (
  echo Asset setup failed. Check the message above and your internet connection.
  pause
  exit /b 1
)

echo Starting the playground. Your default browser will open automatically.
call npm run dev
if errorlevel 1 (
  echo The playground stopped with an error. Check the message above.
  pause
  exit /b 1
)
endlocal
