$ErrorActionPreference = 'Stop'
Set-Location "$PSScriptRoot\web-ui"
npm install
npm run build:esp
Write-Host "UI build kesz. A gzip fajlok a data/ mappaban vannak." -ForegroundColor Green
