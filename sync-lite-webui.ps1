param(
    [string]$LiteRepo = "https://github.com/DCCExpress/DCCExpressLite.git",
    [string]$LiteBranch = "main"
)

$ErrorActionPreference = "Stop"

$hubRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $hubRoot

Write-Host ""
Write-Host "=== DCCExpressHub <- DCCExpressLite web-ui sync ===" -ForegroundColor Cyan
Write-Host "Hub root: $hubRoot"
Write-Host ""

$tempRoot = Join-Path $env:TEMP ("dccexpresslite-webui-" + [guid]::NewGuid().ToString("N"))
$liteClone = Join-Path $tempRoot "DCCExpressLite"
$hubWebUi = Join-Path $hubRoot "web-ui"

# Hub-only files that must survive the wholesale Lite web-ui replacement.
$preserveRelative = @(
    "mock-server.mjs",
    "scripts\run-local.mjs"
)

$preserveRoot = Join-Path $tempRoot "hub-preserve"
New-Item -ItemType Directory -Force -Path $preserveRoot | Out-Null

try {
    Write-Host "[1/6] Preserving Hub-only development files..." -ForegroundColor Yellow

    foreach ($relative in $preserveRelative) {
        $source = Join-Path $hubWebUi $relative
        if (Test-Path $source) {
            $target = Join-Path $preserveRoot $relative
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
            Copy-Item $source $target -Force
            Write-Host "      preserved: web-ui\$relative"
        }
    }

    Write-Host "[2/6] Cloning DCCExpressLite ($LiteBranch)..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

    git clone --depth 1 --branch $LiteBranch $LiteRepo $liteClone
    if ($LASTEXITCODE -ne 0) {
        throw "git clone failed with exit code $LASTEXITCODE"
    }

    $liteWebUi = Join-Path $liteClone "web-ui"
    if (-not (Test-Path $liteWebUi)) {
        throw "DCCExpressLite web-ui directory was not found."
    }

    Write-Host "[3/6] Replacing Hub web-ui with the Lite web-ui 1:1..." -ForegroundColor Yellow

    if (Test-Path $hubWebUi) {
        Remove-Item $hubWebUi -Recurse -Force
    }
    Copy-Item $liteWebUi $hubWebUi -Recurse -Force

    Write-Host "[4/6] Restoring Hub-only mock/development files..." -ForegroundColor Yellow

    foreach ($relative in $preserveRelative) {
        $source = Join-Path $preserveRoot $relative
        if (Test-Path $source) {
            $target = Join-Path $hubWebUi $relative
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
            Copy-Item $source $target -Force
            Write-Host "      restored: web-ui\$relative"
        }
    }

    Write-Host "[5/6] Applying Hub branding only (no component/layout rewrites)..." -ForegroundColor Yellow

    $packagePath = Join-Path $hubWebUi "package.json"
    if (Test-Path $packagePath) {
        $package = Get-Content $packagePath -Raw
        $package = $package.Replace('"name": "dccexpress-lite-web-ui"', '"name": "dccexpress-hub-web-ui"')
        Set-Content $packagePath $package -NoNewline -Encoding utf8
    }

    $indexPath = Join-Path $hubWebUi "index.html"
    if (Test-Path $indexPath) {
        $index = Get-Content $indexPath -Raw
        $index = $index.Replace("DCCExpress Lite", "DCCExpressHub")
        Set-Content $indexPath $index -NoNewline -Encoding utf8
    }

    $appPath = Join-Path $hubWebUi "src\App.tsx"
    if (Test-Path $appPath) {
        $app = Get-Content $appPath -Raw
        $app = $app.Replace("DCCExpress Lite", "DCCExpressHub")
        Set-Content $appPath $app -NoNewline -Encoding utf8
    }

    Write-Host "[6/6] Installing frontend dependencies..." -ForegroundColor Yellow
    Push-Location $hubWebUi
    try {
        npm install
        if ($LASTEXITCODE -ne 0) {
            throw "npm install failed with exit code $LASTEXITCODE"
        }

        Write-Host ""
        Write-Host "Running Lite frontend typecheck/build..." -ForegroundColor Yellow
        npm run build
        if ($LASTEXITCODE -ne 0) {
            throw "npm run build failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }

    Write-Host ""
    Write-Host "DONE." -ForegroundColor Green
    Write-Host "The Hub now contains the complete DCCExpressLite web-ui tree."
    Write-Host "Only Hub branding and preserved Hub mock/development files were changed."
    Write-Host ""
    Write-Host "Next step: adapt the Lite API / WebSocket layer to the DCCExpressHub backend."
}
finally {
    if (Test-Path $tempRoot) {
        Remove-Item $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
