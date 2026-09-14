param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Version,

    [switch]$NoPush
)

$ErrorActionPreference = "Stop"

function Invoke-Git {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    & git @Arguments

    if ($LASTEXITCODE -ne 0) {
        throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

function Invoke-Npm {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    & npm @Arguments

    if ($LASTEXITCODE -ne 0) {
        throw "npm $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

$RepoRoot = (& git rev-parse --show-toplevel 2>$null)

if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($RepoRoot)) {
    throw "Run this script inside the DCCExpressHub Git repository."
}

$RepoRoot = $RepoRoot.Trim()
Set-Location $RepoRoot

$Version = $Version.Trim()

if ($Version.StartsWith("v", [System.StringComparison]::OrdinalIgnoreCase)) {
    $Version = $Version.Substring(1)
}

if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$') {
    throw "Invalid version '$Version'. Example: 0.1.0-alpha.2 or 0.1.0"
}

$Tag = "v$Version"

$status = (& git status --porcelain)

if ($LASTEXITCODE -ne 0) {
    throw "Could not read git status."
}

if ($status) {
    Write-Host ""
    Write-Host "Working tree is not clean:" -ForegroundColor Red
    $status | ForEach-Object {
        Write-Host "  $_" -ForegroundColor Yellow
    }

    throw "Commit or stash current changes before creating a release."
}

$branch = (& git branch --show-current)

if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) {
    throw "Could not determine current branch. Do not release from detached HEAD."
}

$branch = $branch.Trim()

$remoteTag = (& git ls-remote --tags origin "refs/tags/$Tag" 2>$null)

if ($LASTEXITCODE -eq 0 -and $remoteTag) {
    throw "Remote tag $Tag already exists."
}

[System.IO.File]::WriteAllText(
    (Join-Path $RepoRoot "VERSION"),
    "$Version`n",
    (New-Object System.Text.UTF8Encoding($false))
)

Write-Host "VERSION -> $Version" -ForegroundColor Green

# VERSION is authoritative.
# npm package metadata is synchronized from it for the web build.
Invoke-Npm version $Version `
    --prefix web-ui `
    --no-git-tag-version `
    --allow-same-version

Invoke-Git add VERSION web-ui/package.json

$packageLock = Join-Path $RepoRoot "web-ui\package-lock.json"

if (Test-Path -LiteralPath $packageLock) {
    Invoke-Git add web-ui/package-lock.json
}

& git diff --cached --quiet
$hasStagedChanges = ($LASTEXITCODE -ne 0)

if ($hasStagedChanges) {
    Invoke-Git commit -m "Release $Tag"
    Write-Host "Created release commit: $Tag" -ForegroundColor Green
} else {
    Write-Host "Version files already match $Version; no release commit needed." -ForegroundColor DarkGray
}

$currentCommit = (& git rev-parse HEAD).Trim()
$localTagCommit = (& git rev-list -n 1 $Tag 2>$null)

if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($localTagCommit)) {
    $localTagCommit = $localTagCommit.Trim()

    if ($localTagCommit -ne $currentCommit) {
        throw "Local tag $Tag already exists and points to another commit."
    }

    Write-Host "Local tag $Tag already points to HEAD; reusing it." -ForegroundColor DarkGray
} else {
    Invoke-Git tag -a $Tag -m "DCCExpressHub $Tag"
    Write-Host "Created annotated tag: $Tag" -ForegroundColor Green
}

if ($NoPush) {
    Write-Host ""
    Write-Host "NoPush requested. Nothing was pushed." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "When ready:" -ForegroundColor Cyan
    Write-Host "  git push origin $branch"
    Write-Host "  git push origin $Tag"
    exit 0
}

Write-Host ""
Write-Host "Pushing branch '$branch'..." -ForegroundColor Cyan
Invoke-Git push origin $branch

Write-Host "Pushing tag '$Tag'..." -ForegroundColor Cyan
Invoke-Git push origin $Tag

Write-Host ""
Write-Host "Release tag pushed successfully." -ForegroundColor Green
Write-Host "GitHub Actions will build the official DCC-EX firmware release for $Tag." -ForegroundColor Green
