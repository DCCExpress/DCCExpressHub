[CmdletBinding()]
param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Debug",

    [switch]$Clean,

    [switch]$RestoreNode,

    [switch]$Publish
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Publish without an explicit configuration is a release build.
if ($Publish -and -not $PSBoundParameters.ContainsKey("Configuration")) {
    $Configuration = "Release"
}

# DCCExpressHub ACTUAL repository layout:
#
#   platformio.ini
#   web-ui/
#   desktop/
#     DCCExpressHub.Desktop.slnx
#     DCCExpressHub.Net/
#       DCCExpressHub.Net.csproj
#       wwwroot/
#     DCCExpressHub.Desktop/
#       DCCExpressHub.Desktop.csproj
#
$Root = $PSScriptRoot
$VersionFile = Join-Path $Root "VERSION"
$WebUi = Join-Path $Root "web-ui"
$Dist = Join-Path $WebUi "dist"

$DesktopRoot = Join-Path $Root "desktop"
$Solution = Join-Path $DesktopRoot "DCCExpressHub.Desktop.slnx"

$ServerRoot = Join-Path $DesktopRoot "DCCExpressHub.Net"
$ServerProject = Join-Path $ServerRoot "DCCExpressHub.Net.csproj"
$WwwRoot = Join-Path $ServerRoot "wwwroot"

$DesktopProjectRoot = Join-Path $DesktopRoot "DCCExpressHub.Desktop"
$DesktopProject = Join-Path $DesktopProjectRoot "DCCExpressHub.Desktop.csproj"

function Step([string]$Text) {
    Write-Host ""
    Write-Host "==> $Text" -ForegroundColor Cyan
}

function CheckExit([string]$What) {
    if ($LASTEXITCODE -ne 0) {
        throw "$What failed with exit code $LASTEXITCODE."
    }
}

function Require([string]$Path, [string]$Name) {
    if (-not (Test-Path $Path)) {
        throw "$Name not found: $Path"
    }
}

Require (Join-Path $WebUi "package.json") "WebUI package.json"
Require $VersionFile "VERSION"
Require $Solution "Desktop solution"
Require $ServerProject "Server project"
Require $DesktopProject "Desktop project"

Write-Host ""
Write-Host "DCCExpressHub Desktop build" -ForegroundColor Green
Write-Host "Repository : $Root"
Write-Host "WebUI      : $WebUi"
Write-Host "wwwroot    : $WwwRoot"
Write-Host "Solution   : $Solution"
Write-Host "Config     : $Configuration"

if ($Clean) {
    Step "Cleaning generated output"

    $cleanDirs = @(
        $Dist,
        (Join-Path $ServerRoot "bin"),
        (Join-Path $ServerRoot "obj"),
        (Join-Path $DesktopProjectRoot "bin"),
        (Join-Path $DesktopProjectRoot "obj")
    )

    foreach ($dir in $cleanDirs) {
        if (Test-Path $dir) {
            Write-Host "Removing $dir"
            Remove-Item $dir -Recurse -Force
        }
    }
}

Step "Preparing WebUI dependencies"

Push-Location $WebUi
try {
    if ($RestoreNode -or -not (Test-Path "node_modules")) {
        if (Test-Path "package-lock.json") {
            & npm ci
            CheckExit "npm ci"
        }
        else {
            & npm install
            CheckExit "npm install"
        }
    }
    else {
        Write-Host "node_modules already exists - restore skipped."
    }

    Step "Building WebUI"
    & npm run build
    CheckExit "npm run build"
}
finally {
    Pop-Location
}

Require (Join-Path $Dist "index.html") "Built WebUI index.html"

Step "Refreshing desktop\DCCExpressHub.Net\wwwroot"

# wwwroot is the committed Desktop/Web backend snapshot of web-ui/dist.
# Recreate it completely so deleted/renamed Vite assets cannot remain behind.
if (Test-Path $WwwRoot) {
    Remove-Item $WwwRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $WwwRoot -Force | Out-Null

# Copy the CONTENTS of dist into wwwroot.
Copy-Item (Join-Path $Dist "*") $WwwRoot -Recurse -Force

Require (Join-Path $WwwRoot "index.html") "Synchronized wwwroot index.html"

# Verify the sync by relative file list + SHA256.
$distFiles = @(
    Get-ChildItem $Dist -File -Recurse |
    ForEach-Object {
        [PSCustomObject]@{
            Relative = $_.FullName.Substring($Dist.Length).TrimStart('\','/')
            Hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
        }
    } |
    Sort-Object Relative
)

$wwwFiles = @(
    Get-ChildItem $WwwRoot -File -Recurse |
    ForEach-Object {
        [PSCustomObject]@{
            Relative = $_.FullName.Substring($WwwRoot.Length).TrimStart('\','/')
            Hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
        }
    } |
    Sort-Object Relative
)

$distMap = @{}
foreach ($f in $distFiles) { $distMap[$f.Relative] = $f.Hash }

$wwwMap = @{}
foreach ($f in $wwwFiles) { $wwwMap[$f.Relative] = $f.Hash }

if ($distMap.Count -ne $wwwMap.Count) {
    throw "wwwroot sync verification failed: dist=$($distMap.Count), wwwroot=$($wwwMap.Count)"
}

foreach ($name in $distMap.Keys) {
    if (-not $wwwMap.ContainsKey($name)) {
        throw "wwwroot sync verification failed: missing '$name'"
    }

    if ($wwwMap[$name] -ne $distMap[$name]) {
        throw "wwwroot sync verification failed: hash mismatch '$name'"
    }
}

Write-Host "wwwroot synchronized and verified: $($distMap.Count) files." -ForegroundColor Green

Step "Building Desktop solution"

# Normal VS/debug builds intentionally remain ordinary DLL-based builds.
# Only the release package generated by -Publish is converted to single-file.
& dotnet build $Solution -c $Configuration
CheckExit "dotnet build"

$DesktopOutput = Join-Path $DesktopProjectRoot "bin\$Configuration\net10.0-windows"
$RuntimeIndex = Join-Path $DesktopOutput "backend\wwwroot\index.html"

Require $RuntimeIndex "Desktop runtime WebUI"

if ($Publish) {
    Step "Publishing clean self-contained Windows x64 release"

    $Version = (Get-Content $VersionFile -Raw).Trim()
    if ([string]::IsNullOrWhiteSpace($Version)) {
        throw "VERSION file is empty."
    }

    $PublishRoot = Join-Path $Root "dist\desktop"
    $PublishDir = Join-Path $PublishRoot "win-x64"
    $TempRoot = Join-Path $PublishRoot ".publish-temp"
    $DesktopTemp = Join-Path $TempRoot "desktop"
    $BackendTemp = Join-Path $TempRoot "backend"
    $ZipPath = Join-Path $PublishRoot "DCCExpressHub-$Version-win-x64.zip"

    foreach ($dir in @($PublishDir, $TempRoot)) {
        if (Test-Path $dir) {
            Remove-Item $dir -Recurse -Force
        }
    }

    New-Item -ItemType Directory -Path $PublishDir -Force | Out-Null
    New-Item -ItemType Directory -Path $DesktopTemp -Force | Out-Null
    New-Item -ItemType Directory -Path $BackendTemp -Force | Out-Null

    Step "Publishing Desktop shell as single-file EXE"

    & dotnet publish $DesktopProject `
        -c $Configuration `
        -r win-x64 `
        --self-contained true `
        -p:PublishSingleFile=true `
        -p:IncludeNativeLibrariesForSelfExtract=true `
        -p:EnableCompressionInSingleFile=true `
        -p:PublishTrimmed=false `
        -p:PublishReadyToRun=false `
        -p:DebugSymbols=false `
        -p:DebugType=None `
        -o $DesktopTemp
    CheckExit "Desktop single-file publish"

    Require (Join-Path $DesktopTemp "DCCExpressHub.Desktop.exe") "Published Desktop executable"

    # Copy all actual publish outputs except symbols. In a normal single-file
    # publish this is essentially the EXE; if WebView2 leaves a required native
    # loader beside it, that loader is preserved automatically.
    Get-ChildItem $DesktopTemp -File -Recurse |
        Where-Object {
            $_.Extension -ne ".pdb" -and
            -not (
                $_.Extension -eq ".xml" -and
                $_.Name -like "Microsoft.Web.WebView2.*.xml"
            )
        } |
        ForEach-Object {
            $relative = $_.FullName.Substring($DesktopTemp.Length).TrimStart('\','/')
            $target = Join-Path $PublishDir $relative
            $targetDir = Split-Path $target -Parent

            if (-not (Test-Path $targetDir)) {
                New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
            }

            Copy-Item $_.FullName $target -Force
        }

    Step "Publishing backend as single-file EXE"

    & dotnet publish $ServerProject `
        -c $Configuration `
        -r win-x64 `
        --self-contained true `
        -p:PublishSingleFile=true `
        -p:IncludeNativeLibrariesForSelfExtract=true `
        -p:EnableCompressionInSingleFile=true `
        -p:PublishTrimmed=false `
        -p:PublishReadyToRun=false `
        -p:DebugSymbols=false `
        -p:DebugType=None `
        -o $BackendTemp
    CheckExit "Backend single-file publish"

    Require (Join-Path $BackendTemp "DCCExpressHub.Net.exe") "Published backend executable"
    Require (Join-Path $BackendTemp "wwwroot\index.html") "Published backend WebUI"

    $PublishedBackend = Join-Path $PublishDir "backend"
    New-Item -ItemType Directory -Path $PublishedBackend -Force | Out-Null

    # Same rule: keep deployable content, drop debug symbols only.
    Get-ChildItem $BackendTemp -File -Recurse |
        Where-Object {
            $_.Extension -ne ".pdb" -and
            -not (
                $_.Extension -eq ".xml" -and
                $_.Name -like "Microsoft.Web.WebView2.*.xml"
            )
        } |
        ForEach-Object {
            $relative = $_.FullName.Substring($BackendTemp.Length).TrimStart('\','/')
            $target = Join-Path $PublishedBackend $relative
            $targetDir = Split-Path $target -Parent

            if (-not (Test-Path $targetDir)) {
                New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
            }

            Copy-Item $_.FullName $target -Force
        }

    Require (Join-Path $PublishDir "DCCExpressHub.Desktop.exe") "Packaged Desktop executable"
    Require (Join-Path $PublishedBackend "DCCExpressHub.Net.exe") "Packaged backend executable"
    Require (Join-Path $PublishedBackend "wwwroot\index.html") "Packaged WebUI"

    # Keep the human-readable product version beside the launcher. The desktop
    # shell reads this at runtime, so the startup dialog shows the release
    # version instead of falling back to the assembly default.
    Copy-Item $VersionFile (Join-Path $PublishDir "VERSION") -Force

    # Never ship symbols or WebView2 XML API documentation from the release package.
    Get-ChildItem $PublishDir -Filter "*.pdb" -File -Recurse -ErrorAction SilentlyContinue |
        Remove-Item -Force

    Get-ChildItem $PublishDir -Filter "Microsoft.Web.WebView2.*.xml" -File -Recurse -ErrorAction SilentlyContinue |
        Remove-Item -Force

    if (Test-Path $ZipPath) {
        Remove-Item $ZipPath -Force
    }

    Step "Creating release ZIP"
    Compress-Archive `
        -Path (Join-Path $PublishDir "*") `
        -DestinationPath $ZipPath `
        -CompressionLevel Optimal

    Require $ZipPath "Windows release ZIP"

    # Temp publish trees contain the uncurated intermediate output only.
    Remove-Item $TempRoot -Recurse -Force

    Write-Host ""
    Write-Host "Clean release package:" -ForegroundColor Green
    Write-Host "  DCCExpressHub.Desktop.exe"
    Write-Host "  backend\DCCExpressHub.Net.exe"
    Write-Host "  backend\wwwroot\..."
    Write-Host "  (+ only publish-required external files, if any)"
    Write-Host ""
    Write-Host "Release ZIP  : $ZipPath" -ForegroundColor Green
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " DCCExpressHub Desktop build OK" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "WebUI source : web-ui"
Write-Host "WebUI build  : web-ui\dist"
Write-Host "Server UI    : desktop\DCCExpressHub.Net\wwwroot"
Write-Host "Desktop out  : desktop\DCCExpressHub.Desktop\bin\$Configuration\net10.0-windows"
Write-Host "Runtime UI   : ...\backend\wwwroot"
if ($Publish) {
    Write-Host "Release ZIP  : dist\desktop\DCCExpressHub-$Version-win-x64.zip"
}
Write-Host ""
