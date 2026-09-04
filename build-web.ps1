$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "== DCCExpressHub: web UI build ==" -ForegroundColor Cyan
Push-Location ".\web-ui"
try {
    if (-not (Test-Path ".\node_modules")) {
        npm install
    }
    npm run build
}
finally {
    Pop-Location
}

Write-Host "== Preparing gzip LittleFS data ==" -ForegroundColor Cyan
node ".\prepare-littlefs.mjs"

Write-Host "data\ is ready." -ForegroundColor Green
