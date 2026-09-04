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

Write-Host "== Building firmware ==" -ForegroundColor Cyan
& $pio run

Write-Host "== Building LittleFS image ==" -ForegroundColor Cyan
& $pio run -t buildfs

Write-Host ""
Write-Host "Firmware:" -ForegroundColor Green
Write-Host "  .pio\build\esp32dev\firmware.bin"
Write-Host "LittleFS:" -ForegroundColor Green
Write-Host "  .pio\build\esp32dev\littlefs.bin"
