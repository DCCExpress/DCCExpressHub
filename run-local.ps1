$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
$webUi = Join-Path $projectRoot 'web-ui'

Write-Host '' 
Write-Host 'DCCExpressHub local development' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Terminal #1:' -ForegroundColor Yellow
Write-Host '  cd web-ui'
Write-Host '  npm run mock'
Write-Host ''
Write-Host 'Terminal #2:' -ForegroundColor Yellow
Write-Host '  cd web-ui'
Write-Host '  npm run dev'
Write-Host ''
Write-Host 'Open EXACTLY:' -ForegroundColor Green
Write-Host '  http://localhost:5174'
Write-Host ''
Write-Host 'Local DEV WebSocket:' -ForegroundColor Green
Write-Host '  ws://127.0.0.1:3001/ws'
Write-Host ''
Write-Host 'The UI bypasses the Vite WS proxy in DEV mode.'
Write-Host ''
