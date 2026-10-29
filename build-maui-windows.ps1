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

# Restore the full project graph with each project's own target framework.
# A global -p:TargetFrameworks=... would overwrite the net10.0 Runtime's restore
# graph and cause NETSDK1005 when that project reference is compiled.
& dotnet restore $project
Assert-Exit "MAUI/Runtime restore"

if ($Publish) {
  # Do not change the layout of the actual MAUI/WinUI publish output:
  # native DLLs, Windows App SDK files and wwwroot must stay together.
  # Instead, place the complete published application inside app/ and
  # provide a simple, relocatable launcher at the ZIP root.
  $packageName = "DCCExpressHub-$version-maui-win-x64"
  $packageRoot = Join-Path $root "dist/$packageName"
  $appRoot = Join-Path $packageRoot "app"
  $zip = Join-Path $root "dist/$packageName.zip"
  if (Test-Path $packageRoot) { Remove-Item $packageRoot -Recurse -Force }
  New-Item $appRoot -ItemType Directory -Force | Out-Null

  & dotnet publish $project -f $tfm -c Release -r win-x64 `
    -p:WindowsPackageType=None `
    -p:SelfContained=true `
    -p:WindowsAppSDKSelfContained=true `
    -o $appRoot
  Assert-Exit "MAUI Windows publish"

  if (-not (Test-Path (Join-Path $appRoot "DCCExpressHub.App.exe"))) {
    throw "Published MAUI executable is missing"
  }
  if (-not (Test-Path (Join-Path $appRoot "wwwroot/index.html"))) {
    throw "Published Web UI was not included"
  }

  # The launcher uses paths relative to its own folder: the user can
  # extract the ZIP anywhere and move the whole folder afterwards.
  $launcher = Join-Path $packageRoot "Start DCCExpressHub.cmd"
  $launcherText = @(
    "@echo off",
    'if not exist "%~dp0app\DCCExpressHub.App.exe" (',
    '  echo ERROR: Missing app\DCCExpressHub.App.exe',
    '  pause',
    '  exit /b 1',
    ')',
    'start "" /D "%~dp0app" "%~dp0app\DCCExpressHub.App.exe" %*'
  ) -join "`r`n"
  [System.IO.File]::WriteAllText(
    $launcher, $launcherText + "`r`n",
    (New-Object System.Text.ASCIIEncoding)
  )

  $releaseNotes = @(
    "DCCExpressHub $version - Windows MAUI",
    "",
    "Run: Start DCCExpressHub.cmd",
    "",
    "The app folder contains the necessary WinUI/MAUI files and the Web UI.",
    "Keep the app folder intact; it must remain next to the launcher.",
    "Your workspace/data are stored outside the release folder.",
    "",
    "This is an alpha9 Windows test build, not an installer."
  ) -join "`r`n"
  [System.IO.File]::WriteAllText(
    (Join-Path $packageRoot "README.txt"), $releaseNotes + "`r`n",
    (New-Object System.Text.UTF8Encoding($false))
  )

  if (Test-Path $zip) { Remove-Item $zip -Force }
  Compress-Archive -Path $packageRoot -DestinationPath $zip -CompressionLevel Optimal
  Write-Host "Release folder : $packageRoot" -ForegroundColor Green
  Write-Host "Release ZIP    : $zip" -ForegroundColor Green
  Write-Host "Start with     : Start DCCExpressHub.cmd" -ForegroundColor Green
} else {
  & dotnet build $project -f $tfm -c $Configuration -p:WindowsPackageType=None
  Assert-Exit "MAUI Windows build"
}
# The SDK output must stay intact: WinUI/Windows App SDK loads native DLLs
# from their expected deployment locations. Provide an easy launcher instead
# of relocating runtime dependencies and breaking the application.
$desktopBuildRoot = Join-Path $root "desktop/DCCExpressHub.App/bin"
$exeRoot = if ($Publish) { Join-Path $root "dist/DCCExpressHub-$version-maui-win-x64/app" } else {
  Join-Path $desktopBuildRoot $Configuration
}
$exe = Get-ChildItem $exeRoot -Filter "DCCExpressHub.App.exe" -File -Recurse |
  Sort-Object LastWriteTimeUtc -Descending |
  Select-Object -First 1
if (-not $exe) { throw "MAUI Windows executable not found under: $exeRoot" }

$launcherFolder = Join-Path $root "dist"
New-Item $launcherFolder -ItemType Directory -Force | Out-Null
$shortcutPath = Join-Path $launcherFolder "DCCExpressHub MAUI.lnk"
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $exe.FullName
$shortcut.WorkingDirectory = $exe.DirectoryName
$shortcut.Description = "DCCExpressHub MAUI Windows"
$shortcut.Save()

Write-Host "MAUI Windows build successful" -ForegroundColor Green
Write-Host "EXE      : $($exe.FullName)"
Write-Host "Shortcut : $shortcutPath"
Write-Host "Release: unzip the archive and use Start DCCExpressHub.cmd (no scattered DLLs at ZIP root)."
