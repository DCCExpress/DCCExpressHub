@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found in PATH.
  echo.
  echo Install/use the Node.js that is already used by the DCCExpressHub web project,
  echo then run this file again.
  pause
  exit /b 1
)

start "DCCExpressHub Serial Configurator Server" cmd /k "cd /d ""%~dp0"" && node serve.mjs"
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:8765/"
