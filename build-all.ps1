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

    throw "PlatformIO CLI not found."
}

$pio = Get-PlatformIO

& ".\build-web.ps1"
if ($LASTEXITCODE -ne 0) {
    throw "Web build failed."
}

$targets = @(
    "m5stack-basic-dccex",
    "m5stack-basic-z21",
    "esp32dev-dccex",
    "esp32dev-z21",
    "waveshare-s3-lcd7-dccex",
    "waveshare-s3-lcd7-z21"
)

foreach ($target in $targets) {
    Write-Host ""
    Write-Host "== Building firmware [$target] ==" -ForegroundColor Cyan
    & $pio run -e $target
    if ($LASTEXITCODE -ne 0) {
        throw "Firmware build failed for $target."
    }

    Write-Host "== Building LittleFS [$target] ==" -ForegroundColor Cyan
    & $pio run -e $target -t buildfs
    if ($LASTEXITCODE -ne 0) {
        throw "LittleFS build failed for $target."
    }

    Write-Host "Firmware: .pio\build\$target\firmware.bin" -ForegroundColor Green
    Write-Host "LittleFS: .pio\build\$target\littlefs.bin" -ForegroundColor Green
}
