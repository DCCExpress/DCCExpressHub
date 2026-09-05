param(
    [string]$Environment = "m5stack-basic"
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

Write-Host "== DCCExpressHub merged firmware ==" -ForegroundColor Cyan
Write-Host "Environment: $Environment" -ForegroundColor DarkGray
Write-Host "PlatformIO: $pio" -ForegroundColor DarkGray
Write-Host ""

& ".\build-web.ps1"

Write-Host "== Building firmware [$Environment] ==" -ForegroundColor Cyan
& $pio run -e $Environment
if ($LASTEXITCODE -ne 0) {
    throw "PlatformIO firmware build failed."
}

Write-Host "== Building LittleFS [$Environment] ==" -ForegroundColor Cyan
& $pio run -e $Environment -t buildfs
if ($LASTEXITCODE -ne 0) {
    throw "PlatformIO LittleFS build failed."
}

Write-Host "== Merging factory image ==" -ForegroundColor Cyan
node ".\tools\firmware\merge-firmware.mjs" --env $Environment
if ($LASTEXITCODE -ne 0) {
    throw "Merged firmware generation failed."
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "Output: dist\firmware\DCCExpressHub-$Environment-merged.bin"
