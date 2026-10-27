[CmdletBinding()]
param(
    [ValidateSet("Debug", "Release")] [string]$Configuration = "Debug",
    [switch]$Clean,
    [switch]$RestoreNode,
    [switch]$Publish
)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
if ($Publish -and -not $PSBoundParameters.ContainsKey("Configuration")) { $Configuration = "Release" }

$Root = $PSScriptRoot
$WebUi = Join-Path $Root "web-ui"
$Dist = Join-Path $WebUi "dist"
$Solution = Join-Path $Root "DCCExpressHub.V2.slnx"
$RuntimeDir = Join-Path $Root "DCCExpressHub.V2.Runtime"
$HostDir = Join-Path $Root "DCCExpressHub.V2.Host"
$DesktopDir = Join-Path $Root "DCCExpressHub.V2.Desktop"
$DesktopProject = Join-Path $DesktopDir "DCCExpressHub.V2.Desktop.csproj"
$DesktopOutput = Join-Path $DesktopDir "bin/$Configuration/net10.0-windows"
$PublishRoot = Join-Path $Root "dist/desktop"
$PublishDir = Join-Path $PublishRoot "win-x64"
$ZipPath = Join-Path $PublishRoot "DCCExpressHub-V2-win-x64.zip"

function Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}
function Require([string]$Path, [string]$Description) {
    if (-not (Test-Path -LiteralPath $Path)) { throw "$Description missing: $Path" }
}
function CheckExit([string]$Description) {
    if ($LASTEXITCODE -ne 0) { throw "$Description failed (exit code $LASTEXITCODE)." }
}

Require (Join-Path $WebUi "package.json") "Web UI"
Require $Solution "Solution"
Require $DesktopProject "Desktop project"
Require (Join-Path $RuntimeDir "DCCExpressHub.V2.Runtime.csproj") "Runtime project"
Require (Join-Path $HostDir "DCCExpressHub.V2.Host.csproj") "Console Host project"

Write-Host "DCCExpressHub V2 Desktop build" -ForegroundColor Green
Write-Host "Configuration: $Configuration"
if ($Clean) {
    Step "Cleaning generated V2 files"
    $dirs = @($Dist, (Join-Path $RuntimeDir "bin"), (Join-Path $RuntimeDir "obj"),
      (Join-Path $HostDir "bin"), (Join-Path $HostDir "obj"),
      (Join-Path $DesktopDir "bin"), (Join-Path $DesktopDir "obj"),
      (Join-Path $Root "dist"))
    foreach ($dir in $dirs) {
        if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
    }
}

Step "Preparing Web UI dependencies"
Push-Location $WebUi
try {
    if ($RestoreNode -or -not (Test-Path "node_modules")) {
        if (Test-Path "package-lock.json") {
            & npm ci
            CheckExit "npm ci"
        } else {
            & npm install
            CheckExit "npm install"
        }
    } else { Write-Host "node_modules already present." }

    Step "Building React + Mantine + Vite"
    & npm run build
    CheckExit "Web UI build"
} finally { Pop-Location }
Require (Join-Path $Dist "index.html") "Built index.html"

Step "Building V2 solution"
& dotnet build $Solution -c $Configuration
CheckExit "dotnet build"
Require (Join-Path $DesktopOutput "wwwroot/index.html") "Desktop web assets"

if ($Publish) {
    Step "Publishing self-contained Windows x64 Desktop"
    if (Test-Path $PublishDir) { Remove-Item $PublishDir -Recurse -Force }
    New-Item -ItemType Directory -Path $PublishDir -Force | Out-Null
    $publishArgs = @(
        "publish", $DesktopProject, "-c", $Configuration, "-r", "win-x64",
        "--self-contained", "true",
        "-p:PublishSingleFile=true",
        "-p:IncludeNativeLibrariesForSelfExtract=true",
        "-p:PublishTrimmed=false",
        "-o", $PublishDir
    )
    & dotnet @publishArgs
    CheckExit "Desktop publish"

    # HubRuntime serves files from the physical wwwroot beside the executable.
    $PublishedUi = Join-Path $PublishDir "wwwroot"
    if (Test-Path $PublishedUi) { Remove-Item $PublishedUi -Recurse -Force }
    New-Item -ItemType Directory -Path $PublishedUi -Force | Out-Null
    Copy-Item (Join-Path $Dist "*") $PublishedUi -Recurse -Force
    Require (Join-Path $PublishDir "DCCExpressHub.V2.Desktop.exe") "Desktop executable"
    Require (Join-Path $PublishedUi "index.html") "Published Web UI"

    if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
    Step "Creating Windows ZIP"
    Compress-Archive -Path (Join-Path $PublishDir "*") -DestinationPath $ZipPath -CompressionLevel Optimal
    Require $ZipPath "Release ZIP"
}

Write-Host ""
Write-Host "V2 Desktop build completed." -ForegroundColor Green
Write-Host "Desktop: $DesktopOutput"
if ($Publish) { Write-Host "ZIP: $ZipPath" }
