$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "== DCCExpressHub: build all firmware targets ==" -ForegroundColor Cyan
Write-Host ""

# Build the common web UI only once.
& ".\build-web.ps1"

Write-Host ""
Write-Host "== M5Stack Basic ==" -ForegroundColor Cyan
& ".\build-merged.ps1" -Environment "m5stack-basic" -SkipWeb

Write-Host ""
Write-Host "== ESP32 DevKit ==" -ForegroundColor Cyan
& ".\build-merged.ps1" -Environment "esp32dev" -SkipWeb

Write-Host ""
Write-Host "All firmware targets built successfully." -ForegroundColor Green
Write-Host "Output directory: dist\firmware" -ForegroundColor Green
