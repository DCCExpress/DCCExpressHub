param(
    [string]$Port = ""
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Get-PlatformIO {
    $cmd = Get-Command pio -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    $candidates = @(
        (Join-Path $env:USERPROFILE ".platformio\penv\Scripts\pio.exe"),
        (Join-Path $env:USERPROFILE ".platformio\penv\Scripts\platformio.exe")
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    throw @"
PlatformIO CLI not found.

Tried:
- pio from PATH
- $env:USERPROFILE\.platformio\penv\Scripts\pio.exe
- $env:USERPROFILE\.platformio\penv\Scripts\platformio.exe
"@
}

$pio = Get-PlatformIO
$envName = "m5stack-basic"

Write-Host "PlatformIO: $pio" -ForegroundColor DarkGray
Write-Host "Environment: $envName" -ForegroundColor DarkGray

Write-Host "== Building fresh web UI ==" -ForegroundColor Cyan
& ".\build-web.ps1"

if ($LASTEXITCODE -ne 0) {
    throw "Web UI build failed."
}

$portArgs = @()
if ($Port.Trim()) {
    $portArgs = @("--upload-port", $Port)
}

Write-Host "== Building M5 firmware ==" -ForegroundColor Cyan
& $pio run -e $envName
if ($LASTEXITCODE -ne 0) {
    throw "M5 firmware build failed."
}

Write-Host "== Uploading M5 firmware ==" -ForegroundColor Cyan
& $pio run -e $envName -t upload @portArgs
if ($LASTEXITCODE -ne 0) {
    throw "M5 firmware upload failed."
}

Write-Host "== Building M5 LittleFS ==" -ForegroundColor Cyan
& $pio run -e $envName -t buildfs
if ($LASTEXITCODE -ne 0) {
    throw "M5 LittleFS build failed."
}

Write-Host "== Uploading M5 LittleFS ==" -ForegroundColor Cyan
& $pio run -e $envName -t uploadfs @portArgs
if ($LASTEXITCODE -ne 0) {
    throw "M5 LittleFS upload failed."
}

Write-Host ""
Write-Host "M5 firmware + fresh LittleFS uploaded." -ForegroundColor Green
Write-Host "IMPORTANT: hard refresh the browser (Ctrl+F5) or clear site data once." -ForegroundColor Yellow
