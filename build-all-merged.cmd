@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-all-merged.ps1"

if errorlevel 1 (
  echo.
  echo DCCExpressHub multi-target firmware build FAILED.
  pause
  exit /b 1
)

echo.
echo DCCExpressHub multi-target firmware build completed.
pause
