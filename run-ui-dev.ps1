param(
  [string]$Esp32Url = "http://192.168.1.200"
)
$ErrorActionPreference = 'Stop'
Set-Location "$PSScriptRoot\web-ui"
$env:ESP32_URL = $Esp32Url
if (-not (Test-Path node_modules)) { npm install }
npm run dev
