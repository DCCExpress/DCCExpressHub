$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$webUi = Join-Path $projectRoot 'web-ui'

Write-Host 'DCCExpressHub local development' -ForegroundColor Cyan
Write-Host '1) Open terminal #1 and run: cd web-ui; npm run mock'
Write-Host '2) Open terminal #2 and run: cd web-ui; npm run dev'
Write-Host '3) Open: http://localhost:5173'
Write-Host ''
Write-Host 'Vite now proxies /api to http://127.0.0.1:3001 by default.' -ForegroundColor Green
