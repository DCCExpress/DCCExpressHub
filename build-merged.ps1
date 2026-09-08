param(
    [ValidateSet(
        "m5stack-basic-dccex",
        "m5stack-basic-z21",
        "esp32dev-dccex",
        "esp32dev-z21"
    )]
    [string]$Environment = "m5stack-basic-dccex",

    [switch]$SkipWeb
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

function Get-FirmwareTarget {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Environment
    )

    switch ($Environment) {
        "m5stack-basic-dccex" {
            return @{
                DisplayName = "M5Stack Basic / DCC-EX"
                FileTag = "M5Stack-Basic-DCCEX"
            }
        }

        "m5stack-basic-z21" {
            return @{
                DisplayName = "M5Stack Basic / Z21"
                FileTag = "M5Stack-Basic-Z21"
            }
        }

        "esp32dev-dccex" {
            return @{
                DisplayName = "ESP32 DevKit / DCC-EX"
                FileTag = "ESP32-DevKit-DCCEX"
            }
        }

        "esp32dev-z21" {
            return @{
                DisplayName = "ESP32 DevKit / Z21"
                FileTag = "ESP32-DevKit-Z21"
            }
        }

        default {
            throw "Unsupported PlatformIO environment: $Environment"
        }
    }
}

$pio = Get-PlatformIO
$target = Get-FirmwareTarget -Environment $Environment
$packageJson = Get-Content ".\web-ui\package.json" -Raw | ConvertFrom-Json
$version = [string]$packageJson.version

if ([string]::IsNullOrWhiteSpace($version)) {
    throw "web-ui\package.json does not contain a firmware version."
}

$outputName = "DCCExpressHub-{0}-v{1}-merged.bin" -f $target.FileTag, $version
$outputPath = Join-Path ".\dist\firmware" $outputName

Write-Host "== DCCExpressHub merged firmware ==" -ForegroundColor Cyan
Write-Host "Target:      $($target.DisplayName)" -ForegroundColor DarkGray
Write-Host "Environment: $Environment" -ForegroundColor DarkGray
Write-Host "Version:     $version" -ForegroundColor DarkGray
Write-Host "PlatformIO:  $pio" -ForegroundColor DarkGray
Write-Host ""

if (-not $SkipWeb) {
    & ".\build-web.ps1"
    if ($LASTEXITCODE -ne 0) {
        throw "Web build failed."
    }
}

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

if (-not (Test-Path $outputPath)) {
    throw "Expected merged firmware was not created: $outputPath"
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "Firmware: $outputPath" -ForegroundColor Green
