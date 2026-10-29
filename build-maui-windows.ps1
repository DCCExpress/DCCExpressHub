[CmdletBinding()]
param(
  [ValidateSet("Debug", "Release")]
  [string]$Configuration = "Debug",
  [switch]$Publish
)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = $PSScriptRoot
$web = Join-Path $root "web-ui"
$dist = Join-Path $web "dist"
$www = Join-Path $root "desktop/DCCExpressHub.Net/wwwroot"
$project = Join-Path $root "desktop/DCCExpressHub.App/DCCExpressHub.App.csproj"
$tfm = "net10.0-windows10.0.19041.0"

function Assert-Exit([string]$step) {
  if ($LASTEXITCODE -ne 0) { throw "$step failed with exit code $LASTEXITCODE" }
}

Push-Location $web
try {
  if (-not (Test-Path "node_modules")) {
    & npm.cmd ci
    Assert-Exit "npm ci"
  }
  & npm.cmd run build
  Assert-Exit "WebUI build"
} finally { Pop-Location }

$version = (Get-Content (Join-Path $root "VERSION") -Raw).Trim()
if (-not (Test-Path (Join-Path $dist "index.html"))) {
  throw "Vite did not produce dist/index.html"
}
[System.IO.File]::WriteAllText(
  (Join-Path $dist "version.json"),
  ('{"version":"' + $version + '"}' + [Environment]::NewLine),
  (New-Object System.Text.UTF8Encoding($false))
)
if (Test-Path $www) { Remove-Item $www -Recurse -Force }
New-Item $www -ItemType Directory -Force | Out-Null
Copy-Item (Join-Path $dist "*") $www -Recurse -Force

if ($Publish) {
  $out = Join-Path $root "dist/maui-win-x64"
  if (Test-Path $out) { Remove-Item $out -Recurse -Force }
  & dotnet publish $project -f $tfm -c Release -r win-x64 `
    -p:TargetFrameworks=$tfm `
    -p:WindowsPackageType=None `
    -p:SelfContained=true `
    -p:WindowsAppSDKSelfContained=true `
    -o $out
  Assert-Exit "MAUI Windows publish"
  if (-not (Test-Path (Join-Path $out "wwwroot/index.html"))) {
    throw "Published Web UI was not included"
  }
  $zip = Join-Path $root "dist/DCCExpressHub-$version-maui-win-x64.zip"
  if (Test-Path $zip) { Remove-Item $zip -Force }
  Compress-Archive (Join-Path $out "*") $zip -CompressionLevel Optimal
  Write-Host "MAUI Windows ZIP: $zip"
} else {
  & dotnet build $project -f $tfm -c $Configuration -p:TargetFrameworks=$tfm -p:WindowsPackageType=None
  Assert-Exit "MAUI Windows build"
}
Write-Host "MAUI Windows build successful" -ForegroundColor Green
