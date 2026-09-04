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

If the VS Code PlatformIO extension is installed, open PlatformIO once so its Python environment can be created.
"@
}

$pio = Get-PlatformIO
Write-Host "PlatformIO: $pio" -ForegroundColor DarkGray

& ".\build-web.ps1"

$portArgs = @()
if ($Port.Trim()) {
    $portArgs = @("--upload-port", $Port)
}

Write-Host "== Uploading firmware ==" -ForegroundColor Cyan
& $pio run -t upload @portArgs

Write-Host "== Uploading LittleFS ==" -ForegroundColor Cyan
& $pio run -t uploadfs @portArgs

Write-Host "Firmware + LittleFS uploaded." -ForegroundColor Green
