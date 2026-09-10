$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "== DCCExpressHub: build all firmware targets ==" -ForegroundColor Cyan
Write-Host ""

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
    Write-Host "== $target ==" -ForegroundColor Cyan

    & ".\build-merged.ps1" -Environment $target -SkipWeb

    if ($LASTEXITCODE -ne 0) {
        throw "Build failed for $target."
    }
}

Write-Host ""
Write-Host "All firmware targets built successfully." -ForegroundColor Green
Write-Host "Output directory: dist\firmware" -ForegroundColor Green
