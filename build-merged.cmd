@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-merged.ps1" %*
if errorlevel 1 (
  echo.
  echo Merged firmware build FAILED.
  pause
  exit /b 1
)
echo.
echo Merged firmware build completed.
pause
